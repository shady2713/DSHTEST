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
import type { Context } from '@deepseek-ai/cordis'
import type { KvUnit, Storage } from '@deepseek-ai/dsh-storage'
import {
  SCHEMA_VERSION,
  caseResultRecordSchema,
  environmentRevisionRecordSchema,
  policyRecordSchema,
  projectRecordSchema,
  runRecordSchema,
} from './records.ts'
import {
  BACKEND_NAME,
  TABLE_CASE_RESULTS,
  TABLE_ENVIRONMENT_REVISIONS,
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
  PluginLifecycleState,
  RunRecord,
  PluginStatus,
  PolicyRecord,
  ProjectRecord,
} from './types.ts'

/** Plugin version, matching this package's manifest. */
export const PLUGIN_VERSION = '0.1.1'

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
] as const

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
   * The held set is what the execution path reads, so a paused or cancelled
   * run stops dispatching immediately rather than at the next model turn.
   * @param runKey - Run to control.
   * @param action - What the operator asked for.
   * @returns the run record after the action.
   * @throws when no run carries that key, or the action contradicts its status.
   */
  async controlRun(runKey: string, action: 'pause' | 'resume' | 'cancel'): Promise<RunRecord> {
    const run = this.getRun(runKey)
    if (run === undefined) throw new Error(`web-test: no run ${JSON.stringify(runKey)}`)
    const next = WebTestStore.nextStatus(run, action)
    if (next === undefined) {
      throw new Error(`web-test: run ${JSON.stringify(runKey)} is ${run.status} and cannot ${action}`)
    }
    const record = { ...run, status: next, updatedAtMs: Date.now() }
    // Only a paused run is held. A cancelled run is finished: holding it would
    // block every later run in the host, and a cancelled run can never be
    // resumed, so nothing would ever clear that hold.
    if (next === 'paused') this.heldRuns.set(runKey, next)
    else this.heldRuns.delete(runKey)
    return this.putRun(record)
  }

  /**
   * The status an action produces, or undefined when the action is not allowed.
   * @param run - The run being controlled.
   * @param action - What the operator asked for.
   * @returns the resulting status, or undefined when the transition is invalid.
   */
  private static nextStatus(run: RunRecord, action: 'pause' | 'resume' | 'cancel'): RunRecord['status'] | undefined {
    if (action === 'cancel') return run.status === 'cancelled' ? undefined : 'cancelled'
    if (action === 'pause') return run.status === 'paused' ? undefined : 'paused'
    // Resuming returns the run straight to `running`. A pause leaves the
    // session's browser alive, so there is no re-establishment phase to
    // represent and the run has nothing left to settle before acting again. A
    // cancelled run stays cancelled, because its browser and evidence are gone.
    if (run.status !== 'paused') return undefined
    return 'running'
  }

  /**
   * The first run currently stopped by an operator, if any.
   *
   * The execution path consults this before dispatching any test action, so a
   * held run is enforced where the action happens rather than by asking the
   * model to behave.
   * @returns the held run and its status, or undefined when none is held.
   */
  heldRun(): { runKey: string, status: 'paused' } | undefined {
    for (const [runKey, status] of this.heldRuns) return { runKey, status }
    return undefined
  }

  /**
   * Store one run's record.
   * @param run - Validated run record, keyed by its run key.
   * @returns the stored run.
   */
  putRun(run: RunRecord): Promise<RunRecord> {
    return this.write(TABLE_RUNS, run.key, run).then(() => run)
  }

  /** Runs an operator has paused, so the execution path can refuse them. */
  private readonly heldRuns = new Map<string, 'paused'>()

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
  putCaseResult(result: CaseResultRecord): Promise<CaseResultRecord> {
    return this.write(TABLE_CASE_RESULTS, result.key, result).then(() => result)
  }

  /**
   * Every recorded result of one run, in key order.
   * @param runKey - Run whose case results to read.
   * @returns the stored case results.
   */
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
  status(): PluginStatus | undefined {
    if (this.unit === undefined) return undefined
    return {
      version: PLUGIN_VERSION,
      state: this.state,
      dataRoot: this.dataRoot,
      schemaVersion: SCHEMA_VERSION,
      recordCounts: this.recordCounts(),
      dshVersion: COMPATIBLE_DSH_VERSION,
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
