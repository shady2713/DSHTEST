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

/**
 * Durable format version written on every record.
 *
 * The version stays at `3` while record fields are added, because a
 * `single`-layout unit refuses every stamp but its own and the backend offers no
 * way to write a higher stamp over a lower one: bumping the number would strand
 * every database an earlier build wrote instead of migrating it. Fields added
 * after v3 therefore carry a documented default, so an older build reading a
 * newer record ignores the extra fields and a newer build reading an older
 * record fills the defaults. A stamp this schema does not know still refuses to
 * open, which is the guarantee the version exists for.
 */
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

/**
 * One step of a proposed or confirmed case.
 *
 * A step is written during analysis and confirmed by the operator before any
 * browser action, so what the run executed can later be compared against what
 * was agreed rather than against whatever the model chose to do.
 */
export const plannedStepSchema = z.object({
  /** Position in the case, one-based and dense. */
  index: z.number().int().positive(),
  /** What this step does, stated as the user would describe it. */
  intent: z.string().min(1),
  /** What the step expects to see, independent of how the page is built. */
  expectation: z.string().default(''),
})

/**
 * One case as analysis proposed it and the operator ruled on it.
 *
 * The record exists so a run cannot execute a case nobody approved: the tool
 * that reports a result refuses a case whose status is not `confirmed`, and the
 * report states which proposed cases were never ruled on.
 */
/** The account a role's browser presented when the run switched to it. */
export const roleIdentityRecordSchema = z.object({
  ...baseFields,
  kind: z.literal('role-identity'),
  key: z.string().min(1),
  runKey: z.string().min(1),
  role: z.string().min(1),
  /** What the site answered, which is the only accepted evidence of identity. */
  account: z.string(),
  detail: z.string().default(''),
  verifiedAtMs: z.number().int().nonnegative().default(0),
})

export const casePlanRecordSchema = z.object({
  ...baseFields,
  kind: z.literal('case-plan'),
  /** `<runKey>/<caseKey>`, so one run's cases never collide with another's. */
  key: z.string().min(1),
  runKey: z.string().min(1),
  projectKey: z.string().min(1),
  environmentRevisionKey: z.string().min(1),
  /** Case identifier the results and operations refer to. */
  caseKey: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['proposed', 'confirmed', 'rejected']),
  steps: z.array(plannedStepSchema),
  /** Why the case is in scope, or the reason it was rejected. */
  notes: z.string().default(''),
  /** When the operator ruled on it; `0` while the case is only proposed. */
  confirmedAtMs: z.number().int().nonnegative().default(0),
})

/** One step of a confirmed case, as the model actually performed it. */
export const stepResultSchema = z.object({
  /** Position in the confirmed case, one-based. */
  index: z.number().int().positive(),
  /** What the step was meant to do, from the confirmed case. */
  intent: z.string().min(1),
  /** What actually happened, in the model's own words. */
  /** Empty when the run did not supply it; the tool declares the field optional. */
  observed: z.string().default(''),
  /** Whether the step's own expectation held. */
  outcome: z.enum(['passed', 'failed', 'skipped', 'blocked']),
  /** Absolute path of the screenshot captured for this step, when one was taken. */
  /** Empty when the run did not supply it; the tool declares the field optional. */
  evidencePath: z.string().default(''),
})

/** One assertion the model checked, and what it found. */
export const assertionResultSchema = z.object({
  /** What was expected, stated independently of the implementation. */
  expected: z.string().min(1),
  /** What the page actually showed. */
  /** Empty when the run did not supply it; the tool declares the field optional. */
  actual: z.string().default(''),
  outcome: z.enum(['passed', 'failed', 'skipped', 'blocked']),
  /** Why the assertion could not be settled, when it was not passed or failed. */
  /** Empty when the run did not supply it; the tool declares the field optional. */
  reason: z.string().default(''),
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
  // Counts how many times this run has been started or resumed. Authority a run
  // hands out names the generation it was minted in, so a call that was queued
  // before a restart cannot act under the authority a later start produced.
  generation: z.number().int().nonnegative().default(0),
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
  /**
   * Test session that owns this run.
   *
   * An operator's hold stops the owning session and no other, so two runs
   * started by two sessions do not block each other. Empty means no session has
   * claimed the run, and a hold on such a run stops every session, because the
   * plugin cannot tell whose work it would be interrupting.
   */
  ownerSessionId: z.string().default(''),
  /** Role the run currently acts as; empty when it acts without a role. */
  activeRole: z.string().default(''),
  /** Deadline of a business-time wait, `0` when the run is not waiting. */
  waitingUntilMs: z.number().int().nonnegative().default(0),
  /**
   * Why the run is not executing: the reason it asked to wait for business
   * time, or why a restart left it needing operator continuation.
   */
  waitingReason: z.string().default(''),
})

/**
 * One business-changing operation inside a run.
 *
 * The record exists so a run's business effect is durable before the action that
 * causes it: a transport loss or a crash after a possible dispatch leaves the
 * operation in {@link operationDispatchSchema} `dispatching` or `unknown`, and
 * {@link WebTestStore.beginOperation} refuses to dispatch that intent again.
 * Replanning or issuing a new tool-call id does not authorize a repeat.
 */
export const operationRecordSchema = z.object({
  ...baseFields,
  kind: z.literal('operation'),
  key: z.string().min(1),
  runKey: z.string().min(1),
  /** Short id the run uses to name this operation. */
  operationKey: z.string().min(1),
  /** The business change this operation attempts, for the report. */
  intent: z.string().min(1),
  /** Declared role that performs it; empty when the run acts without a role. */
  role: z.string().default(''),
  /** Digest of the request, so the same intent is recognisable on a repeat. */
  requestDigest: z.string().min(1),
  // The run generation that dispatched it, so a report can tell two attempts of
  // the same operation across a restart apart from one attempt repeated.
  generation: z.number().int().nonnegative().default(0),
  dispatch: operationDispatchSchema,
})

/**
 * Why a run currently refuses new test actions, keyed by what produced it.
 *
 * A hold is scoped to the run's owning session, so one session's hold never
 * stops another session's run. `resuming` is the state a run a host restart
 * interrupted lands in: it is neither executing nor the operator's choice, so it
 * waits for an explicit continuation.
 */
export const runHoldStatusSchema = z.enum(['paused', 'awaiting-business-time', 'awaiting-user', 'resuming'])
