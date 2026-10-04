/** Recorded tool images through actual Policy/storage; the carrier is a unit seam, not Native evidence. */
import assert from 'node:assert/strict'
import { join } from 'node:path'

const plane = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/index.js' : 'src/index.ts'
const load = relative => import(new URL(`../../../packages/${relative}/${plane}`, import.meta.url).href)
const { default: WebTest } = await load('web-test/web-test')
const { default: Runtime } = await load('web-test/web-test-runtime')
const { WebTestContracts } = await load('web-test/web-test-contracts')
const { SystemClock, WebTestRuntimeScope, WebTestPolicy } = await load('web-test/web-test-policy')
const { DesktopBrowserControl, DESKTOP_BROWSER_AUTOMATION_VERSION } = await load('client/ui-sidebar-browser')
const Provider = await load('experimental/browser-use-web-test')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')

export const name = 'web-test-browser-image-fixture'
export const inject = ['browserUse', 'agents', 'tools', 'sessions', 'storageDomain', 'attachments']

export async function apply(ctx) {
  let calls = 0, requests = 0, settled = 0
  const url = 'http://127.0.0.1:3000/owned-image-unit-carrier'
  class FixtureControl extends DesktopBrowserControl {
    bindings = new Map()
    targets() { return [{ target: 'owned-image-unit-target', hostEpoch: 7, workspace: 'owned-image-unit-workspace', url }] }
    async bind(sessionId, target) {
      assert.ok(ctx.sessions.get(sessionId))
      assert.equal(target, this.targets()[0].target)
      const binding = { ...this.targets()[0], sessionId }
      this.bindings.set(sessionId, binding)
      return binding
    }
    async unbind(sessionId) { this.bindings.delete(sessionId) }
    binding(sessionId) { return this.bindings.get(sessionId) }
    async submit(sessionId, body, signal) {
      signal?.throwIfAborted()
      assert.ok(this.binding(sessionId))
      assert.deepEqual(body, { kind: 'screenshot', format: 'png' })
      assert.equal(++calls, 1, 'unit capture is not repeated')
      return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: calls, ok: true, screenshot: png }
    }
  }
  await ctx.plugin(WebTest)
  await ctx.plugin(WebTestContracts)
  await ctx.plugin(Runtime, { controlRoot: join(process.env.DSH_HOME, 'owned-image-control'), storageMode: 'generation-json' })
  const runtime = ctx.get('webTestRuntime')
  await ctx.plugin(SystemClock)
  await ctx.plugin(WebTestRuntimeScope, runtime)
  await ctx.plugin(WebTestPolicy, { protectedPaths: [], confirmationRequiredFor: [], confirmationTtlMs: 60000,
    authorizationValidityMs: 300000, maxActionsPerFlow: 8 })
  const policy = ctx.get('webTestPolicy')
  const project = await runtime.registerProject({ commandId: 'cmd-owned-image-project', codeRoots: [process.cwd()], entryUrls: [url] })
  policy.declareEnvironment({ projectId: project.resourceId, commandId: 'cmd-owned-image-declare', declaration: {
    codeRoots: [process.cwd()], entryUrl: url, isTestEnvironment: true, login: { state: 'not-required' }, supplementaryRequirements: [],
  } })
  await ctx.plugin(FixtureControl)
  await ctx.plugin(Provider, { controlled: true })
  ctx.on('agent/created', async ({ agent }) => {
    agent.ctx.effect(() => policy.bindEntry(agent.session.id, project.resourceId), 'owned-image.policy-binding')
    policy.grantFlow({ sessionId: agent.session.id, flowId: 'owned-image-flow', flowRevision: 1, thirdParty: false, actions: 8 })
    await ctx.get('desktopBrowserControl').bind(agent.session.id, 'owned-image-unit-target')
    agent.ctx.tools.restrict({ allow: ['web_browser_screenshot'] })
  })
  ctx.on('tools/result', (exec, result) => {
    if (exec.name !== 'web_browser_screenshot') return
    assert.equal(++settled, 1)
    assert.equal(result.isError, false)
    assert.equal(result.content.filter(block => block.type === 'image').length, 1)
    assert.ok(result.content.every(block => block.type !== 'text' || !block.text.includes(png.toString('base64'))))
  })
  ctx.on('llm/stream', (options, next) => {
    assert.ok(++requests <= 2, 'only the authored capture and image response requests are allowed')
    if (requests === 2) {
      const image = options.messages.flatMap(message => message.content).find(block => block.type === 'image')
      assert.ok(image, 'the second actual model request carries the formal image')
      assert.equal(image.attachment.width, 1)
      assert.equal(image.attachment.height, 1)
      assert.equal(calls, 1)
      assert.equal(settled, 1)
      return (async function* () {
        const stored = await ctx.attachments.readImageRequest(image.attachment, { width: 1, height: 1, maxBytes: 4096 })
        assert.deepEqual(stored.attachment, image.attachment)
        assert.ok(stored.data.byteLength > 0, 'the actual request image bytes remain readable')
        yield* next()
      })()
    }
    return next()
  })
}
