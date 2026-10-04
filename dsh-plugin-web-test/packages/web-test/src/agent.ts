import { basename, isAbsolute, join } from 'node:path'
import { copyFileSync, statSync } from 'node:fs'
/**
 * Web testing Agent composition.
 *
 * This module is mounted inside the `web-test` agent preset only. It
 * contributes the test instructions, the test tools, and the execution guard,
 * so none of it reaches a normal DSH session.
 *
 * The restriction is an allowlist enforced by `ctx.tools.guard`, which runs in
 * the tool pipeline before any tool body. A guard has no allow result, so no
 * other listener or approval can turn a denial back into permission, and an
 * Agent that retained this retired preset after the plugin was disabled still
 * meets the guard, which additionally consults the store's lifecycle state.
 *
 * @module dsh-plugin-web-test/agent
 */

import type { Context } from '@deepseek-ai/cordis'
import ToolsService from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { SCHEMA_VERSION, caseResultRecordSchema, operationDispatchSchema, runRecordSchema } from './records.ts'

/** Loader row id for this composition inside the preset. */
export const name = 'web-test-agent'

/** Cordis service injection for this composition. */
export const inject = ['tools', 'webTestStore']

/** Identity of the agent preset the operator selects explicitly. */
export const PRESET_ID = 'web-test'

/**
 * Prefix every tool this plugin contributes in a test session.
 *
 * The guard admits these plus the browser provider's `mcp__<server>_` tools,
 * and denies everything else, so a test Agent cannot reach the host's shell,
 * filesystem, or session-editing tools even if a future preset or a model
 * prompt asks it to.
 */
export const TOOL_PREFIX = 'web_test_'

/**
 * Prefix the browser provider's tools carry.
 *
 * The official per-Session Playwright MCP provider registers its server under
 * the fixed name `playwright-mcp`, so its tools are `mcp__playwright-mcp__*`.
 * The allowlist names that prefix explicitly rather than accepting every
 * `mcp__*` tool, so a globally installed browser provider's tools stay outside
 * a test session even if it is loaded at the same time.
 */
export const BROWSER_TOOL_PREFIX = 'mcp__playwright-mcp__'

/** Instructions given to a Web testing Agent. */
export const TEST_INSTRUCTIONS = [
  'You are running a Web test session inside DSH.',
  'Call web_test_start_run once before executing cases, and web_test_finish_run once after every case is recorded,'
    + ' so the run is never left open. An operation whose outcome you could not observe is reported as unresolved'
    + ' rather than retried.',
  'After a confirmed case finishes, call web_test_report_case once with that case\'s steps, assertions, and'
    + ' screenshot paths. A case with no recorded result is missing from the report, and a recorded outcome of'
    + ' blocked is a question for the operator rather than a failure. Report only cases you actually executed.',
  'Work only through the web_test_ tools and the browser tools this session provides.',
  'The code under test is read-only: you cannot edit it, run commands in it, or install anything.',
  'Read the source and the page, propose candidate test cases, and wait for the operator to confirm them before executing.',
  'Never claim a case passed. Report what you observed and let the operator judge.',
].join(' ')

/**
 * Decide whether one tool call may run in a test session.
 *
 * @param execution - the call about to enter a tool body.
 * @returns a denial reason, or `undefined` to leave the call allowed.
 */
export function guardReason(
  execution: Readonly<{ name: string }>,
  store?: { heldRun: () => { runKey: string, status: 'paused' } | undefined },
): string | undefined {
  // A run the operator paused or cancelled stops dispatching here, in the
  // execution path, so a model that ignores the pause still cannot drive the
  // browser. The status tool stays reachable so the model can report why.
  const held = store?.heldRun()
  if (held !== undefined && !execution.name.startsWith(`${TOOL_PREFIX}status`)) {
    return `web-test: run ${held.runKey} is ${held.status} by operator request and refuses new test actions; `
      + 'resume it with web_test_resume_run before acting'
  }
  if (execution.name.startsWith(TOOL_PREFIX)) return undefined
  if (execution.name.startsWith(BROWSER_TOOL_PREFIX)) return undefined
  return `web-test sessions may only call ${TOOL_PREFIX}* and ${BROWSER_TOOL_PREFIX}* tools; `
    + `"${execution.name}" is outside the test execution policy`
}

/** Result shape of the status tool, kept separate for reuse in tests. */
export const statusResultSchema = z.object({
  state: z.enum(['active', 'draining']),
  evidenceRoot: z.string(),
  version: z.string(),
  projectCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
})

/** Validated result of the status tool. */
export type WebTestStatusResult = z.infer<typeof statusResultSchema>

/**
 * Register the test tools and the execution guard.
 *
 * Both registrations are effects on this fiber, so disposing the row removes
 * the guard and the tools together.
 * @param ctx - Plugin Context for the preset row.
 */
/**
 * Take custody of the evidence a run reported.
 *
 * The browser's screenshot tool is confined to its own output directory, so the
 * plugin cannot require evidence to be written where it wants it. Instead the
 * plugin copies each reported file into the run's evidence directory and records
 * the canonical copy, which keeps evidence under the plugin's ownership.
 *
 * Freshness is judged on the source file: a file written before the run began
 * cannot be evidence of what this run did, so it is refused instead of copied.
 * @param reported - Paths the model reported as evidence.
 * @param dir - Absolute directory that owns this run's evidence.
 * @param since - When the run prepared that directory.
 * @returns the canonical paths inside the run's evidence directory.
 * @throws when a path is missing, predates the run, or cannot be copied.
 */
function takeEvidence(reported: string[], dir: string, since: number | undefined): string[] {
  return reported.map((path, index) => {
    if (!isAbsolute(path)) {
      throw new Error(`web-test: evidence path ${JSON.stringify(path)} is relative; pass the absolute path the`
        + ' screenshot tool reported.')
    }
    if (!statSync(path).isFile()) {
      throw new Error(`web-test: evidence path ${JSON.stringify(path)} is not a file. Take the evidence before`
        + ' reporting the result.')
    }
    if (since !== undefined && statSync(path).mtimeMs < since) {
      throw new Error(`web-test: evidence path ${JSON.stringify(path)} was last written before this run started,`
        + ' so it cannot be evidence of this run. Take a new screenshot for this run.')
    }
    const copied = join(dir, `${index}-${basename(path)}`)
    copyFileSync(path, copied)
    return copied
  })
}

/** What starting a run returns. */
const startedRunSchema = z.object({ runKey: z.string(), status: z.string(), evidenceRoot: z.string() })

/** What closing a run returns. */
const finishedRunSchema = z.object({ runKey: z.string(), status: z.string() })

/** The start tool's arguments, minus the fields the plugin owns. */
const startRunInputSchema = runRecordSchema
  .pick({ projectKey: true, environmentRevisionKey: true })
  .extend({ runKey: z.string().min(1), label: z.string().optional() })

/** The finish tool's arguments. */
const finishRunInputSchema = z.object({
  runKey: z.string().min(1),
  status: z.enum(['completed', 'cancelled', 'blocked']),
  unresolvedOperations: z.record(z.string(), operationDispatchSchema).optional(),
})

/**
 * The record tool's arguments.
 *
 * The tool's parameters declare `observed`, `reason`, and a step's
 * `evidencePath` as optional, so the validator must accept them as absent; the
 * stored record fills the empty values in.
 */
const caseResultInputSchema = caseResultRecordSchema
  .omit({ schemaVersion: true, kind: true, key: true, label: true, updatedAtMs: true })
  .extend({ evidencePaths: z.array(z.string()).optional(), openQuestions: z.array(z.string()).optional() })
  .extend({
    steps: z.array(caseResultRecordSchema.shape.steps.element
      .extend({ observed: z.string().optional(), evidencePath: z.string().optional() })),
    assertions: z.array(caseResultRecordSchema.shape.assertions.element
      .extend({ actual: z.string().optional(), reason: z.string().optional() })),
  })

/** What the record tool returns once the case is durable. */
const recordedResultSchema = z.object({
  caseKey: z.string(),
  outcome: z.string(),
  evidence: z.array(z.string()).optional(),
})

export function apply(ctx: Context): void {
  const tools: ToolsService = ctx.tools
  const store = ctx.webTestStore

  ctx.effect(() => tools.register({
    name: `${TOOL_PREFIX}start_run`,
    description:
      'Begin one test run. Call this before executing any confirmed case, and again only when a new run genuinely'
      + ' starts. The screenshot tool writes to its own output directory; report the absolute paths it gives you and'
      + ' this plugin copies them into the run evidence directory named in the result. Do not write files there'
      + ' yourself and do not read them back.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runKey', 'projectKey', 'environmentRevisionKey'],
      properties: {
        runKey: { type: 'string', description: 'Identifier for this run; every case result references it.' },
        projectKey: { type: 'string', description: 'Project under test.' },
        environmentRevisionKey: { type: 'string', description: 'Confirmed environment declaration being tested.' },
        label: { type: 'string', description: 'Short human-readable name for the run.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['runKey', 'status', 'evidenceRoot'],
        properties: {
          runKey: { type: 'string' },
          status: { type: 'string' },
          evidenceRoot: { type: 'string' },
        },
      },
      render(_args, value) {
        const run = startedRunSchema.parse(value)
        return [{
          type: 'text',
          text: `Run ${run.runKey} is ${run.status}. Let the screenshot tool save files wherever it already saves`
            + ` them, then report the absolute paths it gives you; this plugin copies each one into`
            + ` ${run.evidenceRoot}. Do not try to write screenshots there yourself, and do not open files there`
            + ' afterwards.',
        }]
      },
    },
    async execute(args) {
      if (!store.accepting) {
        throw new Error(`web-test: the plugin is ${store.state} and refuses new test actions`)
      }
      const input = startRunInputSchema.parse(args)
      // The evidence directory is prepared here, when the run begins, so it
      // exists before any browser tool could write into it and a run that never
      // reports a case still has its directory.
      const dir = store.ensureEvidenceDir(input.runKey)
      const record = runRecordSchema.parse({
        ...input,
        schemaVersion: SCHEMA_VERSION,
        kind: 'run',
        key: input.runKey,
        label: input.label ?? input.runKey,
        updatedAtMs: Date.now(),
        phase: 'execution',
        status: 'running',
        unresolvedOperations: {},
      })
      await store.putRun(record)
      return { runKey: record.key, status: record.status, evidenceRoot: dir }
    },
  }), 'web-test: start run tool')

  ctx.effect(() => tools.register({
    name: `${TOOL_PREFIX}finish_run`,
    description:
      'Close one test run. Call this once the run\'s cases are all recorded, whether they passed, failed, or stayed'
      + ' blocked, so the run is not left open. Carry every operation whose outcome you could not observe as an'
      + ' unresolved operation rather than retrying it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runKey', 'status'],
      properties: {
        runKey: { type: 'string', description: 'The run to close.' },
        status: {
          type: 'string',
          enum: ['completed', 'cancelled', 'blocked'],
          description: 'How the run ended. Blocked means a business question stopped it.',
        },
        unresolvedOperations: {
          type: 'object',
          description: 'Business-changing operations whose outcome could not be observed, keyed by a short id.',
          additionalProperties: {
            type: 'object',
            additionalProperties: false,
            required: ['kind'],
            properties: {
              kind: {
                type: 'string',
                enum: ['not-dispatched', 'dispatching', 'dispatched', 'settled', 'unknown'],
              },
              outcome: { type: 'string', enum: ['observed-success', 'observed-absent'] },
              reason: { type: 'string' },
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['runKey', 'status'],
        properties: { runKey: { type: 'string' }, status: { type: 'string' } },
      },
      render(_args, value) {
        const closed = finishedRunSchema.parse(value)
        return [{ type: 'text', text: `Run ${closed.runKey} closed as ${closed.status}.` }]
      },
    },
    async execute(args) {
      if (!store.accepting) {
        throw new Error(`web-test: the plugin is ${store.state} and refuses new test actions`)
      }
      const input = finishRunInputSchema.parse(args)
      const existing = store.getRun(input.runKey)
      if (existing === undefined) {
        throw new Error(`web-test: no run ${JSON.stringify(input.runKey)}; start it with web_test_start_run first`)
      }
      const record = runRecordSchema.parse({
        ...existing,
        ...input,
        status: input.status,
        phase: 'cleanup',
        updatedAtMs: Date.now(),
      })
      await store.putRun(record)
      return { runKey: record.key, status: record.status }
    },
  }), 'web-test: finish run tool')

  ctx.effect(() => tools.register({
    name: `${TOOL_PREFIX}report_case`,
    description:
      'Record the structured result of one confirmed test case: every step you actually performed with its outcome, '
      + 'each assertion you checked, and the screenshot files that back them. Call this once per case, after the case '
      + 'finishes, whether it passed or not. Never call it for a case you did not execute. Evidence paths must be '
      + 'absolute and point at real files inside this run\'s evidence directory; a relative path, a missing file, or '
      + 'a file anywhere else is refused. Call web_test_status first to learn the directory.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runKey', 'projectKey', 'environmentRevisionKey', 'caseKey', 'outcome', 'steps', 'assertions'],
      properties: {
        runKey: { type: 'string', description: 'Identifier shared by every case of this run.' },
        projectKey: { type: 'string', description: 'Project the case belongs to.' },
        environmentRevisionKey: { type: 'string', description: 'Confirmed environment declaration the case ran against.' },
        caseKey: { type: 'string', description: 'The confirmed case this result belongs to.' },
        outcome: {
          type: 'string',
          enum: ['passed', 'failed', 'skipped', 'blocked', 'incomplete'],
          description: 'The case outcome. Use blocked for a business question you could not settle.',
        },
        steps: {
          type: 'array',
          description: 'Every step performed, in order.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['index', 'intent', 'observed', 'outcome'],
            properties: {
              index: { type: 'integer', minimum: 1 },
              intent: { type: 'string', description: 'What this step was meant to do, from the confirmed case.' },
              observed: { type: 'string', description: 'What actually happened.' },
              outcome: { type: 'string', enum: ['passed', 'failed', 'skipped', 'blocked'] },
              evidencePath: {
            type: 'string',
            description: 'Absolute path the screenshot tool reported; the plugin copies it into the run evidence'
              + ' directory. Leave empty when the step produced no evidence.',
          },
            },
          },
        },
        assertions: {
          type: 'array',
          description: 'Each expectation you checked against the page.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['expected', 'actual', 'outcome'],
            properties: {
              expected: { type: 'string', description: 'The expectation, stated independently of the implementation.' },
              actual: { type: 'string', description: 'What the page actually showed.' },
              outcome: { type: 'string', enum: ['passed', 'failed', 'skipped', 'blocked'] },
              reason: { type: 'string', description: 'Why the assertion was not settled.' },
            },
          },
        },
        evidencePaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Absolute paths every evidence file was saved to, as the screenshot tool reported them.',
        },
        openQuestions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Business questions the run could not settle; they reach the report as gaps.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['caseKey', 'outcome'],
        properties: {
          caseKey: { type: 'string' },
          outcome: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
      render(_args, value) {
        const recorded = recordedResultSchema.parse(value)
        return [{
          type: 'text',
          text: `Recorded ${recorded.caseKey}: ${recorded.outcome}.`
            + (recorded.evidence === undefined || recorded.evidence.length === 0
              ? ' No evidence was attached, so this case carries none.'
              : ` Evidence copied into ${recorded.evidence.join(', ')}. The report will carry this result and`
                + ' its evidence. You do not need to open those files.'),
        }]
      },
    },
    async execute(args) {
      if (!store.accepting) {
        throw new Error(`web-test: the plugin is ${store.state} and refuses new test actions`)
      }
      const parsed = caseResultInputSchema.parse(args)
      // Evidence is the plugin's record of what the browser actually produced,
      // so every reported path must resolve to a real file inside the run's
      // evidence directory. A relative path, a missing file, or a file written
      // anywhere else is refused rather than recorded.
      const dir = store.ensureEvidenceDir(parsed.runKey)
      const since = store.runStartTime(parsed.runKey)
      const evidence = takeEvidence(parsed.evidencePaths ?? [], dir, since)
      const stepEvidence = parsed.steps.map(step =>
        step.evidencePath === undefined || step.evidencePath === ''
          ? step
          : { ...step, evidencePath: takeEvidence([step.evidencePath], dir, since)[0] })
      const record = caseResultRecordSchema.parse({
        ...parsed,
        schemaVersion: SCHEMA_VERSION,
        kind: 'case-result',
        key: `${parsed.runKey}/${parsed.caseKey}`,
        label: `${parsed.projectKey} ${parsed.caseKey}`,
        updatedAtMs: Date.now(),
        steps: stepEvidence.map(step => ({ ...step, observed: step.observed ?? '' })),
        assertions: parsed.assertions.map(item => ({ ...item, actual: item.actual ?? '', reason: item.reason ?? '' })),
        evidencePaths: evidence,
        openQuestions: parsed.openQuestions ?? [],
      })
      await store.putCaseResult(record)
      return { caseKey: record.caseKey, outcome: record.outcome, evidence: record.evidencePaths }
    },
  }), 'web-test: report case tool')

  ctx.effect(() => tools.register({
      name: `${TOOL_PREFIX}status`,
      description:
        'Report whether the Web testing plugin is loaded, which lifecycle state it is in, and how many projects and '
        + 'runs its own storage currently holds. Use this to confirm the test session is wired up before starting a '
        + 'run.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['state', 'version', 'projectCount', 'runCount', 'evidenceRoot'],
          properties: {
            state: { type: 'string', enum: ['active', 'draining'] },
            evidenceRoot: { type: 'string' },
            version: { type: 'string' },
            projectCount: { type: 'integer' },
            runCount: { type: 'integer' },
          },
        },
        render(_args, value) {
          // `render` receives the pipeline's JSON value, so it narrows with the
          // same schema the tool body fulfils instead of indexing blindly.
          const result = statusResultSchema.parse(value)
          const note = result.state === 'draining'
            ? 'The plugin is draining and refuses new test actions.'
            : 'The plugin is active.'
          return [{
            type: 'text',
            text: `Web testing plugin ${result.version} (${result.state}). ${note} `
              + `Projects: ${result.projectCount}. Runs: ${result.runCount}. `
              + `Report the absolute paths the screenshot tool gave you; this plugin copies them under`
              + ` ${result.evidenceRoot}. Never write screenshots there yourself.`,
          }]
        },
      },
      async execute(): Promise<WebTestStatusResult> {
        const status = store.status()
        if (status === undefined) {
          // Name the actual state: a drained plugin and a plugin that has not
          // mounted yet both leave storage unopened, and the operator needs to
          // tell them apart.
          throw new Error(`web-test: storage is not open while the plugin is ${store.state}`
            + `${store.openError === undefined ? '' : ` (${store.openError})`}`)
        }
        return {
          state: status.state,
          evidenceRoot: store.evidenceRoot(),
          version: status.version,
          projectCount: status.recordCounts.project,
          runCount: status.recordCounts.run,
        }
      },
  }), 'web-test: status tool')

  // The guard runs in the tool pipeline before any tool body. It refuses every
  // tool outside the test allowlist, and refuses everything except the read-only
  // status tool once the plugin starts draining.
  ctx.effect(
    () => tools.guard(execution => {
      if (!store.accepting && execution.name !== `${TOOL_PREFIX}status`) {
        return `web-test: the plugin is ${store.state} and refuses new test actions`
      }
      return guardReason(execution, store)
    }),
    'web-test: execution guard',
  )
}
