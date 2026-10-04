/**
 * Choosing the route one task type may run on, and refusing when none may.
 *
 * Selection is capability-matched, not preference-ranked: a candidate has to
 * declare the modality the task type requires before it is probed at all, and a
 * route is ready only after a **real** request answered on it. A candidate
 * appearing in a provider's catalog is what makes it a candidate; it is not a
 * connection, and it is not a capability pass.
 *
 * The order is deterministic — provider id, then model id, then the task type's
 * own declaration order — so two runs over the same directory propose the same
 * first choice and a captured walk is reproducible.
 *
 * @module @deepseek-ai/dsh-web-test-models/routing
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials/types'
import type { LlmConfigurableProvider, LlmResolvedModelInfo, ModelModality } from '@deepseek-ai/dsh-llm/types'
import { describeVerdict } from './classify.ts'
import { satisfiesModality } from './fingerprint.ts'
import { ROUTE_SELECTION_VERSION } from './identity.ts'
import { maySubstitute, requiredModality } from './task.ts'
import type { ModelTaskType } from './task.ts'
import type {
  ConnectionReport, ModelRoute, RouteCapabilities, RouteRejection, RouteSelection, TaskRoute,
} from './types.ts'

/** One route that has passed the catalog stage and may be probed. */
export interface RouteCandidate {
  /** The exact provider, model, and credential reference to address. */
  readonly route: ModelRoute
  /** The provider directory entry configuring the route, when configuration declared one. */
  readonly entry: LlmConfigurableProvider | undefined
  /** The owning adapter's declaration for the exact model. */
  readonly model: LlmResolvedModelInfo
}

/** What the catalog stage produced before any request was sent. */
export interface CandidateSet {
  /** Routes that declare the task's modality, in deterministic probe order. */
  readonly candidates: readonly RouteCandidate[]
  /** Routes the catalog stage already ruled out, with the reason. */
  readonly rejections: readonly RouteRejection[]
  /** The modality the task type required. */
  readonly required: ModelModality
}


/**
 * Build the probe order and the rejections for one task type.
 *
 * A route is rejected before any request is sent only for a reason a local read
 * establishes: no configured provider at all, or an adapter that declares no
 * model for it. Everything else is a real request's business.
 * @param directory - the live configurable-provider entries.
 * @param catalogs - the adapter's declared models, keyed by provider.
 * @param taskType - the task type being routed.
 * @param referenceFor - reads the credential reference a provider's stored profile names.
 * @returns the candidates to probe and the rejections already established.
 */
export function candidateSet(
  directory: readonly LlmConfigurableProvider[],
  catalogs: ReadonlyMap<string, readonly LlmResolvedModelInfo[]>,
  taskType: ModelTaskType,
  referenceFor: (provider: string) => CredentialRef | null = () => null,
): CandidateSet {
  const required = requiredModality(taskType)
  const rejections: RouteRejection[] = []
  const candidates: RouteCandidate[] = []
  const providers = [...directory].sort((left, right) => (left.provider < right.provider ? -1 : left.provider > right.provider ? 1 : 0))
  for (const entry of providers) {
    const reference = referenceFor(entry.provider)
    const models = [...(catalogs.get(entry.provider) ?? [])].sort(
      (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    if (models.length === 0) {
      rejections.push({
        route: { provider: entry.provider, model: '', credentialRef: reference },
        reason: 'connection-failed',
        detail: `the adapter registers ${entry.provider} but declares no model for it`,
      })
      continue
    }
    for (const model of models) {
      const route: ModelRoute = { provider: entry.provider, model: model.id, credentialRef: reference }
      // The requirement is settled against the declaration, before a request:
      // an adapter that declared no modalities, or declared text only where the
      // task needs an image, is not a candidate and never costs a request.
      const declared = {
        inputModalities: model.inputModalities ?? null,
        toolUpdate: model.toolUpdate,
        reportedCacheTokens: false,
      }
      if (!satisfiesModality(declared, required)) {
        rejections.push({
          route,
          reason: 'capability-absent',
          detail: required === 'image'
            ? `the adapter declares no image input for ${entry.provider}/${model.id}`
            : `the adapter declares no text input for ${entry.provider}/${model.id}`,
        })
        continue
      }
      candidates.push({ route, entry, model })
    }
  }
  return { candidates, rejections, required }
}

/** What one probe attempt contributed to the decision. */
export interface AttemptOutcome {
  /** The candidate the request addressed. */
  readonly candidate: RouteCandidate
  /** The real request's report. */
  readonly report: ConnectionReport
}

/** What the selection step needs from a caller that owns the real request. */
export interface SelectionContext {
  /** Candidates in deterministic probe order. */
  readonly candidates: readonly RouteCandidate[]
  /** Rejections the catalog stage already established. */
  readonly rejections: readonly RouteRejection[]
  /** The task type being routed. */
  readonly taskType: ModelTaskType
  /**
   * Run the real connection test for one candidate. It never returns `null`:
   * an adapter that cannot resolve its own model is a real refusal, and the
   * caller reports it as a classified one rather than leaving a silent skip.
   */
  readonly attempt: (candidate: RouteCandidate) => Promise<ConnectionReport>
  /** Clock reading the verification instant, so the record is reproducible in tests. */
  readonly now: () => number
  /** Persist one selection, or resolve `false` when the store refused it. */
  readonly persist: (selection: RouteSelection) => Promise<boolean>
  /**
   * Digest the route a verified selection is bound to, taken from the adapter's own
   * resolved metadata, or `null` when that read no longer resolves the route.
   *
   * `null` is a distinct answer rather than an error because the two are reported
   * differently: a route whose digest cannot be read has nothing to bind a
   * verification to, and reporting that as a refusal to plan would hide a route
   * that really did answer.
   */
  readonly fingerprintOf: (candidate: RouteCandidate) => Promise<RouteSelection['fingerprint'] | null>
}

/**
 * Probe candidates in order and return the first route a real request verified.
 *
 * The first `ready` report wins and no other candidate is probed: a connection
 * test costs a real request, and the order is deterministic, so "first ready" is
 * a reproducible answer rather than a race.
 *
 * A verified candidate whose digest cannot be read is not a selection and the walk
 * ends there rather than continuing: the route answered, so recording a rejection
 * for it would misreport what the request proved, and continuing would spend more
 * requests on a route whose inputs are already known to have moved.
 *
 * When nothing is ready the reason is what a real request refused, and a refusal
 * outranks a missing capability: a key the operator can replace or a model they
 * can re-choose is a fixable instruction, while `capability-absent` names the
 * absence nothing about this deployment changed. `capability-absent` is the
 * reason only when no candidate was probed at all. The detail above that reason
 * is derived from the rows themselves, so a mixed decision names both blockers
 * instead of claiming a route was tested that never was.
 * @param context - the candidate set, the real attempt, the clock, and the store.
 * @returns the ready selection, or the not-ready record naming why.
 */
export async function planRoute(context: SelectionContext): Promise<TaskRoute> {
  const rejections: RouteRejection[] = [...context.rejections]
  let sawRefusal = false
  for (const candidate of context.candidates) {
    const report = await context.attempt(candidate)
    if (report.verdict.kind === 'ready') {
      const capabilities: RouteCapabilities | null = report.capabilities
      /* v8 ignore next -- a ready report always carries the record probe.ts attaches with it */
      if (capabilities === null) continue
      const fingerprint = await context.fingerprintOf(candidate)
      if (fingerprint === null) {
        // The route answered and the composition can no longer resolve it, so a
        // verification is earned with nothing to bind it to. Recording one anyway
        // would forge the digest, so the decision is not ready and names why.
        return {
          kind: 'not-ready',
          reason: 'reverification-required',
          detail: `${candidate.route.provider}/${candidate.route.model} answered a real request but the composition can no longer resolve that route, so this verification cannot be bound to it`,
          rejected: rejections,
        }
      }
      const selection: RouteSelection = {
        version: ROUTE_SELECTION_VERSION,
        taskType: context.taskType,
        route: candidate.route,
        fingerprint,
        capabilities,
        verifiedAt: context.now(),
      }
      const stored = await context.persist(selection)
      if (!stored) {
        return {
          kind: 'not-ready',
          reason: 'reverification-required',
          detail: `the selection for ${candidate.route.provider}/${candidate.route.model} was verified but the store refused it`,
          rejected: rejections,
        }
      }
      return { kind: 'ready', selection }
    }
    sawRefusal = true
    rejections.push({
      route: candidate.route,
      reason: 'connection-failed',
      detail: describeVerdict(report.verdict),
    })
  }
  if (!sawRefusal) {
    return {
      kind: 'not-ready',
      reason: 'capability-absent',
      detail: `no configured provider declares the ${requiredModality(context.taskType)} modality this task needs`,
      rejected: rejections,
    }
  }
  return {
    kind: 'not-ready',
    reason: 'connection-failed',
    detail: refusedDetail(context.taskType, rejections),
    rejected: rejections,
  }
}

/**
 * The one line a surface renders above the per-route rows.
 *
 * A candidate that was ruled out before a request was spent never failed a
 * connection test, so the top line names the two populations separately: what
 * the probed routes did, and how many other routes were ruled out for a missing
 * capability. Naming only the refusals would be false in a mixed decision, and
 * naming only the capability would hide the refusal a caller can act on.
 * @param taskType - the task type being routed.
 * @param rejections - every row the decision carries, catalog-stage and probed alike.
 * @returns the top line, which never claims a route was tested that was not.
 */
function refusedDetail(taskType: ModelTaskType, rejections: readonly RouteRejection[]): string {
  const absent = rejections.filter(rejection => rejection.reason === 'capability-absent').length
  const probed = `every candidate route for ${taskType} that was probed failed a real connection test`
  if (absent === 0) return probed
  return `${probed}, and ${String(absent)} other route${absent === 1 ? ' was' : 's were'} ruled out for a missing capability`
}

/**
 * Whether a verified selection may serve a different task type.
 *
 * The substitution is only offered when {@link maySubstitute} allows it, so a
 * vision selection is never handed to a text task and a text selection is never
 * handed to a vision task.
 * @param selection - the verified selection.
 * @param taskType - the task type that wants to use it.
 * @returns true when the selection's route satisfies the task's requirement.
 */
export function selectionServes(selection: RouteSelection, taskType: ModelTaskType): boolean {
  return maySubstitute(selection.taskType, taskType)
    && satisfiesModality(selection.capabilities, requiredModality(taskType))
}

/**
 * Allocate the identity one unit of work is admitted, resumed, and settled by.
 *
 * The identity names the route and the task type, so a ticket is readable, and
 * carries the caller's unit ordinal, so two units of work admitted for the same
 * route and task type stay two units: one settling the other's ticket would
 * report a finished unit as still running and park the wrong work on a
 * credential change.
 * @param route - the exact route the work is pinned to.
 * @param taskType - the task type the work is for.
 * @param unit - the caller's ordinal for this unit among those on the same route and task type.
 * @returns the identity the caller resumes and settles by.
 */
export function workIdOf(route: ModelRoute, taskType: ModelTaskType, unit: number): string {
  return brandString(`webtest-work:${unit}:${taskType}:${route.provider}/${route.model}`)
}
