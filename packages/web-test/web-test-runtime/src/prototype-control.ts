/** Trusted bounded prototype producer; each call requires its exact owning Context. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { PrototypeBusinessIntent, PrototypeNotExecutedReceipt, PrototypeOperation, PrototypeOperationId, PrototypeRunHead, PrototypeRunId } from './recovery-spec.ts'
import { issuePrototypeAuthority } from './recovery.ts'
import type { PrototypeAuthority, PrototypePauseReceipt } from './recovery.ts'
import type { WebTestRuntime } from './index.ts'

interface OwnerState {
  readonly ctx: Context
  readonly runtime: WebTestRuntime
  readonly authority: PrototypeAuthority
}

const owners = new WeakMap<object, OwnerState>()

function originalOwner(value: object): object {
  const original: unknown = Reflect.get(value, Symbol.for('cordis.original'))
  return typeof original === 'object' && original !== null ? original : value
}

function stateOf(owner: WebTestPrototypeControl, callerOwnerCtx: Context): OwnerState {
  const state = owners.get(originalOwner(owner))
  if (!state || callerOwnerCtx !== state.ctx) throw new Error('prototype control requires its exact owning Context')
  return state
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTestPrototypeOwner: WebTestPrototypeControl
  }
}

/** Production owner for bounded run registration and dispatch admission; no authority is returned. */
export class WebTestPrototypeControl extends Service {
  static inject = ['webTestRuntime', 'agents']

  /**
   * @param ctx - Actual producer Service context under the ordinary locked Runtime.
   */
  constructor(ctx: Context) {
    super(ctx, 'webTestPrototypeOwner')
    const state = { ctx: this.ctx, runtime: this.ctx.webTestRuntime, authority: issuePrototypeAuthority(this.ctx) }
    owners.set(this, state)
    this.ctx.effect(() => () => { owners.delete(this) }, 'webTestPrototypeOwner.authorityLifetime')
  }

  /**
   * Register a bounded batch before external operations begin.
   * @param run - Initial running or paused head without operations.
   * @param actualCompositionHash - Actual business composition digest.
   * @param callerOwnerCtx - This Service's exact trusted owning Context.
   * @returns after the Runtime durably registers the head.
   */
  registerRun(run: PrototypeRunHead, actualCompositionHash: string, callerOwnerCtx: Context): Promise<void> {
    const state = stateOf(this, callerOwnerCtx)
    return state.runtime.registerPrototypeRun(run, actualCompositionHash, state.authority)
  }

  /**
   * Commit a single operation before its consumer dispatches business I/O.
   * @param runId - Registered running batch.
   * @param operationId - Original operation identity.
   * @param intent - Canonical business operation description.
   * @param callerOwnerCtx - This Service's exact trusted owning Context.
   * @returns the committed ISSUED operation.
   */
  admit(
    runId: PrototypeRunId, operationId: PrototypeOperationId, intent: PrototypeBusinessIntent, callerOwnerCtx: Context,
  ): Promise<PrototypeOperation> {
    const state = stateOf(this, callerOwnerCtx)
    return state.runtime.admitPrototypeOperation(runId, operationId, intent, state.authority)
  }

  /**
   * Retain uncertainty for an admitted operation without dispatching again.
   * @param operationId - Original admitted operation.
   * @param callerOwnerCtx - This Service's exact trusted owning Context.
   * @returns after UNKNOWN is committed.
   */
  markUnknown(operationId: PrototypeOperationId, callerOwnerCtx: Context): Promise<void> {
    const state = stateOf(this, callerOwnerCtx)
    return state.runtime.markPrototypeOperationUnknown(operationId, state.authority)
  }

  /**
   * Persist success after the trusted consumer observes the original operation's successful acknowledgement.
   * @param operationId - Original ISSUED operation; missing and UNKNOWN identities refuse settlement.
   * @param callerOwnerCtx - This Service's exact trusted owning Context.
   * @returns after completion is committed, without completing the whole run or sending business I/O.
   */
  markCompleted(operationId: PrototypeOperationId, callerOwnerCtx: Context): Promise<void> {
    const state = stateOf(this, callerOwnerCtx)
    return state.runtime.markPrototypeOperationCompleted(operationId, state.authority)
  }

  /**
   * Persist a correlated browser denial for the original issued operation.
   * @param operationId - Original ISSUED operation; UNKNOWN identities refuse settlement.
   * @param receipt - Real wire denial correlated by the trusted consumer with its current tool execution.
   * @param callerOwnerCtx - This Service's exact trusted owning Context.
   * @returns after NOT_EXECUTED and the receipt commit; the original intent remains unavailable for dispatch.
   */
  markNotExecuted(
    operationId: PrototypeOperationId, receipt: PrototypeNotExecutedReceipt, callerOwnerCtx: Context,
  ): Promise<void> {
    const state = stateOf(this, callerOwnerCtx)
    return state.runtime.markPrototypeOperationNotExecuted(operationId, receipt, state.authority)
  }

  /**
   * Close the run gate before returning its durable pause promise.
   * @param runId - Existing unfinished batch; UNKNOWN operations remain unsettled.
   * @param callerOwnerCtx - This Service's exact trusted owning Context.
   * @returns the real committed pause receipt; local closure survives publication failure.
   */
  pause(runId: PrototypeRunId, callerOwnerCtx: Context): Promise<PrototypePauseReceipt> {
    const state = stateOf(this, callerOwnerCtx)
    return state.runtime.pausePrototypeRun(runId, state.authority)
  }

  /**
   * Check local and durable admission after awaits and immediately before dispatch.
   * @param runId - Registered run to check without writing or sending business I/O.
   * @param callerOwnerCtx - This Service's exact trusted owning Context.
   * @returns after validation; closed or unknown runs throw.
   */
  assertDispatchable(runId: PrototypeRunId, callerOwnerCtx: Context): void {
    const state = stateOf(this, callerOwnerCtx)
    state.runtime.assertPrototypeRunDispatchable(runId, state.authority)
  }

  /**
   * Stop new admissions and durably revoke this prototype executor.
   * @param callerOwnerCtx - This Service's exact trusted owning Context.
   * @returns after admitted writes drain and revocation is committed.
   */
  revoke(callerOwnerCtx: Context): Promise<void> {
    const state = stateOf(this, callerOwnerCtx)
    return state.runtime.revokePrototypeDispatch(state.authority)
  }
}

export default WebTestPrototypeControl
