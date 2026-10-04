/** Operator dispatch retains actual Agent scope, ToolRuntime guards and explicit carrier ownership. */
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DesktopBrowserControl } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { DesktopBrowserBinding, DesktopBrowserCommandBody, DesktopBrowserCommandResult,
  DesktopBrowserTargetId, DesktopBrowserWorkspaceKey } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import * as Consumer from './fixtures/browser-tool-consumer.mjs'

const SESSION = SessionId('operator-tool-session')
const TARGET = 'selected-main-guest' as DesktopBrowserTargetId
const ORIGIN = 'http://127.0.0.1:18771'
let ctx: Context
let directory: string
let requestPath: string
let responsePath: string
let executions: number
let binds: number
let consumer: Fiber
class UnusedModel extends LlmAdapter {
  async *stream(): AsyncIterable<StreamChunk> { throw new Error('deterministic driver does not call a model') }
}
class FixtureControl extends DesktopBrowserControl {
  owned: DesktopBrowserBinding | undefined
  targets() { return [{ target: TARGET, hostEpoch: 1, workspace: `session:${SESSION}` as DesktopBrowserWorkspaceKey, url: ORIGIN }] }
  async bind(sessionId: SessionId, _target: DesktopBrowserTargetId) { binds += 1; return this.owned = { ...this.targets()[0]!, sessionId } }
  async unbind(_sessionId: SessionId) { this.owned = undefined }
  binding(sessionId: SessionId) { return this.owned?.sessionId === sessionId ? this.owned : undefined }
  async submit(_sessionId: SessionId, _body: DesktopBrowserCommandBody): Promise<DesktopBrowserCommandResult> { throw new Error('driver must use ToolRuntime') }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'desktop-tool-consumer-'))
  requestPath = join(directory, 'request.json')
  responsePath = join(directory, 'response.json')
  await writeFile(requestPath, JSON.stringify({ requestId: 'initial', kind: 'execute', name: 'web_browser_observe', arguments: {} }))
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['fixture'], new UnusedModel())
  const harness = await mountAgentLoopTestHarness(ctx)
  await harness.create(SESSION, { provider: 'fixture', model: 'unused' })
  executions = 0
  binds = 0
  await ctx.plugin(FixtureControl)
  await ctx.plugin({ name: 'operator-scope-tool', inject: ['tools'], apply(inner: Context) {
    inner.effect(() => inner.tools.register({ name: 'web_browser_observe', description: 'observe fixture', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
      execute: async (_args, execution) => { executions += 1; return execution.agent?.session.id ?? 'missing-agent' } }))
  } })
  consumer = await ctx.plugin(Consumer, { sessionId: SESSION, origin: ORIGIN, requestPath, responsePath })
  expect(await request('boot-unbound')).toMatchObject({ status: 'rejected' })
})
afterEach(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true }) })

async function request(requestId: string, overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await writeFile(join(directory, 'next.json'), JSON.stringify({ requestId, kind: 'execute', name: 'web_browser_observe', arguments: {}, ...overrides }))
  await rename(join(directory, 'next.json'), requestPath)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(responsePath + '.' + requestId, 'utf8')) as Record<string, unknown> }
    catch (_error) { /* Response publication follows the file notification. */ }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('operator tool response did not arrive')
}

it('requires an explicit binding and dispatches the existing Agent through the real ToolRuntime', async () => {
  expect(await request('unbound')).toMatchObject({ status: 'rejected' })
  expect(binds).toBe(0)
  expect(executions).toBe(0)
  await ctx.desktopBrowserControl.bind(SESSION, TARGET)
  expect(await request('bound')).toMatchObject({ status: 'executed', sessionId: SESSION, result: { isError: false, content: [{ text: SESSION }] } })
  expect(executions).toBe(1)
  await ctx.desktopBrowserControl.unbind(SESSION)
  expect(await request('revoked')).toMatchObject({ status: 'rejected' })
  expect(executions).toBe(1)
  expect(binds).toBe(1)
})

it('refuses other tool names and operator attempts to choose a different Session or target', async () => {
  await ctx.desktopBrowserControl.bind(SESSION, TARGET)
  for (const [requestId, overrides] of [
    ['shell', { name: 'bash' }], ['session', { sessionId: 'other' }],
    ['target', { arguments: { target: 'other' } }], ['create', { kind: 'create-session' }],
  ] as const) expect(await request(requestId, overrides)).toMatchObject({ status: 'rejected' })
  expect(executions).toBe(0)
  expect(binds).toBe(1)
})

it('retains the monotonic ToolRuntime guard for the selected Agent', async () => {
  await ctx.desktopBrowserControl.bind(SESSION, TARGET)
  await ctx.plugin({ name: 'operator-denial', inject: ['tools'], apply(inner: Context) {
    inner.effect(() => inner.tools.guard(exec => exec.agent?.session.id === SESSION ? 'operator guard refused' : undefined))
  } })
  expect(await request('guarded')).toMatchObject({ status: 'executed', result: { isError: true } })
  expect(executions).toBe(0)
})

it('retains an existing response after consumer reload and does not execute the old request again', async () => {
  await ctx.desktopBrowserControl.bind(SESSION, TARGET)
  expect(await request('retained')).toMatchObject({ status: 'executed' })
  await consumer.dispose()
  consumer = await ctx.plugin(Consumer, { sessionId: SESSION, origin: ORIGIN, requestPath, responsePath })
  expect(await request('after-reload')).toMatchObject({ status: 'executed' })
  expect(executions).toBe(2)
})
