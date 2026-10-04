import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { AttachmentId, FileReferenceOwnerId, FileStageTicket } from '@deepseek-ai/dsh-attachment'
import type { FileAttachmentRef, FileReferenceOwner } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '../src/index.ts'
import { saveFileVerbatim } from '../src/file-store.ts'
import { FileLifecycle } from '../src/file-lifecycle.ts'

const injected = vi.hoisted(() => ({
  unlinkPath: '', unlinkError: undefined as Error | undefined,
  statPath: '', statError: undefined as Error | undefined, abortOnStat: undefined as AbortController | undefined,
  directoryPath: '', readDirectoryError: undefined as Error | undefined, removeDirectoryError: undefined as Error | undefined,
}))
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  return { ...actual, promises: {
    ...actual.promises,
    unlink: async (path: Parameters<typeof actual.promises.unlink>[0]) => {
      if (String(path) === injected.unlinkPath && injected.unlinkError !== undefined) throw injected.unlinkError
      return actual.promises.unlink(path)
    },
    stat: async (path: Parameters<typeof actual.promises.stat>[0]) => {
      if (String(path) === injected.statPath) {
        if (injected.statError !== undefined) throw injected.statError
        injected.abortOnStat?.abort(new Error('cancelled while acquiring'))
      }
      return actual.promises.stat(path)
    },
    readdir: async (path: Parameters<typeof actual.promises.readdir>[0]) => {
      if (String(path) === injected.directoryPath && injected.readDirectoryError !== undefined) throw injected.readDirectoryError
      return actual.promises.readdir(path)
    },
    rmdir: async (path: Parameters<typeof actual.promises.rmdir>[0]) => {
      if (String(path) === injected.directoryPath && injected.removeDirectoryError !== undefined) throw injected.removeDirectoryError
      return actual.promises.rmdir(path)
    },
  } }
})

const cleanups: (() => Promise<void>)[] = []
const homes: string[] = []
afterEach(async () => {
  injected.unlinkPath = ''
  injected.unlinkError = undefined
  injected.statPath = ''
  injected.statError = undefined
  injected.abortOnStat = undefined
  injected.directoryPath = ''
  injected.readDirectoryError = undefined
  injected.removeDirectoryError = undefined
  for (const close of cleanups.splice(0).reverse()) await close()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true, maxRetries: 3 })
})

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-file-lifecycle-'))
  homes.push(path)
  return path
}

async function harness(requestedHome?: string) {
  const dshHome = requestedHome ?? await home()
  const ctx = new Context()
  const storage = await ctx.plugin(Storage)
  const json = await ctx.plugin(StorageJson, { root: join(dshHome, 'storages') })
  const domain = await ctx.plugin(StorageDomain, { backend: 'json' })
  const provider = await ctx.plugin(LocalAttachmentStore, { dshHome })
  const store = ctx.attachments
  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    await provider.dispose()
    await domain.dispose()
    await json.dispose()
    await storage.dispose()
  }
  cleanups.push(close)
  return { ctx, store, dshHome, close }
}

function owner(kind: FileReferenceOwner['kind'], id: string): FileReferenceOwner {
  return { kind, id: FileReferenceOwnerId(id) }
}

function objectPath(dshHome: string, ref: FileAttachmentRef): string {
  const digest = String(ref.attachmentId).slice(7)
  return join(dshHome, 'attachments', 'v1', 'file-objects', digest.slice(0, 2), digest)
}

async function bytes(store: import('@deepseek-ai/dsh-attachment').AttachmentStore, ref: FileAttachmentRef): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of store.readFileStream(ref)) chunks.push(chunk)
  return Buffer.concat(chunks)
}

describe('durable file reference admission', () => {
  it('keeps two real report artifacts sharing exactly one reference independently readable', async () => {
    const { store, dshHome } = await harness()
    const data = randomBytes(8 * 1024 * 1024)
    const first = await store.stageFile({ data, name: 'shared.bin' })
    const second = await store.stageFile({ data, name: 'shared.bin' })
    expect(second.file).toEqual(first.file)
    const reports = [owner('report', 'report-a'), owner('report', 'report-b')]
    for (const report of reports) {
      await store.commitFileReferences(report, [first.file])
      await writeFile(join(dshHome, `${report.id}.json`), JSON.stringify({ files: [first.file] }))
    }
    await store.releaseFileStage(first.ticket)
    await store.releaseFileStage(second.ticket)
    const canonical = objectPath(dshHome, first.file)
    const alias = store.fileHostPath(first.file)!
    const objectInfo = await stat(canonical, { bigint: true })
    const aliasInfo = await stat(alias, { bigint: true })
    expect(aliasInfo.ino).toBe(objectInfo.ino)
    expect(aliasInfo.dev).toBe(objectInfo.dev)
    expect(objectInfo.size).toBe(BigInt(data.length))
    await unlink(join(dshHome, 'report-a.json'))
    await store.releaseFileReferences(reports[0]!)
    await expect(store.deleteFile(first.file)).resolves.toEqual({ status: 'retained', owners: [reports[1]], stages: 0 })
    expect(JSON.parse(await readFile(join(dshHome, 'report-b.json'), 'utf8'))).toEqual({ files: [second.file] })
    expect(await bytes(store, second.file)).toEqual(data)
    await unlink(join(dshHome, 'report-b.json'))
    await store.releaseFileReferences(reports[1]!)
    await expect(store.deleteFile(first.file)).resolves.toEqual({ status: 'deleted', canonicalBytesRemoved: data.length })
    await expect(stat(canonical)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(alias)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(store.deleteFile(first.file)).resolves.toEqual({ status: 'absent' })
  }, 30_000)

  it('retains independent session/fork, snapshot and baseline owners across provider reopening', async () => {
    const first = await harness()
    const staged = await first.store.stageFile({ data: Uint8Array.of(1, 2, 3), name: 'state.bin' })
    const owners = [owner('session', 'parent'), owner('session', 'fork'), owner('snapshot', 'snapshot'), owner('baseline', 'baseline')]
    for (const held of owners) await first.store.commitFileReferences(held, [staged.file, staged.file])
    await first.store.commitFileReferences(owners[0]!, [staged.file])
    await first.store.releaseFileStage(staged.ticket)
    await first.close()
    const reopened = await harness(first.dshHome)
    await expect(reopened.store.deleteFile(staged.file)).resolves.toEqual({ status: 'retained', owners, stages: 0 })
    for (const held of owners) await reopened.store.releaseFileReferences(held)
    await reopened.store.releaseFileReferences(owners[0]!)
    await expect(reopened.store.deleteFile(staged.file)).resolves.toMatchObject({ status: 'deleted' })
  })

  it('keeps a staged upload over restart until explicit retirement', async () => {
    const first = await harness()
    const staged = await first.store.stageEncodedFile({ data: 'AQID', name: 'upload.bin' })
    await first.close()
    const reopened = await harness(first.dshHome)
    await expect(reopened.store.deleteFile(staged.file)).resolves.toEqual({ status: 'retained', owners: [], stages: 1 })
    await reopened.store.releaseFileStage(staged.ticket)
    await reopened.store.releaseFileStage(staged.ticket)
    await reopened.store.releaseFileStage(FileStageTicket('unknown-ticket'))
    await expect(reopened.store.deleteFile(staged.file)).resolves.toMatchObject({ status: 'deleted' })
  })

  it('keeps independent display aliases and removes the canonical bytes only after the last alias', async () => {
    const { store, dshHome } = await harness()
    const first = await store.stageFile({ data: Uint8Array.of(2, 4), name: 'a.bin' })
    const second = await store.stageFile({ data: Uint8Array.of(2, 4), name: 'b.bin' })
    await store.releaseFileStage(first.ticket)
    await expect(store.deleteFile(first.file)).resolves.toEqual({ status: 'deleted', canonicalBytesRemoved: 0 })
    expect(await bytes(store, second.file)).toEqual(Buffer.of(2, 4))
    await store.releaseFileStage(second.ticket)
    await expect(store.deleteFile(second.file)).resolves.toEqual({ status: 'deleted', canonicalBytesRemoved: 2 })
    await expect(stat(objectPath(dshHome, first.file))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains old, legacy, and unindexed aliases conservatively', async () => {
    const { store, dshHome } = await harness()
    const old = await saveFileVerbatim(join(dshHome, 'attachments', 'v1'), { data: Uint8Array.of(3), name: 'historical.bin' })
    await expect(store.deleteFile(old)).resolves.toEqual({ status: 'unknown' })
    const repeated = await store.stageFile({ data: Uint8Array.of(3), name: 'historical.bin' })
    await store.releaseFileStage(repeated.ticket)
    await expect(store.deleteFile(old)).resolves.toEqual({ status: 'unknown' })
    const legacy = await store.saveFile({ data: Uint8Array.of(4), name: 'legacy.bin' })
    await expect(store.deleteFile(legacy)).resolves.toEqual({ status: 'unknown' })
    const managed = await store.stageFile({ data: Uint8Array.of(5), name: 'managed.bin' })
    await saveFileVerbatim(join(dshHome, 'attachments', 'v1'), { data: Uint8Array.of(5), name: 'unindexed.bin' })
    await store.releaseFileStage(managed.ticket)
    await expect(store.deleteFile(managed.file)).resolves.toEqual({ status: 'unknown' })
    expect(await bytes(store, legacy)).toEqual(Buffer.of(4))
  })

  it('fails closed after a durable stage failure and after a failed owner publication', async () => {
    const { ctx, store, dshHome } = await harness()
    const backend = ctx.storage.backend.get('json')
    const open = backend.kv!.open.bind(backend.kv)
    let writes = 0
    vi.spyOn(backend.kv!, 'open').mockImplementation(async (descriptor) => {
      const unit = await open(descriptor)
      const setGlobal = unit.setGlobal.bind(unit)
      vi.spyOn(unit, 'setGlobal').mockImplementation(async (value) => {
        writes += 1
        if (writes === 2) throw new Error('durable admission failed')
        await setGlobal(value)
      })
      return unit
    })
    const data = Uint8Array.of(6)
    await expect(store.stageFile({ data, name: 'failed.bin' })).rejects.toThrow('durable admission failed')
    const failed = { attachmentId: AttachmentId(`sha256:${createHash('sha256').update(data).digest('hex')}`), name: 'failed.bin', bytes: 1 }
    await expect(stat(objectPath(dshHome, failed))).rejects.toMatchObject({ code: 'ENOENT' })
    const next = await store.stageFile({ data: Uint8Array.of(7), name: 'held.bin' })
    await store.releaseFileStage(next.ticket)
    await expect(store.deleteFile(next.file)).resolves.toEqual({ status: 'unknown' })
    await store.commitFileReferences(owner('report', 'unpublished'), [next.file])
    // The writer failed after retention committed; its unpublished owner remains a safe hold.
    await expect(store.deleteFile(next.file)).resolves.toEqual({ status: 'unknown' })
  })

  it('retains an unindexed reference admitted by a producer and rejects inconsistent byte counts', async () => {
    const { store, dshHome } = await harness()
    const old = await saveFileVerbatim(join(dshHome, 'attachments', 'v1'), { data: Uint8Array.of(14), name: 'unindexed.bin' })
    const held = owner('session', 'existing-history')
    await store.commitFileReferences(held, [old])
    await store.releaseFileReferences(held)
    await expect(store.deleteFile(old)).resolves.toEqual({ status: 'unknown' })
    await expect(store.commitFileReferences(held, [{ ...old, bytes: 2 }])).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
    await expect(store.acquireFileReadLease([{ ...old, bytes: 2 }])).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('refuses an index bound to another canonical root', async () => {
    const { ctx, store } = await harness()
    const backend = ctx.storage.backend.get('json').kv!
    const open = backend.open.bind(backend)
    vi.spyOn(backend, 'open').mockImplementation(async (descriptor) => {
      const unit = await open(descriptor)
      vi.spyOn(unit, 'loadAll').mockResolvedValue({ tables: {}, global: { root: 'another-root', objects: {}, owners: {}, stages: {} } })
      return unit
    })
    await expect(store.stageFile({ data: Uint8Array.of(20) })).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('fails management without a domain and retains a legacy root when a domain is added later', async () => {
    const dshHome = await home()
    const ctx = new Context()
    const provider = await ctx.plugin(LocalAttachmentStore, { dshHome })
    const store = ctx.attachments
    cleanups.push(() => provider.dispose())
    const legacy = await store.saveFile({ data: Uint8Array.of(15), name: 'legacy-root.bin' })
    await expect(store.stageFile({ data: Uint8Array.of(16) })).rejects.toMatchObject({ code: 'ATTACHMENT_FILES_UNSUPPORTED' })
    await provider.dispose()
    const reopened = await harness(dshHome)
    const staged = await reopened.store.stageFile({ data: Uint8Array.of(16), name: 'new.bin' })
    await reopened.store.releaseFileStage(staged.ticket)
    await expect(reopened.store.deleteFile(staged.file)).resolves.toEqual({ status: 'unknown' })
    expect(await bytes(reopened.store, legacy)).toEqual(Buffer.of(15))
  })
})

describe('reader, export, and mutation coordination', () => {
  it('closes provider ownership after a dependent plugin failed during startup', async () => {
    const first = await harness()
    const staged = await first.store.stageFile({ data: Uint8Array.of(28), name: 'failed-dependent.bin' })
    const report = vi.spyOn(first.ctx.logger, 'error').mockImplementation(() => {})
    try {
      await expect(first.ctx.plugin({
        name: 'failed-retention-consumer', inject: ['attachments'],
        apply() { throw new Error('dependent startup failed') },
      })).rejects.toThrow('dependent startup failed')
      await first.close()
      const reopened = await harness(first.dshHome)
      expect(await bytes(reopened.store, staged.file)).toEqual(Buffer.of(28))
    } finally { report.mockRestore() }
  })

  it('drains dependent producers while stage release remains available during provider withdrawal', async () => {
    const first = await harness()
    const staged = await first.store.stageFile({ data: Uint8Array.of(13), name: 'drain.bin' })
    let drained = false
    const consumer = await first.ctx.plugin({
      name: 'retention-producer', inject: ['attachments'],
      apply(ctx: Context) {
        const store = ctx.attachments
        ctx.effect(() => async () => {
          await store.releaseFileStage(staged.ticket)
          drained = true
        })
      },
    })
    await consumer.await()
    expect(consumer.state).toBe(2)
    await first.close()
    await consumer.await()
    expect(drained).toBe(true)
    const reopened = await harness(first.dshHome)
    await expect(reopened.store.deleteFile(staged.file)).resolves.toMatchObject({ status: 'deleted' })
  })

  it('protects an export before its first output and a real iterator between chunks', async () => {
    const { store } = await harness()
    const staged = await store.stageFile({ data: randomBytes(180_000), name: 'export.bin' })
    await store.releaseFileStage(staged.ticket)
    const exportLease = await store.acquireFileReadLease([staged.file, staged.file])
    await expect(store.deleteFile(staged.file)).resolves.toEqual({ status: 'reading' })
    const iterator = store.readFileStream(staged.file)[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect(first.done).toBe(false)
    if (!first.done) expect(first.value.byteLength).toBeGreaterThan(0)
    await exportLease.release()
    await exportLease.release()
    await expect(store.deleteFile(staged.file)).resolves.toEqual({ status: 'reading' })
    await iterator.return?.()
    await expect(store.deleteFile(staged.file)).resolves.toMatchObject({ status: 'deleted' })
  })

  it('releases a cancelled export and validates all refs before acquiring any lease', async () => {
    const { store } = await harness()
    const staged = await store.stageFile({ data: Uint8Array.of(8), name: 'cancel.bin' })
    await store.releaseFileStage(staged.ticket)
    const controller = new AbortController()
    const lease = await store.acquireFileReadLease([staged.file], controller.signal)
    controller.abort(new Error('cancel export'))
    await lease.release()
    await expect(store.acquireFileReadLease([staged.file], controller.signal)).rejects.toThrow('cancel export')
    await expect(store.acquireFileReadLease([staged.file, { ...staged.file, name: 'missing.bin' }])).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(store.deleteFile(staged.file)).resolves.toMatchObject({ status: 'deleted' })
  })

  it('orders a new owner commit before deletion, and rejects acquisition after deletion wins', async () => {
    const { store } = await harness()
    const staged = await store.stageFile({ data: Uint8Array.of(9), name: 'race.bin' })
    await store.releaseFileStage(staged.ticket)
    const held = owner('report', 'new-reference')
    const committed = store.commitFileReferences(held, [staged.file])
    const denied = store.deleteFile(staged.file)
    await committed
    await expect(denied).resolves.toEqual({ status: 'retained', owners: [held], stages: 0 })
    await store.releaseFileReferences(held)
    const removed = store.deleteFile(staged.file)
    const tooLate = store.commitFileReferences(held, [staged.file])
    await expect(removed).resolves.toMatchObject({ status: 'deleted' })
    await expect(tooLate).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves deletion intent over a failed unlink and retries after reopening', async () => {
    const first = await harness()
    const staged = await first.store.stageFile({ data: Uint8Array.of(10), name: 'retry.bin' })
    await first.store.releaseFileStage(staged.ticket)
    injected.unlinkPath = first.store.fileHostPath(staged.file)!
    injected.unlinkError = Object.assign(new Error('unlink denied'), { code: 'EACCES' })
    await expect(first.store.deleteFile(staged.file)).rejects.toThrow('unlink denied')
    expect(await bytes(first.store, staged.file)).toEqual(Buffer.of(10))
    await first.close()
    injected.unlinkError = undefined
    const reopened = await harness(first.dshHome)
    await expect(reopened.store.deleteFile(staged.file)).resolves.toEqual({ status: 'deleted', canonicalBytesRemoved: 1 })
  })

  it('admits a fresh stage after an interrupted deletion while preserving its exact alias', async () => {
    const { store } = await harness()
    const first = await store.stageFile({ data: Uint8Array.of(21), name: 'restaged.bin' })
    await store.releaseFileStage(first.ticket)
    injected.unlinkPath = store.fileHostPath(first.file)!
    injected.unlinkError = new Error('alias unlink failed')
    await expect(store.deleteFile(first.file)).rejects.toThrow('alias unlink failed')
    const second = await store.stageFile({ data: Uint8Array.of(21), name: 'restaged.bin' })
    expect(second.file).toEqual(first.file)
    await store.releaseFileStage(second.ticket)
    injected.unlinkError = undefined
    await expect(store.deleteFile(second.file)).resolves.toMatchObject({ status: 'deleted' })
  })

  it('retries after the aliases and canonical bytes disappeared before final index publication', async () => {
    const first = await harness()
    const staged = await first.store.stageFile({ data: Uint8Array.of(17), name: 'finish.bin' })
    await first.store.releaseFileStage(staged.ticket)
    await first.close()
    const ctx = new Context()
    const storage = await ctx.plugin(Storage)
    const json = await ctx.plugin(StorageJson, { root: join(first.dshHome, 'storages') })
    const domain = await ctx.plugin(StorageDomain, { backend: 'json' })
    const provider = await ctx.plugin(LocalAttachmentStore, { dshHome: first.dshHome })
    cleanups.push(async () => { await provider.dispose(); await domain.dispose(); await json.dispose(); await storage.dispose() })
    const opening = ctx.storage.backend.get('json').kv!
    const open = opening.open.bind(opening)
    vi.spyOn(opening, 'open').mockImplementation(async (descriptor) => {
      const unit = await open(descriptor)
      const save = unit.setGlobal.bind(unit)
      let writes = 0
      vi.spyOn(unit, 'setGlobal').mockImplementation(async (value) => {
        writes += 1
        if (writes === 2) throw new Error('final index write failed')
        await save(value)
      })
      return unit
    })
    await expect(ctx.attachments.deleteFile(staged.file)).rejects.toThrow('final index write failed')
    await expect(stat(objectPath(first.dshHome, staged.file))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ctx.attachments.deleteFile(staged.file)).resolves.toEqual({ status: 'deleted', canonicalBytesRemoved: 0 })
  })

  it('cancels a pending streamed source and keeps failed admission conservative', async () => {
    const { store } = await harness()
    const controller = new AbortController()
    let started!: () => void
    const waiting = new Promise<void>((resolve) => { started = resolve })
    const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({ next: () => {
      started()
      return new Promise<IteratorResult<Uint8Array>>(() => {})
    }, return: async () => ({ done: true, value: undefined }) }) }
    const operation = store.stageFileStream({ data: source, name: 'cancelled.bin', signal: controller.signal })
    const rejected = expect(operation).rejects.toThrow('cancel stream')
    await waiting
    controller.abort(new Error('cancel stream'))
    await rejected
    const next = await store.stageFileStream({ data: (async function* () { yield Uint8Array.of(11) })(), name: 'next.bin' })
    await store.releaseFileStage(next.ticket)
    await expect(store.deleteFile(next.file)).resolves.toEqual({ status: 'unknown' })
  })

  it('completes a source without return and contains a rejecting abandoned source return', async () => {
    const { store } = await harness()
    let sent = false
    const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({ next: async () => {
      if (sent) return { done: true, value: undefined }
      sent = true
      return { done: false, value: Uint8Array.of(22) }
    } }) }
    const staged = await store.stageFileStream({ data: source })
    const controller = new AbortController()
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const abandoned: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({ next: () => {
      started()
      return new Promise<IteratorResult<Uint8Array>>(() => {})
    }, return: () => Promise.reject(new Error('source return failed')) }) }
    const pending = store.stageFileStream({ data: abandoned, signal: controller.signal })
    const failed = pending.catch((error: unknown) => error)
    await ready
    controller.abort('non-Error source cancellation')
    expect(await failed).toBeInstanceOf(Error)
    await store.releaseFileStage(staged.ticket)
  })

  it('keeps overlapping leases independent, reads with caller cancellation, and releases held exports on disposal', async () => {
    const first = await harness()
    const staged = await first.store.stageFile({ data: Uint8Array.of(23) })
    await first.store.releaseFileStage(staged.ticket)
    const firstLease = await first.store.acquireFileReadLease([staged.file])
    const secondLease = await first.store.acquireFileReadLease([staged.file])
    await firstLease.release()
    const controller = new AbortController()
    const chunks: Uint8Array[] = []
    for await (const chunk of first.store.readFileStream(staged.file, controller.signal)) chunks.push(chunk)
    expect(Buffer.concat(chunks)).toEqual(Buffer.of(23))
    controller.abort(new Error('cancelled before read'))
    await expect(first.store.readFileStream(staged.file, controller.signal)[Symbol.asyncIterator]().next()).rejects.toThrow('cancelled before read')
    await first.close()
    await secondLease.release()
    const reopened = await harness(first.dshHome)
    await expect(reopened.store.deleteFile(staged.file)).resolves.toMatchObject({ status: 'deleted' })
  })

  it('rechecks cancellation after a queued lease reaches the serialized store', async () => {
    const { store } = await harness()
    const staged = await store.stageFile({ data: Uint8Array.of(24) })
    let started!: () => void
    let finish!: (value: IteratorResult<Uint8Array>) => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({ next: () => {
      started()
      return new Promise<IteratorResult<Uint8Array>>((resolve) => { finish = resolve })
    } }) }
    const writing = store.stageFileStream({ data: source })
    await ready
    const controller = new AbortController()
    const acquire = store.acquireFileReadLease([staged.file], controller.signal)
    const failed = acquire.catch((error: unknown) => error)
    controller.abort(new Error('cancelled in queue'))
    finish({ done: true, value: undefined })
    await writing
    expect(await failed).toMatchObject({ message: 'cancelled in queue' })
  })

  it('releases acquisition cancelled during stat before a read stream opens', async () => {
    const { store } = await harness()
    const staged = await store.stageFile({ data: Uint8Array.of(25) })
    await store.releaseFileStage(staged.ticket)
    injected.statPath = store.fileHostPath(staged.file)!
    const first = new AbortController()
    injected.abortOnStat = first
    await expect(store.acquireFileReadLease([staged.file], first.signal)).rejects.toThrow('cancelled while acquiring')
    const second = new AbortController()
    injected.abortOnStat = second
    await expect(store.readFileStream(staged.file, second.signal)[Symbol.asyncIterator]().next()).rejects.toThrow('cancelled while acquiring')
    injected.abortOnStat = undefined
    await expect(store.deleteFile(staged.file)).resolves.toMatchObject({ status: 'deleted' })
  })

  it('propagates filesystem permission failures and retries a failed final directory removal', async () => {
    const { store } = await harness()
    const staged = await store.stageFile({ data: Uint8Array.of(26) })
    await store.releaseFileStage(staged.ticket)
    injected.statPath = store.fileHostPath(staged.file)!
    injected.statError = Object.assign(new Error('stat denied'), { code: 'EACCES' })
    await expect(store.deleteFile(staged.file)).rejects.toThrow('stat denied')
    injected.statError = undefined
    injected.directoryPath = dirname(injected.statPath)
    injected.readDirectoryError = Object.assign(new Error('readdir denied'), { code: 'EACCES' })
    await expect(store.deleteFile(staged.file)).rejects.toThrow('readdir denied')
    injected.readDirectoryError = undefined
    injected.statPath = ''
    injected.removeDirectoryError = Object.assign(new Error('rmdir denied'), { code: 'EACCES' })
    await expect(store.deleteFile(staged.file)).rejects.toThrow('rmdir denied')
    injected.removeDirectoryError = undefined
    await expect(store.deleteFile(staged.file)).resolves.toEqual({ status: 'deleted', canonicalBytesRemoved: 0 })
  })

  it('propagates canonical object stat errors and can retain an alias after an interrupted deletion', async () => {
    const { store, dshHome } = await harness()
    const first = await store.stageFile({ data: Uint8Array.of(27), name: 'a.bin' })
    const second = await store.stageFile({ data: Uint8Array.of(27), name: 'b.bin' })
    await store.releaseFileStage(first.ticket)
    await store.releaseFileStage(second.ticket)
    injected.statPath = objectPath(dshHome, first.file)
    injected.statError = new Error('canonical stat denied')
    await expect(store.deleteFile(first.file)).rejects.toThrow('canonical stat denied')
    injected.statError = undefined
    injected.unlinkError = new Error('alias deletion interrupted')
    for (const ref of [first.file, second.file]) {
      injected.unlinkPath = store.fileHostPath(ref)!
      await expect(store.deleteFile(ref)).rejects.toThrow('alias deletion interrupted')
    }
    const held = owner('session', 'restored-history')
    await store.commitFileReferences(held, [first.file])
    injected.unlinkError = undefined
    await expect(store.deleteFile(first.file)).resolves.toMatchObject({ status: 'retained' })
    await store.releaseFileReferences(held)
    await expect(store.deleteFile(first.file)).resolves.toMatchObject({ status: 'deleted' })
    await expect(store.deleteFile(second.file)).resolves.toMatchObject({ status: 'deleted' })
    const lifecycle: unknown = Reflect.get(store, 'files')
    expect(lifecycle).toBeInstanceOf(FileLifecycle)
    if (lifecycle instanceof FileLifecycle) {
      const closing = lifecycle.dispose()
      expect(lifecycle.dispose()).toBe(closing)
      await closing
    }
  })

  it('disposes a paused reader, releases actual handles, and refuses work from its old provider', async () => {
    const first = await harness()
    const staged = await first.store.stageFile({ data: randomBytes(160_000), name: 'dispose.bin' })
    await first.store.releaseFileStage(staged.ticket)
    const iterator = first.store.readFileStream(staged.file)[Symbol.asyncIterator]()
    await iterator.next()
    await first.close()
    await expect(first.store.deleteFile(staged.file)).rejects.toMatchObject({ code: 'ATTACHMENT_WRITE_FAILED' })
    const reopened = await harness(first.dshHome)
    await expect(reopened.store.deleteFile(staged.file)).resolves.toMatchObject({ status: 'deleted' })
    await expect(iterator.next()).rejects.toThrow('File attachment provider disposed.')
  })

  it('rejects a second live provider for the canonical root and permits it after disposal', async () => {
    const first = await harness()
    const staged = await first.store.stageFile({ data: Uint8Array.of(12), name: 'owned.bin' })
    const second = await harness(first.dshHome)
    await expect(second.store.acquireFileReadLease([staged.file])).rejects.toMatchObject({ code: 'ATTACHMENT_STORE_OWNED' })
    await second.close()
    await first.close()
    const third = await harness(first.dshHome)
    expect(await bytes(third.store, staged.file)).toEqual(Buffer.of(12))
  })
})
