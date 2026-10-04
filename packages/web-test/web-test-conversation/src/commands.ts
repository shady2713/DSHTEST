/**
 * The one Remote both a web testing card and a web testing conversation address
 * (`ctx.webTestCommands`): the Service Definition the Typert generator derives
 * the Client types from, and the only implementation behind them.
 *
 * **One Remote, two callers.** A card reaches these methods over the shared RPC
 * carrier, and the conversation's own assembly reaches the same methods
 * in-process. There is no second command path to keep in step: a card cannot
 * reach a command the conversation cannot, and a decision this service makes is
 * the decision both read. The card is not a privileged caller — it holds no
 * session of its own, so it can only ask on behalf of a Session id it names.
 *
 * **A query and an action are two surfaces, not one switch.** `queryStatus` reads
 * and `submitAction` decides, and the types do not overlap: a
 * {@link ResolvedCommand} for a query has no target and no expected revision,
 * while every mutating command has both, so a typed caller cannot build an action
 * out of a status question. {@link ActionOutcome} has no member that reports an
 * action as performed, because this stage has no domain that would record one —
 * the five mutating verbs are answered `unavailable` with the reason, which is
 * what makes "a status query cannot start a test" a property of the surface
 * rather than a branch a later edit could delete.
 *
 * **Refusals are ordered, and the first one wins.** An ask is refused for the
 * Session it names before anything is read about it, so a session attached to no
 * project cannot learn anything from a failed ask; then for what it left out;
 * then for a project that moved since the answer it was expressed against; and
 * only then for a verb this stage does not perform. A refusal names the project it
 * is about by identity only, never by its code root or its entry URLs.
 *
 * @module @deepseek-ai/dsh-web-test-conversation/commands
 */

import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  describeCommands,
  incompleteAsk,
  isMutatingCommandVerb,
  resolveCommand,
  unavailableAction,
  undeclaredEnvironment,
} from './command.ts'
import type { ActionOutcome, ActionRequest, CommandCatalogue, StatusReport, StatusQueryRequest } from './command.ts'
import type { ProjectId, ProjectMetadata, Revision, RegisterProjectRequest, EnvironmentDeclaration } from '@deepseek-ai/dsh-web-test-contracts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { parseEnvironmentDeclaration, parseRegisterProjectRequest } from '@deepseek-ai/dsh-web-test-contracts'
import { registerCommandTools } from './tools.ts'
import type { AttachedContext } from './context.ts'
import { WebTestConversationError } from './errors.ts'
// This import is what brings the `ctx.webTestConversation` and
// `ctx.webTestRuntime` augmentations into the program this service is written
// against.
import type { StoredEntryUrlProbe } from '@deepseek-ai/dsh-web-test-runtime/types'
import { WebTestRuntimeError } from '@deepseek-ai/dsh-web-test-runtime'
import type {} from '@deepseek-ai/dsh-web-test-runtime'
import type {} from './index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTestCommands: WebTestCommands
  }
}

/** Wire namespace and Cordis service key the generated Client addresses these methods under. */
export const WEB_TEST_COMMANDS_NAMESPACE = 'webTestCommands'

/** Minimal project catalogue entry; ordinary conversations receive no private material. */
export type ProjectSummary = {
  /** Published project identity a user can explicitly select. */
  readonly projectId: ProjectId
  /** Current metadata revision. */
  readonly revision: Revision
}

/** Explicit project selection for one conversation. */
export type AttachProjectRequest = {
  /** Conversation to associate. */
  readonly sessionId: SessionId
  /** Project selected by the user. */
  readonly projectId: ProjectId
}

/** User-supplied project metadata registered through the runtime. */
export type ConversationRegistrationRequest = {
  /** Conversation receiving the new project. */
  readonly sessionId: SessionId
  /** Metadata and idempotency token passed unchanged to the domain parser. */
  readonly registration: RegisterProjectRequest
}

/** User correction of the attached project's metadata, retaining its identity. */
export type ConversationProjectUpdateRequest = {
  /** Live conversation whose own project is revised. */
  readonly sessionId: SessionId
  /** Project identity displayed when the user prepared the correction. */
  readonly projectId: ProjectId
  /** Idempotency token starting cmd-; reuse only for the same correction. */
  readonly commandId: string
  /** Revision displayed when the correction was prepared. */
  readonly expectedRevision: Revision
  /** Explicit replacement code roots. */
  readonly codeRoots: readonly string[]
  /** Explicit replacement already-started entry URLs. */
  readonly entryUrls: readonly string[]
}

/** Explicit user environment declaration for the conversation's own project. */
export type ConversationDeclarationRequest = {
  /** Conversation whose project receives the declaration. */
  readonly sessionId: SessionId
  /** User-generated idempotency token. */
  readonly commandId: string
  /** Environment facts explicitly supplied by the user. */
  readonly declaration: EnvironmentDeclaration
}

/** Explicit check of the already-started URLs registered by this conversation's project. */
export type ConversationEntryUrlProbeRequest = {
  /** Live conversation whose attached project supplies every requested address. */
  readonly sessionId: SessionId
  /** Project identity displayed when the user selected the check. */
  readonly projectId: ProjectId
  /** Published metadata revision the user selected for the check. */
  readonly expectedRevision: Revision
}

/**
 * The web testing command Remote. One instance per application; it reads the
 * entry's association for the Session each ask names and the runtime's published
 * record for the project that association holds.
 */
export class WebTestCommands extends TypertRemoteService {
  static inject = ['webTestConversation', 'webTestRuntime', 'agents', 'tools', 'userQuestions']

  private active = true

  /**
   * @param ctx - Context of the Commands plugin; every Remote method is served
   * from the services this one injects.
   */
  constructor(ctx: Context) {
    // The literal, not {@link WEB_TEST_COMMANDS_NAMESPACE}: the Typert analyzer
    // reads the gateway service key from the syntax tree and rejects anything
    // but a string literal there. The two must name the same service.
    super(ctx, 'webTestCommands')
    ctx.effect(() => () => { this.active = false }, 'webTestCommands.lifetime')
    registerCommandTools(ctx, this)
  }

  /**
   * The closed command set, with each verb's availability in this stage and the
   * subjects a status query may name. It needs no Session, so a card renders the
   * set before one is selected.
   * @returns the catalogue, from the same table both callers read.
   */
  @Remote
  describeCommands(): CommandCatalogue {
    this.requireActive()
    return describeCommands()
  }

  /**
   * List identities the user may explicitly select without exposing project material.
   * @returns published identities and revisions only.
   */
  @Remote
  listProjects(): ProjectSummary[] {
    this.requireActive()
    return this.ctx.webTestRuntime.listProjects().map(({ projectId, revision }) => ({ projectId, revision }))
  }

  /**
   * Attach an explicitly selected project to a live conversation.
   * @param request - selected Session and project.
   * @returns the selected project's metadata.
   */
  @Remote
  async attachProject(request: AttachProjectRequest): Promise<ProjectMetadata> {
    this.requireSession(request.sessionId)
    await this.ctx.webTestRuntime.saveSessionProject(request.sessionId, request.projectId)
    this.requireSession(request.sessionId)
    if (this.ctx.webTestRuntime.readSessionProject(request.sessionId) !== request.projectId) {
      throw new WebTestConversationError('web-test-conversation/context-changed', 'the conversation selected another project while attachment was being saved')
    }
    return this.ctx.webTestConversation.attach(request.sessionId, request.projectId)
  }

  /**
   * Register user metadata through the authoritative runtime and attach its project.
   * @param request - live Session and explicit registration fields.
   * @returns the published metadata, including unusable or absent material.
   */
  @Remote
  async registerProject(request: ConversationRegistrationRequest): Promise<ProjectMetadata> {
    this.requireSession(request.sessionId)
    const receipt = await this.ctx.webTestRuntime.registerProject(request.registration)
    this.requireSession(request.sessionId)
    return this.attachProject({ sessionId: request.sessionId, projectId: brandString<ProjectId>(receipt.resourceId) })
  }

  /**
   * Atomically correct the attached project's roots and URLs without creating another project.
   * Older declarations, observations and permissions retain their earlier revision.
   * This performs no URL request and grants no environment confirmation.
   * @param request - live conversation, displayed project identity and revision, and replacement metadata.
   * @param signal - optional caller cancellation; checked before staging and publication.
   * @returns the committed metadata with the same identity and its new revision.
   * @throws {WebTestConversationError} when the conversation changed its selected project.
   */
  @Remote
  async updateProject(request: ConversationProjectUpdateRequest, signal?: AbortSignal): Promise<ProjectMetadata> {
    const assertCurrent = (): void => {
      signal?.throwIfAborted()
      this.requireSession(request.sessionId)
      const current = this.requireContext(request.sessionId, 'attach a project before correcting its metadata')
      if (current.projectId !== request.projectId) {
        throw new WebTestConversationError('web-test-conversation/context-changed', 'the conversation selected another project; refresh before correcting its metadata')
      }
    }
    assertCurrent()
    const metadata = parseRegisterProjectRequest({
      commandId: request.commandId, codeRoots: request.codeRoots, entryUrls: request.entryUrls,
    })
    const prepared = this.ctx.webTestRuntime.prepareProjectUpdate(request.projectId)
    try {
      await this.ctx.webTestRuntime.commitProjectUpdate({
        commandId: request.commandId, recordId: prepared.recordId, expectedRevision: request.expectedRevision,
      }, { ...prepared, expectedRevision: request.expectedRevision }, {
        codeRoots: metadata.codeRoots, entryUrls: metadata.entryUrls,
      }, { sessionId: request.sessionId, projectId: request.projectId, assertCurrent })
    } catch (error: unknown) {
      if (error instanceof WebTestRuntimeError && error.code === 'web-test/record-mismatch') {
        throw new WebTestConversationError('web-test-conversation/context-changed', 'the conversation selected another project; refresh before correcting its metadata')
      }
      throw error
    }
    this.requireSession(request.sessionId)
    const after = this.requireContext(request.sessionId, 'attach a project before correcting its metadata')
    if (after.projectId !== request.projectId) {
      throw new WebTestConversationError('web-test-conversation/context-changed', 'the conversation selected another project while its correction was saved')
    }
    return after.material.project
  }

  /**
   * Explicitly check and save reachable HTTP responses for this conversation's registered URLs.
   * Registration and status queries never perform this request. This grants no test permission.
   * @param request - live conversation and displayed project identity and revision; no URL may be supplied.
   * @param signal - optional caller cancellation; remaining URLs are saved as cancelled.
   * @returns the saved observation, with HTTP status and its checked revision.
   * @throws {WebTestConversationError} when the conversation changes its selected project while checking.
   */
  @Remote
  async probeEntryUrls(request: ConversationEntryUrlProbeRequest, signal?: AbortSignal): Promise<StoredEntryUrlProbe> {
    this.requireSession(request.sessionId)
    const context = this.requireContext(request.sessionId, 'attach a project before checking its entry URLs')
    if (context.projectId !== request.projectId) {
      throw new WebTestConversationError('web-test-conversation/context-changed', 'the conversation selected another project; refresh before checking its entry URLs')
    }
    const result = await this.ctx.webTestRuntime.probeEntryUrls(context.projectId, request.expectedRevision, signal)
    this.requireSession(request.sessionId)
    const current = this.requireContext(request.sessionId, 'attach a project before checking its entry URLs')
    if (current.projectId !== context.projectId || current.revision !== context.revision) {
      throw new WebTestConversationError('web-test-conversation/context-changed', 'the conversation selected another project or revision while its entry URLs were checked')
    }
    return result
  }

  /**
   * Confirm explicit environment facts through the policy for this Session's project.
   * @param request - live Session and user declaration; no other project can be named.
   * @returns current status after the policy accepted the declaration.
   */
  @Remote
  async declareEnvironment(request: ConversationDeclarationRequest): Promise<StatusReport> {
    this.requireSession(request.sessionId)
    const context = this.requireContext(request.sessionId, 'attach a project before declaring its environment')
    const declaration = parseEnvironmentDeclaration(request.declaration, 'declaration')
    await this.ctx.webTestRuntime.saveEnvironment(context.projectId, declaration, context.revision)
    this.requireSession(request.sessionId)
    const current = this.requireContext(request.sessionId, 'attach a project before declaring its environment')
    if (current.projectId !== context.projectId || current.revision !== context.revision) {
      throw new WebTestConversationError('web-test-conversation/context-changed', 'the project changed while its environment facts were being saved; confirm its current facts again')
    }
    this.ctx.webTestConversation.declareEnvironment(request.sessionId, { commandId: request.commandId, declaration: request.declaration })
    return this.queryStatus({ sessionId: request.sessionId, verb: 'query', subject: 'environment' })
  }

  /**
   * Answer one status question about the Session's own project.
   *
   * This method reads. It publishes nothing, commits nothing, and returns no run
   * identity or receipt, so there is no value in its answer a caller could hand
   * to {@link submitAction}: the two requests do not share a type.
   * @param request - the Session asking and the subject it reads.
   * @returns the project's published record, the facts this host finds, and the
   * command set.
   * @throws {WebTestConversationError} `unknown-command` when the request is not
   * a web testing command, `verb-mismatch` when it names a mutating verb, and
   * `incomplete-query` when the subject is absent or outside the closed set.
   */
  @Remote
  queryStatus(request: StatusQueryRequest): StatusReport {
    this.requireActive()
    const resolution = resolveCommand({ ...request })
    if (resolution.kind === 'incomplete') {
      if (resolution.verb === 'query') {
        throw new WebTestConversationError(
          'web-test-conversation/incomplete-query',
          `a status question names the subject it reads; this one named ${JSON.stringify(request['subject'])}`,
        )
      }
      throw new WebTestConversationError(
        'web-test-conversation/verb-mismatch',
        `queryStatus answers a status question and nothing else; ${JSON.stringify(resolution.verb)} is decided by submitAction`,
      )
    }
    if (resolution.command.verb !== 'query') {
      throw new WebTestConversationError(
        'web-test-conversation/verb-mismatch',
        `queryStatus answers a status question and nothing else; "${resolution.command.verb}" is decided by submitAction`,
      )
    }
    const context = this.requireContext(resolution.sessionId, 'it has no status to read; attach a project to it first')
    const saved = this.ctx.webTestRuntime.readEnvironment(context.projectId)
    return {
      project: context.material.project,
      environmentConfirmed: context.environmentConfirmed,
      environmentDeclaration: saved?.declaration ?? null,
      environmentDeclarationRevision: saved?.revision ?? null,
      entryUrlProbe: this.ctx.webTestRuntime.readEntryUrlProbe(context.projectId) ?? null,
      material: context.material,
      commands: describeCommands().commands,
    }
  }

  /**
   * Decide one mutating ask.
   *
   * The order of the refusals is the point: a Session attached to no project is
   * refused before anything is read about a project, an ask that named too little
   * is answered with the specific fields it owes, and an answer given against a
   * project revision that has since moved is refused as stale rather than
   * performed. Only then is a verb this stage does not implement answered
   * `unavailable`, with the domain that would have to exist.
   * @param request - the Session asking, the mutating verb, its target, and the
   * project revision the answer was given against.
   * @returns the clarification, the staleness refusal, or the unavailability, and
   * never a report that an action was performed.
   * @throws {WebTestConversationError} `unknown-command` when the request is not
   * a web testing command, `verb-mismatch` when it names the query verb, and
   * `no-project` when the Session it names is attached to no project.
   */
  @Remote
  submitAction(request: ActionRequest): ActionOutcome {
    this.requireActive()
    const resolution = resolveCommand({ ...request })
    if (resolution.kind === 'incomplete') {
      if (!isMutatingCommandVerb(resolution.verb)) {
        throw new WebTestConversationError(
          'web-test-conversation/verb-mismatch',
          `submitAction decides a command that changes something and nothing else; ${JSON.stringify(resolution.verb)} only reads`,
        )
      }
      const context = this.requireContext(resolution.sessionId, 'no command can act for it; attach a project to it first')
      return { kind: 'clarification', clarification: incompleteAsk(resolution.verb, resolution.missing, context.projectId) }
    }
    if (resolution.command.verb === 'query') {
      throw new WebTestConversationError(
        'web-test-conversation/verb-mismatch',
        'submitAction decides a command that changes something and nothing else; "query" only reads',
      )
    }
    const { verb, expectedRevision } = resolution.command
    const context = this.requireContext(resolution.sessionId, 'no command can act for it; attach a project to it first')
    if (expectedRevision !== context.revision) {
      return {
        kind: 'stale',
        verb,
        reason: `the answer was given against project revision ${String(expectedRevision)} and the project is published at revision ${String(context.revision)}; confirm the current state before this command acts`,
      }
    }
    if (!context.environmentConfirmed) {
      return { kind: 'clarification', clarification: undeclaredEnvironment(verb, context.projectId) }
    }
    return unavailableAction(verb)
  }

  /** Refuse references retained after the owning plugin unloaded. */
  private requireActive(): void {
    if (!this.active) throw new WebTestConversationError('web-test-conversation/disposed', 'the command service has unloaded')
  }

  /**
   * Ensure project writes belong to a live official conversation.
   * @param sessionId - requested conversation identity.
   */
  private requireSession(sessionId: SessionId): void {
    this.requireActive()
    if (!this.ctx.agents.roots().some(agent => agent.session.id === sessionId)) {
      throw new WebTestConversationError('web-test-conversation/unknown-session', 'project input requires a live root conversation')
    }
  }

  /**
   * The context of the Session an ask names, or a refusal naming nothing else.
   *
   * The refusal names the Session and says it has no project; it carries no other
   * project's identity, code root, or entry URL, so a failed ask cannot be used
   * to discover a project the asker was never attached to.
   * @param sessionId - the Session the ask named.
   * @param remedy - what the asker has to do before the ask can be answered.
   * @returns the attached context.
   * @throws {WebTestConversationError} `no-project` when the Session is attached to nothing.
   */
  private requireContext(sessionId: string, remedy: string): AttachedContext {
    const context = this.ctx.webTestConversation.context(sessionId)
    if (context.kind === 'ordinary') {
      throw new WebTestConversationError(
        'web-test-conversation/no-project',
        `session "${sessionId}" is attached to no project, so ${remedy}`,
      )
    }
    return context
  }
}

export default WebTestCommands
