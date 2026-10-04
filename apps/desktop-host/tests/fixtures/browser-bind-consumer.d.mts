import type { Context } from '@deepseek-ai/cordis'

export const name: 'web-test-calibration-binding'
export const inject: readonly ['sessions', 'sessionController']
export function apply(ctx: Context, config: {
  readonly requestPath: string
  readonly responsePath: string
  readonly origin: string
}): void
