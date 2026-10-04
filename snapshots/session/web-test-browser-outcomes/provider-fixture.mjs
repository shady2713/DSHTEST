/** Deterministic transport outcomes for the real provider; this fixture supplies no GUI evidence. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import WebTest from '../../../packages/web-test/web-test/src/index.ts'
import * as Provider from '../../../packages/experimental/browser-use-web-test/src/index.ts'
import { DesktopBrowserControl } from '../../../packages/client/ui-sidebar-browser/src/control.ts'
import { observeBrowserReceipts, withBrowserFailureReceipt } from '../../../apps/desktop-host/tests/fixtures/browser-receipts.mjs'

export const name = 'web-test-browser-outcomes-fixture'
export const inject = ['browserUse', 'agents', 'tools', 'sessions', 'llm']

export async function apply(ctx) {
  await ctx.plugin(WebTest)
  const calls = []
  class FixtureControl extends DesktopBrowserControl {
    bindings = new Map()
    constructor(inner) { super(inner) }
    targets() { return [{ target: 'fixture-guest', hostEpoch: 7, workspace: 'fixture', url: 'http://localhost:3000/' }] }
    async bind(sessionId, target) {
      assert.ok(ctx.sessions.get(sessionId), 'trusted fixture binds an existing Session')
      assert.equal(target, 'fixture-guest')
      const binding = { ...this.targets()[0], sessionId }
      this.bindings.set(sessionId, binding)
      return binding
    }
    binding(sessionId) { return this.bindings.get(sessionId) }
    async unbind(sessionId) { this.bindings.delete(sessionId) }
    async submit(sessionId, body) {
      assert.ok(this.binding(sessionId), 'tools cannot acquire their own binding')
      assert.equal(body.kind, ['click', 'type'][calls.length], 'a tool failure must not retry automatically')
      calls.push(body.kind)
      const result = { version: 2, requestId: calls.length, ok: false }
      return body.kind === 'click'
        ? { ...result, outcome: 'not-executed', reason: 'wrong-target' }
        : { ...result, outcome: 'unknown', reason: 'execution-failed' }
    }
  }
  await ctx.plugin(FixtureControl)
  ctx.inject(['desktopBrowserControl'], async (host) => {
    const observer = observeBrowserReceipts(host.desktopBrowserControl)
    host.effect(() => () => observer.dispose())
    const receipts = new Map()
    host.on('tools/execute', async (exec, next) => {
      if (!exec.name.startsWith('web_browser_')) return next()
      const binding = host.desktopBrowserControl.binding(exec.agent.session.id)
      assert.ok(binding, 'the trusted fixture must establish ownership before dispatch')
      const parametersHash = createHash('sha256').update(JSON.stringify(exec.arguments)).digest('hex')
      const {result, receipt} = await observer.run(exec, null, binding, parametersHash, next)
      assert.equal(result.isError, true, 'the real provider must retain its failed result')
      assert.ok(receipt, 'an actual submit must return its correlated transport receipt')
      assert.equal(receipt.callId, ['known-denial', 'unknown-execution'][receipt.requestId - 1])
      assert.equal(receipt.outcome, ['not-executed', 'unknown'][receipt.requestId - 1])
      const projected = withBrowserFailureReceipt(result, receipt)
      assert.equal(projected.isError, result.isError)
      assert.equal(projected.error, result.error)
      receipts.set(exec.callId, projected)
      return projected
    })
    host.on('llm/stream', (options, next) => {
      for (const [callId, result] of receipts) {
        const message = options.messages.find(message => message.role === 'tool' && message.toolCallId === callId)
        assert.ok(message, 'the next model input must include the actual failed tool result')
        assert.deepEqual(message.content, result.content)
        const marker = result.meta.browserCommand.outcome === 'not-executed' ? 'NOT_EXECUTED:' : 'UNKNOWN:'
        assert.ok(message.content.some(block => block.type === 'text' && block.text.startsWith(marker)))
      }
      return next()
    })
    await host.plugin(Provider, { controlled: true })
    host.on('agent/created', ({ agent }) => {
      // This trusted fixture contribution supplies ownership before model calls.
      void host.desktopBrowserControl.bind(agent.session.id, 'fixture-guest')
      agent.ctx.tools.restrict({ allow: ['web_browser_observe', 'web_browser_screenshot', 'web_browser_click', 'web_browser_type'] })
    })
  })
}
