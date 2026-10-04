/**
 * Durable record schemas for the Web testing plugin.
 *
 * These Zod schemas are the single source of truth: the storage domain
 * validates every record against them at the durable boundary, and
 * `types.ts` derives its exported record types from them, so a stored record
 * and its TypeScript type cannot drift apart.
 *
 * @module dsh-plugin-web-test/records
 */

import { z } from 'zod'

/** Durable format version written on every record. */
export const SCHEMA_VERSION = 3

/** Fields shared by every Web testing record. */
const baseFields = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  label: z.string(),
  updatedAtMs: z.number().int().nonnegative(),
}

/** A Web testing project: where the code under test lives and how to reach it. */
export const projectRecordSchema = z.object({
  ...baseFields,
  kind: z.literal('project'),
  key: z.string().min(1),
  sourceRoot: z.string().min(1),
  baseUrl: z.string().min(1),
})

/** A browser viewport the confirmed cases execute at. */
export const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

/**
 * What the user declared about one entry point's environment.
 *
 * `nature` is never inferred from a hostname or a successful login: an
 * unconfirmed entry stays `unknown`, which withholds business mutations and
 * disruptive failure simulation until the user authorizes them.
 */
export const environmentNatureSchema = z.enum(['test', 'production', 'unknown'])

/** How far the declared data scope permits business-changing operations. */
export const dataOperationScopeSchema = z.enum(['read-only', 'business-entry-writes'])

/** One role the cases may act as, with a credential reference the plugin never stores. */
export const roleSchema = z.object({
  name: z.string().min(1),
  /** Reference to a host-managed credential; never the credential itself. */
  accountRef: z.string(),
})

/** One revision of a project's environment declaration. */
export const environmentRevisionRecordSchema = z.object({
  ...baseFields,
  kind: z.literal('environment-revision'),
  key: z.string().min(1),
  projectKey: z.string().min(1),
  revision: z.number().int().nonnegative(),
  /** Entry-point name, because one project may span several. */
  name: z.string().min(1),
  url: z.string().min(1),
  nature: environmentNatureSchema,
  dataOperations: dataOperationScopeSchema,
  roles: z.array(roleSchema),
  /** Free-text record of what the user authorized and under which conditions. */
  scopeNotes: z.string(),
  /** Host model id the run should use, empty when the session's own model applies. */
  modelRef: z.string(),
  viewport: viewportSchema,
  /** When the user confirmed this declaration. */
  confirmedAtMs: z.number().int().nonnegative(),
})

/** Project-level execution policy applied to confirmed cases. */
export const policyRecordSchema = z.object({
  ...baseFields,
  kind: z.literal('policy'),
  key: z.string().min(1),
  projectKey: z.string().min(1),
  /** How real external business actions are handled when no service answers. */
  externalActions: z.enum(['skip', 'confirm']),
  /** Default viewport for entry points that declare none of their own. */
  defaultViewport: viewportSchema,
  /** Disruptive failure simulation is in scope only when the environment allows it. */
  failureSimulation: z.enum(['excluded', 'included']),
})

/** One step of a confirmed case, as the model actually performed it. */
export const stepResultSchema = z.object({
  /** Position in the confirmed case, one-based. */
  index: z.number().int().positive(),
  /** What the step was meant to do, from the confirmed case. */
  intent: z.string().min(1),
  /** What actually happened, in the model's own words. */
  observed: z.string(),
  /** Whether the step's own expectation held. */
  outcome: z.enum(['passed', 'failed', 'skipped', 'blocked']),
  /** Absolute path of the screenshot captured for this step, when one was taken. */
  evidencePath: z.string(),
})

/** One assertion the model checked, and what it found. */
export const assertionResultSchema = z.object({
  /** What was expected, stated independently of the implementation. */
  expected: z.string().min(1),
  /** What the page actually showed. */
  actual: z.string(),
  outcome: z.enum(['passed', 'failed', 'skipped', 'blocked']),
  /** Why the assertion could not be settled, when it was not passed or failed. */
  reason: z.string(),
})

/** The structured outcome of one confirmed case. */
export const caseResultRecordSchema = z.object({
  ...baseFields,
  kind: z.literal('case-result'),
  key: z.string().min(1),
  runKey: z.string().min(1),
  projectKey: z.string().min(1),
  environmentRevisionKey: z.string().min(1),
  caseKey: z.string().min(1),
  /** The case never passed, even if a later attempt did. */
  outcome: z.enum(['passed', 'failed', 'skipped', 'blocked', 'incomplete']),
  steps: z.array(stepResultSchema),
  assertions: z.array(assertionResultSchema),
  /** Absolute paths of every evidence file the case produced. */
  evidencePaths: z.array(z.string()),
  /** Questions the run could not settle, carried into the report as gaps. */
  openQuestions: z.array(z.string()),
})

/** Dispatch state of one business-changing operation. */
export const operationDispatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not-dispatched') }),
  z.object({ kind: z.literal('dispatching') }),
  z.object({ kind: z.literal('dispatched') }),
  z.object({
    kind: z.literal('settled'),
    outcome: z.enum(['observed-success', 'observed-absent']),
  }),
  z.object({ kind: z.literal('unknown'), reason: z.string().min(1) }),
])

/** One test run and its control state. */
export const runRecordSchema = z.object({
  ...baseFields,
  kind: z.literal('run'),
  key: z.string().min(1),
  projectKey: z.string().min(1),
  environmentRevisionKey: z.string().min(1),
  phase: z.enum(['analysis', 'planning', 'execution', 'reporting', 'cleanup']),
  status: z.enum([
    'queued',
    'running',
    'awaiting-user',
    'awaiting-business-time',
    'paused',
    'resuming',
    'completed',
    'cancelled',
    'blocked',
  ]),
  unresolvedOperations: z.record(z.string(), operationDispatchSchema),
})
