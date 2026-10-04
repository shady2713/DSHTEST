/** Provider behavior against the controlled channel, exercised through a fake bridge. */

import { afterEach, beforeEach, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import BrowserUseRegistry from '@deepseek-ai/dsh-browser-use'
import { BrowserUseProviderName } from '@deepseek-ai/dsh-browser-use/brand'
import { DesktopBrowserControl, DESKTOP_BROWSER_AUTOMATION_VERSION } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type {
  DesktopBrowserBinding,
  DesktopBrowserCommandBody,
  DesktopBrowserWorkspaceKey,
  DesktopBrowserCommand,
  DesktopBrowserCommandResult,
  DesktopBrowserDenialReason,
  DesktopBrowserTargetId,
  DesktopBrowserUnknownReason,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { DesktopBrowserAutomationBridge } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import WebTest from '@deepseek-ai/dsh-web-test'
import * as Provider from '../src/index.ts'

const TARGET = 'guest-1' as DesktopBrowserTargetId
const OTHER_TARGET = 'guest-2' as DesktopBrowserTargetId
const EPOCH = 7
const ALLOWED = new Set(['observe', 'screenshot', 'click', 'type', 'double-click', 'press-key', 'navigate', 'reload'])

/** One page state the fake Main reports, tagged with the generation that produced it. */
const PAGE = {
  url: 'https://shop.example/cart',
  title: 'Cart',
  generation: 4,
  elements: [
    { ref: 'e1', role: 'button', name: 'Checkout', x: 10, y: 20, width: 80, height: 30 },
    { ref: 'e2', role: 'textbox', name: 'Coupon', x: 10, y: 60, width: 160, height: 24 },
  ],
} as const

/** What the fake answers for one command; a test may defer it. */
type FakeReply = (command: DesktopBrowserCommand) => DesktopBrowserCommandResult | Promise<DesktopBrowserCommandResult>

/** Recorded channel traffic plus the one reply the next command receives. */
class FakeChannel implements DesktopBrowserAutomationBridge {
  readonly commands: DesktopBrowserCommand[] = []
  readonly connected: number[] = []
  readonly disconnected: number[] = []
  reply: FakeReply = command => ok(command.requestId)

  connectHost(epoch: number): void { this.connected.push(epoch) }

  async submit(command: DesktopBrowserCommand): Promise<DesktopBrowserCommandResult> {
    this.commands.push(command)
    return await this.reply(command)
  }

  disconnectHost(epoch: number): void { this.disconnected.push(epoch) }
}

/** @param requestId - the request this reply answers. @returns an accepted result with no payload. */
function ok(requestId: number): DesktopBrowserCommandResult {
  return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId, ok: true }
}

/** @param command - the request being answered. @param epoch - Host generation the observation belongs to. */
function observed(command: DesktopBrowserCommand, epoch = EPOCH, target: DesktopBrowserTargetId = TARGET): DesktopBrowserCommandResult {
  return {
    version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: command.requestId, ok: true,
    observation: { hostEpoch: epoch, target, ...PAGE },
  }
}

let ctx: Context
let channel: FakeChannel
let first: Agent
let second: Agent
let imageCapable: boolean | undefined
let captureBytes: Uint8Array | undefined
let stopCapture: () => Promise<void>
let resolveRoute: (() => Promise<void>) | undefined
let bindingReads = 0
let unbindAfterRead: number | undefined
let modelScript: ((options: GenerateOptions) => readonly StreamChunk[]) | undefined

class UnusedModel extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (modelScript === undefined) throw new Error('the Session model was not used')
    for (const chunk of modelScript(options)) yield chunk
  }
  override async resolveModel(provider: string, model: string) {
    await resolveRoute?.()
    return { provider, id: model, name: model,
      ...imageCapable === undefined ? {} : { inputModalities: imageCapable ? ['text', 'image'] as const : ['text'] as const },
    }
  }
}

/** Provider projection seam only; the Policy suite verifies capture admission and real image persistence. */
class FixtureCapturePolicy extends Service {
  static inject = ['desktopBrowserControl']
  constructor(ctx: Context) { super(ctx, 'webTestPolicy') }
  async captureBrowserScreenshot(sessionId: SessionId, signal: AbortSignal) {
    const binding = this.ctx.desktopBrowserControl.binding(sessionId)
    if (binding === undefined) throw new Error('fixture capture has no binding')
    const captured = await this.ctx.desktopBrowserControl.submit(sessionId, { kind: 'screenshot', format: 'png' }, signal)
    if (!captured.ok || captured.screenshot === undefined) throw new Error('fixture capture refused')
    captureBytes = captured.screenshot
    return { target: binding.target, hostEpoch: binding.hostEpoch,
      image: { attachmentId: AttachmentId('a'.repeat(64)), mediaType: 'image/png' as const,
        bytes: captured.screenshot.byteLength, width: 1100, height: 760 },
    }
  }
}

/** A trusted fixture selects an owner before tools are registered. */
class FixtureControl extends DesktopBrowserControl {
  private readonly owned = new Map<SessionId, DesktopBrowserBinding>()
  private requestId = 0
  targets() { return [{ target: TARGET, hostEpoch: EPOCH, workspace: 'session:web-test-first' as DesktopBrowserWorkspaceKey, url: PAGE.url }] }
  async bind(sessionId: SessionId, target: DesktopBrowserTargetId) {
    if (this.ctx.get('sessions')?.get(sessionId) === undefined || target !== TARGET) throw new Error('fixture: missing Session or target')
    const binding = { ...this.targets()[0]!, sessionId }
    this.owned.set(sessionId, binding)
    return binding
  }
  async unbind(sessionId: SessionId) { this.owned.delete(sessionId) }
  binding(sessionId: SessionId) {
    const binding = this.owned.get(sessionId)
    bindingReads++
    if (bindingReads === unbindAfterRead) this.owned.delete(sessionId)
    return binding
  }
  async submit(sessionId: SessionId, body: DesktopBrowserCommandBody): Promise<DesktopBrowserCommandResult> {
    if (this.binding(sessionId) === undefined) return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: ++this.requestId,
      ok: false, outcome: 'not-executed', reason: 'session-not-authorized' }
    return await channel.submit({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: ++this.requestId,
      hostEpoch: EPOCH, target: TARGET, sessionId, body })
  }
}

beforeEach(async () => {
  channel = new FakeChannel()
  imageCapable = true
  captureBytes = undefined
  resolveRoute = undefined
  bindingReads = 0
  unbindAfterRead = undefined
  modelScript = undefined
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(BrowserUseRegistry)
  await ctx.plugin(WebTest)
  ctx.llm.registerAdapter(['fixture'], new UnusedModel())
  const harness = await mountAgentLoopTestHarness(ctx)
  first = await harness.create(SessionId('web-test-first'), { provider: 'fixture', model: 'structured' })
  second = await harness.create(SessionId('web-test-second'), { provider: 'fixture', model: 'structured' })
  await ctx.plugin(FixtureControl)
  const capture = await ctx.plugin(FixtureCapturePolicy)
  stopCapture = () => capture.dispose()
  await ctx.desktopBrowserControl.bind(first.session.id, TARGET)
})

afterEach(async () => { await ctx.fiber.dispose() })

/** @returns the normalized tool result for one call by the given owner. */
function call(agent: Agent | undefined, name: string, args: unknown, signal = new AbortController().signal) {
  return ctx.tools.execute({
    ...agent === undefined ? {} : { agent },
    name,
    arguments: args,
    callId: ToolCallId(`call-${channel.commands.length}`),
    signal,
  })
}

/** @returns the model-facing text of one tool result. */
function textOf(result: { content: readonly ContentBlock[] }): string {
  return result.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('')
}

/** @returns after the condition holds, or throws once the wait budget is spent. */
async function until(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error(message)
}

it('exposes exactly the eight allowlisted operations through the controlled channel', async () => {
  channel.reply = (command) => {
    if (command.body.kind === 'observe') return observed(command)
    if (command.body.kind === 'screenshot') return { ...ok(command.requestId), screenshot: new Uint8Array([137, 80, 78, 71]) }
    return ok(command.requestId)
  }
  await ctx.plugin(Provider, { controlled: true })

  expect(ctx.browserUse.providerName).toBe('web-test-browser')
  expect(ctx.tools.schemas().map(tool => tool.name).sort()).toEqual([
    'web_browser_click', 'web_browser_double_click', 'web_browser_navigate', 'web_browser_observe',
    'web_browser_press_key', 'web_browser_reload', 'web_browser_screenshot', 'web_browser_type',
  ])
  expect(ctx.get('webTest')!.provides('web-test.browser-automation')).toBe(true)
  // Trusted Host transport ownership is independent of model calls.
  expect(channel.connected).toEqual([])

  const read = await call(first, 'web_browser_observe', {})
  expect(read.isError).toBe(false)
  expect(channel.connected).toEqual([])
  expect(textOf(read)).toContain('e1 button "Checkout"')
  expect(textOf(read)).toContain('page generation 4')
  expect((await call(first, 'web_browser_screenshot', {})).isError).toBe(false)
  expect((await call(first, 'web_browser_click', { ref: 'e1', generation: 4 })).isError).toBe(false)
  expect((await call(first, 'web_browser_type', { ref: 'e2', generation: 4, text: 'SAVE10' })).isError).toBe(false)

  expect((await call(first, 'web_browser_double_click', { ref: 'e1', generation: 4 })).isError).toBe(false)
  expect((await call(first, 'web_browser_press_key', { ref: 'e2', generation: 4, key: 'Enter' })).isError).toBe(false)
  expect((await call(first, 'web_browser_navigate', { generation: 4, url: PAGE.url + '#active' })).isError).toBe(false)
  expect((await call(first, 'web_browser_reload', { generation: 4 })).isError).toBe(false)

  expect(channel.commands.map(command => command.body.kind).sort()).toEqual(['click', 'double-click', 'navigate', 'observe', 'press-key', 'reload', 'screenshot', 'type'])
  for (const command of channel.commands) {
    expect(command.version).toBe(DESKTOP_BROWSER_AUTOMATION_VERSION)
    expect(command.hostEpoch).toBe(EPOCH)
    expect(command.target).toBe(TARGET)
    expect(ALLOWED.has(command.body.kind)).toBe(true)
  }
  expect(new Set(channel.commands.map(command => command.requestId)).size).toBe(channel.commands.length)
})

it('projects the capture as a formal durable image block without base64 text', async () => {
  channel.reply = command => ({ ...ok(command.requestId), screenshot: new Uint8Array([0, 1, 2, 250]) })
  await ctx.plugin(Provider, { controlled: true })

  const captured = await call(first, 'web_browser_screenshot', {})
  expect(captured.isError, textOf(captured)).toBe(false)
  expect(captureBytes).toEqual(new Uint8Array([0, 1, 2, 250]))
  expect(captured.content).toEqual([
    { type: 'text', text: 'Captured the test page at 1100×760 pixels, target guest-1, Host epoch 7.' },
    { type: 'image', attachment: { attachmentId: AttachmentId('a'.repeat(64)), mediaType: 'image/png', bytes: 4, width: 1100, height: 760 } },
  ])
  expect(textOf(captured)).not.toContain('AAEC+g==')
  expect(channel.commands).toHaveLength(1)
})

it('logs the image result and reconstructs it in the next actual Agent model request', async () => {
  const requests: GenerateOptions[] = []
  modelScript = (options) => {
    requests.push(options)
    if (requests.length === 1) return [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('owned-image-call'), name: 'web_browser_screenshot', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]
    return [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Owned screenshot received' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
  }
  channel.reply = command => ({ ...ok(command.requestId), screenshot: new Uint8Array([0, 1, 2, 250]) })
  await ctx.plugin(Provider, { controlled: true })
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent, status }) => {
      if (agent === first && status === 'idle') { dispose(); resolve() }
    })
  })
  first.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect the owned screenshot' }], source: { kind: 'user' } }))
  await idle
  expect(requests).toHaveLength(2)
  const events = first.session.snapshotEvents()
  const logged = events.find(event => event.type === 'tool/result')
  expect(logged?.type).toBe('tool/result')
  if (logged?.type !== 'tool/result') throw new Error('settled image result missing')
  const requestTool = requests[1]?.messages.find(message => message.role === 'tool')
  expect(requestTool?.content).toEqual(logged.data.message.content)
  expect(logged.data.message.content.some(block => block.type === 'image')).toBe(true)
  expect(events.filter(event => event.type === 'tool/call')).toHaveLength(1)
  expect(channel.commands).toHaveLength(1)
})

it('presents all Native actions as pending cards without dispatching them', async () => {
  await ctx.plugin(Provider, { controlled: true })
  const args = { ref: 'e1', generation: 4, text: 'owned', key: 'Enter', url: PAGE.url }
  for (const { name } of ctx.tools.schemas()) {
    const card = ctx.tools.get(name)?.presentCall?.(args)
    expect(card).toMatchObject({ card: 'generic', kind: 'other' })
    expect(card?.title).toBeTruthy()
  }
  expect(channel.commands).toEqual([])
})

it('refuses screenshot calls lacking an Agent, binding or resolved model route before Native capture', async () => {
  await ctx.plugin(Provider, { controlled: true })
  expect(textOf(await call(undefined, 'web_browser_screenshot', {}))).toContain('require the Session')
  expect(textOf(await call(second, 'web_browser_screenshot', {}))).toContain('no explicit permission')
  const unrouted = await ctx.agentLoop.create(SessionId('unrouted-image-consumer'), {})
  await ctx.desktopBrowserControl.bind(unrouted.session.id, TARGET)
  expect(textOf(await call(unrouted, 'web_browser_screenshot', {}))).toContain('resolved image-capable model route')
  expect(channel.commands).toEqual([])
})

it('refuses an accepted observation with no observation payload', async () => {
  await ctx.plugin(Provider, { controlled: true })
  const result = await call(first, 'web_browser_observe', {})
  expect(result.isError).toBe(true)
  expect(textOf(result)).toContain('returned none')
  expect(channel.commands).toHaveLength(1)
})

it('refuses resource acquisition when its previously admitted binding disappears', async () => {
  await ctx.plugin(Provider, { controlled: true })
  unbindAfterRead = bindingReads + 1
  const captured = await call(first, 'web_browser_screenshot', {})
  expect(captured.isError).toBe(true)
  expect(textOf(captured)).toContain('no explicit permission')
  expect(channel.commands).toEqual([])
})

it('rejects queued observation and screenshot calls after their binding is withdrawn', async () => {
  const entered = Promise.withResolvers<undefined>(), finish = Promise.withResolvers<undefined>()
  channel.reply = async (command) => { entered.resolve(undefined); await finish.promise; return observed(command) }
  await ctx.plugin(Provider, { controlled: true })
  const active = call(first, 'web_browser_observe', {})
  await entered.promise
  const previousReads = bindingReads
  const queuedRead = call(first, 'web_browser_observe', {})
  const queuedCapture = call(first, 'web_browser_screenshot', {})
  await until(() => bindingReads >= previousReads + 2, 'queued calls did not capture their binding')
  await ctx.desktopBrowserControl.unbind(first.session.id)
  finish.resolve(undefined)
  await active
  for (const result of await Promise.all([queuedRead, queuedCapture])) {
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('no explicit permission')
  }
  expect(channel.commands).toHaveLength(1)
})

it.each([false, undefined])('refuses screenshot capture before Native dispatch when image capability is %s', async (capability) => {
  imageCapable = capability
  await ctx.plugin(Provider, { controlled: true })
  const captured = await call(first, 'web_browser_screenshot', {})
  expect(captured.isError).toBe(true)
  expect(textOf(captured)).toContain('declares image input')
  expect(channel.commands).toEqual([])
  expect(captureBytes).toBeUndefined()
})

it('refuses screenshot capture without the capture policy before sending a Native command', async () => {
  await stopCapture()
  await ctx.plugin(Provider, { controlled: true })
  const captured = await call(first, 'web_browser_screenshot', {})
  expect(captured.isError).toBe(true)
  expect(textOf(captured)).toContain('capture policy')
  expect(channel.commands).toEqual([])
})

it('rechecks the binding after asynchronous model route resolution before Native capture', async () => {
  const entered = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  resolveRoute = async () => { entered.resolve(undefined); await resume.promise }
  await ctx.plugin(Provider, { controlled: true })
  const pending = call(first, 'web_browser_screenshot', {})
  await entered.promise
  await ctx.desktopBrowserControl.unbind(first.session.id)
  resume.resolve(undefined)
  const captured = await pending
  expect(captured.isError).toBe(true)
  expect(textOf(captured)).toContain('no explicit permission')
  expect(channel.commands).toEqual([])
})

it.each(['unbind', 'cancel'] as const)('refuses a late screenshot after %s without returning an image block', async (action) => {
  const entered = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  channel.reply = async (command) => {
    entered.resolve(undefined)
    await finish.promise
    return { ...ok(command.requestId), screenshot: new Uint8Array([0, 1, 2, 250]) }
  }
  await ctx.plugin(Provider, { controlled: true })
  const controller = new AbortController()
  const result = call(first, 'web_browser_screenshot', {}, controller.signal)
  await entered.promise
  if (action === 'unbind') await ctx.desktopBrowserControl.unbind(first.session.id)
  else controller.abort(new Error('owned screenshot cancelled'))
  finish.resolve(undefined)
  const captured = await result
  expect(captured.isError).toBe(true)
  expect(captured.content.every(block => block.type !== 'image')).toBe(true)
  expect(channel.commands).toHaveLength(1)
})

it.each([
  { reason: 'stale-observation', expected: 'Run web_browser_observe again' },
  { reason: 'revoked', expected: 'test page was closed' },
  { reason: 'wrong-target', expected: 'not the one the browser channel serves' },
  { reason: 'epoch-mismatch', expected: 'browser session was replaced' },
  { reason: 'unknown-operation', expected: 'does not offer that operation' },
  { reason: 'action-failed', expected: 'could not validate the action' },
] satisfies { reason: DesktopBrowserDenialReason; expected: string }[])(
  'reports %s as the refusal it is, after the command reached the channel',
  async ({ reason, expected }) => {
    await ctx.plugin(Provider, { controlled: true })
    channel.reply = command => ({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: command.requestId, ok: false, outcome: 'not-executed', reason })

    const refused = await call(first, 'web_browser_click', { ref: 'e1', generation: 3 })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain(expected)
    // The stale reference reached the channel, which is where that refusal is decided.
    expect(channel.commands[0]?.body).toEqual({ kind: 'click', ref: 'e1', generation: 3 })
  },
)

it('refuses an observation that belongs to another Host generation or another target', async () => {
  await ctx.plugin(Provider, { controlled: true })

  channel.reply = command => observed(command, EPOCH + 1)
  const otherEpoch = await call(first, 'web_browser_observe', {})
  expect(otherEpoch.isError).toBe(true)
  expect(textOf(otherEpoch)).toContain('command outcome is unknown')

  channel.reply = command => observed(command, EPOCH, OTHER_TARGET)
  const otherTarget = await call(first, 'web_browser_observe', {})
  expect(otherTarget.isError).toBe(true)
  expect(textOf(otherTarget)).toContain('command outcome is unknown')
})

it.each<DesktopBrowserUnknownReason>([
  'connection-lost', 'epoch-changed', 'channel-closed', 'invalid-reply', 'execution-failed',
])('reports %s without claiming non-execution or repeating the action', async (reason) => {
  await ctx.plugin(Provider, { controlled: true })
  channel.reply = command => ({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: command.requestId, ok: false, outcome: 'unknown', reason })
  const result = await call(first, 'web_browser_click', { ref: 'e1', generation: 4 })
  expect(result.isError).toBe(true)
  expect(textOf(result)).toContain('The action may already have changed the page.')
  expect(textOf(result)).toContain('Check the page and the business result before deciding whether to repeat the action.')
  expect(textOf(result)).not.toContain('nothing was run')
  expect(channel.commands).toHaveLength(1)
})

it('treats a thrown channel submission as unknown without retrying it', async () => {
  await ctx.plugin(Provider, { controlled: true })
  channel.reply = () => { throw new Error('disconnected after delivery') }
  const result = await call(first, 'web_browser_type', { ref: 'e2', generation: 4, text: 'SAVE10' })
  expect(result.isError).toBe(true)
  expect(textOf(result)).toContain('command outcome is unknown')
  expect(channel.commands).toHaveLength(1)
})

it('leaves the capability unmounted and the browser-use slot free without a channel', async () => {
  await ctx.plugin(Provider, {})

  expect(ctx.tools.schemas()).toEqual([])
  expect(ctx.browserUse.providerName).toBeUndefined()
  expect(ctx.get('webTest')!.provides('web-test.browser-automation')).toBe(false)
  expect(channel.connected).toEqual([])
})

it('never binds the first model caller or registers tools while disabled', async () => {
  await ctx.desktopBrowserControl.unbind(first.session.id)
  await ctx.plugin(Provider, { controlled: true })
  const result = await call(first, 'web_browser_observe', {})
  expect(result.isError).toBe(true)
  expect(textOf(result)).toContain('no explicit permission')
  expect(ctx.desktopBrowserControl.binding(first.session.id)).toBeUndefined()
  expect(channel.commands).toEqual([])
})

it('reserves the single target for one live Session and refuses a call without one', async () => {
  channel.reply = command => observed(command)
  await ctx.plugin(Provider, { controlled: true })

  expect((await call(first, 'web_browser_observe', {})).isError).toBe(false)
  const contended = await call(second, 'web_browser_observe', {})
  expect(contended.isError).toBe(true)
  expect(textOf(contended)).toContain('no explicit permission')

  const agentless = await call(undefined, 'web_browser_observe', {})
  expect(agentless.isError).toBe(true)
  expect(textOf(agentless)).toContain('require the Session that owns the test page')
})

it('stops the tools, settles owned work, withdraws availability, and only then frees the slot', async () => {
  const entered = Promise.withResolvers<undefined>()
  const settle = Promise.withResolvers<undefined>()
  channel.reply = (command) => {
    entered.resolve(undefined)
    return settle.promise.then(() => ok(command.requestId))
  }
  const provider = await ctx.plugin(Provider, { controlled: true })
  const owned = call(first, 'web_browser_observe', {})
  await entered.promise

  const closing = provider.dispose()
  try {
    await until(() => ctx.tools.schemas().length === 0, 'the tools never stopped')
    expect(ctx.get('webTest')!.provides('web-test.browser-automation')).toBe(true)
    expect(ctx.browserUse.providerName).toBe('web-test-browser')
    expect(() => ctx.browserUse.register(BrowserUseProviderName('other'))).toThrow('already registered')
  } finally {
    settle.resolve(undefined)
    await closing
  }
  expect((await owned).isError).toBe(true)
  expect(channel.connected).toEqual([])
  expect(channel.disconnected).toEqual([])
  expect(ctx.get('webTest')!.provides('web-test.browser-automation')).toBe(false)
  expect(ctx.browserUse.providerName).toBeUndefined()
})

it('refuses cached resources after a trusted unbind without dispatching another command', async () => {
  channel.reply = command => observed(command)
  await ctx.plugin(Provider, { controlled: true })
  expect((await call(first, 'web_browser_observe', {})).isError).toBe(false)
  await ctx.desktopBrowserControl.unbind(first.session.id)
  expect((await call(first, 'web_browser_observe', {})).isError).toBe(true)
  expect(channel.commands).toHaveLength(1)
})
