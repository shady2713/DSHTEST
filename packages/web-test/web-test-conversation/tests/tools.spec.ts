/** Commands exercised through the official tool registry and the shared Remote. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ConversationHarness, CommandHarness } from './harness.ts'
import { startConversation } from './harness.ts'
import type { StartOptions } from './harness.ts'
import { dirname } from 'node:path'

let app: ConversationHarness | undefined
let remote: CommandHarness
afterEach(async () => { await app?.stop(); app = undefined })

async function boot(options?: StartOptions): Promise<ConversationHarness> {
  app = await startConversation(options)
  remote = await app.mountCommands()
  return app
}

describe('natural-language commands', () => {
  it('corrects the same project through the real tool and Remote, expires confirmation, and rejects a stale correction', async () => {
    const harness = await boot()
    const agent = await harness.rootAgent('tool-url-correction')
    const project = await harness.registerProject('cmd-url-correction-project')
    await harness.ctx.webTestCommands.attachProject({ sessionId: agent.session.id, projectId: project.projectId })
    const declaration = { codeRoots: project.codeRoots, entryUrl: project.entryUrls[0], isTestEnvironment: true, login: { state: 'not-required' }, supplementaryRequirements: ['Read only'] }
    harness.ctx.on('user-questions/request', async () => ({ answers: [{ id: 'web-test-environment', selected: ['Confirm'] }] }))
    await harness.callTool(agent, 'web_test_declare_environment', { commandId: 'cmd-url-correction-confirm', declaration })
    expect(harness.visibleToolNames(agent)).toContain('read')
    const correction = { projectId: project.projectId, commandId: 'cmd-url-correction-update', expectedRevision: project.revision, codeRoots: project.codeRoots, entryUrls: ['http://localhost:3444/corrected'] }
    const result: unknown = JSON.parse(await harness.callTool(agent, 'web_test_update_project', correction))
    expect(result).toMatchObject({ projectId: project.projectId, revision: 2, entryUrls: correction.entryUrls })
    expect(harness.ctx.webTestRuntime.listProjects()).toHaveLength(1)
    expect(harness.ctx.webTestRuntime.readSessionProject(agent.session.id)).toBe(project.projectId)
    expect(harness.visibleToolNames(agent)).not.toContain('read')
    expect(harness.ctx.webTestCommands.queryStatus({ sessionId: agent.session.id, verb: 'query', subject: 'environment' })).toMatchObject({
      environmentConfirmed: false, environmentDeclaration: declaration, environmentDeclarationRevision: project.revision,
      entryUrlProbe: null,
    })
    expect(JSON.parse(await harness.callTool(agent, 'web_test_update_project', correction))).toEqual(result)
    await expect(harness.ctx.webTestCommands.updateProject({ sessionId: agent.session.id, ...correction, commandId: 'cmd-url-correction-stale' })).rejects.toThrow('revision')
    expect(harness.ctx.webTestRuntime.listProjects()).toEqual([result])
  })

  it('expires confirmed tools on a published revision and requires another real Confirm for the current revision', async () => {
    const harness = await boot()
    const agent = await harness.rootAgent('tool-revision-confirmation')
    const project = await harness.registerProject('cmd-revision-project')
    await harness.ctx.webTestCommands.attachProject({ sessionId: agent.session.id, projectId: project.projectId })
    const initial = harness.ctx.webTestCommands.queryStatus({ sessionId: agent.session.id, verb: 'query', subject: 'environment' })
    expect(initial.environmentDeclarationRevision).toBeNull()
    const declaration = {
      codeRoots: project.codeRoots, entryUrl: project.entryUrls[0], isTestEnvironment: true,
      login: { state: 'not-required' }, supplementaryRequirements: ['Read only'],
    }
    let confirmations = 0
    harness.ctx.on('user-questions/request', async () => {
      confirmations += 1
      return { answers: [{ id: 'web-test-environment', selected: ['Confirm'] }] }
    })
    const confirm = (commandId: string) => harness.callTool(agent, 'web_test_declare_environment', { commandId, declaration })
    expect(JSON.parse(await confirm('cmd-revision-first-confirm'))).toMatchObject({
      environmentConfirmed: true, environmentDeclarationRevision: project.revision,
    })
    expect(harness.visibleToolNames(agent)).toContain('read')
    const current = await harness.advanceProject(project, 'cmd-revision-update')
    expect(harness.visibleToolNames(agent)).not.toContain('read')
    expect(harness.conversation.context(agent.session.id)).toMatchObject({ revision: current.revision, environmentConfirmed: false })
    const stale: unknown = JSON.parse(await harness.callTool(agent, 'web_test_query', { subject: 'environment' }))
    expect(stale).toMatchObject({
      project: current, environmentConfirmed: false,
      environmentDeclaration: declaration, environmentDeclarationRevision: project.revision,
    })
    expect(JSON.parse(await harness.callTool(agent, 'web_test_action', {
      verb: 'start', target: 'checkout', expectedRevision: current.revision,
    }))).toMatchObject({ kind: 'clarification', clarification: { cause: 'undeclared-environment' } })
    expect(JSON.parse(await confirm('cmd-revision-second-confirm'))).toMatchObject({
      environmentConfirmed: true, environmentDeclarationRevision: current.revision,
    })
    expect(confirmations).toBe(2)
    expect(harness.visibleToolNames(agent)).toContain('read')
  })

  it('shows pure command cards, attaches explicitly selected projects, and refuses calls without an Agent', async () => {
    const harness = await boot()
    const agent = await harness.rootAgent('tool-select-project')
    const project = await harness.registerProject('cmd-tool-selected')
    const status: unknown = JSON.parse(await harness.callTool(agent, 'web_test_attach', { projectId: project.projectId }))
    expect(status).toEqual(project)
    expect(harness.ctx.webTestRuntime.readSessionProject(agent.session.id)).toBe(project.projectId)
    const inputs = {
      web_test_query: { subject: 'project' },
      web_test_attach: { projectId: project.projectId },
      web_test_register_project: { commandId: 'cmd-present', codeRoots: [harness.codeRoot], entryUrls: [] },
      web_test_declare_environment: { commandId: 'cmd-present-declaration', declaration: { codeRoots: project.codeRoots, entryUrl: null, isTestEnvironment: true, login: { state: 'not-required' }, supplementaryRequirements: [] } },
      web_test_action: { verb: 'start' },
    }
    const before = harness.ctx.webTestRuntime.listProjects()
    expect(harness.ctx.tools.get('web_test_query', agent)?.isConcurrencySafe?.({ subject: 'project' })).toBe(true)
    for (const [name, input] of Object.entries(inputs)) expect(harness.ctx.tools.get(name, agent)?.presentCall?.(input)).toMatchObject({ card: 'generic', rawInput: input })
    expect(harness.ctx.webTestRuntime.listProjects()).toEqual(before)
    const result = await harness.ctx.tools.execute({ callId: ToolCallId('call-without-agent'), name: 'web_test_query', arguments: { subject: 'projects' }, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('requires a conversation Agent')
    await expect(harness.ctx.webTestCommands.attachProject({ sessionId: SessionId('not-live'), projectId: project.projectId })).rejects.toThrow('live root conversation')
  })

  it('refuses attachment or confirmation when a concurrent selection changes the Session', async () => {
    const harness = await boot()
    const agent = await harness.rootAgent('tool-concurrent-selection')
    const first = await harness.registerProject('cmd-race-first')
    const second = await harness.registerProject('cmd-race-second', 'http://localhost:3222/second', harness.otherCodeRoot)
    const save = harness.ctx.webTestRuntime.saveSessionProject.bind(harness.ctx.webTestRuntime)
    const attachSpy = vi.spyOn(harness.ctx.webTestRuntime, 'saveSessionProject').mockImplementationOnce(async (session, project) => { await save(session, project); await save(session, second.projectId) })
    await expect(harness.ctx.webTestCommands.attachProject({ sessionId: agent.session.id, projectId: first.projectId })).rejects.toThrow('another project')
    attachSpy.mockRestore()
    harness.conversation.attach(agent.session.id, first.projectId)
    const declaration = { codeRoots: first.codeRoots, entryUrl: first.entryUrls[0] ?? null, isTestEnvironment: true, login: { state: 'not-required' } as const, supplementaryRequirements: [] }
    const saveEnvironment = harness.ctx.webTestRuntime.saveEnvironment.bind(harness.ctx.webTestRuntime)
    const declareSpy = vi.spyOn(harness.ctx.webTestRuntime, 'saveEnvironment').mockImplementationOnce(async (...args) => { await saveEnvironment(...args); harness.conversation.attach(agent.session.id, second.projectId) })
    await expect(harness.ctx.webTestCommands.declareEnvironment({ sessionId: agent.session.id, commandId: 'cmd-race-declaration', declaration })).rejects.toThrow('changed while its environment facts')
    declareSpy.mockRestore()
    expect(harness.conversation.context(agent.session.id)).toMatchObject({ projectId: second.projectId, environmentConfirmed: false })
  })

  it('cancels a human confirmation without saving its declaration', async () => {
    const harness = await boot()
    const agent = await harness.rootAgent('tool-aborted-confirmation')
    const project = await harness.registerProject('cmd-aborted-project')
    harness.conversation.attach(agent.session.id, project.projectId)
    const controller = new AbortController()
    harness.ctx.on('user-questions/request', async () => { controller.abort(); return { answers: [{ id: 'web-test-environment', selected: ['Confirm'] }] } })
    const declaration = { codeRoots: project.codeRoots, entryUrl: project.entryUrls[0], isTestEnvironment: true, login: { state: 'not-required' }, supplementaryRequirements: [] }
    const result = await harness.ctx.tools.execute({ callId: ToolCallId('call-aborted-environment'), name: 'web_test_declare_environment', arguments: { commandId: 'cmd-aborted-declare', declaration }, signal: controller.signal, agent })
    expect(result.isError).toBe(true)
    expect(harness.ctx.webTestRuntime.readEnvironment(project.projectId)).toBeUndefined()
    expect(harness.conversation.context(agent.session.id)).toMatchObject({ environmentConfirmed: false })
  })
  it('reopens the same Session with saved materials and declaration but no restored confirmation', async () => {
    const first = await boot({ preserveRoot: true })
    const agent = await first.rootAgent('tool-reopened')
    const metadata = await first.ctx.webTestCommands.registerProject({
      sessionId: agent.session.id,
      registration: { commandId: 'cmd-reopen-register', codeRoots: [first.codeRoot, first.otherCodeRoot], entryUrls: ['http://localhost:3131/project'] },
    })
    const declaration = { codeRoots: metadata.codeRoots, entryUrl: metadata.entryUrls[0] ?? null, isTestEnvironment: true, login: { state: 'not-required' } as const, supplementaryRequirements: ['Read only'] }
    await first.ctx.webTestCommands.declareEnvironment({ sessionId: agent.session.id, commandId: 'cmd-reopen-declare', declaration })
    const advanced = await first.ctx.webTestCommands.updateProject({
      projectId: metadata.projectId,
      sessionId: agent.session.id, commandId: 'cmd-reopen-update', expectedRevision: metadata.revision,
      codeRoots: metadata.codeRoots, entryUrls: ['http://localhost:3131/corrected'],
    })
    const existingRoot = dirname(first.codeRoot)
    await first.stop()
    app = undefined
    const reopened = await boot({ existingRoot })
    const same = await reopened.rootAgent('tool-reopened')
    const report = reopened.ctx.webTestCommands.queryStatus({ sessionId: same.session.id, verb: 'query', subject: 'environment' })
    expect(report.project).toEqual(advanced)
    expect(report.environmentDeclaration).toEqual(declaration)
    expect(report.environmentDeclarationRevision).toBe(metadata.revision)
    expect(report.environmentConfirmed).toBe(false)
    expect(reopened.ctx.webTestCommands.submitAction({
      sessionId: same.session.id, verb: 'start', target: 'checkout', expectedRevision: advanced.revision,
    })).toMatchObject({ kind: 'clarification', clarification: { cause: 'undeclared-environment' } })
  })

  it('requires a real explicit Confirm rather than model-supplied environment facts', async () => {
    const harness = await boot()
    const agent = await harness.rootAgent('tool-human-confirmation')
    const project = await harness.registerProject('cmd-human-project')
    harness.conversation.attach(agent.session.id, project.projectId)
    const declaration = { codeRoots: project.codeRoots, entryUrl: project.entryUrls[0], isTestEnvironment: true, login: { state: 'not-required' }, supplementaryRequirements: [] }
    for (const answer of [{ selected: ['Decline'] }, { selected: [] }, { selected: ['Confirm'], custom: 'actually production' }, { selected: ['Confirm', 'Decline'] }]) {
      const release = harness.ctx.on('user-questions/request', async (request) => {
        expect(request.questions[0]?.question).toContain(JSON.stringify(declaration))
        return { answers: [{ id: 'web-test-environment', ...answer }] }
      })
      expect(JSON.parse(await harness.callTool(agent, 'web_test_declare_environment', { commandId: 'cmd-human-declaration', declaration }))).toMatchObject({ kind: 'declined' })
      release()
      expect(harness.ctx.webTestRuntime.readEnvironment(project.projectId)).toBeUndefined()
      expect(harness.conversation.context(agent.session.id)).toMatchObject({ environmentConfirmed: false })
    }
  })

  it('rejects a human confirmation after the project changes during the question', async () => {
    const harness = await boot()
    const agent = await harness.rootAgent('tool-stale-confirmation')
    const project = await harness.registerProject('cmd-confirmation-project')
    harness.conversation.attach(agent.session.id, project.projectId)
    harness.ctx.on('user-questions/request', async () => {
      await harness.advanceProject(project, 'cmd-confirmation-advance')
      return { answers: [{ id: 'web-test-environment', selected: ['Confirm'] }] }
    })
    const declaration = { codeRoots: project.codeRoots, entryUrl: project.entryUrls[0], isTestEnvironment: true, login: { state: 'not-required' }, supplementaryRequirements: [] }
    expect(JSON.parse(await harness.callTool(agent, 'web_test_declare_environment', { commandId: 'cmd-confirmation-declare', declaration }))).toMatchObject({ kind: 'stale' })
    expect(harness.ctx.webTestRuntime.readEnvironment(project.projectId)).toBeUndefined()
  })

  it('leaves an unanswered timed declaration pending without storing facts or granting confirmation', async () => {
    const harness = await boot({ config: { askUserMode: 'timed', askUserTimeoutSeconds: 1 } })
    const agent = await harness.rootAgent('tool-pending-confirmation')
    const project = await harness.registerProject('cmd-pending-project')
    harness.conversation.attach(agent.session.id, project.projectId)
    const declaration = { codeRoots: project.codeRoots, entryUrl: project.entryUrls[0], isTestEnvironment: true, login: { state: 'not-required' }, supplementaryRequirements: [] }
    expect(JSON.parse(await harness.callTool(agent, 'web_test_declare_environment', { commandId: 'cmd-pending-declare', declaration }))).toMatchObject({ kind: 'pending' })
    expect(harness.ctx.webTestRuntime.readEnvironment(project.projectId)).toBeUndefined()
    expect(harness.conversation.context(agent.session.id)).toMatchObject({ environmentConfirmed: false })
  })
  it('registers multiple roots and URLs, then accepts explicit environment facts through the same Remote', async () => {
    const harness = await boot()
    const agent = await harness.rootAgent('tool-onboarding')
    const registered: unknown = JSON.parse(await harness.callTool(agent, 'web_test_register_project', {
      commandId: 'cmd-tool-registration', codeRoots: [harness.codeRoot, harness.otherCodeRoot],
      entryUrls: ['http://localhost:3111/app', 'http://localhost:3222/admin'],
    }))
    const metadata = harness.ctx.webTestRuntime.listProjects()[0]
    if (metadata === undefined) throw new Error('the tool published no project')
    expect(registered).toEqual(metadata)
    expect(metadata.codeRoots).toEqual([harness.codeRoot, harness.otherCodeRoot])
    expect(metadata.entryUrls).toHaveLength(2)
    expect(harness.ctx.webTestRuntime.readSessionProject(agent.session.id)).toBe(metadata.projectId)
    const declaration = {
      codeRoots: metadata.codeRoots, entryUrl: metadata.entryUrls[0], isTestEnvironment: true,
      login: { state: 'required', accountLabel: 'test-account' }, supplementaryRequirements: ['Do not submit payments'],
    }
    harness.ctx.on('user-questions/request', async () => ({ answers: [{ id: 'web-test-environment', selected: ['Confirm'] }] }))
    const status: unknown = JSON.parse(await harness.callTool(agent, 'web_test_declare_environment', { commandId: 'cmd-tool-declaration', declaration }))
    expect(status).toMatchObject({ environmentConfirmed: true, environmentDeclaration: declaration })
    expect(harness.ctx.webTestRuntime.readEnvironment(metadata.projectId)?.declaration).toEqual(declaration)
  })

  it('does not let a query borrow another Session through model arguments or change domain state', async () => {
    const harness = await boot()
    const owner = await harness.rootAgent('tool-owner')
    const stranger = await harness.rootAgent('tool-stranger')
    const project = await harness.registerProject('cmd-tool-private')
    harness.attachAndDeclare(owner.session.id, project, 'cmd-tool-private-declaration')
    const before = harness.ctx.webTestRuntime.listProjects()
    const leases = harness.leases()
    const denial = await harness.callTool(stranger, 'web_test_query', { subject: 'project', sessionId: owner.session.id })
    expect(denial).toContain('attached to no project')
    expect(denial).not.toContain(project.projectId)
    expect(denial).not.toContain(harness.codeRoot)
    expect(JSON.parse(await harness.callTool(stranger, 'web_test_query', { subject: 'projects' }))).toEqual([
      { projectId: project.projectId, revision: project.revision },
    ])
    expect(harness.ctx.webTestRuntime.listProjects()).toEqual(before)
    expect(harness.leases()).toEqual(leases)
    expect(harness.ctx.webTestRuntime.readSessionProject(stranger.session.id)).toBeUndefined()
  })

  it('rejects invalid input, reports missing fields, and never performs the five business actions', async () => {
    const harness = await boot()
    const agent = await harness.rootAgent('tool-unavailable')
    const invalid = await harness.callTool(agent, 'web_test_register_project', { commandId: 'cmd-tool-invalid', codeRoots: [], entryUrls: ['garbage'] })
    expect(invalid).not.toMatch(/"projectId"/u)
    expect(harness.ctx.webTestRuntime.listProjects()).toEqual([])
    const project = await harness.registerProject('cmd-tool-valid')
    harness.attachAndDeclare(agent.session.id, project, 'cmd-tool-confirmed')
    const clarification: unknown = JSON.parse(await harness.callTool(agent, 'web_test_action', { verb: 'start' }))
    expect(clarification).toMatchObject({ kind: 'clarification', clarification: { missing: ['target', 'expectedRevision'] } })
    for (const verb of ['generate-case', 'start', 'pause', 'resume', 'cancel']) {
      expect(JSON.parse(await harness.callTool(agent, 'web_test_action', { verb, target: 'checkout', requirement: 'checkout', expectedRevision: project.revision }))).toMatchObject({ kind: 'unavailable', verb })
    }
    expect(harness.ctx.webTestRuntime.listProjects()).toEqual([project])
    expect(await harness.callTool(agent, 'web_test_query', { subject: 'start' })).toContain('invalid arguments')
  })

  it('removes tools and refuses retained command references when the plugin unloads', async () => {
    const harness = await boot()
    const commands = harness.ctx.webTestCommands
    const agent = await harness.rootAgent('tool-unload')
    expect(harness.visibleToolNames(agent)).toContain('web_test_query')
    await remote.unload()
    expect(harness.visibleToolNames(agent)).not.toContain('web_test_query')
    expect(() => commands.listProjects()).toThrow('unloaded')
    expect(() => commands.describeCommands()).toThrow('unloaded')
  })
})
