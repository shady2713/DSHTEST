/** Effect-owned file publication authority for durable Host producers. */

import { AsyncLocalStorage } from 'node:async_hooks'
import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentError } from './error.ts'
import { decodedFileInput } from './admission.ts'
import type { AttachmentStore } from './index.ts'
import type {
  EncodedFileAttachment, FileAttachmentRef, FileReadLease, FileReferenceOwner, FileStageTicket,
  SaveFileAttachment, SaveFileStreamAttachment, StagedFileAttachment,
} from './types.ts'

/** Operations a trusted producer can request without granting model authority. */
export type FilePublisherMethod = 'stageFile' | 'stageFileStream' | 'commitFileReferences' | 'releaseFileReferences'
  | 'releaseFileStage' | 'acquireFileReadLease' | 'readFileStream'

interface Invocation {
  readonly service: object
  readonly method: FilePublisherMethod
  readonly args: readonly unknown[]
  readonly live: () => boolean
}

const calls = new WeakMap<object, Invocation>()
const current = new AsyncLocalStorage<object>()

function original(service: object): object {
  const value: unknown = Reflect.get(service, Symbol.for('cordis.original'))
  return typeof value === 'object' && value !== null ? value : service
}

/**
 * Consume the exact call minted by a live producer; copies and reuse have no authority.
 * @param service - attachment provider reached by this call.
 * @param method - operation being executed.
 * @param args - exact method arguments in order.
 * @returns whether this call owns one matching publication permission.
 */
export function consumeFilePublisherCall(service: AttachmentStore, method: FilePublisherMethod, args: readonly unknown[]): boolean {
  const token = current.getStore()
  if (token === undefined) return false
  const call = calls.get(token)
  calls.delete(token)
  return call !== undefined && call.live() && call.service === original(service) && call.method === method
    && call.args.length === args.length && call.args.every((arg, index) => arg === args[index])
}

/** Private Host producer closure; it is absent from the attachment service and root exports. */
export interface FilePublisher {
  /**
   * Stage an upload owned by this publisher.
   * @param input - exact upload bytes.
   * @returns the staged file owned by this publisher.
   */
  stageFile(input: SaveFileAttachment): Promise<StagedFileAttachment>
  /**
   * Stage a streamed upload owned by this publisher.
   * @param input - exact streamed upload bytes.
   * @returns the staged file owned by this publisher.
   */
  stageFileStream(input: SaveFileStreamAttachment): Promise<StagedFileAttachment>
  /**
   * Decode and stage an upload owned by this publisher.
   * @param input - canonical base64 upload.
   * @returns the staged file owned by this publisher.
   */
  stageEncodedFile(input: EncodedFileAttachment): Promise<StagedFileAttachment>
  /**
   * Retain references before the producer publishes them.
   * @param owner - durable producer.
   * @param refs - exact references.
   * @returns durable retention completion.
   */
  commitFileReferences(owner: FileReferenceOwner, refs: readonly FileAttachmentRef[]): Promise<void>
  /**
   * Release references after their producer becomes durably inaccessible.
   * @param owner - durably removed producer.
   * @returns durable release completion.
   */
  releaseFileReferences(owner: FileReferenceOwner): Promise<void>
  /**
   * Release a retired stage issued by this publisher.
   * @param ticket - stage this publisher issued.
   * @returns durable release completion.
   */
  releaseFileStage(ticket: FileStageTicket): Promise<void>
}

/** Private Host reader closure with no mutation operations. */
export interface FileReader {
  /**
   * Protect the complete output file set until release or cancellation.
   * @param refs - complete output file set.
   * @param signal - optional cancellation.
   * @returns a protected reader lease.
   */
  acquireFileReadLease(refs: readonly FileAttachmentRef[], signal?: AbortSignal): Promise<FileReadLease>
  /**
   * Read a protected stored file.
   * @param ref - exact stored file.
   * @param signal - optional cancellation.
   * @returns verified exact byte chunks.
   */
  readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array>
}

function ownsService(ctx: Context, key: string): boolean {
  const record = ctx.fiber.store?.[key]
  if (record?.fiber !== ctx.fiber || !(record.value instanceof Service) || record.name !== key) return false
  const owner: unknown = Reflect.get(original(record.value), 'ctx')
  return Context.is(owner) && owner.fiber === ctx.fiber
}

/**
 * Bind a private publisher to the fiber actually providing fileUploads or sessionPersistence.
 * The closure remains usable during its consumer's drain, then revokes and awaits outstanding calls.
 * @param ctx - owning producer context, after its Service constructor registered the service.
 * @param drain - producer-owned completion and staging cleanup, run before authority ends.
 * @returns the effect-owned publisher; an unrelated context is refused.
 */
export function bindFilePublisher(ctx: Context, drain: () => Promise<void>): FilePublisher {
  const sessions = ownsService(ctx, 'sessionPersistence')
  const uploads = ownsService(ctx, 'fileUploads')
  if (!sessions && !uploads) throw new AttachmentError('File publication requires an owning Host producer.', 'ATTACHMENT_FILES_UNSUPPORTED')
  const { run } = authorityFor(ctx, drain)
  const tickets = new Set<FileStageTicket>()
  const stage = async (method: 'stageFile' | 'stageFileStream', input: SaveFileAttachment | SaveFileStreamAttachment): Promise<StagedFileAttachment> => {
    if (!uploads) throw new AttachmentError('This producer cannot stage uploads.', 'ATTACHMENT_FILES_UNSUPPORTED')
    const staged = await run(method, [input], store => method === 'stageFile'
      ? store.stageFile(input as SaveFileAttachment)
      : store.stageFileStream(input as SaveFileStreamAttachment))
    tickets.add(staged.ticket)
    return staged
  }
  return Object.freeze({
    stageFile: (input: SaveFileAttachment) => stage('stageFile', input),
    stageFileStream: (input: SaveFileStreamAttachment) => stage('stageFileStream', input),
    stageEncodedFile: (input: EncodedFileAttachment) => stage('stageFile', decodedFileInput(input)),
    commitFileReferences: (owner: FileReferenceOwner, refs: readonly FileAttachmentRef[]) => {
      if (!sessions || owner.kind !== 'session') return Promise.reject(new AttachmentError('This producer cannot retain that owner.', 'ATTACHMENT_FILES_UNSUPPORTED'))
      return run('commitFileReferences', [owner, refs], store => store.commitFileReferences(owner, refs))
    },
    releaseFileReferences: (owner: FileReferenceOwner) => {
      if (!sessions || owner.kind !== 'session') return Promise.reject(new AttachmentError('This producer cannot release that owner.', 'ATTACHMENT_FILES_UNSUPPORTED'))
      return run('releaseFileReferences', [owner], store => store.releaseFileReferences(owner))
    },
    releaseFileStage: async (ticket: FileStageTicket) => {
      if (!uploads || !tickets.has(ticket)) throw new AttachmentError('This producer does not own that stage.', 'INVALID_ATTACHMENT_REF')
      await run('releaseFileStage', [ticket], store => store.releaseFileStage(ticket))
      tickets.delete(ticket)
    },
  })
}

/**
 * Bind protected reads to the fiber providing the actual Session-log export feature.
 * @param ctx - context owning the sessionLogExports Service registration.
 * @param drain - reader-owned completion and cancellation before authority ends.
 * @returns read-only file authority; an unrelated context is refused.
 */
export function bindFileReader(ctx: Context, drain: () => Promise<void>): FileReader {
  if (!ownsService(ctx, 'sessionLogExports')) throw new AttachmentError('File reads require an owning Host exporter.', 'ATTACHMENT_FILES_UNSUPPORTED')
  const { run, invoke } = authorityFor(ctx, drain)
  return Object.freeze({
    acquireFileReadLease: (refs: readonly FileAttachmentRef[], signal?: AbortSignal) =>
      run('acquireFileReadLease', [refs, signal], store => store.acquireFileReadLease(refs, signal)),
    readFileStream: (ref: FileAttachmentRef, signal?: AbortSignal) =>
      invoke('readFileStream', [ref, signal], store => store.readFileStream(ref, signal)),
  })
}

function authorityFor(ctx: Context, drain: () => Promise<void>) {
  let attachments = ctx.get('attachments')
  let active = true
  const running = new Set<Promise<unknown>>()
  let draining: Promise<void> | undefined
  const joinDrain = (): Promise<void> => {
    if (draining !== undefined) return draining
    const task = Promise.resolve().then(drain)
    draining = task
    void task.finally(() => { draining = undefined }).catch(() => {})
    return task
  }
  ctx.effect(() => async () => {
    try { await joinDrain() } finally {
      active = false
      await Promise.allSettled(running)
    }
  }, 'attachment.filePublisher')
  // An optional provider still needs a real Cordis dependent whose teardown the store can join.
  ctx.inject(['attachments'], (inner) => {
    attachments = inner.attachments
    inner.effect(() => joinDrain, 'attachment.filePublisher.providerDrain')
  })

  const invoke = <T>(method: FilePublisherMethod, args: readonly unknown[], perform: (store: AttachmentStore) => T): T => {
    if (!active) throw new AttachmentError('The file publisher is disposed.', 'ATTACHMENT_WRITE_FAILED')
    const store = ctx.get('attachments') ?? attachments
    if (store === undefined) throw new AttachmentError('File publication requires an attachment provider.', 'ATTACHMENT_FILES_UNSUPPORTED')
    const token = {}
    calls.set(token, { service: original(store), method, args, live: () => active })
    try { return current.run(token, () => perform(store)) } finally { calls.delete(token) }
  }
  const run = <T>(method: FilePublisherMethod, args: readonly unknown[], perform: (store: AttachmentStore) => Promise<T>): Promise<T> => {
    const operation = (async () => invoke(method, args, perform))()
    running.add(operation)
    void operation.finally(() => { running.delete(operation) }).catch(() => {})
    return operation
  }
  return { run, invoke }
}
