import type { Context } from '@deepseek-ai/cordis'
export const name: 'web-test-calibration-setup'
export const inject: readonly ['sessionController', 'workspaceRegistry', 'webTestRuntime', 'webTestCommands', 'webTestPolicy', 'agents']
export interface Config {
  readonly sessionId: string
  readonly cwd: string
  readonly sourceRoot: string
  readonly responsePath: string
  readonly entryUrls: readonly string[]
  readonly commandId: string
  readonly actions: number
}
export function prepare(ctx: Context, config: Config, report?: (phase: string) => Promise<void>): Promise<Record<string, unknown>>
export function apply(ctx: Context, config: Config): void
