/**
 * The enforcement layer beneath the gate: what a call reaches when the
 * conversation is offered nothing, and when it is offered a read it has not been
 * granted.
 *
 * The gate decides what the model is offered; this file asserts that the policy
 * still decides every call underneath it, so an open tool is never a permitted
 * one. Both cases run against the real policy guard over the real registry.
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

describe('policy enforcement beneath the conversation gate', () => {
  it('refuses a governed call from a conversation attached to no project', async () => {
    const app = await boot()
    const agent = await app.rootAgent('probe-unattached')
    const project = await app.registerProject('cmd-probe-unattached')

    // Another session's declaration is in force, and this session still cannot
    // borrow it: the ledger decides a named session against its own binding.
    app.conversation.attach(project.projectId, project.projectId)
    app.conversation.declareEnvironment(
      project.projectId,
      app.confirmationRequest(project, 'cmd-probe-declared'),
    )

    const refused = await app.callTool(agent, 'read', { file_path: `${app.codeRoot}/src/app.ts` })
    expect(refused).toContain('web testing policy refused "read" (denied-outside-scope)')
  })

  it('refuses a read of the same file once the conversation is attached and declared', async () => {
    const app = await boot()
    const agent = await app.rootAgent('probe-attached')
    const project = await app.registerProject('cmd-probe-attached')
    app.attachAndDeclare(agent.session.id, project, 'cmd-probe-attach-declared')

    // The gate now offers `read`, and the policy still refuses it: an open tool
    // is a tool the model may name, not one it may run.
    const refused = await app.callTool(agent, 'read', { file_path: `${app.codeRoot}/src/app.ts` })
    expect(refused).toContain('web testing policy refused "read" (denied-expired-authorization)')
  })
})
