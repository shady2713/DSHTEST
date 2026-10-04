/**
 * The command Remote reached the way each of its two callers reaches it: a card
 * over the real Typert Registry, Gateway, and shared RPC carrier, and the
 * conversation in-process. Valid typed requests exercise both callers;
 * malformed requests enter through the JSON carrier. The generated descriptor,
 * wire framing and runtime association are exercised together.
 *
 * The three facts this suite exists to pin are that a status query changes
 * nothing, that a session attached to no project reaches no project even while
 * another session is attached and confirmed, and that the five mutating verbs
 * are answered as unavailable rather than queued.
 */

import { rmSync } from 'node:fs'
import type { ProjectMetadata } from '@deepseek-ai/dsh-web-test-contracts'
import { afterEach, describe, expect, it } from 'vitest'
import type { CommandHarness, ConversationHarness, StartOptions } from './harness.ts'
import { startConversation } from './harness.ts'
import { MUTATING_COMMANDS, requiredFields } from '../src/index.ts'
import type { ActionRequest, StatusQueryRequest } from '../src/command.ts'

let harness: ConversationHarness | undefined

/**
 * Boot the entry, the command Remote, and the carrier that addresses it.
 * @param options - the question-tool row and any tool name to leave unregistered.
 * @returns the booted harness and its mounted command Remote.
 */
async function boot(options?: StartOptions): Promise<{ app: ConversationHarness; remote: CommandHarness }> {
  const app = await startConversation(options)
  harness = app
  const remote = await app.mountCommands()
  return { app, remote }
}

afterEach(async () => {
  await harness?.stop()
  harness = undefined
})

/**
 * Assert the actual JSON carrier refuses a malformed or unauthorized request.
 * Typed same-process callers cannot construct the malformed requests.
 * @param remote - the mounted command Remote and its carrier.
 * @param method - which Remote surface the request is addressed to.
 * @param request - the raw request.
 * @param expectedMessage - the reason the wire caller must read.
 * @returns the wire refusal message.
 */
async function expectRefused(
  remote: CommandHarness,
  method: 'queryStatus' | 'submitAction',
  request: Record<string, unknown>,
  expectedMessage: string,
): Promise<string> {
  const overCarrier = await remote.call(method, { request })
  expect(overCarrier.ok).toBe(false)
  const message = (overCarrier.error as { message: string }).message
  expect(message).toContain(expectedMessage)
  return message
}

describe('one Remote, two callers', () => {
  it('serves the same closed command set to a card and to the conversation', async () => {
    const { remote } = await boot()
    const overCarrier = await remote.call('describeCommands', {})
    const inProcess = remote.commands.describeCommands()

    expect(overCarrier.ok).toBe(true)
    expect(overCarrier.value).toEqual(inProcess)
    expect(inProcess.commands.map(row => row.verb)).toEqual([
      'query', 'generate-case', 'start', 'pause', 'resume', 'cancel',
    ])
    expect(inProcess.commands.filter(row => row.available).map(row => row.verb)).toEqual(['query'])
  })

  it('answers a card and the conversation identically from the one implementation', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-one-remote')
    const project = await app.registerProject('cmd-one-remote')
    app.attachAndDeclare(agent.session.id, project, 'cmd-one-remote-declared')

    const ask: StatusQueryRequest = { sessionId: agent.session.id, verb: 'query', subject: 'project' }
    const overCarrier = await remote.call('queryStatus', { request: ask })
    const inProcess = remote.commands.queryStatus(ask)

    expect(overCarrier.ok).toBe(true)
    expect(overCarrier.value).toEqual(inProcess)
  })
})

describe('a status query', () => {
  it('answers with the project, the confirmation fact, and the declared material', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-query')
    const project = await app.registerProject('cmd-query')
    app.attachAndDeclare(agent.session.id, project, 'cmd-query-declared')

    const answer = await remote.call('queryStatus', {
      request: { sessionId: agent.session.id, verb: 'query', subject: 'material' },
    })
    expect(answer.ok).toBe(true)
    const report = answer.value as {
      project: ProjectMetadata
      environmentConfirmed: boolean
      material: { complete: boolean; codeRoots: { state: string }[]; entryUrls: { state: string }[] }
    }
    expect(report.project).toEqual(project)
    expect(report.environmentConfirmed).toBe(true)
    // Every root the project declared is judged on its own, so the whole list
    // is asserted rather than one entry of it.
    expect(report.material.codeRoots.map(row => row.state)).toEqual(['usable'])
    expect(report.material.entryUrls[0]?.state).toBe('usable')
    expect(report.material.complete).toBe(true)
  })

  it('changes no business state at all', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-query-readonly')
    const project = await app.registerProject('cmd-query-readonly')
    app.attachAndDeclare(agent.session.id, project, 'cmd-query-readonly-declared')
    const before = {
      project: app.ctx.webTestRuntime.readProject(project.projectId),
      notifications: app.ctx.webTestRuntime.pendingNotifications().length,
      projects: app.ctx.webTestRuntime.listProjects().length,
      leases: app.leases(),
    }

    const answer = await remote.call('queryStatus', {
      request: { sessionId: agent.session.id, verb: 'query', subject: 'project' },
    })

    expect(answer.ok).toBe(true)
    expect(app.ctx.webTestRuntime.readProject(project.projectId)).toEqual(before.project)
    expect(app.ctx.webTestRuntime.pendingNotifications()).toHaveLength(before.notifications)
    expect(app.ctx.webTestRuntime.listProjects()).toHaveLength(before.projects)
    expect(app.leases()).toEqual(before.leases)
  })

  it('answers a session whose project has no confirmed environment without pretending it has one', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-query-undeclared')
    const project = await app.registerProject('cmd-query-undeclared')
    app.conversation.attach(agent.session.id, project.projectId)

    const answer = await remote.call('queryStatus', {
      request: { sessionId: agent.session.id, verb: 'query', subject: 'environment' },
    })
    expect(answer.ok).toBe(true)
    expect((answer.value as { environmentConfirmed: boolean }).environmentConfirmed).toBe(false)
  })

  it('reports material this host no longer holds rather than reporting readiness', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-query-missing')
    const project = await app.registerProject('cmd-query-missing')
    app.attachAndDeclare(agent.session.id, project, 'cmd-query-missing-declared')
    // The declaration stands, the tree does not: the project still answers a
    // status question, and the answer says the code root is gone.
    rmSync(app.codeRoot, { recursive: true, force: true })

    const answer = await remote.call('queryStatus', {
      request: { sessionId: agent.session.id, verb: 'query', subject: 'material' },
    })
    const report = answer.value as { material: { complete: boolean; codeRoots: { state: string }[] } }
    expect(report.material.codeRoots.map(row => row.state)).toEqual(['absent'])
    expect(report.material.complete).toBe(false)
  })

  it('cannot be reached with a command that changes something', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-query-mismatch')
    const project = await app.registerProject('cmd-query-mismatch')
    app.attachAndDeclare(agent.session.id, project, 'cmd-query-mismatch-declared')
    const start: ActionRequest = { sessionId: agent.session.id, verb: 'start', target: 'checkout', expectedRevision: project.revision }

    // The action surface answers it, as this stage's own limit, and the status
    // surface refuses it: the two requests are not interchangeable. Both forms of
    // a mutating ask reach the same refusal, whether or not it named its fields.
    expect(remote.commands.submitAction(start).kind).toBe('unavailable')
    const completeMessage = await expectRefused(remote, 'queryStatus', start, 'nothing else')
    expect(completeMessage).toContain('decided by submitAction')
    const incompleteMessage = await expectRefused(
      remote,
      'queryStatus',
      { sessionId: agent.session.id, verb: 'start' },
      'nothing else',
    )
    expect(incompleteMessage).toContain('decided by submitAction')
  })

  it('refuses a status question that named no subject, and one outside the closed set', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-query-subject')
    const project = await app.registerProject('cmd-query-subject')
    app.attachAndDeclare(agent.session.id, project, 'cmd-query-subject-declared')

    for (const request of [
      { sessionId: agent.session.id, verb: 'query' },
      { sessionId: agent.session.id, verb: 'query', subject: 'everything' },
    ]) {
      await expectRefused(remote, 'queryStatus', request, 'names the subject')
    }
  })

  it('refuses a request that is not a web testing command at all', async () => {
    const { remote } = await boot()

    await expectRefused(
      remote,
      'queryStatus',
      { verb: 'query', subject: 'project' },
      'web testing command',
    )
    await expectRefused(
      remote,
      'submitAction',
      { sessionId: 'nobody', target: 'checkout' },
      'web testing command',
    )
  })
})

describe('a session attached to no project', () => {
  it('reaches no project, and the refusal names nothing about another project', async () => {
    const { app, remote } = await boot()
    const attached = await app.rootAgent('root-attached')
    const stranger = await app.rootAgent('root-stranger')
    const other = await app.registerProject('cmd-stranger-other', 'http://localhost:3000/admin', app.otherCodeRoot)
    app.attachAndDeclare(attached.session.id, other, 'cmd-stranger-other-declared')

    // The stranger's own Session exists, and another Session is attached and
    // confirmed right now. Neither fact reaches it.
    expect(app.conversation.context(stranger.session.id)).toEqual({ kind: 'ordinary' })
    for (const request of [
      { sessionId: stranger.session.id, verb: 'query', subject: 'project' },
      { sessionId: stranger.session.id, verb: 'start', target: 'checkout', expectedRevision: 1 },
    ]) {
      const method = request['verb'] === 'query' ? 'queryStatus' : 'submitAction'
      const message = await expectRefused(remote, method, request, 'attached to no project')
      expect(message).toContain(stranger.session.id)
      expect(message).not.toContain(other.projectId)
      expect(message).not.toContain(app.otherCodeRoot)
      expect(message).not.toContain('http://localhost:3000/admin')
    }
  })
})

describe('a mutating ask', () => {
  it('answers a vague command with the specific fields it owes', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-vague')
    const project = await app.registerProject('cmd-vague')
    app.attachAndDeclare(agent.session.id, project, 'cmd-vague-declared')

    const vague = remote.commands.submitAction({ sessionId: agent.session.id, verb: 'start' })
    expect(vague.kind).toBe('clarification')
    if (vague.kind !== 'clarification') throw new Error('the vague ask was not answered with a clarification')
    expect(vague.clarification.cause).toBe('incomplete-ask')
    expect(vague.clarification.missing).toEqual(['target', 'expectedRevision'])
    expect(vague.clarification.ask).toContain('name what to start')
    expect(vague.clarification.ask).toContain(project.projectId)

    const halfStated = remote.commands.submitAction({
      sessionId: agent.session.id, verb: 'start', target: 'checkout',
    })
    expect(halfStated).toMatchObject({ clarification: { missing: ['expectedRevision'] } })
  })

  it('asks for a confirmed environment before it considers anything else', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-undeclared-action')
    const project = await app.registerProject('cmd-undeclared-action')
    app.conversation.attach(agent.session.id, project.projectId)

    const outcome = remote.commands.submitAction({
      sessionId: agent.session.id, verb: 'start', target: 'checkout', expectedRevision: project.revision,
    })
    expect(outcome).toMatchObject({ kind: 'clarification', clarification: { cause: 'undeclared-environment' } })
    if (outcome.kind !== 'clarification') throw new Error('the ask was not answered with a clarification')
    expect(outcome.clarification.ask).toContain(project.projectId)
  })

  it('refuses an answer given against a project revision that has since moved', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-stale')
    const project = await app.registerProject('cmd-stale')
    app.attachAndDeclare(agent.session.id, project, 'cmd-stale-declared')
    const advanced = await app.advanceProject(project, 'cmd-stale-advance')

    const stale = remote.commands.submitAction({
      sessionId: agent.session.id, verb: 'start', target: 'checkout', expectedRevision: project.revision,
    })
    expect(stale.kind).toBe('stale')
    if (stale.kind !== 'stale') throw new Error('the stale ask was not answered as stale')
    expect(stale.reason).toContain('project revision 1')
    expect(stale.reason).toContain('published at revision 2')

    // The current revision requires its own confirmation before the command is admitted.
    const current = remote.commands.submitAction({
      sessionId: agent.session.id, verb: 'start', target: 'checkout', expectedRevision: advanced.revision,
    })
    expect(current).toMatchObject({ kind: 'clarification', clarification: { cause: 'undeclared-environment' } })
    app.conversation.declareEnvironment(agent.session.id, app.confirmationRequest(advanced, 'cmd-stale-confirm-current'))
    expect(remote.commands.submitAction({
      sessionId: agent.session.id, verb: 'start', target: 'checkout', expectedRevision: advanced.revision,
    }).kind).toBe('unavailable')
  })

  it('answers every mutating verb of the closed set as unavailable with its reason', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-unavailable')
    const project = await app.registerProject('cmd-unavailable')
    app.attachAndDeclare(agent.session.id, project, 'cmd-unavailable-declared')

    for (const verb of MUTATING_COMMANDS) {
      const [target] = requiredFields(verb)
      const outcome = await remote.call('submitAction', {
        request: {
          sessionId: agent.session.id,
          verb,
          [target?.name ?? '']: 'checkout',
          expectedRevision: project.revision,
        },
      })
      expect(outcome.ok).toBe(true)
      const value = outcome.value as { kind: string; verb: string; reason: string }
      expect(value.kind).toBe('unavailable')
      expect(value.verb).toBe(verb)
      expect(value.reason).toContain('this stage has no')
    }
  })

  it('cannot be reached with a status question, resolved or not', async () => {
    const { app, remote } = await boot()
    const agent = await app.rootAgent('root-action-mismatch')
    const project = await app.registerProject('cmd-action-mismatch')
    app.attachAndDeclare(agent.session.id, project, 'cmd-action-mismatch-declared')

    for (const request of [
      { sessionId: agent.session.id, verb: 'query', subject: 'project' },
      { sessionId: agent.session.id, verb: 'query' },
    ]) {
      const message = await expectRefused(remote, 'submitAction', request, 'nothing else')
      expect(message).toContain('only reads')
    }
  })
})
