/** Recovery-only Loader entry for legacy and current activity generations. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { RecoveryCoordinator, checkPrototypeExecutorFormat, issueRecoveryAuthority, readPersistentActivity, resolveControlWritePolicy } from '@deepseek-ai/dsh-web-test-runtime'
import type { FrozenRunManifest, PersistentActivitySnapshot, RecoveryAuthority, RecoveryUpdateIntent } from '@deepseek-ai/dsh-web-test-runtime'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Same-control-root coordinator without a business executor. */
    webTestRecovery: WebTestRecovery
  }
}

/** Recovery-only entry configuration. */
export interface Config {
  /** Existing control root whose ordinary writer has stopped and released ownership. */
  readonly controlRoot: string
  /** Delays before Windows atomic publication retries; [] permits one rename attempt. */
  readonly windowsRenameDelaysMs?: number[]
}

interface RecoveryState {
  readonly authority: RecoveryAuthority
  coordinator: RecoveryCoordinator | undefined
}

const states = new WeakMap<object, RecoveryState>()

function stateFor(service: object): RecoveryState {
  const original: unknown = Reflect.get(service, Symbol.for('cordis.original'))
  const state = states.get(typeof original === 'object' && original !== null ? original : service)
  if (state === undefined) throw new Error('web-test recovery: owner is unavailable')
  return state
}

function coordinatorFor(service: object): RecoveryCoordinator {
  const coordinator = stateFor(service).coordinator
  if (coordinator === undefined) throw new Error('web-test recovery: coordinator is unavailable')
  return coordinator
}

/** A Loader-mounted coordinator; the recovery profile contains no business dispatch services. */
export class WebTestRecovery extends Service {
  static Config: z<Config, Config & { windowsRenameDelaysMs: number[] }> = z.object({
    controlRoot: z.string().required(), windowsRenameDelaysMs: z.array(z.natural()).default([20, 40, 80, 160]),
  })

  /**
   * @param ctx - owning recovery profile context.
   * @param config - existing control root, shared with the stopped ordinary writer.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'webTestRecovery')
    states.set(this, { authority: issueRecoveryAuthority(this.ctx), coordinator: undefined })
  }

  async [Service.init](): Promise<void> {
    const state = stateFor(this)
    const resolved = WebTestRecovery.Config(this.config)
    const coordinator = await RecoveryCoordinator.open(resolved.controlRoot, this.ctx, state.authority,
      resolveControlWritePolicy(resolved.windowsRenameDelaysMs))
    state.coordinator = coordinator
    this.ctx.effect(() => async () => {
      state.coordinator = undefined
      await coordinator.close(state.authority)
    }, 'web-test-recovery: release coordinator after pending operations')
  }

  /**
   * Read the existing run heads without loading Sessions or modifying records.
   * @returns the cold snapshot, including completeness errors.
   */
  inspect(): Promise<PersistentActivitySnapshot> {
    coordinatorFor(this)
    return readPersistentActivity(this.config.controlRoot)
  }

  /**
   * Verify dispatch revocation and capture the last committed generation inventory.
   * @param authority - opaque authority issued to the trusted recovery Host owner.
   * @returns manifest retaining pause, cancellation, UNKNOWN, reports, and attachments.
   */
  freeze(authority: RecoveryAuthority): Promise<FrozenRunManifest> {
    return coordinatorFor(this).freeze(authority)
  }

  /**
   * Check the frozen executor format and build an independent recovery-only candidate.
   * @param newPackageHash - exact target combination SHA-256 digest.
   * @param authority - opaque authority issued to the trusted recovery Host owner.
   * @returns intent binding source, backup, candidate, and combination identities.
   */
  prepare(newPackageHash: string, authority: RecoveryAuthority): Promise<RecoveryUpdateIntent> {
    return coordinatorFor(this).prepare(newPackageHash, checkPrototypeExecutorFormat, authority)
  }

  /**
   * Recheck all materials before publishing the candidate generation pointer.
   * @param intent - exact prepared intent; predecessors remain available.
   * @param authority - opaque authority issued to the trusted recovery Host owner.
   * @returns after the candidate becomes selected in recovery-only mode.
   */
  activate(intent: RecoveryUpdateIntent, authority: RecoveryAuthority): Promise<void> {
    return coordinatorFor(this).activate(intent, authority)
  }
}

export default WebTestRecovery
