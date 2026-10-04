/**
 * The Web testing pre-execution policy service (`ctx.webTestPolicy`): the one
 * decision every execution path passes before it has an effect, and the
 * read-only protection, environment declaration, and authorization that decision
 * reads.
 *
 * **Two enforcement points, one decision.** Every model-initiated call — ordinary
 * chat, a skill body, a PTC sub-dispatch, an MCP tool, a retry, a tool hot-enabled
 * mid-session, a future native executor — reaches `ToolRuntime.execute`, and this
 * service attaches at the registry's *guard* stage rather than at the extensible
 * `tools/pre-execute` waterfall. A guard has no allow result, it runs after every
 * pre-execute listener and after the approval question, and a call an approval
 * service allowed still reaches it. So an official approval and this restriction
 * both apply, neither can relax the other, and a listener that answers `allow`
 * cannot resurrect a refusal. The second point is the service-level backstop in
 * `./backstop.ts`, which puts the same decision in front of a direct `ctx.fs`,
 * `ctx.web`, `ctx.subprocess`, `ctx.shell`, `ctx.attachments`, or `ctx.terminals`
 * call that never reached a tool.
 *
 * **Refusal is not configuration.** The protected directories, the confirmation
 * requirements, the authorization validity, and the action ceiling are validated
 * `Config` fields, because each is a deployment-varying choice. What a test
 * session may do is not: a declared code root is read-only, an arbitrary shell
 * and the terminal capability are refused for every grant including a
 * human-approved one, and an entry path with no adapter is refused. A grant can
 * only ever let through what the product already allows.
 *
 * **UI visibility is not a control.** Nothing here reads a preset, a tool
 * surface, or a preset's developer-tool switch. A tool the official bootstrap, a
 * Creator selection, or a default-preset change brings into the registry is
 * decided by the effect it would have, on its next call, whether or not it is
 * ever shown to the model.
 *
 * @module @deepseek-ai/dsh-web-test-policy
 */

import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { consumeReadonlySearchSpawn } from '@deepseek-ai/dsh-tool-fs-search'
import { hasDesktopBrowserExecutionAuthority } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { isQuickJsPtcRuntime } from '@deepseek-ai/dsh-ptc-runtime-quickjs'
import type { DesktopBrowserControl, DesktopBrowserTargetId } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { ProjectId, PolicyDecision } from '@deepseek-ai/dsh-web-test-contracts'
import { parseConfirmEnvironmentRequest } from '@deepseek-ai/dsh-web-test-contracts/parse'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-terminal'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-web'
import { decorateMethod, optionalService } from './backstop.ts'
import { guardFileRetention } from './file-retention.guard.ts'
import { toolEffect, WEB_TEST_EFFECT_KINDS, type WebTestEffect } from './effects.ts'
import { EnvironmentLedger } from './ledger.ts'
import { isConversationMetadataTool } from './conversation-tools.ts'
import { isControlledBrowserTool } from './browser-tools.ts'
import { resolvePath } from './scope.ts'
import { WebTestPolicyError } from './errors.ts'
import { sameScreenshotReference, screenshotProjection } from './screenshot-projection.ts'
import type {
  ConfirmationAnswer, ConfirmationOutcome, ConfirmationRequest, ConfirmationState, DeclaredEnvironment,
  FlowGrantReceipt, FlowGrantRequest, PolicyQuery, ProtectedPath, ProtectedPathDeclaration, WebTestEffectKind,
} from './types.ts'

export { decorateMethod, optionalService } from './backstop.ts'
export { SystemClock, WebTestClock } from './clock.ts'
export { WebTestPolicyError } from './errors.ts'
export type { WebTestPolicyErrorCode } from './errors.ts'
export { adaptedToolNames, effectSubject, toolEffect, WEB_TEST_EFFECT_KINDS } from './effects.ts'
export type { WebTestEffect } from './effects.ts'
export { EnvironmentLedger } from './ledger.ts'
export type { DeclarationEvaluator, LedgerLimits } from './ledger.ts'
export { comparablePath, isInside, originOf, resolvePath } from './scope.ts'
export type { PathRejection, ResolvedPath } from './scope.ts'
export { WebTestRuntimeScope, WebTestScopeSource } from './scope-source.ts'
export type { ProjectScopeReader } from './scope-source.ts'
export type * from './types.ts'
export { isConversationMetadataTool } from './conversation-tools.ts'
export { isControlledBrowserTool, WEB_TEST_BROWSER_TOOLS } from './browser-tools.ts'
export { screenshotProjection } from './screenshot-projection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTestPolicy: WebTestPolicy
  }
}

/**
 * Plugin config. Every field is a deployment-varying choice the composition
 * states, and each default is the conservative reading of its field: no
 * protected directory, no confirmation requirement, and the shortest validities.
 */
export interface Config {
  /** Directories holding upload, download, or temporary material, by role. */
  protectedPaths: ProtectedPathDeclaration[]
  /** Effect kinds that require a business confirmation before they may act. */
  confirmationRequiredFor: WebTestEffectKind[]
  /** Milliseconds a business confirmation stays answerable. */
  confirmationTtlMs: number
  /** Milliseconds one granted authorization stays valid. */
  authorizationValidityMs: number
  /** Most actions one granted authorization may cover. */
  maxActionsPerFlow: number
}

/**
 * Schemastery validator for {@link Config}.
 *
 * The input type is `Partial<Config>` because every field carries a `.default()`
 * and the loader hands a partial object straight to the schema
 * (`resolveConfig` in `vendor/cordis/src/fiber.ts:50` takes `config: any` and
 * calls `Config['~standard'].validate(config)`). Declaring `z<Config>` would
 * reject at compile time the very call the loader performs at runtime, and
 * would deny a composition that legitimately supplies only overrides. This is
 * the form eight existing packages use, `packages/document/office-to-pdf` being
 * the direct precedent.
 */
export const Config: z<Partial<Config>, Config> = z.object({
  protectedPaths: z.array(z.object({
    path: z.string().required(),
    role: z.union([
      z.const('upload'),
      z.const('download'),
      z.const('temporary-material'),
    ]).required(),
  })).default([]),
  confirmationRequiredFor: z.array(z.union(
    WEB_TEST_EFFECT_KINDS.map(kind => z.const(kind)),
  )).default([]),
  confirmationTtlMs: z.number().min(1).default(60_000),
  authorizationValidityMs: z.number().min(1).default(300_000),
  maxActionsPerFlow: z.number().min(1).default(50),
})

/**
 * Resolve the composition's protected directories into the identities the
 * decision compares against, refusing a declaration the policy cannot enforce.
 * A protected directory that is a link is refused rather than followed, and one
 * that does not exist is refused rather than skipped, because a boundary the
 * policy cannot name is not one it is enforcing.
 * @param declarations - the composition's protected directories, by role.
 * @returns the resolved directories, in declaration order.
 * @throws {WebTestPolicyError} `unresolved-path` when a declared directory does
 * not exist, `link-path` when it is a link.
 */
export function resolveProtectedPaths(declarations: readonly ProtectedPathDeclaration[]): ProtectedPath[] {
  return declarations.map((declaration) => {
    const state = resolvePath(declaration.path)
    if (state.ok) return { real: state.real, role: declaration.role }
    throw new WebTestPolicyError(
      state.rejection === 'link' ? 'web-test-policy/link-path' : 'web-test-policy/unresolved-path',
      `protected ${declaration.role} path '${declaration.path}' is ${state.rejection === 'link'
        ? 'a link, and a boundary the policy cannot follow is not one it will enforce'
        : 'not an existing directory the policy can canonically resolve'}`,
    )
  })
}

/**
 * The session identity one tool call belongs to, which is what tells a decision
 * which project's declaration and grants apply.
 * @param execution - the identity-protected call, or any value carrying the same
 * two optional facts.
 * @returns the session identity, or `null` for a call made with no agent.
 */
export function sessionIdOf(execution: { readonly agent?: { readonly session: { readonly id: string } } }): string | null {
  return execution.agent === undefined ? null : execution.agent.session.id
}

interface CapturedImageProvider {
  readonly save: (input: SaveImageAttachment) => Promise<ImageAttachmentRef>
  readonly images: Map<SessionId, ImageAttachmentRef[]>
}

const captureProviders = new WeakMap<object, CapturedImageProvider>()
const probeReferences = new WeakMap<object, Map<string, ImageAttachmentRef>>()
const browserControls = new WeakMap<object, DesktopBrowserControl>()

function originalPolicy(value: object): object {
  const original: unknown = Reflect.get(value, Symbol.for('cordis.original'))
  return typeof original === 'object' && original !== null ? original : value
}

/**
 * The pre-execution policy. One ledger answers for every entry path; the two
 * enforcement points are effects of this service's context, so disposing the
 * plugin removes the guard and restores every decorated service method.
 */
export class WebTestPolicy extends Service {
  static inject = ['tools', 'webTestClock', 'webTestContracts', 'webTestScopeSource']

  static Config: z<Partial<Config>, Config> = Config

  private readonly clock: Context['webTestClock']

  private readonly ledger: EnvironmentLedger

  private saveProbeImage: (() => Promise<ImageAttachmentRef>) | undefined

  private readonly backstopRestores = new Map<object, (() => void)[]>()

  /**
   * @param ctx - Context of the Policy plugin; the guard and the backstop attach here.
   * @param config - Validated plugin config.
   */
  constructor(ctx: Context, public config: Config) {
    super(ctx, 'webTestPolicy')
    probeReferences.set(this, new Map())
    this.clock = ctx.webTestClock
    this.ledger = new EnvironmentLedger(
      resolveProtectedPaths(config.protectedPaths),
      {
        confirmationRequiredFor: config.confirmationRequiredFor,
        confirmationTtlMs: config.confirmationTtlMs,
        authorizationValidityMs: config.authorizationValidityMs,
        maxActionsPerFlow: config.maxActionsPerFlow,
      },
      ctx.webTestScopeSource,
      ctx.webTestContracts,
      () => this.clock.now(),
    )
    this.installGuard()
    this.installBackstop()
    this.watchBackstop('sessionProjections', (inner) => {
      inner.sessionProjections.register(screenshotProjection)
    })
    this.watchBackstop('desktopBrowserControl', (inner, restores) => {
      const control = inner.desktopBrowserControl
      browserControls.set(this, control)
      inner.effect(() => () => {
        browserControls.delete(this)
      }, 'webTestPolicy.browserControl')
      restores.push(decorateMethod(control, 'submit', original => async (sessionId, body, signal) => {
        const binding = control.binding(sessionId)
        const decision = this.ledger.authorize({
          sessionId,
          effect: binding === undefined ? null : { kind: 'fetch-web', url: binding.url },
          entry: 'desktopBrowserControl.submit',
        })
        if (!decision.allowed) {
          throw new WebTestPolicyError('web-test-policy/denied', this.denialMessage('desktopBrowserControl.submit', decision))
        }
        return await original.call(control, sessionId, body, signal)
      }))
      restores.push(decorateMethod(control, 'submitRole', original => async (binding, body, signal, authority) => {
        if (!hasDesktopBrowserExecutionAuthority(authority, control)) {
          throw new WebTestPolicyError('web-test-policy/denied', 'desktopBrowserControl.submitRole requires trusted Runtime authority')
        }
        const decision = this.ledger.authorize({
          sessionId: binding.executionRole.owner.sessionId,
          effect: { kind: 'fetch-web', url: binding.url },
          entry: 'desktopBrowserControl.submitRole',
        })
        if (!decision.allowed) {
          throw new WebTestPolicyError('web-test-policy/denied', this.denialMessage('desktopBrowserControl.submitRole', decision))
        }
        return await original.call(control, binding, body, signal, authority)
      }))
    })
  }

  /**
   * Store the application's fixed one-pixel capability probe through the installed
   * attachment provider. No caller-supplied image or file is admitted.
   * @returns the durable reference providers may project into a model request.
   * @throws {WebTestPolicyError} when no attachment provider is installed.
   */
  async createModelProbeImage(): Promise<ImageAttachmentRef> {
    if (this.saveProbeImage === undefined) {
      throw new WebTestPolicyError('web-test-policy/denied', 'model image probe has no attachment provider')
    }
    return await this.saveProbeImage()
  }

  private ownsProbeImage(ref: ImageAttachmentRef): boolean {
    const owned = probeReferences.get(originalPolicy(this))?.get(ref.attachmentId)
    return owned !== undefined && owned.mediaType === ref.mediaType && owned.bytes === ref.bytes
      && owned.width === ref.width && owned.height === ref.height
  }

  /**
   * Capture only the calling Agent's Main-authorized page and persist its verified image.
   * @param sessionId - The calling Agent's own Session identity.
   * @param signal - Cancellation for the original capture; a failed or late capture is not retried.
   * @returns the durable image reference and the exact target and Host epoch that supplied it.
   * @throws {WebTestPolicyError} when identity, binding, provider or Main acceptance is absent.
   */
  async captureBrowserScreenshot(sessionId: SessionId, signal: AbortSignal): Promise<{
    image: ImageAttachmentRef
    target: DesktopBrowserTargetId
    hostEpoch: number
  }> {
    const initiator = optionalService<Context['agents']>(this.ctx, 'agents')?.currentInitiator()
    const control = browserControls.get(originalPolicy(this))
    const provider = captureProviders.get(originalPolicy(this))
    const binding = control?.binding(sessionId)
    if (!initiator || initiator.session.id !== sessionId || !control || !provider || !binding) {
      throw new WebTestPolicyError('web-test-policy/denied', 'browser capture requires its calling Agent, live binding and attachment provider')
    }
    signal.throwIfAborted()
    const result = await control.submit(sessionId, { kind: 'screenshot', format: 'png' }, signal)
    signal.throwIfAborted()
    const after = control.binding(sessionId)
    if (!result.ok || !result.screenshot || after?.target !== binding.target || after.hostEpoch !== binding.hostEpoch) {
      throw new WebTestPolicyError('web-test-policy/denied', 'browser capture has no accepted image from its original target and Host epoch')
    }
    const image = await provider.save({ data: result.screenshot, mediaType: 'image/png' })
    signal.throwIfAborted()
    const current = control.binding(sessionId)
    if (current?.target !== binding.target || current.hostEpoch !== binding.hostEpoch
      || captureProviders.get(originalPolicy(this)) !== provider) {
      throw new WebTestPolicyError('web-test-policy/denied', 'browser capture owner changed before its image was admitted')
    }
    const images = provider.images.get(sessionId) ?? []
    if (!images.some(existing => sameScreenshotReference(existing, image))) images.push({ ...image })
    provider.images.set(sessionId, images)
    return { image, target: binding.target, hostEpoch: binding.hostEpoch }
  }

  private ownsReadableImage(ref: ImageAttachmentRef): boolean {
    if (this.ownsProbeImage(ref)) return true
    const initiator = optionalService<Context['agents']>(this.ctx, 'agents')?.currentInitiator()
    const sessionId = initiator?.session.id
    for (const [owner, images] of captureProviders.get(originalPolicy(this))?.images ?? []) {
      if ((sessionId === undefined || sessionId === owner) && images.some(image => sameScreenshotReference(image, ref))) return true
    }
    const sessions = optionalService<Context['sessions']>(this.ctx, 'sessions')
    const projections = optionalService<Context['sessionProjections']>(this.ctx, 'sessionProjections')
    if (!sessions || !projections) return false
    const candidates = initiator === undefined ? sessions.list() : [initiator.session]
    return candidates.some(session => projections.stateOf(session, 'webTestScreenshots')?.images
      .some(image => sameScreenshotReference(image, ref)) === true)
  }

  /**
   * Bind one session to the project its entry opened. A decision with no such
   * binding, and no single declared project to fall back to, is refused, so a
   * call that cannot name its project has no declaration to be covered by.
   * @param sessionId - the session whose entry is running.
   * @param projectId - the project that entry is testing.
   * @returns the disposer that withdraws the binding.
   */
  bindEntry(sessionId: string, projectId: ProjectId): () => void {
    return this.ledger.bindEntry(sessionId, projectId)
  }

  /**
   * Record one confirmed environment declaration. The request is validated by
   * the contract's own parser, so a Client, the Runtime, and this service reject
   * the same illegal field with the same code and the same field name.
   * @param request - project identity, command token, and the declaration.
   * @returns the declared environment as the policy resolved it.
   * @throws a `web-test/*` failure naming the offending field, or a
   * `web-test-policy/*` failure naming what the declaration could not stand behind.
   */
  declareEnvironment(request: Record<string, unknown>): DeclaredEnvironment {
    return this.ledger.declare(parseConfirmEnvironmentRequest(request))
  }

  /**
   * Grant one concrete flow the right to act, bounded by record, count, and
   * validity. A count above the configured ceiling is refused rather than
   * silently reduced, so a caller that asked for more than the product allows is
   * told rather than quietly given something else.
   * @param request - the flow, its plan revision, the third-party flag, and the action count.
   * @returns the granted authorization as the caller is told.
   * @throws {WebTestPolicyError} `grant-exceeds-limit` when the requested count
   * is above the configured ceiling, `no-declaration` when the session's project
   * has no confirmed environment.
   */
  grantFlow(request: FlowGrantRequest): FlowGrantReceipt {
    if (request.actions > this.config.maxActionsPerFlow) {
      throw new WebTestPolicyError(
        'web-test-policy/grant-exceeds-limit',
        `a grant may cover at most ${String(this.config.maxActionsPerFlow)} actions, but ${String(request.actions)} were requested`,
      )
    }
    return this.ledger.grant(request)
  }

  /**
   * Decide one effect without spending anything, for a caller that only reports.
   * @param query - the entry, its session, and the effect it would have.
   * @returns the decision.
   */
  evaluate(query: PolicyQuery): PolicyDecision {
    return this.ledger.evaluate(query)
  }

  /**
   * Open or re-check the business confirmation one dependent action needs.
   * @param request - the dependent action, its session, and the flow it belongs to.
   * @returns whether a confirmation was required, and how the question stands.
   */
  requireConfirmation(request: ConfirmationRequest): ConfirmationOutcome {
    return this.ledger.requireConfirmation(request)
  }

  /**
   * Apply one human answer to the question it names, re-checking the question,
   * the intended action, and the current project, environment, and plan
   * revisions before accepting it.
   * @param answer - the question identity and the context the human was shown.
   * @returns the state the question reached, and whether it must be asked again.
   * @throws {WebTestPolicyError} `unknown-question` when the identity names no question.
   */
  answerConfirmation(answer: ConfirmationAnswer): { readonly state: ConfirmationState; readonly reclarify: boolean } {
    return this.ledger.answerConfirmation(answer)
  }

  /**
   * Record that the caller chose not to confirm, or that the dependent work was
   * cancelled. Neither grants anything; both close the question so the next
   * attempt asks a new one.
   * @param questionId - the question to close.
   * @param state - `skipped` for a declined confirmation, `cancelled` for abandoned work.
   * @returns the state the question reached.
   * @throws {WebTestPolicyError} `unknown-question` when the identity names no question.
   */
  closeConfirmation(questionId: string, state: 'skipped' | 'cancelled'): ConfirmationState {
    return this.ledger.closeConfirmation(questionId, state)
  }

  /**
   * Attach the monotonic guard to the tool registry. The guard is the correct
   * stage rather than the `tools/pre-execute` waterfall: a waterfall listener can
   * answer `allow`, and a guard cannot, so the refusal survives listener order and
   * survives an approval service that answered `allowed-once`. It is consulted
   * per call rather than per registration, so a tool registered mid-session is
   * decided on its next call with nothing having noticed the registration.
   */
  private installGuard(): void {
    const restore = this.ctx.tools.guard((exec) => {
      // These handlers only read or register metadata, obtain a human answer,
      // or refuse an unimplemented test command. Actual I/O still reaches the
      // same service backstop and cannot acquire permission through this row.
      if (isConversationMetadataTool(exec.name)) return undefined
      // The reserved transport has no direct I/O in this exact provider.
      // Its nested tool calls still pass through this guard and the backstops.
      if (exec.name === 'run_code' && isQuickJsPtcRuntime(optionalService(this.ctx, 'ptcRuntime'))) return undefined
      const arguments_ = exec.arguments as Readonly<Record<string, unknown>>
      let effect = toolEffect(exec.name, arguments_)
      if (exec.name === 'glob' || exec.name === 'grep') {
        const argument = arguments_['path']
        const target = resolve(exec.agent?.session.header.cwd ?? process.cwd(), typeof argument === 'string' ? argument : '.')
        const identity = resolvePath(target)
        effect = identity.ok ? { kind: exec.name === 'glob' ? 'list-source' : 'read-source', path: identity.real } : null
      }
      if (isControlledBrowserTool(exec.name)) {
        const sessionId = exec.agent?.session.id
        const binding = sessionId === undefined ? undefined : browserControls.get(originalPolicy(this))?.binding(sessionId)
        effect = binding === undefined ? null : { kind: 'fetch-web', url: binding.url }
      }
      const query = {
        sessionId: sessionIdOf(exec),
        effect,
        entry: exec.name === 'glob' || exec.name === 'grep' ? 'fsSearch.search' : exec.name,
      }
      // Browser and search providers consume one action at their effect point.
      const decision = isControlledBrowserTool(exec.name) || exec.name === 'glob' || exec.name === 'grep'
        ? this.ledger.evaluate(query)
        : this.ledger.authorize(query)
      return decision.allowed ? undefined : this.denialMessage(exec.name, decision)
    })
    this.ctx.effect(() => restore, 'webTestPolicy.toolGuard')
  }

  /**
   * The refusal a caller sees, naming the entry path and the reason.
   * @param entry - the tool or service the call came through.
   * @param decision - the refusal the ledger reached.
   * @returns the message the model or the plugin reports.
   */
  private denialMessage(entry: string, decision: PolicyDecision): string {
    return `web testing policy refused "${entry}" (${decision.reason}): ${decision.subject}`
  }

  /**
   * Throw when one service call's effect is refused. A direct service call has no
   * session of its own, so the ledger decides it against the only declared
   * project, and against nothing at all when more than one project could apply.
   * @param entry - the service method the call came through.
   * @param effect - the effect the call would have.
   * @throws {WebTestPolicyError} `denied` when the effect is refused.
   */
  private refuse(entry: string, effect: WebTestEffect): void {
    const decision = this.ledger.authorize({ sessionId: null, effect, entry })
    if (decision.allowed) return
    throw new WebTestPolicyError('web-test-policy/denied', this.denialMessage(entry, decision))
  }

  /**
   * Decorate the public capability services, so a direct call is decided by the
   * same ledger the tool guard asks. Every method is restored by this effect's
   * disposer.
   *
   * The list is the complete set of methods on these six Service Definitions
   * that can have an effect, and it is derived from the Service Definitions
   * rather than from the methods a consumer happened to call. A method that
   * reaches an effect through a second name is the same defect twice: the tool
   * layer already reaches `readImage` and `readFileStream` through two different
   * attachment methods, and `subprocess.spawnTerminal` is a persistent shell
   * that `ctx.terminals` is not the only way to reach. The README states which
   * methods of each service are left alone and why.
   */
  private installBackstop(): void {
    this.ctx.effect(() => () => {
      for (const restores of this.backstopRestores.values()) {
        for (const restore of restores.reverse()) restore()
      }
      this.backstopRestores.clear()
    }, 'webTestPolicy.serviceBackstop')
    this.watchBackstop('fs', (ctx, restores) => {
      const fileSystem = ctx.fs
      const path = (target: FsTarget): string => fileSystem.processPath(target)
      restores.push(
        decorateMethod(fileSystem, 'readText', original => async (target, signal) => {
          this.refuse('fs.readText', { kind: 'read-source', path: path(target) })
          return await original.call(fileSystem, target, signal)
        }),
        decorateMethod(fileSystem, 'readBytes', original => async (target, signal, maxBytes) => {
          this.refuse('fs.readBytes', { kind: 'read-source', path: path(target) })
          return await original.call(fileSystem, target, signal, maxBytes)
        }),
        decorateMethod(fileSystem, 'readByteRange', original => async (target, range, signal) => {
          this.refuse('fs.readByteRange', { kind: 'read-source', path: path(target) })
          return await original.call(fileSystem, target, range, signal)
        }),
        decorateMethod(fileSystem, 'streamText', original => (target, signal) => {
          this.refuse('fs.streamText', { kind: 'read-source', path: path(target) })
          return original.call(fileSystem, target, signal)
        }),
        decorateMethod(fileSystem, 'listDir', original => async (target, signal) => {
          this.refuse('fs.listDir', { kind: 'list-source', path: path(target) })
          return await original.call(fileSystem, target, signal)
        }),
        decorateMethod(fileSystem, 'writeText', original => async (target, content, expected, signal, sandboxPolicy) => {
          this.refuse('fs.writeText', { kind: 'write-source', path: path(target) })
          return await original.call(fileSystem, target, content, expected, signal, sandboxPolicy)
        }),
        decorateMethod(fileSystem, 'editText', original => async (target, edit, expected, signal, sandboxPolicy) => {
          this.refuse('fs.editText', { kind: 'edit-source', path: path(target) })
          return await original.call(fileSystem, target, edit, expected, signal, sandboxPolicy)
        }),
      )
    })
    this.watchBackstop('shell', (ctx, restores) => {
      const shell = ctx.shell
      restores.push(decorateMethod(shell, 'execute', original => async (spec) => {
        this.refuse('shell.execute', { kind: 'spawn-process', command: spec.command })
        return await original.call(shell, spec)
      }))
    })
    this.watchBackstop('subprocess', (ctx, restores) => {
      const subprocessRuntime = ctx.subprocess
      restores.push(
        decorateMethod(subprocessRuntime, 'spawn', original => (spec) => {
          const search = consumeReadonlySearchSpawn(spec)
          if (search !== undefined) {
            const target = resolve(spec.cwd, search.invocation.path)
            const resolved = resolvePath(target)
            const decision = this.ledger.authorize({
              sessionId: search.invocation.sessionId,
              effect: resolved.ok ? {
                kind: search.invocation.kind === 'glob' ? 'list-source' : 'read-source', path: resolved.real,
              } : null,
              entry: 'fsSearch.search',
            })
            if (!decision.allowed || !resolved.ok) {
              throw new WebTestPolicyError('web-test-policy/denied', this.denialMessage('fsSearch.search', decision))
            }
            return original.call(subprocessRuntime, search.restrict(resolved.real, this.ledger.protectedPaths.map(path => path.real)))
          }
          this.refuse('subprocess.spawn', { kind: 'spawn-process', command: spec.argv.join(' ') })
          return original.call(subprocessRuntime, spec)
        }),
        // The only non-pipe process primitive, and the one `terminal-bash` and
        // the terminal controller call directly: a caller that holds the
        // subprocess service reaches a persistent shell without `ctx.terminals`
        // in the path at all.
        decorateMethod(subprocessRuntime, 'spawnTerminal', original => async (spec) => {
          this.refuse('subprocess.spawnTerminal', { kind: 'use-terminal' })
          return await original.call(subprocessRuntime, spec)
        }),
      )
    })
    this.watchBackstop('web', (ctx, restores) => {
      const web = ctx.web
      restores.push(
        decorateMethod(web, 'fetch', original => async (request, signal) => {
          this.refuse('web.fetch', { kind: 'fetch-web', url: request.url })
          return await original.call(web, request, signal)
        }),
        decorateMethod(web, 'search', original => async (request, signal) => {
          this.refuse('web.search', { kind: 'search-web', queries: [request.query] })
          return await original.call(web, request, signal)
        }),
      )
    })
    this.watchBackstop('attachments', (ctx, restores) => {
      const attachments = ctx.attachments
      restores.push(...guardFileRetention(attachments, (entry, effect) => { this.refuse(entry, effect) }))
      const saveImage = attachments.saveImage.bind(attachments)
      const capturedProvider: CapturedImageProvider = { save: saveImage, images: new Map() }
      captureProviders.set(this, capturedProvider)
      const saveProbeImage = async () => {
        const ref = await saveImage({
          data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64'),
          mediaType: 'image/png',
        })
        if (this.saveProbeImage === undefined) {
          throw new WebTestPolicyError('web-test-policy/denied', 'model image probe owner was disposed')
        }
        probeReferences.get(this)?.set(ref.attachmentId, { ...ref })
        return ref
      }
      this.saveProbeImage = saveProbeImage
      ctx.effect(() => () => {
        this.saveProbeImage = undefined
        probeReferences.get(this)?.clear()
        captureProviders.delete(this)
      }, 'webTestPolicy.modelProbeProvider')
      restores.push(
        decorateMethod(attachments, 'saveImage', original => async (input) => {
          this.refuse('attachments.saveImage', { kind: 'write-upload' })
          return await original.call(attachments, input)
        }),
        decorateMethod(attachments, 'saveImages', original => async (inputs) => {
          this.refuse('attachments.saveImages', { kind: 'write-upload' })
          return await original.call(attachments, inputs)
        }),
        // Two more names for the same durable write: the base64 file upload and
        // the Host prompt admission that replaces an uploaded image with its
        // durable reference.
        decorateMethod(attachments, 'admitEncodedFile', original => async (input) => {
          this.refuse('attachments.admitEncodedFile', { kind: 'write-upload' })
          return await original.call(attachments, input)
        }),
        decorateMethod(attachments, 'admitPromptContent', original => async (content) => {
          if (content.some(part => part.type !== 'text')) {
            this.refuse('attachments.admitPromptContent', { kind: 'write-upload' })
          }
          return await original.call(attachments, content)
        }),
        decorateMethod(attachments, 'saveFile', original => async (input) => {
          this.refuse('attachments.saveFile', { kind: 'write-upload' })
          return await original.call(attachments, input)
        }),
        decorateMethod(attachments, 'saveFileStream', original => async (input) => {
          this.refuse('attachments.saveFileStream', { kind: 'write-upload' })
          return await original.call(attachments, input)
        }),
        // Three names for reading stored material back: the verified read, the
        // verbatim byte stream, and the request-image projection the model
        // providers build a request from.
        decorateMethod(attachments, 'readImage', original => async (ref, signal) => {
          if (!this.ownsReadableImage(ref)) this.refuse('attachments.readImage', { kind: 'read-upload' })
          return await original.call(attachments, ref, signal)
        }),
        decorateMethod(attachments, 'readImageRequest', original => async (ref, target, signal) => {
          if (!this.ownsReadableImage(ref)) {
            this.refuse('attachments.readImageRequest', { kind: 'read-upload' })
          }
          return await original.call(attachments, ref, target, signal)
        }),
      )
    })
    this.watchBackstop('terminals', (ctx, restores) => {
      const terminals = ctx.terminals
      restores.push(
        decorateMethod(terminals, 'spawn', original => async (owner, request, signal) => {
          this.refuse('terminals.spawn', { kind: 'use-terminal' })
          return await original.call(terminals, owner, request, signal)
        }),
        // Sending, reading, and signalling all operate a session that already
        // exists, so refusing only `spawn` would leave a terminal the policy
        // considers forbidden fully operable for whoever started it earlier.
        decorateMethod(terminals, 'startSend', original => (owner, id, request) => {
          this.refuse('terminals.startSend', { kind: 'use-terminal' })
          return original.call(terminals, owner, id, request)
        }),
        decorateMethod(terminals, 'read', original => (owner, id, request) => {
          this.refuse('terminals.read', { kind: 'use-terminal' })
          return original.call(terminals, owner, id, request)
        }),
        decorateMethod(terminals, 'signal', original => async (owner, id, signal) => {
          this.refuse('terminals.signal', { kind: 'use-terminal' })
          return await original.call(terminals, owner, id, signal)
        }),
      )
    })
  }

  private watchBackstop(
    name: 'fs' | 'shell' | 'subprocess' | 'web' | 'attachments' | 'terminals' | 'desktopBrowserControl' | 'sessionProjections',
    install: (ctx: Context, restores: (() => void)[]) => void,
  ): void {
    this.ctx.inject([name], (ctx) => {
      const provider = ctx[name]
      const previous = this.backstopRestores.get(provider)
      if (previous !== undefined) {
        for (const restore of previous.reverse()) restore()
        this.backstopRestores.delete(provider)
      }
      const restores: (() => void)[] = []
      try {
        install(ctx, restores)
      }
      catch (error) {
        for (const restore of restores.reverse()) restore()
        throw error
      }
      // Async consumers can retain a retired provider. Its methods stay guarded
      // until the policy itself unloads, rather than reopening private reads.
      this.backstopRestores.set(provider, restores)
    })
  }
}

export default WebTestPolicy
