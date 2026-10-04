import type { Context } from '@deepseek-ai/cordis'

export const name: 'web-test-calibration-tools'
export const inject: readonly ['agents', 'tools']
export function apply(ctx: Context, config: {
  readonly sessionId: string
  readonly origin: string
  readonly requestPath: string
  readonly responsePath: string
}): void
