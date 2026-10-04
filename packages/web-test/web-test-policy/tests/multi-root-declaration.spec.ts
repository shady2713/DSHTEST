/**
 * One environment declaration covering several code roots, and what the
 * validity determination does with the login and the requirements the user
 * added on top of the trees.
 *
 * The cases here run against the real temporary tree the harness builds, because
 * the declaration resolves every root it is given and compares it with what the
 * project published — the comparison only means something against paths that
 * exist.
 */

import { describe, expect, it } from 'vitest'
import { WebTestPolicyError } from '../src/errors.ts'
import { declarationRequest, flowId, flowRevision, projectId, publishedScope, sessionId, startPolicy } from './harness.ts'

/**
 * Run one declaration and report the policy failure it raised, if any.
 * @param declare - the declaration call under test.
 * @returns the failure's code, or `null` when the declaration was accepted.
 */
function failureCode(declare: () => unknown): string | null {
  try {
    declare()
  } catch (error: unknown) {
    return error instanceof WebTestPolicyError ? error.code : null
  }
  return null
}

describe('a declaration covering several code roots', () => {
  it('declares an environment over every root the project published', async () => {
    const harness = await startPolicy()
    harness.published.current = publishedScope(1, [harness.codeRoot, harness.secondCodeRoot])

    const declared = harness.policy.declareEnvironment(declarationRequest([harness.codeRoot, harness.secondCodeRoot]))

    expect(declared.codeRoots).toEqual([harness.codeRoot, harness.secondCodeRoot])
    await harness.stop()
  })

  it('refuses a declaration whose roots are not the published set', async () => {
    const harness = await startPolicy()
    harness.published.current = publishedScope(1, [harness.codeRoot, harness.secondCodeRoot])

    // Naming only the first root leaves the second declared but unconfirmed, so
    // it is refused rather than silently dropped from the confirmed scope.
    expect(failureCode(() => harness.policy.declareEnvironment(declarationRequest([harness.codeRoot]))))
      .toBe('web-test-policy/code-root-mismatch')
    await harness.stop()
  })

  it('refuses a declaration naming a root the project never published', async () => {
    const harness = await startPolicy()
    harness.published.current = publishedScope(1, [harness.codeRoot])
    const stranger = await startPolicy()

    expect(failureCode(() => harness.policy.declareEnvironment(
      declarationRequest([harness.codeRoot, stranger.root]),
    ))).toBe('web-test-policy/code-root-mismatch')
    await harness.stop()
    await stranger.stop()
  })

  it('refuses a protected directory lying inside the second declared root', async () => {
    const harness = await startPolicy({ protectedInsideCodeRoot: true })
    harness.published.current = publishedScope(1, [harness.codeRoot, harness.secondCodeRoot])

    // The protected directory is under the first tree, so naming the first root
    // in the declaration is what puts the two roles in conflict.
    expect(failureCode(() => harness.policy.declareEnvironment(
      declarationRequest([harness.codeRoot, harness.secondCodeRoot]),
    ))).toBe('web-test-policy/protected-path-inside-code-root')
    await harness.stop()
  })

  it('admits a read beneath the second declared root and refuses one outside both', async () => {
    const harness = await startPolicy()
    harness.published.current = publishedScope(1, [harness.codeRoot, harness.secondCodeRoot])
    // The grant is taken out by hand rather than through `admit`, because
    // `admit` declares the single tree the default harness publishes and this
    // case publishes two. The effect is decided through the policy rather than
    // through a tool, so what is under test is the containment rule itself and
    // not the harness filesystem's working directory.
    harness.policy.bindEntry(sessionId, projectId)
    harness.policy.declareEnvironment(declarationRequest([harness.codeRoot, harness.secondCodeRoot]))
    harness.policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 20 })

    const read = (path: string) => harness.policy.evaluate({
      sessionId,
      effect: { kind: 'read-source', path },
      entry: 'read-source',
    })

    expect(read(harness.secondSourceFile)).toEqual({
      allowed: true,
      reason: 'allowed-in-scope',
      subject: harness.secondSourceFile,
    })
    expect(read(harness.outsideFile)).toEqual({
      allowed: false,
      reason: 'denied-outside-scope',
      subject: harness.outsideFile,
    })
    await harness.stop()
  })
})

describe('what the declaration identity is made of', () => {
  /** Declare the same two roots twice, varying one fact between the calls. */
  async function identityOf(overrides: Record<string, unknown>): Promise<string> {
    const harness = await startPolicy()
    harness.published.current = publishedScope(1, [harness.codeRoot, harness.secondCodeRoot])
    const declared = harness.policy.declareEnvironment(
      declarationRequest([harness.codeRoot, harness.secondCodeRoot], overrides),
    )
    await harness.stop()
    return declared.declarationId
  }

  it('does not change when only the order the roots were declared in changes', async () => {
    const harness = await startPolicy()
    harness.published.current = publishedScope(1, [harness.codeRoot, harness.secondCodeRoot])
    const first = harness.policy.declareEnvironment(declarationRequest([harness.codeRoot, harness.secondCodeRoot]))
    const reordered = harness.policy.declareEnvironment(declarationRequest([harness.secondCodeRoot, harness.codeRoot]))
    await harness.stop()

    // The same trees in a different order are the same environment, so a grant
    // made against the first declaration still stands.
    expect(reordered.declarationId).toBe(first.declarationId)
  })

  it('changes when the login the user stated changes', async () => {
    const plain = await identityOf({ login: { state: 'not-required' } })
    const required = await identityOf({ login: { state: 'required', accountLabel: 'qa@example.test' } })

    expect(required).not.toBe(plain)
  })

  it('changes when a supplementary requirement is added', async () => {
    const none = await identityOf({ supplementaryRequirements: [] })
    const one = await identityOf({ supplementaryRequirements: ['never touch the payment sandbox'] })

    expect(one).not.toBe(none)
  })

  it('records the login and the requirements the user confirmed', async () => {
    const harness = await startPolicy()
    harness.published.current = publishedScope(1, [harness.codeRoot, harness.secondCodeRoot])
    const declared = harness.policy.declareEnvironment(declarationRequest(
      [harness.codeRoot, harness.secondCodeRoot],
      {
        login: { state: 'required', accountLabel: 'qa@example.test' },
        supplementaryRequirements: ['never touch the payment sandbox'],
      },
    ))
    await harness.stop()

    expect(declared.login).toEqual({ state: 'required', accountLabel: 'qa@example.test' })
    expect(declared.supplementaryRequirements).toEqual(['never touch the payment sandbox'])
  })
})
