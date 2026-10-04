import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { FileReferenceOwnerId, FileStageTicket } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, FileReferenceOwner } from '@deepseek-ai/dsh-attachment'
import { bindFilePublisher, bindFileReader, consumeFilePublisherCall } from '@deepseek-ai/dsh-attachment/file-publisher'
import { guardedPlugin } from '@deepseek-ai/dsh-cordis-host-runner/src/guard.ts'
import type { FilePublisher, FileReader } from '@deepseek-ai/dsh-attachment/file-publisher'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { guardFileRetention } from '../src/file-retention.guard.ts'
import { WebTestPolicyError } from '../src/errors.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

class Producer extends Service {
  static inject = ['attachments']
  readonly publisher: FilePublisher
  constructor(ctx: Context, options: { role: string; drain?: () => Promise<void> }) {
    super(ctx, options.role)
    this.publisher = bindFilePublisher(ctx, options.drain ?? (() => Promise.resolve()))
  }
}

class Reader extends Service {
  static inject = ['attachments']
  readonly reader: FileReader
  constructor(ctx: Context) {
    super(ctx, 'sessionLogExports')
    this.reader = bindFileReader(ctx, () => Promise.resolve())
  }
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-retention-guard-'))
  const ctx = new Context()
  const storage = await ctx.plugin(Storage)
  const json = await ctx.plugin(StorageJson, { root: join(root, 'storages') })
  const domain = await ctx.plugin(StorageDomain, { backend: 'json' })
  const provider = await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  const store = ctx.attachments
  const restores = guardFileRetention(store, (entry) => {
    throw new WebTestPolicyError('web-test-policy/denied', `denied ${entry}`)
  })
  cleanups.push(async () => {
    for (const restore of restores.reverse()) restore()
    await provider.dispose()
    await domain.dispose()
    await json.dispose()
    await storage.dispose()
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  })
  const uploadFiber = await ctx.plugin(Producer, { role: 'fileUploads' })
  const sessionFiber = await ctx.plugin(Producer, { role: 'sessionPersistence' })
  const uploads = (uploadFiber.store?.fileUploads?.value as Producer).publisher
  const sessions = (sessionFiber.store?.sessionPersistence?.value as Producer).publisher
  const owner: FileReferenceOwner = { kind: 'session', id: FileReferenceOwnerId('protected-session') }
  return { ctx, store, uploads, sessions, owner, uploadFiber, sessionFiber, provider }
}

describe('file retention policy authority', () => {
  it('refuses all public mutation and protected read entry paths while trusted producers publish exact files', async () => {
    const { ctx, store, uploads, sessions, owner } = await harness()
    const staged = await uploads.stageEncodedFile({ data: 'AQID', name: 'protected.bin' })
    await sessions.commitFileReferences(owner, [staged.file])
    await uploads.releaseFileStage(staged.ticket)
    const denied = [
      () => store.stageFile({ data: Uint8Array.of(4) }),
      () => store.stageFileStream({ data: (async function* () { yield Uint8Array.of(4) })() }),
      () => store.stageEncodedFile({ data: 'BA==' }),
      () => store.commitFileReferences(owner, [staged.file]),
      () => store.releaseFileReferences(owner),
      () => store.releaseFileStage(staged.ticket),
      () => store.acquireFileReadLease([staged.file]),
      () => store.deleteFile(staged.file),
    ]
    for (const operation of denied) await expect(operation()).rejects.toMatchObject({ code: 'web-test-policy/denied' })
    expect(await readFile(store.fileHostPath(staged.file)!)).toEqual(Buffer.of(1, 2, 3))
    expect(() => bindFilePublisher(ctx.extend(), () => Promise.resolve())).toThrow('owning Host producer')
    expect(consumeFilePublisherCall(store, 'releaseFileStage', [staged.ticket])).toBe(false)
    await expect(uploads.releaseFileStage(FileStageTicket('foreign-ticket'))).rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_REF' })
    await expect(uploads.commitFileReferences(owner, [staged.file])).rejects.toMatchObject({ code: 'ATTACHMENT_FILES_UNSUPPORTED' })
    await expect(sessions.releaseFileReferences({ kind: 'report', id: owner.id })).rejects.toMatchObject({ code: 'ATTACHMENT_FILES_UNSUPPORTED' })
    await expect(sessions.stageFile({ data: Uint8Array.of(4) })).rejects.toMatchObject({ code: 'ATTACHMENT_FILES_UNSUPPORTED' })
    await sessions.releaseFileReferences(owner)
  })

  it('denies reuse and different arguments inside a producer call', async () => {
    const { store, uploads } = await harness()
    const guarded = store.stageFile.bind(store)
    Object.defineProperty(store, 'stageFile', { configurable: true, value: async function (this: AttachmentStore, input: Parameters<AttachmentStore['stageFile']>[0]) {
      const staged = await guarded.call(this, input)
      await expect(guarded.call(this, input)).rejects.toMatchObject({ code: 'web-test-policy/denied' })
      return staged
    } })
    const staged = await uploads.stageFile({ data: Uint8Array.of(5) })
    await uploads.releaseFileStage(staged.ticket)
    Object.defineProperty(store, 'stageFile', { configurable: true, value: async function (this: AttachmentStore, input: Parameters<AttachmentStore['stageFile']>[0]) {
      return guarded.call(this, { ...input })
    } })
    await expect(uploads.stageFile({ data: Uint8Array.of(6) })).rejects.toMatchObject({ code: 'web-test-policy/denied' })
  })

  it('keeps its publisher usable during owned disposal cleanup, then revokes it', async () => {
    const { ctx, store, uploads, uploadFiber } = await harness()
    await uploadFiber.dispose()
    await expect(uploads.stageFile({ data: Uint8Array.of(7) })).rejects.toMatchObject({ code: 'ATTACHMENT_WRITE_FAILED' })
    let calls = 0
    const producer = await ctx.plugin(Producer, { role: 'fileUploads', drain: async () => {
      calls += 1
      await publisher.releaseFileStage(staged.ticket)
    } })
    const publisher = (producer.store?.fileUploads?.value as Producer).publisher
    const staged = await publisher.stageFileStream({ data: (async function* () { yield Uint8Array.of(8) })() })
    await producer.dispose()
    expect(calls).toBe(1)
    await expect(stat(store.fileHostPath(staged.file)!)).resolves.toMatchObject({ size: 1 })
    await expect(publisher.releaseFileStage(staged.ticket)).rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_REF' })
  })

  it('binds read-only authority to the actual export owner and refuses plain context, copied roles, and disposed readers', async () => {
    const { ctx, store, uploads } = await harness()
    expect(() => bindFileReader(ctx, () => Promise.resolve())).toThrow('owning Host exporter')
    const fake = new Context()
    fake.provide('sessionLogExports', { name: 'sessionLogExports' })
    expect(() => bindFileReader(fake, () => Promise.resolve())).toThrow('owning Host exporter')
    await fake.fiber.dispose()
    const staged = await uploads.stageFile({ data: Uint8Array.of(9, 10), name: 'readable.bin' })
    const fiber = await ctx.plugin(Reader)
    const reader = (fiber.store?.sessionLogExports?.value as Reader).reader
    await ctx.isolate('sessionLogExports').plugin({
      name: 'copied-export-owner',
      apply(inner: Context) {
        inner.provide('sessionLogExports', fiber.store?.sessionLogExports?.value)
        expect(() => bindFileReader(inner, () => Promise.resolve())).toThrow('owning Host exporter')
      },
    })
    const lease = await reader.acquireFileReadLease([staged.file])
    const chunks: Uint8Array[] = []
    for await (const chunk of reader.readFileStream(staged.file)) chunks.push(chunk)
    expect(Buffer.concat(chunks)).toEqual(Buffer.of(9, 10))
    expect(Object.keys(reader).sort()).toEqual(['acquireFileReadLease', 'readFileStream'])
    await lease.release()
    await fiber.dispose()
    await expect(reader.acquireFileReadLease([staged.file])).rejects.toMatchObject({ code: 'ATTACHMENT_WRITE_FAILED' })
    expect(() => reader.readFileStream(staged.file)).toThrow('disposed')
    expect(() => store.readFileStream(staged.file)).toThrow('denied')
  })

  it('refuses authority enrollment by a consumer that only receives the actual producer service', async () => {
    const { ctx } = await harness()
    await ctx.plugin({
      name: 'model-consumer', inject: ['fileUploads', 'sessionPersistence'],
      apply(inner: Context) {
        expect(() => bindFilePublisher(inner, () => Promise.resolve())).toThrow('owning Host producer')
      },
    })
  })

  it('supports a lazy producer without attachments and shares a concurrent provider drain', async () => {
    const empty = new Context()
    class LazyProducer extends Service {
      readonly publisher: FilePublisher
      constructor(ctx: Context) {
        super(ctx, 'sessionPersistence')
        this.publisher = bindFilePublisher(ctx, () => Promise.resolve())
      }
    }
    const lazy = await empty.plugin(LazyProducer)
    const publisher = (lazy.store?.sessionPersistence?.value as LazyProducer).publisher
    await expect(publisher.commitFileReferences({ kind: 'session', id: FileReferenceOwnerId('plaintext') }, []))
      .rejects.toMatchObject({ code: 'ATTACHMENT_FILES_UNSUPPORTED' })
    await lazy.dispose()
    const { ctx, uploadFiber, provider } = await harness()
    await uploadFiber.dispose()
    let drains = 0
    let finish!: () => void
    let entered!: () => void
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const pending = new Promise<void>((resolve) => { finish = resolve })
    class OptionalUploads extends Service {
      readonly publisher: FilePublisher
      releaseFixtureDrain(): void { this.ctx.effect(() => finish) }
      constructor(inner: Context) {
        super(inner, 'fileUploads')
        this.publisher = bindFilePublisher(inner, async () => {
          drains += 1
          entered()
          await pending
          await uploads.releaseFileStage(staged.ticket)
        })
      }
    }
    const producer = await ctx.plugin(OptionalUploads)
    const service = producer.store?.fileUploads?.value as OptionalUploads
    const uploads = service.publisher
    const staged = await uploads.stageFile({ data: Uint8Array.of(11) })
    const withdrawing = provider.dispose()
    await ready
    service.releaseFixtureDrain()
    await Promise.all([withdrawing, producer.dispose()])
    expect(drains).toBe(1)
  })

  it('reports a failed owned drain and still revokes the producer closure', async () => {
    const { ctx, uploadFiber } = await harness()
    await uploadFiber.dispose()
    const report = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    try {
      const producer = await ctx.plugin(Producer, { role: 'fileUploads', drain: () => Promise.reject(new Error('owned drain failed')) })
      const publisher = (producer.store?.fileUploads?.value as Producer).publisher
      await producer.dispose()
      expect(report).toHaveBeenCalled()
      await expect(publisher.stageFile({ data: Uint8Array.of(12) })).rejects.toMatchObject({ code: 'ATTACHMENT_WRITE_FAILED' })
    } finally { report.mockRestore() }
  })

  it('rejects self-registered writer and reader roles through the real dynamic Host context facade', async () => {
    const { ctx } = await harness()
    const rejections: Error[] = []
    await ctx.plugin(guardedPlugin({
      name: 'model-file-authority-forgery',
      inject: ['attachments'],
      apply(modelContext: Context) {
        for (const role of ['sessionPersistence', 'sessionLogExports']) {
          class ForgedService extends Service {
            constructor() { super(modelContext, role) }
          }
          expect(() => new ForgedService()).toThrow('sandbox ctx')
        }
        expect(() => bindFilePublisher(modelContext, () => Promise.resolve())).toThrow('sandbox ctx')
        expect(() => bindFileReader(modelContext, () => Promise.resolve())).toThrow('sandbox ctx')
      },
    }, (error) => { rejections.push(error) }))
    expect(rejections).toHaveLength(4)
  })
})
