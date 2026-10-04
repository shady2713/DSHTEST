/**
 * Required business confirmation against waiting on a user question: what
 * grants, what grants nothing, and what a late or out-of-context answer is worth.
 *
 * The observations are written to
 * `.artifacts/web-testing/upgrade-v02/m1-t05-a/confirmation-ledger.md`.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { brandNumber } from '@deepseek-ai/dsh-brand'
import type { Revision } from '@deepseek-ai/dsh-web-test-contracts'
import type { ConfirmationAnswer, ConfirmationTicket } from '../src/index.ts'
import { EPOCH, flowId, flowRevision, sessionId, startPolicy, type PolicyHarness } from './harness.ts'

/** One observed confirmation event, as the evidence file records it. */
interface Observed {
  /** What the suite did. */
  readonly step: string
  /** The question state the ledger reported. */
  readonly state: string
  /** Whether the caller must ask a new question. */
  readonly reclarify: boolean
  /** The closed reason a dependent action then earned, or `allowed`. */
  readonly effect: string
}

let harness: PolicyHarness | undefined
const observed: Observed[] = []

/** The booted harness; each case boots and disposes its own. */
function policy(): PolicyHarness {
  if (harness === undefined) throw new Error('the policy harness is not booted')
  return harness
}

/** The action a suite confirms, as the ledger fingerprints it. */
function dependentRead(at: PolicyHarness): { readonly sessionId: string; readonly effect: { readonly kind: 'read-source'; readonly path: string }; readonly entry: string; readonly flowId: string; readonly flowRevision: number } {
  return {
    sessionId,
    effect: { kind: 'read-source', path: at.sourceFile },
    entry: 'read',
    flowId,
    flowRevision,
  }
}

/**
 * Build the answer a user interface would submit for an open question.
 * @param ticket - the ticket the question was asked with.
 * @param confirmed - whether the human confirmed.
 * @returns the answer record.
 */
function answerFor(ticket: ConfirmationTicket, confirmed: boolean): ConfirmationAnswer {
  return {
    questionId: ticket.questionId,
    actionFingerprint: ticket.actionFingerprint,
    projectRevision: ticket.projectRevision,
    flowRevision: ticket.flowRevision,
    declarationId: ticket.declarationId,
    confirmed,
  }
}

/**
 * Record what the ledger reported and what the dependent action then earned.
 * @param step - what the suite did.
 * @param state - the question state the ledger reported.
 * @param reclarify - whether a new question is required.
 */
function record(step: string, state: string, reclarify: boolean): void {
  const decision = policy().policy.evaluate(dependentRead(policy()))
  observed.push({ step, state, reclarify, effect: decision.allowed ? 'allowed' : decision.reason })
}

afterEach(async () => {
  await harness?.stop()
  harness = undefined
})

describe('required business confirmation', () => {
  it('grants nothing while a question is pending, and acts only after an answer in context', async () => {
    harness = await startPolicy({ confirmationRequiredFor: ['read-source'] })
    harness.admit()
    const first = harness.policy.requireConfirmation(dependentRead(policy()))
    expect(first.required).toBe(true)
    if (!first.required) throw new Error('a read under this config requires a confirmation')
    expect(first.state).toBe('pending')
    expect(first.decision.reason).toBe('denied-missing-confirmation')
    record('requireConfirmation (first)', first.state, first.reclarify)

    const again = harness.policy.requireConfirmation(dependentRead(policy()))
    expect(again.required && again.state).toBe('pending')
    expect(again.required && again.ticket.questionId).toBe(first.ticket.questionId)
    record('requireConfirmation (repeated, still pending)', again.required ? again.state : '', again.required ? again.reclarify : false)

    const answered = harness.policy.answerConfirmation(answerFor(first.ticket, true))
    expect(answered).toEqual({ state: 'answered', reclarify: false })
    record('answerConfirmation (in context, confirmed)', answered.state, answered.reclarify)

    const after = harness.policy.requireConfirmation(dependentRead(policy()))
    expect(after.required && after.state).toBe('answered')
    record('requireConfirmation (after the answer)', after.required ? after.state : '', after.required ? after.reclarify : false)
    expect(policy().policy.evaluate(dependentRead(policy())).allowed).toBe(true)

    harness.writeEvidence('confirmation-ledger.md', renderEvidence(harness.root))
  })

  it('refuses an answer that arrives after the window closed, and re-clarifies on the next attempt', async () => {
    harness = await startPolicy({ confirmationRequiredFor: ['read-source'] })
    harness.admit()
    const opened = harness.policy.requireConfirmation(dependentRead(policy()))
    if (!opened.required) throw new Error('a read under this config requires a confirmation')
    harness.clock.now = EPOCH + 60_001
    const late = harness.policy.answerConfirmation(answerFor(opened.ticket, true))
    expect(late).toEqual({ state: 'expired', reclarify: true })
    record('answerConfirmation (one millisecond after the window closed)', late.state, late.reclarify)
    expect(policy().policy.evaluate(dependentRead(policy())).reason).toBe('denied-missing-confirmation')

    const reasked = harness.policy.requireConfirmation(dependentRead(policy()))
    expect(reasked.required && reasked.state).toBe('pending')
    expect(reasked.required && reasked.ticket.questionId).not.toBe(opened.ticket.questionId)
    record('requireConfirmation (after the late answer, re-asked)', reasked.required ? reasked.state : '', reasked.required ? reasked.reclarify : false)
    harness.writeEvidence('confirmation-late-answer.md', renderEvidence(harness.root))
  })

  it('refuses an answer whose context no longer matches, on each of the three facts it re-checks', async () => {
    for (const mismatch of ['action', 'plan revision', 'environment'] as const) {
      const local = await startPolicy({ confirmationRequiredFor: ['read-source'] })
      try {
        local.admit()
        const opened = local.policy.requireConfirmation(dependentRead(local))
        if (!opened.required) throw new Error('a read under this config requires a confirmation')
        const answer = answerFor(opened.ticket, true)
        const wrong: ConfirmationAnswer = {
          ...answer,
          ...mismatch === 'action' ? { actionFingerprint: 'act-0000000000000000000000000000000' } : {},
          ...mismatch === 'plan revision' ? { flowRevision: answer.flowRevision + 1 } : {},
          ...mismatch === 'environment' ? { declarationId: 'decl-0000000000000000000000000000000' } : {},
        }
        const refused = local.policy.answerConfirmation(wrong)
        expect(refused, mismatch).toEqual({ state: 'mismatched', reclarify: true })
        expect(local.policy.evaluate(dependentRead(local)).reason).toBe('denied-missing-confirmation')
        observed.push({
          step: `answerConfirmation (${mismatch} no longer matches)`,
          state: refused.state,
          reclarify: refused.reclarify,
          effect: local.policy.evaluate(dependentRead(local)).reason,
        })
      } finally {
        await local.stop()
      }
    }
    harness = await startPolicy()
    harness.writeEvidence('confirmation-stale-answer.md', renderEvidence())
  })

  it('refuses an answer whose project revision moved under it', async () => {
    const local = await startPolicy({ confirmationRequiredFor: ['read-source'] })
    try {
      local.admit()
      const opened = local.policy.requireConfirmation(dependentRead(local))
      if (!opened.required) throw new Error('a read under this config requires a confirmation')
      local.published.current = {
        ...local.published.current,
        revision: brandNumber<Revision>(2),
      }
      const refused = local.policy.answerConfirmation(answerFor(opened.ticket, true))
      expect(refused).toEqual({ state: 'mismatched', reclarify: true })
      observed.push({
        step: 'answerConfirmation (the published project revision moved under it)',
        state: refused.state,
        reclarify: refused.reclarify,
        effect: local.policy.evaluate(dependentRead(local)).reason,
      })
    } finally {
      await local.stop()
    }
    harness = await startPolicy()
    harness.writeEvidence('confirmation-revision-moved.md', renderEvidence())
  })

  it('grants nothing for a skipped, a cancelled, or a declined confirmation', async () => {
    for (const close of ['skipped', 'cancelled'] as const) {
      const local = await startPolicy({ confirmationRequiredFor: ['read-source'] })
      try {
        local.admit()
        const opened = local.policy.requireConfirmation(dependentRead(local))
        if (!opened.required) throw new Error('a read under this config requires a confirmation')
        const state = local.policy.closeConfirmation(opened.ticket.questionId, close)
        expect(state).toBe(close)
        expect(local.policy.evaluate(dependentRead(local)).reason).toBe('denied-missing-confirmation')
        observed.push({
          step: `closeConfirmation (${close})`,
          state,
          reclarify: local.policy.requireConfirmation(dependentRead(local)).required ? true : false,
          effect: local.policy.evaluate(dependentRead(local)).reason,
        })
      } finally {
        await local.stop()
      }
    }
    const local = await startPolicy({ confirmationRequiredFor: ['read-source'] })
    try {
      local.admit()
      const opened = local.policy.requireConfirmation(dependentRead(local))
      if (!opened.required) throw new Error('a read under this config requires a confirmation')
      const declined = local.policy.answerConfirmation(answerFor(opened.ticket, false))
      expect(declined).toEqual({ state: 'skipped', reclarify: true })
      expect(local.policy.evaluate(dependentRead(local)).reason).toBe('denied-missing-confirmation')
      observed.push({
        step: 'answerConfirmation (the human declined)',
        state: declined.state,
        reclarify: declined.reclarify,
        effect: local.policy.evaluate(dependentRead(local)).reason,
      })
    } finally {
      await local.stop()
    }
    harness = await startPolicy()
    harness.writeEvidence('confirmation-nothing-granted.md', renderEvidence())
  })

  it('refuses an answer to a question it never asked', async () => {
    harness = await startPolicy({ confirmationRequiredFor: ['read-source'] })
    harness.admit()
    expect(() => harness?.policy.answerConfirmation({
      questionId: 'confirm-9999',
      actionFingerprint: 'act-x',
      projectRevision: brandNumber<Revision>(1),
      flowRevision,
      declarationId: 'decl-x',
      confirmed: true,
    })).toThrow(/was never asked by this policy service/u)
  })

  it('leaves independent work unaffected while the dependent work stays blocked', async () => {
    harness = await startPolicy({ confirmationRequiredFor: ['read-source'] })
    harness.admit()
    const independent = { sessionId, effect: { kind: 'list-source' as const, path: harness.codeRoot }, entry: 'glob', flowId, flowRevision }
    const blocked = harness.policy.requireConfirmation(dependentRead(policy()))
    expect(blocked.required).toBe(true)
    if (!blocked.required) throw new Error('a read under this config requires a confirmation')
    expect(harness.policy.evaluate(independent)).toEqual({
      allowed: true, reason: 'allowed-in-scope', subject: harness.codeRoot,
    })
    expect(harness.policy.evaluate(dependentRead(policy())).reason).toBe('denied-missing-confirmation')
    const write = {
      sessionId, effect: { kind: 'write-source' as const, path: harness.sourceFile }, entry: 'write', flowId, flowRevision,
    }
    expect(harness.policy.evaluate(write).reason).toBe('denied-protected-path')
    const shell = {
      sessionId, effect: { kind: 'spawn-process' as const, command: 'rm -rf /' }, entry: 'bash', flowId, flowRevision,
    }
    expect(harness.policy.evaluate(shell).reason).toBe('denied-outside-scope')
    observed.push({
      step: 'while the read is blocked: an independent list, a write, and a shell command',
      state: blocked.state,
      reclarify: blocked.reclarify,
      effect: `${harness.policy.evaluate(independent).reason} / ${harness.policy.evaluate(dependentRead(policy())).reason} / ${harness.policy.evaluate(write).reason} / ${harness.policy.evaluate(shell).reason}`,
    })
    harness.writeEvidence('confirmation-independent-work.md', renderEvidence(harness.root))
  })

  it('never asks a human about an action the product already refuses', async () => {
    harness = await startPolicy({ confirmationRequiredFor: ['read-source', 'write-source'] })
    harness.admit()
    const refusedAction = {
      sessionId,
      effect: { kind: 'write-source' as const, path: harness.sourceFile },
      entry: 'write',
      flowId,
      flowRevision,
    }
    const outcome = harness.policy.requireConfirmation(refusedAction)
    expect(outcome).toEqual({
      required: false,
      decision: { allowed: false, reason: 'denied-protected-path', subject: harness.sourceFile },
    })
  })

  it('asks for no confirmation for an effect the configuration does not name', async () => {
    harness = await startPolicy({ confirmationRequiredFor: [] })
    harness.admit()
    const outcome = harness.policy.requireConfirmation(dependentRead(policy()))
    expect(outcome.required).toBe(false)
    expect(outcome.decision.allowed).toBe(true)
  })

  it('refuses a question asked for an entry path it does not recognise', async () => {
    harness = await startPolicy({ confirmationRequiredFor: ['read-source'] })
    harness.admit()
    const outcome = harness.policy.requireConfirmation({
      sessionId, effect: null, entry: 'deploy_production', flowId, flowRevision,
    })
    expect(outcome).toEqual({
      required: false,
      decision: { allowed: false, reason: 'denied-unknown-target', subject: 'deploy_production' },
    })
  })

  it('asks no human about an action from a session no project can be named for', async () => {
    harness = await startPolicy({ confirmationRequiredFor: ['read-source'] })
    harness.policy.declareEnvironment({
      projectId: harness.published.current.projectId,
      commandId: 'cmd-declare-unbound',
      declaration: {
        codeRoots: [harness.codeRoot],
        entryUrl: 'http://localhost:3000/checkout',
        isTestEnvironment: true,
        login: { state: 'not-required' },
        supplementaryRequirements: [],
      },
    })
    expect(harness.policy.requireConfirmation({
      ...dependentRead(policy()),
      sessionId: 'session-unbound',
    })).toEqual({
      required: false,
      decision: { allowed: false, reason: 'denied-outside-scope', subject: 'session-unbound' },
    })
    // With exactly one declared project, a call that names no session is decided
    // against it, so the question is asked rather than skipped.
    expect(harness.policy.requireConfirmation({ ...dependentRead(policy()), sessionId: null }).required)
      .toBe(true)
  })

  it('answers a question for a project that holds no other grant, and refuses a second answer to it', async () => {
    harness = await startPolicy({ confirmationRequiredFor: ['read-source'] })
    harness.policy.bindEntry(sessionId, harness.published.current.projectId)
    harness.policy.declareEnvironment({
      projectId: harness.published.current.projectId,
      commandId: 'cmd-declare-no-grant',
      declaration: {
        codeRoots: [harness.codeRoot],
        entryUrl: 'http://localhost:3000/checkout',
        isTestEnvironment: true,
        login: { state: 'not-required' },
        supplementaryRequirements: [],
      },
    })
    const opened = harness.policy.requireConfirmation(dependentRead(policy()))
    if (!opened.required) throw new Error('a read under this config requires a confirmation')
    expect(harness.policy.answerConfirmation(answerFor(opened.ticket, true))).toEqual({
      state: 'answered', reclarify: false,
    })
    expect(harness.policy.evaluate(dependentRead(policy())).allowed).toBe(true)
    expect(harness.policy.answerConfirmation(answerFor(opened.ticket, true))).toEqual({
      state: 'answered', reclarify: true,
    })
  })

  it('leaves an effect the confirmation did not name unaffected by the grant it created', async () => {
    harness = await startPolicy({ confirmationRequiredFor: ['read-source'] })
    const project = harness.published.current.projectId
    harness.policy.bindEntry(sessionId, project)
    harness.policy.declareEnvironment({
      projectId: project,
      commandId: 'cmd-declare-ordering',
      declaration: {
        codeRoots: [harness.codeRoot],
        entryUrl: 'http://localhost:3000/checkout',
        isTestEnvironment: true,
        login: { state: 'not-required' },
        supplementaryRequirements: [],
      },
    })
    const opened = harness.policy.requireConfirmation(dependentRead(policy()))
    if (!opened.required) throw new Error('a read under this config requires a confirmation')
    harness.policy.answerConfirmation(answerFor(opened.ticket, true))
    // The intent grant is registered before the flow grant, so a decision that
    // examines both meets the narrower one first.
    harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 20 })
    const independent = {
      sessionId, effect: { kind: 'list-source' as const, path: harness.codeRoot }, entry: 'glob', flowId, flowRevision,
    }
    expect(harness.policy.evaluate(independent)).toEqual({
      allowed: true, reason: 'allowed-in-scope', subject: harness.codeRoot,
    })
  })
})

/**
 * Render the observed events as the Markdown document an evidence file carries.
 * @param root - the temporary tree's root path, when one is still booted.
 * @returns the Markdown document.
 */
function renderEvidence(root = ''): string {
  const shorten = (text: string): string => (root === '' ? text : text.split(root).join('<root>'))
  return [
    '# M1-T05-A business confirmation ledger',
    '',
    'Required business confirmation is separate from waiting on a user question: a pending,',
    'expired, skipped, cancelled, declined, or out-of-context answer grants nothing, and the',
    'dependent action stays blocked while independent work continues.',
    '',
    '| Step | Question state | Re-ask required | Effect the dependent action then earned |',
    '| --- | --- | --- | --- |',
    ...observed.map(row => `| ${row.step} | ${row.state} | ${String(row.reclarify)} | ${shorten(row.effect)} |`),
    '',
  ].join('\n')
}
