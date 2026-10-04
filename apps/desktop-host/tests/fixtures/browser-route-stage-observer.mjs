/** Test-only steps for one actual account route save, without recording configuration or credentials. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { writeFile } from 'node:fs/promises'

export const name = 'web-test-route-stage-observer'
export const inject = ['webTestPresentation', 'webTestModels']

/** @param ctx - actual Host service context. @param config - unique safe evidence path. */
export function apply(ctx, config) {
  ctx.effect(() => {
    const settings = ctx.get('settings')
    const editor = ctx.get('configEditor')
    void writeFile(config.responsePath + '.installation', JSON.stringify({ settingsPresent: settings !== undefined, editorPresent: editor !== undefined, storePresent: ctx.webTestModels.selections !== undefined }) + '\n', { flag: 'wx', mode: 0o600 }).catch(() => {
      ctx.logger.warn('route stage observer could not publish its installation state')
    })
    const scope = new AsyncLocalStorage()
    const restorers = []
    const pending = new Set()
    let observed = false
    const fixedMessages = new Map([
      ['Configuration entry is no longer available', 'entry-gone'],
      ['Configuration entry changed during reload', 'reloaded'],
      ['Configuration plugin is no longer active', 'inactive'],
      ['cannot create effect on inactive context', 'inactive'],
      ['cannot get required service "configEditor" in inactive context', 'inactive'],
      ['Profile patch must be a YAML sequence', 'patch-not-sequence'],
      ['No configurable plugin entry "web-test-models"', 'not-configurable'],
      ['Plugin entry "web-test-models" is no longer configurable', 'not-configurable'],
      ['Plugin entry "web-test-models" has no volatile fields', 'not-volatile'],
      ['Config field "selections" is not volatile', 'not-volatile'],
      ['Config field "selections.analysis" is not volatile', 'not-volatile'],
    ])
    const errno = new Set(['EACCES', 'EPERM', 'EBUSY', 'EROFS', 'ENOSPC', 'ENOENT', 'EEXIST'])
    const closed = error => {
      if (error === null || typeof error !== 'object') return 'unknown-safe'
      if (error.name === 'SettingsConflictError') return 'SettingsConflictError'
      if (error.name === 'DataCloneError') return 'DataCloneError'
      if (errno.has(error.code)) return error.code
      return fixedMessages.get(error.message) ?? 'unknown-safe'
    }
    const mark = (step, error) => {
      const steps = scope.getStore()
      if (steps !== undefined) steps.push(error === undefined ? { step } : { step, code: closed(error) })
    }
    const wrap = (service, method, create) => {
      let owner = service
      while (owner !== null && !Object.hasOwn(owner, method)) owner = Object.getPrototypeOf(owner)
      const descriptor = owner === null ? undefined : Object.getOwnPropertyDescriptor(owner, method)
      if (typeof descriptor?.value !== 'function') throw new Error('route stage observer: official method unavailable')
      const wrapper = create(descriptor.value)
      Object.defineProperty(owner, method, { ...descriptor, value: wrapper })
      restorers.push(() => {
        if (Object.getOwnPropertyDescriptor(owner, method)?.value === wrapper) Object.defineProperty(owner, method, descriptor)
      })
    }
    const asynchronous = (original, prefix, matches) => async function(...args) {
      if (scope.getStore() === undefined || !matches(args)) return await Reflect.apply(original, this, args)
      mark(prefix + '-entered')
      try {
        const result = await Reflect.apply(original, this, args)
        mark(prefix + '-completed')
        return result
      } catch (error) {
        mark(prefix + '-error', error)
        throw error
      }
    }
    const publish = async result => {
      try { await writeFile(config.responsePath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 }) }
      catch (_writeError) { ctx.logger.warn('route stage observer could not publish its safe result') }
    }
    let ready
    try {
      wrap(ctx.webTestModels.selections, 'put', original => asynchronous(original, 'put', ([selection]) =>
        selection.taskType === 'analysis' && selection.route.provider === 'deepseek-account' && selection.route.model === 'deepseek-flash'))
      wrap(settings, 'mutate', original => asynchronous(original, 'settings-mutate', ([namespace]) => namespace === 'web-test-models'))
      wrap(editor, 'edit', original => async function(entry, change) {
        const steps = scope.getStore()
        if (steps === undefined || entry.options.id !== 'web-test-models') return await Reflect.apply(original, this, [entry, change])
        mark('editor-edit-entered')
        const observedChange = function(...args) {
          return scope.run(steps, () => {
            mark('editor-change-entered')
            try {
              const result = Reflect.apply(change, this, args)
              mark('editor-change-completed')
              return result
            } catch (error) {
              mark('editor-change-error', error)
              throw error
            }
          })
        }
        try {
          const result = await Reflect.apply(original, this, [entry, observedChange])
          mark('editor-edit-completed')
          return result
        } catch (error) {
          mark('editor-edit-error', error)
          throw error
        }
      })
      wrap(ctx.webTestPresentation, 'configureRoute', original => async function(provider, model, taskType) {
        if (observed || provider !== 'deepseek-account' || model !== 'deepseek-flash' || taskType !== 'analysis') {
          return await Reflect.apply(original, this, [provider, model, taskType])
        }
        observed = true
        const steps = []
        const operation = scope.run(steps, async () => {
          try {
            const outcome = await Reflect.apply(original, this, [provider, model, taskType])
            await publish({ status: 'returned', ready: outcome.ready, steps })
            return outcome
          } catch (error) {
            await publish({ status: 'threw', code: closed(error), steps })
            throw error
          }
        })
        pending.add(operation)
        try { return await operation }
        finally { pending.delete(operation) }
      })
      ready = writeFile(config.responsePath + '.ready', JSON.stringify({ status: 'observing-official-stages' }) + '\n', { flag: 'wx', mode: 0o600 })
    } catch (error) {
      for (const restore of restorers.reverse()) restore()
      throw error
    }
    return async () => {
      for (const restore of restorers.reverse()) restore()
      await ready
      await Promise.allSettled(pending)
    }
  }, 'route-stage-observer.watch')
}
