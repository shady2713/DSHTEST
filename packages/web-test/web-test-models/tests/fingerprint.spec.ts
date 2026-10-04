/**
 * A route's fingerprint is what binds a verification to the inputs it was made
 * with, so it must be stable across key order and sensitive to every input.
 */
import { describe, expect, it } from 'vitest'
import type { LlmConfigurableProvider, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm/types'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  declaredModalities, isModelModality, probeFingerprint, routeCapabilities, routeFingerprint, sameDeclaredModalities,
  satisfiesModality,
} from '../src/fingerprint.ts'
import { isProbeFingerprint, isRouteFingerprint, ROUTE_SELECTION_VERSION } from '../src/identity.ts'
import type { ModelRoute, RouteCapabilities } from '../src/types.ts'

const route: ModelRoute = {
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  credentialRef: credentialRef('DEEPSEEK_API_KEY'),
}

const entry: LlmConfigurableProvider = {
  provider: 'deepseek-official',
  displayName: 'DeepSeek',
  settingsNs: 'llm-deepseek',
  settingsPath: ['deepseekOfficial'],
}

const model: LlmResolvedModelInfo = {
  provider: 'deepseek-official',
  id: 'deepseek-flash',
  name: 'DeepSeek Flash',
  inputModalities: ['text', 'image'],
  toolUpdate: 'in-history',
  systemPromptUpdate: 'in-history',
  context: { contextWindow: 128_000 },
  defaultMaxTokens: 4096,
  description: 'fast',
}

/**
 * Copy a declared model without one optional field, so the copy is the shape the
 * adapter emits when the field is absent rather than a field set to `undefined`.
 * @param declared - the model to copy.
 * @param key - the optional field to leave out.
 * @returns the model without that field.
 */
function without(
  declared: LlmResolvedModelInfo,
  key: 'toolUpdate' | 'systemPromptUpdate' | 'description' | 'inputModalities' | 'context' | 'defaultMaxTokens',
): LlmResolvedModelInfo {
  const { [key]: _omitted, ...rest } = declared
  return rest
}

describe('routeFingerprint', () => {
  it('is a 64-character digest the release recognises', () => {
    const digest = routeFingerprint(route, entry, model)
    expect(isRouteFingerprint(digest)).toBe(true)
  })

  it('is stable for the same inputs, whatever order the entry was written in', () => {
    const reordered: LlmConfigurableProvider = {
      settingsPath: entry.settingsPath,
      settingsNs: entry.settingsNs,
      displayName: entry.displayName,
      provider: entry.provider,
    }
    expect(routeFingerprint(route, reordered, model)).toBe(routeFingerprint(route, entry, model))
  })

  it('moves when the provider, the model, or the credential reference moves', () => {
    const base = routeFingerprint(route, entry, model)
    expect(routeFingerprint({ ...route, provider: 'other' }, entry, model)).not.toBe(base)
    expect(routeFingerprint({ ...route, model: 'deepseek-v4-pro' }, entry, model)).not.toBe(base)
    expect(routeFingerprint({ ...route, credentialRef: null }, entry, model)).not.toBe(base)
  })

  it('moves when the provider entry or the declared metadata moves', () => {
    const base = routeFingerprint(route, entry, model)
    expect(routeFingerprint(route, { ...entry, settingsNs: 'llm-other' }, model)).not.toBe(base)
    expect(routeFingerprint(route, { ...entry, error: 'bad base URL' }, model)).not.toBe(base)
    expect(routeFingerprint(route, undefined, model)).not.toBe(base)
    expect(routeFingerprint(route, entry, { ...model, inputModalities: ['text'] })).not.toBe(base)
    expect(routeFingerprint(route, entry, without(model, 'toolUpdate'))).not.toBe(base)
    expect(routeFingerprint(route, entry, { ...model, context: { contextWindow: 4096 } })).not.toBe(base)
    expect(routeFingerprint(route, entry, { ...model, defaultMaxTokens: 1 })).not.toBe(base)
    expect(routeFingerprint(route, entry, without(model, 'systemPromptUpdate'))).not.toBe(base)
    expect(routeFingerprint(route, entry, without(model, 'description'))).not.toBe(base)
  })

  it('moves when the adapter stops declaring a field the selection was verified against', () => {
    // An adapter that declares nothing about a field is one fact to the digest,
    // and it is not the fact the selection was verified on: a route whose
    // declaration of modalities, context window, or output cap disappears must
    // re-verify rather than be read as still verified.
    const base = routeFingerprint(route, entry, model)
    expect(routeFingerprint(route, entry, without(model, 'inputModalities'))).not.toBe(base)
    expect(routeFingerprint(route, entry, without(model, 'context'))).not.toBe(base)
    expect(routeFingerprint(route, entry, without(model, 'defaultMaxTokens'))).not.toBe(base)
    // The route still names the model, so a caller can tell which route moved.
    expect(routeFingerprint(route, entry, without(model, 'context'))).not.toBe(
      routeFingerprint({ ...route, model: 'deepseek-v4-pro' }, entry, without(model, 'context')),
    )
  })
})

describe('probeFingerprint', () => {
  it('is a 64-character digest the release recognises', () => {
    expect(isProbeFingerprint(probeFingerprint(route, 'analysis'))).toBe(true)
  })

  it('differs per task type, because the request carried a different requirement', () => {
    expect(probeFingerprint(route, 'analysis')).not.toBe(probeFingerprint(route, 'vision'))
  })
})

describe('declaredModalities', () => {
  it('separates a declared list from an adapter that declared nothing', () => {
    expect(declaredModalities(model)).toEqual(['text', 'image'])
    expect(declaredModalities({ provider: 'p', id: 'm', name: 'M' })).toBeNull()
  })
})

describe('routeCapabilities', () => {
  it('records cache tokens only when the real response reported them', () => {
    expect(routeCapabilities(model, { inputTokens: 5, outputTokens: 1, cacheReadTokens: 12 }).reportedCacheTokens).toBe(true)
    expect(routeCapabilities(model, { inputTokens: 5, outputTokens: 1, cacheWriteTokens: 3 }).reportedCacheTokens).toBe(true)
    expect(routeCapabilities(model, { inputTokens: 5, outputTokens: 1 }).reportedCacheTokens).toBe(false)
    expect(routeCapabilities(model, undefined).reportedCacheTokens).toBe(false)
  })

  it('carries the adapter\'s own tool declaration through unchanged', () => {
    expect(routeCapabilities(model, undefined).toolUpdate).toBe('in-history')
    expect(routeCapabilities(without(model, 'toolUpdate'), undefined).toolUpdate).toBeUndefined()
  })
})

/**
 * Build the capability record a hand-edited settings file can hold.
 *
 * The field is left untyped here on purpose: the file is not typed, which is the
 * only way a value the release's own type forbids reaches this package.
 * @param inputModalities - whatever the file put in the modality field.
 * @returns the record as the service's reader would have to accept it.
 */
function handEditedCapabilities(inputModalities: unknown): RouteCapabilities {
  const record: object = { inputModalities, toolUpdate: undefined, reportedCacheTokens: false }
  return record as RouteCapabilities
}

describe('satisfiesModality', () => {
  it('accepts a declared modality and refuses an undeclared or unknown one', () => {
    const capabilities = routeCapabilities(model, undefined)
    expect(satisfiesModality(capabilities, 'text')).toBe(true)
    expect(satisfiesModality(capabilities, 'image')).toBe(true)
    const textOnly = routeCapabilities({ ...model, inputModalities: ['text'] }, undefined)
    expect(satisfiesModality(textOnly, 'image')).toBe(false)
    const silent = routeCapabilities(without(model, 'inputModalities'), undefined)
    expect(satisfiesModality(silent, 'text')).toBe(false)
  })

  it('is not satisfiable by anything but a list, whatever a hand-edited record holds', () => {
    // `'image'.includes('image')` is true, so a record whose modalities were
    // typed as a bare string would satisfy an image requirement on a route that
    // never declared one. The requirement is only ever met by a declared list.
    expect(satisfiesModality(handEditedCapabilities('image'), 'image')).toBe(false)
    expect(satisfiesModality(handEditedCapabilities(null), 'text')).toBe(false)
    expect(satisfiesModality(handEditedCapabilities(['text']), 'text')).toBe(true)
    expect(satisfiesModality(handEditedCapabilities(['text']), 'image')).toBe(false)
  })
})

describe('sameDeclaredModalities', () => {
  it('is the comparison the digest cannot make, over every pair the two sides can hold', () => {
    // The recorded list sits beside the digest in the same file, so a hand edit
    // leaves the digest valid. Each side is a list or "declared nothing", and
    // "declared nothing" is only still true when both sides are.
    expect(sameDeclaredModalities(null, null)).toBe(true)
    expect(sameDeclaredModalities(null, ['text'])).toBe(false)
    expect(sameDeclaredModalities(['text'], null)).toBe(false)
    expect(sameDeclaredModalities(['text'], ['text'])).toBe(true)
    expect(sameDeclaredModalities([], [])).toBe(true)
    expect(sameDeclaredModalities(['text'], ['text', 'image'])).toBe(false)
    expect(sameDeclaredModalities(['text'], ['image'])).toBe(false)
    // The comparison is over the set, so a record listing the same modalities in
    // another order is the same declaration.
    expect(sameDeclaredModalities(['text', 'image'], ['image', 'text'])).toBe(true)
  })
})

describe('isModelModality', () => {
  it('accepts the modalities this release routes and refuses anything else', () => {
    expect(isModelModality('text')).toBe(true)
    expect(isModelModality('image')).toBe(true)
    // A modality a future release adds is a record this release cannot read, and
    // an unreadable record re-verifies rather than being served from.
    expect(isModelModality('audio')).toBe(false)
    expect(isModelModality('Image')).toBe(false)
    expect(isModelModality(undefined)).toBe(false)
  })
})

describe('isRouteFingerprint', () => {
  it('rejects a value this release did not write', () => {
    expect(isRouteFingerprint('short')).toBe(false)
    expect(isRouteFingerprint('A'.repeat(64))).toBe(false)
    expect(isRouteFingerprint(undefined)).toBe(false)
  })
})

describe('ROUTE_SELECTION_VERSION', () => {
  it('names the release that wrote a selection', () => {
    expect(ROUTE_SELECTION_VERSION).toBe('web-test-routes/1')
  })
})
