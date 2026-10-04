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
  caseResultRecordSchema,
  environmentRevisionRecordSchema,
  policyRecordSchema,
  operationDispatchSchema,
  projectRecordSchema,
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

/** Every durable record kind this plugin stores. */
export type PolicyRecord = z.infer<typeof policyRecordSchema>

export type CaseResultRecord = z.infer<typeof caseResultRecordSchema>
export type StepResult = CaseResultRecord['steps'][number]
export type AssertionResult = CaseResultRecord['assertions'][number]

export type WebTestRecord =
  | ProjectRecord
  | EnvironmentRevisionRecord
  | PolicyRecord
  | RunRecord
  | CaseResultRecord

/** Discriminant of a durable record kind. */
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
}
