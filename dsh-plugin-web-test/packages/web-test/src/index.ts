/**
 * The Web testing Host service and the plugin's typed Remote surface.
 *
 * The service owns three contributions and nothing else: it opens the plugin's
 * own storage unit over the plugin-owned SQLite backend, contributes the opt-in
 * `web-test` agent preset, and drains on unload. Business rules live in
 * `store-service.ts` and `agent.ts`; this module is the composition root the
 * host's loader rows and the Client's Remote calls address.
 *
 * The Client reaches it as `ctx.remote.webTest.*`, a typed namespace rather
 * than an ad-hoc HTTP surface, so its requests and results are validated by the
 * descriptors in `lib/typert.host.js`.
 *
 * @module dsh-plugin-web-test
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Storage } from '@deepseek-ai/dsh-storage'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { guardReason, PRESET_ID, TOOL_PREFIX, name as AGENT_ROW } from './agent.ts'
import { buildReportBundle } from './report.ts'
import type { ReportBundle } from './report.ts'
import { environmentRevisionRecordSchema, policyRecordSchema, projectRecordSchema } from './records.ts'
import type {
  CasePlanRecord,
  CaseResultRecord,
  EnvironmentRevisionRecord,
  OperationRecord,
  PolicyRecord,
  ProjectRecord,
  RunControlAction,
  RunRecord,
} from './types.ts'

/** Loader row of the plugin's agent half, mounted inside the test preset. */
export { AGENT_ROW }

/** Id of the opt-in preset this plugin contributes. */
export { PRESET_ID }

/**
 * Web testing service, its storage owner, and its typed Remote namespace.
 * @typert service webTest
 */
export class WebTestService extends TypertRemoteService {
  /** Waits for the single writer so every business method goes through it. */
  static inject = ['tools', 'webTestStore', 'webTestRoleBrowsers']

  /**
   * @param ctx - Owning Context.
   */
  constructor(ctx: Context) {
    super(ctx, 'webTest')
    this.wire(ctx)
  }

  /**
   * Opens storage and arranges teardown.
   *
   * The `web-test` preset is declared as a loader row in this bundle's
   * `cordis.patch.yml`, not registered here: a preset registered from code
   * carries entries that no loader ever starts.
   * @param ctx - Owning Context.
   */
  protected wire(ctx: Context): void {
    const store = ctx.webTestStore
    // The execution guard belongs to the host-plane tools runtime. Registered
    // from the Web testing preset it would attach to that scope's own instance,
    // which carries no scheduler for the agent loop to use; from here it applies
    // to every execution and reads the owning agent off each one.
    ctx.effect(
      () => ctx.tools.guard(execution => {
        if (!store.accepting && execution.name !== `${TOOL_PREFIX}status`) {
          return `web-test: the plugin is ${store.state} and refuses new test actions`
        }
        return guardReason(
          execution,
          store,
          execution.agent?.id ?? '',
          ctx.webTestRoleBrowsers,
        )
      }),
      'web-test: execution guard',
    )

    ctx.inject(['storage'], (storageCtx) => {
      const hub: Storage = storageCtx.storage
      storageCtx.effect(() => {
        store.rearm()
        store.open(hub).catch((error: unknown) => {
          // A store that cannot open is a loud failure: the plugin's status
          // stays unanswered instead of reporting an empty domain.
          storageCtx.logger.error(`web-test: storage did not open: ${String(error)}`)
        })
        // No disposer here: the unit's lifecycle belongs to the drain effect
        // below, which already closes it on unload.
        return () => {}
      }, 'web-test: open storage')
    })

    // Mark the store draining before this fiber goes away, so a session that
    // still holds a retired preset revision refuses new work.
    ctx.effect(() => () => {
      store.drain().catch(() => {})
    }, 'web-test: drain on unload')
  }

  /**
   * Refuse business work once the plugin stopped accepting actions.
   * @throws when the plugin is draining or its storage is not open.
   */
  protected acceptingGuard(): void {
    const store = this.ctx.webTestStore
    if (store.accepting) return
    throw new Error(`web-test: refusing work while ${store.state} (${store.openError ?? 'storage pending'})`)
  }

  /**
   * Report that the plugin loaded and its own storage answers.
   * @returns the plugin status.
   * @throws when the plugin is draining or its storage is not open.
   */
  @Remote
  status() {
    this.acceptingGuard()
    const status = this.ctx.webTestStore.status()
    if (status === undefined) {
      throw new Error(`web-test: storage is not open (${this.ctx.webTestStore.openError ?? 'pending'})`)
    }
    return status
  }

  /**
   * Store one project, replacing any record with the same key.
   * @param project - The project record to store, keyed by its own `key`.
   * @returns the stored record.
   * @throws when the plugin is draining or the record fails validation.
   */
  @Remote
  async putProject(project: ProjectRecord): Promise<ProjectRecord> {
    this.acceptingGuard()
    const record = projectRecordSchema.parse(project)
    return this.ctx.webTestStore.putProject(record)
  }

  /**
   * Store one environment declaration revision.
   * @param environment - The revision to store, keyed by its own `key`.
   * @returns the stored revision.
   * @throws when the plugin is draining or the record fails validation.
   */
  @Remote
  async putEnvironment(environment: EnvironmentRevisionRecord): Promise<EnvironmentRevisionRecord> {
    this.acceptingGuard()
    const record = environmentRevisionRecordSchema.parse(environment)
    const stored = await this.ctx.webTestStore.putEnvironment(record)
    // The browser is mounted here rather than when a run starts: the provider
    // defines a server's tools on an agent as that agent is created and cannot
    // add them to one that already exists, so a browser mounted after the
    // session exists never reaches it.
    await this.ctx.webTestRoleBrowsers.ensure({
      sessionId: '',
      generation: 0,
      projectKey: stored.projectKey,
      environmentKey: stored.key,
      runKey: '',
      role: stored.roles[0]?.name ?? '',
    })
    return stored
  }

  /**
   * Read every declared entry point of one project.
   * @param projectKey - Project whose entry points to read.
   * @returns the stored environment revisions in key order.
   * @throws when the plugin is draining.
   */
  @Remote
  listEnvironments(projectKey: string): EnvironmentRevisionRecord[] {
    this.acceptingGuard()
    return this.ctx.webTestStore.listEnvironments(projectKey)
  }

  /**
   * Store one project's execution policy.
   * @param policy - The policy to store, keyed by its own `key`.
   * @returns the stored policy.
   * @throws when the plugin is draining or the record fails validation.
   */
  @Remote
  async putPolicy(policy: PolicyRecord): Promise<PolicyRecord> {
    this.acceptingGuard()
    const record = policyRecordSchema.parse(policy)
    return this.ctx.webTestStore.putPolicy(record)
  }

  /**
   * Pause, resume, cancel, or park one run, or answer the question it raised.
   *
   * This is the operator's side of the control surface: it changes the run's
   * status and the execution path's held set, so a run the operator stopped
   * refuses dispatching without waiting for the model's next turn, and only in
   * the session that owns it.
   * @param runKey - Run to control.
   * @param action - What the operator asked for.
   * @returns the run record after the action.
   * @throws when the plugin is draining, no run carries that key, or the action
   * contradicts the run's current status.
   */
  /**
   * Read every proposed case of one run, with the operator's ruling.
   *
   * This is the operator's view of what analysis proposed and what is therefore
   * executable, which is the pair the report needs in order to state coverage.
   * @param runKey - Run whose cases to read.
   * @returns the case plans in key order.
   * @throws when the plugin is draining.
   */
  @Remote
  listCases(runKey: string): CasePlanRecord[] {
    this.acceptingGuard()
    return this.ctx.webTestStore.listCasePlans(runKey)
  }

  /**
   * Approve or reject one proposed case.
   *
   * Approving is what makes a case executable: the tool that reports a result
   * refuses anything the operator has not approved, and refuses a result that
   * does not cover every approved step.
   * @param runKey - Run the case belongs to.
   * @param caseKey - Case to rule on.
   * @param decision - Whether the operator approved the case.
   * @param note - Why the operator decided this way.
   * @returns the plan after the ruling.
   * @throws when the plugin is draining, the run proposed no such case, or the
   * case was already ruled on.
   */
  @Remote
  async ruleOnCase(
    runKey: string,
    caseKey: string,
    decision: 'confirm' | 'reject',
    note: string,
  ): Promise<CasePlanRecord> {
    this.acceptingGuard()
    return this.ctx.webTestStore.ruleOnCase(runKey, caseKey, decision, note)
  }

  @Remote
  async controlRun(runKey: string, action: RunControlAction): Promise<RunRecord> {
    this.acceptingGuard()
    return this.ctx.webTestStore.controlRun(runKey, action)
  }

  /**
   * Park a run until a business deadline, persisting the deadline itself.
   *
   * The deadline is durable, so a wait for a business event outlives the host
   * closing and the run reports when it may continue the next time it starts.
   * @param runKey - Run to park.
   * @param untilIso - ISO 8601 moment the run may act again at.
   * @param reason - What the run is waiting for.
   * @returns the run record after the wait was recorded.
   * @throws when the plugin is draining, the run is not running, or the deadline
   * is not in the future.
   */
  @Remote
  async waitRun(runKey: string, untilIso: string, reason: string): Promise<RunRecord> {
    this.acceptingGuard()
    const untilMs = Date.parse(untilIso)
    if (Number.isNaN(untilMs)) {
      throw new Error(`web-test: ${JSON.stringify(untilIso)} is not an ISO 8601 moment`)
    }
    return this.ctx.webTestStore.waitUntil(runKey, untilMs, reason)
  }

  /**
   * Release a business-time wait once its stored deadline has passed.
   * @param runKey - Run to release.
   * @returns the run record after the wait ended.
   * @throws when the plugin is draining, the run is not waiting, or its deadline
   * has not arrived.
   */
  @Remote
  async resumeWait(runKey: string): Promise<RunRecord> {
    this.acceptingGuard()
    return this.ctx.webTestStore.resumeWait(runKey)
  }

  /**
   * Choose the role a run acts as, refusing a role the environment never declared.
   * @param runKey - Run changing role.
   * @param role - Declared role name, empty to act without one.
   * @returns the run record after the change.
   * @throws when the plugin is draining, the run is not running, the role is
   * undeclared, or an operation is still unresolved.
   */
  @Remote
  async assumeRole(runKey: string, role: string): Promise<RunRecord> {
    this.acceptingGuard()
    return this.ctx.webTestStore.assumeRole(runKey, role, { account: '', detail: 'set by the operator, not verified' })
  }

  /**
   * Settle a business-changing operation whose outcome is now established, or
   * record that it could not be observed.
   *
   * An operation that was in flight when the host stopped is already `unknown`
   * when this opens, so the operator resolves it here instead of the run
   * repeating it.
   * @param runKey - Run that attempted the operation.
   * @param operationKey - Operation to resolve.
   * @param resolution - Either the observed outcome, or the reason it is unknown.
   * @returns the operation record after the resolution.
   * @throws when the plugin is draining, the operation does not exist, or the
   * transition is not allowed.
   */
  @Remote
  async resolveOperation(
    runKey: string,
    operationKey: string,
    resolution: { outcome: 'observed-success' | 'observed-absent' } | { unknownReason: string },
  ): Promise<OperationRecord> {
    this.acceptingGuard()
    const store = this.ctx.webTestStore
    if ('outcome' in resolution) {
      return store.settleOperation(runKey, operationKey, resolution.outcome)
    }
    return store.markOperationUnknown(runKey, operationKey, resolution.unknownReason)
  }

  /**
   * Read one run's business-changing operations.
   * @param runKey - Run whose operations to read; omit for every run.
   * @returns the stored operation records in key order.
   * @throws when the plugin is draining.
   */
  @Remote
  listOperations(runKey?: string): OperationRecord[] {
    this.acceptingGuard()
    return this.ctx.webTestStore.listOperations(runKey)
  }

  /**
   * Read every recorded run, in key order.
   * @returns the stored run records.
   * @throws when the plugin is draining.
   */
  @Remote
  listRuns(): RunRecord[] {
    this.acceptingGuard()
    return this.ctx.webTestStore.listRuns()
  }

  /**
   * Read one run's current record.
   * @param runKey - Run to read.
   * @returns the run record.
   * @throws when the plugin is draining or no run carries that key.
   */
  @Remote
  getRun(runKey: string): RunRecord {
    this.acceptingGuard()
    const run = this.ctx.webTestStore.getRun(runKey)
    if (run === undefined) throw new Error(`web-test: no run ${JSON.stringify(runKey)}`)
    return run
  }

  /**
   * Build one run's report from its recorded case results and operations.
   *
   * All three forms come from one derivation, so the HTML a browser opens, the
   * Markdown a person reviews and the JSON a tool reads cannot disagree about
   * what the run did.
   * @param runKey - Run to report on.
   * @returns the report in Markdown, HTML and JSON, plus the verdict.
   * @throws when the plugin is draining.
   */
  @Remote
  buildReport(runKey: string): ReportBundle {
    this.acceptingGuard()
    const store = this.ctx.webTestStore
    const run = store.getRun(runKey)
    return buildReportBundle({
      runKey,
      results: store.listCaseResults(runKey),
      ...(run === undefined ? {} : { run }),
      operations: store.listOperations(runKey),
      plans: store.listCasePlans(runKey),
    })
  }

  /**
   * Read every recorded result of one run.
   * @param runKey - Run whose case results to read.
   * @returns the stored case results in key order.
   * @throws when the plugin is draining.
   */
  @Remote
  listCaseResults(runKey: string): CaseResultRecord[] {
    this.acceptingGuard()
    return this.ctx.webTestStore.listCaseResults(runKey)
  }

  /**
   * Read every stored project.
   * @returns the stored project records in key order.
   * @throws when the plugin is draining.
   */
  @Remote
  listProjects(): ProjectRecord[] {
    this.acceptingGuard()
    return this.ctx.webTestStore.listProjects()
  }
}


declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Web testing service; also the plugin's typed Remote namespace. */
    webTest: WebTestService
  }
}

export default WebTestService
