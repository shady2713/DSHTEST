/** Official settings persistence and provider credential-reference reads. */
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials/types'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm/types'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import type { PolicyStore, ReferenceSource, SelectionStore } from './index.ts'
import { parseStoredSelection } from './index.ts'
import type { RouteSelection } from './types.ts'

/** Read JSON properties without treating a stored value as trusted. */
function member(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

/** Read a detached stored dictionary, rejecting foreign containers. */
function dictionary(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('web-test/models: invalid settings records')
  return { ...value as Record<string, unknown> }
}

/**
 * Bind verified selections and append-only policy revisions to one Loader entry.
 * @param settings - official settings service, owning the profile patch.
 * @param namespace - models Loader entry id.
 * @param providers - live provider directory supplying official settings paths.
 * @returns stores plus a reader of credential reference names only.
 */
export function createSettingsModelStore(
  settings: Pick<SettingsForms, 'describe' | 'mutate'>,
  namespace: string,
  providers: () => readonly LlmConfigurableProvider[],
): SelectionStore & ReferenceSource & PolicyStore {
  const descriptor = (ns: string) => {
    const row = settings.describe({ redactSecrets: true }).find(entry => entry.ns === ns)
    if (row === undefined) throw new Error('web-test/models: required official settings entry is absent')
    return row
  }
  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- SelectionStore returns promises; official settings reads synchronously.
    async read() {
      const row = descriptor(namespace)
      const raw = dictionary(member(row.value, 'selections'))
      const byTask: Partial<Record<RouteSelection['taskType'], RouteSelection>> = {}
      // Raw records remain available to the authority's strict reader, including unknown versions.
      return { revision: row.revision, byTask: { ...byTask, ...raw } }
    },
    async put(selection) {
      const row = descriptor(namespace)
      await settings.mutate(namespace, [{ op: 'set', path: ['selections', selection.taskType], value: parseStoredSelection(selection) }], row.revision)
      return true
    },
    forProvider(provider): CredentialRef | null {
      const entry = providers().find(row => row.provider === provider)
      if (entry === undefined) throw new Error('web-test/models: no provider configuration for credential reference')
      const row = descriptor(entry.settingsNs)
      const profile = entry.settingsPath.reduce<unknown>((value, key) => member(value, key), row.value)
      const ref = member(profile, 'apiKeyEnv')
      if (ref === undefined) return null
      if (typeof ref !== 'string' || !isCredentialRefName(ref)) throw new Error('web-test/models: invalid provider credential reference')
      return credentialRef(ref)
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- PolicyStore returns promises; official settings reads synchronously.
    async readPolicies() { return dictionary(member(descriptor(namespace).value, 'policies')) },
    async putPolicy(policy) {
      const row = descriptor(namespace)
      const policies = dictionary(member(row.value, 'policies'))
      if (Object.hasOwn(policies, policy.revision)) throw new Error('web-test/models: policy revision already exists')
      await settings.mutate(namespace, [{ op: 'set', path: ['policies', policy.revision], value: policy }], row.revision)
    },
  }
}
