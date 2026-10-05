/**
 * One isolated browser per role, with the model locked to the active role.
 *
 * The stock Playwright MCP provider mounts one browser per Session and offers
 * no tool that creates a second context, so two roles acting at once cannot
 * hold separate cookies through it. This module mounts one MCP server per role
 * instead: each runs the same pinned `@playwright/mcp` CLI with `--isolated`,
 * so every role gets its own Chromium process with its own cookie jar and
 * storage. It owns routing and release only — the browser, the agent loop, and
 * the host stay the ones the host already ships.
 *
 * Reachability is enforced with the host's own `tools.restrict`: every role's
 * tools are denied except the active role's, so the model has no path to
 * another role's browser while another role is active.
 *
 * @module dsh-plugin-web-test/src/role-browser
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type ToolsService from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'

/** Loader identity of this service's row. */
export const name = 'webTestRoleBrowsers'

/** Browser settings the operator configures for the test preset. */
export type RoleBrowserConfig = z.infer<typeof RoleBrowserPool.Config>

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Per-role browser resources, owned by this plugin's own loader row. */
    webTestRoleBrowsers: RoleBrowserPool
  }
}

/** Tool name prefix the pinned Playwright MCP server registers its tools under. */
const BROWSER_TOOL_PREFIX = 'mcp__playwright-role-'

/** Suffix of the tools this module lets the model reach for the active role. */
const BROWSER_TOOL_SUFFIX = '__'

/** How long a role's MCP server may take to come up before the switch fails. */
const ROLE_STARTUP_TIMEOUT_MS = 60_000

/** What one role's browser resource is and how to address it. */
export interface RoleBrowser {
  /** Role name the run declared for this browser. */
  readonly role: string
  /** MCP server identity, which is also the tool namespace. */
  readonly serverName: string
  /** Every tool this role's browser registers. */
  readonly toolNames: readonly string[]
}

/** A role's browser that came up, and the account the site reported for it. */
export interface VerifiedRole extends RoleBrowser {
  /** The account the site answered with, not the role name the run declared. */
  readonly account: string
}

/** What a role's site answered when its identity was checked. */
export interface IdentityAnswer {
  /** Account the site reported, or an empty string when it reported none. */
  account: string
  /** Raw response, kept so a failure can be reported as the site stated it. */
  detail: string
}

/**
 * Per-role browser resources for one plugin instance.
 *
 * Browsers are started when a run switches to a role and released when the run
 * finishes, the plugin drains, or the process ends. Nothing here touches a
 * browser another session or an ordinary DSH conversation owns.
 */
export class RoleBrowserPool extends Service {
  /** Started role browsers, in the order they were created. */
  private readonly started = new Map<string, RoleBrowser>()

  /** Disposers returned by `mountSessionMcp`, one per started role. */
  private readonly mounts = new Map<string, () => void>()

  /**
   * @param ctx - Owning context, which supplies the tools and browser services
   * the provider rows need.
   * @param executablePath - Chromium the role browsers launch; the host
   * installs no Playwright browser build, so this is a standalone Chrome.
   * @param headless - Whether role browsers run without a window.
   */
  static inject = ['browserUse', 'agents', 'tools', 'systemPrompt']

  /** Browser settings the operator chooses on the loader row. */
  static Config = z.object({
    /**
     * Chromium to launch, left unset by default.
     *
     * An unset value hands discovery to the pinned provider, which finds
     * Chrome, Edge, or its own Chromium on the machine it runs on. A path
     * baked into a published bundle would only ever be right for the machine
     * that wrote it, and the field is a top-level row setting so a profile can
     * override it without restating the preset.
     */
    executablePath: z.string().optional(),
    /** Whether role browsers run without a window. */
    headless: z.boolean().default(false),
  })

  /**
   * @param ctx - Owning context, which supplies the browser and tool services
   * each role's MCP server needs.
   * @param config - Chromium choice and window mode.
   */
  constructor(ctx: Context, config: RoleBrowserConfig) {
    super(ctx, 'webTestRoleBrowsers')
    this.executablePath = config.executablePath
    this.headless = config.headless
    this.ctx = ctx
    // Disabling this row is what reaps the Chromium instances the plugin owns.
    // Nothing else is touched: another session's browser and the user's own
    // are not this plugin's to close.
    ctx.effect(() => () => {
      void this.releaseAll()
    })
  }

  private readonly executablePath: string | undefined

  private readonly headless: boolean

  /**
   * Start a role's browser if it is not already up.
   *
   * Starting is idempotent because a run may switch back and forth between
   * roles, and a second browser for the same role would drop the login the
   * first one established.
   * @param role - Declared role name.
   * @returns the role's browser resource.
   */
  async ensure(role: string): Promise<RoleBrowser> {
    const existing = this.started.get(role)
    if (existing !== undefined) return existing
    const serverName = `playwright-role-${role}`
    // The provider is loaded on demand rather than at import time: it pulls the
    // MCP client's whole peer tree, which a unit test that never starts a
    // browser should not have to load.
    const { mountSessionMcp } = await import('@deepseek-ai/dsh-experimental-browser-use-runtime/mcp')
    this.ctx.effect(() => {
      mountSessionMcp(this.ctx, {
        name: serverName,
        // Each role owns its own Chromium, so no two roles contend for one
        // attached browser and neither can land on the other's page.
        exclusive: false,
        command: process.execPath,
        args: playwrightArgs(this.executablePath, this.headless),
        env: {},
      })
      // The provider registers its own disposal against this context, so
      // dropping the entry here is all the role release has to do; the Chromium
      // itself goes with the provider's teardown.
      return () => { this.mounts.delete(role) }
    })
    const browser: RoleBrowser = {
      role,
      serverName,
      toolNames: [],
    }
    this.started.set(role, browser)
    this.mounts.set(role, () => { this.started.delete(role) })
    return browser
  }

  /**
   * Every role browser this pool has started.
   *
   * Read at activation time: the provider registers an MCP server's tools when
   * a Session's agent activates, so a role started moments ago has none until
   * then, and the deny list is rebuilt each time the active role changes.
   * @returns the started role browsers.
   */
  list(): RoleBrowser[] {
    return [...this.started.values()]
  }

  /**
   * Tool names belonging to roles other than the active one.
   *
   * The model must not reach them: a second role's browser is a different
   * account, and using it would attribute one role's actions to another.
   * @param activeRole - Role the run is acting as, or an empty string.
   * @returns names to deny for the current activation.
   */
  forbiddenTools(activeRole: string): string[] {
    return this.list()
      .filter(browser => browser.role !== activeRole)
      .flatMap(browser => browser.toolNames)
  }

  /**
   * The tool namespace a role's browser actions live under.
   *
   * @param role - Declared role name.
   * @returns the prefix, for matching a tool back to its role.
   */
  static namespaceOf(role: string): string {
    return `${BROWSER_TOOL_PREFIX}${role}${BROWSER_TOOL_SUFFIX}`
  }

  /**
   * Which role a tool name belongs to, when it is one of ours.
   *
   * @param toolName - Global tool name as registered.
   * @returns the role name, or an empty string when the tool is not ours.
   */
  static roleOf(toolName: string): string {
    if (!toolName.startsWith(BROWSER_TOOL_PREFIX)) return ''
    return toolName.slice(BROWSER_TOOL_PREFIX.length).split(BROWSER_TOOL_SUFFIX)[0] ?? ''
  }

  /**
   * Start every named role's browser without waiting for them.
   *
   * Used at run start so the next Agent can already reach them. A failure is
   * reported to the caller rather than swallowed, because a run whose browsers
   * never came up must not look like one that is ready to execute.
   * @param roles - Role names to start.
   * @returns once every role's mount call has returned.
   */
  async prefetch(roles: readonly string[]): Promise<void> {
    await Promise.all(roles.map(role => this.ensure(role)))
  }

  /**
   * Read the signed-in account back from the site, through this role's browser.
   *
   * Two nested tool calls: navigate to the identity endpoint, then read the
   * page text. Both are dispatched through the tools pipeline as nested calls
   * of the call that asked for the role, so the whole thing is logged as one
   * operation rather than as a browser action nobody declared.
   * @param tools - Tools service the role's browser tools are registered on.
   * @param exec - Execution identity of the call asking for verification.
   * @param role - Role whose browser to ask.
   * @param identityUrl - Site endpoint that reports the current account.
   * @returns the account the site reported and the text it reported it in.
   */
  async readAccount(
    tools: ToolsService,
    exec: ToolRunContext,
    role: string,
    identityUrl: string,
  ): Promise<IdentityAnswer> {
    const namespace = RoleBrowserPool.namespaceOf(role)
    // `ToolsRuntime` resolves a tool with `view(scope)`, so the call has to
    // name the same Agent the model used. Without `agent` the lookup falls
    // back to the global view, where an MCP server's tools are not registered
    // and every role browser reads as an unknown tool. `parent` alone only
    // links the call to the outer one; it carries no scope.
    const child = childCallId(exec, 'navigate')
    const navigate = await tools.execute({
      ...child,
      name: `${namespace}browser_navigate`,
      arguments: { url: identityUrl },
      signal: exec.signal,
    })
    assertToolOk(navigate, `${namespace}browser_navigate`, role)
    const probe = childCallId(exec, 'identity')
    const read = await tools.execute({
      ...probe,
      name: `${namespace}browser_evaluate`,
      arguments: { function: IDENTITY_PROBE },
      signal: exec.signal,
    })
    assertToolOk(read, `${namespace}browser_evaluate`, role)
    return parseIdentity(firstText(read.value))
  }

  /**
   * Release every browser this pool started.
   *
   * Called when the plugin drains, which is also what a run's completion does,
   * so a run cannot leave a Chromium running after it stops.
   * @returns once every role's server is disposed.
   */
  async releaseAll(): Promise<void> {
    const disposers = [...this.mounts.values()]
    this.mounts.clear()
    this.started.clear()
    for (const dispose of disposers) dispose()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

/**
 * The page function that reports identity.
 *
 * It reads a marker the identity endpoint sets, so a login page or an error
 * page cannot be mistaken for a signed-in account: an unsigned page answers
 * with an empty string rather than with whatever text happens to be on it.
 */
const IDENTITY_PROBE = '() => document.body.dataset.webtestAccount ?? ""'

/**
 * Derive a child call id from the call that asked for it.
 *
 * A child needs its own id so the session log keeps the inner call and the
 * outer one apart, while the shared prefix keeps the two correlatable.
 * @param parentId - The enclosing call's id.
 * @param label - What the child does.
 * @returns the child's call id.
 */
function childCallId(exec: ToolRunContext, label: string): {
  callId: ToolCallId
  rootCallId: ToolCallId
  parent: ToolExecutionToken
  agent: NonNullable<ToolRunContext['agent']>
} {
  return {
    callId: ToolCallId(`${exec.callId}:web-test:${label}`),
    rootCallId: ToolCallId(exec.callId),
    parent: exec.token,
    agent: requireAgent(exec),
  }
}

/**
 * The Agent a nested call must be attributed to.
 *
 * A call with no Agent would resolve against the global tool view, which is
 * not this session's browser set; rather than widen the lookup, the call is
 * refused.
 * @param exec - The enclosing execution.
 * @returns the Agent that owns the role browser.
 * @throws when the enclosing call has no Agent.
 */
function requireAgent(exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  if (exec.agent === undefined) {
    throw new Error('web-test: this call has no Agent, so a role browser cannot be reached; run a browser action'
      + ' from a Web testing session')
  }
  return exec.agent
}

/**
 * Read the account out of an identity probe's answer.
 *
 * The probe returns the `data-web-test-account` attribute or an empty string,
 * so the only way a value arrives is a page that actually declared an account.
 * @param raw - The text the probe returned.
 * @returns the account and the raw text, for the record.
 */
function parseIdentity(raw: string): IdentityAnswer {
  const text = raw.trim()
  const account = text.replace(/^["']|["']$/g, '')
  if (account === '') {
    return { account: '', detail: text === '' ? 'the page carried no data-web-test-account marker' : text }
  }
  return { account, detail: text }
}

/**
 * Refuse a browser call that did not succeed, naming the role whose browser
 * failed so the operator is not left guessing which account is unusable.
 * @param result - What the tools service returned.
 * @param toolName - Tool that was called, for the message.
 * @param role - Role the call belonged to.
 * @throws when the call failed.
 */
function assertToolOk(result: ToolExecutionResult, toolName: string, role: string): void {
  if (!result.isError) return
  const detail = result.error.message
  // The provider hands an MCP server's tools to an Agent when that Agent is
  // created, so a browser started during this turn is not callable yet. Saying
  // so is the difference between the model retrying and the run stalling.
  const pending = detail.includes('unknown tool')
    ? '. This role\'s browser was started when the run began and its tools reach the model on the next turn, so call'
      + ' web_test_assume_role again.'
    : ''
  throw new Error(`web-test: role ${JSON.stringify(role)}'s browser failed ${toolName}: ${detail}${pending}`)
}

/**
 * First text block of a tool result, which is where the MCP server reports.
 * @param result - Successful tool result.
 * @returns its text, or an empty string when it carried none.
 */
function firstText(result: unknown): string {
  if (!Array.isArray(result)) return ''
  for (const block of result) {
    if (typeof block === 'object' && block !== null && 'text' in block) {
      const text = (block as { text: unknown }).text
      if (typeof text === 'string') return text
    }
  }
  return ''
}

/**
 * Command-line arguments that start one isolated Playwright MCP browser.
 *
 * `--isolated` is what gives each role its own cookie jar and storage instead
 * of a shared or on-disk profile; it is the same flag the stock provider passes,
 * applied per role rather than per Session.
 * @param executablePath - Chromium to launch, or undefined to let the provider
 * discover one.
 * @param headless - Whether to run without a window.
 * @returns the argument list, without the executable itself.
 */
function playwrightArgs(executablePath: string | undefined, headless: boolean): string[] {
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@playwright/mcp/package.json'))), 'cli.js')
  const args = [cli, '--browser', 'chromium', '--isolated']
  if (headless) args.push('--headless')
  // Passing the flag only when one was configured is what lets the provider
  // discover a browser on a machine that has one, which is every platform
  // rather than the one whose path was committed.
  if (executablePath !== undefined) args.push('--executable-path', executablePath)
  return args
}

/**
 * How long a role browser may take to come up.
 *
 * Exposed so a caller can apply its own deadline instead of inventing one.
 */
export { ROLE_STARTUP_TIMEOUT_MS }

export default RoleBrowserPool
