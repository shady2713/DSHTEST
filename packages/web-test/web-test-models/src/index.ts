/**
 * First-run model configuration and capability routing over official LLM,
 * settings, and credential services. Ready routes require actual input probes
 * and durable selection writes. Policy admission pins immutable revisions;
 * credential changes park their work without changing its route.
 * Provider failures are classified privately; only safe closed diagnostics leave
 * this package. Credential values are resolved exclusively by the provider.
 * @module @deepseek-ai/dsh-web-test-models
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { createSettingsModelStore } from './settings-store.ts'
import { parseStoredPolicy, policyRecord, requireForKind, satisfiesPolicy } from './policy.ts'
import type { PolicyRecord, PolicyTaskKind, RoutePolicyRevision } from './types.ts'
import type { PolicyWorkId } from './identity.ts'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type { LlmConfigurableProvider, LlmResolvedModelInfo, ModelModality } from '@deepseek-ai/dsh-llm/types'
import type { CredentialInfo, CredentialRef } from '@deepseek-ai/dsh-credentials/types'
import { classifyFailure, describeVerdict } from './classify.ts'
import { declaredModalities, isModelModality, satisfiesModality, routeFingerprint, sameDeclaredModalities } from './fingerprint.ts'
import { isRouteFingerprint, ROUTE_SELECTION_VERSION } from './identity.ts'
import type { RouteFingerprint } from './identity.ts'
import { connectionReport, declaredModel, entryFor, probeRoute } from './probe.ts'
import { candidateSet, planRoute, selectionServes, workIdOf } from './routing.ts'
import { MODEL_TASK_TYPES, requiredModality } from './task.ts'
import type { ModelTaskType } from './task.ts'
import type {
  ConnectionReport, ModelRoute, NotReadyReason, ResumeOutcome, RouteCapabilities, RouteSelection, TaskRoute, WorkTicket,
} from './types.ts'
import { WorkRegistry } from './wait.ts'

export { classifyFailure, describeVerdict } from './classify.ts'
export {
  declaredModalities, isModelModality, probeFingerprint, routeCapabilities, routeFingerprint, sameDeclaredModalities,
  satisfiesModality,
} from './fingerprint.ts'
export {
  isProbeFingerprint, isRouteFingerprint, PROBE_FINGERPRINT_PATTERN, ROUTE_FINGERPRINT_PATTERN,
  ROUTE_POLICY_VERSION, ROUTE_SELECTION_VERSION,
} from './identity.ts'
export type {
  InputGenerationVersion, PolicyRevisionId, PolicyWorkId, ProbeFingerprint, RouteFingerprint,
  RoutePolicyId, RoutePolicyVersion, RouteSelectionVersion,
} from './identity.ts'
export {
  capabilityCheck, classifyDeadline, deadlineDecision, escalationFor, knownTaskKind, parseStoredPolicy,
  POLICIES, POLICY_KINDS, policyRecord, requireForKind, satisfiesPolicy, validateAgainst,
} from './policy.ts'
export type {
  CapabilityCheck, DeadlineDecision, DeadlineObservation, DeadlineState, EscalationOwner,
  PolicyKindProfile, ValidationDecision, ValidationObservation,
} from './policy.ts'
export {
  connectionReport, declaredModel, describeReport, entryFor, PROBE_MAX_TOKENS, PROBE_PROMPT, probeRoute,
} from './probe.ts'
export type { ProbeObservation } from './probe.ts'
export { candidateSet, planRoute, selectionServes, workIdOf } from './routing.ts'
export type { AttemptOutcome, CandidateSet, RouteCandidate, SelectionContext } from './routing.ts'
export { maySubstitute, MODEL_TASK_TYPES, requiredModality } from './task.ts'
export type { ModelTaskType, ModelTaskTypeMap } from './task.ts'
export { pinnedReference, WorkRegistry } from './wait.ts'
export type { AdmitWork } from './wait.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTestModels: WebTestModels
  }
}

/** How the service reads its one deployment-varying choice: the verification window. */
export interface WebTestModelsConfig {
  /** Milliseconds a stored selection stays verifiable after its recorded instant. */
  verificationTtlMs: number
  /** Persisted JSON records, parsed strictly before use. */
  selections?: import('@deepseek-ai/cordis').Volatile<Record<string, unknown>>
  /** Append-only policy revisions, parsed strictly before use. */
  policies?: import('@deepseek-ai/cordis').Volatile<Record<string, unknown>>
}

/** Schemastery validator for {@link WebTestModelsConfig}. */
export const WebTestModelsConfig: z<WebTestModelsConfig> = z.object({
  verificationTtlMs: z.natural().required(),
  selections: z.dict(z.any()).default({}).volatile(),
  policies: z.dict(z.any()).default({}).volatile(),
})

/** One stored selection plus the revision it was read at. */
export interface StoredSelections {
  /** The revision the settings namespace stood at when these were read. */
  readonly revision: number
  /** One verified selection per task type. */
  readonly byTask: Readonly<Partial<Record<ModelTaskType, RouteSelection>>>
}

/** What one read of the durable store yielded, for the route decision built on it. */
interface ReadSelections {
  /** The stored selections this release can read, keyed by the task type they were stored under. */
  readonly byTask: Partial<Record<ModelTaskType, RouteSelection>>
  /** Per task type, why a stored record was not read as a selection. */
  readonly refused: ReadonlyMap<ModelTaskType, string>
}

/** What the live composition still says about one route. */
interface LiveRoute {
  /** The digest a stored record about that route has to still match. */
  readonly fingerprint: RouteFingerprint
  /** The modalities the owning adapter declares, or `null` when it declares none. */
  readonly modalities: readonly ModelModality[] | null
}

/** What the service hands a caller that wants to configure a provider. */
export interface ProviderSurvey {
  /** The provider routes the live directory declares. */
  readonly providers: readonly LlmConfigurableProvider[]
  /** Per task type, the route decision as it stands right now. */
  readonly routes: Readonly<Record<ModelTaskType, TaskRoute>>
}

/**
 * The Web testing model-configuration authority.
 *
 * It mounts over the LLM runtime and the credentials service, owns the durable
 * selection record, and holds the recoverable wait. It never stores a credential:
 * the only credential fact it reads is whether a reference still resolves.
 */
export class WebTestModels extends Service {
  static inject = ['llm', 'credentials']

  static Config: z<WebTestModelsConfig> = WebTestModelsConfig

  /** The validated configuration this instance was mounted with. */
  readonly config: WebTestModelsConfig

  /** Durable store for the verified selection per task type. */
  selections: SelectionStore | undefined

  /** Reader for the credential reference each provider's stored profile names. */
  references: ReferenceSource | undefined

  private readonly works = new WorkRegistry()

  /** Trusted application-owned image admitted through the official attachment service for vision probes. */
  probeImage: import('@deepseek-ai/dsh-attachment').ImageAttachmentRef | undefined

  private readonly changedReferences = new Map<CredentialRef, Set<ModelTaskType>>()

  private credentialEpoch = 0

  private readonly verifiedSelections = new Map<ModelTaskType, string>()

  private admitted = 0

  private policyStore: PolicyStore | undefined

  /**
   * @param ctx - context of the Runtime plugin; the effect registrations attach here.
   * @param config - validated configuration naming the verification window.
   */
  constructor(ctx: Context, config: WebTestModelsConfig) {
    super(ctx, 'webTestModels')
    this.config = config
    ctx.inject(['settings'], (injected) => {
      const namespace = ctx.fiber.entry?.options.id
      if (namespace === undefined) throw new Error('web-test/models: official settings require a Loader entry id')
      const store = createSettingsModelStore(injected.settings, namespace, () => this.listProviders())
      this.selections = store
      this.references = store
      this.policyStore = store
    })
    ctx.effect(() => {
      // A credential write is the only event that can invalidate a pinned route
      // without a catalog change, and every observed consumer of it merely
      // refreshes a view. Parking the work it interrupts is this service's own
      // contribution; the view refresh above it is unchanged.
      return ctx.on('credentials/reference-updated', (ref: CredentialRef) => {
        this.credentialEpoch += 1
        this.changedReferences.set(ref, new Set(MODEL_TASK_TYPES))
        void this.describeCredential(ref).then((info) => {
          this.works.parkForReference(ref, info?.configured === true, Date.now())
        })
      })
    }, 'webTestModels.credentialChange')
  }

  /**
   * Read the latest persisted revision of a model task policy.
   * @param kind - task kind; exact-value never dispatches a model.
   * @returns a detached policy revision, absent when none was configured.
   */
  async getPolicy(kind: PolicyTaskKind): Promise<RoutePolicyRevision | undefined> {
    if (requireForKind(kind).taskType === null) return undefined
    if (this.policyStore === undefined) throw new Error('web-test/models: no durable policy store is mounted')
    const revisions = await this.policyStore.readPolicies()
    let selected: RoutePolicyRevision | undefined
    for (const raw of Object.values(revisions)) {
      const policy = parseStoredPolicy(raw)
      if (policy === undefined) throw new Error('web-test/models: unreadable persisted policy revision')
      if (policy.taskKind === kind && (selected === undefined || policy.effectiveFrom > selected.effectiveFrom)) selected = policy
    }
    return selected
  }

  /**
   * Verify primary and fallback routes, then append a new policy revision.
   * @param input - validated policy inputs from the configuration caller.
   * @param signal - caller cancellation for capability probes.
   * @returns the independently owned persisted revision.
   */
  async issuePolicy(input: RoutePolicyRevision, signal?: AbortSignal): Promise<RoutePolicyRevision> {
    const policy = parseStoredPolicy(input)
    if (policy === undefined) throw new Error('web-test/models: invalid route policy')
    const taskType = requireForKind(policy.taskKind).taskType
    if (taskType === null) throw new Error('web-test/models: exact-value has no model route')
    for (const route of [policy.primary, ...(policy.fallback === null ? [] : [policy.fallback])]) {
      const report = await this.report(route, taskType, signal)
      if (report.verdict.kind !== 'ready' || report.capabilities === null || !satisfiesPolicy(policy, report.capabilities).ok) {
        throw new Error('web-test/models: policy route did not verify every required capability')
      }
    }
    if (this.policyStore === undefined) throw new Error('web-test/models: no durable policy store is mounted')
    await this.policyStore.putPolicy(policy)
    return policy
  }

  /**
   * Admit work under its persisted revision and exact verified primary route.
   * @param kind - model task kind; deterministic work is refused here.
   * @param workId - caller-owned identity of this work.
   * @param signal - caller cancellation for the probe.
   * @returns immutable result ownership and a recoverable work ticket.
   */
  async admitPolicy(
    kind: PolicyTaskKind, workId: PolicyWorkId, signal?: AbortSignal,
  ): Promise<{ record: PolicyRecord; ticket: WorkTicket }> {
    const policy = await this.getPolicy(kind)
    if (policy === undefined) throw new Error('web-test/models: no model policy is configured for this kind')
    const taskType = requireForKind(kind).taskType
    /* v8 ignore next -- getPolicy returns undefined for exact-value, rejected above before this read */
    if (taskType === null) throw new Error('web-test/models: exact-value has no model route')
    const report = await this.report(policy.primary, taskType, signal)
    if (report.verdict.kind !== 'ready' || report.capabilities === null || !satisfiesPolicy(policy, report.capabilities).ok) {
      throw new Error('web-test/models: the pinned policy route requires repair')
    }
    return { record: policyRecord(policy, workId, Date.now()), ticket: this.works.admit({ workId, taskType, route: policy.primary }) }
  }

  /**
   * Read one credential reference's state, for a surface that must not read a value.
   * @param ref - the reference to describe.
   * @returns the reference's state, or `undefined` when the provider refused the read.
   */
  async describeCredential(ref: CredentialRef): Promise<CredentialInfo | undefined> {
    try {
      return await this.ctx.credentials.describe(ref)
    } catch {
      // A refused describe is an unknown state, not an unconfigured one: the
      // caller shows it as unverified rather than inviting a re-entry of a key
      // that may still be stored.
      return undefined
    }
  }

  /**
   * Record that a reference no longer resolves, moving the work pinned to it into
   * the wait that names a removal rather than a replacement.
   * @param ref - the reference that stopped resolving.
   */
  noteCredentialAbsent(ref: CredentialRef): void {
    this.works.parkForReference(ref, false, Date.now())
  }

  /**
   * Admit one unit of work, pinned to the route it starts on.
   *
   * Each admission takes the next unit ordinal, so two units of work on one
   * route are two tickets: settling one must not report the other finished, and
   * a credential change must park each of them on its own identity.
   * @param taskType - the task type the work is for.
   * @param route - the exact route the work runs on.
   * @returns the tracked ticket, whose identity resumes the work.
   */
  beginWork(taskType: ModelTaskType, route: ModelRoute): WorkTicket {
    this.admitted += 1
    return this.works.admit({ workId: workIdOf(route, taskType, this.admitted), taskType, route })
  }

  /**
   * Report one unit of work finished.
   *
   * A parked ticket is refused: work interrupted by a credential change was cut
   * off mid-flight, so this is not a report anyone can support, and accepting it
   * would drop that work out of the recoverable wait. The caller resumes the
   * ticket, or forgets it, instead.
   * @param ticket - the ticket the caller was given.
   * @returns true when a running ticket was tracked and is now settled.
   */
  completeWork(ticket: WorkTicket): boolean {
    return this.works.settle(ticket.workId)
  }

  /**
   * Drop one ticket, whether it is running, parked, or settled.
   *
   * This is the half of a parked unit's end that is not a report that it
   * finished: {@link completeWork} is refused for a parked ticket, so a caller
   * that has decided the work is abandoned rather than resumed drops the ticket
   * here. The registry keeps nothing about it afterwards.
   * @param workId - the identity the caller was given.
   * @returns true when a tracked ticket was dropped.
   */
  forgetWork(workId: string): boolean {
    return this.works.forget(workId)
  }

  /**
   * The recoverable wait's current contents.
   * @returns every ticket parked on a credential change.
   */
  waitingWork(): WorkTicket[] {
    return this.works.waiting()
  }

  /**
   * Re-verify a parked ticket's **own pinned route** with a real request and,
   * if it answers, let the work continue there.
   *
   * This is the whole of "no silent model switch": the route is read from the
   * ticket, one real request is addressed at exactly that provider and model, and
   * the outcome is either that same route or a continued wait. Selection is not
   * re-run, so a route the user removed cannot be quietly replaced by another.
   * @param workId - the identity the caller admitted.
   * @param signal - caller cancellation for the verification request.
   * @returns the re-verified selection, or the wait continuing with the reason;
   * credential changes before readiness publication keep the ticket waiting.
   * @throws {Error} when no tracked ticket carries that identity.
   */
  async resumeWork(workId: string, signal?: AbortSignal): Promise<ResumeOutcome> {
    const ticket = this.works.read(workId)
    /* v8 ignore next -- a caller resumes an identity beginWork returned, so an untracked id is a caller error */
    if (ticket === undefined) throw new Error(`web-test/models: no tracked work named ${JSON.stringify(workId)}`)
    if (ticket.state !== 'waiting') {
      return { kind: 'still-waiting', detail: `work ${workId} is ${ticket.state}, not waiting`, verdict: null }
    }
    const epoch = this.credentialEpoch
    const report = await this.report(ticket.route, ticket.taskType, signal)
    if (report.verdict.kind !== 'ready') {
      return { kind: 'still-waiting', detail: describeVerdict(report.verdict), verdict: report.verdict }
    }
    const selection = await this.settleSelection(ticket.route, ticket.taskType, report, epoch, signal)
    if (selection === null || epoch !== this.credentialEpoch) {
      // A failed verification commit keeps the ticket recoverable on its own route.
      return {
        kind: 'still-waiting',
        detail: 'the pinned route answered but no selection was recorded: the composition can no longer resolve that route, or the store refused the record',
        verdict: null,
      }
    }
    // The registry's own decision is the guard: a ticket it will not move stays
    // in its wait, so a `resumed` answer is only ever returned for a ticket that
    // is running on its pinned route again.
    if (!this.works.resume(workId, report)) {
      return {
        kind: 'still-waiting',
        detail: `the pinned route answered but work ${workId} was no longer waiting on it`,
        verdict: null,
      }
    }
    return { kind: 'resumed', selection }
  }

  /**
   * Read the live provider directory a first run would configure.
   * @returns every route the running composition declares.
   */
  listProviders(): LlmConfigurableProvider[] {
    return this.ctx.llm.listConfigurableProviders()
  }

  /**
   * List advisory model identities for one configured provider.
   * @param provider - provider identity.
   * @returns adapter-declared model identities.
   */
  async listModels(provider: string): Promise<readonly { id: string }[]> {
    try {
      return await this.ctx.llm.listModels(provider)
    } catch (_error: unknown) {
      // Catalogue adapters can include response secrets in exceptions.
      throw new Error('web-test/models: provider catalogue could not be read')
    }
  }

  /**
   * Run one real connection test against one route, on that provider's own
   * protocol, and classify what it answered.
   * @param route - the exact provider, model, and credential reference to address.
   * @param taskType - the task type whose requirement the test belongs to.
   * @param signal - caller cancellation for the request.
   * @returns the report a surface renders.
   */
  async testConnection(
    route: ModelRoute,
    taskType: ModelTaskType,
    signal?: AbortSignal,
  ): Promise<ConnectionReport> {
    return this.report(route, taskType, signal)
  }

  /**
   * Verify and persist the exact route chosen in the conversation card.
   * @param provider - configured provider identity.
   * @param model - exact model identity.
   * @param taskType - task requirement being configured.
   * @param signal - caller cancellation for the real probe.
   * @returns a verified persisted selection, or safe refusal; credential changes
   * during verification or persistence require a new probe.
   */
  async configureRoute(provider: string, model: string, taskType: ModelTaskType, signal?: AbortSignal): Promise<TaskRoute> {
    const route: ModelRoute = { provider, model, credentialRef: this.referenceFor(provider) }
    const epoch = this.credentialEpoch
    const report = await this.report(route, taskType, signal)
    if (report.verdict.kind !== 'ready') return { kind: 'not-ready', reason: 'connection-failed', detail: describeVerdict(report.verdict), rejected: [] }
    /* v8 ignore next -- a ready report always includes capabilities */
    if (report.capabilities === null) throw new Error('web-test/models: ready report has no capabilities')
    if (!satisfiesModality(report.capabilities, requiredModality(taskType))) {
      return { kind: 'not-ready', reason: 'capability-absent', detail: 'the selected route cannot carry this task input', rejected: [] }
    }
    const selection = await this.settleSelection(route, taskType, report, epoch, signal)
    return selection === null || epoch !== this.credentialEpoch
      ? this.stale('the verified route could not be persisted')
      : { kind: 'ready', selection }
  }

  /**
   * Decide the route one task type may run on.
   *
   * A stored selection is served without a request only while its version, its
   * fingerprint, the adapter's live declaration of the modalities it carries, and
   * its verification window all still hold. With `reverify: false`, any other
   * state is reported without a probe or persistence write. With `reverify: true`,
   * the planner runs real requests, and a task type with no route is reported not ready with the reason
   * — never guessed around.
   * @param taskType - the task type to route.
   * @param options - whether a real re-verification request is acceptable.
   * @param signal - caller cancellation for the probe requests.
   * @returns the ready selection, or the not-ready record naming why.
   */
  async selectRoute(
    taskType: ModelTaskType,
    options: { readonly reverify: boolean },
    signal?: AbortSignal,
  ): Promise<TaskRoute> {
    const epoch = this.credentialEpoch
    const { byTask, refused } = await this.readSelections()
    const previous = byTask[taskType]
    if (previous === undefined) {
      // A stored record this release cannot read is not a selection: it is
      // verified again by a real request, or reported as needing one.
      const unreadable = refused.get(taskType)
      if (unreadable !== undefined) {
        return options.reverify ? this.plan(taskType, signal) : this.stale(unreadable)
      }
      if (!options.reverify) {
        if (this.listProviders().length === 0) {
          return { kind: 'not-ready', reason: 'no-provider-configured', detail: 'no provider route is configured', rejected: [] }
        }
        return this.stale('no verified selection is stored for this task type')
      }
      return this.plan(taskType, signal)
    }
    const now = Date.now()
    const live = await this.liveRoute(previous.route, signal)
    if (epoch !== this.credentialEpoch) {
      return options.reverify ? this.plan(taskType, signal) : this.stale('the credential changed while this route status was being read')
    }
    if (live === null || live.fingerprint !== previous.fingerprint) {
      if (!options.reverify) {
        return this.stale('the provider, its catalog, or its credential reference moved under this selection')
      }
    } else if (!sameDeclaredModalities(previous.capabilities.inputModalities, live.modalities)) {
      // The record is refused rather than read as `capability-absent`. The
      // digest covers the adapter's declaration of the fields it publishes, and
      // the recorded modality list is beside it in the same file rather than
      // inside it, so the two are independent facts: a record whose list is
      // wider or narrower than the live declaration is one this release cannot
      // serve, and only a real request says which of the two is current.
      // `capability-absent` would be the stronger claim and the wrong one — the
      // live declaration may in fact carry the modality the stored list lacks.
      if (!options.reverify) {
        return this.stale('the modalities this record carries are not the ones the adapter declares for that route')
      }
    } else if (previous.route.credentialRef !== null
      && this.changedReferences.get(previous.route.credentialRef)?.has(taskType)
      && selectionServes(previous, taskType)) {
      if (!options.reverify) return this.stale('the credential changed after this route was verified')
      return this.plan(taskType, signal)
    } else if (previous.verifiedAt > now) {
      // The record's age is negative, and a negative age satisfies any window,
      // so a future instant would read as freshly verified for as long as the
      // clock stayed behind it. The clock moved backwards, or a hand-edited file
      // carries the instant; either way this record has to earn a verification
      // again. The plausibility question is settled here rather than in the
      // record reader because it is a question about this host's clock, not
      // about the file.
      if (!options.reverify) {
        return this.stale('the recorded verification instant is later than this host\'s clock')
      }
    } else if (now - previous.verifiedAt <= this.config.verificationTtlMs) {
      if (selectionServes(previous, taskType)) {
        if (this.verifiedSelections.get(taskType) !== selectionIdentity(previous)) {
          if (!options.reverify) return this.stale('the persisted route requires a first verification in this running application')
          return this.plan(taskType, signal)
        }
        return { kind: 'ready', selection: previous }
      }
      return options.reverify ? this.plan(taskType, signal) : this.stale('the stored selection cannot serve this task type')
    } else if (!options.reverify) {
      return this.stale('the last verification is older than the configured window')
    }
    return this.plan(taskType, signal)
  }

  /**
   * Read every task type's route decision. A read with `reverify: false`
   * issues no model probes or persistence writes.
   * @param options - whether real re-verification requests are acceptable.
   * @param signal - caller cancellation shared by the probe requests.
   * @returns the per-task decisions plus the provider directory behind them.
   */
  async survey(options: { readonly reverify: boolean }, signal?: AbortSignal): Promise<ProviderSurvey> {
    const routes = {} as Record<ModelTaskType, TaskRoute>
    for (const taskType of MODEL_TASK_TYPES) {
      routes[taskType] = await this.selectRoute(taskType, options, signal)
    }
    return { providers: this.listProviders(), routes }
  }

  /** One not-ready record for a selection that must be verified again. */
  private stale(detail: string): TaskRoute {
    const reason: NotReadyReason = 'reverification-required'
    return { kind: 'not-ready', reason, detail, rejected: [] }
  }

  /** Read the adapter's declared models for every directory entry. */
  private async catalogs(signal?: AbortSignal): Promise<Map<string, LlmResolvedModelInfo[]>> {
    const catalogs = new Map<string, LlmResolvedModelInfo[]>()
    for (const entry of this.listProviders()) {
      try {
        const models = await this.ctx.llm.listModels(entry.provider)
        catalogs.set(entry.provider, [...models].map(model => ({ ...model })))
      } catch (_error: unknown) {
        // An adapter that cannot enumerate its own catalog contributes no
        // candidate for this route rather than failing the whole decision.
        catalogs.set(entry.provider, [])
        this.ctx.logger.warn('web-test/models: provider catalogue could not be read')
      }
    }
    void signal
    return catalogs
  }

  /**
   * Read the credential reference a provider's stored profile resolves keys
   * through, through the composition's own {@link ReferenceSource}.
   * @param provider - the route's provider key.
   * @returns the branded reference, or `null` when no profile names one.
   */
  private referenceFor(provider: string): CredentialRef | null {
    return this.references?.forProvider(provider) ?? null
  }

  /** Run the planner for one task type against the live directory. */
  private async plan(taskType: ModelTaskType, signal?: AbortSignal): Promise<TaskRoute> {
    const directory = this.listProviders()
    if (directory.length === 0) {
      return {
        kind: 'not-ready',
        reason: 'no-provider-configured',
        detail: 'no provider route is configured; configure one in the conversation model card before a session can run',
        rejected: [],
      }
    }
    const set = candidateSet(directory, await this.catalogs(signal), taskType, provider => this.referenceFor(provider))
    let epoch = this.credentialEpoch
    const planned = await planRoute({
      candidates: set.candidates,
      rejections: set.rejections,
      taskType,
      attempt: (candidate) => {
        epoch = this.credentialEpoch
        return this.report(candidate.route, taskType, signal)
      },
      now: () => Date.now(),
      persist: selection => this.persist(selection, epoch),
      // The fingerprint is read from the same source on both sides of a
      // comparison: the adapter's resolved exact-model metadata. Using the
      // catalog listing here instead would digest a thinner record than
      // `selectRoute`'s own read produces, and every stored selection would
      // read stale. The read is separate from the one the report made, so it can
      // come back empty where that one resolved; the planner is then told there
      // is no digest rather than being handed a route that cannot be digested.
      fingerprintOf: async candidate => (await this.liveRoute(candidate.route, signal))?.fingerprint ?? null,
    })
    return planned.kind === 'ready' && epoch !== this.credentialEpoch
      ? this.stale('the credential changed before the verified route could be published')
      : planned
  }

  /** Run one real connection test and attach the adapter's declaration to it. */
  private async report(route: ModelRoute, taskType: ModelTaskType, signal?: AbortSignal): Promise<ConnectionReport> {
    let model: LlmResolvedModelInfo
    try {
      model = await declaredModel(this.ctx.llm, route, signal)
    } catch (error: unknown) {
      // The adapter refusing its own exact model is the model rejection, and it
      // is reported as one rather than as an absent capability: the route exists,
      // and the model on it does not.
      return {
        route,
        taskType,
        verdict: classifyFailure({
          message: error instanceof Error ? error.message : String(error),
          code: 'INVALID_MODEL_INFO',
        }),
        capabilities: null,
        requestId: null,
      }
    }
    const epoch = this.credentialEpoch
    const observation = await probeRoute(this.ctx.llm, route, taskType, signal, this.probeImage)
    if (epoch !== this.credentialEpoch) {
      return { route: { ...route }, taskType, verdict: classifyFailure({ code: 'CREDENTIAL_CHANGED', message: 'credential changed during verification' }), capabilities: null, requestId: null }
    }
    return connectionReport(route, taskType, observation, model)
  }

  /**
   * Read every fact a stored record about one route has to still hold, in the
   * one pass that resolves the route.
   *
   * The fingerprint and the declared modalities come from the same adapter read
   * because they are the same observation: the digest covers what the adapter
   * publishes *about* the model, and the capability record carries the modality
   * list beside it, so comparing them costs nothing extra and cannot disagree
   * about which read they came from.
   * @param route - the route a stored record names.
   * @param signal - caller cancellation for the adapter's own lookup.
   * @returns the live facts, or `null` when the composition can no longer resolve the route.
   */
  private async liveRoute(route: ModelRoute, signal?: AbortSignal): Promise<LiveRoute | null> {
    let model: LlmResolvedModelInfo
    try {
      model = await declaredModel(this.ctx.llm, route, signal)
    } catch {
      // A route the live composition can no longer resolve has nothing to
      // compare a record against, which is exactly the "re-verify" case rather
      // than a match.
      return null
    }
    return {
      fingerprint: routeFingerprint(route, entryFor(this.listProviders(), route.provider), model),
      modalities: declaredModalities(model),
    }
  }

  /** Build the selection a real request earned, or null when the store refused it. */
  private async settleSelection(
    route: ModelRoute,
    taskType: ModelTaskType,
    report: ConnectionReport,
    epoch: number,
    signal?: AbortSignal,
  ): Promise<RouteSelection | null> {
    /* v8 ignore next -- settleSelection is only called for a ready report */
    if (report.capabilities === null) return null
    // The pinned route just answered, so the read that digests it is the one the
    // report already made — but it is a second read, and a catalog that moved
    // between the two leaves nothing to digest. No digest means no selection, so
    // the ticket stays parked and `resumeWork` reports the store refused it.
    const live = await this.liveRoute(route, signal)
    if (live === null) return null
    const selection: RouteSelection = {
      version: ROUTE_SELECTION_VERSION,
      taskType,
      route,
      fingerprint: live.fingerprint,
      capabilities: report.capabilities,
      verifiedAt: Date.now(),
    }
    return (await this.persist(selection, epoch)) ? selection : null
  }

  /** Publish verification only when its credential generation survives the durable write. */
  private async persist(selection: RouteSelection, epoch: number): Promise<boolean> {
    const store = this.selections
    /* v8 ignore next -- an application must mount the documented official store */
    if (store === undefined) throw new Error('web-test/models: no durable selection store is mounted')
    if (epoch !== this.credentialEpoch) return false
    const stored = await store.put(selection)
    if (stored && epoch !== this.credentialEpoch) {
      // An older pending write can overwrite a newer verified record. Its task
      // must lose process-local readiness even if that newer commit cleared the
      // reference's invalidation; the durable store has no conditional writes.
      this.verifiedSelections.delete(selection.taskType)
      return false
    }
    if (stored) this.verifiedSelections.set(selection.taskType, selectionIdentity(selection))
    if (stored && selection.route.credentialRef !== null) {
      this.changedReferences.get(selection.route.credentialRef)?.delete(selection.taskType)
    }
    return stored
  }

  /**
   * Read the durable selections, or an empty cut when no store is mounted.
   *
   * Every value is read through {@link parseStoredSelection}, because a settings
   * document is a file a user can hand-edit and a record this release cannot
   * read is not a selection. Only an *absent* key is left alone; a key holding
   * anything else — a `null`, a string, a record another release wrote — is
   * reported in `refused` with the reason it was refused, so the caller can say
   * which task type's stored value was not a selection instead of treating it as
   * never selected. One such value therefore costs that task type its decision
   * and no other.
   * @returns the records this release can read, and why each refused one was.
   */
  private async readSelections(): Promise<ReadSelections> {
    const store = this.selections
    /* v8 ignore next -- a deployment that mounts no store has nothing persisted to read */
    if (store === undefined) throw new Error('web-test/models: no durable selection store is mounted')
    const { byTask } = await store.read()
    const read: Partial<Record<ModelTaskType, RouteSelection>> = {}
    const refused = new Map<ModelTaskType, string>()
    for (const taskType of MODEL_TASK_TYPES) {
      const record = byTask[taskType]
      // A key this release does not route is a record nothing here can be asked
      // about, so it is left alone rather than reported as an unreadable one.
      if (record === undefined) continue
      const selection = parseStoredSelection(record)
      if (selection === undefined) refused.set(taskType, refusalDetail(record))
      else if (selection.taskType !== taskType) refused.set(taskType, refusalDetail(record))
      else read[taskType] = selection
    }
    return { byTask: read, refused }
  }
}

/**
 * Reader for the credential reference each provider's stored profile names.
 *
 * The reference lives in the provider's own configuration profile — the same
 * `apiKeyEnv` the official provider editor writes — and not in the
 * configurable-provider directory, which declares no such field. A composition
 * that holds the settings document therefore supplies this reader; a composition
 * that does not leaves every route unpinned, and the recoverable wait then has no
 * ticket to park. The read is of a reference *name*, never of a value.
 */
export interface ReferenceSource {
  /**
   * Read the credential reference one provider's stored profile resolves keys through.
   * @param provider - the route's provider key.
   * @returns the branded reference, or `null` when no profile names one.
   */
  forProvider(provider: string): CredentialRef | null
}

/** The durable record of one verified selection per task type. */
export interface SelectionStore {  /**
   * Read every persisted selection.
   * @returns the stored selections with the revision they were read at.
   */
  read(): Promise<StoredSelections>
  /**
   * Write one task type's selection, replacing any earlier one.
   * @param selection - the selection a real request earned.
   * @returns true when the record was committed.
   */
  put(selection: RouteSelection): Promise<boolean>
}

/**
 * Build an in-memory selection store, for a composition that runs a session
 * without a durable settings document behind it.
 *
 * It is a store like any other, and the honest difference is that its records do
 * not survive a restart — a deployment that needs that mounts a durable
 * {@link SelectionStore} over its settings document instead.
 * @returns a store whose records live for the process.
 */
export function memorySelectionStore(): SelectionStore {
  let revision = 0
  let byTask: Partial<Record<ModelTaskType, RouteSelection>> = {}
  return {
    read: () => Promise.resolve({ revision, byTask }),
    put: (selection) => {
      revision += 1
      byTask = { ...byTask, [selection.taskType]: selection }
      return Promise.resolve(true)
    },
  }
}

/**
 * Whether a stored value is an object a record's fields can be read from.
 *
 * A settings document is a file a user can hand-edit, so `null`, a number, and a
 * bare string are all values a key can hold. Reading `version` off one of those
 * is the throw this guard exists to prevent, and it is why every reader below
 * asks it first.
 * @param value - the stored value under one task type.
 * @returns true when the value is a non-null object.
 */
function isStoredRecord(value: unknown): value is Partial<RouteSelection> {
  return typeof value === 'object' && value !== null
}

/**
 * Whether a stored value is the route a selection names.
 *
 * The credential reference is part of the route because it decides which tickets
 * a credential change parks, so a record whose reference is not one is not a
 * route this release can address.
 * @param value - the stored route.
 * @returns true when the value names a provider, a model, and a reference or nothing.
 */
function isStoredRoute(value: unknown): value is ModelRoute {
  if (!isStoredRecord(value)) return false
  const route = value as Partial<ModelRoute>
  if (typeof route.provider !== 'string' || typeof route.model !== 'string') return false
  if (route.credentialRef === null) return true
  return typeof route.credentialRef === 'string' && isCredentialRefName(route.credentialRef)
}

/** Compare every persisted selection field independently of JSON property order. */
function selectionIdentity(selection: RouteSelection): string {
  return JSON.stringify([
    selection.version, selection.taskType, selection.fingerprint, selection.verifiedAt,
    selection.route.provider, selection.route.model, selection.route.credentialRef,
    selection.capabilities.inputModalities, selection.capabilities.toolUpdate, selection.capabilities.reportedCacheTokens,
  ])
}

/** The `toolUpdate` declarations this release routes, from the harness's own closed union. */
const TOOL_UPDATES: ReadonlySet<string> = new Set(['in-history', 'addition-only'])

/**
 * Whether a stored value is the capability record a selection carries.
 *
 * A list of modalities is checked as a list: `'image'` satisfies an image
 * requirement by string containment, so a record whose modalities were typed as
 * a bare string would forge a capability nothing ever observed. A modality this
 * release does not route is refused the same way, because half-understood is not
 * readable.
 * @param value - the stored capability record.
 * @returns true when every field is the type this release writes.
 */
function isStoredCapabilities(value: unknown): value is RouteCapabilities {
  if (!isStoredRecord(value)) return false
  const capabilities = value as Partial<RouteCapabilities>
  if (typeof capabilities.reportedCacheTokens !== 'boolean') return false
  if (capabilities.toolUpdate !== undefined && !TOOL_UPDATES.has(capabilities.toolUpdate)) return false
  const modalities = capabilities.inputModalities
  if (modalities === null) return true
  return Array.isArray(modalities) && modalities.every(isModelModality)
}

/**
 * What one stored value was refused for, said the way a caller reports it.
 *
 * The value is whatever a hand-edited document held, so nothing is read off it
 * before {@link isStoredRecord} says it is an object: a `null` under a task
 * type's key is a value, not a record, and it is refused for that reason rather
 * than for a version it never carried.
 * @param value - the stored value for one task type.
 * @returns the reason a caller reports.
 */
function refusalDetail(value: unknown): string {
  if (!isStoredRecord(value)) {
    return 'this stored value is not a selection record and must be verified again'
  }
  return value.version === ROUTE_SELECTION_VERSION
    ? 'this stored selection is not a record this release can read and must be verified again'
    : 'this selection was written by another release and must be re-verified'
}

/**
 * Read a persisted selection record, or `undefined` when the stored value is not
 * one this release wrote.
 *
 * A settings document is a durable file a user can hand-edit, so every field a
 * consumer reads is checked here rather than assumed: the version, the
 * fingerprint, the route and its credential reference, the capability record and
 * each of its fields, the task type, and the verification instant. A record that
 * fails any of them is one this release cannot read, and its caller verifies it
 * again by a real request instead of serving it as written.
 * @param value - the stored record for one task type.
 * @returns the selection, or `undefined` when the record is absent or foreign.
 */
export function parseStoredSelection(value: unknown): RouteSelection | undefined {
  if (!isStoredRecord(value)) return undefined
  const record = value
  if (record.version !== ROUTE_SELECTION_VERSION) return undefined
  if (!isRouteFingerprint(record.fingerprint)) return undefined
  if (!isStoredRoute(record.route)) return undefined
  if (!isStoredCapabilities(record.capabilities)) return undefined
  if (typeof record.taskType !== 'string' || !MODEL_TASK_TYPES.includes(record.taskType)) return undefined
  if (typeof record.verifiedAt !== 'number' || !Number.isFinite(record.verifiedAt)) return undefined
  // The record is rebuilt rather than cast, so a value read out of a file is
  // re-branded here and nowhere else.
  return {
    version: ROUTE_SELECTION_VERSION,
    taskType: record.taskType,
    route: {
      provider: record.route.provider,
      model: record.route.model,
      credentialRef: record.route.credentialRef === null ? null : credentialRef(record.route.credentialRef),
    },
    fingerprint: record.fingerprint,
    capabilities: {
      inputModalities: record.capabilities.inputModalities === null ? null : [...record.capabilities.inputModalities],
      toolUpdate: record.capabilities.toolUpdate,
      reportedCacheTokens: record.capabilities.reportedCacheTokens,
    },
    verifiedAt: record.verifiedAt,
  }
}

export default WebTestModels

/** Persistence for immutable policy revisions, owned by the official settings document. */
export interface PolicyStore {
  /** Read revision values for strict decoding. @returns all persisted revisions. */
  readPolicies(): Promise<Record<string, unknown>>
  /** Append a revision. @param policy - verified revision. @returns completion after persistence. */
  putPolicy(policy: RoutePolicyRevision): Promise<void>
}
