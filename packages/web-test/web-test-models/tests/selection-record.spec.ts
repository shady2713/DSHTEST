/**
 * The persisted selection record: a foreign or malformed record re-verifies
 * rather than being served, and the in-memory store behaves like a store.
 */
import { describe, expect, it } from 'vitest'
import { memorySelectionStore, parseStoredSelection } from '../src/index.ts'
import { ROUTE_SELECTION_VERSION } from '../src/identity.ts'
import type { RouteSelection } from '../src/types.ts'

const selection: RouteSelection = {
  version: ROUTE_SELECTION_VERSION,
  taskType: 'analysis',
  route: { provider: 'deepseek-official', model: 'deepseek-flash', credentialRef: null },
  fingerprint: 'a'.repeat(64) as RouteSelection['fingerprint'],
  capabilities: { inputModalities: ['text', 'image'], toolUpdate: 'in-history', reportedCacheTokens: true },
  verifiedAt: 1_700_000_000_000,
}

describe('parseStoredSelection', () => {
  it('accepts a record this release wrote', () => {
    expect(parseStoredSelection(selection)).toEqual(selection)
  })

  it('rejects a record another release wrote, so it re-verifies instead of matching', () => {
    expect(parseStoredSelection({ ...selection, version: 'web-test-routes/0' })).toBeUndefined()
  })

  it('rejects a fingerprint this release did not produce', () => {
    expect(parseStoredSelection({ ...selection, fingerprint: 'short' })).toBeUndefined()
    expect(parseStoredSelection({ ...selection, fingerprint: undefined })).toBeUndefined()
  })

  it('rejects a value that is not a record at all', () => {
    expect(parseStoredSelection(null)).toBeUndefined()
    expect(parseStoredSelection('web-test-routes/1')).toBeUndefined()
    expect(parseStoredSelection(undefined)).toBeUndefined()
  })

  it('rejects a hand-edited route that names no provider or model to address', () => {
    // A settings document is a file a user can edit, so each of these records is
    // one an operator can produce. Serving one would send the request somewhere
    // this release never verified.
    expect(parseStoredSelection({ ...selection, route: undefined })).toBeUndefined()
    expect(parseStoredSelection({ ...selection, route: null })).toBeUndefined()
    expect(parseStoredSelection({ ...selection, route: 'deepseek-flash' })).toBeUndefined()
    expect(parseStoredSelection({
      ...selection,
      route: { model: 'deepseek-flash', credentialRef: null },
    })).toBeUndefined()
    expect(parseStoredSelection({
      ...selection,
      route: { provider: 'deepseek-official', credentialRef: null },
    })).toBeUndefined()
    expect(parseStoredSelection({
      ...selection,
      route: { provider: 7, model: 'deepseek-flash', credentialRef: null },
    })).toBeUndefined()
  })

  it('rejects a record with no capability record beside its fingerprint', () => {
    // The fingerprint proves which inputs were verified, not which capabilities
    // they were verified for, so a record without them re-verifies.
    expect(parseStoredSelection({ ...selection, capabilities: undefined })).toBeUndefined()
    expect(parseStoredSelection({ ...selection, capabilities: null })).toBeUndefined()
  })

  it('rejects a record whose capabilities are not what this release writes', () => {
    // Every one of these is a file a user can hand-edit. Serving any of them
    // would record a capability the release never observed.
    expect(parseStoredSelection({
      ...selection,
      capabilities: { ...selection.capabilities, inputModalities: 'image' },
    })).toBeUndefined()
    expect(parseStoredSelection({
      ...selection,
      capabilities: { ...selection.capabilities, inputModalities: ['text', 'audio'] },
    })).toBeUndefined()
    expect(parseStoredSelection({
      ...selection,
      capabilities: { ...selection.capabilities, inputModalities: undefined },
    })).toBeUndefined()
    expect(parseStoredSelection({
      ...selection,
      capabilities: { ...selection.capabilities, toolUpdate: 'sometimes' },
    })).toBeUndefined()
    expect(parseStoredSelection({
      ...selection,
      capabilities: { ...selection.capabilities, reportedCacheTokens: 'yes' },
    })).toBeUndefined()
  })

  it('accepts a record that declared no modality, and one that declared the tool-update modes', () => {
    expect(parseStoredSelection({
      ...selection,
      capabilities: { ...selection.capabilities, inputModalities: null },
    })).toEqual({
      ...selection,
      capabilities: { ...selection.capabilities, inputModalities: null },
    })
    expect(parseStoredSelection({
      ...selection,
      capabilities: { ...selection.capabilities, toolUpdate: undefined },
    })).toEqual({
      ...selection,
      capabilities: { ...selection.capabilities, toolUpdate: undefined },
    })
    expect(parseStoredSelection({
      ...selection,
      capabilities: { ...selection.capabilities, toolUpdate: 'addition-only' },
    })).toEqual({
      ...selection,
      capabilities: { ...selection.capabilities, toolUpdate: 'addition-only' },
    })
  })

  it('rejects a record whose route names a credential reference that is not one', () => {
    // The reference decides which tickets a credential change parks, so a name
    // outside the grammar is not a reference this release can honour.
    expect(parseStoredSelection({
      ...selection,
      route: { ...selection.route, credentialRef: 7 },
    })).toBeUndefined()
    expect(parseStoredSelection({
      ...selection,
      route: { ...selection.route, credentialRef: 'not a reference name' },
    })).toBeUndefined()
    expect(parseStoredSelection({
      ...selection,
      route: { ...selection.route, credentialRef: undefined },
    })).toBeUndefined()
  })

  it('accepts the two credential references a stored route may name', () => {
    expect(parseStoredSelection({
      ...selection,
      route: { ...selection.route, credentialRef: 'DEEPSEEK_API_KEY' },
    })).toEqual({
      ...selection,
      route: { ...selection.route, credentialRef: 'DEEPSEEK_API_KEY' },
    })
  })

  it('rejects a record whose task type or verification instant is not what this release writes', () => {
    expect(parseStoredSelection({ ...selection, taskType: 3 })).toBeUndefined()
    // A tag outside the closed union is a record this release does not route,
    // not a task type with a default requirement.
    expect(parseStoredSelection({ ...selection, taskType: 'summarise' })).toBeUndefined()
    expect(parseStoredSelection({ ...selection, taskType: '' })).toBeUndefined()
    expect(parseStoredSelection({ ...selection, verifiedAt: '1700000000000' })).toBeUndefined()
  })
})

describe('memorySelectionStore', () => {
  it('starts empty and answers one record per task type', async () => {
    const store = memorySelectionStore()
    expect(await store.read()).toEqual({ revision: 0, byTask: {} })
    expect(await store.put(selection)).toBe(true)
    const after = await store.read()
    expect(after.revision).toBe(1)
    expect(after.byTask.analysis).toEqual(selection)
  })

  it('replaces an earlier record for the same task type and adds one for another', async () => {
    const store = memorySelectionStore()
    await store.put(selection)
    const moved: RouteSelection = { ...selection, route: { ...selection.route, model: 'deepseek-v4-pro' } }
    await store.put(moved)
    expect((await store.read()).byTask.analysis?.route.model).toBe('deepseek-v4-pro')
    await store.put({ ...selection, taskType: 'auxiliary' })
    expect(Object.keys((await store.read()).byTask).sort()).toEqual(['analysis', 'auxiliary'])
  })

  it('hands out a copy, so a caller\'s spread cannot reach the stored record', async () => {
    const store = memorySelectionStore()
    await store.put(selection)
    const read = await store.read()
    expect(read.byTask).not.toBe(selection)
    expect(read.byTask.analysis).toEqual(selection)
  })
})
