/**
 * The session-to-project association this entry owns: what `attach()` does to
 * the policy binding when a session re-attaches to the project it already has,
 * and what it does to that binding when the session moves to another one.
 *
 * Every assertion is made through the real policy, over the real registry, so
 * the state under test is the one a governed call is actually decided in. The
 * refusal reason names that state: `denied-expired-authorization` is a session
 * that is bound and whose project is declared and whose file is in scope but no
 * grant is live, and `denied-outside-scope` is a session with no binding or a
 * file outside the project it is bound to.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { ConversationHarness, StartOptions } from './harness.ts'
import { startConversation } from './harness.ts'

let harness: ConversationHarness | undefined

/**
 * Boot one entry and keep it for teardown. A suite holds the returned handle
 * rather than the module variable, so a narrowing assertion inside a callback
 * still sees a defined harness.
 * @param options - the question-tool row and any tool name to leave unregistered.
 * @returns the booted harness.
 */
async function boot(options?: StartOptions): Promise<ConversationHarness> {
  const booted = await startConversation(options)
  harness = booted
  return booted
}

afterEach(async () => {
  await harness?.stop()
  harness = undefined
})

describe('session to project association', () => {
  it('keeps the binding standing when a session re-attaches to the same project', async () => {
    const app = await boot()
    const agent = await app.rootAgent('root-refresh')
    const project = await app.registerProject('cmd-refresh')
    app.attachAndDeclare(agent.session.id, project, 'cmd-declare-refresh')
    expect(app.leases()).toEqual({ taken: 1, released: 0, live: 1 })

    // The first refresh is the one that matters: the ledger's disposer withdraws
    // a binding by project value, so retiring the lease the refresh is standing
    // on would leave the session attached to nothing while its mask still reads
    // as attached and confirmed.
    app.conversation.attach(agent.session.id, project.projectId)
    app.conversation.declareEnvironment(
      agent.session.id,
      app.confirmationRequest(project, 'cmd-declare-refresh-again'),
    )

    const refused = await app.callTool(agent, 'read', { file_path: `${app.codeRoot}/src/app.ts` })
    expect(refused).toContain('web testing policy refused "read" (denied-expired-authorization)')
    expect(app.visibleToolNames(agent)).toEqual(expect.arrayContaining(['read', 'read_image', 'glob', 'grep']))
    // A refresh takes no second lease, so there is no second lease to release.
    expect(app.leases()).toEqual({ taken: 1, released: 0, live: 1 })

    // Repeating it neither recovers nor compounds: the binding taken by the
    // first attach is the binding every refresh is judged against.
    for (const attempt of [2, 3]) {
      app.conversation.attach(agent.session.id, project.projectId)
      app.conversation.declareEnvironment(
        agent.session.id,
        app.confirmationRequest(project, `cmd-declare-refresh-${String(attempt)}`),
      )
    }
    const afterRepeats = await app.callTool(agent, 'read', { file_path: `${app.codeRoot}/src/app.ts` })
    expect(afterRepeats).toContain('web testing policy refused "read" (denied-expired-authorization)')
    expect(app.leases()).toEqual({ taken: 1, released: 0, live: 1 })
  })

  it('closes the mask on a re-attach until the environment is confirmed again', async () => {
    const app = await boot()
    const agent = await app.rootAgent('root-refresh-undeclared')
    const project = await app.registerProject('cmd-refresh-undeclared')
    app.attachAndDeclare(agent.session.id, project, 'cmd-declare-refresh-undeclared')
    expect(app.visibleToolNames(agent)).toContain('read')

    // The confirmation is this entry's own fact, so a re-attach drops it even
    // when the project is unchanged: the tools close until the environment is
    // confirmed again, rather than a previous confirmation standing in for one
    // this attachment never had.
    app.conversation.attach(agent.session.id, project.projectId)
    for (const name of app.deniedGovernedNames(agent)) {
      expect(app.visibleToolNames(agent)).not.toContain(name)
    }
    expect(app.leases()).toEqual({ taken: 1, released: 0, live: 1 })

    // Confirming again reopens them, and the session is still bound to the
    // project the refresh left it attached to.
    app.conversation.declareEnvironment(
      agent.session.id,
      app.confirmationRequest(project, 'cmd-declare-refresh-undeclared-again'),
    )
    expect(app.visibleToolNames(agent)).toContain('read')
    const refused = await app.callTool(agent, 'read', { file_path: `${app.codeRoot}/src/app.ts` })
    expect(refused).toContain('web testing policy refused "read" (denied-expired-authorization)')
  })

  it('decides the next call against the new project only, once a session moves', async () => {
    const app = await boot()
    const agent = await app.rootAgent('root-move')
    // Two projects with disjoint code roots, so the refusal reason says which
    // project the session is bound to rather than only that one of the two
    // declarations happened to be the stale one.
    const first = await app.registerProject('cmd-move-first', 'http://localhost:3000/first', app.codeRoot)
    const second = await app.registerProject('cmd-move-second', 'http://localhost:4000/second', app.otherCodeRoot)
    app.attachAndDeclare(agent.session.id, first, 'cmd-declare-move-first')
    const inFirst = await app.callTool(agent, 'read', { file_path: `${app.codeRoot}/src/app.ts` })
    expect(inFirst).toContain('web testing policy refused "read" (denied-expired-authorization)')

    app.attachAndDeclare(agent.session.id, second, 'cmd-declare-move-second')
    // The moved session is decided against the project it moved to: a file
    // inside that project's root is in scope, and one inside the project it left
    // is not. A surviving binding on the first project refuses both, because
    // this suite gives the two projects no root in common.
    const inSecond = await app.callTool(agent, 'read', { file_path: `${app.otherCodeRoot}/src/app.ts` })
    expect(inSecond).toContain('web testing policy refused "read" (denied-expired-authorization)')
    const inFirstAgain = await app.callTool(agent, 'read', { file_path: `${app.codeRoot}/src/app.ts` })
    expect(inFirstAgain).toContain('web testing policy refused "read" (denied-outside-scope)')

    // The move released the lease it abandoned and took exactly one new one.
    expect(app.leases()).toEqual({ taken: 2, released: 1, live: 1 })
  })

  it('releases every lease it abandons, and the one it keeps is the one it took last', async () => {
    const app = await boot()
    const agent = await app.rootAgent('root-lease-tally')
    const first = await app.registerProject('cmd-lease-first', 'http://localhost:3000/first', app.codeRoot)
    const second = await app.registerProject('cmd-lease-second', 'http://localhost:4000/second', app.otherCodeRoot)

    app.conversation.attach(agent.session.id, first.projectId)
    expect(app.leases()).toEqual({ taken: 1, released: 0, live: 1 })
    // A refresh of the lease just taken abandons nothing, so it takes nothing.
    app.conversation.attach(agent.session.id, first.projectId)
    expect(app.leases()).toEqual({ taken: 1, released: 0, live: 1 })

    app.conversation.attach(agent.session.id, second.projectId)
    expect(app.leases()).toEqual({ taken: 2, released: 1, live: 1 })
    app.conversation.attach(agent.session.id, first.projectId)
    expect(app.leases()).toEqual({ taken: 3, released: 2, live: 1 })

    // Three leases taken, two abandoned ones released, one live: the live one is
    // the third, so a second release of the first — the ledger deletes by
    // project value, and this project is the one bound again — would have left
    // the session attached to nothing.
    app.conversation.declareEnvironment(
      agent.session.id,
      app.confirmationRequest(first, 'cmd-declare-lease-last'),
    )
    const refused = await app.callTool(agent, 'read', { file_path: `${app.codeRoot}/src/app.ts` })
    expect(refused).toContain('web testing policy refused "read" (denied-expired-authorization)')
    expect(app.leases()).toEqual({ taken: 3, released: 2, live: 1 })
  })
})
