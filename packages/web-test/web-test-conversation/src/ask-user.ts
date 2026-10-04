/**
 * The ask-user mode this Web testing conversation registers.
 *
 * `tool-ask-user` selects between two definitions from one row, and the row's
 * default is the blocking one: a configuration that names no mode at all is
 * legacy, and the shipped presets declare the row with no configuration, so a
 * deployment gets the blocking tool whether or not anybody chose it. This module
 * makes that choice a stated one. A `timed` row is accepted only with an
 * explicit whole-second wait, because `timeout: -1` keeps a blocking `ask()` and
 * changes nothing but the card's key — a timed row that blocks indefinitely is
 * the failure this validation exists to refuse, and `mode: legacy` is how a
 * deployment asks for it on purpose.
 *
 * The registration itself reuses the official plugin: this module resolves the
 * mode and hands the row to `tool-ask-user`'s own `apply`, so the schema, the
 * question path, and the timed/legacy dispatch have exactly one home.
 *
 * @module @deepseek-ai/dsh-web-test-conversation/ask-user
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config as AskUserConfig } from '@deepseek-ai/dsh-tool-ask-user'
import { apply as applyAskUser } from '@deepseek-ai/dsh-tool-ask-user'
import { WebTestConversationError } from './errors.ts'

/** Which `ask_user_question` definition the composition selected. */
export type AskUserMode = 'legacy' | 'timed'

/** What the composition stated about the question tool, before resolution. */
export interface AskUserSelection {
  /** Omitted and `'legacy'` both select the blocking tool. */
  mode?: AskUserMode
  /** Foreground wait in whole seconds; required by `'timed'`, refused by `'legacy'`. */
  timeout?: number
}

/** The row handed to `tool-ask-user`: a blocking tool, or a timed one with its wait. */
export type AskUserRegistration =
  /** The blocking tool; it carries no wait. */
  | { readonly mode: 'legacy' }
  /** The timed tool with the whole-second wait it holds the foreground for. */
  | { readonly mode: 'timed'; readonly timeout: number }

/** Longest wait `tool-ask-user` accepts, in seconds. */
const MAX_TIMEOUT_SECONDS = 2_147_483

/**
 * Resolve what the composition stated into the row `tool-ask-user` will be
 * registered with, refusing the three configurations that would leave a
 * deployment holding a question tool other than the one it asked for.
 * @param selection - the mode and wait the composition declared.
 * @returns the registration row; `mode: 'legacy'` when no mode was declared.
 * @throws {WebTestConversationError} `ask-user-legacy-timeout` when a wait was
 * declared for the blocking tool, `ask-user-timed-timeout` when `'timed'` was
 * declared without a wait, `ask-user-indefinite` when the wait is `-1`, and
 * `ask-user-timeout-range` when it is not a whole number of seconds in range.
 */
export function resolveAskUserMode(selection: AskUserSelection): AskUserRegistration {
  const { mode, timeout } = selection
  if (mode !== 'timed') {
    if (timeout !== undefined) {
      throw new WebTestConversationError(
        'web-test-conversation/ask-user-legacy-timeout',
        `the blocking ask_user_question tool reads no wait, so "timeout: ${String(timeout)}" under mode "legacy" would change nothing; declare mode "timed" to hold the foreground for that many seconds, or drop the timeout`,
      )
    }
    return { mode: 'legacy' }
  }
  if (timeout === undefined) {
    throw new WebTestConversationError(
      'web-test-conversation/ask-user-timed-timeout',
      'mode "timed" needs an explicit "timeout" in whole seconds; the mode is a deliberate choice and so is the wait it holds the foreground for',
    )
  }
  if (timeout === -1) {
    throw new WebTestConversationError(
      'web-test-conversation/ask-user-indefinite',
      'mode "timed" with "timeout: -1" keeps a blocking question and only keys the card by call id, so the row would still hold the foreground indefinitely; declare mode "legacy" when the answer is required before proceeding',
    )
  }
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_SECONDS) {
    throw new WebTestConversationError(
      'web-test-conversation/ask-user-timeout-range',
      `"timeout" must be a whole number of seconds from 1 to ${String(MAX_TIMEOUT_SECONDS)}, but ${String(timeout)} was declared`,
    )
  }
  return { mode: 'timed', timeout }
}

/**
 * Register the resolved question tool through the official plugin, so the
 * schema, the question path, and the timed/legacy dispatch stay in one home.
 * @param ctx - context whose tool registry receives the definition.
 * @param registration - the row {@link resolveAskUserMode} produced.
 */
export function registerAskUser(ctx: Context, registration: AskUserRegistration): void {
  applyAskUser(ctx, registration satisfies AskUserConfig)
}
