/** Acknowledged Main target publications and formal Session authorization. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { DESKTOP_BROWSER_AUTOMATION_VERSION, readBrowserExecutionOwner, bindDesktopBrowserExecutionAuthority } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { DesktopBrowserBindingRequest, DesktopBrowserCommand, DesktopBrowserControlState, DesktopBrowserTargetId,
  DesktopBrowserWorkspaceKey, DesktopBrowserExecutionAuthority } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { HostBrowserControl, readBrowserControlState } from '../src/browser-control.ts'
import { installDesktopBrowserAutomation } from '../src/browser-automation.ts'

const SESSION = SessionId('actual-session')
const OTHER = SessionId('other-session')
const TARGET = 'actual-guest' as DesktopBrowserTargetId
const KEY = 'session:actual-session' as DesktopBrowserWorkspaceKey
let ctx: Context
let control: HostBrowserControl
let requests: DesktopBrowserBindingRequest[]
let commands: object[]
let bridge: ReturnType<typeof installDesktopBrowserAutomation>
let workspaces: { path: string; sessionIds: readonly SessionId[] }[]
let authority: DesktopBrowserExecutionAuthority
class RuntimeOwner extends Service {
  static inject = ['desktopBrowserControl']
  constructor(ctx: Context) {
    super(ctx, 'webTestRuntime')
    authority = bindDesktopBrowserExecutionAuthority(ctx, ctx.desktopBrowserControl, () => Promise.resolve())
  }
}
const state = (revision = 1, hostEpoch = 7, targets = true): DesktopBrowserControlState => ({
  version: DESKTOP_BROWSER_AUTOMATION_VERSION, revision, hostEpoch,
  targets: targets ? [{ target: TARGET, hostEpoch, workspace: KEY, url: 'http://127.0.0.1:12345/task' }] : [],
})
const publish = (next: DesktopBrowserControlState): void => { control.accept({ type: 'browser-control-state', state: next }) }
const acknowledge = (request = requests.at(-1)!, ok = true): void => {
  control.accept({ type: 'browser-binding-result', result: { version: DESKTOP_BROWSER_AUTOMATION_VERSION,
    requestId: request.requestId, hostEpoch: request.hostEpoch, ok } })
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SessionStore)
  ctx.sessions.create(SESSION)
  ctx.sessions.create(OTHER)
  workspaces = []
  ctx.provide('workspaceRegistry', { list: () => workspaces } as never)
  requests = []
  commands = []
  bridge = installDesktopBrowserAutomation(async (message) => { commands.push(message) })
  await ctx.plugin(HostBrowserControl, { bridge, send: async (message) => {
    if ('request' in message) requests.push(message.request as DesktopBrowserBindingRequest)
  } })
  control = ctx.desktopBrowserControl as HostBrowserControl
  await ctx.plugin(RuntimeOwner)
  publish(state())
})
afterEach(async () => { await ctx.fiber.dispose() })

it('requires explicit correlated Main acknowledgement before binding a real Session', async () => {
  expect(await control.submit(SESSION, { kind: 'observe' })).toMatchObject({ reason: 'session-not-authorized' })
  expect(commands).toEqual([])
  const waiting = control.bind(SESSION, TARGET)
  expect(control.binding(SESSION)).toBeUndefined()
  expect(requests[0]).toMatchObject({ kind: 'bind', sessionId: SESSION, target: TARGET, workspace: KEY, revision: 1 })
  acknowledge()
  expect(await waiting).toMatchObject({ sessionId: SESSION, target: TARGET })
  expect(control.binding(SESSION)?.target).toBe(TARGET)
  expect(control.binding(OTHER)).toBeUndefined()
})

it('acknowledges two role targets atomically, preserves single ownership and denies stale/cross-role grants', async () => {
  const owner = readBrowserExecutionOwner({ group: 'group', activation: 'activation', project: 'project', run: 'run',
    sessionId: SESSION, workspace: KEY, hostEpoch: 7 })!
  const targets = ['author', 'reviewer'].map(role => ({ target: role as DesktopBrowserTargetId, hostEpoch: 7, workspace: KEY,
    url: 'http://127.0.0.1:12345/task', executionRole: { owner, role: role as never } }))
  publish({ ...state(2), targets })
  const waiting = control.bindGroup(owner, targets, authority)
  await expect(control.bind(SESSION, targets[0]!.target)).rejects.toThrow('execution group')
  control.accept({ type: 'browser-group-binding-result', result: { version: DESKTOP_BROWSER_AUTOMATION_VERSION,
    requestId: 1, hostEpoch: 7, ok: true } })
  const roles = await waiting
  const signal = new AbortController().signal
  expect(await control.submitRole({ ...roles[0]!, target: roles[1]!.target }, { kind: 'observe' }, signal, authority))
    .toMatchObject({ outcome: 'not-executed' })
  expect(commands).toEqual([])
  const submitted = control.submitRole(roles[0]!, { kind: 'observe' }, signal, authority)
  const envelope = commands[0] as { requestId: number; command: DesktopBrowserCommand }
  expect(envelope.command.role?.grant).toBe(roles[0]!.grant)
  bridge.accept({ type: 'browser-command-result', requestId: envelope.requestId, result: { version: DESKTOP_BROWSER_AUTOMATION_VERSION,
    requestId: envelope.command.requestId, ok: true, observation: { hostEpoch: 7, target: roles[0]!.target, generation: 1,
      url: roles[0]!.url, title: 'Author', elements: [] } } })
  expect((await submitted).ok).toBe(true)
  const released = control.releaseGroup(owner.group, authority)
  expect(await control.submitRole(roles[0]!, { kind: 'observe' }, signal, authority)).toMatchObject({ outcome: 'not-executed' })
  control.accept({ type: 'browser-group-binding-result', result: { version: DESKTOP_BROWSER_AUTOMATION_VERSION,
    requestId: requests.at(-1)!.requestId, hostEpoch: 7, ok: true } })
  await released
  publish({ ...state(3, 8), targets: [] })
  expect(await control.submitRole(roles[1]!, { kind: 'observe' }, signal, authority)).toMatchObject({ outcome: 'not-executed' })
})

it('rejects copied authority and unrelated contexts before creating, releasing or dispatching a group', async () => {
  const owner = readBrowserExecutionOwner({ group: 'group', activation: 'activation', project: 'project', run: 'run',
    sessionId: SESSION, workspace: KEY, hostEpoch: 7 })!
  const copied: DesktopBrowserExecutionAuthority = { kind: 'trusted-desktop-execution-authority' }
  const target = { target: TARGET, hostEpoch: 7, workspace: KEY, url: 'http://127.0.0.1:12345/task',
    executionRole: { owner, role: 'author' as never } }
  await expect(control.bindGroup(owner, [target], copied)).rejects.toThrow('private Runtime authority')
  await expect(control.releaseGroup(owner.group, copied)).rejects.toThrow('private Runtime authority')
  expect(await control.submitRole({ ...target, grant: 'copied-grant' as never }, { kind: 'observe' },
    new AbortController().signal, copied)).toMatchObject({ reason: 'session-not-authorized', outcome: 'not-executed' })
  expect(() => bindDesktopBrowserExecutionAuthority(ctx, control, () => Promise.resolve())).toThrow('owning Runtime Service')
  expect(requests).toEqual([])
  expect(commands).toEqual([])
})

it('rejects missing Sessions, wrong workspace keys and competing owners before dispatch', async () => {
  await expect(control.bind(SessionId('missing'), TARGET)).rejects.toThrow('Session does not exist')
  await expect(control.bind(OTHER, TARGET)).rejects.toThrow('another workspace')
  workspaces = [{ path: 'C:/canonical/workspace', sessionIds: [SESSION] }]
  await expect(control.bind(SESSION, TARGET)).rejects.toThrow('another workspace')
  expect(requests).toEqual([])
  const next = state(2)
  publish({ ...next, targets: next.targets.map(target => ({ ...target, workspace: 'cwd:C:/canonical/workspace' as DesktopBrowserWorkspaceKey })) })
  const waiting = control.bind(SESSION, TARGET)
  await expect(control.bind(SESSION, TARGET)).rejects.toThrow('already has an owner')
  acknowledge()
  await waiting
  expect(control.binding(SESSION)?.workspace).toBe('cwd:C:/canonical/workspace')
})

it.each(['epoch', 'lease', 'revision'] as const)('refuses a late acknowledgement after %s withdrawal', async (mode) => {
  const waiting = control.bind(SESSION, TARGET)
  const rejected = expect(waiting).rejects.toThrow('changed before acknowledgement')
  const request = requests[0]!
  publish(state(2, mode === 'epoch' ? 8 : 7, mode !== 'lease'))
  acknowledge(request)
  await rejected
  expect(control.binding(SESSION)).toBeUndefined()
  expect(await control.submit(SESSION, { kind: 'observe' })).toMatchObject({ reason: 'session-not-authorized' })
  expect(commands).toEqual([])
})

it('withdraws acknowledged bindings on disconnect and never restores them from an old state', async () => {
  const waiting = control.bind(SESSION, TARGET)
  acknowledge()
  await waiting
  publish(state(2, 8))
  publish(state(3, 7))
  expect(control.binding(SESSION)).toBeUndefined()
  expect(control.targets()[0]?.hostEpoch).toBe(8)
  control.disconnect()
  expect(control.targets()).toEqual([])
})

it('withdraws locally before waiting for Main to acknowledge unbind', async () => {
  const waiting = control.bind(SESSION, TARGET)
  acknowledge()
  await waiting
  const unbind = control.unbind(SESSION)
  expect(control.binding(SESSION)).toBeUndefined()
  expect(requests.at(-1)?.kind).toBe('unbind')
  acknowledge()
  await unbind
})

it('rejects malformed private publications rather than keeping stale authorization', () => {
  expect(readBrowserControlState({ ...state(), targets: [{ ...state().targets[0], url: 'javascript:alert(1)' }] })).toBeUndefined()
  expect(() => control.accept({ type: 'browser-control-state', state: { ...state(), version: 1 } })).toThrow('invalid Main')
  expect(control.targets()).toEqual([])
})

it('connects the published epoch and submits the bound Session through the correlated transport', async () => {
  const waiting = control.bind(SESSION, TARGET)
  acknowledge()
  await waiting
  const submitted = control.submit(SESSION, { kind: 'observe' })
  const envelope = commands[0] as { requestId: number; command: DesktopBrowserCommand }
  expect(envelope.command).toMatchObject({ sessionId: SESSION, target: TARGET, hostEpoch: 7, body: { kind: 'observe' } })
  expect(bridge.accept({ type: 'browser-command-result', requestId: envelope.requestId,
    result: { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: envelope.command.requestId, ok: true,
      observation: { hostEpoch: 7, target: TARGET, generation: 1, url: control.binding(SESSION)!.url, title: 'Actual target', elements: [] } } })).toBe(true)
  expect(await submitted).toMatchObject({ ok: true, observation: { target: TARGET, generation: 1 } })
})
