/**
 * The fixed rules one kind of work runs under: which route, which fallback,
 * which capability is required, how long it may take, what validates its
 * output, and when it stops and hands over.
 *
 * This answers a different question from `RouteSelection`. A selection answers
 * "did this route answer", and is bound to a digest of the inputs its
 * verification depended on. A policy answers "for this kind of task, which
 * route, what fallback, what timeout, which validator, which escalation", and
 * is a *rule set* rather than an observation: nothing in it was proven by a
 * request. The two coexist — a rule set with no verification is unproven, and a
 * verification with no rule set says nothing about the next task of the same
 * kind — so this module adds a type rather than renaming the existing one.
 *
 * **Immutability is the reason the fields are `readonly`.** A run pins the
 * revision it was admitted under; repairing a credential writes a new value
 * under a reference and changes no recorded choice; and a request already sent
 * reads its `routeRevision` and result ownership from the record that pinned
 * it, not from whichever revision is current. A model or capability change
 * therefore issues a new revision, which is what makes "no silent hot-swap"
 * checkable rather than aspirational.
 *
 * **A timeout is a recoverable failure and a cancellation is a control
 * result.** Both fire the same `AbortSignal`, so they are told apart by what
 * the caller knows — elapsed time against the policy's own deadlines, or an
 * explicit cancellation — never by the signal alone.
 *
 * @module @deepseek-ai/dsh-web-test-models/policy
 */

import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { ROUTE_POLICY_VERSION } from './identity.ts'
import type {
  InputGenerationVersion, PolicyRevisionId, PolicyWorkId, RoutePolicyId, RoutePolicyVersion,
} from './identity.ts'
import { satisfiesModality } from './fingerprint.ts'
import { requiredModality } from './task.ts'
import type { ModelTaskType } from './task.ts'
import type {
  PolicyCapability, PolicyEscalation, PolicyRecord, PolicyRoute, PolicyTimeouts, PolicyValidator,
  RouteCapabilities, RoutePolicyRevision, PolicyTaskKind,
} from './types.ts'

/**
 * What one task kind requires, and which route requirement it satisfies.
 *
 * `taskType` is `null` for a kind that runs no model route: `exact-value` is
 * deterministic parsing and comparison, and dispatching it to a text model would
 * introduce the model judgment its rule forbids. The other five kinds each name
 * the {@link ModelTaskType} whose modality requirement they satisfy, so the six
 * kinds and the three routed task types stay one vocabulary rather than two.
 */
export interface PolicyKindProfile {
  /** The kind, spelled the way a caller states it. */
  readonly kind: PolicyTaskKind
  /** The task type whose requirement this kind satisfies, or `null` for a kind that runs no model. */
  readonly taskType: ModelTaskType | null
  /** What the route must be able to do before this kind may be sent to it. */
  readonly requiredCapabilities: readonly PolicyCapability[]
  /** What this kind is, said once for a surface listing the kinds. */
  readonly purpose: string
}

/**
 * The six kinds a Web testing session routes.
 *
 * The list is keyed by the whole string domain, so a kind read from a stored
 * record is looked up rather than assumed to exist. Order is the order a
 * surface lists them: reasoning first, then the two that decide, then
 * inspection, exact values, reporting, and drafting.
 */
const POLICY_PROFILES: readonly PolicyKindProfile[] = [
  {
    kind: 'requirements',
    taskType: 'analysis',
    requiredCapabilities: ['text-input'],
    purpose: 'reading requirements, planning cases, and assessing what a change would affect',
  },
  {
    kind: 'candidate-selection',
    taskType: 'analysis',
    requiredCapabilities: ['text-input'],
    purpose: 'choosing one action candidate, or classifying what state a page is in',
  },
  {
    kind: 'visual-inspection',
    taskType: 'vision',
    requiredCapabilities: ['image-input'],
    purpose: 'inspecting imagery and grounding a coordinate to something on the page',
  },
  {
    kind: 'exact-value',
    taskType: null,
    requiredCapabilities: [],
    purpose: 'reading an exact value, a file\'s content, or checking a number deterministically',
  },
  {
    kind: 'defect-explanation',
    taskType: 'analysis',
    requiredCapabilities: ['text-input'],
    purpose: 'explaining a defect and summarizing evidence that was already committed',
  },
  {
    kind: 'skill-draft',
    taskType: 'analysis',
    requiredCapabilities: ['text-input'],
    purpose: 'drafting a skill, which the user confirms before it is adopted',
  },
]

/** Every task kind this release routes, with what each one requires. */
export const POLICIES: readonly PolicyKindProfile[] = POLICY_PROFILES

/** Kinds this release routes, for a surface that lists them without their rules. */
export const POLICY_KINDS: readonly PolicyTaskKind[] = POLICY_PROFILES.map(profile => profile.kind)

/**
 * Read one kind's profile.
 *
 * A kind this release does not route is refused rather than answered with the
 * nearest kind: an unmapped kind served under a neighbour's capabilities is the
 * silent downgrade the capability check exists to prevent, and a caller that
 * names a kind nobody implemented deserves to hear that.
 * @param kind - the kind being routed; a value read from a stored record may be a kind this release does not know.
 * @returns the profile declaring what that kind requires.
 * @throws {Error} when the kind has no profile in this release.
 */
export function requireForKind(kind: PolicyTaskKind | (string & { readonly [BRAND]: 'unknown-policy-kind' })): PolicyKindProfile {
  const profile = POLICY_PROFILES.find(entry => entry.kind === kind)
  if (profile === undefined) {
    throw new Error(`web-test/models: task kind ${JSON.stringify(kind)} declares no route policy`)
  }
  return profile
}

/**
 * Whether a stored value names a kind this release routes.
 *
 * The check is the whole-string lookup rather than a prefix or substring test,
 * so `exact-value-check` is reported absent rather than read as `exact-value`.
 * @param value - the stored kind.
 * @returns true when this release routes the kind.
 */
export function knownTaskKind(value: unknown): value is PolicyTaskKind {
  return typeof value === 'string' && POLICY_KINDS.includes(value as PolicyTaskKind)
}

/**
 * Whether one recorded capability is satisfied by a route's declaration.
 *
 * Every member is read off something a real request or the adapter's own
 * declaration established, so the answer is an observation rather than a guess.
 * A route whose adapter declared no modality satisfies neither input member:
 * unknown is not text-only, which is the same rule `satisfiesModality` applies.
 * @param capability - the capability the policy requires.
 * @param capabilities - what the adapter declared and the probe observed.
 * @returns true when the route satisfies the capability.
 */
export function capabilityCheck(capability: PolicyCapability, capabilities: RouteCapabilities): boolean {
  switch (capability) {
    case 'text-input':
      return satisfiesModality(capabilities, requiredModality('analysis'))
    case 'image-input':
      return satisfiesModality(capabilities, requiredModality('vision'))
    case 'tool-update':
      return capabilities.toolUpdate !== undefined
    case 'cache-tokens':
      return capabilities.reportedCacheTokens
    /* v8 ignore next -- unreachable without a TypeScript contract violation */
    default:
      return assertNever(capability, 'web-test/models: unknown route capability')
  }
}

/**
 * What a route is missing for one policy.
 *
 * `missing` names every unsatisfied capability rather than stopping at the
 * first, because a surface shows the whole gap: "needs image input and cache
 * tokens" is a different instruction from "needs image input", and the remedy
 * differs with the model the user would otherwise pick.
 */
export type CapabilityCheck =
  /** The route satisfies every required capability. */
  | { readonly ok: true; readonly missing: readonly [] }
  /** The route cannot serve this policy; every capability it lacks is named. */
  | { readonly ok: false; readonly missing: readonly PolicyCapability[] }

/**
 * Whether a verified route may serve one policy.
 *
 * The check is against the policy's own `requiredCapabilities` and not against
 * a comparison of the routes: a fallback chosen because it is available rather
 * than because it can do the work is the silent downgrade this refuses. A route
 * that is missing a capability is reported as missing, never downgraded to a
 * route the caller did not verify for it.
 * @param policy - the policy the work would run under.
 * @param capabilities - what the candidate route declared and the probe observed.
 * @returns whether the route may serve it, and what it lacks when it may not.
 */
export function satisfiesPolicy(policy: RoutePolicyRevision, capabilities: RouteCapabilities): CapabilityCheck {
  const missing = policy.requiredCapabilities.filter(capability => !capabilityCheck(capability, capabilities))
  return missing.length === 0
    ? { ok: true, missing: [] }
    : { ok: false, missing }
}

/** What a request or a whole run has reached when the policy's deadlines are read. */
export interface DeadlineObservation {
  /** Milliseconds the in-flight request has taken. */
  readonly elapsedRequestMs: number
  /** Milliseconds the whole run has taken. */
  readonly elapsedTaskMs: number
  /** Whether the caller cancelled, which is a control result rather than a failure. */
  readonly cancelled: boolean
}

/**
 * How a request ended against the policy's own deadlines.
 *
 * `timeout` carries `recoverable: true` because the remedy is another request,
 * on the fallback route, rather than a smaller budget: a route that ran out of
 * time has not demonstrated that it cannot answer. `cancelled` is the one
 * member that is not a failure at all — the user asked for it.
 */
export type DeadlineState =
  /** Neither deadline has passed. */
  | { readonly kind: 'running' }
  /** The caller cancelled; a control result, not a recoverable failure. */
  | { readonly kind: 'cancelled' }
  /** A deadline passed; a recoverable failure, never a user decision. */
  | { readonly kind: 'timeout'; readonly deadline: 'request' | 'task'; readonly recoverable: true }

/**
 * Read a request's end state against one policy's deadlines.
 *
 * A caller cancellation is read first, because it is the only member whose
 * cause is the caller's own decision; a request that exceeded a deadline while
 * the caller was cancelling is still a cancellation, and reporting it as a
 * timeout would make a user decision look like a provider failure. Otherwise the
 * request deadline is preferred over the whole-task one, since the request is
 * the narrower fact and its expiry is what the next route answers.
 * @param policy - the policy whose own deadlines are being read.
 * @param observation - what the caller measured.
 * @returns the end state, which tells a timeout from a cancellation.
 */
export function classifyDeadline(policy: RoutePolicyRevision, observation: DeadlineObservation): DeadlineState {
  const { timeouts } = policy
  if (observation.cancelled) return { kind: 'cancelled' }
  if (observation.elapsedRequestMs > timeouts.requestMs) {
    return { kind: 'timeout', deadline: 'request', recoverable: true }
  }
  if (observation.elapsedTaskMs > timeouts.taskMs) {
    return { kind: 'timeout', deadline: 'task', recoverable: true }
  }
  return { kind: 'running' }
}

/**
 * What a run does about a request that ended.
 *
 * A timeout sends the work to the fallback route rather than repeating the same
 * request, because the fallback is the route the policy already declared able to
 * serve this kind. With no fallback the run escalates instead of retrying a
 * route that has already run out of time.
 */
export type DeadlineDecision =
  /** Neither deadline has passed; the request continues. */
  | { readonly kind: 'running' }
  /** The caller cancelled; the run stops and this is reported as a decision. */
  | { readonly kind: 'cancelled' }
  /** The request timed out and the fallback route takes the work. */
  | { readonly kind: 'fallback-route'; readonly route: PolicyRoute }
  /** The request timed out with no fallback route, so the run hands over. */
  | { readonly kind: 'escalate'; readonly condition: 'route-timeout' }

/**
 * Decide what a run does about one request that ended.
 *
 * The decision never turns a timeout into a cancellation, which is the failure
 * this exists to prevent: reading a recoverable failure as a user decision
 * stops a run that had another declared route available.
 * @param policy - the policy the run is admitted under.
 * @param observation - what the caller measured.
 * @returns the run's next move.
 */
export function deadlineDecision(
  policy: RoutePolicyRevision,
  observation: DeadlineObservation,
): DeadlineDecision {
  const state = classifyDeadline(policy, observation)
  switch (state.kind) {
    case 'cancelled':
      return { kind: 'cancelled' }
    case 'running':
      return { kind: 'running' }
    case 'timeout':
      return policy.fallback === null
        ? { kind: 'escalate', condition: 'route-timeout' }
        : { kind: 'fallback-route', route: policy.fallback }
    /* v8 ignore next -- unreachable without a TypeScript contract violation */
    default:
      return assertNever(state, 'web-test/models: unknown deadline state')
  }
}

/** What one result's validation produced. */
export interface ValidationObservation {
  /** The checks that rejected the result; empty when every declared check passed. */
  readonly failedValidators: readonly PolicyValidator[]
}

/**
 * What a run does with a result its validators rejected.
 *
 * A rejection is never reported as a model refusal, so no member carries a
 * `ConnectionVerdict`: the model answered, and the answer failed a check this
 * policy declares. That is why `retry-on-fallback` exists as its own decision
 * instead of routing a rejected result through the connection verdicts.
 */
export type ValidationDecision =
  /** Every declared validator passed. */
  | { readonly kind: 'accepted' }
  /** A declared validator rejected the result; the fallback route takes the work. */
  | { readonly kind: 'retry-on-fallback'; readonly route: PolicyRoute; readonly validators: readonly PolicyValidator[] }
  /** The result was rejected with no fallback route, so the run hands over. */
  | { readonly kind: 'escalate'; readonly condition: 'validator-rejected'; readonly validators: readonly PolicyValidator[] }

/**
 * Decide what a run does with a result its validators rejected.
 *
 * A validator the policy did not declare is not silently accepted, and it is
 * not run either: the policy is the list of checks this run applies, so a check
 * outside it escalates rather than widening the run's own rules.
 * @param policy - the policy the run is admitted under.
 * @param observation - which checks rejected the result.
 * @returns whether the result is used, retried, or handed over.
 */
export function validateAgainst(policy: RoutePolicyRevision, observation: ValidationObservation): ValidationDecision {
  const failed = observation.failedValidators
  if (failed.length === 0) return { kind: 'accepted' }
  const undeclared = failed.some(validator => !policy.validators.includes(validator))
  if (undeclared || policy.fallback === null) {
    return { kind: 'escalate', condition: 'validator-rejected', validators: [...failed] }
  }
  return { kind: 'retry-on-fallback', route: policy.fallback, validators: [...failed] }
}

/** Who takes over when an escalation condition fires. */
export type EscalationOwner =
  /** The user decides; a model cannot settle business intent or confirm a diff. */
  | 'user'
  /** The session itself continues, by re-observing or waiting for a state to settle. */
  | 'session'
  /** A stronger model reviews, which is the remedy for an uncalibrated class. */
  | 'strong-model'

/**
 * The owner of each escalation condition.
 *
 * The map is keyed by the closed {@link PolicyEscalation} union rather than by
 * `string`, so a condition added to the union without an owner is a compile
 * error instead of a runtime hole. A hand-edited record is still filtered by
 * {@link isEscalationList} before it reaches here.
 */
const ESCALATION_OWNERS: Readonly<Record<PolicyEscalation, EscalationOwner>> = {
  'user-confirmation': 'user',
  'route-timeout': 'strong-model',
  'validator-rejected': 'session',
  'unmatched-imagery': 'session',
  'undefined-semantics': 'user',
  'stale-observation': 'session',
}

/**
 * Who takes over when a policy's escalation condition fires.
 *
 * The answer is `undefined` when the policy does not declare the condition: a
 * caller that needs this must state it, because silently assigning an owner to
 * an undeclared condition would let a run hand work to a party that never agreed
 * to take it.
 * @param policy - the policy whose escalation conditions are being read.
 * @param condition - the condition that fired.
 * @returns the condition and its owner, or `undefined` when undeclared.
 */
export function escalationFor(
  policy: RoutePolicyRevision,
  condition: PolicyEscalation,
): { readonly kind: PolicyEscalation; readonly owner: EscalationOwner } | undefined {
  if (!policy.escalation.includes(condition)) return undefined
  return { kind: condition, owner: ESCALATION_OWNERS[condition] }
}

/**
 * Admit one unit of work under a fixed policy revision.
 *
 * The record copies the routes, timeouts, and validators the run is held to, so
 * a later revision of the same policy cannot reach back into a run that was
 * already admitted. The credential *reference* is copied rather than resolved:
 * a repair writes a new value under the same name, which is what leaves this
 * record byte-identical.
 * @param policy - the revision the run is admitted under.
 * @param workId - the run's own opaque identity.
 * @param admittedAt - the admission instant, as epoch milliseconds.
 * @returns the frozen record the run's requests read their ownership from.
 */
export function policyRecord(policy: RoutePolicyRevision, workId: PolicyWorkId, admittedAt: number): PolicyRecord {
  const record: PolicyRecord = {
    workId,
    revision: policy.revision,
    policyId: policy.policyId,
    taskKind: policy.taskKind,
    primary: Object.freeze({ ...policy.primary }),
    fallback: policy.fallback === null ? null : Object.freeze({ ...policy.fallback }),
    timeouts: Object.freeze({ ...policy.timeouts }),
    validators: Object.freeze([...policy.validators]),
    admittedAt,
  }
  return Object.freeze(record)
}

/** Capabilities, validators, and escalations this release routes, by name. */
const POLICY_CAPABILITIES: ReadonlySet<string> = new Set<PolicyCapability>(['text-input', 'image-input', 'tool-update', 'cache-tokens'])
const POLICY_VALIDATORS: ReadonlySet<string> = new Set<PolicyValidator>(['response-schema', 'target-uniqueness', 'evidence-grounding', 'action-authorization'])
const POLICY_ESCALATIONS: ReadonlySet<string> = new Set<PolicyEscalation>(['user-confirmation', 'route-timeout', 'validator-rejected', 'unmatched-imagery', 'undefined-semantics', 'stale-observation'])

/**
 * Whether a stored value is an object a policy's fields can be read from.
 *
 * A policy may be persisted in a hand-edited document, so `null`, a number, and
 * a bare string are all values a key can hold. Reading `version` off one of
 * those is the throw this guard exists to prevent, and it is why every reader
 * below asks it first.
 * @param value - the stored value.
 * @returns true when the value is a non-null object.
 */
function isStoredObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Whether a stored value is the route a policy names.
 *
 * A route with no model is refused: it is the row the catalog stage writes for
 * a provider that registers no model, and a policy naming it would prescribe an
 * outbound request at no model at all. The credential reference is part of the
 * route because a name outside the credential grammar is not one this release
 * can resolve.
 * @param value - the stored route.
 * @returns true when the value names a provider, a model, and a reference or nothing.
 */
function isStoredRoute(value: unknown): value is PolicyRoute {
  if (!isStoredObject(value)) return false
  if (typeof value.provider !== 'string' || value.provider === '') return false
  if (typeof value.model !== 'string' || value.model === '') return false
  if (typeof value.modelVersion !== 'string' && value.modelVersion !== null) return false
  if (value.credentialRef === null) return true
  return typeof value.credentialRef === 'string' && isCredentialRefName(value.credentialRef)
}

/**
 * Read a persisted policy revision, or `undefined` when the stored value is not
 * one this release wrote.
 *
 * A policy read follows the same discipline as a selection read: an unknown
 * version is refused rather than coerced, every field a consumer reads is
 * checked rather than assumed, and the record is rebuilt so a value out of a
 * file is re-branded here and nowhere else. The refusal is fail-closed — a
 * caller holding `undefined` re-issues the policy from live configuration rather
 * than running a run under rules it could not read.
 * @param value - the stored record.
 * @returns the policy revision, or `undefined` when the record is absent or foreign.
 */
export function parseStoredPolicy(value: unknown): RoutePolicyRevision | undefined {
  if (!isStoredObject(value)) return undefined
  if (value.version !== ROUTE_POLICY_VERSION) return undefined
  if (typeof value.policyId !== 'string' || value.policyId === '') return undefined
  if (typeof value.revision !== 'string' || value.revision === '') return undefined
  if (!knownTaskKind(value.taskKind)) return undefined
  if (!isCapabilityList(value.requiredCapabilities)) return undefined
  const profile = requireForKind(value.taskKind)
  const required = value.requiredCapabilities
  if (profile.requiredCapabilities.some(capability => !required.includes(capability))) return undefined
  if (value.taskType !== undefined && value.taskType !== profile.taskType) return undefined
  if (!isStoredRoute(value.primary)) return undefined
  if (value.fallback !== null && !isStoredRoute(value.fallback)) return undefined
  if (typeof value.inputGenerationVersion !== 'string' || value.inputGenerationVersion === '') return undefined
  if (!isStoredTimeouts(value.timeouts)) return undefined
  if (!isValidatorList(value.validators)) return undefined
  if (!isEscalationList(value.escalation)) return undefined
  if (typeof value.effectiveFrom !== 'number' || !Number.isFinite(value.effectiveFrom)) return undefined
  return {
    version: ROUTE_POLICY_VERSION,
    policyId: value.policyId as RoutePolicyId,
    revision: value.revision as PolicyRevisionId,
    taskKind: value.taskKind,
    requiredCapabilities: [...value.requiredCapabilities],
    primary: {
      provider: value.primary.provider,
      model: value.primary.model,
      credentialRef: value.primary.credentialRef === null ? null : credentialRef(value.primary.credentialRef),
      modelVersion: value.primary.modelVersion,
    },
    fallback: value.fallback === null ? null : {
      provider: value.fallback.provider,
      model: value.fallback.model,
      credentialRef: value.fallback.credentialRef === null ? null : credentialRef(value.fallback.credentialRef),
      modelVersion: value.fallback.modelVersion,
    },
    inputGenerationVersion: value.inputGenerationVersion as InputGenerationVersion,
    timeouts: { requestMs: value.timeouts.requestMs, taskMs: value.timeouts.taskMs },
    validators: [...value.validators],
    escalation: [...value.escalation],
    effectiveFrom: value.effectiveFrom,
  }
}

/**
 * Whether a stored value is the capability list a policy declares.
 *
 * The list is checked as a list, because a requirement met by string
 * containment would let `"image-input"` satisfy a requirement of two
 * capabilities. An empty list is legal and is what the deterministic kind
 * carries.
 * @param value - the stored list.
 * @returns true when every member is a capability this release routes.
 */
function isCapabilityList(value: unknown): value is readonly PolicyCapability[] {
  return Array.isArray(value) && value.every(capability => typeof capability === 'string' && POLICY_CAPABILITIES.has(capability))
}

/**
 * Whether a stored value is the deadline record a policy declares.
 *
 * A deadline of zero would expire a request the instant it began, and a
 * whole-task budget below the request budget would expire every request before
 * it could use the budget it was given, so both are refused rather than read as
 * deliberately immediate.
 * @param value - the stored record.
 * @returns true when both deadlines are positive, finite, and ordered.
 */
function isStoredTimeouts(value: unknown): value is PolicyTimeouts {
  if (!isStoredObject(value)) return false
  const { requestMs, taskMs } = value
  if (typeof requestMs !== 'number' || !Number.isFinite(requestMs) || requestMs <= 0) return false
  if (typeof taskMs !== 'number' || !Number.isFinite(taskMs) || taskMs <= 0) return false
  return taskMs > requestMs
}

/**
 * Whether a stored value is the validator list a policy declares.
 * @param value - the stored list.
 * @returns true when every member is a validator this release routes.
 */
function isValidatorList(value: unknown): value is readonly PolicyValidator[] {
  return Array.isArray(value) && value.every(validator => typeof validator === 'string' && POLICY_VALIDATORS.has(validator))
}

/**
 * Whether a stored value is the escalation list a policy declares.
 * @param value - the stored list.
 * @returns true when every member is an escalation this release routes.
 */
function isEscalationList(value: unknown): value is readonly PolicyEscalation[] {
  return Array.isArray(value) && value.every(condition => typeof condition === 'string' && POLICY_ESCALATIONS.has(condition))
}

/** The compile-time marker a branded string carries, used to type a foreign read. */
declare const BRAND: unique symbol

/**
 * Fail on a value a closed union does not contain.
 * @param value - the value that reached the end of an exhaustive switch.
 * @param what - the switch-site label included in the failure message.
 * @returns never; it throws naming the closed union.
 */
/* v8 ignore start -- unreachable without a TypeScript contract violation */
function assertNever(value: never, what: string): never {
  throw new Error(`${what}: ${JSON.stringify(value)}`)
}
/* v8 ignore stop */

/** Re-exported so a caller can stamp a policy's own schema version. */
export type { RoutePolicyVersion }
