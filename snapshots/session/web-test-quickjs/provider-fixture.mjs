/** Trusted scope setup for the real profile, QuickJS provider and Web testing policy. */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'
const leaf = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/index.js' : 'src/index.ts'
const { default: QuickJsPtcRuntime, isQuickJsPtcRuntime } = await import(new URL(`../../../packages/ptc-runtime/ptc-runtime-quickjs/${leaf}`, import.meta.url).href)
const { default: WebTestContracts } = await import(new URL(`../../../packages/web-test/web-test-contracts/${leaf}`, import.meta.url).href)
const { default: WebTestPolicy, SystemClock, WebTestRuntimeScope } = await import(new URL(`../../../packages/web-test/web-test-policy/${leaf}`, import.meta.url).href)

/** Scenario-local trusted setup plugin. */
export const name = 'web-test-quickjs-fixture'
/** Services supplied by the shipped headless profile. */
export const inject = ['agents', 'tools', 'sessions', 'fs', 'attachments']

/**
 * Mount production providers and bind each created Agent to its public synthetic scope.
 * @param ctx - Trusted scenario plugin context under the shipped profile.
 * @returns Completion after the real provider and policy are installed.
 */
export async function apply(ctx) {
  const codeRoot = resolve('code'), protectedRoot = resolve('protected')
  assert.equal((await stat(resolve(protectedRoot, 'synthetic.txt'))).isFile(), true)
  await ctx.plugin(QuickJsPtcRuntime, {})
  assert.equal(isQuickJsPtcRuntime(ctx.get('ptcRuntime')), true, 'Policy and fixture use one genuine provider module')
  await ctx.plugin(WebTestContracts)
  await ctx.plugin(SystemClock)
  const projectId = 'project-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  await ctx.plugin({
    name: 'web-test-quickjs-scope-source',
    apply(inner) {
      void new WebTestRuntimeScope(inner, {
        readProject(id) { return id === projectId ? { projectId, revision: 1, codeRoots: [codeRoot], entryUrls: [] } : undefined },
      })
    },
  })
  await ctx.plugin(WebTestPolicy, { protectedPaths: [{ path: protectedRoot, role: 'upload' }] })
  const policy = ctx.get('webTestPolicy')
  assert.ok(policy, 'The real policy mounted successfully')
  const plainContent = [{ type: 'text', text: 'Plain prompt\n中文输入' }]
  assert.deepEqual(await ctx.attachments.admitPromptContent(plainContent), plainContent)
  await assert.rejects(ctx.attachments.admitPromptContent([
    ...plainContent, { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
  ]), /attachments.admitPromptContent/u)
  policy.declareEnvironment({
    projectId, commandId: 'cmd-web-test-quickjs-declare', declaration: {
      codeRoots: [codeRoot], entryUrl: null, isTestEnvironment: true,
      login: { state: 'not-required' }, supplementaryRequirements: [],
    },
  })
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.effect(() => policy.bindEntry(agent.session.id, projectId))
    agent.ctx.tools.restrict({ allow: ['read'] })
  })
}
