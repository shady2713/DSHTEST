/** Test-only observations of actual model persistence bindings; never reads credential values or session history. */
import { access, writeFile } from 'node:fs/promises'
export const name = 'web-test-model-binding-diagnostics'
export const inject = ['webTestModels', 'webTestPresentation']

/** @param ctx - actual Host services. @param config - unique safe diagnostic output path. */
export function apply(ctx, config) {
  ctx.effect(() => {
    const pending = (async () => {
      try { await access(config.responsePath); return }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      const authority = ctx.webTestModels
      const result = {
        services: Object.fromEntries(['settings', 'credentials', 'llm'].map(key => [key, ctx.get(key) !== undefined])),
        selectionsPresent: authority.selections !== undefined,
        referencesPresent: authority.references !== undefined,
        routeState: { status: 'not-read' },
      }
      if (config.settingsOnly === true) {
        const messages = new Map([
          ['web-test/models: required official settings entry is absent', 'settings-entry-absent'],
          ['web-test/models: invalid settings records', 'invalid-settings-records'],
          ['web-test/models: invalid provider credential reference', 'invalid-provider-reference'],
          ['web-test/models: no provider configuration for credential reference', 'provider-entry-absent'],
          ['web-test/models: no durable selection store is mounted', 'selection-store-absent'],
        ])
        const closed = error => error instanceof Error ? messages.get(error.message) ?? 'unknown-safe' : 'unknown-safe'
        const entries = [...ctx.loader.entries()].filter(entry => entry.options.id === 'web-test-models')
        const namespace = entries.length === 1 ? entries[0].options.id : undefined
        result.consumerNamespace = authority.ctx.fiber.entry?.options.id ?? null
        result.modelEntryCount = entries.length
        result.owningNamespace = namespace ?? null
        let storedAnalysis = false
        try {
          const read = await authority.selections.read()
          storedAnalysis = read.byTask.analysis !== undefined
          result.storeRead = { status: 'ok', allowedTaskKeys: ['analysis', 'vision', 'auxiliary'].filter(key => Object.hasOwn(read.byTask, key)) }
        } catch (error) { result.storeRead = { status: 'failed', code: closed(error) } }
        try { result.accountReference = { status: 'ok', refPresent: authority.references.forProvider('deepseek-account') !== null } }
        catch (error) { result.accountReference = { status: 'failed', code: closed(error) } }
        try {
          const row = ctx.get('settings').describe({ redactSecrets: true }).find(entry => entry.ns === namespace)
          const selections = row?.value?.selections
          const dictionary = selections !== null && typeof selections === 'object' && !Array.isArray(selections)
          result.settingsDescriptor = { namespacePresent: row !== undefined, selectionsDictionary: dictionary,
            allowedTaskKeys: dictionary ? ['analysis', 'vision', 'auxiliary'].filter(key => Object.hasOwn(selections, key)) : [] }
        } catch (error) { result.settingsDescriptor = { status: 'failed', code: closed(error) } }
        if (storedAnalysis) {
          try {
            const route = await authority.selectRoute('analysis', { reverify: false })
            result.selection = { kind: route.kind, ...(route.kind === 'not-ready' ? { reason: route.reason } : {}) }
          } catch (error) { result.selection = { status: 'failed', code: closed(error) } }
        } else result.selection = { status: 'skipped', code: 'no-stored-analysis' }
      } else try {
        const states = await ctx.webTestPresentation.routeState()
        result.routeState = { status: 'ready', entries: states.entries.map(entry => ({
          taskType: entry.taskType, state: entry.state, provider: entry.provider, model: entry.model,
        })) }
      } catch (_error) {
        result.routeState = { status: 'service-failed',
          code: result.selectionsPresent ? 'route-state-failed' : 'selection-store-missing' }
      }
      await writeFile(config.responsePath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    })().catch(() => { ctx.logger.warn('model binding diagnostics could not publish its result') })
    return async () => { await pending }
  }, 'model-binding-diagnostics.observe')
}
