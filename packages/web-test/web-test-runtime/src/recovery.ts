/** Atomic prototype cuts and generation-preserving recovery coordination. */
import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises'
import { setTimeout as wait } from 'node:timers/promises'
import { join, relative } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { renameAtomicTemp } from '@deepseek-ai/dsh-atomic-write'
import type { AtomicRenamePolicy } from '@deepseek-ai/dsh-atomic-write'
import type {} from '@deepseek-ai/dsh-agent'
import { controlLockName } from './control-root.ts'
import { ControlRootLock } from './lock.ts'
import { EMPTY_PROTOTYPE_COMPOSITION_HASH, readExistingGeneration, readPrototypeActivity, validatePrototypeActivity } from './persistent-activity.ts'
import { PROTOTYPE_ACTIVITY_FILENAME, prototypeIntentSchema, prototypeOperationSchema } from './recovery-spec.ts'
import type { FrozenRunManifest, PrototypeActivityCut, PrototypeBusinessIntent, PrototypeNotExecutedReceipt, PrototypeOperation, PrototypeOperationId, PrototypeRunHead, PrototypeRunId, RecoveryUpdateIntent } from './recovery-spec.ts'

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Resolve one owning entry's configured atomic publication cadence.
 * @param windowsRenameDelaysMs - Validated delays before successive Windows rename retries.
 * @returns a fixed cadence using real timers; an empty list permits one attempt.
 */
export function resolveControlWritePolicy(windowsRenameDelaysMs: readonly number[]): AtomicRenamePolicy {
  return { windowsRenameDelaysMs: [...windowsRenameDelaysMs], wait }
}

async function writeAtomic(path: string, value: unknown, policy: AtomicRenamePolicy): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    try {
      await file.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
      await file.sync()
    }
    finally {
      await file.close()
    }
    await renameAtomicTemp(temporary, path, policy)
  }
  catch (primaryError) {
    try { await unlink(temporary) }
    catch (cleanupError) {
      // A retained temp must not replace the publication failure the caller handles.
      void cleanupError
    }
    throw primaryError
  }
}

function intentKey(intent: PrototypeBusinessIntent): string {
  return digest(JSON.stringify([intent.kind, intent.target, intent.parametersHash]))
}

function assertHostOwner(ctx: Context, role: 'webTestRuntime' | 'webTestRecovery' | 'webTestPrototypeOwner'): void {
  const record = ctx.fiber.store?.[role]
  if (!record || record.fiber !== ctx.fiber || record.name !== role || !(record.value instanceof Service)) {
    throw new Error(`${role} requires its trusted Host Service owner`)
  }
  const owner: unknown = Reflect.get(record.value, 'ctx')
  if (!Context.is(owner) || owner.fiber !== ctx.fiber || ctx.get('agents')?.currentInitiator()) {
    throw new Error(`${role} requires its trusted Host Service owner`)
  }
}

declare const prototypeAuthorityBrand: unique symbol
declare const recoveryAuthorityBrand: unique symbol

/** Opaque trusted prototype producer authority; never returned by a Service. */
export type PrototypeAuthority = { readonly [prototypeAuthorityBrand]: true }
/** Opaque trusted recovery owner authority; never returned by a Service. */
export type RecoveryAuthority = { readonly [recoveryAuthorityBrand]: true }

/** Receipt derived only from the committed pause cut; UNKNOWN remains UNKNOWN. */
export interface PrototypePauseReceipt {
  readonly runId: PrototypeRunId
  readonly cutRevision: number
  readonly headRevision: number
  readonly status: PrototypeRunHead['status']
  readonly pauseRequested: true
}

const prototypeAuthorities = new WeakMap<PrototypeAuthority, { ctx: Context; provider: object }>()
const recoveryAuthorities = new WeakMap<RecoveryAuthority, Context>()

function originalProvider(provider: object): object {
  const original: unknown = Reflect.get(provider, Symbol.for('cordis.original'))
  return typeof original === 'object' && original !== null ? original : provider
}

/**
 * Issue new private authority to the actual prototype producer Service.
 * @param ctx - owning webTestPrototypeOwner Service context, outside model execution.
 * @returns authority bound to that owner and its currently injected Runtime.
 */
export function issuePrototypeAuthority(ctx: Context): PrototypeAuthority {
  assertHostOwner(ctx, 'webTestPrototypeOwner')
  const provider = ctx.get('webTestRuntime')
  if (!provider) throw new Error('prototype authority requires its Runtime provider')
  const authority = Object.freeze({}) as PrototypeAuthority
  prototypeAuthorities.set(authority, { ctx, provider: originalProvider(provider) })
  return authority
}

/**
 * Verify opaque authority rather than relying on clearable initiator attribution.
 * @param provider - exact Runtime receiving this mutation.
 * @param authority - private authority issued to the actual prototype producer.
 * @returns after identity, owner lifetime and current provider have been checked.
 */
export function assertPrototypeAuthority(provider: object, authority: PrototypeAuthority): void {
  const issued = prototypeAuthorities.get(authority)
  if (!issued || issued.provider !== originalProvider(provider)) throw new Error('prototype mutation requires private producer authority')
  assertHostOwner(issued.ctx, 'webTestPrototypeOwner')
  const current = issued.ctx.get('webTestRuntime')
  if (!current || originalProvider(current) !== issued.provider) throw new Error('prototype authority provider is no longer current')
}

/**
 * Issue new private authority to the actual recovery Service owner.
 * @param ctx - owning webTestRecovery Service context, outside model execution.
 * @returns opaque owner authority; copies and fabricated objects have no authority.
 */
export function issueRecoveryAuthority(ctx: Context): RecoveryAuthority {
  assertHostOwner(ctx, 'webTestRecovery')
  const authority = Object.freeze({}) as RecoveryAuthority
  recoveryAuthorities.set(authority, ctx)
  return authority
}

function assertRecoveryAuthority(ctx: Context, authority: RecoveryAuthority, closing = false): void {
  if (recoveryAuthorities.get(authority) !== ctx) throw new Error('recovery requires private owner authority')
  if (!closing) assertHostOwner(ctx, 'webTestRecovery')
}

/**
 * The prototype cut writer used by the ordinary Runtime while it owns the lock.
 * This writer never performs business I/O: admission is committed before its
 * caller sends an operation, and any unconfirmed operation remains unsettled.
 */
export class PrototypeActivityStore {
  #queue: Promise<void> = Promise.resolve()
  #stopped = false
  #revokePromise?: Promise<void>
  #committed: PrototypeActivityCut | undefined
  readonly #closedRunGates = new Set<PrototypeRunId>()
  readonly #pauses = new Map<PrototypeRunId, Promise<PrototypePauseReceipt>>()
  readonly #ctx: Context
  readonly #dataRoot: string
  readonly #writePolicy: AtomicRenamePolicy

  /**
   * @param ctx - actual owning Runtime Service context.
   * @param dataRoot - generation owned by the caller's held control-root lock.
   * @param writePolicy - Resolved atomic publication cadence from the owning Runtime config.
   */
  constructor(ctx: Context, dataRoot: string, writePolicy: AtomicRenamePolicy) {
    this.#ctx = ctx
    this.#dataRoot = dataRoot
    this.#writePolicy = writePolicy
    assertHostOwner(ctx, 'webTestRuntime')
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    assertHostOwner(this.#ctx, 'webTestRuntime')
    if (this.#stopped) return Promise.reject(new Error('prototype executor is stopped'))
    const pending = this.#queue.then(operation)
    this.#queue = pending.then(() => {}, () => {})
    return pending
  }

  /**
   * Hydrate admission facts from an existing cut without creating or repairing history.
   * @returns after inspection; absent or invalid cuts grant no admission, and unsettled cold runs stay closed.
   */
  async hydrate(): Promise<void> {
    assertHostOwner(this.#ctx, 'webTestRuntime')
    try {
      this.#committed = await readPrototypeActivity(this.#dataRoot)
      for (const run of this.#committed.runs) {
        if (run.operations.some(operation => operation.status === 'ISSUED' || operation.status === 'UNKNOWN')) this.#closedRunGates.add(run.runId)
      }
    }
    catch (error) {
      // Cold queries retain the integrity error; legacy roots remain readable without dispatch permission.
      void error
      this.#committed = undefined
    }
  }

  async #publish(cut: PrototypeActivityCut): Promise<void> {
    await writeAtomic(join(this.#dataRoot, PROTOTYPE_ACTIVITY_FILENAME), cut, this.#writePolicy)
    this.#committed = cut
  }

  /**
   * Recheck the run-specific gate immediately before the consumer sends business I/O.
   * @param runId - Registered run whose latest durable head grants ordinary dispatch.
   * @returns after validation; paused, unknown, cold unsettled, missing and recovery-only heads throw.
   */
  assertDispatchable(runId: PrototypeRunId): void {
    assertHostOwner(this.#ctx, 'webTestRuntime')
    const cut = this.#committed
    const run = cut?.runs.find(candidate => candidate.runId === runId)
    if (this.#stopped) throw new Error('prototype executor is stopped')
    if (cut && (cut.format !== 3 || cut.executor !== 'active')) throw new Error('legacy, recovery-only or revoked executor cannot dispatch')
    if (this.#closedRunGates.has(runId) || !cut
      || !run || run.status !== 'RUNNING' || run.pauseRequested || run.cancelRequested) {
      throw new Error('run is not dispatchable')
    }
  }

  /**
   * Close a known run's local gate synchronously, then commit its pause request.
   * @param runId - Registered unfinished run; unknown identities never create a gate.
   * @returns its real durable receipt; publication failure keeps the local gate closed.
   */
  pause(runId: PrototypeRunId): Promise<PrototypePauseReceipt> {
    assertHostOwner(this.#ctx, 'webTestRuntime')
    const cut = this.#committed
    const run = cut?.runs.find(candidate => candidate.runId === runId)
    if (this.#stopped || !cut || cut.format !== 3 || cut.executor !== 'active' || !run || run.status === 'COMPLETED') {
      throw new Error('run cannot be paused by this executor')
    }
    this.#closedRunGates.add(runId)
    const existing = this.#pauses.get(runId)
    if (existing) return existing
    const pending = this.#enqueue(async () => {
      const current = await readPrototypeActivity(this.#dataRoot)
      const head = current.runs.find(candidate => candidate.runId === runId)
      if (current.format !== 3 || current.executor !== 'active' || !head || head.status === 'COMPLETED') {
        throw new Error('run cannot be paused by this executor')
      }
      if (!head.pauseRequested) {
        head.pauseRequested = true
        if (head.status === 'RUNNING') head.status = 'PAUSED'
        head.headRevision += 1
        current.revision += 1
        await this.#publish(current)
      }
      else this.#committed = current
      return {
        runId, cutRevision: current.revision, headRevision: head.headRevision,
        status: head.status, pauseRequested: true as const,
      }
    })
    this.#pauses.set(runId, pending)
    void pending.catch(() => {
      // A caller may retry durable publication; the synchronous gate remains closed.
      this.#pauses.delete(runId)
    })
    return pending
  }

  /**
   * Register a new, explicit prototype domain; refuse overwriting existing cuts.
   * @param cut - validated format-3 records supplied by the prototype owner.
   * @returns after the complete initial cut is atomically committed.
   */
  initialize(cut: PrototypeActivityCut): Promise<void> {
    return this.#enqueue(async () => {
      const validated = validatePrototypeActivity(cut)
      if (validated.format !== 3) throw new Error('an executor can only register prototype format 3')
      try {
        await lstat(join(this.#dataRoot, PROTOTYPE_ACTIVITY_FILENAME))
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await this.#publish(validated)
        return
      }
      throw new Error('prototype activity is already registered')
    })
  }

  /**
   * Register one bounded batch before admission, binding the first batch's actual composition.
   * @param run - Initial running or paused head, with revision one and no operations.
   * @param actualCompositionHash - Actual business composition digest shared by every registered batch.
   * @returns after registration is committed on the same queue as operation admission.
   */
  registerRun(run: PrototypeRunHead, actualCompositionHash: string): Promise<void> {
    return this.#enqueue(async () => {
      const cut = await readPrototypeActivity(this.#dataRoot)
      if (cut.format !== 3 || cut.executor !== 'active') throw new Error('legacy, recovery-only or revoked executor cannot register a run')
      if (actualCompositionHash === EMPTY_PROTOTYPE_COMPOSITION_HASH) throw new Error('an empty-plane fingerprint is not a registered business composition')
      if (run.operations.length !== 0 || run.headRevision !== 1 || (run.status !== 'RUNNING' && run.status !== 'PAUSED')) {
        throw new Error('run registration requires an initial running or paused head without operations')
      }
      if (cut.runs.some(existing => existing.runId === run.runId)) throw new Error('prototype run is already registered')
      if (cut.runs.length > 0 && cut.compositionHash !== actualCompositionHash) throw new Error('prototype composition does not match registered activity')
      const next = validatePrototypeActivity({
        ...cut, compositionHash: actualCompositionHash, revision: cut.revision + 1, runs: [...cut.runs, run],
      })
      await this.#publish(next)
    })
  }

  /**
   * Commit dispatch admission once, refusing unresolved or repeated intent in
   * any run; a new run or command identity does not grant a second dispatch.
   * @param runId - original registered running batch.
   * @param operationId - original operation identity, independent of command tokens.
   * @param businessIntent - exact kind, target, and normalized-parameter digest.
   * @returns the newly committed ISSUED operation, before external business I/O.
   */
  async admit(
    runId: PrototypeRunId, operationId: PrototypeOperationId, businessIntent: PrototypeBusinessIntent,
  ): Promise<PrototypeOperation> {
    this.assertDispatchable(runId)
    return this.#enqueue(async () => {
      this.assertDispatchable(runId)
      const cut = await readPrototypeActivity(this.#dataRoot)
      if (cut.format !== 3 || cut.executor !== 'active') throw new Error('legacy, recovery-only or revoked executor cannot dispatch')
      const intent = prototypeIntentSchema.parse(businessIntent)
      const key = intentKey(intent)
      const repeated = cut.runs.some(run => run.operations.some(operation =>
        operation.operationId === operationId || intentKey(operation.businessIntent) === key))
      if (repeated) {
        throw new Error('business intent already has an operation; verify its original identity')
      }
      const run = cut.runs.find(candidate => candidate.runId === runId)
      if (!run || run.status !== 'RUNNING' || run.pauseRequested || run.cancelRequested) throw new Error('run is not dispatchable')
      const operation = prototypeOperationSchema.parse({ operationId, businessIntent: intent, status: 'ISSUED' })
      run.operations.push(operation)
      run.headRevision += 1
      cut.revision += 1
      await this.#publish(cut)
      return operation
    })
  }

  /**
   * Record an uncertain result without issuing or settling a second operation.
   * @param operationId - the original ISSUED operation to retain.
   * @returns after UNKNOWN is atomically committed.
   */
  markUnknown(operationId: PrototypeOperationId): Promise<void> {
    return this.#enqueue(async () => {
      const cut = await readPrototypeActivity(this.#dataRoot)
      if (cut.format !== 3 || cut.executor !== 'active') throw new Error('executor is not active in current format')
      const run = cut.runs.find(candidate => candidate.operations.some(operation => operation.operationId === operationId))
      const operation = run?.operations.find(candidate => candidate.operationId === operationId)
      if (!run || !operation || (operation.status !== 'ISSUED' && operation.status !== 'UNKNOWN')) throw new Error('original unsettled operation is absent')
      operation.status = 'UNKNOWN'
      run.status = 'UNKNOWN'
      run.headRevision += 1
      cut.revision += 1
      await this.#publish(cut)
    })
  }

  /**
   * Record a confirmed successful result only for its original ISSUED operation.
   * @param operationId - Original issued identity whose trusted consumer observed success.
   * @returns after completion is committed; UNKNOWN and absent identities cannot settle.
   */
  markCompleted(operationId: PrototypeOperationId): Promise<void> {
    return this.#enqueue(async () => {
      const cut = await readPrototypeActivity(this.#dataRoot)
      if (cut.format !== 3 || cut.executor !== 'active') throw new Error('executor is not active in current format')
      const run = cut.runs.find(candidate => candidate.operations.some(operation => operation.operationId === operationId))
      const operation = run?.operations.find(candidate => candidate.operationId === operationId)
      if (!run || !operation || operation.status !== 'ISSUED') throw new Error('original ISSUED operation is absent')
      operation.status = 'COMPLETED'
      run.headRevision += 1
      cut.revision += 1
      await this.#publish(cut)
    })
  }

  /**
   * Settle confirmed non-execution without authorizing the original intent again.
   * @param operationId - Original ISSUED identity, never an UNKNOWN operation.
   * @param receipt - Trusted owner's correlated tool-call and real browser wire denial.
   * @returns after the denial and complete receipt are committed; mismatched identities reject.
   */
  markNotExecuted(operationId: PrototypeOperationId, receipt: PrototypeNotExecutedReceipt): Promise<void> {
    return this.#enqueue(async () => {
      const cut = await readPrototypeActivity(this.#dataRoot)
      if (cut.format !== 3 || cut.executor !== 'active') throw new Error('executor is not active in current format')
      const run = cut.runs.find(candidate => candidate.operations.some(operation => operation.operationId === operationId))
      const index = run?.operations.findIndex(candidate => candidate.operationId === operationId)
      const operation = index === undefined ? undefined : run?.operations[index]
      if (!run || index === undefined || !operation || operation.status !== 'ISSUED') {
        throw new Error('original ISSUED operation is absent')
      }
      if (receipt.operationId !== operationId || receipt.runId !== run.runId || receipt.sessionId !== run.sessionId
        || receipt.parametersHash !== operation.businessIntent.parametersHash) {
        throw new Error('not-executed receipt does not match original operation')
      }
      run.operations[index] = { ...operation, status: 'NOT_EXECUTED', receipt: { ...receipt } }
      run.headRevision += 1
      cut.revision += 1
      await this.#publish(cut)
    })
  }

  /**
   * Stop new admissions immediately, then commit revocation after queued work.
   * @returns after the durable cut excludes all further executor dispatch.
   */
  async revoke(): Promise<void> {
    assertHostOwner(this.#ctx, 'webTestRuntime')
    if (this.#revokePromise) return this.#revokePromise
    this.#stopped = true
    this.#revokePromise = this.#queue.then(async () => {
      const cut = await readPrototypeActivity(this.#dataRoot)
      if (cut.executor === 'revoked') return
      if (cut.format !== 3) throw new Error('legacy activity is read-only')
      cut.executor = 'revoked'
      cut.revision += 1
      await this.#publish(cut)
    })
    return this.#revokePromise
  }

  /** Stop and drain in-process admissions without inventing durable revocation. */
  async close(): Promise<void> {
    if (this.#ctx.get('agents')?.currentInitiator()) throw new Error('prototype close requires its trusted Host owner')
    this.#stopped = true
    await Promise.allSettled([this.#queue, ...(this.#revokePromise ? [this.#revokePromise] : [])])
  }
}

async function inventory(root: string): Promise<Array<{ path: string; sha256: string }>> {
  const files: Array<{ path: string; sha256: string }> = []
  async function visit(directory: string): Promise<void> {
    const directoryState = await lstat(directory)
    if (directoryState.isSymbolicLink() || !directoryState.isDirectory()) throw new Error('inventory directory is not an ordinary directory')
    for (const entry of (await readdir(directory)).sort()) {
      const path = join(directory, entry)
      const state = await lstat(path)
      if (state.isSymbolicLink()) throw new Error('generation inventory contains a symlink or junction')
      if (state.isDirectory()) await visit(path)
      else if (state.isFile()) files.push({ path: relative(root, path).replaceAll('\\', '/'), sha256: digest(await readFile(path)) })
      else throw new Error('generation inventory contains a non-file entry')
    }
  }
  await visit(root)
  return files
}

async function createOrdinaryPath(root: string, directory: string): Promise<void> {
  let current = root
  for (const component of directory.split('/')) {
    current = join(current, component)
    try {
      await mkdir(current, { mode: 0o700 })
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const state = await lstat(current)
    if (state.isSymbolicLink() || !state.isDirectory()) throw new Error('recovery directory is not an ordinary directory')
  }
}

/**
 * The independently callable old-format checker never writes or migrates data.
 * @param dataRoot - frozen backup whose complete format-1 cut is checked.
 * @returns the validated old cut; unsupported or inconsistent data rejects.
 */
export async function checkPrototypeFormat1(dataRoot: string): Promise<PrototypeActivityCut> {
  const cut = await readPrototypeActivity(dataRoot)
  if (cut.format !== 1 || cut.executor !== 'revoked') throw new Error('checker requires revoked prototype format 1')
  return cut
}

/**
 * Independently validate the current revoked executor cut without changing data.
 * @param dataRoot - Frozen backup holding a format-3 cut.
 * @returns the validated revoked cut; other formats reject.
 */
export async function checkPrototypeFormat3(dataRoot: string): Promise<PrototypeActivityCut> {
  const cut = await readPrototypeActivity(dataRoot)
  if (cut.format !== 3 || cut.executor !== 'revoked') throw new Error('checker requires revoked prototype format 3')
  return cut
}

/**
 * Check a frozen executor backup in either supported format without writing.
 * @param dataRoot - Immutable backup supplied by recovery preparation.
 * @returns a revoked format-1 or format-3 cut; recovery-only and active cuts reject.
 */
export async function checkPrototypeExecutorFormat(dataRoot: string): Promise<PrototypeActivityCut> {
  const cut = await readPrototypeActivity(dataRoot)
  if ((cut.format !== 1 && cut.format !== 3) || cut.executor !== 'revoked') {
    throw new Error('checker requires revoked prototype executor format 1 or 3')
  }
  return cut
}

/**
 * An independent coordinator owns the exact ordinary Runtime lock until close.
 * It supports legacy 1 to 2 and current 3 to 4 recovery, and never dispatches business.
 */
export class RecoveryCoordinator {
  #closed = false
  #frozen?: FrozenRunManifest
  #intent?: RecoveryUpdateIntent
  readonly #recoveryId = randomUUID()
  #queue: Promise<void> = Promise.resolve()
  #closePromise?: Promise<void>
  readonly #controlRootIdentity: string
  readonly #generation: number
  readonly #dataRoot: string
  readonly #lock: ControlRootLock
  readonly #ctx: Context
  readonly #writePolicy: AtomicRenamePolicy

  private constructor(
    controlRootIdentity: string, generation: number, dataRoot: string,
    lock: ControlRootLock, ctx: Context, authority: RecoveryAuthority, writePolicy: AtomicRenamePolicy,
  ) {
    assertRecoveryAuthority(ctx, authority)
    this.#controlRootIdentity = controlRootIdentity
    this.#generation = generation
    this.#dataRoot = dataRoot
    this.#lock = lock
    this.#ctx = ctx
    this.#writePolicy = writePolicy
  }

  /**
   * Claim an existing root after the old executor has stopped; never create data.
   * @param controlRoot - existing root shared with the ordinary Runtime.
   * @param ctx - actual owning webTestRecovery Service context, without model initiator.
   * @param authority - private authority held by that trusted owner.
   * @param writePolicy - Resolved atomic publication cadence from the owning recovery config.
   * @returns the exclusively owning coordinator; contention rejects immediately.
   */
  static async open(
    controlRoot: string, ctx: Context, authority: RecoveryAuthority, writePolicy: AtomicRenamePolicy,
  ): Promise<RecoveryCoordinator> {
    assertRecoveryAuthority(ctx, authority)
    const selected = await readExistingGeneration(controlRoot)
    const lock = await ControlRootLock.acquire(controlLockName(selected.controlRootIdentity))
    try {
      const claimed = await readExistingGeneration(controlRoot)
      return new RecoveryCoordinator(claimed.controlRootIdentity, claimed.generation, claimed.dataRoot, lock, ctx, authority, writePolicy)
    }
    catch (error) {
      lock.release()
      throw error
    }
  }

  #enqueue<T>(authority: RecoveryAuthority, operation: () => Promise<T>): Promise<T> {
    assertRecoveryAuthority(this.#ctx, authority)
    if (this.#closed) return Promise.reject(new Error('recovery coordinator is closed'))
    const pending = this.#queue.then(operation)
    this.#queue = pending.then(() => {}, () => {})
    return pending
  }

  /**
   * Freeze the last committed, revoked cut and bind every generation file.
   * @param authority - private authority held by the trusted recovery owner.
   * @returns the immutable manifest; an active executor or inconsistent cut rejects.
   */
  freeze(authority: RecoveryAuthority): Promise<FrozenRunManifest> {
    return this.#enqueue(authority, async () => {
      if (this.#frozen) return structuredClone(this.#frozen)
      const cut = await checkPrototypeExecutorFormat(this.#dataRoot)
      const files = await inventory(this.#dataRoot)
      const paths = new Set(files.map(file => file.path))
      for (const run of cut.runs) {
        for (const material of [...run.attachments, ...run.reports]) {
          if (material.includes('\\') || material.startsWith('/') || material.split('/').some(component => component === '..' || component === '.' || component === '') || !paths.has(material)) {
            throw new Error('frozen material reference is absent or unsafe')
          }
        }
      }
      const activityHash = files.find(file => file.path === PROTOTYPE_ACTIVITY_FILENAME)?.sha256
      if (!activityHash) throw new Error('committed activity cut is absent from inventory')
      const manifest: FrozenRunManifest = {
        controlRootIdentity: this.#controlRootIdentity,
        lockName: controlLockName(this.#controlRootIdentity), generation: this.#generation,
        activityHash, backupHash: digest(JSON.stringify(files)), files, cut,
      }
      const recoveryRoot = join(this.#controlRootIdentity, 'recovery', this.#recoveryId)
      await createOrdinaryPath(this.#controlRootIdentity, `recovery/${this.#recoveryId}`)
      await writeAtomic(join(recoveryRoot, 'frozen.json'), manifest, this.#writePolicy)
      this.#frozen = structuredClone(manifest)
      return structuredClone(manifest)
    })
  }

  /**
   * Copy and verify the backup, run its checker, then build the recovery format beside
   * the original generation; no pointer is changed by preparation.
   * @param newPackageHash - SHA-256 identity of the selected replacement combination.
   * @param checker - independent old-format reader; absence or failure rejects.
   * @param authority - private authority held by the trusted recovery owner.
   * @returns the persisted intent binding the verified backup and candidate.
   */
  prepare(
    newPackageHash: string, checker: ((dataRoot: string) => Promise<PrototypeActivityCut>) | undefined, authority: RecoveryAuthority,
  ): Promise<RecoveryUpdateIntent> {
    return this.#enqueue(authority, async () => {
      if (!this.#frozen) throw new Error('freeze is required before preparation')
      if (this.#intent) throw new Error('a candidate is already prepared')
      if (!checker || !/^[a-f0-9]{64}$/.test(newPackageHash)) {
        throw new Error('a compatible checker and package digest are required')
      }
      const frozen = this.#frozen
      if (digest(JSON.stringify(await inventory(this.#dataRoot))) !== frozen.backupHash) throw new Error('source changed after freeze')
      const backupDirectory = `recovery/${this.#recoveryId}/backup`
      const backup = join(this.#controlRootIdentity, backupDirectory)
      await cp(this.#dataRoot, backup, { recursive: true, errorOnExist: true, force: false })
      if (digest(JSON.stringify(await inventory(backup))) !== frozen.backupHash) throw new Error('backup is inconsistent')
      const checked = await checker(backup)
      if (JSON.stringify(checked) !== JSON.stringify(frozen.cut)) throw new Error('checker returned a different committed cut')
      if (digest(JSON.stringify(await inventory(backup))) !== frozen.backupHash) throw new Error('checker changed the backup')
      const candidateGeneration = this.#generation + 1
      const candidateDirectory = `data/${candidateGeneration}-recovery-${this.#recoveryId}`
      const candidate = join(this.#controlRootIdentity, candidateDirectory)
      await cp(backup, candidate, { recursive: true, errorOnExist: true, force: false })
      const migrated = validatePrototypeActivity({
        format: frozen.cut.format === 3 ? 4 : 2, compositionHash: newPackageHash, predecessorCompositionHash: frozen.cut.compositionHash,
        revision: frozen.cut.revision, executor: 'revoked', recoveryOnly: true, runs: frozen.cut.runs,
      })
      await writeAtomic(join(candidate, PROTOTYPE_ACTIVITY_FILENAME), migrated, this.#writePolicy)
      await readPrototypeActivity(candidate)
      const candidateHash = digest(JSON.stringify(await inventory(candidate)))
      const intent: RecoveryUpdateIntent = {
        frozen, oldPackageHash: frozen.cut.compositionHash, newPackageHash,
        backupDirectory, candidateDirectory, candidateGeneration, candidateHash,
      }
      await writeAtomic(join(this.#controlRootIdentity, 'recovery', this.#recoveryId, 'intent.json'), intent, this.#writePolicy)
      this.#intent = structuredClone(intent)
      return structuredClone(intent)
    })
  }

  /**
   * Recheck all identities and inventories before atomically selecting the
   * read-only candidate; the original generation and backup remain intact.
   * @param intent - exact intent returned by this coordinator's preparation.
   * @param authority - private authority held by the trusted recovery owner.
   * @returns after the pointer selects validated recovery-only data.
   */
  activate(intent: RecoveryUpdateIntent, authority: RecoveryAuthority): Promise<void> {
    return this.#enqueue(authority, async () => {
      if (!this.#intent || JSON.stringify(this.#intent) !== JSON.stringify(intent)) throw new Error('recovery intent identity mismatch')
      const selected = await readExistingGeneration(this.#controlRootIdentity)
      if (selected.generation !== this.#generation || selected.dataRoot !== this.#dataRoot) throw new Error('original generation changed')
      const backup = join(this.#controlRootIdentity, this.#intent.backupDirectory)
      const candidate = join(this.#controlRootIdentity, this.#intent.candidateDirectory)
      if (digest(JSON.stringify(await inventory(this.#dataRoot))) !== this.#intent.frozen.backupHash
        || digest(JSON.stringify(await inventory(backup))) !== this.#intent.frozen.backupHash
        || digest(JSON.stringify(await inventory(candidate))) !== this.#intent.candidateHash) throw new Error('recovery inventory mismatch')
      const storedIntent: unknown = JSON.parse(await readFile(join(this.#controlRootIdentity, 'recovery', this.#recoveryId, 'intent.json'), 'utf8'))
      const storedManifest: unknown = JSON.parse(await readFile(join(this.#controlRootIdentity, 'recovery', this.#recoveryId, 'frozen.json'), 'utf8'))
      if (JSON.stringify(storedIntent) !== JSON.stringify(this.#intent) || JSON.stringify(storedManifest) !== JSON.stringify(this.#frozen)) throw new Error('durable recovery records changed')
      const cut = await readPrototypeActivity(candidate)
      if (cut.format !== (this.#intent.frozen.cut.format === 3 ? 4 : 2) || cut.compositionHash !== this.#intent.newPackageHash || JSON.stringify(cut.runs) !== JSON.stringify(this.#intent.frozen.cut.runs)) throw new Error('candidate state mismatch')
      await writeAtomic(join(this.#controlRootIdentity, 'current.json'), { generation: this.#intent.candidateGeneration, directory: this.#intent.candidateDirectory }, this.#writePolicy)
    })
  }

  /**
   * Reject all business dispatch from a recovery-only coordinator.
   * @returns never; recovery-only always throws instead of authorizing dispatch.
   */
  assertDispatchAllowed(): never {
    throw new Error('recovery-only refuses business dispatch, including new run identities')
  }

  /**
   * Drain recovery work before releasing the same control-root lock.
   * @param authority - original trusted authority, including during owner teardown.
   */
  async close(authority: RecoveryAuthority): Promise<void> {
    assertRecoveryAuthority(this.#ctx, authority, true)
    if (this.#ctx.get('agents')?.currentInitiator()) throw new Error('recovery close requires its trusted Host owner')
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    this.#closePromise = this.#queue.then(() => { this.#lock.release() })
    return this.#closePromise
  }
}
