/** Thin adapter over official settings and write-only credential Remotes. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-web-test-presentation/remote'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ModelConfigurationOperations } from './ModelConfiguration.tsx'

/** Read one ordinary JSON property. */
function member(value: JsonValue | undefined, key: string): JsonValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value[key] : undefined
}

/**
 * Bind conversation configuration to the published Remotes.
 * @param ctx - Client plugin context declaring the three required namespaces.
 * @returns operations which never render or log a secret or untrusted error text.
 */
export function createModelConfigurationOperations(ctx: Context): ModelConfigurationOperations {
  return {
    async load() {
      const response = await ctx.remote.webTestPresentation.configuration()
      if (!response.ok) throw new Error('model configuration unavailable')
      return response.value.providers
    },
    async save(provider, model, taskType, key) {
      const described = await ctx.remote.settings.describe()
      if (!described.ok) return false
      const namespace = described.value.namespaces.find(row => row.ns === provider.settingsNs)
      if (namespace === undefined) return false
      const profile = provider.settingsPath.reduce<JsonValue | undefined>((value, part) => member(value, part), namespace.value)
      const catalog = member(profile, 'models')
      const models = Array.isArray(catalog) ? [...catalog] : []
      if (!models.some(row => member(row, 'id') === model)) models.push({ id: model, inputModalities: taskType === 'vision' ? ['text', 'image'] : ['text'] })
      const written = await ctx.remote.settings.mutate(provider.settingsNs, [
        { op: 'set', path: [...provider.settingsPath, 'models'], value: models },
      ], namespace.revision)
      if (!written.ok) return false
      if (key !== '') {
        if (provider.credentialRef === null) return false
        const stored = await ctx.remote.credentials.set(provider.credentialRef, key)
        if (!stored.ok) return false
      }
      const tested = await ctx.remote.webTestPresentation.configureRoute(provider.provider, model, taskType)
      return tested.ok && tested.value.ready
    },
    async remove(ref) {
      const removed = await ctx.remote.credentials.unset(ref)
      return removed.ok
    },
  }
}
