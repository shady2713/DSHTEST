/** Trusted runtime execution of isolated role targets inside one Agent resource operation. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { sameBrowserExecutionOwner, bindDesktopBrowserExecutionAuthority } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { DesktopBrowserControl, DesktopBrowserExecutionOwner, DesktopBrowserControlledTarget,
  DesktopBrowserRoleBinding, DesktopBrowserRoleId, DesktopBrowserCommandBody, DesktopBrowserCommandResult,
  DesktopBrowserExecutionAuthority } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { SessionResources } from '@deepseek-ai/dsh-experimental-browser-use-runtime'

/** Role-scoped executor: group creation, target addresses and raw IPC stay outside model/page input. */
export interface BrowserRoleExecutor {
  /**
   * Submit directly to the acknowledged role without entering another resource operation.
   * @param role - role selected from this group's trusted runtime plan.
   * @param body - allowlisted command for the role.
   * @returns its correlated result; unknown outcomes require business verification.
   */
  submit(role: DesktopBrowserRoleId, body: DesktopBrowserCommandBody): Promise<DesktopBrowserCommandResult>
}

interface Admission {
  readonly owner: DesktopBrowserExecutionOwner
  readonly targets: readonly DesktopBrowserControlledTarget[]
}

/** One resource queue per exact Agent activation; its callback may coordinate role operations concurrently. */
export class DesktopBrowserExecutionGroups {
  private readonly admissions = new Map<Agent, Admission>()
  private readonly resources: SessionResources<readonly DesktopBrowserRoleBinding[]>
  readonly #authority: DesktopBrowserExecutionAuthority

  /**
   * @param ctx - runtime context with the live Agent registry.
   * @param control - trusted Host provider of Main-acknowledged role grants.
   */
  constructor(private readonly ctx: Context, private readonly control: DesktopBrowserControl) {
    this.resources = new SessionResources(ctx, {
      label: 'web-test-browser-execution-group', exclusive: false,
      open: async (agent, signal) => {
        signal.throwIfAborted()
        const admission = this.admissions.get(agent)
        if (admission === undefined) throw new Error('desktop browser: execution group has no trusted admission')
        try {
          const bindings = await control.bindGroup(admission.owner, admission.targets, this.#authority)
          return { value: bindings, close: async () => {
            try { await control.releaseGroup(admission.owner.group, this.#authority) }
            finally { this.admissions.delete(agent) }
          } }
        } catch (error) {
          this.admissions.delete(agent)
          throw error
        }
      },
    })
    this.#authority = bindDesktopBrowserExecutionAuthority(ctx, control, () => this.dispose())
  }

  /**
   * Own one complete group interval through one non-nested SessionResources.run callback.
   * @param agent - exact live Agent activation associated with the owner.
   * @param owner - trusted project/batch/activation identity created before role guests.
   * @param targets - complete Main-created role targets for that owner.
   * @param signal - closes admission immediately when the interval is canceled.
   * @param operation - coordinates roles directly; it must not call provider tools or another run for this Agent.
   * @returns the callback result after all operations it owns settle.
   */
  run<R>(agent: Agent, owner: DesktopBrowserExecutionOwner, targets: readonly DesktopBrowserControlledTarget[], signal: AbortSignal,
    operation: (executor: BrowserRoleExecutor, signal: AbortSignal) => Promise<R>): Promise<R> {
    if (this.ctx.get('agents')?.currentInitiator() !== undefined) throw new Error('desktop browser: models cannot manage execution groups')
    if (agent.session.id !== owner.sessionId) throw new Error('desktop browser: execution group belongs to another Agent Session')
    const admission = this.admissions.get(agent)
    if (admission !== undefined && (!sameBrowserExecutionOwner(admission.owner, owner)
      || admission.targets.length !== targets.length
      || !admission.targets.every(target => targets.some(item => item.target === target.target)))) {
      throw new Error('desktop browser: live Agent cannot replace its execution group')
    }
    if (admission === undefined) this.admissions.set(agent, { owner, targets })
    return this.resources.run(agent, signal, async (bindings, combined) => {
      let active = true
      const pending = new Set<Promise<DesktopBrowserCommandResult>>()
      const executor: BrowserRoleExecutor = {
        submit: (role, body) => {
          if (!active) throw new Error('desktop browser: execution callback has ended')
          combined.throwIfAborted()
          const binding = bindings.find(item => item.executionRole.role === role)
          if (binding === undefined) throw new Error('desktop browser: role is not part of this execution group')
          const work = this.control.submitRole(binding, body, combined, this.#authority)
          pending.add(work)
          void work.finally(() => { pending.delete(work) }).catch(() => {})
          return work
        },
      }
      try { return await operation(executor, combined) }
      finally {
        active = false
        await Promise.allSettled(pending)
      }
    })
  }

  /**
   * Withdraw every group and await its resource operations.
   * @returns after group withdrawal and every resource operation have reached quiescence.
   */
  dispose(): Promise<void> { return this.resources.dispose() }
}
