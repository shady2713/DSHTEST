/**
 * The conversation gate: which tools an official root conversation is offered,
 * as its own session is attached to a project and that project's environment is
 * confirmed.
 *
 * Every assertion is made against the real registry, the real agent registry,
 * and the real persistence authority and policy behind the entry. The stand-in
 * tool bodies exist so the registry holds a governed name; the mask under test
 * is about names, and the refusals asserted here come from the real policy guard.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { ProjectId } from '@deepseek-ai/dsh-web-test-contracts'
import { CONVERSATION_CAPABILITY_TOOLS, WebTestConversationError, governedToolNames, unimplementedToolNames } from '../src/index.ts'
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

describe('conversation tool gate', () => {
  it('offers an official root conversation none of the governed tools while it has no project', async () => {
    const app = await boot()
    const agent = await app.rootAgent('root-no-project')

    const governed = governedToolNames(app.ctx)
    expect(governed).toContain('read')
    expect(governed).toContain('bash')
    for (const name of governed) {
      expect(app.visibleToolNames(agent)).not.toContain(name)
    }
    // The conversation is still an ordinary conversation: a tool the web testing
    // policy does not govern is untouched by this gate.
    expect(app.visibleToolNames(agent)).toContain('ask_user_question')
  })

  it('keeps one conversation out of another conversation’s project context', async () => {
    const app = await boot()
    const first = await app.rootAgent('root-first')
    const second = await app.rootAgent('root-second')
    const project = await app.registerProject('cmd-isolated')

    app.attachAndDeclare(first.session.id, project, 'cmd-declare-first')

    expect(app.visibleToolNames(first)).toEqual(expect.arrayContaining([...CONVERSATION_CAPABILITY_TOOLS]))
    for (const name of governedToolNames(app.ctx)) {
      expect(app.visibleToolNames(second)).not.toContain(name)
    }
  })

  it('opens the tools this stage acts through only once the environment is confirmed', async () => {
    const app = await boot()
    const agent = await app.rootAgent('root-attach-only')
    const project = await app.registerProject('cmd-attach-only')

    const attached = app.conversation.attach(agent.session.id, project.projectId)
    expect(attached.codeRoots).toEqual([app.codeRoot])
    expect(app.visibleToolNames(agent)).not.toContain('read')

    const declared = app.conversation.declareEnvironment(
      agent.session.id,
      app.confirmationRequest(project, 'cmd-declare-attach-only'),
    )
    expect(declared.codeRoots).toEqual([app.codeRoot])
    expect(app.visibleToolNames(agent)).toEqual(expect.arrayContaining([...CONVERSATION_CAPABILITY_TOOLS]))
  })

  it('leaves a tool this stage does not act through unavailable rather than working', async () => {
    const app = await boot()
    const agent = await app.rootAgent('root-unavailable')
    const project = await app.registerProject('cmd-unavailable')
    app.attachAndDeclare(agent.session.id, project, 'cmd-declare-unavailable')

    expect(app.visibleToolNames(agent)).toContain('read')
    for (const name of ['write', 'edit', 'str_replace_editor', 'bash', 'pwsh', 'terminal_open']) {
      expect(app.visibleToolNames(agent)).not.toContain(name)
    }

    // Absent from the schema is not the whole claim: a call that names one anyway
    // is still refused by the policy, so an unmasked tool could not be a working
    // no-op in the first place.
    const refused = await app.callTool(agent, 'write', {
      file_path: `${app.codeRoot}/src/app.ts`, content: 'x',
    })
    expect(refused).toContain('web testing policy refused "write" (denied-protected-path)')
  })

  it('closes the tools again when the session is attached to a different project', async () => {
    const app = await boot()
    const agent = await app.rootAgent('root-rebind')
    const first = await app.registerProject('cmd-rebind-first', 'http://localhost:3000/first')
    const second = await app.registerProject('cmd-rebind-second', 'http://localhost:4000/second')
    app.attachAndDeclare(agent.session.id, first, 'cmd-declare-rebind-first')

    app.conversation.attach(agent.session.id, second.projectId)
    for (const name of governedToolNames(app.ctx)) {
      expect(app.visibleToolNames(agent)).not.toContain(name)
    }

    // The previous project's declaration is not this session's to keep: a call
    // under the new binding is decided against the new project, which has none.
    const refused = await app.callTool(agent, 'read', { file_path: `${app.codeRoot}/src/app.ts` })
    expect(refused).toContain('web testing policy refused "read" (denied-outside-scope)')
  })

  it('ignores an owned child, and releases the mask when an agent is disposed', async () => {
    const app = await boot()
    const parent = await app.rootAgent('root-parent')
    const child = await app.childAgent('owned-child', parent)
    const project = await app.registerProject('cmd-lifecycle')
    app.attachAndDeclare(parent.session.id, project, 'cmd-declare-lifecycle')

    // The fixture stands in for the loop agent, so the invariant the gate relies
    // on is asserted rather than assumed.
    expect(scopeOf(parent.ctx)).toBe(parent)
    expect(scopeOf(child.ctx)).toBe(child)

    expect(app.visibleToolNames(parent)).toEqual(expect.arrayContaining([...CONVERSATION_CAPABILITY_TOOLS]))
    // The child inherits its owner's scope, so it sees the same open set without
    // the entry having installed anything of its own for it.
    expect(app.visibleToolNames(child)).toEqual(app.visibleToolNames(parent))

    app.disposeAgent(parent)
    // The mask is per agent, so releasing it is observable on that agent's own
    // scope: the governed names it was hiding are visible there again.
    expect(app.visibleToolNames(parent)).toEqual(expect.arrayContaining(governedToolNames(app.ctx)))
  })

  it('leaves an owner\'s own mask standing when an agent it never gated is disposed', async () => {
    const app = await boot()
    const parent = await app.rootAgent('root-ungated')
    const child = await app.childAgent('ungated-child', parent)
    const project = await app.registerProject('cmd-ungated-owner')
    app.attachAndDeclare(parent.session.id, project, 'cmd-declare-ungated-owner')

    // A child the entry never gated is offered exactly what its owner is. Had
    // the entry given the child a mask of its own, the child's own
    // unassociated session would have closed every governed name for it.
    const owner = app.visibleToolNames(parent)
    expect(app.visibleToolNames(child)).toEqual(owner)
    expect(owner).toEqual(expect.arrayContaining([...CONVERSATION_CAPABILITY_TOOLS]))
    expect(owner).not.toContain('bash')

    // The disposal is the child's alone: the owner is offered the same set
    // afterwards, and is still decided in the policy exactly as it was, so
    // nothing the child took with it reached the owner's mask or its binding.
    app.disposeAgent(child)
    expect(app.ctx.agents.get(child.session.id)).toBeUndefined()
    expect(app.visibleToolNames(parent)).toEqual(owner)
    const refused = await app.callTool(parent, 'read', { file_path: `${app.codeRoot}/src/app.ts` })
    expect(refused).toContain('web testing policy refused "read" (denied-expired-authorization)')
  })

  it('denies the shipped governed names as a set that follows the confirmation', async () => {
    const app = await boot({ omitTools: ['bash', 'web_fetch'] })
    const agent = await app.rootAgent('root-partial')
    const governed = governedToolNames(app.ctx)
    // The governed set is the policy's adapter table crossed with the global
    // registry, so a governed name this deployment does not ship is not in it
    // and is never named by the mask: `tools.restrict()` refuses an unknown
    // global name rather than ignoring it, so naming one would fail the whole
    // attachment instead of masking nothing.
    expect(governed).not.toContain('bash')
    expect(governed).not.toContain('web_fetch')
    expect(governed).toEqual(expect.arrayContaining(['read', 'write']))

    // Unattached, the mask denies every shipped governed name.
    expect(app.deniedGovernedNames(agent)).toEqual(governed)
    const project = await app.registerProject('cmd-partial')
    app.attachAndDeclare(agent.session.id, project, 'cmd-declare-partial')
    // Attached and declared, the same mask built from the same set denies
    // exactly the shipped governed names this stage does not act through, and
    // the four it does are on offer. A gate that denied the same names in both
    // states, or different ones than the shipped set, fails one half or the
    // other.
    expect(app.deniedGovernedNames(agent)).toEqual(unimplementedToolNames(governed))
    expect(app.visibleToolNames(agent)).toEqual(expect.arrayContaining([...CONVERSATION_CAPABILITY_TOOLS]))
  })

  it('leaves the whole governed set on offer once it is confirmed, and none of it before', async () => {
    const app = await boot({ capabilitiesOnly: true })
    const agent = await app.rootAgent('root-all-capabilities')
    const governed = governedToolNames(app.ctx)
    // This deployment ships nothing this stage does not act through, so the
    // closed state denies the whole governed set and the open state has nothing
    // left to name: the two halves below are the same set at opposite states, so
    // a mask that denied every governed name, or none, cannot pass both.
    expect([...governed].sort()).toEqual([...CONVERSATION_CAPABILITY_TOOLS].sort())

    for (const name of governed) {
      expect(app.visibleToolNames(agent)).not.toContain(name)
    }
    const project = await app.registerProject('cmd-all-capabilities')
    app.attachAndDeclare(agent.session.id, project, 'cmd-declare-all-capabilities')
    for (const name of governed) {
      expect(app.visibleToolNames(agent)).toContain(name)
    }
    // Whether the entry then holds no restriction or one that denies nothing is
    // not readable from the registry's public surface — an empty deny list masks
    // exactly as no mask does — so what the pair above holds the entry to is the
    // offer itself, and skipping the call is how it reaches that offer.
  })

  it('refuses an attachment to a project the head does not publish', async () => {
    const app = await boot()
    const agent = await app.rootAgent('root-unpublished')
    const unpublished = brandString<ProjectId>(`project-${'b'.repeat(32)}`)

    expect(() => app.conversation.attach(agent.session.id, unpublished)).toThrow(WebTestConversationError)
    expect(() => app.conversation.attach(agent.session.id, unpublished)).toThrow(
      `project '${unpublished}' has no published entry`,
    )
    for (const name of governedToolNames(app.ctx)) {
      expect(app.visibleToolNames(agent)).not.toContain(name)
    }
  })

  it('refuses a declaration from a session that is attached to no project, or to another one', async () => {
    const app = await boot()
    const agent = await app.rootAgent('root-declare-refusals')
    const attached = await app.registerProject('cmd-attach-refusals')
    const other = await app.registerProject('cmd-other-refusals', 'http://localhost:5000/other')

    expect(() => app.conversation.declareEnvironment(
      agent.session.id,
      app.confirmationRequest(attached, 'cmd-declare-unattached'),
    )).toThrow('is not attached to a project')

    app.conversation.attach(agent.session.id, attached.projectId)
    expect(() => app.conversation.declareEnvironment(
      agent.session.id,
      app.confirmationRequest(other, 'cmd-declare-mismatch'),
    )).toThrow(`is attached to project '${attached.projectId}' and cannot declare an environment for "${other.projectId}"`)

    // The refusal left the attachment standing, so the same session can still
    // confirm the environment it is actually attached to.
    const declared = app.conversation.declareEnvironment(
      agent.session.id,
      app.confirmationRequest(attached, 'cmd-declare-after-mismatch'),
    )
    expect(declared.projectRevision).toBe(attached.revision)
  })
})
