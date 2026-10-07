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
import { BROWSER_TOOL_SUFFIX, RoleBrowserPool } from './role-browser.ts'
import type { MountOwner } from './role-browser.ts'
import type { BrowserOwner } from './role-browser.ts'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { VerifiedIdentity } from './store-service.ts'
import {
  SCHEMA_VERSION,
  casePlanRecordSchema,
  caseResultRecordSchema,
  operationDispatchSchema,
  runRecordSchema,
} from './records.ts'
import type { WebTestStore } from './store-service.ts'
import type { CasePlanRecord } from './types.ts'

/** Loader row id for this composition inside the preset. */
export const name = 'web-test-agent'

/**
 * Cordis service injection for this composition.
 *
 * The execution guard is registered on the host-plane tools runtime by the
 * `web-test` service, not from here: a preset that also guards would attach the
 * guard to whatever runtime that scope resolves, while the agent loop reads the
 * scheduler off its own. Registering it once at the host plane covers every
 * execution and reads the owning agent from each one.
 */
export const inject = ['tools', 'webTestStore', 'webTestRoleBrowsers']

/**
 * Browser tools a run may use before its role is verified.
 *
 * These navigate, read, fill, and press. `browser_click` is included because a
 * sign-in form is normally submitted by pressing its button, and refusing every
 * click would make preparation impossible without a human at the keyboard. The
 * grant is bounded on the other side: it applies only before the run's role is
 * verified, only to the run's own role browser, and only from a session that
 * owns a running run declaring that role. A run that has finished signing in
 * loses it and needs a verified role, as it would for any other action.
 */
const LOGIN_TOOLS: ReadonlySet<string> = new Set([
  'browser_navigate',
  'browser_evaluate',
  'browser_snapshot',
  'browser_fill_form',
  'browser_type',
  'browser_select_option',
  'browser_wait_for',
  'browser_find',
  'browser_click',
  'browser_press_key',
  'browser_console_messages',
  'browser_network_requests',
  'browser_resize',
])

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
 * Prefix every role-scoped browser tool shares.
 *
 * Each role's browser is its own MCP server, so a tool name states which
 * account would act. The guard below admits only the active role's namespace,
 * which is what stops a model reaching another role's browser by naming it.
 */
export const ROLE_BROWSER_PREFIX = 'mcp__playwright-role-'

/** Instructions given to a Web testing Agent. */
export const TEST_INSTRUCTIONS = [
  'You are running a Web test session inside DSH.',
  'Call web_test_start_run once before executing cases, and web_test_finish_run once after every case is recorded,'
    + ' so the run is never left open.',
  'Before any step that changes business data, call web_test_begin_operation and act at once. After the change,'
    + ' observe the result independently and call web_test_settle_operation. If the connection drops or you cannot'
    + ' observe the outcome, call web_test_operation_unknown instead: that operation must never be submitted again,'
    + ' and a new tool-call id does not authorize a repeat.',
  'When a business action only takes effect later, call web_test_wait with the moment it becomes observable, then'
    + ' web_test_resume_wait after that moment. Do not re-run a case to "make sure" it worked.',
  'Call web_test_assume_role before acting as a second account, and only with a role the operator declared.',
  'After a confirmed case finishes, call web_test_report_case once with that case\'s steps, assertions, and'
    + ' screenshot paths. A case with no recorded result is missing from the report, and a recorded outcome of'
    + ' blocked is a question for the operator rather than a failure. Report only cases you actually executed.',
  'Work only through the web_test_ tools and the browser tools this session provides.',
  'The code under test is read-only: you cannot edit it, run commands in it, or install anything.',
  'Read the source and the page, propose candidate test cases, and wait for the operator to confirm them before executing.',
  'Never claim a case passed. Report what you observed and let the operator judge.',
].join(' ')

/**
 * Tools that stay reachable while a run is held.
 *
 * A hold must not make a run unbookkeepable: the model has to be able to report
 * what happened, record that a dispatch was lost, and end a wait. Each of these
 * records or retires state instead of dispatching a new test action, so allowing
 * them cannot drive the browser.
 */
export const HELD_RUN_ALLOWED_TOOLS: readonly string[] = [
  `${TOOL_PREFIX}status`,
  // Starting a different run is how an operator gets moving again after a pause
  // or a restart: the held run keeps its own authority, and the new one gets an
  // independent one. Refusing this left a `resuming` run able to block the
  // session permanently.
  `${TOOL_PREFIX}start_run`,
  `${TOOL_PREFIX}operation_unknown`,
  `${TOOL_PREFIX}settle_operation`,
  `${TOOL_PREFIX}resume_wait`,
  // This is how a held run is actually released: without it a `resuming` run
  // reported by `web_test_status` could only be read, never continued, and one
  // host restart left the session unable to finish its work at all.
  `${TOOL_PREFIX}control_run`,
]

/**
 * Decide whether one tool call may run in a test session.
 *
 * @param execution - the call about to enter a tool body.
 * @param store - the run owner, consulted for the session's held run.
 * @param sessionId - identity of the session asking, empty when it has none.
 * @returns a denial reason, or `undefined` to leave the call allowed.
 */
export function guardReason(
  execution: Readonly<{ name: string, arguments?: unknown, agent?: { id: string } }>,
  store?: {
    holdForSession: (sessionId: string) => { runKey: string, status: string } | undefined
    hasRunningRun: (sessionId: string) => boolean
    requireAuthority: (token: string, agentId: string) => {
      runKey: string, role: string, generation: number, agentId: string
    }
    mayPrepareIdentity: (sessionId: string, role: string, runKey?: string) => boolean
  },
  sessionId = '',
  pool?: {
    ownerOfServer: (serverName: string) => MountOwner | undefined
    claimOf: (serverName: string) => { runKey: string, generation: number } | undefined
  },
): string | undefined {
  // A run the operator paused, or that a restart interrupted, stops dispatching
  // here, in the execution path, so a model that ignores the pause still cannot
  // drive the browser. The refusal is scoped to the session that owns the run, so
  // one session's hold never stops another session's test work. It applies only
  // while that held run is the session's only run: once a different run is
  // running, the held run keeps its own boundaries through `requireAuthority`
  // and the preparation check, and holding the whole session would leave a
  // restarted run able to block the session forever.
  // The hold is scoped to what a test run can act through: the plugin's own
  // tools and the role browsers. The host's tools stay available to the session,
  // which owns its run but not the conversation around it.
  const testAction = execution.name.startsWith(TOOL_PREFIX) || execution.name.startsWith(ROLE_BROWSER_PREFIX)
  const held = testAction ? store?.holdForSession(sessionId) : undefined
  const running = store?.hasRunningRun(sessionId) === true
  if (held !== undefined && !running && !HELD_RUN_ALLOWED_TOOLS.includes(execution.name)) {
    return `web-test: run ${held.runKey} is ${held.status} and refuses new test actions. `
      + (held.status === 'resuming'
        ? 'The DSH host restarted during that run; report what you know through web_test_status and ask the'
          + ' operator to continue it.'
        : 'Ask the operator to continue it; do not act for it in the meantime.')
  }
  if (execution.name.startsWith(TOOL_PREFIX)) return undefined
  if (execution.name.startsWith(ROLE_BROWSER_PREFIX)) {
    // A browser call is judged against the mount it actually names. The role in
    // the name is not an owner: two runs in one session can each declare
    // `buyer`, and taking the session's first qualifying run handed each role's
    // browser the other role's authority.
    const serverName = RoleBrowserPool.serverNameOf(execution.name)
    const owner = pool?.ownerOfServer(serverName)
    if (owner === undefined) {
      return `web-test: ${JSON.stringify(serverName)} is not a browser this plugin has mounted`
        + ` for this session, so nothing authorises a call through it.`
    }
    if (owner.sessionId !== '' && sessionId !== '' && owner.sessionId !== sessionId) {
      return `web-test: that browser belongs to another session's run, so this one may not`
        + ` drive it.`
    }
    const role = owner.role
    // Preparation is admitted before the authority is consulted, because the
    // authority is what verification produces. It is bounded by the mount's own
    // owner: the run that claimed this mount, still executing. A wrong token does
    // not fall back to it, and a mount with no owner never reaches it.
    const toolName = execution.name.split(BROWSER_TOOL_SUFFIX).at(-1) ?? ''
    const preparing = LOGIN_TOOLS.has(toolName)
    if (preparing) {
      const claim = pool?.claimOf(serverName)
      // Preparation needs a claim that matches the mount's own owner; without
      // one it falls through to the authority check rather than being waved
      // through.
      //
      // Preparation is only the answer when the call presents no credential. A
      // call that does present one is asking to act as that token's run, so an
      // empty string — which a run that cannot mint an authority carries — still
      // counts as offering nothing, while a real token from another run falls
      // through and is refused by the checks below.
      const offered = (execution.arguments as { authority?: unknown } | undefined)?.authority
      if ((offered === undefined || offered === '')
        && claim !== undefined && claim.runKey === owner.runKey
        && store?.mayPrepareIdentity(sessionId, role, owner.runKey) === true) {
        return undefined
      }
    }
    const presented = (execution.arguments as { authority?: unknown } | undefined)?.authority
    if (typeof presented !== 'string' || presented === '') {
      return 'web-test: this action needs the authority web_test_assume_role issued.'
        + ' Pass it as the "authority" argument; the token stops working when the run restarts.'
    }
    let authority: { runKey: string, role: string, generation: number, agentId: string }
    try {
      authority = store?.requireAuthority(presented, execution.agent?.id ?? '') ?? {
        runKey: '', role: '', generation: -1, agentId: '',
      }
    } catch (error) {
      return String(error instanceof Error ? error.message : error)
    }
    // A valid token is not enough: it has to be the token for this mount's own
    // run, role and generation. Presenting the buyer's authority to the
    // approver's browser is refused here rather than answered by whichever run
    // happened to sort first for the session.
    // `requireAuthority` has already compared the token's generation with the
    // live run's, so this side only checks what it can: a mount whose generation
    // was recorded must match. A run record without one has nothing to compare.
    const generationAgrees = owner.generation === 0
      || authority.generation === undefined
      || authority.generation === owner.generation
    if (authority.runKey !== owner.runKey || authority.role !== owner.role
      || !generationAgrees) {
      return `web-test: that authority belongs to run ${JSON.stringify(authority.runKey)} acting as`
        + ` ${JSON.stringify(authority.role)}, not to run ${JSON.stringify(owner.runKey)} acting as`
        + ` ${JSON.stringify(owner.role)} through ${JSON.stringify(serverName)}`

    }
    return undefined
  }
  // Any other `mcp__` tool belongs to another provider, not to this plugin, so
  // it is left alone. Tools the host gives every session — reading a file,
  // writing a todo — are likewise not this plugin's to refuse: the guard runs on
  // the host's shared tool runtime, so denying them here would break ordinary
  // DSH conversations that never asked for a test session. What the plugin owns
  // is the role browsers, and the branch above has already judged those.
  return undefined
}

/** Arguments of the run-control tool. */
export const controlRunArgsSchema = z.object({
  runKey: z.string().min(1),
  action: z.enum(['pause', 'resume', 'continue', 'await-user', 'cancel']),
})

/** Result shape of the run-control tool. */
export const controlRunResultSchema = z.object({
  runKey: z.string(),
  status: z.string(),
  activeRole: z.string(),
  generation: z.number().int(),
  message: z.string(),
})

/** Result shape of the status tool, kept separate for reuse in tests. */
export const statusResultSchema = z.object({
  state: z.enum(['active', 'draining']),
  evidenceRoot: z.string(),
  version: z.string(),
  projectCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
  /** Runs a restart interrupted; each needs a deliberate operator continuation. */
  interruptedRuns: z.array(z.string()),
  /** Operations whose outcome a restart or a lost connection left unobserved. */
  unknownOperations: z.array(z.string()),
})

/**
 * The status tool's declared output schema.
 *
 * Exported so a test can hold it against the schema the tool body fulfils.
 */
export const statusToolOutputSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'state',
    'version',
    'projectCount',
    'runCount',
    'evidenceRoot',
    'interruptedRuns',
    'unknownOperations',
  ],
  properties: {
    state: { type: 'string', enum: ['active', 'draining'] },
    evidenceRoot: { type: 'string' },
    version: { type: 'string' },
    projectCount: { type: 'integer' },
    runCount: { type: 'integer' },
    interruptedRuns: { type: 'array', items: { type: 'string' } },
    unknownOperations: { type: 'array', items: { type: 'string' } },
  },
}

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

/**
 * Refuse a result for a case the operator never approved.
 *
 * The check runs before anything is written, so a run cannot report a case it
 * invented, and the reported steps are matched against the confirmed plan so a
 * result cannot quietly cover fewer steps than the operator agreed to.
 * @param store - The plugin's store.
 * @param runKey - Run the result belongs to.
 * @param caseKey - Case the result claims to cover.
 * @returns the confirmed plan, so callers can reuse it.
 * @throws when the case was never proposed, is not confirmed, or its reported
 * steps do not line up with the confirmed plan.
 */
function requireConfirmedCase(store: WebTestStore, runKey: string, caseKey: string): CasePlanRecord {
  const plan = store.getCasePlan(runKey, caseKey)
  if (plan === undefined) {
    throw new Error(`web-test: run ${JSON.stringify(runKey)} proposed no case ${JSON.stringify(caseKey)};`
      + ' propose it with web_test_propose_cases and have the operator confirm it first')
  }
  if (plan.status !== 'confirmed') {
    throw new Error(`web-test: case ${JSON.stringify(caseKey)} is ${plan.status}, not confirmed, so it cannot be`
      + ' executed or reported')
  }
  return plan
}

/**
 * Match reported step indexes against a confirmed plan.
 *
 * A result that skips a confirmed step would leave the operator believing the
 * step ran. Missing steps are therefore refused here rather than reported as a
 * shorter pass.
 * @param plan - The confirmed case plan.
 * @param reported - Step indexes the result carries, in the order given.
 * @throws when the result does not cover exactly the confirmed steps.
 */
function requireConfirmedSteps(plan: CasePlanRecord, reported: number[]): void {
  const expected = plan.steps.map(step => step.index)
  if (reported.length !== expected.length
    || expected.some((index, position) => index !== reported[position])) {
    throw new Error(`web-test: case ${JSON.stringify(plan.caseKey)} was confirmed with steps`
      + ` ${expected.join(', ')} but the result reports ${reported.length === 0 ? 'none' : reported.join(', ')};`
      + ' every confirmed step needs an outcome, including a blocked or skipped one')
  }
}

/**
 * Read the signed-in account back from the site through a role's own browser.
 *
 * The site's answer is the only accepted evidence of identity: the plugin's
 * own fields cannot show whether a login succeeded.
 * @param pool - Role browser pool.
 * @param role - Role whose browser to ask.
 * @param identityUrl - Site endpoint that reports the current account.
 * @returns what the site reported.
 */
/**
 * The agent a call runs as, which the authority it presents must belong to.
 * @param execution - The call entering the guard.
 * @returns its agent id, empty when the call carries none.
 * @param exec - The running tool call.
 * @returns the agent id.
 * @throws when the call carries no agent.
 */
function requireAgentId(exec: ToolRunContext): string {
  const agent = exec.agent
  if (agent === undefined) {
    throw new Error('web-test: this call carries no agent, so no authority can be issued to it')
  }
  return agent.id
}

async function verifyRoleIdentity(
  tools: ToolsService,
  exec: ToolRunContext,
  pool: RoleBrowserPool | undefined,
  owner: BrowserOwner,
  identityUrl: string | undefined,
): Promise<VerifiedIdentity> {
  if (pool === undefined) {
    throw new Error('web-test: this build has no role browser pool, so no role can be verified')
  }
  if (identityUrl === undefined) {
    throw new Error('web-test: assume_role needs accountPage: the account has to be read back from the site, not'
      + ' assumed from the role name')
  }
  await pool.ensure(owner)
  const account = await pool.readAccount(tools, exec, owner, identityUrl)
  return { account: account.account, detail: account.detail }
}

/**
 * Refuse a proposed case whose steps are not dense and one-based.
 *
 * The result path matches reported steps against confirmed ones by position, so
 * a plan with gaps or duplicates would make that comparison ambiguous.
 * @param caseKey - Case being proposed, named in the error.
 * @param steps - The steps as the model wrote them.
 * @throws when a step index is missing, repeated, or out of order.
 */
function requireDenseSteps(
  caseKey: string,
  steps: readonly { index: number }[],
): void {
  const indexes = steps.map(step => step.index)
  const dense = indexes.every((index, at) => index === at + 1)
  if (!dense) {
    throw new Error(`web-test: case ${JSON.stringify(caseKey)} has step indexes ${indexes.join(', ')}; number them`
      + ' from 1 with no gaps and no repeats')
  }
}

/** What proposing cases returns. */
const proposedCasesSchema = z.object({
  proposed: z.array(z.string()),
  awaitingDecision: z.boolean(),
})

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

/** The begin-operation tool's arguments. */
const beginOperationInputSchema = z.object({
  runKey: z.string().min(1),
  operationKey: z.string().min(1),
  intent: z.string().min(1),
  requestDigest: z.string().min(1),
  role: z.string().default(''),
  authority: z.string().min(1),
})

/** The settle-operation tool's arguments. */
const settleOperationInputSchema = z.object({
  runKey: z.string().min(1),
  operationKey: z.string().min(1),
  outcome: z.enum(['observed-success', 'observed-absent']),
})

/** The operation-unknown tool's arguments. */
const operationUnknownInputSchema = z.object({
  runKey: z.string().min(1),
  operationKey: z.string().min(1),
  reason: z.string().min(1),
})

/** The wait tool's arguments; the deadline is a moment the model names. */
const waitInputSchema = z.object({
  runKey: z.string().min(1),
  untilIso: z.string().min(1),
  reason: z.string().min(1),
})

/** What every operation tool returns, so the model sees the recorded state. */
export const operationResultSchema = z.object({
  runKey: z.string(),
  operationKey: z.string(),
  dispatch: z.string(),
  // The authority a verified role hands out, empty for tools that issue none.
  // Browser calls outside the preparation window must present it.
  authority: z.string().default(''),
  note: z.string(),
})

/** Statuses after which a run owns no browser. */
export const RELEASED_STATUSES = new Set<z.infer<typeof runRecordSchema>['status']>([
  'paused', 'awaiting-user', 'awaiting-business-time',
  'cancelled', 'completed', 'blocked', 'resuming',
])

export function apply(ctx: Context): void {
  const pool = ctx.webTestRoleBrowsers
  const tools: ToolsService = ctx.tools
  const store = ctx.webTestStore

  // Resources follow the run's status, not the tool that changed it. A cancel
  // or pause issued through the operator's `webTest/*` surface never passed
  // through a handler here, so the browsers it left behind stayed up until the
  // host exited. Every status change reaches the store, so subscribing once
  // covers both surfaces and any interface added later.
  ctx.on('web-test: run-status-changed', ({ runKey, to }) => {
    if (RELEASED_STATUSES.has(to)) return pool.releaseRun(runKey)
  })

  // Role browsers are not mounted here. The provider defines a server's tools on
  // an agent as that agent is created, so a browser mounted at preset load is
  // too late for the session's own agent; the environment is confirmed before
  // the session exists, and that is where the browser is mounted.
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
    async execute(args, exec) {
      if (!store.accepting) {
        throw new Error(`web-test: the plugin is ${store.state} and refuses new test actions`)
      }
      const input = startRunInputSchema.parse(args)
      // The evidence directory is prepared here, when the run begins, so it
      // exists before any browser tool could write into it and a run that never
      // reports a case still has its directory.
      // Resolve the project and environment here rather than at the first role
      // check: a run that names the environment key as its project would
      // otherwise be stored and fail later with a message about the wrong field.
      store.requireRunEnvironment(input.projectKey, input.environmentRevisionKey)
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
        // Every start is a new generation, so any authority handed out under an
        // earlier one stops validating and a call queued before the restart
        // cannot act under what this start grants.
        generation: (store.getRun(input.runKey)?.generation ?? 0) + 1,
        // The owning session is what scopes an operator's hold: pausing this run
        // stops the session that started it and leaves other sessions working.
        ownerSessionId: exec.agent?.id ?? '',
      })
      // Recording the run is the last thing this tool does. It mounts no role
      // browser: `assume_role` owns that, and a browser mounted here would not
      // be callable in this turn, because the provider hands an MCP server's
      // tools to an agent as that agent is created. Starting one per declared
      // role was the intent of an earlier revision; it is not implemented, and
      // `assume_role` is the single place a role browser is mounted.
      await store.putRun(record)
      if (pool === undefined) {
        ctx.logger.warn(`web-test: this build has no role browser pool, so run ${input.runKey} has no browser`)
      }
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
      // Closing a run revokes this run's authority: the terminal status takes it
      // out of a session-wide grant, so no business action can be dispatched
      // under the role it verified. Every browser the run owns is then released,
      // and each release awaits its own fiber's disposal, so the Chromium this
      // run started is gone before the call returns rather than when the host
      // eventually exits.
      return { runKey: record.key, status: record.status }
    },
  }), 'web-test: finish run tool')

  ctx.effect(() => tools.register({
    name: `${TOOL_PREFIX}propose_cases`,
    description:
      'Propose the test cases for a run, with the steps each one takes and what each step expects. Proposing is not'
      + ' approving: the operator rules on every case, and this plugin refuses to execute or report a case that is'
      + ' still proposed. Call this once per run, after the environment is confirmed and before touching the browser.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runKey', 'projectKey', 'environmentRevisionKey', 'cases'],
      properties: {
        runKey: { type: 'string', description: 'Run the cases belong to.' },
        projectKey: { type: 'string', description: 'Project under test.' },
        environmentRevisionKey: { type: 'string', description: 'Confirmed environment declaration under test.' },
        cases: {
          type: 'array',
          description: 'The cases to run, each with its steps in order.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['caseKey', 'title', 'steps'],
            properties: {
              caseKey: { type: 'string', description: 'Short identifier for the case, unique within the run.' },
              title: { type: 'string', description: 'What the case checks, stated as a user would ask for it.' },
              notes: { type: 'string', description: 'Why the case is in scope for this run.' },
              steps: {
                type: 'array',
                description: 'The steps, numbered from 1 with no gaps.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['index', 'intent'],
                  properties: {
                    index: { type: 'integer', minimum: 1, description: 'Step position, dense and one-based.' },
                    intent: { type: 'string', description: 'What the step does.' },
                    expectation: {
                      type: 'string',
                      description: 'What the step expects to see, independent of how the page is built.',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['proposed'],
        properties: {
          proposed: { type: 'array', items: { type: 'string' } },
          awaitingDecision: { type: 'boolean' },
        },
      },
      render(_args, value) {
        const result = proposedCasesSchema.parse(value)
        return [{
          type: 'text',
          text: `Proposed ${result.proposed.length} case(s): ${result.proposed.join(', ')}. None of them can run`
            + ' until the operator confirms each one in the Web 测试 settings or through the plugin Remote.',
        }]
      },
    },
    async execute(args) {
      if (!store.accepting) {
        throw new Error(`web-test: the plugin is ${store.state} and refuses new test actions`)
      }
      const input = z.object({
        runKey: z.string().min(1),
        projectKey: z.string().min(1),
        environmentRevisionKey: z.string().min(1),
        cases: z.array(z.object({
          caseKey: z.string().min(1),
          title: z.string().min(1),
          notes: z.string().optional(),
          steps: z.array(z.object({
            index: z.number().int().positive(),
            intent: z.string().min(1),
            expectation: z.string().optional(),
          })).min(1),
        })).min(1),
      }).parse(args)
      store.requireExecutable(input.runKey)
      const run = store.getRun(input.runKey)
      if (run === undefined) {
        throw new Error(`web-test: no run ${JSON.stringify(input.runKey)}`)
      }
      if (run.projectKey !== input.projectKey
        || run.environmentRevisionKey !== input.environmentRevisionKey) {
        throw new Error(`web-test: run ${JSON.stringify(input.runKey)} is for project`
          + ` ${JSON.stringify(run.projectKey)} against ${JSON.stringify(run.environmentRevisionKey)}`)
      }
      const seen = new Set<string>()
      for (const item of input.cases) {
        requireDenseSteps(item.caseKey, item.steps)
        if (seen.has(item.caseKey)) {
          throw new Error(`web-test: case ${JSON.stringify(item.caseKey)} was proposed twice in one call`)
        }
        seen.add(item.caseKey)
        await store.putCasePlan(casePlanRecordSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          kind: 'case-plan',
          key: `${input.runKey}/${item.caseKey}`,
          runKey: input.runKey,
          projectKey: input.projectKey,
          environmentRevisionKey: input.environmentRevisionKey,
          caseKey: item.caseKey,
          title: item.title,
          status: 'proposed',
          steps: item.steps.map((step, at) => ({
            index: at + 1,
            intent: step.intent,
            expectation: step.expectation ?? '',
          })),
          notes: item.notes ?? '',
          confirmedAtMs: 0,
          label: item.title,
          updatedAtMs: Date.now(),
        }))
      }
      return { proposed: [...seen], awaitingDecision: true }
    },
  }), 'web-test: propose cases tool')

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
      // A result describes steps the run actually performed, so a run that is
      // paused, waiting, cancelled or interrupted by a restart takes no new ones.
      store.requireExecutable(parsed.runKey)
      // Normalise the optional fields before anything is persisted, so a model
      // that obeys the tool's own contract and omits them gets the same record
      // as one that passed empty strings. This is the behaviour the tool
      // description has always promised and the storage schema had not kept.
      const plan = requireConfirmedCase(store, parsed.runKey, parsed.caseKey)
      // Evidence is the plugin's record of what the browser actually produced,
      // so every reported path must resolve to a real file inside the run's
      // evidence directory. A relative path, a missing file, or a file written
      // anywhere else is refused rather than recorded.
      const dir = store.ensureEvidenceDir(parsed.runKey)
      const since = store.runStartTime(parsed.runKey)
      requireConfirmedSteps(plan, parsed.steps.map(step => step.index))
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

  /** Shared guard so every control tool refuses the same way while draining. */
  const refusing = (): void => {
    if (!store.accepting) throw new Error(`web-test: the plugin is ${store.state} and refuses new test actions`)
  }

  ctx.effect(() => tools.register({
    name: `${TOOL_PREFIX}begin_operation`,
    description:
      'Record that you are about to perform one business-changing action, then perform it immediately. Call this'
      + ' before the action, never after. The record is durable, so if the connection drops or the host restarts'
      + ' while the action may already have happened, the plugin knows the outcome is unknown and refuses to let'
      + ' you submit it again. Use a new operationKey only for genuinely new work, never to retry this one.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runKey', 'operationKey', 'intent', 'requestDigest', 'authority'],
      properties: {
        runKey: { type: 'string', description: 'The run that performs the change.' },
        operationKey: { type: 'string', description: 'Short id for this operation, stable across the run.' },
        intent: { type: 'string', description: 'The business change in one line, for the report.' },
        authority: {
          type: 'string',
          description: 'Token web_test_assume_role issued; it names the run and generation that may perform this change.',
        },
        requestDigest: {
          type: 'string',
          description: 'Digest of the request you are about to send, so a repeat is recognisable as the same change.',
        },
        role: { type: 'string', description: 'Declared role performing it; empty when the run acts without one.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['runKey', 'operationKey', 'dispatch', 'authority', 'note'],
        properties: {
          runKey: { type: 'string' },
          operationKey: { type: 'string' },
          dispatch: { type: 'string' },
          authority: {
            type: 'string',
            description: 'Token the browser calls of this run must present; empty when no role is verified.',
          },
          note: { type: 'string' },
        },
      },
      render(_args, value) {
        const result = operationResultSchema.parse(value)
        return [{
          type: 'text',
          text: `Operation ${result.operationKey} of run ${result.runKey} is ${result.dispatch}. ${result.note}`,
        }]
      },
    },
    async execute(args, exec) {
      refusing()
      const input = beginOperationInputSchema.parse(args)
      // A business-changing operation carries the authority of the role that is
      // about to perform it, so the record names both the role and the generation
      // it was minted in and a report can tell two attempts across a restart
      // apart from one attempt repeated.
      const authority = store.requireAuthority(input.authority, requireAgentId(exec))
      const record = await store.beginOperation(
        input.runKey, input.operationKey, input.intent, input.requestDigest, authority.role,
      )
      return {
        runKey: record.runKey,
        operationKey: record.operationKey,
        dispatch: record.dispatch.kind,
        authority: input.authority,
        note: 'Perform the change now, observe the result independently, then call web_test_settle_operation.',
      }
    },
  }), 'web-test: begin operation tool')

  ctx.effect(() => tools.register({
    name: `${TOOL_PREFIX}settle_operation`,
    description:
      'Record what a business-changing operation actually did, from an observation made after it. Read the page again'
      + ' or check the resulting record rather than assuming the click worked. This settles the operation once; a'
      + ' second settlement is refused so the first observation is not overwritten.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runKey', 'operationKey', 'outcome'],
      properties: {
        runKey: { type: 'string' },
        operationKey: { type: 'string' },
        outcome: {
          type: 'string',
          enum: ['observed-success', 'observed-absent'],
          description: 'observed-success when the business system now shows the change; observed-absent when the'
            + ' change verifiably did not happen.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['runKey', 'operationKey', 'dispatch', 'authority', 'note'],
        properties: {
          runKey: { type: 'string' },
          operationKey: { type: 'string' },
          dispatch: { type: 'string' },
          authority: {
            type: 'string',
            description: 'Token the browser calls of this run must present; empty when no role is verified.',
          },
          note: { type: 'string' },
        },
      },
      render(_args, value) {
        const result = operationResultSchema.parse(value)
        return [{ type: 'text', text: `Operation ${result.operationKey} is ${result.dispatch}. ${result.note}` }]
      },
    },
    async execute(args, exec) {
      refusing()
      const input = settleOperationInputSchema.parse(args)
      const record = await store.settleOperation(input.runKey, input.operationKey, input.outcome)
      // `settleOperation` only ever returns a settled operation, so the outcome
      // is present; reading it through the discriminant keeps that explicit.
      const settled = record.dispatch
      return {
        runKey: record.runKey,
        operationKey: record.operationKey,
        dispatch: settled.kind,
        // The run's live authority, read back so the browser calls that follow a
        // settlement use the token `web_test_assume_role` issued rather than one
        // the model carried through. It is empty when the run no longer holds a
        // verified role, which is the same refusal `requireAuthority` would give.
        authority: store.currentAuthority(record.runKey, requireAgentId(exec))?.token ?? '',
        note: settled.kind === 'settled'
          ? `Recorded as ${settled.outcome}; it will appear in the report and cannot be settled again.`
          : 'The operation was not settled.',
      }
    },
  }), 'web-test: settle operation tool')

  ctx.effect(() => tools.register({
    name: `${TOOL_PREFIX}operation_unknown`,
    description:
      'Record that a business-changing operation may or may not have taken effect, because the connection dropped or'
      + ' the result could not be observed. The operation stays unresolved and is never submitted again; it reaches'
      + ' the report and the operator as a question. Use this instead of retrying.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runKey', 'operationKey', 'reason'],
      properties: {
        runKey: { type: 'string' },
        operationKey: { type: 'string' },
        reason: { type: 'string', description: 'What was lost, so the operator can check the business system.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['runKey', 'operationKey', 'dispatch', 'authority', 'note'],
        properties: {
          runKey: { type: 'string' },
          operationKey: { type: 'string' },
          dispatch: { type: 'string' },
          authority: {
            type: 'string',
            description: 'Token the browser calls of this run must present; empty when no role is verified.',
          },
          note: { type: 'string' },
        },
      },
      render(_args, value) {
        const result = operationResultSchema.parse(value)
        return [{ type: 'text', text: `Operation ${result.operationKey} is ${result.dispatch}. ${result.note}` }]
      },
    },
    async execute(args) {
      refusing()
      const input = operationUnknownInputSchema.parse(args)
      const record = await store.markOperationUnknown(input.runKey, input.operationKey, input.reason)
      return {
        runKey: record.runKey,
        operationKey: record.operationKey,
        dispatch: record.dispatch.kind,
        note: 'Do not submit this operation again. Report what you know and leave the decision to the operator.',
      }
    },
  }), 'web-test: operation unknown tool')

  ctx.effect(() => tools.register({
    name: `${TOOL_PREFIX}assume_role`,
    description:
      'Act as one of the roles the operator declared for this environment, for the rest of the run. The plugin'
      + ' refuses a role the environment never declared, and refuses a role change while a business-changing'
      + ' operation is unresolved.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runKey', 'role', 'accountPage'],
      properties: {
        runKey: { type: 'string' },
        accountPage: {
          type: 'string',
          format: 'uri',
          description:
            'Absolute URL of the page in the role browser that states the signed-in account, read '
            + 'from the page itself. A relative path is rejected, so pass the full address bar URL. This '
            + 'is what the verification is traced to, so a login form, an error page or an empty value '
            + 'does not pass.',
        },
        role: { type: 'string', description: 'Declared role name, or an empty string to act without a role.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['runKey', 'operationKey', 'dispatch', 'authority', 'note'],
        properties: {
          runKey: { type: 'string' },
          operationKey: { type: 'string' },
          dispatch: { type: 'string' },
          authority: {
            type: 'string',
            description: 'Token the browser calls of this run must present; empty when no role is verified.',
          },
          note: { type: 'string' },
        },
      },
      render(_args, value) {
        const result = operationResultSchema.parse(value)
        return [{ type: 'text', text: result.note }]
      },
    },
    async execute(args, exec) {
      refusing()
      const parsed = z.object({
        runKey: z.string().min(1),
        role: z.string(),
        accountPage: z.string().url(),
      }).parse(args)
      // The role is bound to a real browser and the account is read back from
      // the site before the field is written, so a run never claims an identity
      // the site did not confirm.
      // The owner is read before the browser starts, because the browser is
      // filed under the project, environment and run that will use it rather
      // than under the role name alone.
      const owner = store.getRun(parsed.runKey)
      const mountOwner = {
        sessionId: owner?.ownerSessionId ?? '',
        generation: owner?.generation ?? 0,
        projectKey: owner?.projectKey ?? '',
        environmentKey: owner?.environmentRevisionKey ?? '',
        runKey: parsed.runKey,
        role: parsed.role,
      }
      const verified = await verifyRoleIdentity(tools, exec, pool, mountOwner, parsed.accountPage)
      const run = await store.assumeRole(parsed.runKey, parsed.role, verified)
      // The role's browser belongs to this run and generation, so a call queued
      // against an earlier run cannot prepare an identity on it. The mount's own
      // server name is the claim's key: a role name is shared by every run that
      // declares it.
      pool?.claim(pool.serverNameFor(mountOwner), run.key, run.generation)
      // The authority names the generation it was minted in, so a call that was
      // queued before a restart cannot act under the authority a later start
      // produces. It is unforgeable: the run it names is re-read on every use.
      const authority = store.mintAuthority(parsed.runKey, requireAgentId(exec))
      return {
        runKey: run.key,
        operationKey: '',
        dispatch: run.activeRole === '' ? 'no-role' : run.activeRole,
        authority: authority?.token ?? '',
        note: run.activeRole === ''
          ? `Run ${run.key} now acts without a declared role.`
          : `Run ${run.key} now acts as ${run.activeRole}; every operation and case result records it.`
            + ` Present authority ${JSON.stringify(authority?.token ?? '')} with the actions it allows;`
            + ' it stops working if this run is cancelled, restarted or resumes.',
      }
    },
  }), 'web-test: assume role tool')

  ctx.effect(() => tools.register({
    name: `${TOOL_PREFIX}wait`,
    description:
      'Park this run until a moment when a business effect becomes observable, such as a job that finishes or a'
      + ' settlement window. The deadline is stored, so the wait survives the host closing, and the run refuses new'
      + ' test actions until web_test_resume_wait ends it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runKey', 'untilIso', 'reason'],
      properties: {
        runKey: { type: 'string' },
        untilIso: { type: 'string', description: 'ISO 8601 moment in the future, for example 2026-10-04T20:15:00Z.' },
        reason: { type: 'string', description: 'What the run is waiting for, for the report and the operator.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['runKey', 'operationKey', 'dispatch', 'authority', 'note'],
        properties: {
          runKey: { type: 'string' },
          operationKey: { type: 'string' },
          dispatch: { type: 'string' },
          authority: {
            type: 'string',
            description: 'Token the browser calls of this run must present; empty when no role is verified.',
          },
          note: { type: 'string' },
        },
      },
      render(_args, value) {
        const result = operationResultSchema.parse(value)
        return [{ type: 'text', text: result.note }]
      },
    },
    async execute(args) {
      refusing()
      const input = waitInputSchema.parse(args)
      const untilMs = Date.parse(input.untilIso)
      if (Number.isNaN(untilMs)) {
        throw new Error(`web-test: ${JSON.stringify(input.untilIso)} is not an ISO 8601 moment`)
      }
      const run = await store.waitUntil(input.runKey, untilMs, input.reason)
      return {
        runKey: run.key,
        operationKey: '',
        dispatch: run.status,
        note: `Run ${run.key} waits until ${new Date(run.waitingUntilMs).toISOString()} for: ${run.waitingReason}.`
          + ' It refuses new test actions meanwhile, and the deadline survives a host restart.',
      }
    },
  }), 'web-test: wait tool')

  ctx.effect(() => tools.register({
    name: `${TOOL_PREFIX}resume_wait`,
    description:
      'End a business-time wait once the stored deadline has passed, so the run may act again. Calling it before the'
      + ' deadline is refused with the remaining time instead of waiting.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runKey'],
      properties: {
        runKey: {
          type: 'string',
          description: 'The run whose wait is ending early, as reported by web_test_status.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['runKey', 'operationKey', 'dispatch', 'authority', 'note'],
        properties: {
          runKey: { type: 'string' },
          operationKey: { type: 'string' },
          dispatch: { type: 'string' },
          authority: {
            type: 'string',
            description: 'Token the browser calls of this run must present; empty when no role is verified.',
          },
          note: { type: 'string' },
        },
      },
      render(_args, value) {
        const result = operationResultSchema.parse(value)
        return [{ type: 'text', text: result.note }]
      },
    },
    async execute(args) {
      refusing()
      const input = z.object({ runKey: z.string().min(1) }).parse(args)
      const run = await store.resumeWait(input.runKey)
      return {
        runKey: run.key,
        operationKey: '',
        dispatch: run.status,
        note: `Run ${run.key} is running again. Check the page before repeating anything.`,
      }
    },
  }), 'web-test: resume wait tool')

  ctx.effect(() => tools.register({
      name: `${TOOL_PREFIX}status`,
      description:
        'Report whether the Web testing plugin is loaded, which lifecycle state it is in, and how many projects and '
        + 'runs its own storage currently holds. Use this to confirm the test session is wired up before starting a '
        + 'run.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: statusToolOutputSchema,
        render(_args, value) {
          // `render` receives the pipeline's JSON value, so it narrows with the
          // same schema the tool body fulfils instead of indexing blindly.
          const result = statusResultSchema.parse(value)
          const interrupted = result.interruptedRuns.length === 0
            ? ''
            : ` A previous host run was interrupted; these runs need the operator to continue them: ${result.interruptedRuns.join(', ')}.`
          const unknown = result.unknownOperations.length === 0
            ? ''
            : ` These operations have an unobserved outcome and must not be repeated: ${result.unknownOperations.join(', ')}.`
          return [{
            type: 'text',
            text: `Web testing plugin ${result.version} (${result.state}). `
              + `Projects: ${result.projectCount}. Runs: ${result.runCount}.${interrupted}${unknown}`,
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
          interruptedRuns: [...status.reconciliation.blockedRuns],
          unknownOperations: status.reconciliation.unknownOperations.map(
            operation => `${operation.runKey}/${operation.operationKey}`,
          ),
        }
      },
  }), 'web-test: status tool')

  ctx.effect(() => tools.register({
      name: `${TOOL_PREFIX}control_run`,
      description:
        'Move one of your runs to another lifecycle state: pause it, resume it, continue a run a host restart left '
        + 'parked, park it until a business deadline, wait for the operator, or cancel it. Resuming or continuing '
        + 'starts a new generation, so any authority you were given earlier stops working and you must act as a role '
        + 'again before the next operation. Use this when web_test_status reports a run the operator needs continued, '
        + 'or when the operator asks you to pause, resume or cancel.',
      parameters: {
        type: 'object',
        properties: {
          runKey: { type: 'string', description: 'Run to move, as reported by web_test_status.' },
          action: {
            type: 'string',
            enum: ['pause', 'resume', 'continue', 'await-user', 'cancel'],
            description: 'Target state. `continue` releases a run a host restart interrupted.',
          },
        },
        required: ['runKey', 'action'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            runKey: { type: 'string' },
            status: { type: 'string' },
            activeRole: { type: 'string' },
            generation: { type: 'number' },
            message: { type: 'string' },
          },
          required: ['runKey', 'status', 'activeRole', 'generation', 'message'],
        },
        render(_args, value) {
          const result = controlRunResultSchema.parse(value)
          return [{
            type: 'text',
            text: `Run ${result.runKey} is now ${result.status} at generation ${result.generation}. ${result.message}`,
          }]
        },
      },
      async execute(args): Promise<z.infer<typeof controlRunResultSchema>> {
        const input = controlRunArgsSchema.parse(args)
        const run = await store.controlRun(input.runKey, input.action)
        // A run that stopped acting gives up its claims on the role browsers it
        // held. Leaving them in place keeps preparation bound to a run that is
        // cancelled or terminal, so the next run cannot sign in even though it
        // declares the same role.
        const generation = run.generation
        return {
          runKey: run.key,
          status: run.status,
          activeRole: run.activeRole,
          generation,
          message: run.status === 'running'
            ? 'Act as a role again before the next operation; the previous authority is void.'
            : 'It will not accept new test actions in this state.',
        }
      },
  }), 'web-test: control_run tool')

}
