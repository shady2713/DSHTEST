/** Private Main publications and acknowledged Session ownership for trusted Host consumers. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { DesktopBrowserControl, DESKTOP_BROWSER_AUTOMATION_VERSION, readBrowserExecutionRole,
  sameBrowserExecutionOwner, hasDesktopBrowserExecutionAuthority } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type {
  DesktopBrowserAutomationBridge, DesktopBrowserBinding, DesktopBrowserBindingRequest, DesktopBrowserBindingResult,
  DesktopBrowserCommandBody, DesktopBrowserCommandResult, DesktopBrowserControlledTarget, DesktopBrowserControlState,
  DesktopBrowserTargetId, DesktopBrowserWorkspaceKey,
  DesktopBrowserExecutionOwner, DesktopBrowserGroupId, DesktopBrowserRoleBinding, DesktopBrowserRoleGrantId,
  DesktopBrowserGroupBindingRequest,
  DesktopBrowserExecutionAuthority,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent'

/** Private transport supplied by the Desktop Host process, never by profile or model input. */
export interface HostBrowserControlOptions {
  readonly bridge: DesktopBrowserAutomationBridge
  readonly send: (message: object) => Promise<void>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** @param value - private Main publication. @returns validated complete state, or undefined for an unreadable payload. */
export function readBrowserControlState(value: unknown): DesktopBrowserControlState | undefined {
  if (!record(value) || value.version !== DESKTOP_BROWSER_AUTOMATION_VERSION || !count(value.hostEpoch)
    || !count(value.revision) || !Array.isArray(value.targets)) return undefined
  const targets: DesktopBrowserControlledTarget[] = []
  const ids = new Set<string>()
  for (const candidate of value.targets) {
    if (!record(candidate) || candidate.hostEpoch !== value.hostEpoch || typeof candidate.target !== 'string'
      || candidate.target.length === 0 || ids.has(candidate.target) || typeof candidate.workspace !== 'string'
      || candidate.workspace.length === 0 || typeof candidate.url !== 'string' || !URL.canParse(candidate.url)) return undefined
    const url = new URL(candidate.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') return undefined
    ids.add(candidate.target)
    const executionRole = candidate.executionRole === undefined ? undefined : readBrowserExecutionRole(candidate.executionRole)
    if (candidate.executionRole !== undefined && (executionRole === undefined || executionRole.owner.hostEpoch !== value.hostEpoch
      || executionRole.owner.workspace !== candidate.workspace)) return undefined
    targets.push({ target: brandString<DesktopBrowserTargetId>(candidate.target), hostEpoch: value.hostEpoch,
      workspace: brandString<DesktopBrowserWorkspaceKey>(candidate.workspace), url: url.href,
      ...(executionRole === undefined ? {} : { executionRole }) })
  }
  return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, hostEpoch: value.hostEpoch, revision: value.revision, targets }
}

function readBindingResult(value: unknown): DesktopBrowserBindingResult | undefined {
  if (!record(value) || value.version !== DESKTOP_BROWSER_AUTOMATION_VERSION || !count(value.requestId)
    || !count(value.hostEpoch) || typeof value.ok !== 'boolean') return undefined
  return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: value.requestId, hostEpoch: value.hostEpoch, ok: value.ok }
}

/** Implements the stable Service Definition over the Host's private Main connection. */
export class HostBrowserControl extends DesktopBrowserControl {
  static inject = ['sessions', 'workspaceRegistry']
  private state: DesktopBrowserControlState | undefined
  private nextRequestId = 0
  private readonly bindings = new Map<SessionId, DesktopBrowserTargetId>()
  private readonly groups = new Map<DesktopBrowserGroupId, {
    owner: DesktopBrowserExecutionOwner
    roles: readonly DesktopBrowserRoleBinding[]
    acknowledged: boolean
  }>()
  private readonly pendingGroups = new Map<number, {
    state: DesktopBrowserControlState
    request: DesktopBrowserGroupBindingRequest
    resolve: () => void
    reject: (error: Error) => void
  }>()
  private readonly pending = new Map<number, {
    readonly request: DesktopBrowserBindingRequest
    readonly state: DesktopBrowserControlState
    readonly resolve: (result: DesktopBrowserBindingResult) => void
    readonly reject: (error: Error) => void
  }>()

  constructor(ctx: Context, private readonly options: HostBrowserControlOptions) {
    super(ctx)
    ctx.effect(() => () => { this.disconnect() }, 'desktopBrowserControl.connection')
  }

  targets(): readonly DesktopBrowserControlledTarget[] { return this.state?.targets.map(target => ({ ...target })) ?? [] }

  async bind(sessionId: SessionId, targetId: DesktopBrowserTargetId): Promise<DesktopBrowserBinding> {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error('desktop browser: Session does not exist')
    const target = this.state?.targets.find(item => item.target === targetId)
    if (target === undefined) throw new Error('desktop browser: target is unavailable')
    if (target.executionRole !== undefined) throw new Error('desktop browser: role targets require an execution group')
    const workspace = this.ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(session.id))
    const key = workspace === undefined ? `session:${session.id}` : `cwd:${workspace.path}`
    if (target.workspace !== key) throw new Error('desktop browser: target belongs to another workspace')
    if (this.bindings.has(sessionId) || [...this.groups.values()].some(group => group.owner.sessionId === sessionId)
      || [...this.bindings.values()].includes(targetId)
      || [...this.pending.values()].some(item => item.request.sessionId === sessionId || item.request.target === targetId)) {
      throw new Error('desktop browser: Session or target already has an owner')
    }
    const state = this.state
    await this.requestBinding('bind', sessionId, target)
    if (state !== this.state) throw new Error('desktop browser: target publication changed after acknowledgement')
    this.bindings.set(sessionId, targetId)
    const binding = this.binding(sessionId)
    if (binding === undefined) throw new Error('desktop browser: target was withdrawn before binding completed')
    return binding
  }

  async unbind(sessionId: SessionId): Promise<void> {
    const binding = this.binding(sessionId)
    this.bindings.delete(sessionId)
    if (binding !== undefined) await this.requestBinding('unbind', sessionId, binding)
  }

  binding(sessionId: SessionId): DesktopBrowserBinding | undefined {
    const targetId = this.bindings.get(sessionId)
    const target = this.state?.targets.find(item => item.target === targetId)
    const session = this.ctx.sessions.get(sessionId)
    if (target === undefined || session === undefined) return undefined
    const workspace = this.ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(session.id))
    if (target.workspace !== (workspace === undefined ? `session:${session.id}` : `cwd:${workspace.path}`)) return undefined
    return { ...target, sessionId }
  }

  async submit(sessionId: SessionId, body: DesktopBrowserCommandBody, signal?: AbortSignal): Promise<DesktopBrowserCommandResult> {
    const binding = this.binding(sessionId)
    const requestId = ++this.nextRequestId
    if (binding === undefined || signal?.aborted === true) return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId,
      ok: false, outcome: 'not-executed', reason: 'session-not-authorized' }
    return await this.options.bridge.submit({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId,
      hostEpoch: binding.hostEpoch, target: binding.target, sessionId, body }, signal)
  }

  override async bindGroup(owner: DesktopBrowserExecutionOwner,
    targets: readonly DesktopBrowserControlledTarget[],
    authority: DesktopBrowserExecutionAuthority): Promise<readonly DesktopBrowserRoleBinding[]> {
    this.requireTrustedGroupConsumer(authority)
    const state = this.state
    const session = this.ctx.sessions.get(owner.sessionId)
    const workspace = this.ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(owner.sessionId))
    const key = workspace === undefined ? `session:${owner.sessionId}` : `cwd:${workspace.path}`
    if (state === undefined || session === undefined || owner.hostEpoch !== state.hostEpoch || owner.workspace !== key
      || targets.length === 0) throw new Error('desktop browser: execution owner is unavailable')
    if (this.groups.has(owner.group) || this.bindings.has(owner.sessionId)
      || [...this.groups.values()].some(group => group.owner.sessionId === owner.sessionId)
      || [...this.pending.values()].some(wait => wait.request.sessionId === owner.sessionId)) {
      throw new Error('desktop browser: Session already has a browser owner')
    }
    const roleNames = new Set<string>(), targetIds = new Set<string>()
    const roles = targets.map((candidate) => {
      const target = state.targets.find(item => item.target === candidate.target)
      const role = target?.executionRole
      if (target === undefined || role === undefined || !sameBrowserExecutionOwner(owner, role.owner)
        || roleNames.has(role.role) || targetIds.has(target.target) || [...this.bindings.values()].includes(target.target)) {
        throw new Error('desktop browser: target does not belong to the exact execution role')
      }
      roleNames.add(role.role); targetIds.add(target.target)
      return { ...target, executionRole: role, grant: brandString<DesktopBrowserRoleGrantId>(randomUUID()) }
    })
    const group = { owner, roles, acknowledged: false }
    this.groups.set(owner.group, group)
    try {
      await this.requestGroup('bind-group', owner, roles)
      if (this.groups.get(owner.group) !== group || this.state !== state) throw new Error('desktop browser: execution group was revoked')
      group.acknowledged = true
      return roles.map(role => ({ ...role }))
    } catch (error) {
      if (this.groups.get(owner.group) === group) this.groups.delete(owner.group)
      throw error
    }
  }

  override async releaseGroup(groupId: DesktopBrowserGroupId, authority: DesktopBrowserExecutionAuthority): Promise<void> {
    // Effect-owned cleanup may inherit the Agent that initiated teardown; the opaque token still owns withdrawal.
    this.requireTrustedGroupConsumer(authority, true)
    const group = this.groups.get(groupId)
    this.groups.delete(groupId)
    if (group !== undefined && this.state?.hostEpoch === group.owner.hostEpoch) {
      await this.requestGroup('release-group', group.owner, group.roles)
    }
  }

  override async submitRole(binding: DesktopBrowserRoleBinding, body: DesktopBrowserCommandBody,
    signal: AbortSignal, authority: DesktopBrowserExecutionAuthority): Promise<DesktopBrowserCommandResult> {
    const requestId = ++this.nextRequestId
    if (!hasDesktopBrowserExecutionAuthority(authority, this) || this.ctx.get('agents')?.currentInitiator() !== undefined) {
      return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId, ok: false, outcome: 'not-executed', reason: 'session-not-authorized' }
    }
    const group = this.groups.get(binding.executionRole.owner.group)
    const current = group?.roles.find(role => role.grant === binding.grant && role.target === binding.target
      && role.executionRole.role === binding.executionRole.role
      && sameBrowserExecutionOwner(role.executionRole.owner, binding.executionRole.owner))
    if (signal.aborted || group?.acknowledged !== true || current === undefined
      || this.ctx.sessions.get(group.owner.sessionId) === undefined
      || !this.state?.targets.some(target => target.target === current.target && target.executionRole !== undefined
        && sameBrowserExecutionOwner(target.executionRole.owner, group.owner)
        && target.executionRole.role === current.executionRole.role)) {
      return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId, ok: false, outcome: 'not-executed', reason: 'revoked' }
    }
    return await this.options.bridge.submit({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId, hostEpoch: current.hostEpoch,
      target: current.target, sessionId: group.owner.sessionId, role: current, body }, signal)
  }

  /** @param message - one private Main message. @returns true when this service consumed its declared message kind. */
  accept(message: unknown): boolean {
    if (!record(message)) return false
    if (message.type === 'browser-control-state') {
      const next = readBrowserControlState(message.state)
      if (next === undefined) { this.disconnect(); throw new Error('desktop browser: invalid Main target publication') }
      if (this.state !== undefined && (next.hostEpoch < this.state.hostEpoch
        || (next.hostEpoch === this.state.hostEpoch && next.revision <= this.state.revision))) return true
      const changedEpoch = next.hostEpoch !== this.state?.hostEpoch
      if (changedEpoch) { this.bindings.clear(); this.groups.clear() }
      this.state = next
      this.options.bridge.connectHost(next.hostEpoch)
      for (const [sessionId, target] of this.bindings) {
        if (!next.targets.some(item => item.target === target)) this.bindings.delete(sessionId)
      }
      for (const [id, group] of this.groups) {
        if (!group.roles.every(role => next.targets.some(target => target.target === role.target))) this.groups.delete(id)
      }
      for (const [id, waiting] of this.pendingGroups) {
        this.pendingGroups.delete(id)
        waiting.reject(new Error('desktop browser: target publication changed before group acknowledgement'))
      }
      for (const [id, waiting] of this.pending) {
        this.pending.delete(id)
        waiting.reject(new Error('desktop browser: target publication changed before acknowledgement'))
      }
      return true
    }
    if (message.type === 'browser-group-binding-result') {
      const result = readBindingResult(message.result)
      if (result === undefined) { this.disconnect(); throw new Error('desktop browser: invalid group acknowledgement') }
      const waiting = this.pendingGroups.get(result.requestId)
      if (waiting === undefined) return true
      this.pendingGroups.delete(result.requestId)
      if (!result.ok || result.hostEpoch !== waiting.request.owner.hostEpoch || waiting.state !== this.state) {
        waiting.reject(new Error('desktop browser: Main refused or withdrew the execution group'))
      } else waiting.resolve()
      return true
    }
    if (message.type !== 'browser-binding-result') return false
    const result = readBindingResult(message.result)
    if (result === undefined) { this.disconnect(); throw new Error('desktop browser: invalid Main binding acknowledgement') }
    const waiting = this.pending.get(result.requestId)
    if (waiting === undefined) return true
    this.pending.delete(result.requestId)
    if (!result.ok || result.hostEpoch !== waiting.request.hostEpoch || waiting.state !== this.state) {
      waiting.reject(new Error('desktop browser: Main refused or withdrew the Session binding'))
    } else waiting.resolve(result)
    return true
  }

  /** Withdraw bindings and settle pending authorizations when Main disconnects. */
  disconnect(): void {
    if (this.state !== undefined) this.options.bridge.disconnectHost(this.state.hostEpoch)
    this.state = undefined
    this.bindings.clear()
    this.groups.clear()
    for (const [id, waiting] of this.pendingGroups) {
      this.pendingGroups.delete(id)
      waiting.reject(new Error('desktop browser: Main connection was lost'))
    }
    for (const [id, waiting] of this.pending) {
      this.pending.delete(id)
      waiting.reject(new Error('desktop browser: Main connection was lost'))
    }
  }

  private async requestGroup(kind: DesktopBrowserGroupBindingRequest['kind'], owner: DesktopBrowserExecutionOwner,
    roles: readonly DesktopBrowserRoleBinding[]): Promise<void> {
    const state = this.state
    if (state === undefined) throw new Error('desktop browser: Main is disconnected')
    const request: DesktopBrowserGroupBindingRequest = { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: ++this.nextRequestId,
      revision: state.revision, kind, owner, roles }
    const answer = new Promise<void>((resolve, reject) => {
      this.pendingGroups.set(request.requestId, { request, state, resolve, reject })
    })
    void this.options.send({ type: 'browser-group-binding', request }).catch((error: unknown) => {
      const waiting = this.pendingGroups.get(request.requestId)
      this.pendingGroups.delete(request.requestId)
      waiting?.reject(error instanceof Error ? error : new Error('desktop browser: group transport failed'))
    })
    await answer
  }

  private requireTrustedGroupConsumer(authority: DesktopBrowserExecutionAuthority, cleanup = false): void {
    if (!hasDesktopBrowserExecutionAuthority(authority, this) || (!cleanup && this.ctx.get('agents')?.currentInitiator() !== undefined)) {
      throw new Error('desktop browser: execution groups require private Runtime authority')
    }
  }

  private async requestBinding(kind: 'bind' | 'unbind', sessionId: SessionId, target: DesktopBrowserControlledTarget): Promise<void> {
    const state = this.state
    if (state === undefined) throw new Error('desktop browser: Main is disconnected')
    const request: DesktopBrowserBindingRequest = { version: DESKTOP_BROWSER_AUTOMATION_VERSION,
      requestId: ++this.nextRequestId, hostEpoch: state.hostEpoch, revision: state.revision,
      kind, sessionId, target: target.target, workspace: target.workspace }
    const answer = new Promise<DesktopBrowserBindingResult>((resolve, reject) => {
      this.pending.set(request.requestId, { request, state, resolve, reject })
    })
    void this.options.send({ type: 'browser-binding', request }).catch((error: unknown) => {
      const pending = this.pending.get(request.requestId)
      this.pending.delete(request.requestId)
      pending?.reject(error instanceof Error ? error : new Error('desktop browser: binding transport failed'))
    })
    await answer
  }
}
