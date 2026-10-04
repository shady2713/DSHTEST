/**
 * The Runtime's own failure codes.
 *
 * Every rejection this package raises names one of these, so a caller
 * discriminates on `code` instead of matching a message. The codes cover the
 * situations the commit protocol exists to prevent: a second writer on the same
 * control root, a command token reused with different parameters, a write whose
 * expected version no longer holds, and a read of an entity that was never
 * published. Request field validation is NOT here — a malformed request is the
 * contract package's `web-test/*` failure, raised before the Runtime sees it.
 *
 * @module @deepseek-ai/dsh-web-test-runtime/errors
 */

/** Failure codes this Runtime raises. */
export type WebTestRuntimeErrorCode =
  /** Another process already owns the control root's write lock. */
  | 'web-test/control-root-locked'
  /** The control root's write lock could not be created or owned, including on a host with no such primitive. */
  | 'web-test/control-root-lock-unavailable'
  /** A command token was reused with parameters that differ from the ones it registered. */
  | 'web-test/command-token-reuse'
  /** The caller's expected version no longer matches the committed version. */
  | 'web-test/stale-revision'
  /** The submitted record identity does not address the project the change was prepared for. */
  | 'web-test/record-mismatch'
  /** The head publishes an entry the durable records do not support. */
  | 'web-test/record-unpublished'

/** A failure this Runtime raises, carrying the code a caller discriminates on. */
export class WebTestRuntimeError extends Error {
  /**
   * @param code - closed failure code.
   * @param message - the concrete condition, naming the resource involved.
   */
  constructor(readonly code: WebTestRuntimeErrorCode, message: string) {
    super(message)
    this.name = 'WebTestRuntimeError'
  }
}
