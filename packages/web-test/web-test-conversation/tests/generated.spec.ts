/** Generated descriptors validated through the real Registry, Gateway, and RPC carrier. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'
import { startConversation } from './harness.ts'
import type { ConversationHarness } from './harness.ts'

let contribution: TypertContribution
let generationRoot: string
let app: ConversationHarness | undefined

beforeAll(async () => {
  const parent = resolve('packages/web-test/web-test-conversation/tests/.generated')
  mkdirSync(parent, { recursive: true })
  generationRoot = mkdtempSync(join(parent, 'generated-'))
  const artifact = new WorkspaceTypertGenerator(process.cwd()).generate(['@deepseek-ai/dsh-web-test-conversation'], ['host'])[0]
  if (artifact?.remote === undefined) throw new Error('Commands generated no Client projection')
  expect(artifact.remote.dts).toContain('queryStatus: (request: StatusQueryRequest)')
  expect(artifact.remote.dts).toContain('submitAction: (request: ActionRequest)')
  expect(artifact.remote.dts).toContain('updateProject: (request: ConversationProjectUpdateRequest, signal?: AbortSignal)')
  expect(artifact.js).toContain('environmentDeclarationRevision')
  expect(artifact.remote.dts).not.toContain('Record<string, unknown>')
  writeFileSync(join(generationRoot, 'host.mjs'), artifact.js)
  const generated = await import(pathToFileURL(join(generationRoot, 'host.mjs')).href) as { TYPERT: TypertContribution }
  contribution = generated.TYPERT
}, 30_000)

afterEach(async () => { await app?.stop(); app = undefined })
afterAll(() => { if (generationRoot !== undefined) rmSync(generationRoot, { recursive: true, force: true }) })

it('uses generated validation and returns the same project status to Client and conversation', async () => {
  app = await startConversation({ commandContribution: contribution })
  const remote = await app.mountCommands()
  const agent = await app.rootAgent('generated-command')
  const project = await app.registerProject('cmd-generated-project')
  await remote.commands.attachProject({ sessionId: agent.session.id, projectId: project.projectId })
  app.attachAndDeclare(agent.session.id, project, 'cmd-generated-declare')
  const request = { sessionId: agent.session.id, verb: 'query', subject: 'material' } as const
  expect(await remote.call('queryStatus', { request })).toEqual({ ok: true, value: remote.commands.queryStatus(request) })
  for (const request of [
    { sessionId: agent.session.id, verb: 'start', target: 'checkout', expectedRevision: 1 },
    { sessionId: agent.session.id, verb: 'query', subject: 'invalid' },
    { sessionId: agent.session.id, verb: 'query', subject: 'project', extra: true },
  ]) {
    const result = await remote.call('queryStatus', { request })
    if (request.verb !== 'query' || request.subject === 'invalid') expect(result.ok).toBe(false)
  }
  expect((await remote.call('submitAction', { request })).ok).toBe(false)
  const ordinary = await app.rootAgent('generated-ordinary')
  expect(await remote.call('queryStatus', { request: { sessionId: ordinary.session.id, verb: 'query', subject: 'project' } })).toMatchObject({
    ok: false, error: { code: 'web-test-conversation/no-project' },
  })
  const correction = { sessionId: agent.session.id, projectId: project.projectId, commandId: 'cmd-generated-correction', expectedRevision: project.revision, codeRoots: project.codeRoots, entryUrls: ['http://localhost:3555/corrected'] }
  expect(await remote.call('updateProject', { request: correction })).toMatchObject({ ok: true, value: { projectId: project.projectId, revision: 2, entryUrls: correction.entryUrls } })
  expect(await remote.call('updateProject', { request: { ...correction, commandId: 'invalid-token', expectedRevision: 2 } })).toMatchObject({ ok: false })
  expect(app.ctx.webTestRuntime.readProject(project.projectId)?.entryUrls).toEqual(correction.entryUrls)
  expect(app.ctx.webTestRuntime.listProjects()).toHaveLength(1)
})
