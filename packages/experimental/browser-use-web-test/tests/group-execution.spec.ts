/** Trusted execution-group consumer holds one resource callback and revokes its captured executor. */
import { Context, Service } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DesktopBrowserControl, DESKTOP_BROWSER_AUTOMATION_VERSION, readBrowserExecutionOwner, readBrowserRoleBinding,
  bindDesktopBrowserExecutionAuthority } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { DesktopBrowserBinding, DesktopBrowserCommandResult, DesktopBrowserControlledTarget,
  DesktopBrowserRoleBinding, DesktopBrowserGroupId } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { afterEach, expect, it } from 'vitest'
import { DesktopBrowserExecutionGroups, type BrowserRoleExecutor } from '../src/group-execution.ts'

const contexts: Context[] = []
const owner = readBrowserExecutionOwner({ group: 'group', activation: 'activation', project: 'project', run: 'run',
  sessionId: 'session', workspace: 'session:session', hostEpoch: 1 })!
const roles = ['author', 'reviewer'].map(role => readBrowserRoleBinding({ target: role, hostEpoch: 1, workspace: owner.workspace,
  url: 'https://example.test/', executionRole: { owner, role }, grant: `grant-${role}` })!)

class Control extends DesktopBrowserControl {
  readonly submitted: DesktopBrowserRoleBinding[] = []
  readonly released: DesktopBrowserGroupId[] = []
  pending: Promise<DesktopBrowserCommandResult> | undefined
  targets(): readonly DesktopBrowserControlledTarget[] { return roles }
  bind(): Promise<DesktopBrowserBinding> { return Promise.reject(new Error('single path not used')) }
  unbind(): Promise<void> { return Promise.resolve() }
  binding(): undefined { return undefined }
  submit(): Promise<DesktopBrowserCommandResult> { return Promise.reject(new Error('single path not used')) }
  override bindGroup(): Promise<readonly DesktopBrowserRoleBinding[]> { return Promise.resolve(roles) }
  override releaseGroup(group: DesktopBrowserGroupId): Promise<void> { this.released.push(group); return Promise.resolve() }
  override submitRole(binding: DesktopBrowserRoleBinding): Promise<DesktopBrowserCommandResult> {
    this.submitted.push(binding)
    return this.pending ?? Promise.resolve({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: this.submitted.length, ok: true })
  }
}

async function fixture() {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Control)
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('session'))
  const scope = agent.ctx.fiber
  const control = ctx.desktopBrowserControl as Control
  let groups!: DesktopBrowserExecutionGroups
  class RuntimeOwner extends Service {
    static inject = ['desktopBrowserControl']
    constructor(runtime: Context) {
      super(runtime, 'webTestRuntime')
      groups = new DesktopBrowserExecutionGroups(runtime, control)
    }
  }
  await ctx.plugin(RuntimeOwner)
  return { ctx, scope, agent, control, groups }
}

afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

it('coordinates both roles in one callback and denies a captured executor after callback settlement', async () => {
  const { agent, control, groups } = await fixture()
  let captured: BrowserRoleExecutor | undefined
  let callbacks = 0
  const values = await groups.run(agent, owner, roles, new AbortController().signal, async (executor) => {
    callbacks += 1; captured = executor
    return Promise.all(roles.map(role => executor.submit(role.executionRole.role, { kind: 'observe' })))
  })
  expect(values.every(result => result.ok)).toBe(true)
  expect(callbacks).toBe(1)
  expect(control.submitted).toEqual(roles)
  expect(() => captured!.submit(roles[0]!.executionRole.role, { kind: 'observe' })).toThrow('callback has ended')
  await groups.dispose()
  expect(control.released).toEqual([owner.group])
})

it('settles emitted role work even when the callback fails without awaiting that work', async () => {
  const { agent, control, groups } = await fixture()
  const work = Promise.withResolvers<DesktopBrowserCommandResult>()
  control.pending = work.promise
  let settled = false
  const run = groups.run(agent, owner, roles, new AbortController().signal, async (executor) => {
    void executor.submit(roles[0]!.executionRole.role, { kind: 'observe' })
    throw new Error('later scheduling failed')
  })
  const expectation = expect(run).rejects.toThrow('later scheduling failed')
  void run.finally(() => { settled = true }).catch(() => {})
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(settled).toBe(false)
  work.resolve({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 1, ok: false, outcome: 'unknown', reason: 'execution-failed' })
  await expectation
  await groups.dispose()
})

it('rejects nested runs and replacement activation and withdraws group grants on owner disposal', async () => {
  const { agent, scope, control, groups } = await fixture()
  const signal = new AbortController().signal
  await expect(groups.run(agent, owner, roles, signal, async () => groups.run(agent, owner, roles, signal, async () => 1)))
    .rejects.toThrow('nested operations')
  expect(() => groups.run(agent, { ...owner, activation: readBrowserExecutionOwner({ ...owner, activation: 'new-activation' })!.activation },
    roles, signal, async () => 1)).toThrow('cannot replace')
  await scope.dispose()
  expect(control.released).toEqual([owner.group])
  await groups.dispose()
})

it('cancellation closes the callback executor before another role can dispatch', async () => {
  const { agent, control, groups } = await fixture()
  const controller = new AbortController()
  await expect(groups.run(agent, owner, roles, controller.signal, async (executor) => {
    await executor.submit(roles[0]!.executionRole.role, { kind: 'observe' })
    controller.abort(new Error('paused'))
    await executor.submit(roles[1]!.executionRole.role, { kind: 'observe' })
  })).rejects.toThrow('paused')
  expect(control.submitted).toEqual([roles[0]])
  await groups.dispose()
})

it('denies model-initiated group coordination before its trusted consumer can bind targets', async () => {
  const { ctx, agent, control, groups } = await fixture()
  await expect(ctx.agents.withInitiator(agent, async () => groups.run(agent, owner, roles, new AbortController().signal, async () => 1)))
    .rejects.toThrow('models cannot manage')
  expect(control.submitted).toEqual([])
  expect(control.released).toEqual([])
  await groups.dispose()
})

it('does not mint Runtime authority for a real Agent context after its model initiator was cleared', async () => {
  const { ctx, agent, control, groups } = await fixture()
  await ctx.agents.withInitiator(agent, async () => {
    expect(() => bindDesktopBrowserExecutionAuthority(agent.ctx, control, () => Promise.resolve())).toThrow('owning Runtime Service')
    ctx.agents.withoutInitiator(() => {
      expect(ctx.agents.currentInitiator()).toBeUndefined()
      expect(() => bindDesktopBrowserExecutionAuthority(agent.ctx, control, () => Promise.resolve())).toThrow('owning Runtime Service')
      expect(() => new DesktopBrowserExecutionGroups(agent.ctx, control)).toThrow('owning Runtime Service')
    })
  })
  expect(control.submitted).toEqual([])
  expect(control.released).toEqual([])
  await groups.dispose()
})
