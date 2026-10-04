/**
 * The policy service's own failure codes.
 *
 * Every rejection this package raises names one of these, so a caller
 * discriminates on `code` instead of matching a message. A *refusal* of an
 * effect is not a failure: it is a `PolicyDecision` from the contract package,
 * which is what the model-facing tool denial and the service backstop both
 * surface. These codes cover the states a caller cannot express as a decision —
 * a declaration the product cannot stand behind, a project whose published scope
 * it cannot see, and a confirmation answer that arrived too late or against
 * different context.
 *
 * @module @deepseek-ai/dsh-web-test-policy/errors
 */

/** Failure codes this policy service raises. */
export type WebTestPolicyErrorCode =
  /** An entry path reached an effect the policy refused; the decision is in the message. */
  | 'web-test-policy/denied'
  /** A declared code root or protected path could not be canonically resolved. */
  | 'web-test-policy/unresolved-path'
  /** A protected path is a link, or a component of it is one. */
  | 'web-test-policy/link-path'
  /** A protected path lies inside the tested code root, so the two roles collide. */
  | 'web-test-policy/protected-path-inside-code-root'
  /** A declaration names a code root other than the one the project published. */
  | 'web-test-policy/code-root-mismatch'
  /** The project the call names has no environment declaration yet. */
  | 'web-test-policy/no-declaration'
  /** The project the call names has no published scope in the single domain writer. */
  | 'web-test-policy/project-unpublished'
  /** The caller named a confirmation question that is not open. */
  | 'web-test-policy/unknown-question'
  /** The caller asked for more granted actions than the deployment allows. */
  | 'web-test-policy/grant-exceeds-limit'

/** A failure this policy service raises, carrying the code a caller discriminates on. */
export class WebTestPolicyError extends Error {
  /**
   * @param code - closed failure code.
   * @param message - the concrete condition, naming the resource involved.
   */
  constructor(readonly code: WebTestPolicyErrorCode, message: string) {
    super(message)
    this.name = 'WebTestPolicyError'
  }
}
