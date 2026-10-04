/**
 * The Main's authoritative map from a target identity to the guest behind it.
 *
 * A `DesktopBrowserTargetId` is a brand the Host can print and reuse; it is an
 * address, not a permission. This registry is what turns that address into the one
 * guest the current Host is allowed to act on: it holds the target only while its
 * own Host generation is the connected one, drops it when the guest's lease is
 * released, and drops every target of a Host that has been replaced.
 *
 * It performs no Electron work, so every revocation rule is testable without a
 * browser.
 */

import {
  DESKTOP_BROWSER_AUTOMATION_VERSION,
  sameBrowserExecutionOwner,
  type DesktopBrowserBindingRequest,
  type DesktopBrowserBindingResult,
  type DesktopBrowserControlState,
  type DesktopBrowserTargetId,
  type DesktopBrowserGroupBindingRequest, type DesktopBrowserGroupId, type DesktopBrowserRoleBinding,
  type DesktopBrowserCommand,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { BrowserAutomationTarget } from './browser-automation.ts'

/** Target ids a Host may address, and the epoch each belongs to. */
interface Grant {
  readonly target: BrowserAutomationTarget
  readonly hostEpoch: number
}

/** One connected Host generation, and the targets it was granted. */
export class HostTargetRegistry {
  private epoch = 0
  private readonly grants = new Map<DesktopBrowserTargetId, Grant>()
  private revision = 0
  private readonly listeners = new Set<(state: DesktopBrowserControlState) => void>()
  private readonly groups = new Map<DesktopBrowserGroupId, readonly DesktopBrowserRoleBinding[]>()

  /**
   * Open a generation for a newly connected Host. Every target granted to a previous
   * generation stops being addressable, so a restarted Host cannot act through its
   * predecessor's identity.
   * @returns the epoch the connected Host stamps its commands with.
   */
  connectHost(): number {
    for (const { target } of this.grants.values()) target.revoke()
    this.grants.clear()
    this.groups.clear()
    this.epoch += 1
    this.publish()
    return this.epoch
  }

  /** @returns the epoch the connected Host is currently served. */
  currentEpoch(): number {
    return this.epoch
  }

  /**
   * Record one guest as addressable by the connected Host.
   * @param target - the leased guest, whose own `hostEpoch` must be the connected one.
   * @returns the disposer that withdraws the address, called when the lease is released.
   */
  register(target: BrowserAutomationTarget): () => void {
    this.grants.set(target.id, { target, hostEpoch: target.hostEpoch })
    this.publish()
    return () => {
      target.revoke()
      if (this.grants.get(target.id)?.target === target) this.grants.delete(target.id)
      for (const [id, roles] of this.groups) {
        if (roles.some(role => role.target === target.id)) this.releaseRoles(id, roles)
      }
      this.publish()
    }
  }

  /**
   * Resolve one address to the guest it names.
   * @param id - identity from a command.
   * @returns the live target the connected Host owns at that identity, or undefined
   *   when the grant belongs to another generation or the guest has gone.
   */
  resolve(id: string): BrowserAutomationTarget | undefined {
    const found = this.grants.get(id as DesktopBrowserTargetId)
    if (found === undefined || found.hostEpoch !== this.epoch) return undefined
    return found.target.live() ? found.target : undefined
  }

  /**
   * Withdraw every grant of a generation, so a disconnecting or replaced Host stops
   * being able to reach the guests it was given.
   * @param hostEpoch - generation that ended; other generations are left alone.
   */
  revokeHost(hostEpoch: number): void {
    if (hostEpoch !== this.epoch) return
    for (const { target } of this.grants.values()) target.revoke()
    this.grants.clear()
    this.groups.clear()
    this.publish()
  }

  /** @returns complete current targets; inert bootstrap documents are excluded. */
  state(): DesktopBrowserControlState {
    return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, hostEpoch: this.epoch, revision: this.revision,
      targets: [...this.grants.values()].flatMap(({ target, hostEpoch }) => {
        const url = target.url()
        if (hostEpoch !== this.epoch || !target.live() || !URL.canParse(url)) return []
        const parsed = new URL(url)
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== '' || parsed.password !== '') return []
        return [{ target: target.id, hostEpoch, workspace: target.workspace, url,
          ...(target.executionRole === undefined ? {} : { executionRole: target.executionRole }) }]
      }) }
  }

  /** Publish a complete state after the guest's URL changes. */
  changed(): void { this.publish() }

  /** @param listener - current-connection state consumer. @returns unsubscribe callback. */
  subscribe(listener: (state: DesktopBrowserControlState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state())
    return () => { this.listeners.delete(listener) }
  }

  /** @param request - validated private Host request. @returns Main's correlated authorization acknowledgement. */
  bind(request: DesktopBrowserBindingRequest): DesktopBrowserBindingResult {
    const target = this.resolve(request.target)
    let ok = request.hostEpoch === this.epoch && target !== undefined && target.workspace === request.workspace
      && target.executionRole === undefined
    if (ok && target !== undefined) {
      const owner = target.authorizedSession()
      if (request.kind === 'bind') {
        ok = request.revision === this.revision && (owner === undefined || owner === request.sessionId)
        if (ok) {
          try { target.authorize(request.sessionId) }
          catch (_error) { ok = false }
        }
      } else {
        ok = owner === request.sessionId
        if (ok) target.authorize(undefined)
      }
    }
    return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: request.requestId, hostEpoch: this.epoch, ok }
  }

  /** @param request - validated private Host group request. @returns correlated atomic authorization acknowledgement. */
  bindGroup(request: DesktopBrowserGroupBindingRequest): DesktopBrowserBindingResult {
    const { owner, roles } = request
    let ok = owner.hostEpoch === this.epoch
    const existing = this.groups.get(owner.group)
    if (request.kind === 'release-group') {
      ok = ok && (existing === undefined || (existing.length === roles.length && existing.every(current => roles.some(role =>
        role.grant === current.grant && role.target === current.target && role.executionRole.role === current.executionRole.role
        && sameBrowserExecutionOwner(current.executionRole.owner, role.executionRole.owner)))))
      if (ok && existing !== undefined) this.releaseRoles(owner.group, existing)
    } else {
      ok = ok && request.revision === this.revision && roles.length > 0 && existing === undefined
        && ![...this.groups.values()].some(group => group[0]?.executionRole.owner.sessionId === owner.sessionId)
        && ![...this.grants.values()].some(grant => grant.target.authorizedSession() === owner.sessionId)
        && new Set(roles.map(role => role.target)).size === roles.length
        && new Set(roles.map(role => role.executionRole.role)).size === roles.length
        && new Set(roles.map(role => role.grant)).size === roles.length
        && roles.every((role) => {
          const target = this.resolve(role.target)
          return sameBrowserExecutionOwner(owner, role.executionRole.owner) && target?.executionRole !== undefined
            && sameBrowserExecutionOwner(owner, target.executionRole.owner) && target.executionRole.role === role.executionRole.role
            && target.workspace === owner.workspace && target.authorizedSession() === undefined
        })
      if (ok) {
        const authorized: BrowserAutomationTarget[] = []
        try {
          for (const role of roles) {
            const target = this.resolve(role.target)
            if (target === undefined) throw new Error('desktop browser: role target disappeared')
            target.authorize(owner.sessionId); authorized.push(target)
          }
          this.groups.set(owner.group, roles)
        } catch (_error) {
          for (const target of authorized) target.authorize(undefined)
          ok = false
        }
      }
    }
    return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: request.requestId, hostEpoch: this.epoch, ok }
  }

  /** @param command - validated command. @returns whether the current Main authorization matches its exact role grant. */
  authorizedCommand(command: DesktopBrowserCommand): boolean {
    const target = this.resolve(command.target)
    if (target === undefined || target.authorizedSession() !== command.sessionId || command.hostEpoch !== this.epoch) return false
    if (target.executionRole === undefined) return command.role === undefined
    const role = command.role
    if (role === undefined) return false
    const current = this.groups.get(role.executionRole.owner.group)?.find(item => item.grant === role.grant)
    return current !== undefined && current.target === command.target && current.executionRole.role === role.executionRole.role
      && sameBrowserExecutionOwner(current.executionRole.owner, role.executionRole.owner)
      && current.executionRole.owner.sessionId === command.sessionId
      && sameBrowserExecutionOwner(current.executionRole.owner, target.executionRole.owner)
      && target.executionRole.role === current.executionRole.role
  }

  private releaseRoles(group: DesktopBrowserGroupId, roles: readonly DesktopBrowserRoleBinding[]): void {
    this.groups.delete(group)
    for (const role of roles) this.resolve(role.target)?.authorize(undefined)
  }

  private publish(): void {
    this.revision += 1
    const state = this.state()
    for (const listener of [...this.listeners]) {
      try { listener(state) } catch (error) { console.error(error) }
    }
  }
}
