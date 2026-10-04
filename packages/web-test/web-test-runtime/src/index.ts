/**
 * The Web testing single domain writer (`ctx.webTestRuntime`): the one authority
 * every later test action passes through to read or change Web testing state.
 *
 * **One writer per control root.** The service claims the control root's Windows
 * named kernel object before it opens any authoritative domain, and it refuses
 * rather than degrading to a weaker guard. Claiming first is what makes the
 * domain safe to open: a second writer that got as far as an open domain would
 * already be able to publish a head.
 *
 * **Creation is a three-stage protocol, not one write.** Registering a project
 * commits a create intent in the catalog head (the resource identity and a
 * digest of the normalized parameters), then idempotently builds the child
 * record under that same identity, then publishes the entry point, the receipt,
 * and the notification in ONE further head write. An interruption after the
 * first or second stage leaves a reservation and possibly a child record that no
 * read can see, because visibility is the head's entry alone. A resend of the
 * same command token resumes from the registered intent with the same resource
 * identity; it never allocates a second one, and a token reused with different
 * parameters is refused.
 *
 * **Commit order.** A caller reads the committed version and does its long work
 * outside the queue, then enters a short serial queue and revalidates the
 * command token, the expected version, and the control generation before any
 * write. There are no cross-record transactions, and a project is already
 * published, so a commit cannot write the new content over the record a
 * published entry names and republish afterwards: the record KEEPS the revision
 * the head publishes and holds the next revision's content as a staged update
 * that no read consults; one head write then publishes the entry, the receipt,
 * and the notification together; a last record write folds the staged content in.
 * An interruption after the staged write leaves material the head does not
 * reference, and one after the head write leaves a staged update the head
 * publishes and every read still serves — never a published reference to a write
 * that did not happen, and never a published entry a read cannot answer from.
 *
 * **Both writes are replayable.** The staged update is content, not a claim: a
 * resend of the same command token stages it again, publishes it once, and folds
 * it in. The head's ledger of published update tokens, written by the same head
 * write as the entry it describes, is what a resend answers from, so an
 * interrupted commit is completed by sending the same command again and never
 * produces a second record, entry, or notification.
 *
 * **Strict reads.** Every stored record is validated at the durable boundary and
 * an invalid record rejects the open instead of being read as absent. A read
 * answers with the revision the head's entry names, from the record's own fields
 * or from the staged update the head has published and no record write has folded
 * in; a head naming a revision the record holds neither is refused rather than
 * served partially, because a partially-served entity is indistinguishable from a
 * real one.
 *
 * **A declaration is not a readiness claim.** `inspectProjectMetadata` compares a
 * published record's declared code root and entry URLs with what this host holds,
 * fact by fact, so a caller that reports readiness has to name the facts it
 * checked. It reads and writes nothing.
 *
 * @module @deepseek-ai/dsh-web-test-runtime
 */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import { parseEnvironmentDeclaration, parseRegisterProjectRequest, parseSubmitRecordRequest } from '@deepseek-ai/dsh-web-test-contracts/parse'
import type {
  CommandId, CommandReceipt, EnvironmentDeclaration, ProjectId, ProjectMetadata, RecordCommit, RecordId, Revision,
} from '@deepseek-ai/dsh-web-test-contracts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type { ValidatedProjectRegistration, ValidatedRecordSubmission } from '@deepseek-ai/dsh-web-test-contracts/types'
import { DomainFacility, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import type { AtomicRenamePolicy } from '@deepseek-ai/dsh-atomic-write'
import type {} from '@deepseek-ai/dsh-storage'
import { controlLockName, prepareControlRoot, resolveDataGeneration } from './control-root.ts'
import { WebTestRuntimeError } from './errors.ts'
import { ControlRootLock } from './lock.ts'
import { recordIdOf, webTestDomain } from './spec.ts'
import type { CatalogHead, CatalogNotification, CreateIntent, StoredEnvironment, StoredProject, UpdateIntent } from './spec.ts'
import { observeEntryUrl } from './reachability.ts'
import type { StoredEntryUrlProbe } from './reachability.ts'
import { EMPTY_PROTOTYPE_COMPOSITION_HASH, readPersistentActivity } from './persistent-activity.ts'
import type { PersistentActivitySnapshot } from './persistent-activity.ts'
import { assertPrototypeAuthority, PrototypeActivityStore, resolveControlWritePolicy } from './recovery.ts'
import type { PrototypeAuthority, PrototypePauseReceipt } from './recovery.ts'
import type { PrototypeActivityCut, PrototypeBusinessIntent, PrototypeNotExecutedReceipt, PrototypeOperation, PrototypeOperationId, PrototypeRunHead, PrototypeRunId } from './recovery-spec.ts'

export { EMPTY_PROTOTYPE_COMPOSITION_HASH, readPersistentActivity } from './persistent-activity.ts'
export { WebTestPrototypeControl } from './prototype-control.ts'
export type { PersistentActivitySnapshot } from './persistent-activity.ts'
export { RecoveryCoordinator, checkPrototypeExecutorFormat, checkPrototypeFormat1, checkPrototypeFormat3, issuePrototypeAuthority, issueRecoveryAuthority, resolveControlWritePolicy } from './recovery.ts'
export type { PrototypeAuthority, PrototypePauseReceipt, RecoveryAuthority } from './recovery.ts'
export { prototypeActivitySchema, prototypeIntentSchema, prototypeNotExecutedReceiptSchema, prototypeOperationSchema, prototypeRunSchema, PROTOTYPE_ACTIVITY_FILENAME } from './recovery-spec.ts'
export type { FrozenRunManifest, PrototypeActivityCut, PrototypeBusinessIntent, PrototypeNotExecutedReceipt, PrototypeOperation, PrototypeOperationId, PrototypeRunHead, PrototypeRunId, RecoveryUpdateIntent } from './recovery-spec.ts'

export { aclSizeFor, acquireControlSemaphore, CONTROL_CONTENTION, Win32ControlError } from './win32-control-semaphore.ts'
export { canonicalizeControlRoot, controlLockName, resolveDataGeneration } from './control-root.ts'
export { WebTestRuntimeError } from './errors.ts'
export { inspectProjectMetadata } from './inspection.ts'
export type { MaterialCheck, MaterialState, ProjectInspection } from './inspection.ts'
export type { EntryUrlObservation, StoredEntryUrlProbe } from './reachability.ts'
export type { WebTestRuntimeErrorCode } from './errors.ts'
export { ControlRootLock } from './lock.ts'
export {
  emptyCatalogHead, recordIdOf, webTestDomain, WEB_TEST_UNIT, WEB_TEST_UNIT_VERSION,
} from './spec.ts'
export type {
  CatalogHead, CatalogNotification, CreateIntent, PublishedEntry, StagedUpdate, StoredEnvironment, StoredProject, UpdateIntent,
} from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTestRuntime: WebTestRuntime
  }
  interface Events {
    /**
     * A project revision has become durable and visible through the catalog head.
     * @param projectId - published project identity.
     * @param revision - its committed metadata revision.
     * @mode parallel
     */
    'web-test/project-published'(projectId: ProjectId, revision: Revision): void
  }
}

/**
 * Plugin config. The control root is stated by the composition rather than defaulted: a
 * `process.cwd()`-relative fallback would put two installations' writers on the
 * same object, or an installed copy's writer somewhere the user cannot see.
 */
export interface Config {
  /** Stable directory holding the data-generation pointer; its resolved identity decides the write lock. */
  controlRoot: string
  /** Use the composition's domain route or a dedicated backend under the locked data generation. */
  storageMode?: 'configured' | 'generation-json'
  /** Complete deadline for each registered entry URL's HEAD request, in milliseconds. */
  entryUrlProbeTimeoutMs?: number
  /** Delays before atomic publication retries on Windows; [] permits one rename attempt. */
  windowsRenameDelaysMs?: number[]
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config, Config & { entryUrlProbeTimeoutMs: number; windowsRenameDelaysMs: number[] }> = z.object({
  controlRoot: z.string().required(),
  storageMode: z.union([z.const('configured'), z.const('generation-json')]).default('configured'),
  entryUrlProbeTimeoutMs: z.number().min(1).max(60_000).step(1).default(10_000),
  windowsRenameDelaysMs: z.array(z.natural()).default([20, 40, 80, 160]),
})

/** The control root's resolved identity and the generation the pointer selects. */
export interface ControlIdentity {
  /** Alias-resolved, case-folded control-root path. */
  readonly controlRoot: string
  /** Full object name of the Windows kernel lock claimed by this writer. */
  readonly lockName: string
  /** Monotonic data generation the pointer currently selects. */
  readonly generation: number
  /** Absolute path of that generation's data directory. */
  readonly dataRoot: string
}

/**
 * The part of a project's metadata a caller may change, projected from the
 * contract's own `ProjectMetadata` so the writable fields have one declaration.
 */
export type ProjectMetadataUpdate = Omit<ProjectMetadata, 'projectId' | 'revision'>

/**
 * One project's committed version as a caller read it, before any long work.
 *
 * The value is produced outside the commit queue on purpose: attachment and
 * other long I/O happens while the serial queue keeps serving other commands,
 * and the queue re-checks `expectedRevision` before it commits anything, so a
 * caller whose read went stale is refused instead of overwriting a change it
 * never saw. The data generation is deliberately not part of the cut: this
 * writer holds the control root's lock for its whole life, so no second writer
 * can repoint the data generation underneath it and there is nothing to
 * revalidate.
 */
export interface PreparedProjectUpdate {
  /** The project the change targets. */
  readonly projectId: ProjectId
  /** The record identity the submission must address. */
  readonly recordId: RecordId
  /** The revision the caller read. */
  readonly expectedRevision: Revision
}

/** One project's durable record and the revision of it the catalog head publishes. */
interface PublishedProject {
  /** The stored record, carrying any staged update a read must not see. */
  readonly record: StoredProject
  /** The metadata the head's entry names, whether folded into the record or staged on it. */
  readonly published: ProjectMetadata
}

/** One validated update a commit stages, publishes, and folds in. */
interface StagedCommit {
  /** The command token the ledger answers a resend from. */
  readonly commandId: CommandId
  /** The project the change targets. */
  readonly projectId: ProjectId
  /** Digest of the content this commit publishes, so a resend is told from a different change. */
  readonly parametersHash: string
  /** The content this commit publishes. */
  readonly metadata: ProjectMetadataUpdate
  /** The published revision the change is expressed against. */
  readonly baseRevision: Revision
}

const noop = (): void => {}
const prototypeStores = new WeakMap<object, PrototypeActivityStore>()

/**
 * Resolve the private store after verifying its current producer authority.
 * Runtime init registers the store before Cordis exposes an ACTIVE provider;
 * authority verification requires that provider, and lookup runs without an await.
 * Store registrations remain for the provider's lifetime, including raw Service calls.
 * @param provider - Runtime instance or its Cordis traceable proxy.
 * @param authority - Opaque authority bound to the current Runtime and producer.
 * @returns the store registered by the authorized provider's completed init.
 */
function authorizedPrototypeStore(provider: WebTestRuntime, authority: PrototypeAuthority): PrototypeActivityStore {
  assertPrototypeAuthority(provider, authority)
  const original: unknown = Reflect.get(provider, Symbol.for('cordis.original'))
  return prototypeStores.get(typeof original === 'object' && original !== null ? original : provider) as PrototypeActivityStore
}

/**
 * Allocate the resource identity a command token reserves.
 *
 * Deriving it from the token is what makes an interrupted creation resumable:
 * the resumed attempt computes the same identity, so completing a reservation
 * cannot leave two projects for one command.
 * @param commandId - the command token registering the creation.
 * @returns the reserved project identity.
 */
function reserveProjectId(commandId: CommandId): ProjectId {
  const digest = createHash('sha256').update(`webtest:project:${commandId}`, 'utf8').digest('hex')
  return brandString<ProjectId>(`project-${digest.slice(0, 32)}`)
}

/**
 * Digest the normalized parameters a command committed under, so a resend can
 * be told apart from a different command reusing the same token.
 * @param kind - which command published the parameters, so one token's
 * registration and its update are never the same digest.
 * @param parameters - the normalized code roots and entry URLs.
 * @returns the SHA-256 hex digest of the normalized parameters.
 */
function hashCommandParameters(
  kind: 'registerProject' | 'commitProjectUpdate',
  parameters: { codeRoots: string[]; entryUrls: string[] },
): string {
  const normalized = { kind, codeRoots: parameters.codeRoots, entryUrls: parameters.entryUrls }
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex')
}

/**
 * The metadata one project's record carries at the revision the head publishes.
 *
 * The record answers with its own fields, or with the staged update the head has
 * published and no record write has folded in yet; a head naming a revision the
 * record holds neither is refused, because serving a neighbouring revision would
 * be indistinguishable from a real one.
 * @param record - the stored record behind the entry.
 * @param projectId - the project the entry names.
 * @param publishedRevision - the revision the catalog head's entry names.
 * @returns the metadata published at that revision.
 * @throws {WebTestRuntimeError} `record-unpublished` when the record holds neither revision.
 */
function contentAt(record: StoredProject, projectId: ProjectId, publishedRevision: Revision): ProjectMetadata {
  if (record.revision === publishedRevision) {
    return {
      projectId: record.projectId,
      revision: record.revision,
      codeRoots: record.codeRoots,
      entryUrls: record.entryUrls,
    }
  }
  const staged = record.pending
  if (staged !== null && staged.revision === publishedRevision) {
    return {
      projectId: record.projectId,
      revision: staged.revision,
      codeRoots: staged.codeRoots,
      entryUrls: staged.entryUrls,
    }
  }
  throw new WebTestRuntimeError(
    'web-test/record-unpublished',
    `catalog head publishes project '${projectId}' at revision ${String(publishedRevision)}, `
    + `but the stored record is at revision ${String(record.revision)}`,
  )
}

/**
 * The Web testing persistence authority. Opens the `webtest` domain behind the
 * control-root write lock, publishes every change through the catalog head, and
 * serves strict reads of the published projects.
 */
export class WebTestRuntime extends Service {
  static inject = ['storageDomain', 'storage']

  static Config = Config

  private domain?: Domain<typeof webTestDomain>

  private identityValue?: ControlIdentity

  /** Tail of the single serial commit queue; every link settles for its caller. */
  private queue: Promise<void> = Promise.resolve()

  private readonly probeLifetime = new AbortController()

  private readonly probes = new Set<Promise<StoredEntryUrlProbe>>()

  private readonly entryUrlProbeTimeoutMs: number
  private readonly controlWritePolicy: AtomicRenamePolicy

  /**
   * @param ctx - Context of the Runtime plugin; the lock and domain disposers attach here.
   * @param config - Validated plugin config naming the control root.
   */
  constructor(ctx: Context, public config: Config) {
    super(ctx, 'webTestRuntime')
    const resolved = Config(config)
    this.entryUrlProbeTimeoutMs = resolved.entryUrlProbeTimeoutMs
    this.controlWritePolicy = resolveControlWritePolicy(resolved.windowsRenameDelaysMs)
  }

  /** Claim the control root, resolve its data generation, then open the domain. */
  protected async [Service.init](): Promise<void> {
    const preparedRoot = await prepareControlRoot(this.config.controlRoot)
    const controlRoot = preparedRoot.canonicalRoot
    const lockName = controlLockName(controlRoot)
    // The lock is taken before any authoritative open and released only after the
    // domain has closed. Both halves live in one disposer and run in sequence:
    // a fiber awaits sibling disposers through `Promise.all`
    // (`vendor/cordis/src/fiber.ts:676`), so two effects would be invoked in
    // reverse order but awaited concurrently — the synchronous `lock.release()`
    // would return while `domain.close()` was still draining its write queue,
    // and a successor could claim the root and read a half-written unit.
    const lock = await ControlRootLock.acquire(lockName)
    let backend: JsonStorageBackend | undefined
    let unregister: (() => void) | undefined
    try {
      let initialStore: PrototypeActivityStore | undefined
      const generation = await resolveDataGeneration(controlRoot, {
        rootCreated: preparedRoot.created,
        initialize: async (initialGeneration) => {
          initialStore = new PrototypeActivityStore(this.ctx, initialGeneration.dataRoot, this.controlWritePolicy)
          await initialStore.initialize({
            format: 3, compositionHash: EMPTY_PROTOTYPE_COMPOSITION_HASH, revision: 1, executor: 'active', runs: [],
          })
        },
      })
      this.identityValue = { controlRoot, lockName, ...generation }
      const prototypeActivity = initialStore ?? new PrototypeActivityStore(this.ctx, generation.dataRoot, this.controlWritePolicy)
      await prototypeActivity.hydrate()
      prototypeStores.set(this, prototypeActivity)
      let facility = this.ctx.storageDomain
      if (this.config.storageMode === 'generation-json') {
        backend = new JsonStorageBackend(generation.dataRoot, this.controlWritePolicy)
        const backendName = 'web-test-generation-json'
        unregister = this.ctx.storage.backend.register(backendName, backend)
        facility = new DomainFacility(this.ctx, { backend: backendName })
      }
      const domain = await facility.open(webTestDomain)
      this.ctx.effect(() => async () => {
        try {
          this.probeLifetime.abort()
          await Promise.allSettled([...this.probes])
          await prototypeActivity.close()
          await domain.close()
          await backend?.close()
        }
        finally {
          unregister?.()
          lock.release()
        }
      }, 'webTestRuntime.closeThenRelease')
      this.domain = domain
    }
    catch (error) {
      try {
        await backend?.close()
      }
      finally {
        unregister?.()
        lock.release()
      }
      throw error
    }
  }

  /**
   * The control root this writer claimed and the generation it resolved. Read
   * only after init; a caller uses it to route the storage backend at the same
   * data root the lock identity describes.
   * @returns the claimed control identity.
   */
  identity(): ControlIdentity {
    /* v8 ignore next -- Service.init assigns the identity before the service becomes injectable */
    if (this.identityValue === undefined) throw new Error('web testing runtime is not initialized')
    return this.identityValue
  }

  /**
   * Read cold durable prototype activity, without loading Sessions or writing.
   * @returns committed heads and explicit completeness errors.
   */
  readPersistentActivity(): Promise<PersistentActivitySnapshot> {
    return readPersistentActivity(this.identity().controlRoot)
  }

  /**
   * Explicitly register the bounded M0 prototype domain, including an empty cut.
   * @param cut - format-3 initial committed heads; an existing cut is never overwritten.
   * @param authority - private authority held by the actual prototype producer.
   * @returns after the initial cut is committed under this Runtime's lock.
   */
  initializePrototypeActivity(cut: PrototypeActivityCut, authority: PrototypeAuthority): Promise<void> {
    const store = authorizedPrototypeStore(this, authority)
    return store.initialize(cut)
  }

  /**
   * Register a bounded run on the same durable queue as operation admission.
   * @param run - Initial running or paused head, with revision one and no operations.
   * @param actualCompositionHash - Business composition digest bound by the first registration.
   * @param authority - Private authority held by the actual prototype producer.
   * @returns after registration is committed without replacing any existing head.
   */
  registerPrototypeRun(run: PrototypeRunHead, actualCompositionHash: string, authority: PrototypeAuthority): Promise<void> {
    const store = authorizedPrototypeStore(this, authority)
    return store.registerRun(run, actualCompositionHash)
  }

  /**
   * Commit a single prototype dispatch admission before any external operation.
   * @param runId - original registered running batch.
   * @param operationId - original operation identity.
   * @param intent - normalized business intent, independent of run/command identity.
   * @param authority - private authority held by the actual prototype producer.
   * @returns the ISSUED record; repeated intent, pause and recovery-only reject.
   */
  admitPrototypeOperation(
    runId: PrototypeRunId, operationId: PrototypeOperationId, intent: PrototypeBusinessIntent, authority: PrototypeAuthority,
  ): Promise<PrototypeOperation> {
    const store = authorizedPrototypeStore(this, authority)
    return store.admit(runId, operationId, intent)
  }

  /**
   * Preserve an original operation's uncertain outcome without settling it.
   * @param operationId - original admitted operation identity.
   * @param authority - private authority held by the actual prototype producer.
   * @returns after the UNKNOWN cut is committed.
   */
  markPrototypeOperationUnknown(operationId: PrototypeOperationId, authority: PrototypeAuthority): Promise<void> {
    const store = authorizedPrototypeStore(this, authority)
    return store.markUnknown(operationId)
  }

  /**
   * Commit success only after the trusted consumer observes the original operation's successful acknowledgement.
   * @param operationId - Original ISSUED identity; UNKNOWN cannot be promoted to success.
   * @param authority - Private authority held by the current trusted prototype producer.
   * @returns after completion is durable; this method performs no business I/O or whole-run settlement.
   */
  markPrototypeOperationCompleted(operationId: PrototypeOperationId, authority: PrototypeAuthority): Promise<void> {
    const store = authorizedPrototypeStore(this, authority)
    return store.markCompleted(operationId)
  }

  /**
   * Commit confirmed browser non-execution for its original issued operation.
   * @param operationId - Original ISSUED identity; UNKNOWN cannot settle.
   * @param receipt - Trusted producer's current tool-call and verified wire denial association.
   * @param authority - Private authority held by the current trusted prototype producer.
   * @returns after NOT_EXECUTED and the full receipt are committed; repeated intent stays forbidden.
   */
  markPrototypeOperationNotExecuted(
    operationId: PrototypeOperationId, receipt: PrototypeNotExecutedReceipt, authority: PrototypeAuthority,
  ): Promise<void> {
    const store = authorizedPrototypeStore(this, authority)
    return store.markNotExecuted(operationId, receipt)
  }

  /**
   * Close this run's gate synchronously and durably preserve its pause request.
   * @param runId - Registered unfinished batch; UNKNOWN identity and references remain unchanged.
   * @param authority - Private authority held by the current trusted prototype producer.
   * @returns after atomic publication, with the committed cut and head revisions.
   */
  pausePrototypeRun(runId: PrototypeRunId, authority: PrototypeAuthority): Promise<PrototypePauseReceipt> {
    const store = authorizedPrototypeStore(this, authority)
    return store.pause(runId)
  }

  /**
   * Check the current run gate after every await and immediately before business I/O.
   * @param runId - Registered run whose durable head grants ordinary admission.
   * @param authority - Private authority held by the current trusted prototype producer.
   * @returns after validation; no admission, resume or business operation is performed.
   */
  assertPrototypeRunDispatchable(runId: PrototypeRunId, authority: PrototypeAuthority): void {
    const store = authorizedPrototypeStore(this, authority)
    store.assertDispatchable(runId)
  }

  /**
   * Disable new prototype admissions and persist revocation before shutdown.
   * @param authority - private authority held by the actual prototype producer.
   * @returns after prior admissions drain and the committed executor is revoked.
   */
  revokePrototypeDispatch(authority: PrototypeAuthority): Promise<void> {
    const store = authorizedPrototypeStore(this, authority)
    return store.revoke()
  }

  /**
   * Register one project, or return the receipt the same command already earned.
   *
   * The first call commits a reservation, builds the child record, and publishes
   * the entry; a resend with the same token and the same parameters returns that
   * first receipt without writing anything, and a resend with different
   * parameters is refused. An attempt interrupted after the reservation resumes
   * from it under the same resource identity.
   * @param request - raw registration request; the contract parser validates every field.
   * @returns the receipt for the committed, published project.
   * @throws {WebTestRuntimeError} `command-token-reuse` when the token registered other parameters.
   */
  async registerProject(request: Record<string, unknown>): Promise<CommandReceipt> {
    const registration = parseRegisterProjectRequest(request)
    const parametersHash = hashCommandParameters('registerProject', registration)
    return this.enqueue(() => this.createProject(registration, parametersHash))
  }

  /**
   * Read one project's committed version for a change made outside the queue.
   *
   * This performs no I/O: it reads the domain's in-memory state, which is the
   * same state every commit published. The value it returns is what
   * {@link commitProjectUpdate} revalidates.
   * @param projectId - the project the caller intends to change.
   * @returns the read cut a commit will be accepted against.
   * @throws {WebTestRuntimeError} `record-unpublished` when the project has no published entry.
   */
  prepareProjectUpdate(projectId: ProjectId): PreparedProjectUpdate {
    const record = this.requireProject(projectId)
    return {
      projectId,
      recordId: recordIdOf(projectId),
      expectedRevision: record.revision,
    }
  }

  /**
   * Commit one prepared project change.
   *
   * The submission is validated by the contract parser, then the serial queue
   * rechecks the expected revision against committed state before writing. A
   * stale read is refused rather than applied, so long I/O outside the queue
   * cannot silently overwrite a change the caller never saw. The commit is three
   * writes — stage the content on the record, publish the entry with one head
   * write, fold the content in — and a resend of the same command token answers
   * from the head's ledger, so an interrupted commit is completed by sending the
   * same command again rather than by a fresh read cut.
   * @param request - raw submission request; the contract parser validates every field.
   * @param prepared - the read cut from {@link prepareProjectUpdate}.
   * @param metadata - the code root and entry URLs the project should carry.
   * @param condition - optional conversation association and synchronous live-owner check,
   * checked inside the write queue and before publication.
   * @returns the committed record identity and the revision the committer accepted.
   * @throws {WebTestRuntimeError} `record-mismatch` when the submission addresses
   * another record, `stale-revision` when the prepared cut no longer holds, or
   * `command-token-reuse` when the token already published another change.
   */
  async commitProjectUpdate(
    request: Record<string, unknown>,
    prepared: PreparedProjectUpdate,
    metadata: ProjectMetadataUpdate,
    condition?: { readonly sessionId: SessionId; readonly projectId: ProjectId; readonly assertCurrent: () => void },
  ): Promise<RecordCommit> {
    const submission = parseSubmitRecordRequest(request)
    if (submission.recordId !== prepared.recordId) {
      throw new WebTestRuntimeError(
        'web-test/record-mismatch',
        `submission addresses record '${submission.recordId}', which is not project '${prepared.projectId}'`,
      )
    }
    if (submission.expectedRevision !== prepared.expectedRevision) {
      throw new WebTestRuntimeError(
        'web-test/stale-revision',
        `submission expects revision ${String(submission.expectedRevision)}, `
        + `but the prepared cut is at revision ${String(prepared.expectedRevision)}`,
      )
    }
    const parametersHash = hashCommandParameters('commitProjectUpdate', metadata)
    return this.enqueue(async () => {
      const assertCurrent = condition === undefined ? undefined : () => {
        if (condition.projectId !== prepared.projectId || this.readSessionProject(condition.sessionId) !== condition.projectId) {
          throw new WebTestRuntimeError('web-test/record-mismatch', 'The conversation selected another project before its metadata correction committed')
        }
        condition.assertCurrent()
      }
      assertCurrent?.()
      const ledger = this.requireDomain().global.get().updates[submission.commandId]
      if (ledger !== undefined) return this.resumeUpdate(ledger, submission, parametersHash)
      return this.applyUpdate({
        commandId: submission.commandId,
        projectId: prepared.projectId,
        parametersHash,
        metadata,
        baseRevision: prepared.expectedRevision,
      }, assertCurrent)
    })
  }

  /**
   * Read one published project.
   *
   * Visibility is the catalog head's entry, not the record's existence: a
   * reserved or half-built project has a durable record and is still absent
   * here, so no consumer can pick up an entity whose creation never completed.
   * @param projectId - the project to read.
   * @returns the project's committed metadata, or `undefined` when no entry is published.
   * @throws {WebTestRuntimeError} `record-unpublished` when the head publishes an entry the records do not support.
   */
  readProject(projectId: ProjectId): ProjectMetadata | undefined {
    if (this.requireDomain().global.get().entries[projectId] === undefined) return undefined
    return this.requireProject(projectId)
  }

  /**
   * List every published project.
   * @returns the committed metadata of each published project.
   * @throws {WebTestRuntimeError} `record-unpublished` when the head publishes an entry the records do not support.
   */
  listProjects(): ProjectMetadata[] {
    return Object.values(this.requireDomain().global.get().entries)
      .map(entry => this.requireProject(entry.projectId))
  }

  /**
   * Save the project explicitly selected by one session, after verifying it is published.
   * @param sessionId - the official session identity.
   * @param projectId - the published project selected by the user.
   * @returns resolution after the association is durable; no authorization is saved.
   */
  async saveSessionProject(sessionId: SessionId, projectId: ProjectId): Promise<void> {
    await this.enqueue(async () => {
      this.requirePublished(projectId)
      await this.requireDomain().table('sessions').put(sessionId, { sessionId, projectId })
    })
  }

  /**
   * Read a saved session selection without restoring a declaration or permission.
   * @param sessionId - the official session identity to read.
   * @returns the published project identity, or undefined for an unassociated session.
   * @throws {WebTestRuntimeError} when the saved record names a different session or unpublished project.
   */
  readSessionProject(sessionId: SessionId): ProjectId | undefined {
    const record = this.requireDomain().table('sessions').get(sessionId)
    if (record === undefined) return undefined
    if (record.sessionId !== sessionId) {
      throw new WebTestRuntimeError('web-test/record-mismatch', 'Saved project association names a different session')
    }
    this.requirePublished(record.projectId)
    return record.projectId
  }

  /**
   * Save user-stated environment facts against the currently published project revision.
   * @param projectId - the project the user described.
   * @param declaration - declared roots, URL, login, and supplementary requirements.
   * @param revision - published revision the declaration describes.
   * @returns resolution after durability; confirmation and authorization remain process-local.
   * @throws {WebTestRuntimeError} when the revision or declared roots and URL do not match the project.
   */
  async saveEnvironment(projectId: ProjectId, declaration: EnvironmentDeclaration, revision: Revision): Promise<void> {
    const parsed = parseEnvironmentDeclaration(declaration, 'declaration')
    await this.enqueue(async () => {
      const { published } = this.requirePublished(projectId)
      if (published.revision !== revision) {
        throw new WebTestRuntimeError('web-test/stale-revision', 'The project changed before its declaration was saved')
      }
      if (parsed.codeRoots.length !== published.codeRoots.length
        || !parsed.codeRoots.every(root => published.codeRoots.includes(root))
        || (parsed.entryUrl !== null && !published.entryUrls.includes(parsed.entryUrl))) {
        throw new WebTestRuntimeError('web-test/record-mismatch', 'The declaration must cover the published project roots and URL')
      }
      await this.requireDomain().table('environments').put(projectId, { revision, declaration: parsed })
    })
  }

  /**
   * Read saved user facts, including stale facts for display, without treating them as permission.
   * @param projectId - the published project to read.
   * @returns an owned copy of the declaration and its revision, or undefined if none was saved.
   */
  readEnvironment(projectId: ProjectId): StoredEnvironment | undefined {
    this.requirePublished(projectId)
    const stored = this.requireDomain().table('environments').get(projectId)
    return stored === undefined ? undefined : structuredClone(stored)
  }

  /**
   * Explicitly observe all URLs registered at one published revision, then save once.
   * No target may be supplied by the caller; redirects and credentials are never followed.
   * Cancellation saves cancelled findings for the remaining targets. Disposal waits for
   * requests and the durable write to settle before closing storage.
   * @param projectId - published project to observe.
   * @param expectedRevision - revision whose registered targets the caller selected.
   * @param signal - optional caller cancellation, including a model tool's signal.
   * @returns the durable observation; HTTP errors remain responses with their status.
   * @throws {WebTestRuntimeError} if the revision changes before observation or publication.
   */
  async probeEntryUrls(projectId: ProjectId, expectedRevision: Revision, signal?: AbortSignal): Promise<StoredEntryUrlProbe> {
    this.probeLifetime.signal.throwIfAborted()
    const project = this.requireProject(projectId)
    if (project.revision !== expectedRevision) {
      throw new WebTestRuntimeError('web-test/stale-revision', 'The project changed before its entry URLs were checked')
    }
    const cancellation = signal === undefined ? this.probeLifetime.signal
      : AbortSignal.any([signal, this.probeLifetime.signal])
    const operation = (async (): Promise<StoredEntryUrlProbe> => {
      const entryUrls: StoredEntryUrlProbe['entryUrls'][number][] = []
      // The registration parser bounds this list; requests run one at a time.
      for (const declared of project.entryUrls) {
        entryUrls.push(await observeEntryUrl(declared, this.entryUrlProbeTimeoutMs, cancellation))
      }
      const stored: StoredEntryUrlProbe = {
        projectId, revision: expectedRevision, checkedAt: new Date().toISOString(), entryUrls,
      }
      await this.enqueue(async () => {
        if (this.requireProject(projectId).revision !== expectedRevision) {
          throw new WebTestRuntimeError('web-test/stale-revision', 'The project changed while its entry URLs were being checked')
        }
        await this.requireDomain().table('entry_url_probes').put(projectId, stored)
      })
      return structuredClone(stored)
    })()
    this.probes.add(operation)
    try {
      return await operation
    } finally {
      this.probes.delete(operation)
    }
  }

  /**
   * Read the latest saved URL observation, including an older revision for display.
   * This never requests a URL or restores environment confirmation.
   * @param projectId - published project whose observation is read.
   * @returns an owned saved value, or undefined when URLs have never been checked.
   * @throws {WebTestRuntimeError} when saved identity or registered addresses disagree.
   */
  readEntryUrlProbe(projectId: ProjectId): StoredEntryUrlProbe | undefined {
    const project = this.requireProject(projectId)
    const stored = this.requireDomain().table('entry_url_probes').get(projectId)
    if (stored === undefined) return undefined
    if (stored.projectId !== projectId || stored.revision > project.revision
      || (stored.revision === project.revision && (stored.entryUrls.length !== project.entryUrls.length
        || stored.entryUrls.some((entry, index) => entry.declared !== project.entryUrls[index])))) {
      throw new WebTestRuntimeError('web-test/record-mismatch', 'Saved entry URL observations do not match their published project revision')
    }
    return structuredClone(stored)
  }

  /**
   * The notifications committed after the last acknowledgement, in sequence order.
   *
   * They are read from the same head write that published the entry they
   * describe, so a notification never exists for a commit that did not land and
   * never goes missing for one that did.
   * @returns the undelivered notifications.
   */
  pendingNotifications(): readonly CatalogNotification[] {
    return this.requireDomain().global.get().notifications
  }

  /**
   * Drop every notification up to and including `sequence`.
   *
   * Acknowledgement is a head write, not a table delete, so a consumer that
   * acknowledges and crashes cannot leave a notification it already handled
   * queued for redelivery, nor drop one it never saw.
   * @param sequence - the highest notification sequence the consumer has handled.
   * @returns resolution after the acknowledging head write.
   */
  async acknowledgeNotifications(sequence: number): Promise<void> {
    await this.enqueue(async () => {
      const head = this.requireDomain().global.get()
      const remaining = head.notifications.filter(notification => notification.sequence > sequence)
      if (remaining.length === head.notifications.length) return
      await this.publishHead({ ...head, headRevision: head.headRevision + 1, notifications: remaining })
    })
  }

  /**
   * Stage 1 of the update protocol: revalidate the prepared cut, then stage the
   * new content on the record the head already publishes.
   *
   * Nothing here changes what any read returns, so an interruption between this
   * write and the head write leaves the project exactly as published.
   */
  private async stageUpdate(commit: StagedCommit): Promise<Revision> {
    const { published } = this.requirePublished(commit.projectId)
    if (published.revision !== commit.baseRevision) {
      throw new WebTestRuntimeError(
        'web-test/stale-revision',
        `project '${commit.projectId}' is at revision ${String(published.revision)}, not the expected ${String(commit.baseRevision)}`,
      )
    }
    // A previously published staged update is folded in first: the record's own
    // revision is what the next staged revision is expressed against, and the
    // head must keep naming a revision the record can still answer from.
    const record = await this.foldStagedUpdate(commit.projectId)
    const acceptedRevision = brandNumber<Revision>(record.revision + 1)
    await this.requireDomain().table('projects').put(commit.projectId, {
      ...record,
      pending: {
        revision: acceptedRevision,
        codeRoots: commit.metadata.codeRoots,
        entryUrls: commit.metadata.entryUrls,
      },
    })
    return acceptedRevision
  }

  /**
   * Stages 2 and 3 of the update protocol: publish the entry, the receipt, and
   * the notification in ONE head write, then fold the published content into the
   * record's own fields.
   *
   * The head write is the commit point, so an interruption after it leaves a
   * staged update the head publishes and every read serves; the fold that follows
   * only moves that content into the fields a later update will build on.
   */
  private async publishUpdate(commit: StagedCommit, acceptedRevision: Revision): Promise<RecordCommit> {
    const head = this.requireDomain().global.get()
    const publishedAt = new Date().toISOString()
    const notification: CatalogNotification = {
      sequence: head.notificationSequence + 1,
      kind: 'project-published',
      projectId: commit.projectId,
      metadataRevision: acceptedRevision,
      publishedAt,
    }
    const ledger: UpdateIntent = {
      commandId: commit.commandId,
      projectId: commit.projectId,
      parametersHash: commit.parametersHash,
      targetRevision: acceptedRevision,
    }
    await this.publishHead({
      ...head,
      headRevision: head.headRevision + 1,
      entries: {
        ...head.entries,
        [commit.projectId]: { projectId: commit.projectId, metadataRevision: acceptedRevision, publishedAt },
      },
      updates: { ...head.updates, [commit.commandId]: ledger },
      notifications: [...head.notifications, notification],
      notificationSequence: notification.sequence,
    })
    await this.foldStagedUpdate(commit.projectId)
    return { recordId: recordIdOf(commit.projectId), acceptedRevision }
  }

  /**
   * The whole update protocol: stage, publish, fold.
   *
   * A caller that never reached the head write is answered by the same command
   * being resent, and the record's staged content is what it resumes from.
   */
  private async applyUpdate(commit: StagedCommit, assertCurrent?: () => void): Promise<RecordCommit> {
    const acceptedRevision = await this.stageUpdate(commit)
    assertCurrent?.()
    return this.publishUpdate(commit, acceptedRevision)
  }

  /**
   * Answer a resend of a token that already published an update.
   *
   * The ledger row was written by the same head write as the entry it describes,
   * so the receipt is the one the first attempt earned. The only work left is the
   * fold, which writes no entry and appends no notification.
   * @param ledger - the row the head committed for this command token.
   * @param submission - the validated submission being answered.
   * @param parametersHash - digest of the content this submission would publish.
   * @returns the receipt the first attempt earned.
   * @throws {WebTestRuntimeError} `command-token-reuse` when the token published
   * another project or another content.
   */
  private async resumeUpdate(
    ledger: UpdateIntent,
    submission: ValidatedRecordSubmission,
    parametersHash: string,
  ): Promise<RecordCommit> {
    const recordId = recordIdOf(ledger.projectId)
    if (submission.recordId !== recordId) {
      throw new WebTestRuntimeError(
        'web-test/command-token-reuse',
        `command '${ledger.commandId}' already published a change to project '${ledger.projectId}'`,
      )
    }
    if (ledger.parametersHash !== parametersHash) {
      throw new WebTestRuntimeError(
        'web-test/command-token-reuse',
        `command '${ledger.commandId}' already published a change with different parameters`,
      )
    }
    await this.foldStagedUpdate(ledger.projectId)
    return { recordId, acceptedRevision: ledger.targetRevision }
  }

  /**
   * Fold a staged update the head has already published into the record's own
   * fields, and clear the staged slot. No write when nothing is staged, or when
   * the head still publishes the record's own revision — a staged update nothing
   * published is the resume point of an interrupted commit, not garbage.
   */
  private async foldStagedUpdate(projectId: ProjectId): Promise<StoredProject> {
    const { record, published } = this.requirePublished(projectId)
    const staged = record.pending
    if (staged === null || staged.revision !== published.revision) return record
    const folded: StoredProject = {
      projectId: record.projectId,
      revision: staged.revision,
      codeRoots: staged.codeRoots,
      entryUrls: staged.entryUrls,
      pending: null,
    }
    await this.requireDomain().table('projects').put(projectId, folded)
    return folded
  }

  /**
   * Stage 1: commit the reservation the rest of the protocol completes.
   *
   * The head write happens before the child record exists, so an interruption
   * right after it is the case recovery resumes from.
   */
  private async createProject(
    registration: ValidatedProjectRegistration,
    parametersHash: string,
  ): Promise<CommandReceipt> {
    const head = this.requireDomain().global.get()
    const existing = head.intents[registration.commandId]
    if (existing !== undefined) {
      if (existing.parametersHash !== parametersHash) {
        throw new WebTestRuntimeError(
          'web-test/command-token-reuse',
          `command '${registration.commandId}' already registered a project with different parameters`,
        )
      }
      // A published ledger row is the original receipt; a reserved one is a
      // creation this process or a previous one left incomplete.
      return existing.phase === 'published' ? receiptOf(existing) : this.finishCreate(existing, registration)
    }
    const reserved: CreateIntent = {
      commandId: registration.commandId,
      parametersHash,
      reservedProjectId: reserveProjectId(registration.commandId),
      phase: 'reserved',
      acceptedRevision: null,
    }
    await this.publishHead({
      ...head,
      headRevision: head.headRevision + 1,
      intents: { ...head.intents, [reserved.commandId]: reserved },
    })
    return this.finishCreate(reserved, registration)
  }

  /**
   * Stages 2 and 3: build the child record under the reserved identity, then
   * publish the entry point, the receipt, and the notification in one head write.
   */
  private async finishCreate(
    reserved: CreateIntent,
    registration: ValidatedProjectRegistration,
  ): Promise<CommandReceipt> {
    const domain = this.requireDomain()
    const projects = domain.table('projects')
    // Idempotent: an interrupted attempt may already have written the child, and
    // the stored parameters are the ones the reservation's hash committed to.
    const existing = projects.get(reserved.reservedProjectId)
    const revision = existing?.revision ?? brandNumber<Revision>(1)
    if (existing === undefined) {
      await projects.put(reserved.reservedProjectId, {
        projectId: reserved.reservedProjectId,
        revision,
        codeRoots: registration.codeRoots,
        entryUrls: registration.entryUrls,
        pending: null,
      })
    }
    const head = domain.global.get()
    const publishedAt = new Date().toISOString()
    const notification: CatalogNotification = {
      sequence: head.notificationSequence + 1,
      kind: 'project-published',
      projectId: reserved.reservedProjectId,
      metadataRevision: revision,
      publishedAt,
    }
    const intent: CreateIntent = { ...reserved, phase: 'published', acceptedRevision: revision }
    await this.publishHead({
      ...head,
      headRevision: head.headRevision + 1,
      entries: {
        ...head.entries,
        [reserved.reservedProjectId]: {
          projectId: reserved.reservedProjectId,
          metadataRevision: revision,
          publishedAt,
        },
      },
      intents: { ...head.intents, [intent.commandId]: intent },
      notifications: [...head.notifications, notification],
      notificationSequence: notification.sequence,
    })
    return receiptOf(intent)
  }

  /**
   * Publish one head value and read back what is now authoritative.
   *
   * The domain's write chain queues this behind every earlier write, so the head
   * a caller reads after this resolves is the one that was durably committed.
   */
  private async publishHead(head: CatalogHead): Promise<CatalogHead> {
    const domain = this.requireDomain()
    const previous = domain.global.get()
    await domain.global.set(head)
    const published = domain.global.get()
    for (const entry of Object.values(published.entries)) {
      if (previous.entries[entry.projectId]?.metadataRevision !== entry.metadataRevision) {
        this.ctx.emit('web-test/project-published', entry.projectId, entry.metadataRevision)
      }
    }
    return published
  }

  /**
   * The published entry's durable record and the revision of it the entry names,
   * refusing an authority the records do not support rather than serving one
   * partially.
   */
  private requirePublished(projectId: ProjectId): PublishedProject {
    const domain = this.requireDomain()
    const entry = domain.global.get().entries[projectId]
    /* v8 ignore next -- callers reach this only through a published head entry */
    if (entry === undefined) {
      throw new WebTestRuntimeError('web-test/record-unpublished', `project '${projectId}' has no published entry`)
    }
    const record = domain.table('projects').get(projectId)
    if (record === undefined) {
      throw new WebTestRuntimeError(
        'web-test/record-unpublished',
        `catalog head publishes project '${projectId}' at revision ${String(entry.metadataRevision)}, but the stored record is absent`,
      )
    }
    return { record, published: contentAt(record, projectId, entry.metadataRevision) }
  }

  /**
   * Read the record one published entry names, at the revision that entry names.
   */
  private requireProject(projectId: ProjectId): ProjectMetadata {
    return this.requirePublished(projectId).published
  }

  /** Queue one commit on the single serial queue, so no two commits interleave. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.then(job)
    this.queue = result.then(noop, noop)
    return result
  }

  private requireDomain(): Domain<typeof webTestDomain> {
    /* v8 ignore next -- Service.init assigns the domain before the service becomes injectable */
    if (this.domain === undefined) throw new Error('web testing runtime is not initialized')
    return this.domain
  }
}

/**
 * Project one published create intent onto the receipt a resend returns.
 * @param intent - the ledger row the publication committed.
 * @returns the receipt that command token answers with from now on.
 */
function receiptOf(intent: CreateIntent): CommandReceipt {
  /* v8 ignore next -- the stored schema admits a published row only with a revision */
  if (intent.acceptedRevision === null) {
    throw new WebTestRuntimeError('web-test/record-unpublished', `create intent '${intent.commandId}' is not published`)
  }
  return {
    commandId: intent.commandId,
    resourceId: intent.reservedProjectId,
    acceptedRevision: intent.acceptedRevision,
    outcome: 'accepted',
    pendingReason: null,
  }
}

export default WebTestRuntime
