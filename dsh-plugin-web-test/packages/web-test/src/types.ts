/**
 * Business vocabulary owned by the Web testing plugin.
 *
 * Record types are derived from the Zod schemas in `records.ts`, so the
 * TypeScript shape and the validated durable shape cannot drift. The remaining
 * types here describe values that never reach the medium.
 *
 * These types are deliberately independent of DSH Session events: the plugin
 * stores business truth in its own storage domain and projects model-visible
 * facts through ordinary DSH tool inputs and results, so history stays
 * readable when the plugin is absent.
 *
 * @module dsh-plugin-web-test/types
 */

import type { z } from 'zod'
import type {
  casePlanRecordSchema,
  caseResultRecordSchema,
  environmentRevisionRecordSchema,
  operationRecordSchema,
  policyRecordSchema,
  operationDispatchSchema,
  projectRecordSchema,
  roleIdentityRecordSchema,
  runHoldStatusSchema,
  runRecordSchema,
} from './records.ts'

/** A Web testing project. */
export type ProjectRecord = z.infer<typeof projectRecordSchema>
/** One revision of a project's environment declaration. */
export type EnvironmentRevisionRecord = z.infer<typeof environmentRevisionRecordSchema>
/** One test run and its control state. */
export type RunRecord = z.infer<typeof runRecordSchema>
/** Dispatch state of one business-changing operation. */
export type OperationDispatch = z.infer<typeof operationDispatchSchema>
/** One business-changing operation, durable before the action that causes it. */
export type OperationRecord = z.infer<typeof operationRecordSchema>

/** One verified role's authority to perform business actions. */
export interface AuthorityToken {
  /** Unforgeable id the call presents; the record behind it is re-read on use. */
  token: string
  /** Run whose verified role this authority belongs to. */
  runKey: string
  /** Run generation this authority was minted in. */
  generation: number
  /** Agent this authority is issued to; another agent cannot present it. */
  agentId: string
  /** Verified role the authority acts as. */
  role: string
  /** When the authority was minted. */
  grantedAtMs: number
}

/** Every durable record kind this plugin stores. */
export type PolicyRecord = z.infer<typeof policyRecordSchema>

export type CaseResultRecord = z.infer<typeof caseResultRecordSchema>
export type CasePlanRecord = z.infer<typeof casePlanRecordSchema>
export type PlannedStep = CasePlanRecord['steps'][number]
export type StepResult = CaseResultRecord['steps'][number]
export type AssertionResult = CaseResultRecord['assertions'][number]

export type WebTestRecord =
  | ProjectRecord
  | EnvironmentRevisionRecord
  | PolicyRecord
  | RunRecord
  | CasePlanRecord
  | CaseResultRecord
  | OperationRecord
  | RoleIdentityRecord

/**
 * Control actions an operator may apply to a run.
 *
 * `resume` and `continue` differ because the states they release differ:
 * `resume` lifts a pause or a restart interruption, `continue` answers a
 * question the run raised with the operator.
 */
export type RunControlAction = 'pause' | 'resume' | 'cancel' | 'await-user' | 'continue'

/** Why a run is not executing right now, and so refuses new test actions. */
export type RunHoldStatus = z.infer<typeof runHoldStatusSchema>

/** Discriminant of a durable record kind. */
/** The account one role's browser presented, as the site reported it. */
export type RoleIdentityRecord = z.infer<typeof roleIdentityRecordSchema>

export type WebTestRecordKind = WebTestRecord['kind']

/** Browser product the operator selected for the first release. */
export type BrowserProduct = 'chrome' | 'edge'

/** How the plugin reaches the browser under test. */
export type BrowserLaunchMode =
  /** Plugin-spawned browser with its own profile directory. */
  | 'owned'
  /** Operator attached an already-running browser the plugin may drive. */
  | 'attached'

/** Execution phase of a run: what kind of work the run is doing. */
export type RunPhase = RunRecord['phase']

/** Control state of a run: what is happening to it. */
export type RunStatus = RunRecord['status']

/**
 * Plugin lifecycle state.
 *
 * `draining` is set before teardown so an Agent that still holds a retired
 * preset revision cannot dispatch new test actions.
 */
export type PluginLifecycleState = 'active' | 'draining'

/**
 * Snapshot the Client reads to confirm the plugin half is loaded and its own
 * storage answers.
 */
export interface PluginStatus {
  /** Plugin version taken from its own manifest. */
  readonly version: string;
  /** Current lifecycle state; `draining` refuses new dispatches. */
  readonly state: PluginLifecycleState;
  /** Absolute path of the plugin-owned data root. */
  readonly dataRoot: string;
  /** Storage schema version the plugin opened. */
  readonly schemaVersion: number;
  /** Number of durable records currently readable, keyed by record kind. */
  readonly recordCounts: Readonly<Record<WebTestRecordKind, number>>;
  /** Host runtime version this plugin was loaded by. */
  readonly dshVersion: string;
  /**
   * What the last open found interrupted by a restart.
   *
   * Empty on a clean start. A non-empty report is the operator's work queue: each
   * run needs a deliberate continuation and each unknown operation needs a
   * decision, because a restart never authorizes repeating one.
   */
  /**
   * What is waiting on the operator right now.
   *
   * `reconciliation` records what one open found; this is the standing backlog,
   * so a run parked by an earlier restart is still visible after the operator
   * has looked at the startup report once.
   */
  readonly needsDecision: {
    /** Runs in a state the operator has to act on: a restart interrupted, or a question is open. */
    readonly runs: readonly { runKey: string, status: RunRecord['status'], reason: string }[]
    /** Operations whose outcome was never observed, which must be reconciled rather than repeated. */
    readonly unknownOperations: readonly { runKey: string, operationKey: string, intent: string, reason: string }[]
  }
  readonly reconciliation: {
    /** Runs a restart interrupted, now waiting for an explicit continuation. */
    readonly blockedRuns: readonly string[];
    /** Operations whose dispatch state could not be observed. */
    readonly unknownOperations: readonly { runKey: string, operationKey: string, reason: string }[]
  };
}
