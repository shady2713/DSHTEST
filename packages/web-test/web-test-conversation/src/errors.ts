/**
 * The one failure this package raises, named by a closed code.
 *
 * Every refusal below is about a fact this entry owns — which mode a question
 * tool was registered in, which project a conversation is attached to, and
 * whether a request is a command of the closed set at all. A decision the web
 * testing policy owns is raised by that service instead, under its own
 * `web-test-policy/*` codes, and a request that is a command but that this stage
 * does not perform is answered as an outcome rather than raised, so a caller
 * tells a misconfigured composition apart from a refused effect and from an
 * unavailable command.
 *
 * @module @deepseek-ai/dsh-web-test-conversation/errors
 */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/** Closed set of the failures this package raises itself. */
export type WebTestConversationErrorCode =
  /** The command plugin has unloaded. */
  | 'web-test-conversation/disposed'
  /** Project input named no live root conversation. */
  | 'web-test-conversation/unknown-session'
  /** The Session or published project moved while an input was being saved. */
  | 'web-test-conversation/context-changed'
  /** A wait was declared for the blocking question tool, which reads none. */
  | 'web-test-conversation/ask-user-legacy-timeout'
  /** `mode: timed` was declared without the wait it holds the foreground for. */
  | 'web-test-conversation/ask-user-timed-timeout'
  /** The declared wait is not a whole number of seconds in the accepted range. */
  | 'web-test-conversation/ask-user-timeout-range'
  /** `timeout: -1` was paired with `mode: timed`, which still blocks. */
  | 'web-test-conversation/ask-user-indefinite'
  /** The named project has no published entry, so there is nothing to attach to. */
  | 'web-test-conversation/unpublished-project'
  /** The session is not attached to a project, so it has no environment to declare. */
  | 'web-test-conversation/unassociated-session'
  /** The request named a project other than the one the session is attached to. */
  | 'web-test-conversation/project-mismatch'
  /** The request is not a web testing command: no Session, or a verb outside the closed set. */
  | 'web-test-conversation/unknown-command'
  /** A status question was asked of the action surface, or an action of the status surface. */
  | 'web-test-conversation/verb-mismatch'
  /** A status question named no subject, or one outside the closed set. */
  | 'web-test-conversation/incomplete-query'
  /** The session is attached to no project, so it reaches none. */
  | 'web-test-conversation/no-project'

/** Every conversation refusal carries no private project details over the Remote. */
type ConversationErrorDetails = Record<WebTestConversationErrorCode, Record<string, never>>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap extends ConversationErrorDetails {}
}

/** A conversation refusal whose closed identity survives the shared Remote carrier. */
export class WebTestConversationError extends RemoteError<WebTestConversationErrorCode> {

  /**
   * @param code - closed code identifying which fact this refusal is about.
   * @param message - what the caller must change, naming the value it rejected.
   */
  constructor(code: WebTestConversationErrorCode, message: string) {
    super(code, message, {})
    this.name = 'WebTestConversationError'
  }
}
