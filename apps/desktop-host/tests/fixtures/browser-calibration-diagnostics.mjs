/** Test-only secret-free observations of the actual model catalogue and calibration dependencies. */
import { writeFile } from 'node:fs/promises'

export const name = 'web-test-calibration-diagnostics'
export const inject = ['webTestModels', 'webTestPresentation']

/**
 * Query shipped configuration services and publish only directory IDs, counts and failure codes.
 * @param ctx - actual Host context.
 * @param config - operator-owned diagnostic output path.
 */
export function apply(ctx, config) {
  if (config.probe !== undefined && (config.probe.provider !== 'deepseek-account'
    || config.probe.model !== 'deepseek-flash' || config.probe.taskType !== 'analysis')) {
    throw new Error('calibration diagnostics: only the explicit account calibration route may be probed')
  }
  ctx.effect(() => {
    const pending = (async () => {
      const services = Object.fromEntries(['webTestRuntime', 'webTestCommands', 'webTestPolicy', 'webTestModels', 'webTestPresentation',
        'sessionController', 'workspaceRegistry', 'desktopBrowserControl'].map(key => [key, ctx.get(key) !== undefined]))
      const result = { services, configuration: 'unavailable', providers: [] }
      const presentation = ctx.get('webTestPresentation')
      if (presentation !== undefined) {
        try { await presentation.configuration(); result.configuration = 'ready' }
        catch (error) { result.configuration = typeof error.code === 'string' ? error.code : 'configuration-failed' }
      }
      const authority = ctx.get('webTestModels')
      if (authority !== undefined) {
        for (const entry of authority.listProviders()) {
          try { const models = await authority.listModels(entry.provider); result.providers.push({ provider: entry.provider, status: 'ready', models: models.map(model => model.id), count: models.length }) }
          catch (error) { result.providers.push({ provider: entry.provider, status: 'failed', code: typeof error.code === 'string' ? error.code : 'catalogue-failed' }) }
        }
        if (config.probe !== undefined) {
          const route = { provider: config.probe.provider, model: config.probe.model,
            credentialRef: authority.references?.forProvider(config.probe.provider) ?? null }
          try {
            const report = await authority.testConnection(route, config.probe.taskType)
            const kinds = ['ready', 'rejected-credential', 'rejected-model', 'rejected-modality', 'rejected-request', 'transient', 'exhausted']
            const codes = ['INVALID_MODEL_INFO', 'CREDENTIAL_CHANGED', 'MISSING_CREDENTIAL', 'INVALID_REQUEST', 'MODEL_NOT_FOUND']
            result.probe = { provider: config.probe.provider, model: config.probe.model, taskType: config.probe.taskType,
              verdict: kinds.includes(report.verdict.kind) ? report.verdict.kind : 'unrecognized-verdict',
              code: codes.includes(report.verdict.failure?.code) ? report.verdict.failure.code : null,
              httpStatus: Number.isInteger(report.verdict.failure?.status) ? report.verdict.failure.status : null }
          } catch (_error) { result.probe = { verdict: 'service-failed' } }
          try {
            const states = await presentation.routeState()
            result.routeState = { status: 'ready', entries: states.entries.map(entry => ({
              taskType: entry.taskType, state: entry.state, provider: entry.provider, model: entry.model,
            })) }
          } catch (_error) { result.routeState = { status: 'service-failed' } }
        }
      }
      await writeFile(config.responsePath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    })().catch(() => { ctx.logger.warn('calibration diagnostics could not publish its result') })
    return async () => { await pending }
  }, 'calibration-diagnostics.observe')
}
