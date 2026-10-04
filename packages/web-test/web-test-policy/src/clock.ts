/**
 * The clock the policy reads validity and expiry against.
 *
 * Expiry is a security fact — an authorization must stop applying at a known
 * instant — so the instant comes from an injected seam rather than a call to
 * `Date.now()` buried in a decision. A test advances it explicitly, which is
 * what makes a late answer a test case rather than a sleep.
 *
 * @module @deepseek-ai/dsh-web-test-policy/clock
 */

import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTestClock: WebTestClock
  }
}

/** The instant one policy decision reads. */
export abstract class WebTestClock extends Service {
  /**
   * The current instant.
   * @returns epoch milliseconds.
   */
  abstract now(): number
}

/** The host clock, which is what a production composition mounts. */
export class SystemClock extends WebTestClock {
  constructor(ctx: Context) {
    super(ctx, 'webTestClock')
  }

  /** @returns the host's current epoch milliseconds. */
  now(): number {
    return Date.now()
  }
}
