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
import type { Context, Disposable } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Scope } from '@deepseek-ai/dsh-scope'
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
/** Prefix every MCP tool namespace carries, before the server's own name. */
const MCP_PREFIX = 'mcp__'

const BROWSER_TOOL_PREFIX = `${MCP_PREFIX}playwright-role-`

/** Suffix of the tools this module lets the model reach for the active role. */
export const BROWSER_TOOL_SUFFIX = '__'

/** Generation suffix a re-mounted role's server name carries, e.g. `buyer-g2`. */
const GENERATION_SUFFIX = /-g\d+$/u

/** How long a role's MCP server may take to come up before the switch fails. */
const ROLE_STARTUP_TIMEOUT_MS = 60_000

/** What one role's browser resource is and how to address it. */
/**
 * The identity one mounted role browser belongs to.
 *
 * Every field is what an authorisation has to match: the declared project and
 * environment revision, the run and its generation, the role, and the exact
 * mount the tool namespace names.
 */
export interface MountOwner {
  /** Project whose environment declares the role. */
  projectKey: string
  /** Confirmed environment revision the role belongs to. */
  environmentKey: string
  /** Run acting as the role; empty before a run exists. */
  runKey: string
  /** Declared role name. */
  role: string
  /** Run generation the mount was created under. */
  generation: number
  /** MCP server name, which is the tool namespace's identity. */
  serverName: string
  /** Session the mount belongs to; another session may not drive it. */
  sessionId: string
}

/**
 * The mount keys one run owns.
 *
 * Selection is by the mount's own owner, never by a role name: two runs in one
 * session can each declare `buyer`, and a release that reached for the role
 * reached whichever mount happened to be filed under it.
 * @param owners - Every mounted browser's owner.
 * @param runKey - Run whose mounts are wanted.
 * @returns the distinct keys of that run's mounts.
 */
export function mountKeysOfRun(owners: MountOwner[], runKey: string): string[] {
  return [...new Set(owners
    .filter(owner => owner.runKey === runKey)
    .map(owner => RoleBrowserPool.keyOf(owner)))]
}

/**
 * Every mounted browser's key.
 * @param owners - Every mounted browser's owner.
 * @returns the distinct keys of all mounts.
 */
export function allMountKeys(owners: MountOwner[]): string[] {
  return [...new Set(owners.map(owner => RoleBrowserPool.keyOf(owner)))]
}

/**
 * Run every disposer in turn and report the ones that refused.
 *
 * A teardown that fails must not stop the sweep, and the caller must not treat a
 * pool as empty afterwards: the disposer stays filed under its own key so the
 * next release retries it. `releaseAll` and `releaseRun` both funnel through
 * here so neither can forget the sweep.
 * @param dispose - Releases one mount by its key; throws when it refused.
 * @param keys - The keys to release, in order.
 * @returns One message per disposer that threw; empty when all of them closed.
 */
export async function disposeAll(
  dispose: (key: string) => Promise<void>,
  keys: readonly string[],
): Promise<string[]> {
  const failures: string[] = []
  for (const key of keys) {
    try {
      await dispose(key)
    } catch (error) {
      failures.push(String(error))
    }
  }
  return failures
}

/**
 * The tool namespace one owner's browser answers on.
 *
 * Read from the mount filed under that owner, never from the newest mount of the
 * role: two runs in one session can each declare `buyer`, and reading whichever
 * started last would read an account the caller does not own. With no mount yet
 * the namespace is derived from the role, which is the name the provider would
 * have used for its first mount.
 * @param started - Mounted browsers by their owner key.
 * @param owner - Identity the read belongs to.
 * @returns The `mcp__<server>__` namespace to call through.
 */
export function namespaceFor(
  started: ReadonlyMap<string, RoleBrowser>,
  owner: BrowserOwner,
): string {
  const live = started.get(RoleBrowserPool.keyOf(owner))
  return live === undefined
    ? RoleBrowserPool.namespaceOf(owner.role)
    : `mcp__${live.serverName}__`
}

/**
 * File a freshly mounted browser under its owner.
 *
 * The claim is written in the same step as the mount, not after the identity has
 * been confirmed. A window in which the mount existed but nothing owned it left
 * the plugin's own identity read refused by its own guard, and left the browser
 * unreleased when its run was cancelled.
 * @param started - Mounted browsers by owner key.
 * @param owners - Each mounted browser's owner, by server name.
 * @param claims - Which run and generation owns each server name.
 * @param key - The owner key the mount is filed under.
 * @param owner - Identity that mounted it.
 * @param browser - The browser itself.
 */
export function recordMount(
  started: Map<string, RoleBrowser>,
  owners: Map<string, MountOwner>,
  claims: Map<string, { runKey: string, generation: number }>,
  key: string,
  owner: BrowserOwner,
  browser: RoleBrowser,
): void {
  started.set(key, browser)
  claims.set(browser.serverName, { runKey: owner.runKey, generation: owner.generation })
  owners.set(browser.serverName, {
    sessionId: owner.sessionId,
    projectKey: owner.projectKey,
    environmentKey: owner.environmentKey,
    runKey: owner.runKey,
    role: browser.role,
    generation: owner.generation,
    serverName: browser.serverName,
  })
}

/**
 * Take one mount out of the pool's tracking, and hand back what has to be put
 * back if its teardown refuses.
 *
 * Releasing is two steps: stop tracking the mount, then await its disposer. If
 * that disposer throws, the mount is still live, so its disposer, its browser and
 * its owner all go back under the names they had. Dropping them would let a later
 * release report an empty pool while the browser was still running.
 * @param mounts - Disposers by owner key.
 * @param started - Mounted browsers by owner key.
 * @param owners - Each mounted browser's owner, by server name.
 * @param claims - Which run and generation owns each server name.
 * @param keysByRole - Which owner keys each role has mounts under.
 * @param key - The owner key being released.
 * @returns The disposer to await, plus the records to restore when it throws.
 */
export interface DetachedMount {
  /** Disposer to await; undefined when the key held no mount. */
  dispose: (() => Promise<void>) | undefined
  /** The browser that was filed under `key`, if any. */
  browser: RoleBrowser | undefined
  /** The owner that was filed under the browser's server name, if any. */
  owner: MountOwner | undefined
}

/**
 * Stop tracking one mounted browser.
 * @param mounts - Disposers by owner key.
 * @param started - Mounted browsers by owner key.
 * @param owners - Each mounted browser's owner, by server name.
 * @param claims - Which run and generation owns each server name.
 * @param keysByRole - Which owner keys each role has mounts under.
 * @param key - The owner key being released.
 * @returns What has to be restored if the disposer refuses.
 */
export function detachMount(
  mounts: Map<string, () => Promise<void>>,
  started: Map<string, RoleBrowser>,
  owners: Map<string, MountOwner>,
  claims: Map<string, { runKey: string, generation: number }>,
  keysByRole: Map<string, Set<string>>,
  key: string,
): DetachedMount {
  const dispose = mounts.get(key)
  const browser = started.get(key)
  const owner = browser === undefined ? undefined : owners.get(browser.serverName)
  mounts.delete(key)
  started.delete(key)
  if (browser !== undefined) {
    owners.delete(browser.serverName)
    claims.delete(browser.serverName)
    const roleKeys = keysByRole.get(browser.role)
    roleKeys?.delete(key)
    if (roleKeys !== undefined && roleKeys.size === 0) keysByRole.delete(browser.role)
  }
  return { dispose, browser, owner }
}

/**
 * Put a refused mount back under the names it had before its teardown.
 * @param mounts - Disposers by owner key.
 * @param started - Mounted browsers by owner key.
 * @param owners - Each mounted browser's owner, by server name.
 * @param keysByRole - Which owner keys each role has mounts under.
 * @param key - The owner key whose teardown refused.
 * @param detached - What {@link detachMount} handed back.
 */
export function restoreMount(
  mounts: Map<string, () => Promise<void>>,
  started: Map<string, RoleBrowser>,
  owners: Map<string, MountOwner>,
  keysByRole: Map<string, Set<string>>,
  key: string,
  detached: DetachedMount,
): void {
  if (detached.dispose !== undefined) mounts.set(key, detached.dispose)
  if (detached.browser === undefined) return
  started.set(key, detached.browser)
  const roleKeys = keysByRole.get(detached.browser.role) ?? new Set<string>()
  roleKeys.add(key)
  keysByRole.set(detached.browser.role, roleKeys)
  if (detached.owner !== undefined) owners.set(detached.browser.serverName, detached.owner)
}

export interface RoleBrowser {
  /** Role name the run declared for this browser. */
  readonly role: string
  /** MCP server identity, which is also the tool namespace. */
  readonly serverName: string
  /** Every tool this role's browser registers. */
  readonly toolNames: readonly string[]
}

/**
 * The identity that owns a role browser.
 *
 * A role name alone is not an owner: the same `buyer` is declared by different
 * projects and environments, and each run may hold its own. Keying on the name
 * alone would hand one run the browser another run signed in on, so the key is
 * built from the project, the environment, the run and the role together.
 */
export interface BrowserOwner {
  /** Session the mount belongs to; another session may not drive it. */
  sessionId: string
  /**
   * Run generation the mount is created under.
   *
   * The caller supplies it from the run it is mounting for. Reading it back from
   * the pool instead cannot work: the mount does not exist yet at that point, so
   * the lookup returns nothing and every mount would be filed as generation 0.
   */
  generation: number
  /** Project whose environment declares the role. */
  projectKey: string
  /** Confirmed environment revision the role belongs to. */
  environmentKey: string
  /** Run acting as the role; empty before a run exists. */
  runKey: string
  /** Declared role name. */
  role: string
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
  /**
   * The pool's tracking maps, read-only.
   *
   * Their element types are exported contracts (`RoleBrowser`, `MountOwner`), and
   * what the pool still holds cannot be observed without the provider. Exposing
   * them lets a caller read the pool's state and lets a test drive a real
   * disposer through it; nothing outside this class may add to or change them.
   */
  readonly started = new Map<string, RoleBrowser>()
  /**
   * Roles whose mount is in flight, so a second caller waits on the same one.
   *
   * The owner is held beside the promise rather than only being written when the
   * mount completes. A release that arrives in between selects its targets from
   * the owners, and a start that has not finished has none yet, so without this
   * the release finds nothing and the browser the start then completes stays up
   * for a run that no longer exists.
   */
  private readonly pending = new Map<string, { settled: Promise<RoleBrowser>, owner: BrowserOwner & { generation: number } }>()
  /**
   * Keys released while their mount was still in flight, consumed by that start
   * once it completes. Without it the release finds nothing to close and the
   * browser the start then brings up stays for a run that no longer exists.
   */
  private readonly abandoned = new Set<string>()

  /** Disposers returned by `mountSessionMcp`, one per started role. */
  /**
   * Mounts that have not been released, keyed by owner key.
   *
   * Exposed read-only because whether a browser is actually running cannot be
   * observed without the provider: a caller that needs to know what the pool
   * still holds reads this, and nothing outside the class may add to it.
   */
  readonly mounts = new Map<string, Disposable<Promise<void>>>()
  /** The role this pool currently drives; the host allows only one at a time. */
  private activeRole: string | undefined

  /**
   * Agents the host has announced, in the order they appeared.
   *
   * A role confirmed before its session exists has no Agent yet, and a role
   * switched to afterwards belongs to one that already exists. Recording the
   * announcements is what lets both cases open a client without the pool
   * inventing an Agent or a lifecycle event of its own.
   */
  readonly knownAgents = new Set<Agent>()

  /**
   * Which run and generation each started role browser belongs to.
   *
   * A role name is not an owner: two runs in one session can each declare
   * `buyer`, and a call queued against the first must not be allowed to prepare
   * an identity on the second. The claim is recorded when a run starts acting as
   * a role and dropped with the browser, so preparation can be judged against the
   * run that actually owns the resource the call would drive.
   */
  readonly claims = new Map<string, { runKey: string, generation: number }>()

  /**
   * Who each mounted browser belongs to, by MCP server name.
   *
   * The guard judges a browser call against the mount it names, so the mount has
   * to carry its own owner rather than be inferred from a role name, a session or
   * the newest mount of a role.
   */
  readonly owners = new Map<string, MountOwner>()

  /**
   * The composite key each started role is filed under, by role name.
   *
   * Releasing by role name is a last resort for a caller that does not know the
   * owner; once two runs hold the same role this is the only way to find a key at
   * all, so a release that names a run releases that run's browser and no other.
   */
  /**
   * Every key a role has been mounted under. A role mounted twice keeps two
   * keys, and releasing one of them must release the other as well: recording
   * only the newest left the earlier entry in `mounts` with nothing reaching it.
   */
  private readonly keysByRole = new Map<string, Set<string>>()

  /** How many times each role has been mounted, so a re-mount can take a new name. */
  private readonly mountCount = new Map<string, number>()

  /**
   * Record which run and generation owns a role's browser.
   * @param role - The role being acted as.
   * @param runKey - Run that switched to the role.
   * @param generation - Run generation at the moment of the switch.
   */
  claim(serverName: string, runKey: string, generation: number): void {
    if (serverName === '') return
    this.claims.set(serverName, { runKey, generation })
  }

  /**
   * The run and generation that own a role's browser.
   * @param role - The role to look up.
   * @returns the owner, or undefined when no run has claimed the role.
   */
  claimOf(serverName: string): { runKey: string, generation: number } | undefined {
    return this.claims.get(serverName)
  }

  /**
   * The identity one mounted browser belongs to.
   *
   * Keyed by the MCP server name rather than by role, because a role name is
   * not an owner: two runs in one session can each declare `buyer`, and a call
   * queued against the first must not be answered from the second.
   * @param serverName - Server name the tool namespace carries.
   * @returns the owner, or undefined when nothing is mounted under that name.
   */
  ownerOfServer(serverName: string): MountOwner | undefined {
    return this.owners.get(serverName)
  }

  /**
   * The server name one owner's browser is reachable under.
   * @param owner - Identity being looked up.
   * @returns the server name, or an empty string when that owner has no mount.
   */
  serverNameFor(owner: BrowserOwner): string {
    return this.started.get(RoleBrowserPool.keyOf(owner))?.serverName ?? ''
  }

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
    // The disposer returns the promise rather than firing it: cordis awaits an
    // async disposer, so the browser is closed before the service goes away.
    // Returning `void` here left the Chromium running until the host exited.
    // Agents are announced before any role is mounted, and a role switched to
    // later belongs to one that already exists, so both are covered by keeping
    // the pool's own record of what the host announced.
    ctx.on('agent/created', ({ agent }) => { this.knownAgents.add(agent); return undefined })
    ctx.effect(() => async () => {
      await this.releaseAll()
    })
  }

  private readonly executablePath: string | undefined

  private readonly headless: boolean

  /**
   * The map key one owner's browser is filed under.
   * @param owner - The identity that owns the browser.
   * @returns a key no other owner shares.
   */
  /**
   * The exact MCP server name a tool namespace carries.
   *
   * Unlike `roleOf` this keeps the generation suffix, because the suffix is
   * what distinguishes one mount of a role from the mount that replaced it.
   * @param toolName - Full tool name as dispatched.
   * @returns the server name, or an empty string when this is not one of ours.
   */
  static serverNameOf(toolName: string): string {
    // The tool namespace is `mcp__<serverName>__<tool>`, and the server name
    // keeps its `playwright-role-` part: that is the identity the mount was filed
    // under. Cutting at the role prefix instead would answer with a role name,
    // which is exactly the field that is not an owner.
    if (!toolName.startsWith(MCP_PREFIX)) return ''
    return toolName.slice(MCP_PREFIX.length).split(BROWSER_TOOL_SUFFIX)[0] ?? ''
  }

  /**
   * The run generation one owner's mount was created under.
   * @param owner - Identity being mounted.
   * @returns the generation recorded by the claim, or 0 when none was claimed.
   */
  private generationOf(owner: BrowserOwner): number {
    return owner.generation
  }

  /**
   * Release one mount by the key it is filed under.
   *
   * `releaseRole` is for a role name; this is for the composite key `mounts`
   * holds, which is what a bulk release actually has.
   * @param key - Key the mount is filed under.
   */
  private async releaseByKey(key: string): Promise<void> {
    const detached = detachMount(
      this.mounts, this.started, this.owners, this.claims, this.keysByRole, key,
    )
    if (detached.browser !== undefined && this.activeRole === detached.browser.role) {
      this.activeRole = undefined
    }
    if (detached.dispose === undefined) {
      // Still starting, so there is nothing to close yet. The mark tells the
      // start, when it completes, that the run it was mounting for is gone.
      if (this.pending.has(key)) this.abandoned.add(key)
      return
    }
    try {
      await detached.dispose()
    } catch (error) {
      restoreMount(this.mounts, this.started, this.owners, this.keysByRole, key, detached)
      throw error
    }
  }

  static keyOf(owner: BrowserOwner): string {
    return `${owner.projectKey}\u0000${owner.environmentKey}\u0000${owner.runKey}\u0000${owner.role}`
  }

  /**
   * Start a role's browser if it is not already up.
   *
   * Starting is idempotent because a run may switch back and forth between
   * roles, and a second browser for the same role would drop the login the
   * first one established.
   * @param role - Declared role name.
   * @returns the role's browser resource.
   */
  async ensure(owner: BrowserOwner): Promise<RoleBrowser> {
    const role = owner.role
    const key = RoleBrowserPool.keyOf(owner)
    // A role already starting counts as started, because the browser-use registry
    // holds one provider slot and a second mount would be refused. The second
    // caller waits on the same start rather than being handed a record for a
    // browser that may still fail to come up, and a failure reaches every waiter
    // instead of leaving them holding a resource that was never started.
    const starting = this.pending.get(key)
    if (starting !== undefined) return starting.settled
    const existing = this.started.get(key)
    if (existing !== undefined) return existing
    // A browser started when the environment was confirmed, before any run
    // existed, is the same browser this run is about to use. Without adopting it
    // the first `assume_role` would start a second Chromium for the same role and
    // leave the first running, so the pre-start is re-filed under this run's key.
    const preStarted = this.started.get(RoleBrowserPool.keyOf({ ...owner, runKey: '' }))
    if (preStarted !== undefined && owner.runKey !== '') {
      const mounted = this.mounts.get(RoleBrowserPool.keyOf({ ...owner, runKey: '' }))
      this.mounts.delete(RoleBrowserPool.keyOf({ ...owner, runKey: '' }))
      this.started.delete(RoleBrowserPool.keyOf({ ...owner, runKey: '' }))
      this.mounts.set(key, mounted ?? (async () => {}))
      // The owner and the claim have to follow the mount. Filing only the mount
      // leaves the browser owned by the environment's empty run, so every later
      // call is compared against `runKey === ''` and refused, and a cancel never
      // selects it as a target.
      recordMount(this.started, this.owners, this.claims, key, owner, preStarted)
      this.addKeyForRole(role, key)
      return preStarted
    }
    // A role that has been mounted before gets a fresh server name. The client
    // registry is keyed by that name and its previous entry is still shutting
    // down when the next mount starts, so reusing the name collided; a suffix
    // removes the race instead of depending on the order two teardowns happen in.
    this.mountCount.set(role, (this.mountCount.get(role) ?? 0) + 1)
    const generation = this.mountCount.get(role) ?? 1
    const serverName = `playwright-role-${role}${generation === 1 ? '' : `-g${generation}`}`
    const browser: RoleBrowser = { role, serverName, toolNames: [] }
    const settled = this.mountBrowser(key, { ...owner, generation: this.generationOf(owner) }, browser)
    this.pending.set(key, { settled, owner: { ...owner, generation: this.generationOf(owner) } })
    try {
      return await settled
    } finally {
      this.pending.delete(key)
    }
  }


  /**
   * Make a role the one this pool drives, leaving any other mounted.
   *
   * A role's browser is kept once started. The provider gives every Agent its own
   * MCP client under its own scope, and each role registers a distinct
   * `browserUse` name, so two roles coexist rather than contending for one
   * browser. Releasing the previous role here was what made cross-role work
   * impossible: the first role's login and cookies were destroyed before the
   * second role existed.
   * @param role - The role to act as.
   * @returns the role's browser resource.
   */
  async switchTo(owner: BrowserOwner): Promise<RoleBrowser> {
    const role = owner.role
    const browser = await this.ensure(owner)
    this.activeRole = role
    return browser
  }

  /**
   * The role this pool currently drives.
   * @returns the active role, or undefined when none is mounted.
   */
  active(): string | undefined {
    return this.activeRole
  }

  /**
   * Close one role's browser and wait for it.
   *
   * The effect that mounted the provider is disposed and awaited, so this
   * returns only after the provider has torn the browser down. A browser that
   * fails to close is reported rather than dropped.
   * @param role - The role to release.
   * @returns once the browser is closed.
   */
  /**
   * Release every browser one run owns, and nothing belonging to another run.
   *
   * A run that acted as two roles owns two browsers, so releasing only the role it
   * happens to be acting as leaves the other one running after the run is closed.
   * The claims are the record of ownership, so the set released here is exactly
   * the runs that claimed the roles, not every browser in the pool.
   * @param runKey - Run whose browsers are being released.
   * @returns once each released browser is closed.
   */
  async releaseRun(runKey: string): Promise<void> {
    // Every mount whose owner is this run, released through its own key. Reading
    // the claims and passing their names to `releaseRole` released nothing: a
    // claim is filed by server name while `keysByRole` is filed by role, so the
    // lookup never matched and the run's browsers stayed up after a cancel.
    const keys = mountKeysOfRun([...this.owners.values()], runKey)
    // A mount that is still starting has no owner row yet, so it is listed here
    // instead. Releasing it before its disposer exists is still correct: the
    // finishing start reads this and closes itself.
    for (const [key, entry] of this.pending) {
      if (entry.owner.runKey === runKey && !keys.includes(key)) keys.push(key)
    }

    const failures = await disposeAll(key => this.releaseByKey(key), keys)
    if (failures.length > 0) {
      throw new Error(`web-test: not every browser of run ${JSON.stringify(runKey)} closed:`
        + ` ${failures.join('; ')}`)
    }
  }

  async releaseRole(role: string): Promise<void> {
    const keys = this.keysByRole.get(role) ?? new Set<string>()
    const mounted = [...keys].map(key => this.mounts.get(key))
    // The browsers are read before the rows go: reading them afterwards always
    // finds nothing, which left every claim and pending start of this role behind.
    const browsers = [...keys].map(key => this.started.get(key))
    for (const key of keys) { this.mounts.delete(key); this.started.delete(key) }
    this.keysByRole.delete(role)
    for (const browser of browsers) {
      if (browser === undefined) continue
      // The owner too: leaving it behind keeps `ownerOfServer` resolving a mount
      // that this call just closed.
      this.claims.delete(browser.serverName)
      this.owners.delete(browser.serverName)
    }
    for (const key of keys) this.pending.delete(key)
    if (this.activeRole === role) this.activeRole = undefined
    for (const effect of mounted) {
      if (effect === undefined) continue
      try {
        await effect()
      } catch (error) {
        throw new Error(`web-test: the browser for role ${JSON.stringify(role)} did not close`, { cause: error })
      }
    }
  }

  /**
   * Record one more key a role is mounted under.
   * @param role - Declared role name.
   * @param key - Key the mount is filed under.
   */
  /**
   * File one owner key under the role that mounted it.
   *
   * Part of the pool's public surface because which keys a role still holds is
   * what `releaseRole` acts on, and that cannot be observed from outside without
   * the provider. Adding a key here without a mount under it only makes a later
   * role release a no-op for that key.
   * @param role - Role that owns the mount.
   * @param key - Owner key the mount is filed under.
   */
  addKeyForRole(role: string, key: string): void {
    const keys = this.keysByRole.get(role) ?? new Set<string>()
    keys.add(key)
    this.keysByRole.set(role, keys)
  }

  /**
   * Mount one role's MCP server and record it as started.
   * @param role - Declared role name.
   * @param browser - The resource to record once the server is mounted.
   * @returns once the server is mounted.
   */
  private async mountBrowser(
    key: string,
    owner: BrowserOwner & { generation: number },
    browser: RoleBrowser,
  ): Promise<RoleBrowser> {
    const role = browser.role
    const serverName = browser.serverName
    // Loaded on demand rather than at import time: these pull the MCP client's
    // whole peer tree, which a unit test that never starts a browser should not
    // have to load.
    const [McpClient, { createScope }] = await Promise.all([
      import('@deepseek-ai/dsh-mcp-client'),
      import('@deepseek-ai/dsh-scope'),
    ])
    const { executablePath, headless, knownAgents } = this
    // One fiber per role owns that role's clients and nothing else, so releasing
    // the role disposes exactly its scopes and awaits each MCP connection's
    // shutdown. The fiber is what `mountSessionMcp` never gave back: it returns
    // void, so the caller that mounts it is the only possible owner.
    const fiber = this.ctx.plugin({
      inject: ['agents', 'tools'],
      async apply(provider: Context) {
        // One scope per Agent, per role. `createScope` takes any object as its
        // key, and the tool layer is looked up under that key, so a client
        // mounted under an Agent's key contributes tools to that Agent only. Two
        // roles land in the same layer under different server names, which is
        // what lets one Agent drive two accounts at once; the registry's single
        // browser-use slot is never taken, because a role is not a provider.
        const open = async (agent: Agent): Promise<void> => {
          const scope = createScope(provider, agent)
          scopes.set(agent, scope)
          await scope.ctx.plugin(McpClient, McpClient.Config({
            transport: 'stdio',
            serverName,
            command: process.execPath,
            args: playwrightArgs(executablePath, headless),
            ...agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd },
          }))
        }
        const scopes = new Map<Agent, Scope>()
        // Opened for every Agent the pool has seen, and awaited, so this role's
        // tools are registered by the time the fiber is ready. Leaving these
        // unawaited let `ensure` return while the client was still connecting,
        // and the first browser call arrived before its tool existed and was
        // refused as unknown — which says nothing about whether a client exists.
        await Promise.all([...knownAgents].map(agent => open(agent)))
        provider.on('agent/created', async ({ agent }) => { await open(agent) })
      },
    })
    try {
      await fiber
    } catch (error) {
      void fiber.dispose()
      throw new Error(
        `web-test: the browser for role ${JSON.stringify(role)} did not start: ${String(error)}`,
        { cause: error },
      )
    }
    this.mounts.set(key, async () => { await fiber.dispose() })
    this.addKeyForRole(role, key)
    recordMount(this.started, this.owners, this.claims, key, owner, browser)
    // The run that asked for this browser was released while it was starting.
    // Closing here is the only chance, and the mark is consumed so it cannot fire
    // against a later mount of the same key.
    if (this.abandoned.delete(key)) {
      await this.releaseByKey(key)
      throw new Error(
        `web-test: the run that asked for role ${JSON.stringify(role)} was released while`
        + ' its browser was starting, so the browser was closed again.',
      )
    }
    return browser
  }



  /**
   * Every role browser this pool has started.
   *
   *
   * Read at activation time: the provider registers an MCP server's tools when
   * a Session's agent activates, so a role started moments ago has none until
   * then, and the deny list is rebuilt each time the active role changes.
   * @returns the started role browsers.
   */
  /**
   * Who each mounted role browser belongs to.
   *
   * Read by the execution guard to judge a call against the mount it names, and
   * by a caller that has to report what is still up.
   * @returns one owner per mounted browser.
   */
  ownedBrowsers(): MountOwner[] {
    return [...this.owners.values()]
  }

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
    // The server name may carry a generation suffix so a re-mount never collides
    // with the client it is replacing; the role is what precedes that suffix.
    const name = toolName.slice(BROWSER_TOOL_PREFIX.length).split(BROWSER_TOOL_SUFFIX)[0] ?? ''
    return name.replace(GENERATION_SUFFIX, '')
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
    owner: BrowserOwner,
    identityUrl: string,
  ): Promise<IdentityAnswer> {
    // The namespace comes from the mount this caller owns, not from the role name
    // and not from whichever mount of that role started last: two runs in one
    // session can each declare `buyer`, and reading the newest one would confirm
    // an identity against a browser the caller does not own.
    const namespace = namespaceFor(this.started, owner)
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
    assertToolOk(navigate, `${namespace}browser_navigate`, owner.role)
    const probe = childCallId(exec, 'identity')
    const read = await tools.execute({
      ...probe,
      name: `${namespace}browser_evaluate`,
      arguments: { function: IDENTITY_PROBE },
      signal: exec.signal,
    })
    assertToolOk(read, `${namespace}browser_evaluate`, owner.role)
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
    const failures = await disposeAll(key => this.releaseByKey(key), [...this.mounts.keys()])
    if (failures.length > 0) {
      throw new Error(`web-test: not every role browser closed: ${failures.join('; ')}`)
    }
  }
}

/**
 * The page function that reports identity.
 *
 * It reads a marker the identity endpoint sets, so a login page or an error
 * page cannot be mistaken for a signed-in account: an unsigned page answers
 * with an empty string rather than with whatever text happens to be on it.
 */
const IDENTITY_PROBE = '() => JSON.stringify({ account: document.body.dataset.webtestAccount ?? "", url: location.href, title: document.title })'

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
 * The probe answers with the account, the URL and the title, so a refusal names
 * the page it read and a success names where that account came from.
 * @param raw - The text the probe returned.
 * @returns the account and a description of the page it was read from.
 */
function parseIdentity(raw: string): IdentityAnswer {
  // The provider renders an evaluated value under a `### Result` heading, quotes
  // it when the value is a string, and may append a page summary. Parsing the
  // whole text therefore fails for reasons that have nothing to do with the
  // account; the object's own text is extracted instead, brace-matched so the
  // escaped quotes inside it do not end it early.
  const text = raw.trim()
  const start = text.indexOf('{')
  if (start < 0) {
    return { account: '', detail: `the identity probe answered without an object: ${text}` }
  }
  let depth = 0
  let end = -1
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\') { index += 1; continue }
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) { end = index + 1; break }
    }
  }
  if (end < 0) {
    return { account: '', detail: `the identity probe answered with an unterminated object: ${text}` }
  }
  let decoded: unknown
  const inner = text.slice(start, end)
  // Inside a quoted string the object's own quotes arrive escaped; undo that
  // before parsing, and fall back to the escaped form if the unescaping is wrong.
  for (const candidate of inner.includes('\\"') ? [inner.replace(/\\"/g, '"'), inner] : [inner]) {
    try {
      decoded = JSON.parse(candidate)
      break
    } catch {
      continue
    }
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    return { account: '', detail: `the identity probe answered with unparseable text: ${text}` }
  }

  const fields = decoded as Record<string, unknown>
  const account = typeof fields.account === 'string' ? fields.account.trim() : ''
  const url = typeof fields.url === 'string' ? fields.url : 'an unknown page'
  const title = typeof fields.title === 'string' ? ` titled ${JSON.stringify(fields.title)}` : ''
  return {
    account,
    detail: account === '' ? `page ${url}${title} declared no account` : `page ${url}${title} declared ${JSON.stringify(account)}`,
  }
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
  // A tool result is either the MCP content blocks themselves or an object
  // carrying them under `content`, and a block is `{ type: 'text', text }`.
  // Reading only the array form returned nothing for this provider, so every
  // identity read reported an empty page.
  const blocks = Array.isArray(result)
    ? result
    : (typeof result === 'object' && result !== null && Array.isArray((result as { content?: unknown }).content)
        ? (result as { content: unknown[] }).content
        : undefined)
  if (blocks === undefined) return ''
  for (const block of blocks) {
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
