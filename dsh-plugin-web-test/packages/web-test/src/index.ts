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
import { PRESET_ID, name as AGENT_ROW } from './agent.ts'
import { buildReport } from './report.ts'
import { environmentRevisionRecordSchema, policyRecordSchema, projectRecordSchema } from './records.ts'
import type { CaseResultRecord, EnvironmentRevisionRecord, PolicyRecord, ProjectRecord, RunRecord } from './types.ts'

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
  static inject = ['webTestStore']


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
    return this.ctx.webTestStore.putEnvironment(record)
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
   * Pause, resume, or cancel one run.
   *
   * This is the operator's side of the control surface: it changes the run's
   * status and the execution path's held set, so a paused or cancelled run
   * stops dispatching without waiting for the model's next turn.
   * @param runKey - Run to control.
   * @param action - What the operator asked for.
   * @returns the run record after the action.
   * @throws when the plugin is draining, no run carries that key, or the action
   * contradicts the run's current status.
   */
  @Remote
  async controlRun(runKey: string, action: 'pause' | 'resume' | 'cancel'): Promise<RunRecord> {
    this.acceptingGuard()
    return this.ctx.webTestStore.controlRun(runKey, action)
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
   * Build one run's report from its recorded case results.
   * @param runKey - Run to report on.
   * @returns the report in Markdown.
   * @throws when the plugin is draining.
   */
  @Remote
  buildReport(runKey: string): { markdown: string } {
    this.acceptingGuard()
    return { markdown: buildReport(runKey, this.ctx.webTestStore.listCaseResults(runKey)) }
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


export default WebTestService

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Web testing service; also the plugin's typed Remote namespace. */
    webTest: WebTestService
  }
}
