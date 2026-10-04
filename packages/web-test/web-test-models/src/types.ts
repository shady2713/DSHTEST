/**
 * The Web testing model-configuration domain: what a first run configures, what a
 * connection test observed, which route each task type may use, and what a
 * credential change interrupted.
 *
 * Every type here is a closed statement about a fact a real request or the stored
 * configuration established. The record a route selection persists names the
 * selection **and** the version and fingerprint it was verified against, because a
 * route that survived a provider, catalog, or credential change has not survived a
 * connection: only a new real request says so.
 *
 * Nothing in this module carries a credential value. A route names the
 * `CredentialRef` its provider profile resolves keys through, and the surfaces
 * above it read `CredentialInfo`, which has no value slot.
 *
 * @module @deepseek-ai/dsh-web-test-models/types
 */

import type { LlmFailure, LlmResolvedModelInfo, ModelModality } from '@deepseek-ai/dsh-llm/types'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials/types'
import type { ModelTaskType } from './task.ts'
import type { RouteFingerprint, RouteSelectionVersion } from './identity.ts'
import type {
  InputGenerationVersion, PolicyRevisionId, PolicyWorkId, RoutePolicyId, RoutePolicyVersion,
} from './identity.ts'

/**
 * One provider route a task type may run on: the exact pair `ctx.llm.stream`
 * addresses, plus the reference its provider profile resolves keys through.
 *
 * The credential reference is the *name* only. It travels so a credential change
 * can be attributed to the work it affects; a value never rides with it.
 */
export interface ModelRoute {
  /** Provider route key passed as `GenerateOptions.provider`. */
  readonly provider: string
  /** Exact model id passed as `GenerateOptions.model`. */
  readonly model: string
  /** Credential reference this route's provider profile resolves keys through, when it has one. */
  readonly credentialRef: CredentialRef | null
}

/**
 * What one real request proved about a route.
 *
 * The failure tags are separate because the next action differs for each: a
 * wrong key is corrected, an unavailable model is re-chosen, a request that has
 * to change is changed, a modality mismatch needs a different capability, an
 * exhausted quota needs billing, and a transient failure needs a retry.
 * `transient` and `exhausted` are deliberately not one tag — "try again" and
 * "pay" are different instructions, and a request that overflows a context
 * window is deliberately not `transient` either, because repeating it overflows
 * again.
 */
export type ConnectionVerdict =
  /** The provider answered the probe with assistant content on the addressed route. */
  | { readonly kind: 'ready'; readonly detail: string }
  /**
   * The reference resolved to a value the provider refused: credential wording at
   * any status, a `401`, a `403`, or any other `4xx` whose body refuses the caller
   * without naming a model.
   */
  | { readonly kind: 'rejected-credential'; readonly failure: LlmFailure }
  /** The provider does not serve the addressed model on this route. */
  | { readonly kind: 'rejected-model'; readonly failure: LlmFailure }
  /** The route accepted the request but cannot carry the modality the task needs. */
  | { readonly kind: 'rejected-modality'; readonly failure: LlmFailure }
  /**
   * The request has to change before it can succeed: it does not fit the
   * addressed model, as when it exceeds the context window, or the provider
   * refused it as sent without naming a model, a reference, an account, or a
   * modality in the body.
   */
  | { readonly kind: 'rejected-request'; readonly failure: LlmFailure }
  /**
   * A failure a later identical request may not repeat: a transport fault, a
   * `5xx`, a status whose own name asks for a later attempt, or a body this
   * release cannot read. Never a `4xx` the provider answered as a refusal, because
   * a request it has already refused is refused the same way again.
   */
  | { readonly kind: 'transient'; readonly failure: LlmFailure }
  /** The account's quota, balance, or credit is spent; retrying the same key cannot help. */
  | { readonly kind: 'exhausted'; readonly failure: LlmFailure }

/** What the adapter itself declared for a route, plus what the probe observed. */
export interface RouteCapabilities {
  /**
   * Input modalities the owning adapter declares. `null` means the adapter
   * declared nothing, which is not the same as a text-only route: an unknown
   * modality never satisfies {@link selectRoute}'s image requirement.
   */
  readonly inputModalities: readonly ModelModality[] | null
  /** How the model applies a tool declaration added mid-conversation; absent redeclares the whole list. */
  readonly toolUpdate: LlmResolvedModelInfo['toolUpdate']
  /**
   * Whether the probe's real response reported prompt-cache token counts.
   *
   * This is an observed per-route fact, not a provider trait: a route that
   * returned no cache fields is recorded as having none, so no consumer reads a
   * uniform caching benefit out of a provider name.
   */
  readonly reportedCacheTokens: boolean
}

/** One connection test's whole result, ready to render or persist. */
export interface ConnectionReport {
  /** The exact route the request addressed. */
  readonly route: ModelRoute
  /** The task type whose capability requirement the request carried. */
  readonly taskType: ModelTaskType
  /** What the request proved. */
  readonly verdict: ConnectionVerdict
  /** What the adapter declared, present only for a `ready` verdict. */
  readonly capabilities: RouteCapabilities | null
  /** The provider's own opaque request id, for a diagnostic the user can quote. */
  readonly requestId: string | null
}

/**
 * One task type's route decision.
 *
 * A decision is `ready` only when it carries a {@link Selection} whose
 * `fingerprint` still matches the live provider directory and catalog, because
 * appearing in a catalog is not a connection and a capability pass. Every other
 * case names why, and an absent capability is never guessed around.
 */
export type TaskRoute =
  | {
    /** A route verified by a real request whose inputs still match that verification. */
    readonly kind: 'ready'
    /** The route this task type runs on. */
    readonly selection: RouteSelection
  }
  | {
    /** No route may serve this task type right now. */
    readonly kind: 'not-ready'
    /** Closed reason the route is not usable; a new reason extends this union. */
    readonly reason: NotReadyReason
    /** Safe closed diagnostic; provider response strings are discarded. */
    readonly detail: string
    /** Routes that were rejected and why, so the surface can name the closest option. */
    readonly rejected: readonly RouteRejection[]
  }

/**
 * Closed reasons a task type has no usable route.
 *
 * A credential change is not one of them. It parks a *ticket*, which keeps its
 * own route and its own lifecycle and is read through
 * {@link WebTestModels.waitingWork} and {@link WebTestModels.resumeWork}; it does
 * not decide a task type's route, because a stored selection is bound to the
 * credential *reference* it names and a new value under that reference moves
 * neither the reference nor the declaration. A member nothing can return would
 * be a promise this union does not keep.
 */
export type NotReadyReason =
  /** No provider is configured at all, so there is nothing to test. */
  | 'no-provider-configured'
  /** A route answered a real request, and the answer was not usable. */
  | 'connection-failed'
  /**
   * No configured route declares the modality this task needs. The surface stays
   * not ready rather than substituting a text-only route for image work.
   */
  | 'capability-absent'
  /**
   * A previous selection exists but its provider, catalog, credential, or
   * recorded capabilities are no longer what the live composition declares.
   */
  | 'reverification-required'

/** Why one candidate route was not chosen. */
export interface RouteRejection {
  /** The candidate that was tested or skipped. */
  readonly route: ModelRoute
  /** Closed reason it was skipped or refused. */
  readonly reason: Exclude<NotReadyReason, 'no-provider-configured'>
  /** What the real request or the catalog said. */
  readonly detail: string
}

/** A selected route with the version and fingerprint its verification was taken against. */
export interface RouteSelection {
  /** Schema version of the persisted selection record this shape belongs to. */
  readonly version: RouteSelectionVersion
  /** The task type the selection was made for. */
  readonly taskType: ModelTaskType
  /** The chosen provider and model. */
  readonly route: ModelRoute
  /**
   * Digest over the provider directory entry, the adapter's declared model
   * metadata, and the route's credential reference. A selection whose live
   * fingerprint differs must be re-verified by a real request before it is ready.
   */
  readonly fingerprint: RouteFingerprint
  /** What the adapter declared and the probe observed, recorded with the choice. */
  readonly capabilities: RouteCapabilities
  /** When the real request that verified this selection completed, as epoch milliseconds. */
  readonly verifiedAt: number
}

/** Lifecycle of one unit of work the routing authority is holding open. */
export type WorkState =
  /** The work is running on the route it was pinned to. */
  | 'running'
  /** A credential change interrupted it; the work is retained and awaits re-verification. */
  | 'waiting'
  /** The work finished; the ticket is retained only until the caller reports it. */
  | 'settled'

/** Why a ticket moved into {@link WorkState} `waiting`. */
export type ParkReason =
  /** The reference the pinned route resolves keys through was written a new value. */
  | 'credential-replaced'
  /** The reference the pinned route resolves keys through no longer resolves. */
  | 'credential-removed'

/**
 * One unit of work pinned to the route it started on.
 *
 * The pin is what makes "no silent model switch" checkable: a parked ticket
 * carries the route it was pinned to, and the service's `resumeWork`
 * re-verifies *that* route rather than re-selecting one.
 */
export interface WorkTicket {
  /** Opaque identity the caller resumes by. */
  readonly workId: string
  /** The task type the work was admitted for. */
  readonly taskType: ModelTaskType
  /** The route the work was pinned to and will return to; never re-selected. */
  readonly route: ModelRoute
  /** Current lifecycle state. */
  readonly state: WorkState
  /** Why the work is waiting, when it is. */
  readonly parkReason: ParkReason | null
  /** When the work entered `waiting`, as epoch milliseconds. */
  readonly parkedAt: number | null
  /** The reference whose change interrupted the work, when one did. */
  readonly interruptedBy: CredentialRef | null
}

/** What {@link WebTestModels.resumeWork} could establish about a parked ticket. */
export type ResumeOutcome =
  /** A real request answered on the ticket's pinned route; the work may continue there. */
  | { readonly kind: 'resumed'; readonly selection: RouteSelection }
  /** The pinned route could not be re-verified; the ticket stays parked on that same route. */
  | { readonly kind: 'still-waiting'; readonly detail: string; readonly verdict: ConnectionVerdict | null }

/** Options one caller states when asking for a task type's route. */
export interface SelectRouteOptions {
  /** The task type to route. */
  readonly taskType: ModelTaskType
  /**
   * Whether the caller accepts a re-verification request for an existing
   * selection. A caller that does not is told {@link NotReadyReason}
   * `reverification-required` instead of paying for a real request.
   */
  readonly reverify: boolean
}

/**
 * The work kinds a Web testing session routes, which are finer than the three
 * {@link ModelTaskType}s this package routes on.
 *
 * The kinds answer "what is being asked of the route", while a task type
 * answers "which modality must the route declare". Several kinds therefore
 * share one task type, and `exact-value` needs no model route at all.
 */
export type PolicyTaskKind =
  /** Reading requirements, planning cases, or assessing a change's impact. */
  | 'requirements'
  /** Choosing among action candidates, or classifying what a page currently is. */
  | 'candidate-selection'
  /** Inspecting imagery, or grounding a coordinate to something on the page. */
  | 'visual-inspection'
  /** Reading an exact value, a file's content, or checking a number. */
  | 'exact-value'
  /** Explaining a defect, or summarizing committed evidence. */
  | 'defect-explanation'
  /** Drafting a skill, which a user confirms before it is adopted. */
  | 'skill-draft'

/**
 * What a route must be able to do before a policy may send work to it.
 *
 * Each member names one thing the adapter declares or a real request observed,
 * so a route either satisfies it or is refused: a route whose adapter declared
 * no modality is not a text-only route, and a route that reported no cache
 * tokens is not one with cheaper cache reads.
 */
export type PolicyCapability =
  /** The adapter declared text input. */
  | 'text-input'
  /** The adapter declared image input. */
  | 'image-input'
  /** The adapter declared how it applies a mid-conversation tool declaration. */
  | 'tool-update'
  /** A real response on this route reported prompt-cache token counts. */
  | 'cache-tokens'

/** The checks a policy applies to a model's result before the result is used. */
export type PolicyValidator =
  /** The result is a well-formed response carrying the fields the caller reads. */
  | 'response-schema'
  /** Exactly one candidate matches; an ambiguous match is not a chosen one. */
  | 'target-uniqueness'
  /** Every claim is traceable to an observation this policy's generation admitted. */
  | 'evidence-grounding'
  /** The chosen action is one the caller authorized, not merely the most confident. */
  | 'action-authorization'

/**
 * A condition under which the run stops deciding and someone else takes over.
 *
 * Each member names a fact rather than a feeling, so a surface can say which
 * condition fired and who owns it instead of reporting a general failure.
 */
export type PolicyEscalation =
  /** A source or rule conflicts, and a model cannot decide the business intent. */
  | 'user-confirmation'
  /** The route timed out and no fallback route is available. */
  | 'route-timeout'
  /** A validator rejected the result and no fallback route is available. */
  | 'validator-rejected'
  /** The imagery is unclear, or cannot be matched to a target. */
  | 'unmatched-imagery'
  /** The exact value's semantics are undefined, and asking beats guessing. */
  | 'undefined-semantics'
  /** The page state changed, so the prior decision no longer describes it. */
  | 'stale-observation'

/** The exact provider pair, credential reference, and model version a policy names. */
export interface PolicyRoute {
  /** Provider route key the request is addressed with. */
  readonly provider: string
  /** Exact model id the request is addressed with. */
  readonly model: string
  /** Credential reference this route resolves keys through, when it has one. */
  readonly credentialRef: CredentialRef | null
  /**
   * The exact model version the policy pins for this route, or `null` when the
   * alias drifts. A null pin forbids reusing a cached model result across
   * requests, because a version seen in a previous response does not establish
   * that the alias still points at it.
   */
  readonly modelVersion: string | null
}

/** How long a policy's requests and its whole run may take. */
export interface PolicyTimeouts {
  /** Milliseconds one request may take before it is a recoverable timeout. */
  readonly requestMs: number
  /** Milliseconds the whole run may take before it escalates. */
  readonly taskMs: number
}

/**
 * One task kind's fixed routing rules.
 *
 * A policy is a *rule set*, where a {@link RouteSelection} is a *verified fact*.
 * The selection says a route answered; the policy says which route this kind of
 * work runs on, what it falls back to, how long it may take, what must validate
 * its output, and when it stops and escalates. Both are needed: a rule set with
 * no verification is unproven, and a verification with no rule set says nothing
 * about the next task of the same kind.
 *
 * Every field is `readonly` because a run pins the revision it started under
 * and a model or capability change issues a **new** revision rather than
 * rewriting this one. A policy that could be edited in place would make
 * "already-sent requests keep their routeRevision" unfalsifiable.
 */
export interface RoutePolicyRevision {
  /** Schema version of the persisted policy record this shape belongs to. */
  readonly version: RoutePolicyVersion
  /** Identity this policy keeps across every revision issued under it. */
  readonly policyId: RoutePolicyId
  /** Identity of this one revision; a change of models or capabilities issues another. */
  readonly revision: PolicyRevisionId
  /** The work kind these rules are for. */
  readonly taskKind: PolicyTaskKind
  /**
   * What the route must be able to do. A route that does not satisfy all of
   * them is refused rather than downgraded, because a silent fall back to a
   * weaker route is the failure this field exists to prevent.
   */
  readonly requiredCapabilities: readonly PolicyCapability[]
  /** The route this kind runs on. */
  readonly primary: PolicyRoute
  /** The route this kind falls back to when the primary cannot serve it, when there is one. */
  readonly fallback: PolicyRoute | null
  /** Version of the input generation that produced this run's inputs. */
  readonly inputGenerationVersion: InputGenerationVersion
  /** How long a request and the whole run may take. */
  readonly timeouts: PolicyTimeouts
  /** The checks a result must pass before it is used. */
  readonly validators: readonly PolicyValidator[]
  /** The conditions under which the run stops and someone else takes over. */
  readonly escalation: readonly PolicyEscalation[]
  /** When this revision took effect, as epoch milliseconds. */
  readonly effectiveFrom: number
}

/**
 * One unit of work admitted under a fixed policy revision.
 *
 * This is the record that makes the three immutability obligations checkable: a
 * run references the revision it was admitted under, a credential repair
 * changes the value behind a reference without touching this record, and a
 * request already sent reads its `routeRevision` and result owner from here
 * rather than from whichever revision is current.
 */
export interface PolicyRecord {
  /** Opaque identity of the run. */
  readonly workId: PolicyWorkId
  /** The revision this run was admitted under; never rewritten. */
  readonly revision: PolicyRevisionId
  /** The policy identity that revision belongs to. */
  readonly policyId: RoutePolicyId
  /** The work kind this run was admitted for. */
  readonly taskKind: PolicyTaskKind
  /** The route this run is pinned to. */
  readonly primary: PolicyRoute
  /** The route this run falls back to, when it has one. */
  readonly fallback: PolicyRoute | null
  /** How long a request and the whole run may take. */
  readonly timeouts: PolicyTimeouts
  /** The checks a result must pass before it is used. */
  readonly validators: readonly PolicyValidator[]
  /** When this run was admitted, as epoch milliseconds. */
  readonly admittedAt: number
}
