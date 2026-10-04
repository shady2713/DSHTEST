import { SessionId } from '@deepseek-ai/dsh-session'
import type { DesktopBrowserWorkspaceKey } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
/**
 * The Main's target registry: an address is not a permission.
 *
 * Every rule here is about refusing something that looks addressable — a replayed
 * identity, a predecessor's generation, a released guest — without needing a browser.
 */

import { expect, it } from 'vitest'
import { DESKTOP_BROWSER_AUTOMATION_VERSION, readBrowserExecutionOwner, readBrowserRoleBinding,
  type DesktopBrowserGroupBindingRequest, type DesktopBrowserBindingRequest, type DesktopBrowserTargetId } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { HostTargetRegistry } from '../src/automation-targets.ts'
import type { BrowserAutomationTarget } from '../src/browser-automation.ts'

const ID = 'guest-1' as DesktopBrowserTargetId

it('atomically binds isolated roles, refuses single/cross-role reuse and revokes every grant when one target closes', () => {
  const registry = new HostTargetRegistry()
  const epoch = registry.connectHost()
  const owner = readBrowserExecutionOwner({ group: 'group-1', activation: 'activation-1', project: 'project-1', run: 'run-1',
    sessionId: 'controls-owner', workspace: 'session:controls-owner', hostEpoch: epoch })!
  const roles = ['author', 'reviewer'].map(role => readBrowserRoleBinding({ target: role, hostEpoch: epoch, workspace: owner.workspace,
    url: 'https://example.test/', executionRole: { owner, role }, grant: `grant-${role}` })!)
  const releases = roles.map((role) => {
    let authorized: SessionId | undefined
    return registry.register({ ...guest(role.target, epoch), executionRole: role.executionRole,
      authorizedSession: () => authorized, authorize: (session) => { authorized = session } })
  })
  const request: DesktopBrowserGroupBindingRequest = { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 42,
    revision: registry.state().revision, kind: 'bind-group', owner, roles }
  expect(registry.bindGroup({ ...request, roles: [roles[0]!, { ...roles[1]!, executionRole: roles[0]!.executionRole }] }).ok).toBe(false)
  expect(registry.bindGroup(request).ok).toBe(true)
  const command = { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 1, hostEpoch: epoch,
    target: roles[0]!.target, sessionId: owner.sessionId, role: roles[0]!, body: { kind: 'observe' } } as const
  expect(registry.authorizedCommand(command)).toBe(true)
  expect(registry.authorizedCommand({ ...command, role: roles[1]! })).toBe(false)
  expect(registry.authorizedCommand({ ...command, role: { ...roles[0]!, grant: roles[1]!.grant } })).toBe(false)
  expect(registry.bind({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 2, revision: registry.state().revision,
    hostEpoch: epoch, sessionId: owner.sessionId, kind: 'bind', workspace: owner.workspace, target: roles[0]!.target }).ok).toBe(false)
  releases[1]!()
  expect(registry.authorizedCommand(command)).toBe(false)
  expect(registry.resolve(roles[0]!.target)?.authorizedSession()).toBeUndefined()
  expect(registry.bindGroup({ ...request, kind: 'release-group' }).ok).toBe(true)
})

it('refuses an old release grant after a group was withdrawn and rebound', () => {
  const registry = new HostTargetRegistry()
  const epoch = registry.connectHost()
  const owner = readBrowserExecutionOwner({ group: 'group-1', activation: 'activation-1', project: 'project-1', run: 'run-1',
    sessionId: 'controls-owner', workspace: 'session:controls-owner', hostEpoch: epoch })!
  const role = readBrowserRoleBinding({ target: ID, hostEpoch: epoch, workspace: owner.workspace, url: 'https://example.test/',
    executionRole: { owner, role: 'author' }, grant: 'first-grant' })!
  let authorized: SessionId | undefined
  registry.register({ ...guest(ID, epoch), executionRole: role.executionRole, authorizedSession: () => authorized,
    authorize: (session) => { authorized = session } })
  const request: DesktopBrowserGroupBindingRequest = { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 1,
    revision: registry.state().revision, kind: 'bind-group', owner, roles: [role] }
  expect(registry.bindGroup(request).ok).toBe(true)
  expect(registry.bindGroup({ ...request, kind: 'release-group' }).ok).toBe(true)
  const replacement = readBrowserRoleBinding({ ...role, grant: 'second-grant' })!
  expect(registry.bindGroup({ ...request, roles: [replacement] }).ok).toBe(true)
  expect(registry.bindGroup({ ...request, kind: 'release-group' }).ok).toBe(false)
  expect(authorized).toBe(owner.sessionId)
})

/** A guest that is alive unless the test says otherwise. */
function guest(id: string, hostEpoch: number): BrowserAutomationTarget {
  return {
    id: id as DesktopBrowserTargetId,
    hostEpoch,
    workspace: 'session:controls-owner' as DesktopBrowserWorkspaceKey,
    url: () => 'https://example.test/',
    authorizedSession: () => SessionId('controls-owner'),
    authorize: () => {},
    authorizedDocument: () => true,
    prepareInput: () => true,
    inputReady: () => true,
    revoke: () => {},
    live: () => true,
    currentObservation: () => undefined,
    observe: async () => { throw new Error('not used') },
    revalidate: async () => undefined,
    screenshot: async () => new Uint8Array(),
    click: async () => {},
    doubleClick: async () => {},
    pressKey: async () => {},
    canNavigate: () => true,
    navigate: async () => {},
    reload: async () => {},
    type: async () => {},
  }
}

it('resolves a target only while the generation that was granted it is connected', () => {
  const registry = new HostTargetRegistry()
  const first = registry.connectHost()
  const target = guest(ID, first)
  registry.register(target)

  expect(first).toBe(1)
  expect(registry.resolve(ID)).toBe(target)

  const second = registry.connectHost()
  expect(second).toBe(2)
  // The identity is unchanged, but the previous Host's grant is gone: a restarted
  // Host cannot act through the generation that came before it.
  expect(registry.resolve(ID)).toBeUndefined()
})

it('does not resolve a target granted to a generation other than the connected one', () => {
  const registry = new HostTargetRegistry()
  const epoch = registry.connectHost()
  registry.register(guest(ID, epoch - 1))

  expect(registry.resolve(ID)).toBeUndefined()
})

it('stops resolving once the lease disposer runs', () => {
  const registry = new HostTargetRegistry()
  const epoch = registry.connectHost()
  const release = registry.register(guest(ID, epoch))
  expect(registry.resolve(ID)).toBeDefined()

  release()

  expect(registry.resolve(ID)).toBeUndefined()
})

it('stops resolving once the guest is gone, even while its grant stands', () => {
  const registry = new HostTargetRegistry()
  const epoch = registry.connectHost()
  let alive = true
  registry.register({ ...guest(ID, epoch), live: () => alive })

  expect(registry.resolve(ID)).toBeDefined()
  alive = false
  expect(registry.resolve(ID)).toBeUndefined()
})

it('refuses an identity it was never granted', () => {
  const registry = new HostTargetRegistry()
  registry.connectHost()

  expect(registry.resolve(ID)).toBeUndefined()
  expect(registry.resolve('')).toBeUndefined()
})

it.each(['replace', 'disconnect', 'release'] as const)('revokes already captured targets on %s', (mode) => {
  const registry = new HostTargetRegistry()
  const epoch = registry.connectHost()
  let revoked = false
  const target = { ...guest(ID, epoch), revoke: () => { revoked = true }, live: () => !revoked }
  const release = registry.register(target)
  const captured = registry.resolve(ID)
  if (mode === 'replace') registry.connectHost()
  else if (mode === 'disconnect') registry.revokeHost(epoch)
  else release()
  expect(captured?.live()).toBe(false)
})

it('revokes every target of the Host that disconnected, and no other', () => {
  const registry = new HostTargetRegistry()
  const epoch = registry.connectHost()
  const release = registry.register(guest(ID, epoch))

  registry.revokeHost(epoch - 1)
  expect(registry.resolve(ID)).toBeDefined()

  registry.revokeHost(epoch)
  expect(registry.resolve(ID)).toBeUndefined()
  // Revoking must not resurrect or disturb an unrelated disposer.
  expect(() => { release() }).not.toThrow()
})

it('acknowledges only a current exclusive Session binding in the target workspace', () => {
  const registry = new HostTargetRegistry()
  const epoch = registry.connectHost()
  let owner: ReturnType<typeof SessionId> | undefined
  const target = { ...guest(ID, epoch), authorizedSession: () => owner, authorize: (sessionId: typeof owner) => { owner = sessionId } }
  registry.register(target)
  const request: DesktopBrowserBindingRequest = { version: DESKTOP_BROWSER_AUTOMATION_VERSION, kind: 'bind',
    requestId: 19, hostEpoch: epoch, revision: registry.state().revision, target: ID,
    workspace: target.workspace, sessionId: SessionId('controls-owner') }
  expect(registry.bind({ ...request, workspace: 'session:foreign' as DesktopBrowserWorkspaceKey }).ok).toBe(false)
  expect(registry.bind({ ...request, hostEpoch: epoch - 1 }).ok).toBe(false)
  expect(registry.bind({ ...request, revision: request.revision - 1 }).ok).toBe(false)
  expect(owner).toBeUndefined()
  expect(registry.bind(request)).toEqual({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 19, hostEpoch: epoch, ok: true })
  expect(owner).toBe(request.sessionId)
  expect(registry.bind({ ...request, sessionId: SessionId('other-owner') }).ok).toBe(false)
  expect(registry.bind({ ...request, kind: 'unbind', sessionId: SessionId('other-owner') }).ok).toBe(false)
  expect(registry.bind({ ...request, kind: 'unbind' }).ok).toBe(true)
  expect(owner).toBeUndefined()
})

it('reports an invalid live binding document as a correlated refusal', () => {
  const registry = new HostTargetRegistry()
  const epoch = registry.connectHost()
  const target = { ...guest(ID, epoch), authorizedSession: () => undefined,
    authorize: () => { throw new Error('binding document is no longer permitted') } }
  registry.register(target)
  expect(registry.bind({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, kind: 'bind', requestId: 23,
    hostEpoch: epoch, revision: registry.state().revision, target: ID, workspace: target.workspace,
    sessionId: SessionId('controls-owner') })).toMatchObject({ requestId: 23, hostEpoch: epoch, ok: false })
})
