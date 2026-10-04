/** Test-only observation of one official account configureRoute call; delegates its request, result and failure unchanged. */
import { writeFile } from 'node:fs/promises'
export const name = 'web-test-route-configuration-observer'
export const inject = ['webTestPresentation', 'webTestModels']

/** @param ctx - actual Host service context. @param config - unique safe observation output path. */
export function apply(ctx, config) {
  ctx.effect(() => {
    const service = ctx.webTestPresentation
    let owner = Object.getPrototypeOf(service)
    while (owner !== null && !Object.hasOwn(owner, 'configureRoute')) owner = Object.getPrototypeOf(owner)
    const descriptor = owner === null ? undefined : Object.getOwnPropertyDescriptor(owner, 'configureRoute')
    if (typeof descriptor?.value !== 'function') throw new Error('route observer: official method is unavailable')
    const original = descriptor.value
    const pending = new Set()
    let observed = false
    const messages = new Map([
      ['web-test/models: required official settings entry is absent', 'settings-entry-absent'],
      ['web-test/models: invalid settings records', 'invalid-settings-records'],
      ['web-test/models: invalid provider credential reference', 'invalid-provider-reference'],
      ['web-test/models: no provider configuration for credential reference', 'provider-entry-absent'],
      ['web-test/models: no durable selection store is mounted', 'selection-store-absent'],
    ])
    const closed = error => error instanceof Error
      ? error.name === 'SettingsConflictError' ? 'settings-conflict' : messages.get(error.message) ?? 'unknown-safe'
      : 'unknown-safe'
    const publish = async result => {
      try { await writeFile(config.responsePath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 }) }
      catch (_writeError) { ctx.logger.warn('route observer could not publish its safe result') }
    }
    const wrapper = async function(provider, model, taskType) {
      if (observed || provider !== 'deepseek-account' || model !== 'deepseek-flash' || taskType !== 'analysis') {
        return await Reflect.apply(original, this, [provider, model, taskType])
      }
      observed = true
      const operation = (async () => {
        let result
        try {
          const outcome = await Reflect.apply(original, this, [provider, model, taskType])
          result = { status: 'returned', ready: outcome.ready, detail: outcome.detail === null ? null : 'closed-not-ready' }
          try {
            const read = await ctx.webTestModels.selections.read()
            result.storedAnalysis = read.byTask.analysis !== undefined
          } catch (error) { result.storeReadCode = closed(error) }
          await publish(result)
          return outcome
        } catch (error) {
          result = { status: 'threw', code: closed(error) }
          await publish(result)
          throw error
        }
      })()
      pending.add(operation)
      try { return await operation }
      finally { pending.delete(operation) }
    }
    Object.defineProperty(owner, 'configureRoute', { ...descriptor, value: wrapper })
    const ready = writeFile(config.responsePath + '.ready', JSON.stringify({ status: 'observing-official-method' }) + '\n', { flag: 'wx', mode: 0o600 })
    return async () => {
      Object.defineProperty(owner, 'configureRoute', descriptor)
      await ready
      await Promise.allSettled(pending)
    }
  }, 'route-configuration-observer.watch')
}
