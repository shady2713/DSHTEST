/** Durable file-reference admission and local reader protection. @module @deepseek-ai/dsh-attachment-local/file-lifecycle */

import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { ReadStream } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-storage'
import { AttachmentError, AttachmentId, FileReferenceOwnerId, FileStageTicket } from '@deepseek-ai/dsh-attachment'
import type {
  FileAttachmentRef, FileDeletionResult, FileReadLease, FileReferenceOwner,
  SaveFileAttachment, SaveFileStreamAttachment, StagedFileAttachment,
} from '@deepseek-ai/dsh-attachment'
import { FileStoreLease } from './file-lease.ts'
import { readFileStreamVerbatim, saveFileStreamVerbatim, saveFileVerbatim, storedFilePath } from './file-store.ts'
import { publishImmutableObject, syncDirectory } from './store.ts'

const { realpath, stat, readdir, unlink, rmdir } = fs
const fileSchema = z.object({
  attachmentId: z.string().regex(/^sha256:[a-f0-9]{64}$/u).transform(AttachmentId),
  name: z.string(), bytes: z.number().int().nonnegative(),
})
const ownerSchema = z.object({
  kind: z.enum(['session', 'report', 'snapshot', 'baseline']),
  id: z.string().transform(FileReferenceOwnerId),
})
const stateSchema = z.object({
  root: z.string(),
  objects: z.record(z.string(), z.object({ aliases: z.array(fileSchema), unknown: z.boolean(), deleting: z.array(z.string()) })),
  owners: z.record(z.string(), z.object({ owner: ownerSchema, refs: z.array(fileSchema) })),
  stages: z.record(z.string(), fileSchema.nullable()),
})
type FileState = z.infer<typeof stateSchema>

function specFor(root: string) {
  const initial: FileState = { root, objects: {}, owners: {}, stages: {} }
  return defineDomain({
    name: `attachment_files_${createHash('sha256').update(root).digest('hex')}`,
    version: 1,
    global: { schema: stateSchema, initial },
    tables: {},
  })
}

function refKey(ref: FileAttachmentRef): string { return JSON.stringify([ref.attachmentId, ref.name]) }
function ownerKey(owner: FileReferenceOwner): string { return JSON.stringify([owner.kind, owner.id]) }
function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Cancel a pending source read without retaining its staging descriptor. */
async function* cancellableChunks(data: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncIterable<Uint8Array> {
  const iterator = data[Symbol.asyncIterator]()
  try {
    for (;;) {
      signal.throwIfAborted()
      const next = await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
        const abort = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error('File source cancelled.', { cause: signal.reason })) }
        signal.addEventListener('abort', abort, { once: true })
        void Promise.resolve(iterator.next()).then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
      })
      if (next.done) return
      yield next.value
    }
  } finally {
    if (iterator.return !== undefined) {
      const closed = Promise.resolve(iterator.return())
      if (signal.aborted) void closed.catch(() => { /* An abandoned source cannot delay owned descriptor cleanup. */ })
      else await closed
    }
  }
}

/** One provider owns file mutations, the durable index, and active read handles. */
export class FileLifecycle {
  private chain: Promise<void> = Promise.resolve()
  private ownership?: Promise<FileStoreLease>
  private held?: FileStoreLease
  private domain?: Promise<Domain<ReturnType<typeof specFor>>>
  private opened?: Domain<ReturnType<typeof specFor>>
  private readonly readers = new Map<string, { count: number }>()
  private readonly openStreams = new Set<Promise<void>>()
  private readonly leases = new Set<FileReadLease>()
  private readonly lifetime = new AbortController()
  private disposed = false
  private disposal?: Promise<void>

  /**
   * Register the provider-owned file lifecycle.
   * @param ctx - provider effect owner and optional domain facility.
   * @param root - versioned attachment root.
   */
  constructor(private readonly ctx: Context, private readonly root: string) {
    ctx.effect(() => () => this.dispose())
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new AttachmentError('The file store is disposed.', 'ATTACHMENT_WRITE_FAILED'))
    const running = this.chain.then(async () => {
      this.ownership ??= FileStoreLease.acquire(this.root).then((lease) => { this.held = lease; return lease })
      await this.ownership
      return job()
    })
    this.chain = running.then(() => {}, () => {})
    return running
  }

  private async ledger(): Promise<Domain<ReturnType<typeof specFor>>> {
    const facility = this.ctx.get('storageDomain')
    if (facility === undefined) throw new AttachmentError('File reference management requires the storage domain facility.', 'ATTACHMENT_FILES_UNSUPPORTED')
    this.domain ??= (async () => {
      const root = await realpath(this.root)
      const domain = await facility.open(specFor(root))
      if (domain.global.get().root !== root) {
        await domain.close()
        throw new AttachmentError('File reference index belongs to another store.', 'ATTACHMENT_CORRUPT')
      }
      this.opened = domain
      return domain
    })()
    return this.domain
  }

  private objectPath(ref: FileAttachmentRef): string {
    storedFilePath(this.root, ref)
    const digest = String(ref.attachmentId).slice(7)
    return join(this.root, 'file-objects', digest.slice(0, 2), digest)
  }

  private async exists(path: string): Promise<boolean> {
    try { await stat(path); return true } catch (error) {
      if (missing(error)) return false
      throw error
    }
  }

  private async stage(input: SaveFileAttachment | SaveFileStreamAttachment, legacy: boolean): Promise<StagedFileAttachment> {
    const domain = await this.ledger()
    const ticket = FileStageTicket(randomUUID())
    const before = domain.global.get()
    await domain.global.set({ ...before, stages: { ...before.stages, [ticket]: null } })
    const admit = async (file: FileAttachmentRef): Promise<void> => {
      const current = domain.global.get()
      const previous = current.objects[file.attachmentId]
      const aliases = previous?.aliases ?? []
      const unknown = legacy || previous?.unknown === true
        || (previous === undefined && await this.exists(this.objectPath(file)))
      const object = {
        aliases: aliases.some(ref => refKey(ref) === refKey(file)) ? aliases : [...aliases, file], unknown,
        deleting: previous?.deleting.filter(name => name !== file.name) ?? [],
      }
      await domain.global.set({
        ...current, objects: { ...current.objects, [file.attachmentId]: object },
        stages: { ...current.stages, [ticket]: file },
      })
    }
    const file = await this.saveManaged(input, admit)
    return { file, ticket }
  }

  private async saveManaged(
    input: SaveFileAttachment | SaveFileStreamAttachment,
    admit?: (ref: FileAttachmentRef) => Promise<void>,
  ): Promise<FileAttachmentRef> {
    const name = input.name === undefined ? {} : { name: input.name }
    if (input.data instanceof Uint8Array) return saveFileVerbatim(this.root, { data: input.data, ...name }, admit)
    const signal = 'signal' in input ? AbortSignal.any([input.signal, this.lifetime.signal]) : this.lifetime.signal
    return saveFileStreamVerbatim(this.root, { ...name, data: cancellableChunks(input.data, signal), signal }, admit)
  }

  /**
   * Store exact bytes with durable staging protection.
   * @param input - bytes and display name.
   * @returns the durably staged file and its ticket.
   */
  stageFile(input: SaveFileAttachment): Promise<StagedFileAttachment> {
    return this.stageInput(input, false)
  }

  /**
   * Store streamed bytes with durable staging protection.
   * @param input - bounded source and display name.
   * @returns the durably staged file and its ticket.
   */
  stageFileStream(input: SaveFileStreamAttachment): Promise<StagedFileAttachment> {
    return this.stageInput(input, false)
  }

  private stageInput(input: SaveFileAttachment | SaveFileStreamAttachment, legacy: boolean): Promise<StagedFileAttachment> {
    return this.enqueue(() => this.stage(input, legacy))
  }

  /**
   * Preserve legacy saves as unknown owners.
   * @param input - exact source.
   * @returns the durable file reference.
   */
  async saveLegacy(input: SaveFileAttachment | SaveFileStreamAttachment): Promise<FileAttachmentRef> {
    if (this.ctx.get('storageDomain') !== undefined) {
      const staged = await this.stageInput(input, true)
      await this.releaseStage(staged.ticket)
      return staged.file
    }
    return this.enqueue(async () => {
      const data = Uint8Array.of(1)
      const hash = createHash('sha256').update(data).digest('hex')
      await publishImmutableObject(this.root, join(this.root, 'file-retention-unknown'), data, hash)
      return this.saveManaged(input)
    })
  }

  /**
   * Retain references before a producer durably publishes them.
   * @param owner - durable producer.
   * @param refs - references to publish.
   * @returns durable retention completion.
   */
  commit(owner: FileReferenceOwner, refs: readonly FileAttachmentRef[]): Promise<void> {
    return this.enqueue(async () => {
      const domain = await this.ledger()
      const current = domain.global.get()
      const objects = { ...current.objects }
      for (const ref of refs) {
        const path = storedFilePath(this.root, ref)
        const info = await stat(path)
        if (info.size !== ref.bytes) throw new AttachmentError('Stored file reference has an invalid byte count.', 'ATTACHMENT_CORRUPT')
        const object = objects[ref.attachmentId]
        objects[ref.attachmentId] = {
          aliases: object?.aliases.some(alias => refKey(alias) === refKey(ref)) === true
            ? object.aliases : [...(object?.aliases ?? []), ref],
          unknown: object?.unknown ?? true,
          deleting: object?.deleting.filter(name => name !== ref.name) ?? [],
        }
      }
      const key = ownerKey(owner)
      const prior = current.owners[key]?.refs ?? []
      const merged = new Map([...prior, ...refs].map(ref => [refKey(ref), ref]))
      await domain.global.set({ ...current, objects, owners: { ...current.owners, [key]: { owner, refs: [...merged.values()] } } })
    })
  }

  /**
   * Release references after their producer becomes durably inaccessible.
   * @param owner - durably removed producer.
   * @returns durable release completion.
   */
  releaseOwner(owner: FileReferenceOwner): Promise<void> {
    return this.enqueue(async () => {
      const domain = await this.ledger()
      const current = domain.global.get()
      const owners = { ...current.owners }
      Reflect.deleteProperty(owners, ownerKey(owner))
      await domain.global.set({ ...current, owners })
    })
  }

  /**
   * Release a retired staging ticket.
   * @param ticket - retired durable staging ticket.
   * @returns durable release completion.
   */
  releaseStage(ticket: FileStageTicket): Promise<void> {
    return this.enqueue(async () => {
      const domain = await this.ledger()
      const current = domain.global.get()
      if (current.stages[ticket] === undefined) return
      const stages = { ...current.stages }
      Reflect.deleteProperty(stages, ticket)
      await domain.global.set({ ...current, stages })
    })
  }

  /**
   * Protect an operation's files from deletion until release or cancellation.
   * @param refs - complete operation file set.
   * @param signal - optional cancellation.
   * @returns transient read protection.
   */
  async acquire(refs: readonly FileAttachmentRef[], signal?: AbortSignal): Promise<FileReadLease> {
    signal?.throwIfAborted()
    return this.enqueue(async () => {
      signal?.throwIfAborted()
      const keys = [...new Set(refs.map(refKey))]
      for (const ref of refs) {
        const info = await stat(storedFilePath(this.root, ref))
        if (info.size !== ref.bytes) throw new AttachmentError('Stored file reference has an invalid byte count.', 'ATTACHMENT_CORRUPT')
      }
      const held = keys.map((key) => {
        const readers = this.readers.get(key) ?? { count: 0 }
        readers.count += 1
        this.readers.set(key, readers)
        return { key, readers }
      })
      let released = false
      const lease: FileReadLease = { release: () => {
        if (released) return Promise.resolve()
        released = true
        signal?.removeEventListener('abort', abort)
        for (const { key, readers } of held) {
          readers.count -= 1
          if (readers.count === 0) this.readers.delete(key)
        }
        this.leases.delete(lease)
        return Promise.resolve()
      } }
      const abort = (): void => { void lease.release() }
      signal?.addEventListener('abort', abort, { once: true })
      this.leases.add(lease)
      if (signal?.aborted === true) { await lease.release(); signal.throwIfAborted() }
      return lease
    })
  }

  /**
   * Read verified bytes while protecting the open stream from deletion.
   * @param ref - stored file.
   * @param signal - optional cancellation.
   * @returns verified protected byte chunks.
   */
  async *read(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    signal?.throwIfAborted()
    const lease = await this.acquire([ref])
    const combined = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    let streamClosed: Promise<void> | undefined
    const observe = (stream: ReadStream): void => {
      const closed = new Promise<void>(resolve => stream.once('close', resolve)).then(async () => { await lease.release() })
      this.openStreams.add(closed)
      streamClosed = closed
      void closed.finally(() => this.openStreams.delete(closed))
    }
    try { yield* readFileStreamVerbatim(this.root, ref, combined, observe) } finally {
      if (streamClosed !== undefined) await streamClosed
      await lease.release()
    }
  }

  /**
   * Delete a managed alias only after retention and reader checks permit it.
   * @param ref - exact managed alias.
   * @returns the admission result or completed deletion.
   */
  delete(ref: FileAttachmentRef): Promise<FileDeletionResult> {
    return this.enqueue(async () => {
      const path = storedFilePath(this.root, ref)
      const objectPath = this.objectPath(ref)
      const domain = await this.ledger()
      const current = domain.global.get()
      const object = current.objects[ref.attachmentId]
      const aliasExists = await this.exists(path)
      if (!aliasExists && (object === undefined || !object.deleting.includes(ref.name))) return { status: 'absent' }
      if (object === undefined || object.unknown || await this.exists(join(this.root, 'file-retention-unknown'))
        || Object.values(current.stages).some(stage => stage === null)) return { status: 'unknown' }
      const owners = Object.values(current.owners)
        .filter(value => value.refs.some(file => refKey(file) === refKey(ref))).map(value => value.owner)
      const stages = Object.values(current.stages).filter(file => file !== null && refKey(file) === refKey(ref)).length
      if (owners.length > 0 || stages > 0) return { status: 'retained', owners, stages }
      if ((this.readers.get(refKey(ref))?.count ?? 0) > 0) return { status: 'reading' }
      const directory = join(this.root, 'files', String(ref.attachmentId).slice(7, 9), String(ref.attachmentId).slice(7))
      const names = await readdir(directory).catch((error: unknown) => {
        if (missing(error)) return []
        throw error
      })
      if (names.some(name => !object.aliases.some(alias => alias.name === name) && !object.deleting.includes(name))) return { status: 'unknown' }
      const aliases = object.aliases.filter(alias => alias.name !== ref.name)
      const info = await stat(objectPath).catch((error: unknown) => {
        if (missing(error)) return undefined
        throw error
      })
      const deleting = [...new Set([...object.deleting, ref.name])]
      await domain.global.set({ ...current, objects: { ...current.objects, [ref.attachmentId]: { ...object, deleting } } })
      if (aliasExists) await unlink(path)
      if (await this.exists(directory)) await syncDirectory(directory)
      let canonicalBytesRemoved = 0
      if (aliases.length === 0) {
        if (info !== undefined) await unlink(objectPath)
        await syncDirectory(join(this.root, 'file-objects', String(ref.attachmentId).slice(7, 9)))
        canonicalBytesRemoved = info?.size ?? 0
        try { await rmdir(directory) } catch (error) {
          if (!missing(error)) throw error
        }
      }
      const objects = {
        ...current.objects, [ref.attachmentId]: { ...object, aliases, deleting: deleting.filter(name => name !== ref.name) },
      }
      await domain.global.set({ ...current, objects })
      return { status: 'deleted', canonicalBytesRemoved }
    })
  }

  /**
   * Cancel readers, drain writes, close the domain, then release kernel ownership.
   * @returns quiescent teardown.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposal = (async () => {
      const consumers = this.ctx.reflect.notify(['attachments']).filter(fiber => fiber !== this.ctx.fiber)
      // Cordis reports failed dependent startup; its settled teardown must still release this store.
      await Promise.allSettled(consumers.map(fiber => fiber.await()))
      this.disposed = true
      this.lifetime.abort(new Error('File attachment provider disposed.'))
      await this.chain
      await Promise.all(this.openStreams)
      await Promise.all([...this.leases].map(lease => lease.release()))
      try { await this.opened?.close() } finally {
        await this.held?.release()
      }
    })()
    return this.disposal
  }
}
