/** Policy reads the controlled destination from the carrier for both tool and direct calls. */
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bindDesktopBrowserExecutionAuthority, DesktopBrowserControl, DESKTOP_BROWSER_AUTOMATION_VERSION } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type {
  DesktopBrowserBinding, DesktopBrowserCommandBody, DesktopBrowserCommandResult,
  DesktopBrowserControlledTarget, DesktopBrowserTargetId, DesktopBrowserWorkspaceKey,
  DesktopBrowserExecutionAuthority, DesktopBrowserRoleBinding,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { WEB_TEST_BROWSER_TOOLS } from '../src/index.ts'
import { sessionId, startPolicy } from './harness.ts'
import { startConversation } from '../../web-test-conversation/tests/harness.ts'

/** Trusted carrier observations; the Main's ownership checks have separate owner tests. */
class FixtureControl extends DesktopBrowserControl {
  url = 'http://localhost:3000/checkout'
  calls = 0
  signal: AbortSignal | undefined
  authority: DesktopBrowserExecutionAuthority | undefined
  private readonly sessions = new Set<SessionId>()
  private readonly target = brandString<DesktopBrowserTargetId>('target-policy-test')
  private readonly workspace = brandString<DesktopBrowserWorkspaceKey>('session:session-web-test-1')

  targets(): readonly DesktopBrowserControlledTarget[] {
    return [{ target: this.target, hostEpoch: 1, workspace: this.workspace, url: this.url }]
  }

  bind(id: SessionId, target: DesktopBrowserTargetId): Promise<DesktopBrowserBinding> {
    if (target !== this.target) return Promise.reject(new Error('fixture target is absent'))
    this.sessions.add(id)
    return Promise.resolve({ ...this.targets()[0]!, sessionId: id })
  }

  unbind(id: SessionId): Promise<void> {
    this.sessions.delete(id)
    return Promise.resolve()
  }

  binding(id: SessionId): DesktopBrowserBinding | undefined {
    return this.sessions.has(id) ? { ...this.targets()[0]!, sessionId: id } : undefined
  }

  submit(_id: SessionId, _body: DesktopBrowserCommandBody, signal?: AbortSignal): Promise<DesktopBrowserCommandResult> {
    this.calls += 1
    this.signal = signal
    return Promise.resolve({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: this.calls, ok: true })
  }

  override submitRole(_binding: DesktopBrowserRoleBinding, _body: DesktopBrowserCommandBody,
    signal: AbortSignal, authority: DesktopBrowserExecutionAuthority): Promise<DesktopBrowserCommandResult> {
    this.authority = authority
    this.signal = signal
    this.calls += 1
    return Promise.resolve({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: this.calls, ok: true })
  }
}

describe('controlled browser policy', () => {
  it('refuses browser dispatch from a report handler without a Session grant', async () => {
    const app = await startPolicy()
    try {
      await app.ctx.plugin(FixtureControl)
      const control = app.ctx.desktopBrowserControl as FixtureControl
      await control.bind(SessionId(sessionId), control.targets()[0]!.target)
      await app.ctx.plugin({
        name: 'report-browser-backstop',
        inject: ['tools', 'desktopBrowserControl'],
        apply(inner: Context) {
          inner.effect(() => inner.tools.register({
            name: 'web_test_submit_report',
            description: 'Exercise the browser backstop from a report handler',
            parameters: { type: 'object', properties: {} },
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
            execute: async () => {
              await inner.desktopBrowserControl.submit(SessionId(sessionId), { kind: 'observe' })
              return 'browser dispatch succeeded'
            },
          }))
        },
      })
      expect(await app.callTool('web_test_submit_report', {})).toContain('refused')
      expect(control.calls).toBe(0)
    } finally { await app.stop() }
  })

  it('checks role authority before consuming its Session grant and forwards cancellation and authority', async () => {
    const app = await startPolicy()
    let authority: DesktopBrowserExecutionAuthority | undefined
    class RuntimeOwner extends Service {
      static inject = ['desktopBrowserControl']
      constructor(ctx: Context) {
        super(ctx, 'webTestRuntime')
        authority = bindDesktopBrowserExecutionAuthority(this.ctx, ctx.desktopBrowserControl, () => Promise.resolve())
      }
    }
    try {
      await app.ctx.plugin(FixtureControl)
      await app.ctx.plugin(RuntimeOwner)
      const control = app.ctx.desktopBrowserControl as FixtureControl
      if (authority === undefined) throw new Error('missing trusted authority')
      const owner = { group: 'policy-group', activation: 'policy-activation', project: 'policy-project', run: 'policy-run',
        sessionId, workspace: 'policy-workspace', hostEpoch: 1 }
      const binding = { target: 'policy-role-target', workspace: owner.workspace, hostEpoch: 1,
        url: control.url, executionRole: { owner, role: 'reviewer' }, grant: 'policy-grant' } as DesktopBrowserRoleBinding
      const signal = new AbortController().signal
      const forged: DesktopBrowserExecutionAuthority = Object.freeze({ kind: 'trusted-desktop-execution-authority' })
      await expect(control.submitRole(binding, { kind: 'observe' }, signal, authority)).rejects.toThrow('refused')
      app.admit({ actions: 1 })
      await expect(control.submitRole(binding, { kind: 'observe' }, signal, forged)).rejects.toThrow('trusted Runtime authority')
      await expect(control.submitRole(binding, { kind: 'observe' }, signal, authority)).resolves.toMatchObject({ ok: true })
      expect(control.calls).toBe(1)
      expect(control.signal).toBe(signal)
      expect(control.authority).toBe(authority)
      await expect(control.submitRole(binding, { kind: 'observe' }, signal, authority)).rejects.toThrow('refused')
      expect(control.calls).toBe(1)
    }
    finally { await app.stop() }
  })
  it('requires a bound, declared, granted destination even when model arguments name another URL', async () => {
    const app = await startConversation()
    try {
      const agent = await app.rootAgent('browser-tool-policy')
      const project = await app.registerProject('cmd-browser-policy')
      app.attachAndDeclare(agent.session.id, project, 'cmd-browser-policy-declare')
      await app.ctx.plugin(FixtureControl)
      const control = app.ctx.desktopBrowserControl as FixtureControl
      for (const name of WEB_TEST_BROWSER_TOOLS) {
        await app.ctx.plugin({ name: `fixture-${name}`, inject: ['tools'], apply(inner: Context) {
          void inner.tools.register({ name, description: 'Controlled browser fixture', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }, execute: () => Promise.resolve('allowed controlled call') })
        } })
        expect(await app.callTool(agent, name, { url: 'http://localhost:3000/checkout' })).toContain('denied-unknown-target')
      }
      await control.bind(agent.session.id, control.targets()[0]!.target)
      expect(await app.callTool(agent, 'web_browser_observe', {})).not.toBe('allowed controlled call')
      app.ctx.webTestPolicy.grantFlow({ sessionId: agent.session.id, flowId: 'browser-tools', flowRevision: 1, thirdParty: false, actions: 50 })
      for (const name of WEB_TEST_BROWSER_TOOLS) {
        expect(await app.callTool(agent, name, { url: 'http://outside.example/', target: 'forged' })).toBe('allowed controlled call')
      }
      control.url = 'http://outside.example/'
      expect(await app.callTool(agent, 'web_browser_observe', { url: 'http://localhost:3000/checkout' })).not.toBe('allowed controlled call')
    }
    finally { await app.stop() }
  })

  it('guards the direct carrier submit and refuses an unbound different session', async () => {
    const app = await startPolicy()
    try {
      await app.ctx.plugin(FixtureControl)
      const control = app.ctx.desktopBrowserControl as FixtureControl
      await control.bind(SessionId(sessionId), control.targets()[0]!.target)
      await expect(control.submit(SessionId(sessionId), { kind: 'observe' })).rejects.toThrow('refused')
      expect(control.calls).toBe(0)
      app.admit({ actions: 50 })
      const abort = new AbortController()
      await expect(control.submit(SessionId(sessionId), { kind: 'observe' }, abort.signal)).resolves.toMatchObject({ ok: true })
      expect(control.signal).toBe(abort.signal)
      await expect(control.submit(SessionId('different-session'), { kind: 'observe' })).rejects.toThrow('refused')
      expect(control.calls).toBe(1)
      await control.unbind(SessionId(sessionId))
      await expect(control.submit(SessionId(sessionId), { kind: 'observe' })).rejects.toThrow('refused')
      expect(control.calls).toBe(1)
    }
    finally { await app.stop() }
  })
})
