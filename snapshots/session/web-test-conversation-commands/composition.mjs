/** Snapshot-only Loader composition; production command and policy implementations remain real. */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { mock } from 'node:test'
const entry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/index.js' : 'src/index.ts'
const load = name => import(new URL(`../../../packages/web-test/${name}/${entry}`, import.meta.url).href)
const { WebTestContracts } = await load('web-test-contracts')
const { WebTestPolicy, WebTestRuntimeScope, SystemClock } = await load('web-test-policy')
const { default: WebTestRuntime } = await load('web-test-runtime')
const { default: WebTestConversation, WebTestCommands } = await load('web-test-conversation')
export const name = 'web-test-command-fixture'
export const inject = ['agents', 'tools', 'userQuestions', 'storageDomain', 'systemPrompt']
export async function apply(ctx) {
  // This scenario owns its process; fixed Date keeps durable probe time reproducible.
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 1) })
  ctx.effect(() => () => { mock.timers.reset() }, 'web-test-fixture.clock')
  const controlRoot = resolve('.dsh/webtest')
  await ctx.plugin(WebTestRuntime, { controlRoot })
  await ctx.plugin(WebTestContracts)
  await ctx.plugin(SystemClock)
  await ctx.plugin({
    name: 'web-test-command-scope', inject: ['webTestRuntime'],
    apply(inner) { new WebTestRuntimeScope(inner, { readProject: id => inner.webTestRuntime.readProject(id) }) },
  })
  await ctx.plugin(WebTestPolicy, { protectedPaths: [], confirmationRequiredFor: [] })
  await ctx.plugin(WebTestConversation, { askUserMode: 'legacy' })
  await ctx.plugin(WebTestCommands)
  await ctx.inject(['webTestRuntime', 'webTestConversation', 'webTestCommands'], async ctx => {
  mkdirSync(resolve('.dsh/private-root'), { recursive: true })
  mkdirSync(resolve('.dsh/input-code-a'), { recursive: true })
  mkdirSync(resolve('.dsh/input-code-b'), { recursive: true })
  ctx.systemPrompt.context({
    name: 'web-test-fixture-roots',
    order: ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION'),
    text: 'WEB_TEST_ROOT_A=.dsh/input-code-a\nWEB_TEST_ROOT_B=.dsh/input-code-b',
  })
  const privateReceipt = await ctx.webTestRuntime.registerProject({
    commandId: 'cmd-private-fixture', codeRoots: [resolve('.dsh/private-root')], entryUrls: ['http://localhost:5999/private'],
  })
  ctx.webTestConversation.attach('private-session', privateReceipt.resourceId)
  ctx.on('user-questions/request', async request => ({
    answers: request.questions.map(question => ({ id: question.id, selected: ['Confirm'] })),
  }))
  ctx.on('agent/pre-step', async ({ agent, step }, next) => {
    if (step === 4) {
      const report = ctx.webTestCommands.queryStatus({ sessionId: agent.session.id, verb: 'query', subject: 'environment' })
      if (!report.environmentConfirmed) throw new Error('the scenario must obtain real Confirm before its revision update')
    }
    return next()
  })
  ctx.on('agent/turn-stopping', ({ agent }) => {
    const report = ctx.webTestCommands.queryStatus({ sessionId: agent.session.id, verb: 'query', subject: 'environment' })
    if (report.project.codeRoots.length !== 2 || report.project.entryUrls.length !== 3
      || report.environmentConfirmed || report.project.revision !== 2 || report.environmentDeclarationRevision !== 1
      || report.environmentDeclaration?.supplementaryRequirements[0] !== 'Do not submit payments'
      || ctx.webTestRuntime.readSessionProject(agent.session.id) !== report.project.projectId
      || report.entryUrlProbe?.revision !== 2 || report.entryUrlProbe.entryUrls.length !== 3
      || report.entryUrlProbe.entryUrls.some(entry => entry.state !== 'unreachable')
      || ctx.webTestRuntime.listProjects().length !== 2) throw new Error('the command transcript did not commit the declared project facts: ' + JSON.stringify(report))
  })
  })
}
