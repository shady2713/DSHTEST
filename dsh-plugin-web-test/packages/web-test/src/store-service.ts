/**
 * The single writer over the plugin's business data.
 *
 * Exactly one Host service owns writes: the UI, tools, and tasks all call this
 * service rather than opening the unit themselves, so one place decides what a
 * lifecycle transition means for in-flight work. The backend unit does not
 * serialize concurrent writes, so this service also owns the write chain that
 * orders them.
 *
 * The lifecycle flag deliberately outlives fiber disposal. Disabling the plugin
 * disposes this fiber, but an Agent may still hold the service object through
 * a retired preset revision; that Agent must be able to read `draining` and
 * refuse to dispatch, so teardown marks the state first and only then closes the
 * unit.
 *
 * @module dsh-plugin-web-test/store-service
 */

import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { KvUnit, Storage } from '@deepseek-ai/dsh-storage'
import {
  SCHEMA_VERSION,
  casePlanRecordSchema,
  caseResultRecordSchema,
  environmentRevisionRecordSchema,
  operationRecordSchema,
  policyRecordSchema,
  projectRecordSchema,
  runHoldStatusSchema,
  roleIdentityRecordSchema,
  runRecordSchema,
} from './records.ts'
import {
  BACKEND_NAME,
  TABLE_CASE_RESULTS,
  TABLE_ENVIRONMENT_REVISIONS,
  TABLE_CASE_PLANS,
  TABLE_ROLE_IDENTITIES,
  TABLE_OPERATIONS,
  TABLE_POLICIES,
  TABLE_PROJECTS,
  TABLE_RUNS,
  WEB_TEST_UNIT,
  EVIDENCE_DIR,
  ensureDataRoot,
  evidenceDir,
} from './domain/store.ts'
import type {
  CaseResultRecord,
  EnvironmentRevisionRecord,
  CasePlanRecord,
  AuthorityToken,
  OperationRecord,
  PluginLifecycleState,
  RunHoldStatus,
  RunRecord,
  PluginStatus,
  PolicyRecord,
  ProjectRecord,
  RoleIdentityRecord,
  RunControlAction,
} from './types.ts'

/** Plugin version, matching this package's manifest. */
export const PLUGIN_VERSION = '0.5.2'

/**
 * Host release this plugin's peer declaration accepts.
 *
 * Reported so an operator reading the status can see which host compatibility
 * the loaded artifact was built against. The host itself enforces the actual
 * range before install, so this is a statement of intent, not a runtime probe.
 */
export const COMPATIBLE_DSH_VERSION = '0.2.0-rc.2'

/** Every table's records, keyed by table name. */
type Tables = Record<string, Record<string, unknown>>

/** Table name paired with the record shape the schema declares for it. */
const TABLE_SCHEMAS = [
  { table: TABLE_PROJECTS, schema: projectRecordSchema },
  { table: TABLE_ENVIRONMENT_REVISIONS, schema: environmentRevisionRecordSchema },
  { table: TABLE_RUNS, schema: runRecordSchema },
  { table: TABLE_POLICIES, schema: policyRecordSchema },
  { table: TABLE_CASE_RESULTS, schema: caseResultRecordSchema },
  { table: TABLE_OPERATIONS, schema: operationRecordSchema },
  { table: TABLE_CASE_PLANS, schema: casePlanRecordSchema },
  { table: TABLE_ROLE_IDENTITIES, schema: roleIdentityRecordSchema },
] as const

/** Statuses a run can never leave, so a hold or a wait cannot apply to them. */
const TERMINAL_STATUSES: readonly RunRecord['status'][] = ['completed', 'cancelled', 'blocked']

/** Statuses that mean the run is not executing and needs an operator to act. */
const HELD_STATUSES: readonly RunHoldStatus[] = runHoldStatusSchema.options

/**
 * Run statuses that leave work for the operator to decide.
 *
 * Every held status qualifies: the run is not executing, and how it proceeds
 * depends on a decision rather than on the clock.
 */
const DECISION_STATUSES: readonly RunRecord['status'][] = HELD_STATUSES

/**
 * Why a held run is waiting, stated so it cannot be misread.
 *
 * Each status gets its own wording because a pause the operator chose, a
 * restart that interrupted the run, and a question the run asked are different
 * situations; a single generic sentence would tell the operator a paused run
 * had been interrupted by a restart, which is not what happened.
 * @param run - The held run.
 * @returns the reason to show the operator.
 */
function decisionReason(run: RunRecord): string {
  if (run.waitingReason !== '') return run.waitingReason
  if (run.status === 'paused') return 'the operator paused this run; continue it deliberately with controlRun'
  if (run.status === 'resuming') {
    return 'the plugin reopened its store (a host restart, or a disable and re-enable) while this run was executing, so it was parked rather than resumed; check the'
      + ' environment, the login and every unresolved operation, then continue it deliberately with controlRun'
  }
  return 'this run is waiting on the operator'
}

/**
 * Statuses a host restart leaves exactly as they are.
 *
 * A pause is the operator's decision, a business-time wait owns a stored
 * deadline that has to outlive the process, and an answer is waiting on a person.
 * None of them is something a restart may convert into a continuation prompt.
 */
const PRESERVED_ACROSS_RESTART: readonly RunRecord['status'][] = [
  'paused',
  'awaiting-business-time',
  'awaiting-user',
  'resuming',
]

/** Dispatch states from which an operation may not be dispatched again. */
const UNRESOLVED_DISPATCHES: readonly OperationRecord['dispatch']['kind'][] = ['dispatching', 'dispatched', 'unknown']

/** What one restart found that needs an operator's decision. */
/** What the site answered when a role's identity was checked. */
export interface VerifiedIdentity {
  /** The account the site reported, or an empty string when it reported none. */
  account: string
  /** The site's own wording, kept so a failure can be reported as it stated it. */
  detail: string
}

export interface ReconciliationReport {
  /** Runs a restart interrupted; each needs explicit continuation. */
  readonly blockedRuns: readonly string[]
  /** Operations whose dispatch state could not be observed before the restart. */
  readonly unknownOperations: readonly { runKey: string, operationKey: string, reason: string }[]
}

/**
 * Single-writer service over the plugin's own storage unit.
 *
 * @typert service webTestStore
 */
export class WebTestStore extends Service {
  /** Unit opened over the plugin-owned SQLite backend; absent until opened. */
  unit: KvUnit | undefined
  /** Current lifecycle state, readable even after this fiber is disposed. */
  state: PluginLifecycleState = 'active'
  /** Data root created at open time and reported in status. */
  dataRoot = ''
  /** Teardown in flight, joined by repeated drains. */
  draining: Promise<void> | undefined
  /** Why the unit did not open, kept so status can report the cause. */
  openError: string | undefined
  /** Readable records, held in memory so reads never re-parse the medium. */
  records: Tables = {}
  /** Tail of the write chain; every mutation appends to it. */
  writes: Promise<void> = Promise.resolve()
  /** What the last open found interrupted; empty on a clean first start. */
  reconciliation: ReconciliationReport = { blockedRuns: [], unknownOperations: [] }

  /**
   * @param ctx - Owning Context carrying the storage hub.
   */
  constructor(ctx: Context) {
    super(ctx, 'webTestStore')
  }

  /**
   * Whether new test actions may be dispatched right now.
   *
   * Tools and guards consult this rather than reading the fiber: an Agent that
   * retained a retired preset must still see the refusal.
   * @returns `true` only while the plugin is active and its unit is open.
   */
  get accepting(): boolean {
    return this.state === 'active' && this.unit !== undefined
  }

  /**
   * Return the store to active so a re-enabled plugin serves again.
   *
   * Disabling the bundle's root row drains this service, and the store row
   * itself is never disposed, so without re-arming here a re-enabled plugin
   * would stay `draining` until the host restarts. The next {@link open}
   * reopens the unit, because draining released it.
   */
  rearm(): void {
    this.heldRuns.clear()
    this.state = 'active'
    this.draining = undefined
    this.openError = undefined
    this.reconciliation = { blockedRuns: [], unknownOperations: [] }
  }

  /**
   * Open the plugin's own unit over its SQLite backend.
   *
   * The data root is created first so the backend's own directory handling never
   * widens permissions on a directory this plugin owns. A stored version the
   * schema does not accept rejects the open rather than producing empty-looking
   * tables, and a record that fails its table's schema rejects with the table
   * and key named instead of being dropped.
   * @param storage - The host's storage hub.
   * @returns the open unit.
   * @throws when the backend row is absent, the unit is already open, or the
   * medium carries a version or record shape this schema rejects.
   */
  async open(storage: Storage): Promise<KvUnit> {
    const open = this.unit
    if (open !== undefined) return open
    try {
      this.dataRoot = await ensureDataRoot()
      const backend = storage.backend.get(BACKEND_NAME)
      if (backend.kv === undefined) {
        throw new Error(`web-test: backend "${BACKEND_NAME}" serves no kv facet`)
      }
      const unit = await backend.kv.open(WEB_TEST_UNIT)
      this.records = await this.readRecords(unit)
      this.unit = unit
      this.reconciliation = await this.reconcileInterruptedWork()
      this.openError = undefined
    } catch (error) {
      this.openError = error instanceof Error ? error.message : String(error)
      throw error
    }
    return this.unit
  }

  /**
   * Load every table and validate each record against its declared schema.
   * @param unit - The open unit.
   * @returns the validated records keyed by table name.
   * @throws when a stored record does not match its table's schema.
   */
  private async readRecords(unit: KvUnit): Promise<Tables> {
    const snapshot = await unit.loadAll()
    const tables: Tables = {}
    for (const { table, schema } of TABLE_SCHEMAS) {
      const stored = snapshot.tables[table] ?? {}
      const accepted: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(stored)) {
        const parsed = schema.safeParse(value)
        if (!parsed.success) {
          throw new Error(`web-test: record ${table}/${key} does not match the current schema`)
        }
        accepted[key] = parsed.data
      }
      tables[table] = accepted
    }
    return tables
  }

  /**
   * Persist one record and adopt the stored value in memory.
   *
   * Appended to this service's write chain because the unit does not serialize
   * concurrent writes; the in-memory table only advances after the medium
   * resolves, so a failed write leaves the readable state unchanged.
   * @param table - Declared table name.
   * @param key - Record key.
   * @param value - Record to store, already validated by the caller.
   * @returns resolution after durability.
   */
  private write(table: string, key: string, value: unknown): Promise<void> {
    const unit = this.unit
    if (unit === undefined) return Promise.reject(new Error('web-test: storage is not open'))
    const pending: Promise<void> = this.writes.then(() => unit.putRecord(table, key, value))
    this.writes = pending.then(() => {
      const records = this.records[table]
      if (records !== undefined) records[key] = value
    }, () => {})
    return pending
  }

  /**
   * Store one project, replacing any record with the same key.
   * @param project - Validated project record.
   * @returns the stored record.
   */
  putProject(project: ProjectRecord): Promise<ProjectRecord> {
    return this.write(TABLE_PROJECTS, project.key, project).then(() => project)
  }

  /**
   * Every readable project, ordered by key so callers see a stable list.
   * @returns the stored project records.
   */
  listProjects(): ProjectRecord[] {
    return this.sorted(TABLE_PROJECTS) as ProjectRecord[]
  }

  /**
   * Store one environment declaration revision.
   * @param environment - Validated environment revision, keyed by its own `key`.
   * @returns the stored revision.
   */
  putEnvironment(environment: EnvironmentRevisionRecord): Promise<EnvironmentRevisionRecord> {
    return this.write(TABLE_ENVIRONMENT_REVISIONS, environment.key, environment)
      .then(() => environment)
  }

  /**
   * The root every run's evidence lives under.
   * @returns the absolute evidence root.
   */
  evidenceRoot(): string {
    return join(this.dataRoot, EVIDENCE_DIR)
  }

  /**
   * The directory this run's evidence belongs in, created on demand.
   *
   * The plugin owns evidence placement: a browser tool may write a file
   * anywhere, but only files the plugin can name and verify are recorded.
   * The directory is owner-only, so run evidence is not readable by other
   * local users.
   * @param runKey - Run whose evidence directory to prepare.
   * @returns the absolute directory path.
   */
  ensureEvidenceDir(runKey: string): string {
    const dir = evidenceDir(runKey)
    // The run's start is recorded once. `report_case` also asks for the
    // directory, and re-stamping it there would put the run's start after the
    // evidence it produced, making every genuine screenshot look stale.
    if (!this.runStartedAt.has(dir)) this.runStartedAt.set(dir, Date.now())
    // `mkdirSync`'s mode is masked by the umask and never applied to a
    // directory that already exists, so the mode is set explicitly afterwards.
    mkdirSync(dir, { recursive: true })
    chmodSync(dir, 0o700)
    return dir
  }

  /**
   * Apply an operator's control action to a running test.
   *
   * The held set is what the execution path reads, so a run the operator paused
   * or left waiting stops dispatching immediately rather than at the next model
   * turn, and only in the session that owns it.
   * @param runKey - Run to control.
   * @param action - What the operator asked for.
   * @returns the run record after the action.
   * @throws when no run carries that key, or the action contradicts its status.
   */
  async controlRun(runKey: string, action: RunControlAction): Promise<RunRecord> {
    const run = this.requireRun(runKey)
    const next = WebTestStore.nextStatus(run, action)
    if (next === undefined) {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} is ${run.status} and cannot ${action}`)
    }
    const record = {
      ...run,
      status: next,
      // Resuming or answering releases whatever the run was waiting for; only a
      // business-time wait keeps a deadline, and `resumeWait` clears that one.
      waitingUntilMs: next === 'running' ? run.waitingUntilMs : 0,
      waitingReason: next === 'running' ? run.waitingReason : '',
      updatedAtMs: Date.now(),
    }
    this.applyHold(record)
    return this.putRun(record)
  }

  /**
   * Park a run until a business deadline, persisting the deadline itself.
   *
   * The deadline is durable rather than an in-memory timer, so a wait for a
   * business event survives the host closing and the run reports when it may
   * continue the next time the host runs.
   * @param runKey - Run to park.
   * @param untilMs - Earliest moment the run may act again.
   * @param reason - What the run is waiting for, for the report and operator.
   * @returns the run record after the wait was recorded.
   * @throws when the run is not running, or the deadline is not in the future.
   */
  async waitUntil(runKey: string, untilMs: number, reason: string): Promise<RunRecord> {
    const run = this.requireRun(runKey)
    if (run.status !== 'running') {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} is ${run.status}; only a running run can wait for`
        + ' business time')
    }
    if (untilMs <= Date.now()) {
      throw new Error(`web-test: ${new Date(untilMs).toISOString()} is not in the future; a wait for business time`
        + ' needs a deadline the run has not reached yet')
    }
    const record = { ...run, status: 'awaiting-business-time' as const, waitingUntilMs: untilMs, waitingReason: reason, updatedAtMs: Date.now() }
    this.applyHold(record)
    return this.putRun(record)
  }

  /**
   * Release a business-time wait once its deadline has passed.
   * @param runKey - Run to release.
   * @returns the run record after the wait ended.
   * @throws when the run is not waiting, or its deadline has not arrived.
   */
  async resumeWait(runKey: string): Promise<RunRecord> {
    const run = this.requireRun(runKey)
    if (run.status !== 'awaiting-business-time') {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} is ${run.status} and is not waiting for business time`)
    }
    const remainingMs = run.waitingUntilMs - Date.now()
    if (remainingMs > 0) {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} waits until`
        + ` ${new Date(run.waitingUntilMs).toISOString()}, ${Math.ceil(remainingMs / 1000)}s from now. Check the page`
        + ' instead of waiting; do not repeat a case that already ran.')
    }
    const record = {
      ...run,
      status: 'running' as const,
      waitingUntilMs: 0,
      waitingReason: '',
      updatedAtMs: Date.now(),
    }
    this.applyHold(record)
    return this.putRun(record)
  }

  /**
   * The status an action produces, or undefined when the action is not allowed.
   *
   * A terminal status is terminal: a cancelled run stays cancelled because its
   * browser and evidence are gone, so re-enabling it would promise work that can
   * no longer be evidenced. Resuming returns a run straight to `running`, because
   * a pause leaves the session's browser alive and has nothing left to settle.
   * @param run - The run being controlled.
   * @param action - What the operator asked for.
   * @returns the resulting status, or undefined when the transition is invalid.
   */
  private static nextStatus(run: RunRecord, action: RunControlAction): RunRecord['status'] | undefined {
    if (TERMINAL_STATUSES.includes(run.status)) return undefined
    if (action === 'cancel') return 'cancelled'
    if (action === 'await-user') return run.status === 'running' ? 'awaiting-user' : undefined
    if (action === 'pause') return run.status === 'paused' ? undefined : 'paused'
    if (action === 'continue') return run.status === 'awaiting-user' ? 'running' : undefined
    if (run.status !== 'paused' && run.status !== 'resuming') return undefined
    return 'running'
  }

  /**
   * Read one run or refuse by name, so every control path names the same cause.
   * @param runKey - Run to read.
   * @returns the stored run.
   * @throws when no run carries that key.
   */
  private requireRun(runKey: string): RunRecord {
    const run = this.getRun(runKey)
    if (run === undefined) throw new Error(`web-test: no run ${JSON.stringify(runKey)}`)
    return run
  }

  /**
   * Keep the held set in step with a run's status.
   *
   * Only a status that means "not executing right now" holds. A cancelled run is
   * finished and never holds, because holding it would stop every later run in
   * the host and nothing would ever clear that hold.
   * @param record - The run record about to be stored.
   */
  private applyHold(record: RunRecord): void {
    if ((HELD_STATUSES as readonly string[]).includes(record.status)) {
      this.heldRuns.set(record.key, record.status as RunHoldStatus)
    } else {
      this.heldRuns.delete(record.key)
    }
  }

  /**
   * The held run that stops one session, if any.
   *
   * A hold is scoped to the run's owning session so a paused run does not stop an
   * unrelated session's work. A held run with no recorded owner stops every
   * session, because the plugin cannot tell whose work interrupting it would end.
   * @param sessionId - Session asking, or empty when the caller has none.
   * @returns the held run and the reason it is held.
   */
  /**
   * The session's active run and the role it is verified to be acting as.
   *
   * This is the whole browser authorisation: a browser tool is dispatched only
   * when the run it belongs to is executing and that run's role was confirmed
   * against the site. Cancelling a run therefore revokes its browser without
   * touching another run or another session, because a later run is a
   * different run with its own authorisation.
   * @param sessionId - Session asking.
   * @returns the run key, its status, and the verified role, or nothing when
   * the session has no run that may drive a browser.
   */
  browserGrantForSession(sessionId: string): { runKey: string, status: RunRecord['status'], role: string } | undefined {
    // Skipped runs are not the end of the search: a session that cancelled run
    // A and started run B owns both, and B is the one that may drive a
    // browser. Stopping at A's cancelled status would jam every later run,
    // which is the failure this guard has to avoid.
    for (const run of this.sorted(TABLE_RUNS) as RunRecord[]) {
      if (run.ownerSessionId !== sessionId) continue
      if (run.status !== 'running') continue
      // A running run with no confirmed role owns the session, and holding the
      // browser back is the answer rather than a reason to look elsewhere.
      if (run.activeRole === '' || this.verifiedAccount(run.key, run.activeRole) === '') return undefined
      return { runKey: run.key, status: run.status, role: run.activeRole }
    }
    return undefined
  }

  /**
   * The role the session's run is acting as right now.
   *
   * Read by the execution guard on every browser call, so browser reachability
   * follows the run's verified role rather than anything a model supplies.
   * @param sessionId - Session asking.
   * @returns the active role, or an empty string when none is set or verified.
   */
  activeRoleForSession(sessionId: string): string {
    for (const run of this.sorted(TABLE_RUNS) as RunRecord[]) {
      if (run.ownerSessionId !== sessionId) continue
      if (run.activeRole === '') return ''
      return this.verifiedAccount(run.key, run.activeRole) === '' ? '' : run.activeRole
    }
    return ''
  }

  holdForSession(sessionId: string): { runKey: string, status: RunHoldStatus } | undefined {
    for (const [runKey, status] of this.heldRuns) {
      const owner = this.getRun(runKey)?.ownerSessionId ?? ''
      if (owner === '' || owner === sessionId) return { runKey, status }
    }
    return undefined
  }

  /**
   * Every run an operator currently holds, for the Client's run list.
   * @returns the held runs and their reasons.
   */
  heldRunList(): { runKey: string, status: RunHoldStatus }[] {
    return [...this.heldRuns].map(([runKey, status]) => ({ runKey, status }))
  }

  /**
   * Store one run's record.
   * @param run - Validated run record, keyed by its run key.
   * @returns the stored run.
   */
  putRun(run: RunRecord): Promise<RunRecord> {
    return this.write(TABLE_RUNS, run.key, run).then(() => run)
  }

  /** Runs an operator held, so the execution path can refuse them by session. */
  private readonly authority = new Map<string, AuthorityToken>()
  private readonly heldRuns = new Map<string, RunHoldStatus>()

  /** When each run's evidence directory was prepared, so stale files can be refused. */
  private readonly runStartedAt = new Map<string, number>()

  /**
   * The moment this run's evidence directory was prepared.
   *
   * Evidence that predates the run cannot be this run's evidence, so a report
   * citing it is refused rather than recorded.
   * @param runKey - Run to read.
   * @returns the preparation time, or undefined when the run never prepared one.
   */
  runStartTime(runKey: string): number | undefined {
    return this.runStartedAt.get(evidenceDir(runKey))
  }

  /**
   * Read one run's current record.
   * @param runKey - Run to read.
   * @returns the stored run, or undefined when the key names no run.
   */
  getRun(runKey: string): RunRecord | undefined {
    const stored = this.records[TABLE_RUNS] as Record<string, RunRecord> | undefined
    return stored?.[runKey]
  }

  /**
   * Every run, in key order.
   * @returns the stored run records.
   */
  listRuns(): RunRecord[] {
    return this.sorted(TABLE_RUNS) as RunRecord[]
  }

  /**
   * Store one case's structured result.
   * @param result - Validated case result, keyed by its own `key`.
   * @returns the stored result.
   */
  /**
   * Store one proposed case, or the operator's ruling on it.
   * @param plan - Validated case plan, keyed by `<runKey>/<caseKey>`.
   * @returns the stored plan.
   */
  putCasePlan(plan: CasePlanRecord): Promise<CasePlanRecord> {
    return this.write(TABLE_CASE_PLANS, plan.key, plan).then(() => plan)
  }

  /**
   * Read one case plan.
   * @param runKey - Run the case belongs to.
   * @param caseKey - Case to read.
   * @returns the stored plan, or undefined when the run proposed no such case.
   */
  getCasePlan(runKey: string, caseKey: string): CasePlanRecord | undefined {
    const stored = this.records[TABLE_CASE_PLANS] as Record<string, CasePlanRecord> | undefined
    return stored?.[`${runKey}/${caseKey}`]
  }

  /**
   * Apply the operator's ruling on one proposed case.
   *
   * Ruling is an operator action rather than a model action, so it changes the
   * stored status and nothing else; a case the operator rejected can never be
   * executed, and a case left `proposed` is not executable either.
   * @param runKey - Run the case belongs to.
   * @param caseKey - Case to rule on.
   * @param decision - Whether the operator approved the case.
   * @param note - Why the operator decided this way.
   * @returns the plan after the ruling.
   * @throws when the run proposed no such case, or it was already ruled on.
   */
  async ruleOnCase(
    runKey: string,
    caseKey: string,
    decision: 'confirm' | 'reject',
    note: string,
  ): Promise<CasePlanRecord> {
    const existing = this.getCasePlan(runKey, caseKey)
    if (existing === undefined) {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} proposed no case ${JSON.stringify(caseKey)}`)
    }
    if (existing.status !== 'proposed') {
      throw new Error(`web-test: case ${JSON.stringify(caseKey)} is already ${existing.status} and cannot be`
        + ` ${decision === 'confirm' ? 'confirmed' : 'rejected'} again`)
    }
    const record: CasePlanRecord = {
      ...existing,
      status: decision === 'confirm' ? 'confirmed' : 'rejected',
      notes: note === '' ? existing.notes : note,
      confirmedAtMs: Date.now(),
      updatedAtMs: Date.now(),
    }
    return this.putCasePlan(record)
  }

  putCaseResult(result: CaseResultRecord): Promise<CaseResultRecord> {
    return this.write(TABLE_CASE_RESULTS, result.key, result).then(() => result)
  }

  /**
   * Record the intent to perform one business-changing operation, durably, before
   * the action that causes it.
   *
   * The record is written in `dispatching` on purpose: a transport loss or a
   * crash after this point may or may not have reached the business system, and
   * the honest state of that operation is `unknown`, not "not done". An operation
   * already in an unresolved state is refused, so replanning or renaming an
   * intent cannot become a second submission of the same change.
   * @param runKey - Run that will perform the operation.
   * @param operationKey - Short id the run names this operation by.
   * @param intent - The business change, for the report.
   * @param requestDigest - Digest of the request, so a repeat is recognisable.
   * @param role - Role performing it; must be declared by the run's environment.
   * @returns the stored operation record.
   * @throws when the run is not executing, the role is undeclared, or the
   * operation's outcome is already unresolved.
   */
  async beginOperation(
    runKey: string,
    operationKey: string,
    intent: string,
    requestDigest: string,
    role: string,
  ): Promise<OperationRecord> {
    const run = this.requireRun(runKey)
    if (run.status !== 'running') {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} is ${run.status}; only a running run may change business`
        + ' data')
    }
    const effectiveRole = this.requireDeclaredRole(run, role)
    const existing = this.getOperation(runKey, operationKey)
    if (existing !== undefined && UNRESOLVED_DISPATCHES.includes(existing.dispatch.kind)) {
      throw new Error(`web-test: operation ${JSON.stringify(operationKey)} of run ${JSON.stringify(runKey)} is`
        + ` ${existing.dispatch.kind}; its outcome is unresolved, so it must not be submitted again. Settle it or`
        + ' reconcile it with the operator, and use a new operation for genuinely new work.')
    }
    // The operation key is chosen by the run, so it is not a repeat guard: a
    // retry under a fresh name passes the check above. The request digest is
    // what identifies the business change, so a digest this run already
    // dispatched is refused whatever it is called. Without this a run could
    // change the same business data twice while every operation record looked
    // like separate work.
    const sameRequest = (this.sorted(TABLE_OPERATIONS) as OperationRecord[])
      .find(operation => operation.runKey === runKey
        && operation.requestDigest === requestDigest
        && operation.operationKey !== operationKey)
    if (sameRequest !== undefined) {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} already dispatched this exact request as operation`
        + ` ${JSON.stringify(sameRequest.operationKey)} (${sameRequest.dispatch.kind}); a request digest identifies one`
        + ' business change, so submitting it again under a new operation key would change the data a second time.'
        + ' Reconcile the earlier operation with the operator instead.')
    }
    const record = operationRecordSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      kind: 'operation',
      key: `${runKey}/${operationKey}`,
      label: intent,
      updatedAtMs: Date.now(),
      runKey,
      operationKey,
      intent,
      role: effectiveRole,
      requestDigest,
      dispatch: { kind: 'dispatching' },
    })
    return this.putOperation(record)
  }

  /**
   * Settle one operation from an observation independent of the dispatch.
   * @param runKey - Run that performed the operation.
   * @param operationKey - Operation to settle.
   * @param outcome - What the observation established.
   * @returns the stored operation record.
   * @throws when the operation does not exist or was never dispatched, because
   * an outcome for an undispatched operation would invent a business effect.
   */
  async settleOperation(
    runKey: string,
    operationKey: string,
    outcome: 'observed-success' | 'observed-absent',
  ): Promise<OperationRecord> {
    const existing = this.getOperation(runKey, operationKey)
    if (existing === undefined) {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} has no operation ${JSON.stringify(operationKey)}`)
    }
    if (existing.dispatch.kind === 'not-dispatched') {
      throw new Error(`web-test: operation ${JSON.stringify(operationKey)} was never dispatched, so it has no`
        + ' outcome to record')
    }
    if (existing.dispatch.kind === 'settled') {
      throw new Error(`web-test: operation ${JSON.stringify(operationKey)} is already settled as`
        + ` ${existing.dispatch.outcome}; a second settlement would overwrite the first observation`)
    }
    return this.putOperation({ ...existing, dispatch: { kind: 'settled', outcome }, updatedAtMs: Date.now() })
  }

  /**
   * Record that an operation's outcome could not be observed.
   *
   * This is the live equivalent of what a restart finds: the operation may or
   * may not have reached the business system, so it stays unresolved until an
   * operator settles it, and it is never dispatched again.
   * @param runKey - Run that attempted the operation.
   * @param operationKey - Operation whose outcome is unknown.
   * @param reason - What was observed to be lost.
   * @returns the stored operation record.
   * @throws when the operation does not exist or is already settled.
   */
  async markOperationUnknown(runKey: string, operationKey: string, reason: string): Promise<OperationRecord> {
    const existing = this.getOperation(runKey, operationKey)
    if (existing === undefined) {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} has no operation ${JSON.stringify(operationKey)}`)
    }
    if (existing.dispatch.kind === 'settled') {
      throw new Error(`web-test: operation ${JSON.stringify(operationKey)} is already settled as`
        + ` ${existing.dispatch.outcome}; an observed outcome is not replaced by a loss report`)
    }
    if (existing.dispatch.kind === 'unknown') return existing
    return this.putOperation({ ...existing, dispatch: { kind: 'unknown', reason }, updatedAtMs: Date.now() })
  }

  /**
   * Store one operation's record, replacing any record with the same key.
   * @param operation - Validated operation record.
   * @returns the stored operation.
   */
  putOperation(operation: OperationRecord): Promise<OperationRecord> {
    return this.write(TABLE_OPERATIONS, operation.key, operation).then(() => operation)
  }

  /**
   * Read one operation of one run.
   * @param runKey - Run that owns the operation.
   * @param operationKey - Operation to read.
   * @returns the stored operation, or undefined when the run has no such operation.
   */
  getOperation(runKey: string, operationKey: string): OperationRecord | undefined {
    const stored = this.records[TABLE_OPERATIONS] as Record<string, OperationRecord> | undefined
    return stored?.[`${runKey}/${operationKey}`]
  }

  /**
   * Every operation of one run, in key order.
   * @param runKey - Run whose operations to read.
   * @returns the stored operation records.
   */
  listOperations(runKey?: string): OperationRecord[] {
    const all = this.sorted(TABLE_OPERATIONS) as OperationRecord[]
    return runKey === undefined ? all : all.filter(operation => operation.runKey === runKey)
  }

  /**
   * The operations of one run whose outcome is not yet established.
   * @param runKey - Run whose operations to read.
   * @returns the unresolved operation records.
   */
  unresolvedOperations(runKey: string): OperationRecord[] {
    return this.listOperations(runKey).filter(operation => operation.dispatch.kind !== 'settled')
  }

  /**
   * Choose the role a run acts as, refusing a role the environment never declared.
   *
   * Role isolation starts from the declaration: a case may only act as a role the
   * operator listed, and a role may not change while a business-changing operation
   * is unresolved, because the run could not say which account produced that
   * effect.
   * @param runKey - Run changing role.
   * @param role - Role to act as; empty clears the current role.
   * @returns the run record after the change.
   * @throws when the run is not running, the role is undeclared, or an operation
   * is still unresolved.
   */
  async assumeRole(runKey: string, role: string, verified: VerifiedIdentity): Promise<RunRecord> {
    const run = this.requireRun(runKey)
    if (run.status !== 'running') {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} is ${run.status}; only a running run can change role`)
    }
    const unresolved = this.unresolvedOperations(runKey)
    if (unresolved.length > 0) {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} still has ${unresolved.length} unresolved`
        + ` operation(s) (${unresolved.map(operation => operation.operationKey).join(', ')}); settle them before`
        + ' changing role, because the effect they may have had belongs to the current account')
    }
    const declared = this.requireDeclaredRole(run, role)
    // The account a role is expected to present comes from the confirmed
    // environment, not from anything the run supplies at switch time. A model
    // that named its own expected account could satisfy the check with the
    // wrong one.
    const expected = this.expectedAccount(run, declared)
    if (expected !== '' && verified.account !== expected) {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} confirmed role ${JSON.stringify(declared)} as`
        + ` ${JSON.stringify(verified.account)}, but that role is bound to ${JSON.stringify(expected)} in`
        + ` environment ${JSON.stringify(run.environmentRevisionKey)}; sign that account in before switching.`
        + ` The page said: ${verified.detail}`)
    }
    // The role field is written only after the browser answered as that
    // account, so the record never claims an identity the site did not
    // confirm. A failed check throws above and leaves the previous role in
    // place rather than falling back to it.
    // Clearing a role records nothing: there is no account to have confirmed,
    // and a stale identity would keep a later browser grant alive.
    if (declared !== '') await this.putIdentity(runKey, declared, verified)
    return this.putRun({ ...run, activeRole: declared, updatedAtMs: Date.now() })
  }

  /**
   * Mint the authority one verified role hands to the actions it may perform.
   *
   * The token names the run, the generation it was minted in, the agent that
   * holds it and the role it is for. It is random and unforgeable, so a caller
   * cannot assert its own authority the way it can assert a run key; every later
   * check re-reads the run rather than trusting the token's own claims.
   * @param runKey - Run whose verified role the authority belongs to.
   * @param agentId - Agent the authority is issued to.
   * @returns the token, or undefined when the run has no verified role.
   */
  mintAuthority(runKey: string, agentId: string): AuthorityToken | undefined {
    const run = this.requireRun(runKey)
    if (run.activeRole === '' || run.status !== 'running') return undefined
    if (this.verifiedAccount(runKey, run.activeRole) === '') return undefined
    const authority: AuthorityToken = {
      token: randomUUID(),
      runKey,
      generation: run.generation,
      agentId,
      role: run.activeRole,
      grantedAtMs: Date.now(),
    }
    this.authority.set(authority.token, authority)
    return authority
  }

  /**
   * Check a token against the run it names, right now.
   *
   * The run's own status and generation decide, so a token minted before a run
   * was cancelled, restarted or resumed stops working without anything having to
   * revoke it, and a token from one run can never act under another.
   * @param token - The token a call presented.
   * @param agentId - The agent making the call.
   * @returns the authority when it is still valid.
   * @throws when the token is unknown, belongs to another agent, or names a run
   * that is no longer running at the generation the token was minted in.
   */
  requireAuthority(token: string, agentId: string): AuthorityToken {
    const authority = this.authority.get(token)
    if (authority === undefined) {
      throw new Error('web-test: this call presented no valid authority; call web_test_assume_role and use the token it returns')
    }
    if (authority.agentId !== agentId) {
      throw new Error(`web-test: that authority belongs to another agent (${JSON.stringify(authority.agentId)}); it cannot be carried into this one`)
    }
    const run = this.records[TABLE_RUNS] as Record<string, RunRecord>
    const current = run[authority.runKey]
    if (current === undefined) {
      throw new Error(`web-test: authority names run ${JSON.stringify(authority.runKey)}, which no longer exists`)
    }
    if (current.status !== 'running') {
      throw new Error(`web-test: authority names run ${JSON.stringify(authority.runKey)}, which is ${current.status}; only a running run may act`)
    }
    if (current.generation !== authority.generation) {
      throw new Error(`web-test: authority was minted in generation ${authority.generation} of run ${JSON.stringify(authority.runKey)}, which is now generation ${current.generation}; act under the authority this generation gave out`)
    }
    if (current.activeRole !== authority.role || this.verifiedAccount(authority.runKey, authority.role) === '') {
      throw new Error(`web-test: run ${JSON.stringify(authority.runKey)} no longer holds a verified ${JSON.stringify(authority.role)}; verify the role again`)
    }
    return authority
  }

  /**
   * Read the recorded identity of one role.
   * @param runKey - Run to read.
   * @param role - Declared role name.
   * @returns the record, or undefined when the role was never verified.
   */
  getRoleIdentity(runKey: string, role: string): RoleIdentityRecord | undefined {
    const stored = this.records[TABLE_ROLE_IDENTITIES] as Record<string, RoleIdentityRecord> | undefined
    return stored?.[`${runKey}/${role}`]
  }

  /**
   * Store one role's verified identity.
   * @param record - The identity to store.
   * @returns the stored record.
   */
  async putRoleIdentity(record: RoleIdentityRecord): Promise<RoleIdentityRecord> {
    return this.write(TABLE_ROLE_IDENTITIES, record.key, roleIdentityRecordSchema.parse(record))
      .then(() => record)
  }

  /**
   * Record the account a role's browser actually presented.
   *
   * A separate record rather than a field on the run, so a report can say
   * which account produced which case and a later switch cannot overwrite the
   * evidence that the previous role really was signed in.
   * @param runKey - Run the identity belongs to.
   * @param role - Declared role name.
   * @param verified - What the site answered for that role's browser.
   */
  private async putIdentity(runKey: string, role: string, verified: VerifiedIdentity): Promise<void> {
    await this.putRoleIdentity({
      schemaVersion: SCHEMA_VERSION,
      kind: 'role-identity',
      key: `${runKey}/${role}`,
      runKey,
      role,
      account: verified.account,
      detail: verified.detail,
      verifiedAtMs: Date.now(),
      label: `${role} as ${verified.account === '' ? 'no account' : verified.account}`,
      updatedAtMs: Date.now(),
    })
  }

  /**
   * The account a role's browser presented when it was last switched to.
   * @param runKey - Run to read.
   * @param role - Declared role name.
   * @returns the verified account, or an empty string when never verified.
   */
  verifiedAccount(runKey: string, role: string): string {
    return this.getRoleIdentity(runKey, role)?.account ?? ''
  }

  /**
   * Whether a run may prepare a role's identity in that role's browser.
   *
   * This is the preparation step, not access: it is what lets a person sign in
   * before the role is verified. It is scoped to a run that is executing and
   * owns the named role, so it cannot be used to reach another role's account,
   * another run, or another session.
   * @param sessionId - Session asking.
   * @param role - Role whose browser is being prepared.
   * @returns true when the session has a running run that declares the role.
   */
  /**
   * Every role any confirmed environment declares.
   *
   * A Web testing agent can drive exactly these roles. Environments confirmed
   * later are not covered, because the provider only defines a server's tools
   * on an agent as that agent is created.
   * @returns role names, without duplicates and in a stable order.
   */
  confirmedRoles(): string[] {
    const roles = new Set<string>()
    for (const project of this.sorted(TABLE_PROJECTS) as ProjectRecord[]) {
      for (const environment of this.listEnvironments(project.key)) {
        for (const role of environment.roles) roles.add(role.name)
      }
    }
    return [...roles].sort()
  }

  mayPrepareIdentity(sessionId: string, role: string): boolean {
    if (role === '') return false
    for (const run of this.sorted(TABLE_RUNS) as RunRecord[]) {
      if (run.ownerSessionId !== sessionId) continue
      if (run.status !== 'running') continue
      if (this.declaredRoles(run.key).includes(role)) return true
    }
    return false
  }

  /**
   * The account a declared role is bound to.
   *
   * A role whose `accountRef` names an account binds the role to it, so the
   * switch is checked against the environment the operator confirmed rather
   * than against a value the run produces. An `accountRef` that is not a
   * concrete account name (`ref:...`) binds nothing and returns an empty
   * string, which leaves the switch allowed but unverified against a name.
   * @param run - Run whose environment holds the binding.
   * @param role - Declared role name.
   * @returns the expected account, or an empty string when none is bound.
   */
  expectedAccount(run: RunRecord, role: string): string {
    if (role === '') return ''
    const environment = this.listEnvironments(run.projectKey)
      .find(candidate => candidate.key === run.environmentRevisionKey)
    const declared = environment?.roles.find(candidate => candidate.name === role)
    if (declared === undefined) return ''
    return declared.accountRef.startsWith('ref:') ? '' : declared.accountRef
  }

  /**
   * Every role the run's environment declares.
   *
   * Read at run start so a role's browser can be started before the model asks
   * to act as it: the browser provider hands an MCP server's tools to an Agent
   * when that Agent is created, so a browser started mid-turn is not callable
   * until the next one.
   * @param runKey - Run whose environment to read.
   * @returns the declared role names.
   * @throws when the run names an environment that is not stored.
   */
  declaredRoles(runKey: string): string[] {
    const run = this.requireRun(runKey)
    const environment = this.listEnvironments(run.projectKey)
      .find(candidate => candidate.key === run.environmentRevisionKey)
    if (environment === undefined) {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} names environment`
        + ` ${JSON.stringify(run.environmentRevisionKey)}, which is not stored`)
    }
    return environment.roles.map(role => role.name)
  }

  /**
   * Resolve a role name against the run's environment declaration.
   * @param run - Run the role would act for.
   * @param role - Role name, empty to clear it.
   * @returns the role name, empty when the run acts without one.
   * @throws when the environment never declared that role.
   */
  private requireDeclaredRole(run: RunRecord, role: string): string {
    if (role === '') return ''
    const stored = this.records[TABLE_ENVIRONMENT_REVISIONS] as Record<string, EnvironmentRevisionRecord> | undefined
    const environment = stored?.[run.environmentRevisionKey]
    if (environment === undefined) {
      throw new Error(`web-test: run ${JSON.stringify(run.key)} names environment`
        + ` ${JSON.stringify(run.environmentRevisionKey)}, which is not stored, so no role can be authorised`)
    }
    if (!environment.roles.some(declared => declared.name === role)) {
      throw new Error(`web-test: environment ${JSON.stringify(environment.key)} declares`
        + ` [${environment.roles.map(declared => declared.name).join(', ')}]; role ${JSON.stringify(role)} was not`
        + ' declared, so the run may not act as it')
    }
    return role
  }

  /**
   * Settle what a restart interrupted, instead of resuming it blindly.
   *
   * An operation that was in flight when the process stopped has an unobserved
   * outcome, so it becomes `unknown` and is never dispatched again. A run that
   * was still executing becomes `resuming`: it is neither executing nor a state
   * the operator chose, so it waits for an explicit continuation and refuses new
   * test actions meanwhile.
   *
   * A run that was already waiting keeps waiting. A wait for business time owns
   * a stored deadline that outlives the process, and a wait for an answer is
   * waiting on a person, so neither is something a restart decides. A
   * user-paused or cancelled run likewise keeps the state the operator chose.
   * @returns what the restart found that needs a decision.
   */
  private async reconcileInterruptedWork(): Promise<ReconciliationReport> {
    const unknownOperations: { runKey: string, operationKey: string, reason: string }[] = []
    for (const operation of this.sorted(TABLE_OPERATIONS) as OperationRecord[]) {
      if (operation.dispatch.kind !== 'dispatching' && operation.dispatch.kind !== 'dispatched') continue
      // A store reopen also happens when the plugin is disabled and re-enabled
      // in one process, so naming only a restart would tell the operator
      // something that did not happen.
      const reason = 'the plugin reopened its store (a host restart, or a disable and re-enable) while this operation was'
        + ' in flight, so its outcome was never observed; it must be reconciled with the operator, not repeated'
      await this.markOperationUnknown(operation.runKey, operation.operationKey, reason)
      unknownOperations.push({ runKey: operation.runKey, operationKey: operation.operationKey, reason })
    }
    const blockedRuns: string[] = []
    for (const run of this.sorted(TABLE_RUNS) as RunRecord[]) {
      // `resuming` is already this state: a previous open parked it and nobody
      // continued it, so re-parking it would only overwrite its reason.
      if (TERMINAL_STATUSES.includes(run.status) || PRESERVED_ACROSS_RESTART.includes(run.status)) continue
      const record: RunRecord = {
        ...run,
        status: 'resuming',
        waitingUntilMs: 0,
        waitingReason: 'the plugin reopened its store (a host restart, or a disable and re-enable) while this run was executing; check the environment, the login,'
          + ' and every unresolved operation, then continue it deliberately with controlRun(run, "resume")',
        updatedAtMs: Date.now(),
      }
      this.applyHold(record)
      await this.putRun(record)
      blockedRuns.push(run.key)
    }
    return { blockedRuns, unknownOperations }
  }

  /**
   * Refuse recording into a run that is not executing.
   *
   * A result may only describe steps the run actually performed while it was
   * running, so a paused, waiting, cancelled or restart-interrupted run does not
   * accept new results; it must be continued first.
   * @param runKey - Run to check.
   * @returns the run, which is executing.
   * @throws when the run is missing or is not running.
   */
  requireExecutable(runKey: string): RunRecord {
    const run = this.requireRun(runKey)
    if (run.status !== 'running') {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} is ${run.status}; only a running run may record new`
        + ' results. Continue it deliberately before reporting more work.')
    }
    return run
  }

  /**
   * Every recorded result of one run, in key order.
   * @param runKey - Run whose case results to read.
   * @returns the stored case results.
   */
  /**
   * Every proposed case of one run, in key order.
   * @param runKey - Run whose cases to read.
   * @returns the stored case plans.
   */
  listCasePlans(runKey: string): CasePlanRecord[] {
    return (this.sorted(TABLE_CASE_PLANS) as CasePlanRecord[])
      .filter(plan => plan.runKey === runKey)
  }

  listCaseResults(runKey: string): CaseResultRecord[] {
    return (this.sorted(TABLE_CASE_RESULTS) as CaseResultRecord[])
      .filter(result => result.runKey === runKey)
  }

  /**
   * Every declared entry point of a project, newest revision first.
   * @param projectKey - Project whose entry points to read.
   * @returns the stored environment revisions.
   */
  listEnvironments(projectKey: string): EnvironmentRevisionRecord[] {
    return (this.sorted(TABLE_ENVIRONMENT_REVISIONS) as EnvironmentRevisionRecord[])
      .filter(environment => environment.projectKey === projectKey)
  }

  /**
   * Store one project's execution policy.
   * @param policy - Validated policy record, keyed by its own `key`.
   * @returns the stored policy.
   */
  putPolicy(policy: PolicyRecord): Promise<PolicyRecord> {
    return this.write(TABLE_POLICIES, policy.key, policy).then(() => policy)
  }

  /**
   * The records of one table in key order, so every list is stable.
   * @param table - Declared table name.
   * @returns the stored records sorted by key.
   */
  private sorted(table: string): unknown[] {
    const stored = this.records[table] ?? {}
    return Object.keys(stored).sort().map(key => stored[key])
  }

  /**
   * Count the records currently readable in each declared table.
   *
   * Reading this also proves the unit opened over its medium: an unreadable or
   * unknown-version store refuses to open rather than report zeros.
   * @returns record counts keyed by record kind.
   */
  recordCounts(): PluginStatus['recordCounts'] {
    const size = (table: string): number => Object.keys(this.records[table] ?? {}).length
    return {
      project: size(TABLE_PROJECTS),
      'environment-revision': size(TABLE_ENVIRONMENT_REVISIONS),
      run: size(TABLE_RUNS),
      policy: size(TABLE_POLICIES),
      'case-result': size(TABLE_CASE_RESULTS),
      operation: size(TABLE_OPERATIONS),
      'case-plan': size(TABLE_CASE_PLANS),
      'role-identity': size(TABLE_ROLE_IDENTITIES),
    }
  }

  /**
   * Refuse new dispatches, then close the unit once queued writes settle.
   *
   * The state flips before the close is awaited so a concurrent dispatch is
   * refused for the whole teardown window, not only after the unit released its
   * backend. Idempotent: a second call joins the first teardown.
   * @returns resolution after the unit released its backend.
   */
  async drain(): Promise<void> {
    this.state = 'draining'
    this.draining ??= (async () => {
      const unit = this.unit
      if (unit === undefined) return
      // Settle the write chain first: closing mid-write would drop a record
      // whose outcome is unknown, and an unknown outcome must never be retried.
      await this.writes.catch(() => {})
      await unit.close()
      this.unit = undefined
    })()
    await this.draining
  }

  /**
   * Snapshot for the Client: proves the Host half loaded and the plugin's own
   * storage answers.
   * @returns the plugin status, or `undefined` before the unit opened.
   */
  /**
   * What is waiting on the operator right now.
   *
   * A run a restart parked stays in that state until somebody continues it, so
   * the backlog outlives the startup report that first mentioned it. Operations
   * left `unknown` are listed with the reason, because those are the ones that
   * must not be repeated.
   * @returns the runs and operations awaiting a decision.
   */
  private needsDecision(): PluginStatus['needsDecision'] {
    const runs = (this.sorted(TABLE_RUNS) as RunRecord[])
      .filter(run => DECISION_STATUSES.includes(run.status))
      .map(run => ({ runKey: run.key, status: run.status, reason: decisionReason(run) }))
    const unknownOperations = (this.sorted(TABLE_OPERATIONS) as OperationRecord[])
      .filter(operation => operation.dispatch.kind === 'unknown')
      .map(operation => ({
        runKey: operation.runKey,
        operationKey: operation.operationKey,
        intent: operation.intent,
        reason: operation.dispatch.kind === 'unknown' ? operation.dispatch.reason : '',
      }))
    return { runs, unknownOperations }
  }

  status(): PluginStatus | undefined {
    if (this.unit === undefined) return undefined
    return {
      version: PLUGIN_VERSION,
      state: this.state,
      dataRoot: this.dataRoot,
      schemaVersion: SCHEMA_VERSION,
      recordCounts: this.recordCounts(),
      dshVersion: COMPATIBLE_DSH_VERSION,
      needsDecision: this.needsDecision(),
      reconciliation: this.reconciliation,
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Single-writer service over the plugin's own business data. */
    webTestStore: WebTestStore
  }
}

export default WebTestStore
