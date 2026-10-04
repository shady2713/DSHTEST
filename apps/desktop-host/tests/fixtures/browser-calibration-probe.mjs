/** Test-only startup phase observations without credential or session-log access. */
import { writeFile } from 'node:fs/promises'
import { prepare } from './browser-calibration-setup.mjs'
export const name = 'web-test-calibration-probe'
export const inject = ['agents', 'sessionController', 'workspaceRegistry', 'webTestRuntime', 'webTestPolicy', 'webTestCommands']

/** @param ctx - actual Host context. @param config - explicit setup and evidence paths. */
export function apply(ctx, config) {
  ctx.effect(() => {
    const pending = (async () => {
      const entries = [...ctx.loader.entries()].filter(entry => entry.options.id.startsWith('web-test-calibration'))
        .map(entry => ({ id: entry.options.id, state: entry.fiber?.state, inject: entry.options.inject ?? null }))
      await writeFile(config.responsePath + '.entries', JSON.stringify(entries, null, 2) + '\n')
      const result = await prepare(ctx, config, phase => writeFile(config.responsePath + '.phase', JSON.stringify({ phase }) + '\n'))
      await writeFile(config.responsePath, JSON.stringify(result, null, 2) + '\n')
    })().catch(async error => { await writeFile(config.responsePath + '.failed', JSON.stringify({ code: error.code ?? 'setup-failed', reason: error.message }) + '\n') })
    return async () => { await pending }
  }, 'calibration-probe.prepare')
}
