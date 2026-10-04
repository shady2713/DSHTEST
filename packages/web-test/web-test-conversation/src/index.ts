/**
 * The Web testing conversation entry (`ctx.webTestConversation`): the seam that
 * makes the ordinary DSH conversation able to act on a tested project, without
 * becoming a second agent.
 *
 * **The official conversation, not a new one.** Every official top-level
 * conversation agent gets one scoped mask, installed on `agent/created` and
 * released on `agent/disposed`; an owned child agent inherits its parent's mask
 * and is not given a second one. The tools themselves belong to the base bundle
 * and to the web testing policy — this package decides which of them a
 * conversation is offered, and nothing else.
 *
 * **The gate is visibility, the policy is enforcement.** A session with no
 * attached project sees none of the governed tools, and a session whose
 * environment the policy has not confirmed sees none of them either. Once both
 * hold, the tools this stage acts through appear and the rest stay absent. Every
 * call, admitted or not, is still decided by `WebTestPolicy` at the registry's
 * guard stage, so an unmasked tool is never a permitted one.
 *
 * **The association is this entry's own fact.** Attaching a session to a
 * project and confirming that project's environment are what the gate reads, and
 * the policy holds the consequences: `bindEntry` establishes which project a
 * decision applies to, and `declareEnvironment` records the declaration every
 * authorization is expressed against. A session with no association is denied
 * the governed set outright rather than falling back to whichever project happens
 * to be declared, so one conversation can never reach another's context.
 *
 * **The context is read per session, per call.** `context()` is the one source
 * the command Remote resolves every ask against, and it looks up the Session it
 * was handed: an unattached session reads `ordinary` and reaches nothing. What
 * this entry owns is the typed command layer and the one Remote both a card and a
 * conversation address (`./commands.ts`); the two are one implementation, not two
 * paths.
 *
 * @module @deepseek-ai/dsh-web-test-conversation
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { inspectProjectMetadata } from '@deepseek-ai/dsh-web-test-runtime'
import type { ProjectId, ProjectMetadata, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import type { DeclaredEnvironment } from '@deepseek-ai/dsh-web-test-policy'
import { registerAskUser, resolveAskUserMode } from './ask-user.ts'
import type { AskUserMode, AskUserRegistration } from './ask-user.ts'
import { attachedContext } from './context.ts'
import type { ConversationContext } from './context.ts'
import { WebTestConversationError } from './errors.ts'
import { ConversationToolGate, deniedToolNames, governedToolNames } from './gate.ts'
// These imports are what bring the `ctx.webTestPolicy` and `ctx.webTestRuntime`
// augmentations into the program this entry is written against.
import type {} from '@deepseek-ai/dsh-web-test-policy'
import type {} from '@deepseek-ai/dsh-web-test-runtime'

export { registerAskUser, resolveAskUserMode } from './ask-user.ts'
export type { AskUserMode, AskUserRegistration, AskUserSelection } from './ask-user.ts'
export {
  commandAvailability,
  describeCommands,
  incompleteAsk,
  isCommandVerb,
  isMutatingCommandVerb,
  isStatusSubject,
  MUTATING_COMMANDS,
  requiredFields,
  resolveCommand,
  STATUS_SUBJECTS,
  unavailableAction,
  undeclaredEnvironment,
  WEB_TEST_COMMANDS,
} from './command.ts'
export type {
  ActionOutcome,
  ActionRequest,
  ClarificationCause,
  ClarificationRequest,
  CommandAvailability,
  CommandCatalogue,
  CommandField,
  CommandResolution,
  CommandVerb,
  MutatingCommandVerb,
  ResolvedCommand,
  StatusReport,
  StatusQueryRequest,
  StatusSubject,
} from './command.ts'
export { attachedContext } from './context.ts'
export type { ConversationContext, SessionAssociation } from './context.ts'
export { WebTestCommands, WEB_TEST_COMMANDS_NAMESPACE } from './commands.ts'
export type { AttachProjectRequest, ConversationRegistrationRequest, ConversationProjectUpdateRequest, ConversationDeclarationRequest, ProjectSummary } from './commands.ts'
export { WebTestConversationError } from './errors.ts'
export type { WebTestConversationErrorCode } from './errors.ts'
export {
  CONVERSATION_CAPABILITY_TOOLS,
  ConversationToolGate,
  deniedToolNames,
  governedToolNames,
  unimplementedToolNames,
} from './gate.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTestConversation: WebTestConversation
  }
}

/**
 * Plugin config. The question-tool row is the only deployment choice here, and
 * every other value follows from the services this entry already consumes.
 */
export interface Config {
  /** Which `ask_user_question` definition to register; an omitted mode is the blocking one. */
  askUserMode?: AskUserMode
  /** Foreground wait a `timed` row holds for, in whole seconds; refused by `legacy`. */
  askUserTimeoutSeconds?: number
}

/**
 * Schemastery validator for {@link Config}. Neither field carries a default
 * here: an omitted mode and an omitted wait are the two facts
 * `resolveAskUserMode` reasons about, and a default applied by the schema would
 * be a second home for the same rule. The combinations a schema cannot express
 * are refused by `resolveAskUserMode` in the constructor, which is still load
 * time.
 */
export const Config: z<Partial<Config>, Config> = z.object({
  askUserMode: z.union(['legacy', 'timed']),
  askUserTimeoutSeconds: z.union([-1, z.number().step(1).min(1).max(2_147_483)]),
})

/** What one session's attachment to a project amounts to for the gate. */
interface ProjectAssociation {
  /** Project the session is testing; the only one its decisions apply to. */
  readonly projectId: ProjectId
  /** Withdraws the policy binding; called when the session moves to another project. */
  readonly unbind: () => void
  /** Project revision whose environment the user confirmed in this process. */
  declaredRevision: Revision | null
}

/**
 * The conversation entry. One instance per application; the gates it owns are
 * per agent and live exactly as long as the agents do.
 */
export class WebTestConversation extends Service {
  static inject = ['agents', 'tools', 'userQuestions', 'webTestPolicy', 'webTestRuntime']

  static Config: z<Partial<Config>, Config> = Config

  private readonly askUser: AskUserRegistration

  private readonly associations = new Map<string, ProjectAssociation>()

  private readonly gates = new Map<Agent, ConversationToolGate>()

  private readonly owned = new Map<Agent, () => Promise<void>>()

  /**
   * @param ctx - Context of the Conversation plugin; the question tool, the
   * agent listeners, and every agent's mask attach here.
   * @param config - Validated plugin config naming the question-tool row.
   * @throws {WebTestConversationError} when the question-tool row names a mode
   * and a wait that cannot both be honoured, so a misconfigured composition fails
   * at load rather than registering a row other than the one it asked for.
   */
  constructor(ctx: Context, public config: Config) {
    super(ctx, 'webTestConversation')
    this.askUser = resolveAskUserMode({
      ...config.askUserMode !== undefined ? { mode: config.askUserMode } : {},
      ...config.askUserTimeoutSeconds !== undefined ? { timeout: config.askUserTimeoutSeconds } : {},
    })
    registerAskUser(ctx, this.askUser)
    ctx.on('agent/created', ({ agent }) => { this.attachAgent(agent) })
    ctx.on('agent/disposed', ({ agent }) => { this.detachAgent(agent) })
    ctx.on('web-test/project-published', () => { this.refreshAll() })
  }

  /** The question-tool row this entry registered, as the mode it resolved to. */
  get askUserRegistration(): AskUserRegistration {
    return this.askUser
  }

  /**
   * Attach one session to the project it is about to test, and open the tools
   * that attachment permits.
   *
   * The project must already be published: a name with no published entry is
   * refused rather than attached to, so a conversation is never associated with
   * a project that does not exist.
   *
   * Attaching the project a session already has refreshes that attachment
   * instead of moving it, and leaves the live binding alone: the ledger's
   * disposer withdraws a binding by project value, so retiring the lease this
   * call is standing on would withdraw the binding itself. Attaching another
   * project withdraws the previous binding before the new one is taken, so a
   * session holds exactly one lease and no stale authorization survives the
   * move. Either way the confirmation is dropped, and the tools reopen only once
   * the environment is confirmed again.
   * @param sessionId - the session whose conversation is being attached.
   * @param projectId - the project that conversation is about to test.
   * @returns the published metadata the attachment is made against.
   * @throws {WebTestConversationError} `unpublished-project` when the head
   * publishes no entry for the project.
   */
  attach(sessionId: string, projectId: ProjectId): ProjectMetadata {
    const project = this.ctx.webTestRuntime.readProject(projectId)
    if (project === undefined) {
      throw new WebTestConversationError(
        'web-test-conversation/unpublished-project',
        `project '${projectId}' has no published entry, so session "${sessionId}" cannot be attached to it`,
      )
    }
    const previous = this.associations.get(sessionId)
    if (previous?.projectId === projectId) {
      previous.declaredRevision = null
      this.refreshAll()
      return project
    }
    previous?.unbind()
    this.associations.set(sessionId, {
      projectId,
      unbind: this.ctx.webTestPolicy.bindEntry(sessionId, projectId),
      declaredRevision: null,
    })
    this.refreshAll()
    return project
  }

  /**
   * Record the environment one attached session confirmed, and open the tools
   * that confirmation permits.
   *
   * The declaration is the policy's own: this entry passes the request to
   * `WebTestPolicy.declareEnvironment`, which validates every field with the
   * contract parser and resolves the code root canonically. The project the
   * request names must be the one the session is attached to, because the policy
   * declares per project and would otherwise let a conversation confirm an
   * environment belonging to a project it is not testing.
   * @param sessionId - the session whose conversation confirmed the environment.
   * @param request - the confirmation request; `projectId` is filled in from the
   * attachment when the caller names none.
   * @returns the declared environment as the policy resolved it.
   * @throws {WebTestConversationError} `unassociated-session` when the session
   * has no project, `project-mismatch` when the request names another one, and
   * any `web-test-policy/*` or `web-test/*` failure the policy raises.
   */
  declareEnvironment(sessionId: string, request: Record<string, unknown>): DeclaredEnvironment {
    const association = this.associations.get(sessionId)
    if (association === undefined) {
      throw new WebTestConversationError(
        'web-test-conversation/unassociated-session',
        `session "${sessionId}" is not attached to a project, so there is no environment to declare; attach the project first`,
      )
    }
    const requested = request['projectId']
    if (requested !== undefined && requested !== association.projectId) {
      throw new WebTestConversationError(
        'web-test-conversation/project-mismatch',
        `session "${sessionId}" is attached to project '${association.projectId}' and cannot declare an environment for ${JSON.stringify(requested)}`,
      )
    }
    const declared = this.ctx.webTestPolicy.declareEnvironment({ ...request, projectId: association.projectId })
    association.declaredRevision = declared.projectRevision
    this.refreshAll()
    return declared
  }

  /**
   * Read what one session's conversation may act on right now.
   *
   * This is the context the command Remote resolves every ask against, and the
   * only source it has: a session with no project of its own reads as
   * `ordinary` and reaches no project, because this method looks up one Session
   * id and has no second lookup to fall back to. The project record is read live
   * rather than remembered from the attachment, so its revision is the one an
   * action is compared against and a project that moved since the user answered
   * is visible here.
   * @param sessionId - the session whose context is being read.
   * @returns the attached context, or `ordinary` for a session attached to nothing.
   * @throws {WebTestConversationError} `unpublished-project` when the project this
   * session is attached to has no published entry, which is the same fact
   * {@link attach} refuses to establish.
   */
  context(sessionId: string): ConversationContext {
    const association = this.associations.get(sessionId)
    if (association === undefined) return { kind: 'ordinary' }
    const project = this.publishedProject(sessionId, association)
    return attachedContext(
      { projectId: association.projectId, declaredRevision: association.declaredRevision },
      project,
      inspectProjectMetadata(project),
    )
  }

  /** Read the published record an existing association names. */
  private publishedProject(sessionId: string, association: ProjectAssociation): ProjectMetadata {
    const project = this.ctx.webTestRuntime.readProject(association.projectId)
    /* v8 ignore next 2 -- the catalog publishes an entry for the life of its data root and no operation withdraws one */
    if (project === undefined) {
      throw new WebTestConversationError(
        'web-test-conversation/unpublished-project',
        `project '${association.projectId}' has no published entry, so session "${sessionId}" has no context to read`,
      )
    }
    return project
  }

  /**
   * Give one agent its mask, when it is an official top-level conversation.
   *
   * An owned child agent inherits its owner's mask through the scope chain, and
   * the registry announces one lifecycle edge per agent, so an agent that is
   * already in the registry is not given a second mask.
   * @param agent - the agent the registry just announced.
   */
  private attachAgent(agent: Agent): void {
    if (!this.ctx.agents.roots().includes(agent)) return
    const projectId = this.ctx.webTestRuntime.readSessionProject(agent.session.id)
    if (projectId !== undefined) this.attach(agent.session.id, projectId)
    const gate = new ConversationToolGate(this.ctx, agent)
    this.gates.set(agent, gate)
    // The plugin-scope effect is what tears the agent-scope mask down when this
    // plugin unloads, so the mask must be released when the Agent is too.
    this.owned.set(agent, this.ctx.effect(() => () => { gate.dispose() }, 'webTestConversation.agentGate'))
    this.refreshGate(agent, gate)
  }

  /**
   * Release one agent's mask.
   *
   * `agent/disposed` declares a void listener, so the disposer promise is not
   * returned; releasing a synchronous mask settles before the dispatch continues.
   * @param agent - the agent the registry just released.
   */
  private detachAgent(agent: Agent): void {
    const release = this.owned.get(agent)
    if (release === undefined) return
    this.owned.delete(agent)
    this.gates.delete(agent)
    void release()
  }

  /**
   * Restate one agent's mask from what its own session is currently permitted.
   * @param agent - the conversation agent whose mask is restated.
   * @param gate - the mask that agent carries.
   */
  private refreshGate(agent: Agent, gate: ConversationToolGate): void {
    const association = this.associations.get(agent.session.id)
    const permitted = association !== undefined && association.declaredRevision !== null
      && association.declaredRevision === this.publishedProject(agent.session.id, association).revision
    gate.refresh(deniedToolNames(governedToolNames(this.ctx), permitted))
  }

  /** Restate every attached conversation's mask, as one session's state moved. */
  private refreshAll(): void {
    for (const [agent, gate] of this.gates) this.refreshGate(agent, gate)
  }
}

export default WebTestConversation
