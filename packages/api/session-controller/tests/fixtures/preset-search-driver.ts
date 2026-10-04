/** Source-only regression driver: real profile Loader, preset binding, and Session Remote creation. */
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { WebTestContracts } from '@deepseek-ai/dsh-web-test-contracts'
import type { ProjectId, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import { SystemClock, WebTestPolicy, WebTestRuntimeScope } from '@deepseek-ai/dsh-web-test-policy'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const [root, standardPatch, overlay] = process.argv.slice(2)
if (root === undefined || standardPatch === undefined || overlay === undefined) throw new Error('expected owned root, standard preset, and overlay')
const ctx = await bootProductionProfile({ binName: 'preset-search-regression', profile: 'headless', overlayPaths: [standardPatch, overlay] })
try {
  const resolution = await ctx.agentPresets.resolve('standard')
  if (resolution.broken !== undefined) throw new Error(`standard preset is broken: ${resolution.broken}`)
  const created = await ctx.sessionController.create({ cwd: root, agentPreset: 'standard' })
  const agent = ctx.agents.get(created.sessionId)
  if (agent === undefined || created.agentPreset !== 'standard') throw new Error('Session Controller did not publish the standard Agent')
  const projectId = brandString<ProjectId>(`project-${'b'.repeat(32)}`)
  await ctx.plugin(WebTestContracts)
  await ctx.plugin(SystemClock)
  new WebTestRuntimeScope(ctx, { readProject: id => id === projectId ? {
    projectId, revision: brandNumber<Revision>(1), codeRoots: [root], entryUrls: ['http://localhost:3000/'],
  } : undefined })
  await ctx.plugin(WebTestPolicy, { protectedPaths: [], confirmationRequiredFor: [] })
  ctx.webTestPolicy.bindEntry(agent.session.id, projectId)
  ctx.webTestPolicy.declareEnvironment({ projectId, commandId: 'cmd-declare-environment', declaration: {
    codeRoots: [root], entryUrl: 'http://localhost:3000/', isTestEnvironment: true,
    login: { state: 'not-required' }, supplementaryRequirements: [],
  } })
  ctx.webTestPolicy.grantFlow({ sessionId: agent.session.id, flowId: 'search', flowRevision: 1, thirdParty: false, actions: 10 })
  await writeFile(join(root, 'actual.ts'), 'export const REAL_PRESET_NEEDLE = 42\n')
  const results: Record<string, string> = {}
  for (const [name, pattern] of [['glob', '*.ts'], ['grep', 'REAL_PRESET_NEEDLE']] as const) {
    const result = await agent.ctx.tools.execute({ agent, name, arguments: { pattern, path: root },
      callId: ToolCallId(`preset-search-${name}`), signal: new AbortController().signal })
    if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`)
    results[name] = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  }
  let genericDenied = false
  try {
    ctx.subprocess.spawn({ argv: [process.execPath, '--version'], cwd: root,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } }, graceMs: 100 })
  } catch (error) {
    genericDenied = error instanceof Error && error.message.includes('denied')
  }
  if (!genericDenied) throw new Error('generic process unexpectedly passed the policy')
  process.stdout.write(`${JSON.stringify({ created, preset: resolution, results, genericDenied })}\n`)
} finally {
  await ctx.fiber.dispose()
}
