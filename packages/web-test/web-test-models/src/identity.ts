/**
 * Branded identities for the Web testing model-configuration domain.
 *
 * These are opaque cross-boundary ids, so each is branded at its declaration:
 * a `RouteSelectionVersion` can never be read as a `Revision`, and a
 * `RouteFingerprint` can never be read as a credential reference. The two
 * fingerprint brands are separate on purpose — a route's verified inputs and a
 * probe's single request are different facts that happen to both be digests.
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Schema version of the persisted route-selection record. */
export type RouteSelectionVersion = Branded<'RouteSelectionVersion'>

/** Schema version of the persisted route-policy record. */
export type RoutePolicyVersion = Branded<'RoutePolicyVersion'>

/**
 * Identity one route policy keeps across the revisions issued under it. A
 * revision changes the rules; this is the policy those revisions belong to.
 */
export type RoutePolicyId = Branded<'RoutePolicyId'>

/**
 * Identity of one issued policy revision. A run pins the revision it started
 * under, and a request already sent keeps the revision it was issued with.
 */
export type PolicyRevisionId = Branded<'PolicyRevisionId'>

/**
 * Version stamp on the input generation that produced a run's inputs, so a
 * result computed from one generation is never read as a result of another.
 */
export type InputGenerationVersion = Branded<'InputGenerationVersion'>

/** Opaque identity of one run pinned to a policy revision. */
export type PolicyWorkId = Branded<'PolicyWorkId'>

/**
 * Digest over the inputs a route verification depended on: the provider
 * directory entry, the adapter's declared model metadata, and the route's
 * credential reference. Equal digests mean the same verification still applies.
 */
export type RouteFingerprint = Branded<'RouteFingerprint'>

/** Digest over a single probe request's outcome inputs, for a caller's own change detection. */
export type ProbeFingerprint = Branded<'ProbeFingerprint'>

/** Version stamped into every route selection this release writes. */
export const ROUTE_SELECTION_VERSION = brandString<RouteSelectionVersion>('web-test-routes/1')

/** Version stamped into every route policy this release writes. */
export const ROUTE_POLICY_VERSION = brandString<RoutePolicyVersion>('web-test-route-policy/1')

/** Format every route fingerprint must match. */
export const ROUTE_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u

/** Format every probe fingerprint must match. */
export const PROBE_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u

/**
 * Whether a stored value is a fingerprint this release wrote.
 *
 * A record persisted by a build with a different digest width is reported rather
 * than coerced, so an unreadable selection re-verifies instead of matching a
 * fingerprint it never produced.
 * @param value - the stored fingerprint to judge.
 * @returns true when the value is a 64-character lowercase hex digest.
 */
export function isRouteFingerprint(value: unknown): value is RouteFingerprint {
  return typeof value === 'string' && ROUTE_FINGERPRINT_PATTERN.test(value)
}

/**
 * Whether a stored value is a probe fingerprint this release wrote.
 * @param value - the stored fingerprint to judge.
 * @returns true when the value is a 64-character lowercase hex digest.
 */
export function isProbeFingerprint(value: unknown): value is ProbeFingerprint {
  return typeof value === 'string' && PROBE_FINGERPRINT_PATTERN.test(value)
}
