/**
 * The digest a route verification is bound to, and the capability record a
 * real request earns.
 *
 * A selection is ready because a real request answered *on the inputs that
 * request was made with*. Those inputs are the provider directory entry (which
 * namespace and path configure the route, and whether the adapter ships it), the
 * adapter's declared model metadata, and the credential reference the route
 * resolves keys through. Digest them together and a selection is re-verified
 * exactly when one of them moved — an added provider, an edited model id, a
 * swapped key reference — and not otherwise.
 *
 * @module @deepseek-ai/dsh-web-test-models/fingerprint
 */

import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { LlmConfigurableProvider, LlmResolvedModelInfo, ModelModality, TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { ProbeFingerprint, RouteFingerprint } from './identity.ts'
import type { ModelRoute, RouteCapabilities } from './types.ts'

/** Normalize a value to a canonical JSON string, so key order cannot change a digest. */
function canonical(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    // `canonical` is module-private and both callers pass an object literal, and
    // `Object.entries` yields each own key once, so two compared keys are never
    // equal and the ascending order needs no tie-break.
    .sort(([left], [right]) => (left < right ? -1 : 1))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
}

/**
 * Digest the inputs one route verification depended on.
 *
 * The provider entry's `error` is included: an adapter that reports a
 * configuration diagnostic for a route is saying the route's configuration is
 * not what it was, and a selection made before that must not be read as still
 * verified.
 * @param route - the exact route a request addressed.
 * @param entry - the provider directory entry that configures the route, or undefined for an unregistered one.
 * @param model - the adapter's declared metadata for the exact model.
 * @returns the branded digest the selection is verified against.
 */
export function routeFingerprint(
  route: ModelRoute,
  entry: LlmConfigurableProvider | undefined,
  model: LlmResolvedModelInfo,
): RouteFingerprint {
  const payload = canonical({
    kind: 'route',
    provider: route.provider,
    model: route.model,
    credentialRef: route.credentialRef,
    entry: entry === undefined
      ? null
      : {
        provider: entry.provider,
        settingsNs: entry.settingsNs,
        settingsPath: entry.settingsPath,
        declared: entry.declared ?? null,
        error: entry.error ?? null,
      },
    declared: {
      name: model.name,
      description: model.description ?? null,
      inputModalities: model.inputModalities ?? null,
      toolUpdate: model.toolUpdate ?? null,
      systemPromptUpdate: model.systemPromptUpdate ?? null,
      contextWindow: model.context?.contextWindow ?? null,
      defaultMaxTokens: model.defaultMaxTokens ?? null,
    },
  })
  return brandString<RouteFingerprint>(createHash('sha256').update(payload, 'utf8').digest('hex'))
}

/**
 * Digest one probe request's identity, so a caller can tell a re-run of the same
 * request from a different one without comparing verdicts.
 * @param route - the exact route the request addressed.
 * @param taskType - the capability requirement the request carried.
 * @returns the branded request digest.
 */
export function probeFingerprint(route: ModelRoute, taskType: string): ProbeFingerprint {
  const payload = canonical({
    kind: 'probe',
    provider: route.provider,
    model: route.model,
    credentialRef: route.credentialRef,
    taskType,
  })
  return brandString<ProbeFingerprint>(createHash('sha256').update(payload, 'utf8').digest('hex'))
}

/**
 * The modality vocabulary this release routes.
 *
 * `ModelModality` is merge-extensible, so a modality a later release adds is one
 * this release cannot name. A stored record naming it is therefore unreadable
 * here rather than half-understood, and unreadable re-verifies.
 */
const MODEL_MODALITIES: ReadonlySet<string> = new Set<ModelModality>(['text', 'image'])

/**
 * Whether a value is a modality this release routes.
 * @param value - the value to judge.
 * @returns true when the value is one of this release's declared modalities.
 */
export function isModelModality(value: unknown): value is ModelModality {
  return typeof value === 'string' && MODEL_MODALITIES.has(value)
}

/**
 * Read the modalities an adapter declares, distinguishing "declared nothing"
 * from "declared text only".
 *
 * The distinction decides whether a vision task can use a route: an adapter that
 * declares nothing leaves the capability unknown, and an unknown capability does
 * not satisfy a requirement.
 * @param model - the adapter's declared metadata for the exact model.
 * @returns the declared modalities, or `null` when the adapter declared none.
 */
export function declaredModalities(model: LlmResolvedModelInfo): readonly ModelModality[] | null {
  return model.inputModalities ?? null
}

/**
 * Build the capability record a real request earns.
 *
 * `reportedCacheTokens` is read from the response's own token usage, not from the
 * provider's name, so a route whose provider never reports cache fields is
 * recorded as having none and no surface can promise a caching benefit across
 * providers it did not measure.
 * @param model - the adapter's declared metadata for the exact model.
 * @param usage - the token usage the real response reported, when it reported one.
 * @returns the capabilities recorded alongside the selection.
 */
export function routeCapabilities(
  model: LlmResolvedModelInfo,
  usage: TokenUsage | undefined,
): RouteCapabilities {
  return {
    inputModalities: declaredModalities(model),
    toolUpdate: model.toolUpdate,
    reportedCacheTokens: usage !== undefined
      && (usage.cacheReadTokens !== undefined || usage.cacheWriteTokens !== undefined),
  }
}

/**
 * Whether a recorded modality list is still the one the adapter declares.
 *
 * The comparison is over the set of modalities rather than its order, so a
 * record listing what the adapter lists in another order is the same
 * declaration. "Declared nothing" is compared as itself: a record that declared
 * nothing matches a route that still declares nothing and no list, because an
 * unknown capability is not a text-only one and removing every modality from a
 * recorded list does not turn it into "unknown".
 *
 * This is the fact the digest cannot carry. The digest covers what the adapter
 * publishes *about* the model; the modality list is recorded beside it in the
 * same file, so the two are independent and a record whose list was hand-edited
 * keeps a valid digest. A caller serving a stored record therefore compares the
 * two and refuses the record when they disagree.
 * @param recorded - the modality list the stored record carries.
 * @param declared - the modalities the owning adapter declares now.
 * @returns true when the two name the same modalities.
 */
export function sameDeclaredModalities(
  recorded: RouteCapabilities['inputModalities'],
  declared: RouteCapabilities['inputModalities'],
): boolean {
  if (recorded === null) return declared === null
  if (declared === null) return false
  return recorded.length === declared.length && recorded.every(modality => declared.includes(modality))
}

/**
 * Whether a capability record satisfies a task's modality requirement.
 *
 * A requirement is only met by a *list* that includes it. `null` and a list that
 * omits the modality both fail, which is what keeps a vision task off a route
 * whose adapter said nothing about images. The list is required rather than
 * assumed because a stored record comes from a settings file a user can
 * hand-edit, and `'image'.includes('image')` would let a string typed where a
 * list belongs satisfy an image requirement on a route that never declared one.
 * @param capabilities - the recorded capabilities.
 * @param required - the modality the task type needs.
 * @returns true only when the adapter declared a list containing the modality.
 */
export function satisfiesModality(
  capabilities: RouteCapabilities,
  required: ModelModality,
): boolean {
  const declared = capabilities.inputModalities
  return Array.isArray(declared) && declared.includes(required)
}
