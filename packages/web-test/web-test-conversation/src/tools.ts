/**
 * Model tools and pure presenters for the shared conversation command Remote.
 * Session identity comes exclusively from the executing Agent.
 * @module @deepseek-ai/dsh-web-test-conversation/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { ProjectId, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext, ToolCallView } from '@deepseek-ai/dsh-tools'
import type { WebTestCommands } from './commands.ts'
import { MUTATING_COMMANDS, STATUS_SUBJECTS } from './command.ts'
import { WebTestConversationError } from './errors.ts'

/**
 * Resolve the calling conversation without accepting an identity from model input.
 * @param exec - tool registry execution identity.
 * @returns the calling Session.
 */
function sessionOf(exec: ToolRunContext): SessionId {
  return agentOf(exec).session.id
}

/** Resolve and validate the live calling Agent before asking or writing. */
function agentOf(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new WebTestConversationError('web-test-conversation/unknown-session', 'this command requires a conversation Agent')
  exec.signal.throwIfAborted()
  return exec.agent
}

/**
 * Render pending input without reading live state.
 * @param title - command description.
 * @param rawInput - validated tool arguments.
 * @returns generic card intent persisted by the official tool pipeline.
 */
function pending(title: string, rawInput: unknown): ToolCallView {
  return { card: 'generic', kind: 'other', title, rawInput }
}

/** Model and replay rendering of the shared Remote's JSON result. */
const OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string): { type: 'text'; text: string }[] => [{ type: 'text', text: value }],
  presentationMeta: (_args: unknown, value: string) => ({ webTestResult: value }),
} as const

/**
 * Register natural-language tools whose bodies invoke the same methods cards use.
 * All registrations are owned by the Commands plugin's effects.
 * @param ctx - Commands plugin context providing the official tool registry.
 * @param commands - the single command Remote instance.
 */
export function registerCommandTools(ctx: Context, commands: WebTestCommands): void {
  const register = (release: () => void): void => { ctx.effect(() => release, 'webTestCommands.tool') }
  register(ctx.tools.register(defineTool({
    name: 'web_test_update_project',
    description: 'Correct the user-provided code roots and already-started entry URLs of this conversation’s attached project. Retains the project identity and atomically publishes a new revision; old environment confirmation and observations no longer describe its current revision. Supply the project identity and revision you read and a new cmd- token. This does not check URLs, start servers, deploy, or confirm the environment.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Project identity from the status whose metadata the user is correcting.' },
      commandId: { type: 'string', required: true },
      expectedRevision: { type: 'integer', required: true },
      codeRoots: { type: 'array', items: { type: 'string' }, required: true },
      entryUrls: { type: 'array', items: { type: 'string' }, required: true },
    },
    output: OUTPUT,
    async execute(args, exec) {
      return JSON.stringify(await commands.updateProject({
        ...args, sessionId: sessionOf(exec), projectId: brandString<ProjectId>(args.projectId),
        expectedRevision: brandNumber<Revision>(args.expectedRevision),
      }, exec.signal))
    },
    presentCall: args => pending('Correct web testing project metadata', args),
  })))
  register(ctx.tools.register(defineTool({
    name: 'web_test_query',
    description: 'Read web testing status for this conversation only. projects lists selectable identities without private material. Other subjects require this conversation to have an attached project. This never generates cases or starts a test.',
    parameters: { subject: { type: 'string', enum: ['projects', ...STATUS_SUBJECTS], required: true } },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    execute(args, exec) {
      const sessionId = sessionOf(exec)
      return Promise.resolve(JSON.stringify(args.subject === 'projects'
        ? commands.listProjects()
        : commands.queryStatus({ sessionId, verb: 'query', subject: args.subject })))
    },
    presentCall: args => pending('Read web testing status', args),
  })))
  register(ctx.tools.register(defineTool({
    name: 'web_test_register_project',
    description: 'Register the user-provided code roots and already-started entry URLs, then attach the resulting project to this conversation. Registration does not check URL reachability: explicitly call web_test_probe_entry_urls next. Preserve absent material; do not install dependencies, launch servers, or deploy the tested project. Ask the user for missing metadata rather than infer it.',
    parameters: {
      commandId: { type: 'string', required: true, description: 'Idempotency token starting cmd-; reuse it only for the same registration.' },
      codeRoots: { type: 'array', items: { type: 'string' }, required: true },
      entryUrls: { type: 'array', items: { type: 'string' }, required: true },
    },
    output: OUTPUT,
    async execute(args, exec) {
      return JSON.stringify(await commands.registerProject({ sessionId: sessionOf(exec), registration: args }))
    },
    presentCall: args => pending('Register a web testing project', args),
  })))
  register(ctx.tools.register(defineTool({
    name: 'web_test_probe_entry_urls',
    description: 'Explicitly check the already-started entry URLs registered by this conversation’s attached project. Sends bounded HEAD requests without credentials, cookies, redirects, or response bodies. Any HTTP status is reachable and recorded separately, including 4xx and redirects. Saves timeout, unavailable, invalid, and cancelled targets too. This does not confirm an environment or start tests. Query status to read the saved check without network requests.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Project identity whose registered URLs the user selected.' },
      expectedRevision: { type: 'integer', required: true, description: 'Current project metadata revision whose registered URLs should be checked.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      return JSON.stringify(await commands.probeEntryUrls({
        sessionId: sessionOf(exec), projectId: brandString<ProjectId>(args.projectId),
        expectedRevision: brandNumber<Revision>(args.expectedRevision),
      }, exec.signal))
    },
    presentCall: args => pending('Check registered entry URLs', args),
  })))
  register(ctx.tools.register(defineTool({
    name: 'web_test_attach',
    description: 'Attach the project the user explicitly selected to this conversation. This resets environment confirmation; it does not start tests or confirm an environment.',
    parameters: { projectId: { type: 'string', required: true } },
    output: OUTPUT,
    async execute(args, exec) {
      return JSON.stringify(await commands.attachProject({ sessionId: sessionOf(exec), projectId: brandString<ProjectId>(args.projectId) }))
    },
    presentCall: args => pending('Attach a web testing project', args),
  })))
  register(ctx.tools.register(defineTool({
    name: 'web_test_declare_environment',
    description: 'Record the environment facts explicitly stated by the user for this conversation’s attached project. Do not infer test-environment or login facts. The policy validates the declaration; this does not grant permission to start tests.',
    parameters: {
      commandId: { type: 'string', required: true },
      declaration: {
        type: 'object', required: true, additionalProperties: false,
        properties: {
          codeRoots: { type: 'array', items: { type: 'string' }, required: true },
          entryUrl: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          isTestEnvironment: { type: 'boolean', required: true },
          login: {
            oneOf: [
              { type: 'object', additionalProperties: false, properties: { state: { type: 'string', enum: ['not-required'], required: true } } },
              { type: 'object', additionalProperties: false, properties: { state: { type: 'string', enum: ['required'], required: true }, accountLabel: { type: 'string', required: true } } },
            ], required: true,
          },
          supplementaryRequirements: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const agent = agentOf(exec)
      const sessionId = agent.session.id
      const before = commands.queryStatus({ sessionId, verb: 'query', subject: 'environment' })
      const questions = [{
        id: 'web-test-environment',
        question: `Confirm these environment facts for project ${before.project.projectId} at revision ${before.project.revision}: ${JSON.stringify(args.declaration)}`,
        options: [{ label: 'Confirm' }, { label: 'Decline' }],
      }]
      const mode = ctx.webTestConversation.askUserRegistration
      const answer = mode.mode === 'timed'
        ? await ctx.userQuestions.askTimed({ questions, agent, signal: exec.signal }, exec.callId, mode.timeout * 1000)
        : await ctx.userQuestions.ask({ questions, agent, signal: exec.signal })
      exec.signal.throwIfAborted()
      if ('pending' in answer) return JSON.stringify({ kind: 'pending', callId: answer.callId, message: 'No environment is confirmed. Submit the declaration again to request a new confirmation.' })
      const approved = answer.answers.length === 1 && answer.answers[0]?.id === 'web-test-environment'
        && answer.answers[0].selected.length === 1 && answer.answers[0].selected[0] === 'Confirm'
        && answer.answers[0].custom === undefined
      if (!approved) return JSON.stringify({ kind: 'declined', message: 'No environment is confirmed.' })
      const now = commands.queryStatus({ sessionId, verb: 'query', subject: 'environment' })
      if (now.project.projectId !== before.project.projectId || now.project.revision !== before.project.revision
        || now.environmentConfirmed !== before.environmentConfirmed
        || now.environmentDeclarationRevision !== before.environmentDeclarationRevision
        || JSON.stringify(now.environmentDeclaration) !== JSON.stringify(before.environmentDeclaration)) {
        return JSON.stringify({ kind: 'stale', message: 'The project changed while confirmation was pending. Confirm the current facts again.' })
      }
      return JSON.stringify(await commands.declareEnvironment({ sessionId, ...args }))
    },
    presentCall: args => pending('Declare a web testing environment', args),
  })))
  register(ctx.tools.register(defineTool({
    name: 'web_test_action',
    description: 'Resolve a user request to generate cases, start, pause, resume, or cancel. These business actions are unavailable in this stage and are never executed or queued. Missing target or revision produces specific clarification; an old revision is refused.',
    parameters: {
      verb: { type: 'string', enum: MUTATING_COMMANDS, required: true },
      target: { type: 'string' }, requirement: { type: 'string' }, expectedRevision: { type: 'integer' },
    },
    output: OUTPUT,
    execute(args, exec) {
      return Promise.resolve(JSON.stringify(commands.submitAction({
        sessionId: sessionOf(exec), verb: args.verb,
        ...(args.target === undefined ? {} : { target: args.target }),
        ...(args.requirement === undefined ? {} : { requirement: args.requirement }),
        ...(args.expectedRevision === undefined ? {} : { expectedRevision: brandNumber<Revision>(args.expectedRevision) }),
      })))
    },
    presentCall: args => pending('Resolve a web testing action request', args),
  })))
}
