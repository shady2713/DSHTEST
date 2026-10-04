/** Displayed project identities and queue-time Session ownership govern every metadata correction. */
import { afterEach, expect, it } from 'vitest'
import { startConversation } from './harness.ts'
import type { ConversationHarness } from './harness.ts'

let app: ConversationHarness | undefined
afterEach(async () => { await app?.stop(); app = undefined })

/** One live Session with two independent projects at the same revision. */
async function fixture() {
  app = await startConversation()
  const harness = app
  const remote = await harness.mountCommands()
  const agent = await harness.rootAgent('correction-target')
  const first = await harness.registerProject('cmd-correction-first')
  const second = await remote.commands.registerProject({
    sessionId: agent.session.id,
    registration: { commandId: 'cmd-correction-second', codeRoots: [harness.otherCodeRoot], entryUrls: ['http://localhost:3999/second'] },
  })
  await remote.commands.attachProject({ sessionId: agent.session.id, projectId: first.projectId })
  const request = {
    sessionId: agent.session.id, projectId: first.projectId, commandId: 'cmd-correction-target', expectedRevision: first.revision,
    codeRoots: first.codeRoots, entryUrls: ['http://localhost:3888/corrected'],
  }
  return { harness, remote, agent, first, second, request }
}

it('refuses an old project identity over the real Remote and tool even when the new project has the same revision', async () => {
  const { harness, remote, agent, first, second, request } = await fixture()
  await remote.commands.attachProject({ sessionId: agent.session.id, projectId: second.projectId })
  expect(await remote.call('updateProject', { request })).toMatchObject({ ok: false, error: { code: 'web-test-conversation/context-changed' } })
  expect(await harness.callTool(agent, 'web_test_update_project', request)).toContain('selected another project')
  await expect(remote.commands.probeEntryUrls(request)).rejects.toMatchObject({ code: 'web-test-conversation/context-changed' })
  expect(harness.ctx.webTestRuntime.listProjects()).toEqual([first, second])
  expect(harness.ctx.webTestRuntime.readEntryUrlProbe(second.projectId)).toBeUndefined()
})

it('refuses a correction queued behind a durable project switch before publishing either project', async () => {
  const { harness, remote, agent, first, second, request } = await fixture()
  const attaching = remote.commands.attachProject({ sessionId: agent.session.id, projectId: second.projectId })
  const updating = remote.commands.updateProject(request)
  expect(harness.conversation.context(agent.session.id)).toMatchObject({ projectId: first.projectId })
  await Promise.all([
    attaching,
    expect(updating).rejects.toMatchObject({ code: 'web-test-conversation/context-changed' }),
  ])
  expect(harness.ctx.webTestRuntime.listProjects()).toEqual([first, second])
  expect(harness.ctx.webTestRuntime.readSessionProject(agent.session.id)).toBe(second.projectId)
})

it('refuses disposed or cancelled correction owners while the update is waiting in the real queue', async () => {
  const { harness, remote, agent, first, second, request } = await fixture()
  const controller = new AbortController()
  const updating = remote.commands.updateProject(request, controller.signal)
  controller.abort()
  await expect(updating).rejects.toThrow()
  expect(harness.ctx.webTestRuntime.listProjects()).toEqual([first, second])
  const disposing = remote.commands.updateProject({ ...request, commandId: 'cmd-correction-dispose' })
  harness.disposeAgent(agent)
  await expect(disposing).rejects.toMatchObject({ code: 'web-test-conversation/unknown-session' })
  expect(harness.ctx.webTestRuntime.listProjects()).toEqual([first, second])
})
