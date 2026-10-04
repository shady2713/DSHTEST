/**
 * Shared bootstrap for the Web testing conversation suites: the real tool
 * registry, the real agent registry, the real persistence authority behind the
 * policy, and the real question service behind the ask-user row.
 *
 * Only three things are test-owned, and all because the suites observe them
 * rather than because the product is hard to reach: the clock (so expiry is a
 * value the suite sets, not a sleep), the stand-in bodies registered for the
 * governed tool names, and a counter wrapped around the policy's real
 * `bindEntry`. The bodies exist because the registry resolves a name it does not
 * hold to `UNKNOWN_TOOL` after the guard has run, and what these suites observe
 * is which names the conversation is offered and which calls the policy refuses —
 * not what `read` does. The counter delegates to the real ledger and runs the
 * real disposer, because the policy publishes no reader for the bindings it holds
 * and a suite cannot otherwise tell a released lease from a leaked one.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/browser-auth'
import { createWebConnectionRpc } from '@deepseek-ai/dsh-client-connection/client/rpc'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { WebTestContracts } from '@deepseek-ai/dsh-web-test-contracts'
import type { ProjectId, ProjectMetadata } from '@deepseek-ai/dsh-web-test-contracts'
import {
  WebTestClock, WebTestPolicy, WebTestRuntimeScope, adaptedToolNames,
} from '@deepseek-ai/dsh-web-test-policy'
import type { DeclaredEnvironment } from '@deepseek-ai/dsh-web-test-policy'
import WebTestRuntime, { canonicalizeControlRoot, resolveDataGeneration } from '@deepseek-ai/dsh-web-test-runtime'
import WebTestConversation from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { CONVERSATION_CAPABILITY_TOOLS, governedToolNames } from '../src/index.ts'
import { WebTestCommands } from '../src/commands.ts'

/** The instant every expiry in these suites is read against. */
const EPOCH = 1_700_000_000_000

/** Signal every tool call in these suites is made with. */
const toolSignal = new AbortController().signal

/** Channel the shared RPC carrier is mounted on, as the browser client mounts it. */
const CHANNEL = '/api'

/** A clock the suite advances by hand, so expiry is a value and not a sleep. */
class TestClock extends WebTestClock {
  /** @param ctx - Context of the Clock plugin. @param state - the instant the suite owns. */
  constructor(ctx: Context, private readonly state: { now: number }) {
    super(ctx, 'webTestClock')
  }

  /** @returns the instant the suite set. */
  now(): number {
    return this.state.now
  }
}

/** The binding leases the entry took from the policy, and the ones it gave back. */
export interface BindingLeases {
  /** `bindEntry` calls the entry made. */
  readonly taken: number
  /** Disposers the entry ran. */
  readonly released: number
  /** Leases taken and not yet released. */
  readonly live: number
}

/** What a booted command Remote offers the card caller and the conversation caller. */
export interface CommandHarness {
  /** The mounted command Remote, as the in-process conversation caller reaches it. */
  readonly commands: InstanceType<typeof WebTestCommands>
  /** Dispose only the Commands contribution. */
  unload(): Promise<void>
  /**
   * Call one Remote method as the generated Client does, over the real Typert
   * Registry, Gateway, and shared RPC carrier.
   * @param method - endpoint method name under the command namespace.
   * @param args - named arguments keyed by the Service Definition's parameter names.
   * @param signal - optional caller cancellation forwarded by the shared RPC carrier.
   * @returns the Remote result, which carries either the value or the failure.
   */
  call(method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown; error?: unknown }>
}

/** The booted entry and everything a suite drives it through. */
export interface ConversationHarness {
  /** Context every service is mounted on. */
  readonly ctx: Context
  /** The mounted conversation entry. */
  readonly conversation: InstanceType<typeof WebTestConversation>
  /** Real directory the published projects are registered against. */
  readonly codeRoot: string
  /** A second real code tree, so a suite can tell two projects' scopes apart. */
  readonly otherCodeRoot: string
  /** The instant the clock reports. */
  readonly clock: { now: number }
  /** Register one real project in the real domain, returning its published metadata. */
  registerProject(commandId: string, entryUrl?: string, codeRoot?: string): Promise<ProjectMetadata>
  /** Build an agent the registry has not announced yet. */
  agent(id: string): Agent
  /** Build an agent, enter it as a root, and announce it through the real registry. */
  rootAgent(id: string): Promise<Agent>
  /** Build an agent owned by `parent`, enter it, and announce it. */
  childAgent(id: string, parent: Agent): Promise<Agent>
  /** Withdraw one agent from the registry the way disposal does. */
  disposeAgent(agent: Agent): void
  /** The tool names one agent is currently offered. */
  visibleToolNames(agent: Agent): string[]
  /** The shipped governed names one agent's mask currently denies, sorted. */
  deniedGovernedNames(agent: Agent): string[]
  /** Run one tool call as that agent and report the text the model received. */
  callTool(agent: Agent, name: string, arguments_: Record<string, unknown>): Promise<string>
  /** Attach a session to a project and confirm that project's environment. */
  attachAndDeclare(sessionId: string, project: ProjectMetadata, commandId: string): DeclaredEnvironment
  /** The confirmation request the policy validates for one project. */
  confirmationRequest(project: ProjectMetadata, commandId: string, overrides?: Record<string, unknown>): Record<string, unknown>
  /** What the entry took from the policy's binding ledger, and what it gave back. */
  leases(): BindingLeases
  /**
   * Mount the command Remote over the real Typert Registry, Gateway, and shared
   * RPC carrier, so a card and the conversation reach one implementation the way
   * each of them reaches it in the product.
   * @returns the mounted service and the carrier caller.
   */
  mountCommands(): Promise<CommandHarness>
  /**
   * Commit one real project update, so a suite can move the revision an answer
   * was given against.
   * @param project - the project to move.
   * @param commandId - the command token that commits the change.
   * @returns the project as it is published afterwards.
   */
  advanceProject(project: ProjectMetadata, commandId: string): Promise<ProjectMetadata>
  /** Dispose every service and remove the temporary tree. */
  stop(): Promise<void>
}

/** What a suite may vary about the boot. */
export interface StartOptions {
  /** Existing fixture tree used by restart tests. */
  existingRoot?: string
  /** Keep owned storage for the next restart; its final harness removes it. */
  preserveRoot?: boolean
  /** Question-tool row handed to the plugin. */
  config?: Config
  /** Names left unregistered, so a suite can prove the gate only names what ships. */
  omitTools?: readonly string[]
  /** Register only the tools this stage acts through, so the open set is the whole governed set. */
  capabilitiesOnly?: boolean
  /** Generated Host contribution registered before Commands source-mode discovery. */
  commandContribution?: import('@deepseek-ai/dsh-typert-registry').TypertContribution
}

/**
 * Boot the whole entry over a real temporary tree, real storage, and the real
 * product services the entry consumes.
 * @param options - the question-tool row and any tool name to leave unregistered.
 * @returns the booted harness.
 */
export async function startConversation(options: StartOptions = {}): Promise<ConversationHarness> {
  const root = options.existingRoot ?? mkdtempSync(join(tmpdir(), 'dsh-webtest-conversation-'))
  const codeRoot = resolve(join(root, 'code'))
  mkdirSync(join(codeRoot, 'src'), { recursive: true })
  writeFileSync(join(codeRoot, 'src', 'app.ts'), 'export const answer = 42\n', 'utf8')
  // A second real tree, so a suite can publish a project whose declared root is
  // not the first one's and read which project a refusal was decided against.
  const otherCodeRoot = resolve(join(root, 'other-code'))
  mkdirSync(join(otherCodeRoot, 'src'), { recursive: true })
  writeFileSync(join(otherCodeRoot, 'src', 'app.ts'), 'export const answer = 7\n', 'utf8')

  const controlRoot = join(root, 'control')
  mkdirSync(controlRoot, { recursive: true })
  const canonicalRoot = await canonicalizeControlRoot(controlRoot)
  const { dataRoot } = await resolveDataGeneration(canonicalRoot)

  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(Storage)
  await ctx.plugin(
    { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
    { root: dataRoot },
  )
  await ctx.plugin(
    { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
    { backend: 'json' },
  )
  await ctx.plugin(WebTestRuntime, { controlRoot })
  await registerGovernedTools(ctx, new Set(options.omitTools ?? []), options.capabilitiesOnly === true)
  await ctx.plugin(UserQuestionService, {})
  await ctx.plugin(WebTestContracts)
  const clock = { now: EPOCH }
  const scopes: Scope[] = []
  await ctx.plugin({
    name: 'web-test-conversation-clock',
    apply: (inner: Context) => { void new TestClock(inner, clock) },
  })
  await ctx.plugin({
    name: 'web-test-conversation-scope',
    inject: ['webTestRuntime'],
    apply: (inner: Context) => {
      void new WebTestRuntimeScope(inner, {
        readProject: (id: ProjectId): ProjectMetadata | undefined => inner.webTestRuntime.readProject(id),
      })
    },
  })
  await ctx.plugin(WebTestPolicy, { protectedPaths: [], confirmationRequiredFor: [] })
  // How many binding leases the entry takes is not observable through the policy:
  // it publishes a disposer and no reader for the ledger behind it. The real
  // method is wrapped rather than replaced — the wrapper delegates to the real
  // ledger and runs the real disposer — so every enforcement assertion below is
  // still decided by the real policy, and only the bookkeeping is counted here.
  const leaseTally = { taken: 0, released: 0 }
  const policy = ctx.webTestPolicy
  const bindEntry = policy.bindEntry.bind(policy)
  policy.bindEntry = (sessionId: string, projectId: ProjectId): (() => void) => {
    leaseTally.taken += 1
    const release = bindEntry(sessionId, projectId)
    return () => {
      leaseTally.released += 1
      release()
    }
  }
  await ctx.plugin(WebTestConversation, options.config ?? {})
  // The scope owner stands in for the agent-loop plugin: a context that declares
  // the services an agent scope resolves, from which every fixture agent scope is
  // minted exactly as `AgentLoop` mints a live one.
  let scopeOwner!: Context
  await ctx.plugin({
    name: 'web-test-conversation-scope-owner',
    inject: ['agents', 'sessions', 'tools', 'userQuestions', 'webTestPolicy', 'webTestRuntime'],
    apply: (inner: Context) => { scopeOwner = inner },
  })

  const build = (id: string, parent?: Agent): Agent => {
    const session = ctx.sessions.create(SessionId(id))
    const agent: Agent = {
      id: session.id, session, ctx: parent?.ctx ?? ctx, options: {}, status: 'idle', inbox: unsupportedInbox(),
      send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
      whenIdle: async () => {}, runMaintenance: operation => operation(new AbortController().signal),
    }
    // The loop agent mints its scope from the loop plugin's own context and
    // publishes that context, so `agent.ctx` carries the agent as its scope key.
    // A handle cannot be its own scope key before it exists, so the key is the
    // handle and the scoped context is installed onto it in place; the suite
    // asserts `scopeOf(agent.ctx) === agent`, so this fixture cannot drift from
    // the product invariant it stands in for. An owned child is minted from its
    // parent's context and bound inside the parent's scope, which is what makes
    // a restriction installed on the owner constrain everything nested in it.
    const scope = parent === undefined
      ? createScope(scopeOwner, agent)
      : createScope(parent.ctx, agent, { parent })
    Object.defineProperty(agent, 'ctx', { value: scope.ctx, configurable: true, enumerable: true })
    scopes.push(scope)
    return agent
  }

  const releases = new Map<Agent, () => void>()

  // One declaration builder for both callers: the contract requires a
  // declaration to cover every root the project published, so the roots come
  // from the published record rather than from a tree a suite names itself.
  const confirmationRequest = (
    project: ProjectMetadata,
    commandId: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    projectId: project.projectId,
    commandId,
    declaration: {
      codeRoots: project.codeRoots,
      entryUrl: project.entryUrls[0] ?? null,
      isTestEnvironment: true,
      login: { state: 'not-required' },
      supplementaryRequirements: [],
      ...overrides,
    },
  })

  return {    ctx,
    conversation: ctx.webTestConversation,
    codeRoot,
    otherCodeRoot,
    clock,
    registerProject: async (commandId, entryUrl = 'http://localhost:3000/checkout', root = codeRoot) => {
      const receipt = await ctx.webTestRuntime.registerProject({
        commandId, codeRoots: [root], entryUrls: [entryUrl],
      })
      const project = ctx.webTestRuntime.readProject(receipt.resourceId as ProjectId)
      /* v8 ignore next -- registerProject publishes before the same call returns */
      if (project === undefined) throw new Error('the runtime published no project to read back')
      return project
    },
    agent: build,
    rootAgent: async (id) => {
      const agent = build(id)
      const detach = ctx.agents.enter(agent, undefined)
      releases.set(agent, detach)
      // The registry's own announcement, so the entry is marked announced and a
      // later detach pairs the `agent/disposed` edge with this creation.
      await ctx.agents.announce(agent, 'startup')
      return agent
    },
    childAgent: async (id, parent) => {
      const child = build(id, parent)
      const detach = ctx.agents.enter(child, parent)
      releases.set(child, detach)
      await ctx.agents.announce(child, 'startup')
      return child
    },
    disposeAgent: (agent) => {
      const release = releases.get(agent)
      /* v8 ignore next -- every suite disposes an agent it announced */
      if (release === undefined) throw new Error(`agent ${agent.id} was never announced`)
      releases.delete(agent)
      release()
    },
    visibleToolNames: agent => ctx.tools.schemas(agent).map(schema => schema.name),
    deniedGovernedNames: (agent) => {
      const visible = new Set(ctx.tools.schemas(agent).map(schema => schema.name))
      return governedToolNames(ctx).filter(name => !visible.has(name))
    },
    callTool: async (agent, name, arguments_) => {
      const result = await ctx.tools.execute({
        callId: ToolCallId(`call-${name}`), name, arguments: arguments_, signal: toolSignal, agent,
      })
      const first = result.content[0]
      return first?.type === 'text' ? first.text : JSON.stringify(result.content)
    },
    attachAndDeclare: (sessionId, project, commandId) => {
      ctx.webTestConversation.attach(sessionId, project.projectId)
      return ctx.webTestConversation.declareEnvironment(sessionId, confirmationRequest(project, commandId))
    },
    // One declaration builder for both callers: the contract requires the
    // declaration to cover every root the project published, so the roots come
    // from the published record rather than from a tree a suite names itself.
    confirmationRequest,
    leases: () => ({
      taken: leaseTally.taken,
      released: leaseTally.released,
      live: leaseTally.taken - leaseTally.released,
    }),
    mountCommands: async () => {
      await ctx.plugin(TypertRegistry)
      if (options.commandContribution !== undefined) ctx.typert.register(options.commandContribution)
      await ctx.plugin(TypertGateway)
      // Constructing the service registers it; the operator peer is the admitted
      // identity for this in-process call, and the process-token exchange belongs
      // to the browser transport rather than this carrier.
      new HostConnectionService(ctx, [], {} as BrowserAuth)
      const commandsFiber = await ctx.plugin(WebTestCommands)
      const handler = (ctx.get('connection') as HostConnectionService).createSharedFetchHandler(CHANNEL)
      const rpc = createWebConnectionRpc(async (path, init) => handler.fetch(new Request(new URL(path, 'http://host'), init)))
      return {
        commands: ctx.webTestCommands,
        unload: () => commandsFiber.dispose(),
        call: (method, args, signal) => rpc.call(CHANNEL, `webTestCommands/${method}`, { args }, signal),
      }
    },
    advanceProject: async (project, commandId) => {
      const prepared = ctx.webTestRuntime.prepareProjectUpdate(project.projectId)
      await ctx.webTestRuntime.commitProjectUpdate(
        { commandId, recordId: prepared.recordId, expectedRevision: prepared.expectedRevision },
        prepared,
        { codeRoots: project.codeRoots, entryUrls: [...project.entryUrls, 'http://localhost:3000/second'] },
      )
      const advanced = ctx.webTestRuntime.readProject(project.projectId)
      /* v8 ignore next -- commitProjectUpdate publishes before the same call returns */
      if (advanced === undefined) throw new Error('the runtime published no project to read back')
      return advanced
    },
    stop: async () => {
      await ctx.fiber.dispose()
      for (const scope of scopes.splice(0)) await scope.dispose()
      if (options.preserveRoot !== true) rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * Register a body for every tool name the policy has an adapter for, so the
 * registry holds a name the gate may mask and the guard may decide.
 * @param ctx - context whose global registry receives the bodies.
 * @param omit - names to leave out, so a suite can prove the gate names only what ships.
 * @param capabilitiesOnly - register only the tools this stage acts through.
 */
async function registerGovernedTools(ctx: Context, omit: ReadonlySet<string>, capabilitiesOnly: boolean): Promise<void> {
  const names = adaptedToolNames()
    .filter(name => !omit.has(name))
    .filter(name => !capabilitiesOnly || CONVERSATION_CAPABILITY_TOOLS.includes(name))
  await ctx.plugin({
    name: 'web-test-conversation-governed-tools',
    inject: ['tools'],
    apply: (inner: Context) => {
      for (const name of names) {
        void inner.tools.register({
          name,
          description: `stand-in body for ${name}`,
          parameters: { type: 'object', properties: {} },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value as string }],
          },
          execute: () => Promise.resolve(`ran:${name}`),
        })
      }
    },
  })
}
