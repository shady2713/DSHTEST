/** Host Service Definition for explicit Session ownership of a Main-controlled guest. */
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  DesktopBrowserBinding, DesktopBrowserCommandBody, DesktopBrowserCommandResult,
  DesktopBrowserControlledTarget, DesktopBrowserTargetId,
  DesktopBrowserExecutionOwner, DesktopBrowserRoleBinding, DesktopBrowserGroupId,
  DesktopBrowserExecutionRole, DesktopBrowserGroupBindingRequest,
  DesktopBrowserActivationId, DesktopBrowserProjectId, DesktopBrowserRunId, DesktopBrowserRoleId,
  DesktopBrowserRoleGrantId, DesktopBrowserWorkspaceKey,
  DesktopBrowserExecutionAuthority,
} from './types.ts'
import { DESKTOP_BROWSER_AUTOMATION_VERSION } from './types.ts'

const executionAuthorities = new WeakMap<DesktopBrowserExecutionAuthority, { control: object; live: () => boolean }>()

function original(service: object): object {
  const value: unknown = Reflect.get(service, Symbol.for('cordis.original'))
  return typeof value === 'object' && value !== null ? value : service
}

/**
 * Bind execution-group authority to the fiber providing the actual trusted Runtime Service.
 * @param ctx - owning webTestRuntime context, after its Service constructor registered it.
 * @param control - exact Desktop Host control instance used by that Runtime.
 * @param drain - withdraw groups and await operations before authority ends.
 * @returns effect-owned opaque authority; unrelated contexts and model facades are refused.
 */
export function bindDesktopBrowserExecutionAuthority(ctx: Context, control: DesktopBrowserControl,
  drain: () => Promise<void>): DesktopBrowserExecutionAuthority {
  const record = ctx.fiber.store?.webTestRuntime
  const service: unknown = record?.value
  const owner: unknown = typeof service === 'object' && service !== null ? Reflect.get(original(service), 'ctx') : undefined
  if (record?.fiber !== ctx.fiber || record.name !== 'webTestRuntime' || !(service instanceof Service)
    || !Context.is(owner) || owner.fiber !== ctx.fiber) throw new Error('desktop browser: execution groups require an owning Runtime Service')
  const authority: DesktopBrowserExecutionAuthority = Object.freeze({ kind: 'trusted-desktop-execution-authority' })
  let active = true
  executionAuthorities.set(authority, { control: original(control), live: () => active })
  ctx.effect(() => async () => {
    try { await drain() } finally { active = false; executionAuthorities.delete(authority) }
  }, 'desktopBrowserControl.executionAuthority')
  return authority
}

/**
 * Validate opaque Runtime authority against its exact Desktop Host provider.
 * @param authority - opaque process-local token, never wire or model data.
 * @param control - provider reached by the operation.
 * @returns whether the live owning Runtime issued this token for that exact provider.
 */
export function hasDesktopBrowserExecutionAuthority(authority: DesktopBrowserExecutionAuthority, control: DesktopBrowserControl): boolean {
  const found = executionAuthorities.get(authority)
  return found !== undefined && found.live() && found.control === original(control)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4096 }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }

/**
 * Validate a private process owner identity.
 * @param value - private process payload.
 * @returns complete owner identity, or undefined when malformed.
 */
export function readBrowserExecutionOwner(value: unknown): DesktopBrowserExecutionOwner | undefined {
  if (!record(value) || !text(value.group) || !text(value.activation) || !text(value.project) || !text(value.run)
    || !text(value.sessionId) || !text(value.workspace) || !count(value.hostEpoch)) return undefined
  return { group: brandString<DesktopBrowserGroupId>(value.group), activation: brandString<DesktopBrowserActivationId>(value.activation),
    project: brandString<DesktopBrowserProjectId>(value.project), run: brandString<DesktopBrowserRunId>(value.run),
    sessionId: brandString<SessionId>(value.sessionId), workspace: brandString<DesktopBrowserWorkspaceKey>(value.workspace),
    hostEpoch: value.hostEpoch }
}

/**
 * Validate Main-issued role metadata.
 * @param value - private Main role metadata.
 * @returns complete role identity, or undefined when malformed.
 */
export function readBrowserExecutionRole(value: unknown): DesktopBrowserExecutionRole | undefined {
  if (!record(value) || !text(value.role)) return undefined
  const owner = readBrowserExecutionOwner(value.owner)
  return owner === undefined ? undefined : { owner, role: brandString<DesktopBrowserRoleId>(value.role) }
}

/**
 * Compare complete execution ownership identities.
 * @param a - expected owner.
 * @param b - observed owner.
 * @returns whether every owner field agrees.
 */
export function sameBrowserExecutionOwner(a: DesktopBrowserExecutionOwner, b: DesktopBrowserExecutionOwner): boolean {
  return a.group === b.group && a.activation === b.activation && a.project === b.project && a.run === b.run
    && a.sessionId === b.sessionId && a.hostEpoch === b.hostEpoch && a.workspace === b.workspace
}

/**
 * Validate a private Host role grant.
 * @param value - private Host role grant.
 * @returns complete grant, or undefined when malformed.
 */
export function readBrowserRoleBinding(value: unknown): DesktopBrowserRoleBinding | undefined {
  if (!record(value) || !text(value.target) || !text(value.workspace) || !text(value.grant) || !count(value.hostEpoch)
    || !text(value.url) || !URL.canParse(value.url)) return undefined
  const executionRole = readBrowserExecutionRole(value.executionRole)
  const url = new URL(value.url)
  if (executionRole === undefined || value.hostEpoch !== executionRole.owner.hostEpoch || value.workspace !== executionRole.owner.workspace
    || !['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') return undefined
  return { target: brandString<DesktopBrowserTargetId>(value.target), workspace: brandString<DesktopBrowserWorkspaceKey>(value.workspace),
    hostEpoch: value.hostEpoch, url: url.href, executionRole, grant: brandString<DesktopBrowserRoleGrantId>(value.grant) }
}

/**
 * Validate all identities in an atomic group authorization message.
 * @param value - private group authorization message.
 * @returns validated atomic request, or undefined when malformed.
 */
export function readBrowserGroupBindingRequest(value: unknown): DesktopBrowserGroupBindingRequest | undefined {
  if (!record(value) || value.version !== DESKTOP_BROWSER_AUTOMATION_VERSION || !count(value.requestId) || !count(value.revision)
    || !['bind-group', 'release-group'].includes(String(value.kind)) || !Array.isArray(value.roles) || value.roles.length === 0) return undefined
  const owner = readBrowserExecutionOwner(value.owner)
  if (owner === undefined) return undefined
  const roles: DesktopBrowserRoleBinding[] = []
  const targets = new Set<string>(), names = new Set<string>(), grants = new Set<string>()
  for (const valueRole of value.roles) {
    const role = readBrowserRoleBinding(valueRole)
    if (role === undefined || !sameBrowserExecutionOwner(owner, role.executionRole.owner) || targets.has(role.target)
      || names.has(role.executionRole.role) || grants.has(role.grant)) return undefined
    targets.add(role.target); names.add(role.executionRole.role); grants.add(role.grant); roles.push(role)
  }
  return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: value.requestId, revision: value.revision,
    kind: value.kind === 'bind-group' ? 'bind-group' : 'release-group', owner, roles }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopBrowserControl: DesktopBrowserControl
  }
}

/** Trusted Host consumers choose targets; model-facing tools can submit only for their own Session. */
export abstract class DesktopBrowserControl extends Service {
  constructor(ctx: Context) {
    super(ctx, 'desktopBrowserControl')
  }

  /**
   * List the current Main-controlled guests.
   * @returns the latest complete Main publication; disconnected targets are absent.
   */
  abstract targets(): readonly DesktopBrowserControlledTarget[]
  /**
   * Verify a live Session's workspace membership, reserve an exclusive target, and await Main acknowledgement.
   * @param sessionId - existing Session selected by a trusted consumer.
   * @param target - current Main-owned target selected by that consumer.
   * @returns the acknowledged binding; rejects missing Sessions, mismatched workspaces, or lost publications.
   */
  abstract bind(sessionId: SessionId, target: DesktopBrowserTargetId): Promise<DesktopBrowserBinding>
  /**
   * Withdraw one Session's acknowledged ownership.
   * @param sessionId - owning Session.
   * @returns after Main acknowledges withdrawal, or rejects a lost connection.
   */
  abstract unbind(sessionId: SessionId): Promise<void>
  /**
   * Read one Session's acknowledged ownership.
   * @param sessionId - owning Session.
   * @returns current acknowledged ownership and URL, or undefined when unavailable.
   */
  abstract binding(sessionId: SessionId): DesktopBrowserBinding | undefined
  /**
   * Submit an allowlisted command for an acknowledged Session binding.
   * @param sessionId - owning Session; the caller cannot select an alternative target.
   * @param body - allowlisted command using that Session's binding.
   * @param signal - optional cancellation before input dispatch; delivered actions retain their actual outcome.
   * @returns correlated Main result; a missing binding is confirmed non-execution, and no result permits automatic retry.
   */
  abstract submit(sessionId: SessionId, body: DesktopBrowserCommandBody, signal?: AbortSignal): Promise<DesktopBrowserCommandResult>

  /**
   * Atomically authorize the exact role targets created by the trusted runtime.
   * @param owner - live activation, project, batch, Session and Host identity.
   * @param targets - Main-created targets whose role metadata matches this owner.
   * @param authority - private authority bound to the real Runtime provider.
   * @returns acknowledged role grants; single bindings remain mutually exclusive.
   */
  bindGroup(owner: DesktopBrowserExecutionOwner,
    targets: readonly DesktopBrowserControlledTarget[],
    authority: DesktopBrowserExecutionAuthority): Promise<readonly DesktopBrowserRoleBinding[]> {
    void owner; void targets; void authority
    return Promise.reject(new Error('desktop browser: execution groups are not supported by this provider'))
  }
  /**
   * Revoke the group locally before waiting for Main withdrawal.
   * @param group - trusted execution group identity.
   * @param authority - private authority bound to the real Runtime provider.
   * @returns after its Main authorization is withdrawn.
   */
  releaseGroup(group: DesktopBrowserGroupId, authority: DesktopBrowserExecutionAuthority): Promise<void> {
    void group; void authority
    return Promise.reject(new Error('desktop browser: execution groups are not supported by this provider'))
  }
  /**
   * Execute on the exact acknowledged role, without selecting another target.
   * @param binding - role grant from bindGroup.
   * @param body - allowlisted operation for that role.
   * @param signal - cancellation closes admission before input dispatch.
   * @param authority - private authority bound to the real Runtime provider.
   * @returns correlated outcome; delivered actions cannot be canceled retroactively.
   */
  submitRole(binding: DesktopBrowserRoleBinding, body: DesktopBrowserCommandBody,
    signal: AbortSignal, authority: DesktopBrowserExecutionAuthority): Promise<DesktopBrowserCommandResult> {
    void binding; void body; void signal; void authority
    return Promise.reject(new Error('desktop browser: execution groups are not supported by this provider'))
  }
}
