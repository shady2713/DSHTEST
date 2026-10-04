/**
 * Shared bootstrap for the Web testing policy suites: a real code root with real
 * protected material directories and a real local filesystem behind the
 * backstop, a published project scope a suite controls, a clock a suite advances,
 * and stand-in capability services that record whether the policy let a call
 * reach the provider body.
 *
 * The filesystem, the tool registry, and the contract service are the real
 * product services. The scope source is a reader the suite owns, because what
 * these suites vary is the published revision; `runtime-scope.spec.ts` covers the
 * reader that talks to the single domain writer.
 *
 * `startRealCapabilities` adds the second bootstrap: the real local attachment
 * store, the real local subprocess runtime, and the real terminal registry, with
 * one stored upload and one published PTY session created before the policy is
 * mounted, so a suite can attack a live service rather than a stand-in.
 */

import { Buffer } from 'node:buffer'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { TerminalSessionService } from '@deepseek-ai/dsh-terminal'
import type {
  TerminalBackend, TerminalBackendSession, TerminalBackendSpawnSpec, TerminalReadResult, TerminalSendOperation,
  TerminalSendRequest, TerminalSendResult, TerminalSessionId,
} from '@deepseek-ai/dsh-terminal'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolPresentationMode } from '@deepseek-ai/dsh-tools'
import { WebTestContracts } from '@deepseek-ai/dsh-web-test-contracts'
import type { ProjectId, ProjectMetadata, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import type { WebFetchResult } from '@deepseek-ai/dsh-web'
import { WebTestClock, adaptedToolNames, WebTestPolicy, WebTestRuntimeScope } from '../src/index.ts'
import type { ProtectedPathDeclaration, WebTestEffectKind } from '../src/index.ts'

/** Repository root, for the evidence files the suites write. */
export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

/** Directory the suites write their observed evidence into. */
export const evidenceDir = join(repoRoot, '.artifacts/web-testing/upgrade-v02/m1-t05-a')

/** The identity every suite's project is registered under. */
export const projectId = brandString<ProjectId>(`project-${'a'.repeat(32)}`)

/** The command token the declaration request is made under. */
export const declareCommandId = 'cmd-declare-environment'

/** The session identity the entry is bound to. */
export const sessionId = 'session-web-test-1'

/** The concrete flow every suite grants. */
export const flowId = 'flow-checkout-1'

/** The plan revision every suite grants against. */
export const flowRevision = 3

/** Signal every tool call in these suites is made with. */
export const toolSignal = new AbortController().signal

/** The base instant every suite starts at; the value itself carries no meaning. */
export const EPOCH = 1_700_000_000_000

/**
 * The stand-in capability services a suite calls through.
 *
 * These are the exact objects the context provides under the Cordis service keys
 * the backstop decorates, so a call through one of them is a call through the
 * decorated method. Their own argument records are deliberately narrower than
 * the Service Definition's, because the policy refuses before the provider
 * validates anything and a suite should not have to mint an `Agent` to prove a
 * terminal is refused.
 */
export interface StandIns {
  /** The web capability, registered as `web`. */
  readonly web: { fetch(request: { url: string }): Promise<WebFetchResult>; search(request: { query: string }): Promise<never> }
  /** The shell capability, registered as `shell`. */
  readonly shell: { execute(spec: { command: string }): Promise<never> }
  /** The subprocess capability, registered as `subprocess`. */
  readonly subprocessRuntime: { spawn(spec: { argv: readonly string[] }): never }
  /** The attachment capability, registered as `attachments`. */
  readonly attachments: {
    saveImage(): Promise<never>
    saveImages(): Promise<never>
    saveFile(): Promise<never>
    saveFileStream(): Promise<never>
    readImage(ref: ImageAttachmentRef): Promise<never>
  }
  /** The terminal capability, registered as `terminals`. */
  readonly terminals: { spawn(owner: object, request: { type: string }): Promise<never> }
}

/** A clock a suite advances by hand, so expiry is a test case and not a sleep. */
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

/**
 * What a suite observed about the provider body behind one entry path.
 *
 * `not-countered` is the honest answer for a row whose provider is a real
 * product service — the local filesystem, the local attachment store, the local
 * subprocess runtime, the terminal registry — because none of them increments a
 * counter a test could read. Those rows carry the effect the suite asserted in
 * the observed column instead, and printing `false` for them would state an
 * observation nobody made.
 */
export type BodyObservation =
  /** A counted stand-in body recorded nothing: the refusal preceded the body. */
  | 'not-entered'
  /** A counted stand-in body ran: the entry path was not gated. */
  | 'entered'
  /** The provider is a real service that counts nothing; the effect column is the evidence. */
  | 'not-countered'

/** One row of the cross-entry rejection matrix, as a suite observes it. */
export interface MatrixRow {
  /** The entry path the call went through. */
  readonly entry: string
  /** Which of the two enforcement points decided it. */
  readonly point: 'tool-guard' | 'service-backstop'
  /** `allowed` for the admitted case, `denied` for the refused one. */
  readonly case: 'allowed' | 'denied'
  /** The arguments the call carried. */
  readonly arguments: Record<string, unknown>
  /** What the suite observed about the provider body. */
  readonly providerBodyRan: BodyObservation
  /** The text the model or the caller received. */
  readonly observed: string
  /** The closed reason, for a refused case. */
  readonly reason: string
  /** The subject the decision named, for a refused case. */
  readonly subject: string
}

/** The booted policy and everything a suite varies. */
export interface PolicyHarness {
  /** Context every service is mounted on. */
  readonly ctx: Context
  /** The mounted policy service. */
  readonly policy: WebTestPolicy
  /** The temporary tree's root, so a report can shorten the paths in it. */
  readonly root: string
  /** Canonical code root the project published and the declaration names. */
  readonly codeRoot: string
  /** A second canonical code root, for the several-roots cases. */
  readonly secondCodeRoot: string
  /** A file inside the code root, for an admitted read. */
  readonly sourceFile: string
  /** A file inside the second code root, for an admitted read beneath it. */
  readonly secondSourceFile: string
  /** A file outside the code root, for an outside-the-root case. */
  readonly outsideFile: string
  /** A file inside the protected upload directory. */
  readonly uploadFile: string
  /** A link inside the code root whose directory points outside it. */
  readonly escapingLink: string
  /** A link inside the code root that IS the file, pointing outside it. */
  readonly linkedFile: string
  /** The three protected material directories, by role. */
  readonly protectedPaths: ProtectedPathDeclaration[]
  /** The published project scope, which a suite edits to move the revision. */
  readonly published: { current: ProjectMetadata }
  /** Publish a second project's scope, so a suite can have more than one in force. */
  publishSecond(current: ProjectMetadata): void
  /** Withdraw the registered project's published scope, as a lost head would. */
  withdrawPublishedScope(): void
  /** The instant every expiry is read against. */
  readonly clock: { now: number }
  /** One counter per stand-in provider method, proving a refusal preceded the body. */
  readonly providerCalls: Map<string, number>
  /** The stand-in capability services, as the decorated objects the context provides. */
  readonly standIns: StandIns
  /** Run one tool call and report the text the model received. */
  callTool(name: string, arguments_: Record<string, unknown>): Promise<string>
  /** Register a tool under `name` after the policy is already mounted. */
  registerTool(name: string, reply: string): Promise<void>
  /** Publish a new revision for the project, as the single domain writer would. */
  publishRevision(revision: number): void
  /** Declare the environment, bind the entry, and grant the flow. */
  admit(options?: { thirdParty?: boolean; actions?: number }): void
  /** Write one evidence file, creating its directory. */
  writeEvidence(name: string, body: string): void
  /** Dispose the policy plugin alone, leaving the rest of the context mounted. */
  disposePolicy(): Promise<void>
  /** Dispose every service and remove the temporary tree. */
  stop(): Promise<void>
}

/** Config a suite may vary. */
export interface HarnessOptions {
  /** Tool presentation selected by the test composition. */
  readonly toolMode?: ToolPresentationMode
  /** Effect kinds that require a business confirmation. */
  readonly confirmationRequiredFor?: readonly WebTestEffectKind[]
  /** Set false to boot with no protected material directory declared. */
  readonly withProtectedPaths?: boolean
  /** An adapted tool name to leave unregistered, so a suite can hot-enable it. */
  readonly deferTool?: string
  /** Declare a protected directory inside the code root, to prove the collision is refused. */
  readonly protectedInsideCodeRoot?: boolean
  /** Stand-in service keys to leave unmounted, so the backstop's absent branch is exercised. */
  readonly omitServices?: readonly string[]
  /** Publish no scope for the registered project at all. */
  readonly withdrawPublishedScope?: boolean
  /** Boot with no local filesystem, so the backstop's absent-service branch is exercised. */
  readonly withoutFileSystem?: boolean
}

/**
 * Publish one project scope at a revision.
 * @param revision - the revision the head publishes.
 * @param codeRoots - the trees the project is registered against.
 * @returns the published scope.
 */
export function publishedScope(revision: number, codeRoots: string[]): ProjectMetadata {
  return {
    projectId,
    revision: brandNumber<Revision>(revision),
    codeRoots,
    entryUrls: ['http://localhost:3000/checkout'],
  }
}

/**
 * Build a declaration request the contract parser accepts.
 * @param codeRoots - the trees the declaration names.
 * @param overrides - fields to replace, for the production-environment case.
 * @returns the raw request record.
 */
export function declarationRequest(
  codeRoots: string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    projectId,
    commandId: declareCommandId,
    declaration: {
      codeRoots,
      entryUrl: 'http://localhost:3000/checkout',
      isTestEnvironment: true,
      login: { state: 'not-required' },
      supplementaryRequirements: [],
      ...overrides,
    },
  }
}

/**
 * Boot the policy over a real temporary tree and real product services.
 * @param options - which effect kinds require a confirmation, and whether the
 * protected material directories are declared.
 * @returns the booted harness.
 */
export async function startPolicy(options: HarnessOptions = {}): Promise<PolicyHarness> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-webtest-policy-'))
  const codeRoot = resolve(join(root, 'code'))
  const secondCodeRoot = resolve(join(root, 'code-api'))
  const outside = resolve(join(root, 'outside'))
  const material = resolve(join(root, 'material'))
  for (const directory of [
    join(codeRoot, 'src'), join(secondCodeRoot, 'src'), outside, material, join(material, 'upload'),
    join(material, 'download'), join(material, 'tmp'),
  ]) mkdirSync(directory, { recursive: true })
  const sourceFile = join(codeRoot, 'src', 'app.ts')
  const secondSourceFile = join(secondCodeRoot, 'src', 'api.ts')
  const outsideFile = join(outside, 'secret.ts')
  writeFileSync(sourceFile, 'export const answer = 42\n', 'utf8')
  writeFileSync(secondSourceFile, 'export const answer = 42\n', 'utf8')
  writeFileSync(outsideFile, 'export const secret = 1\n', 'utf8')
  writeFileSync(join(material, 'upload', 'shot.png'), 'not-really-a-png', 'utf8')
  const escapingLink = join(codeRoot, 'escape')
  symlinkSync(outside, escapingLink, 'junction')
  const linkedFile = join(codeRoot, 'linked-secret.ts')
  symlinkSync(outsideFile, linkedFile)

  const protectedPaths: ProtectedPathDeclaration[] = [
    { path: join(material, 'upload'), role: 'upload' },
    { path: join(material, 'download'), role: 'download' },
    { path: join(material, 'tmp'), role: 'temporary-material' },
  ]

  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, options.toolMode === undefined ? {} : { mode: options.toolMode })
  await registerAdaptedTools(ctx, options.deferTool)
  await ctx.plugin(WebTestContracts)
  if (options.withoutFileSystem !== true) await ctx.plugin(LocalFileSystem, { cwd: codeRoot })
  const providerCalls = new Map<string, number>()
  const standIns = installStandIns(ctx, providerCalls, new Set(options.omitServices ?? []))
  const clock = { now: EPOCH }
  const published = { current: publishedScope(1, [codeRoot]) }
  const withdrawn = { value: options.withdrawPublishedScope === true }
  const extra = new Map<string, ProjectMetadata>()
  await ctx.plugin({
    name: 'web-test-clock',
    apply: (inner: Context) => { void new TestClock(inner, clock) },
  })
  await ctx.plugin({
    name: 'web-test-scope-source',
    inject: ['webTestContracts'],
    apply: (inner: Context) => {
      void new WebTestRuntimeScope(inner, {
        readProject: (id: ProjectId): ProjectMetadata | undefined => {
          if (withdrawn.value) return undefined
          return extra.get(id) ?? (id === projectId ? published.current : undefined)
        },
      })
    },
  })
  const policyFiber = await ctx.plugin(WebTestPolicy, {
    protectedPaths: options.withProtectedPaths === false
      ? []
      : options.protectedInsideCodeRoot === true
        ? [{ path: join(codeRoot, 'src'), role: 'temporary-material' }]
        : protectedPaths,
    confirmationRequiredFor: [...(options.confirmationRequiredFor ?? [])],
  })
  const policy = ctx.webTestPolicy

  return {
    ctx,
    policy,
    root,
    codeRoot,
    secondCodeRoot,
    sourceFile,
    secondSourceFile,
    outsideFile,
    uploadFile: join(material, 'upload', 'shot.png'),
    escapingLink,
    linkedFile,
    protectedPaths,
    published,
    clock,
    providerCalls,
    standIns,
    callTool: async (name, arguments_) => {
      const result = await ctx.tools.execute({
        callId: ToolCallId(`call-${name}`),
        name,
        arguments: arguments_,
        signal: toolSignal,
      })
      const first = result.content[0]
      return first?.type === 'text' ? first.text : JSON.stringify(result.content)
    },
    registerTool: async (name, reply) => {
      await ctx.plugin({
        name: `web-test-hot-enabled-${name}`,
        inject: ['tools'],
        apply: (inner: Context) => {
          void inner.tools.register({
            name,
            description: `hot-enabled tool ${name}`,
            parameters: { type: 'object', properties: {} },
            output: {
              schema: { type: 'string' },
              render: (_args, value) => [{ type: 'text', text: value as string }],
            },
            execute: () => Promise.resolve(reply),
          })
        },
      })
    },
    withdrawPublishedScope: () => { withdrawn.value = true },
    publishRevision: (revision) => { published.current = publishedScope(revision, [codeRoot]) },
    publishSecond: (current) => { extra.set(current.projectId, current) },
    admit: (admitOptions = {}) => {
      policy.bindEntry(sessionId, projectId)
      policy.declareEnvironment(declarationRequest([codeRoot], { isTestEnvironment: true }))
      policy.grantFlow({
        sessionId,
        flowId,
        flowRevision,
        thirdParty: admitOptions.thirdParty ?? false,
        actions: admitOptions.actions ?? 20,
      })
    },
    writeEvidence: (name, body) => {
      mkdirSync(evidenceDir, { recursive: true })
      writeFileSync(join(evidenceDir, name), body, 'utf8')
    },
    disposePolicy: async () => { await policyFiber.dispose() },
    stop: async () => {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * Register a body for every tool name the policy has an adapter for, before the
 * policy is mounted. The registry resolves a name it does not hold to
 * `UNKNOWN_TOOL` after the guard has run, so an admitted case needs a body to
 * reach; the bodies do nothing, because what these suites observe is the
 * decision, and the real capability behind an entry path is exercised through
 * the backstop rows instead.
 * @param ctx - the context whose registry receives the bodies.
 * @param defer - a name to leave out, so a suite can hot-enable it later.
 */
async function registerAdaptedTools(ctx: Context, defer?: string): Promise<void> {
  const names = adaptedToolNames().filter(name => name !== defer)
  await ctx.plugin({
    name: 'web-test-stand-in-tools',
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

/**
 * Register stand-in capability services, each recording whether a call reached
 * its body. The refusals these suites demonstrate happen in the backstop
 * wrapper, so a body that never ran is the evidence that the policy — not the
 * provider — refused the call.
 * @param ctx - the context to provide into.
 * @param calls - the shared counter map, keyed `<service>.<method>`.
 * @param omit - service keys to leave unmounted.
 * @returns the same objects that were provided, for a suite to call through.
 */
function installStandIns(ctx: Context, calls: Map<string, number>, omit: ReadonlySet<string>): StandIns {
  const record = (key: string): void => { calls.set(key, (calls.get(key) ?? 0) + 1) }
  const unreachable = (key: string): never => {
    throw new Error(`unreachable: the policy let ${key} reach its provider body`)
  }
  const web = {
    async fetch(request: { url: string }): Promise<WebFetchResult> {
      record('web.fetch')
      return { url: request.url, statusCode: 200, body: { kind: 'text', content: 'provider body ran' }, truncated: false }
    },
    async search(): Promise<never> {
      record('web.search')
      return unreachable('web.search')
    },
  }
  const shell = {
    async execute(): Promise<never> {
      record('shell.execute')
      return unreachable('shell.execute')
    },
  }
  const subprocessRuntime = {
    spawn(): never {
      record('subprocess.spawn')
      return unreachable('subprocess.spawn')
    },
  }
  const attachments = {
    async saveImage(): Promise<never> {
      record('attachments.saveImage')
      return unreachable('attachments.saveImage')
    },
    async saveImages(): Promise<never> {
      record('attachments.saveImages')
      return unreachable('attachments.saveImages')
    },
    async saveFile(): Promise<never> {
      record('attachments.saveFile')
      return unreachable('attachments.saveFile')
    },
    async saveFileStream(): Promise<never> {
      record('attachments.saveFileStream')
      return unreachable('attachments.saveFileStream')
    },
    async readImage(): Promise<never> {
      record('attachments.readImage')
      return unreachable('attachments.readImage')
    },
  }
  const terminals = {
    async spawn(): Promise<never> {
      record('terminals.spawn')
      return unreachable('terminals.spawn')
    },
  }
  if (!omit.has('web')) ctx.provide('web', web)
  if (!omit.has('shell')) ctx.provide('shell', shell)
  if (!omit.has('subprocess')) ctx.provide('subprocess', subprocessRuntime)
  if (!omit.has('attachments')) ctx.provide('attachments', attachments)
  if (!omit.has('terminals')) ctx.provide('terminals', terminals)
  return { web, shell, subprocessRuntime, attachments, terminals }
}

/**
 * Render observed matrix rows as the Markdown document an evidence file carries.
 * @param rows - the rows the suites observed, in the order they observed them.
 * @returns the Markdown document.
 */
export function renderMatrix(rows: readonly MatrixRow[]): string {
  const header = '| Entry path | Point | Case | Arguments | Provider body ran | Observed | Reason | Subject |'
  const rule = '| --- | --- | --- | --- | --- | --- | --- | --- |'
  const body = rows.map(row => `| \`${row.entry}\` | ${row.point} | ${row.case} | \`${JSON.stringify(row.arguments)}\` | ${row.providerBodyRan} | ${row.observed.replace(/\|/gu, '\\|')} | ${row.reason} | \`${row.subject.replace(/\|/gu, '\\|')}\` |`)
  return [
    '# M1-T05-A cross-entry rejection matrix',
    '',
    matrixPreamble(rows),
    '',
    header,
    rule,
    ...body,
    '',
  ].join('\n')
}

/**
 * The preamble one rendering of the matrix carries, stating what the body column
 * means and how many rows the run observed.
 * @param rows - the rows the suites observed.
 * @returns the preamble lines, without their trailing blank line.
 */
export function matrixPreamble(rows: readonly MatrixRow[]): string {
  const refused = rows.filter(row => row.case === 'denied').length
  const counted = rows.filter(row => row.providerBodyRan !== 'not-countered').length
  return [
    `This run observed ${String(rows.length)} rows: ${String(refused)} refused and ${String(rows.length - refused)} admitted.`,
    '',
    '`Provider body ran` reports `not-entered` where a counted stand-in provider recorded nothing, which is what',
    'shows the refusal happened in the policy rather than downstream of it. It reports `not-countered` where the',
    'provider is a real product service that counts nothing; those rows carry the effect the suite asserted in the',
    `observed column instead. ${String(counted)} of ${String(rows.length)} rows carry a counted observation.`,
  ].join('\n')
}

/**
 * Read the reason and subject a refusal carries out of the message the model saw.
 * @param observed - the text the model or the caller received.
 * @returns the reason and subject, or empty strings for an admitted call.
 */
export function refusalOf(observed: string): { readonly reason: string; readonly subject: string } {
  const matched = /\(([a-z-]+)\): (.*)$/u.exec(observed)
  return { reason: matched?.[1] ?? '', subject: matched?.[2] ?? '' }
}

/** The bytes the real attachment store holds under the reference a suite attacks. */
export const uploadBytes = 'TOP-SECRET-UPLOAD-CONTENT\n'

/** The content of the file under the tested code root, which no write may replace. */
export const sourceBytes = 'export const answer = 42\n'

/**
 * The minimum the terminal registry is owed by an owner: a live identity the
 * registry can look up, and a context to attach its owner cleanup to. Booting a
 * real `Agent` would need a session, a model, and a session log, none of which
 * the registry reads, so the stand-in is the whole of what this seam consumes.
 */
class LiveTerminalOwner extends Service {
  /** Identity the registry's live-owner lookup resolves. */
  readonly id = 'web-test-terminal-owner'

  /** @param ctx - Context the cleanup effect attaches to. */
  constructor(ctx: Context) {
    super(ctx, 'webTestTerminalOwner')
  }
}

/**
 * A PTY backend whose entire observable output is one appended line per
 * operation, so a refused operation is a fact on disk rather than a counter in
 * the test. `terminal-bash` is the only in-repo backend and it needs a POSIX
 * shell and a built `node-pty`, which is not every host.
 */
class FileObservingTerminalBackend implements TerminalBackend {
  /** Backend type the registry selects by name. */
  readonly type = 'probe'

  /**
   * @param logPath - file every operation appends its name to.
   */
  constructor(private readonly logPath: string) {}

  /**
   * @param spec - the registry's request; the session id is the only field used.
   * @returns a session that records each operation in the log file.
   */
  async spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession> {
    this.append(`spawn:${spec.sessionId}`)
    return {
      motd: 'probe motd',
      pid: 4242,
      startSend: (request: TerminalSendRequest): TerminalSendOperation => {
        this.append(`send:${request.text}`)
        return {
          done: Promise.resolve({
            viewport: '',
            waitReason: 'timeout',
            sessionStatus: { kind: 'running' },
            truncated: false,
          } satisfies TerminalSendResult),
          readOutput: () => ({ delta: '', truncated: false }),
          cancel: () => true,
        }
      },
      read: (): TerminalReadResult => {
        this.append('read')
        const text = this.log()
        return { text, totalLines: text.length, lineBegin: 0, lineEnd: text.length, truncated: false }
      },
      signal: async (name): Promise<{ readonly delivered: true; readonly targetPgid: number }> => {
        this.append(`signal:${name}`)
        return { delivered: true, targetPgid: 4242 }
      },
      status: () => ({ kind: 'running' }),
      close: async (reason): Promise<void> => {
        this.append(`close:${reason}`)
      },
    }
  }

  /** @returns every line the backend has appended so far. */
  log(): string {
    try {
      return readFileSync(this.logPath, 'utf8')
    } catch {
      return ''
    }
  }

  /**
   * @param line - the operation name to record.
   */
  private append(line: string): void {
    appendFileSync(this.logPath, `${line}\n`, 'utf8')
  }
}

/** The real capability services a suite attacks, and the fixtures that reach them. */
export interface RealCapabilities {
  /** Context the real services and the policy are mounted on. */
  readonly ctx: Context
  /** The mounted policy service. */
  readonly policy: WebTestPolicy
  /** The temporary tree's root. */
  readonly root: string
  /** Canonical code root the project published and the declaration names. */
  readonly codeRoot: string
  /** A file inside the code root, for an admitted read and a refused write. */
  readonly sourceFile: string
  /** The real local attachment store the backstop decorated. */
  readonly store: LocalAttachmentStore
  /** Storage root the composition declared as its protected upload directory. */
  readonly storeRoot: string
  /** A real stored upload, committed before the policy was mounted. */
  readonly upload: FileAttachmentRef
  /** A well-formed image reference over the same protected store. */
  readonly imageRef: ImageAttachmentRef
  /** The live owner the terminal registry accepts. */
  readonly owner: Agent
  /** The PTY session published before the policy was mounted. */
  readonly session: TerminalSessionId
  /** Every line the PTY backend has recorded. */
  backendLog(): string
  /** How many objects the real attachment store holds. */
  storedObjectCount(): number
  /** Read the protected object the upload reference names, bypassing the decoration. */
  readStoredUpload(): Promise<string>
  /** Dispose the policy plugin alone, leaving the real services mounted. */
  disposePolicy(): Promise<void>
  /** Dispose every service and remove the temporary tree. */
  stop(): Promise<void>
}

/**
 * Boot the policy over the real local attachment store, the real local
 * subprocess runtime, and the real terminal registry, with one stored upload and
 * one published PTY session committed before the policy is mounted. A suite can
 * then attack a service that has something real to give up.
 * @returns the booted real services and their fixtures.
 */
export async function startRealCapabilities(): Promise<RealCapabilities> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-webtest-real-'))
  const codeRoot = resolve(join(root, 'code'))
  const dshHome = resolve(join(root, 'dsh-home'))
  mkdirSync(join(codeRoot, 'src'), { recursive: true })
  mkdirSync(dshHome, { recursive: true })
  const sourceFile = join(codeRoot, 'src', 'app.ts')
  writeFileSync(sourceFile, sourceBytes, 'utf8')
  const backendLogPath = join(root, 'terminal-backend.log')
  writeFileSync(backendLogPath, '', 'utf8')

  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await registerAdaptedTools(ctx)
  await ctx.plugin(WebTestContracts)
  await ctx.plugin(LocalFileSystem, { cwd: codeRoot })
  await ctx.plugin(LocalAttachmentStore, { dshHome })
  // The composition mounted the local backend, so the abstract service key holds
  // that concrete instance; the store's root is the only member the harness
  // needs from it beyond the Service Definition.
  const store = ctx.attachments as LocalAttachmentStore
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(TerminalSessionService)
  // The registry's live-owner lookup compares identity and nothing else, and
  // `ensureOwnerCleanup` attaches its disposer to the owner's context. Booting a
  // real `Agent` would need a session, a model, and a session log, none of which
  // this seam reads, so the stand-in carries the whole of what it consumes. The
  // cast is the pattern this repo's own suites use for a partial service.
  const owner: Agent = new LiveTerminalOwner(ctx) as never
  ctx.provide('agents', { get: (id: string) => (id === owner.id ? owner : undefined), currentInitiator: () => undefined } as never)
  const backend = new FileObservingTerminalBackend(backendLogPath)
  ctx.terminals.registerBackend(backend)
  const published = { current: publishedScope(1, [codeRoot]) }
  await ctx.plugin({
    name: 'web-test-real-clock',
    apply: (inner: Context) => { void new TestClock(inner, { now: EPOCH }) },
  })
  await ctx.plugin({
    name: 'web-test-real-scope-source',
    inject: ['webTestContracts'],
    apply: (inner: Context) => {
      void new WebTestRuntimeScope(inner, {
        readProject: (id: ProjectId): ProjectMetadata | undefined => (id === projectId ? published.current : undefined),
      })
    },
  })

  // Everything a refusal has to protect is created while the policy is not yet
  // mounted: a real stored upload, and a real PTY session. A later refusal that
  // leaves either of them reachable is a real loss, not a synthetic one.
  const upload = await store.saveFile({ data: new TextEncoder().encode(uploadBytes), name: 'report.txt' })
  const imageRef: ImageAttachmentRef = {
    attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
    mediaType: 'image/png',
    bytes: 68,
    width: 1,
    height: 1,
  }
  const spawned = await ctx.terminals.spawn(owner, { type: backend.type, name: 'probe' })
  const storeRoot = store.root

  const policyFiber = await ctx.plugin(WebTestPolicy, {
    protectedPaths: [{ path: storeRoot, role: 'upload' }],
    confirmationRequiredFor: [],
    confirmationTtlMs: 60_000,
    authorizationValidityMs: 300_000,
    maxActionsPerFlow: 50,
  })
  const policy = ctx.webTestPolicy
  policy.bindEntry(sessionId, projectId)
  policy.declareEnvironment(declarationRequest([codeRoot], { isTestEnvironment: true }))
  policy.grantFlow({ sessionId, flowId, flowRevision, thirdParty: false, actions: 50 })

  return {
    ctx,
    policy,
    root,
    codeRoot,
    sourceFile,
    store,
    storeRoot,
    upload,
    imageRef,
    owner,
    session: spawned.sessionId,
    backendLog: () => backend.log(),
    storedObjectCount: () => countObjects(storeRoot),
    readStoredUpload: async () => {
      // The prototype method the backstop replaced: the store's own reader,
      // reached without the decoration, so the bytes a refusal withholds are
      // demonstrably real.
      // oxlint-disable-next-line typescript/unbound-method -- the very next line binds it to the instance, which is what makes it a control
      const undecorated = LocalAttachmentStore.prototype.readFileStream
      const chunks: Uint8Array[] = []
      for await (const chunk of undecorated.call(store, upload)) chunks.push(chunk)
      return Buffer.concat(chunks).toString('utf8')
    },
    disposePolicy: async () => { await policyFiber.dispose() },
    stop: async () => {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * Count the objects the local attachment store holds. Verbatim files land under
 * `file-objects` and normalized images under `objects`, so both are walked; the
 * per-name aliases under `files` are links to an object already counted.
 * @param storeRoot - the store's storage root.
 * @returns how many stored objects exist under it.
 */
function countObjects(storeRoot: string): number {
  let total = 0
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (statSync(child).isFile()) total += 1
    }
  }
  for (const name of ['file-objects', 'objects']) {
    try {
      walk(join(storeRoot, name))
    } catch {
      // A store that has committed nothing of that kind has no directory yet.
    }
  }
  return total
}
