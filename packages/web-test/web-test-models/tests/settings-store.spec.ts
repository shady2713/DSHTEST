/** Untrusted settings documents and official provider reference paths. */
import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SettingsDescriptor, SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { createSettingsModelStore } from '../src/settings-store.ts'

describe('settings model store', () => {
  it('rejects missing entries, foreign dictionaries, unconfigured providers, and invalid reference names', async () => {
    let rows: SettingsDescriptor[] = []
    const store = createSettingsModelStore({ describe: () => rows, mutate: vi.fn() }, 'models', () => [{ provider:'p', displayName:'P', settingsNs:'provider', settingsPath:['profile'] }])
    await expect(store.read()).rejects.toThrow('absent')
    expect(() => store.forProvider('unknown')).toThrow('no provider configuration')
    rows = [{
      ns: brandString<SettingsNamespace>('models'), schema: {}, revision: 0, autoGenerate: false, applies: 'live',
      value: { selections: [], policies: null },
    }]
    await expect(store.read()).rejects.toThrow('invalid settings records')
    await expect(store.readPolicies()).rejects.toThrow('invalid settings records')
    rows[0]!.value = null
    await expect(store.read()).rejects.toThrow('invalid settings records')
    rows.push({
      ns: brandString<SettingsNamespace>('provider'), schema: {}, revision: 0, autoGenerate: false, applies: 'live', value: { profile: {} },
    })
    expect(store.forProvider('p')).toBeNull()
    rows[1]!.value = { profile:{ apiKeyEnv:'invalid ref!' } }
    expect(() => store.forProvider('p')).toThrow('invalid provider credential reference')
    rows[1]!.value = { profile:{ apiKeyEnv:'TEST_KEY' } }
    expect(store.forProvider('p')).toBe('TEST_KEY')
  })
})
