/**
 * The typed commands one web testing card and one web testing conversation both
 * address, and the explicit step that resolves a raw ask into one of them.
 *
 * **Six verbs, five of which this stage refuses to perform.** `query` reads;
 * `generate-case`, `start`, `pause`, `resume`, and `cancel` would change
 * business state that has no domain in this stage. They are declared here rather
 * than left out, so a card and a model are both told the same closed set and both
 * read the same "unavailable, and here is why" for the five: an ask this stage
 * cannot perform is answered, not queued and not silently dropped.
 *
 * **Resolution is a step with a result type, not a default inside a run.** Every
 * field a verb needs is declared in {@link MUTATING_FIELDS} or
 * {@link QUERY_FIELD}, and {@link resolveCommand} answers with either a resolved
 * command or the fields the ask left out. A caller therefore has to handle the
 * incomplete ask, because the type it receives has no member that hides it.
 *
 * **A query carries nothing a mutating command needs.** {@link ResolvedCommand} is
 * a closed union: its query member has no target and no expected revision, and
 * every mutating member is reachable only through {@link MutatingCommandVerb}. A
 * value produced for a query is not assignable where a mutating command is
 * required, so a typed caller cannot build an action out of a status question; the
 * wire path refuses the same confusion explicitly, because a request arriving
 * from a card is not typed.
 *
 * @module @deepseek-ai/dsh-web-test-conversation/command
 */

import { brandNumber } from '@deepseek-ai/dsh-brand'
import type { ProjectId, ProjectMetadata, Revision, EnvironmentDeclaration } from '@deepseek-ai/dsh-web-test-contracts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectInspection, StoredEntryUrlProbe } from '@deepseek-ai/dsh-web-test-runtime/types'
import { WebTestConversationError } from './errors.ts'

/** Every verb the web testing command layer names, as a closed set. */
export const WEB_TEST_COMMANDS = [
  'query',
  'generate-case',
  'start',
  'pause',
  'resume',
  'cancel',
] as const

/** One of the six named verbs. */
export type CommandVerb = (typeof WEB_TEST_COMMANDS)[number]

/** The verbs that would change business state, as a closed set. */
export const MUTATING_COMMANDS = ['generate-case', 'start', 'pause', 'resume', 'cancel'] as const

/** One of the five verbs that would change business state. */
export type MutatingCommandVerb = (typeof MUTATING_COMMANDS)[number]

/** What a status query may ask to read, as a closed set. */
export const STATUS_SUBJECTS = ['project', 'environment', 'commands', 'material'] as const

/** One of the four things a status query may read about. */
export type StatusSubject = (typeof STATUS_SUBJECTS)[number]

/** Read-only request accepted by the command Remote; no action verb is assignable. */
export type StatusQueryRequest = {
  /** Session whose attached project is read. */
  readonly sessionId: SessionId
  /** Only the read operation is accepted. */
  readonly verb: 'query'
  /** Missing subjects produce a clarification error. */
  readonly subject?: StatusSubject
}

/** Mutating request accepted by the action Remote; queries are not assignable. */
export type ActionRequest = {
  /** Session whose attached project the ask concerns. */
  readonly sessionId: SessionId
  /** Requested business operation. */
  readonly verb: MutatingCommandVerb
  /** Run or test target; omitted values request clarification. */
  readonly target?: string
  /** Requirement used by case generation. */
  readonly requirement?: string
  /** Project revision against which the user expressed the request. */
  readonly expectedRevision?: Revision
}

/**
 * Whether one value names a verb of the closed set.
 * @param value - the value read from a request.
 * @returns whether it names a verb.
 */
export function isCommandVerb(value: unknown): value is CommandVerb {
  return typeof value === 'string' && (WEB_TEST_COMMANDS as readonly string[]).includes(value)
}

/**
 * Whether one value names a verb that would change business state.
 * @param value - the value read from a request.
 * @returns whether it names a mutating verb.
 */
export function isMutatingCommandVerb(value: unknown): value is MutatingCommandVerb {
  return typeof value === 'string' && (MUTATING_COMMANDS as readonly string[]).includes(value)
}

/**
 * Whether one value names a status subject.
 * @param value - the value read from a request.
 * @returns whether it names a status subject.
 */
export function isStatusSubject(value: unknown): value is StatusSubject {
  return typeof value === 'string' && (STATUS_SUBJECTS as readonly string[]).includes(value)
}

/** One field a verb needs before it can be acted on. */
export interface CommandField {
  /** Request field name the verb reads. */
  readonly name: string
  /** What the field has to name, in the words a clarification asks for. */
  readonly ask: string
}

/**
 * The revision field every mutating verb needs, declared once. An action is
 * expressed against the project revision the user answered it at, so a project
 * that moved since is refused rather than acted on.
 */
const EXPECTED_REVISION: CommandField = {
  name: 'expectedRevision',
  ask: 'name the project revision the answer was given against',
}

/** The one field a status query needs. */
const QUERY_FIELD: CommandField = { name: 'subject', ask: 'name what to read the status of' }

/** The two fields one mutating verb needs. */
interface MutatingFieldSet {
  /** Names what the verb acts on. */
  readonly target: CommandField
  /** Names the project revision the answer was given against. */
  readonly revision: CommandField
}

/** The fields each mutating verb needs, in the words a clarification asks for. */
const MUTATING_FIELDS: Readonly<Record<MutatingCommandVerb, MutatingFieldSet>> = {
  'generate-case': {
    target: { name: 'requirement', ask: 'name the requirement the generated cases must cover' },
    revision: EXPECTED_REVISION,
  },
  start: { target: { name: 'target', ask: 'name what to start' }, revision: EXPECTED_REVISION },
  pause: { target: { name: 'target', ask: 'name the run to pause' }, revision: EXPECTED_REVISION },
  resume: { target: { name: 'target', ask: 'name the run to resume' }, revision: EXPECTED_REVISION },
  cancel: { target: { name: 'target', ask: 'name the run to cancel' }, revision: EXPECTED_REVISION },
}

/**
 * Every field one verb needs, in the order a clarification reports them. A verb
 * added to the closed set without its fields fails to compile here rather than
 * resolving from a field nobody declared.
 * @param verb - the verb whose required fields are wanted.
 * @returns the required fields, target first.
 */
export function requiredFields(verb: CommandVerb): readonly CommandField[] {
  if (verb === 'query') return [QUERY_FIELD]
  const fields = MUTATING_FIELDS[verb]
  return [fields.target, fields.revision]
}

/** What each mutating verb needs, in the words the Remote answers with. */
const UNAVAILABLE_REASONS: Readonly<Record<MutatingCommandVerb, string>> = {
  'generate-case': 'this stage has no case domain, so a generated case has nowhere to be recorded',
  start: 'this stage has no run domain, so a started test has nowhere to be recorded',
  pause: 'this stage has no run domain, so there is no run whose state a pause could change',
  resume: 'this stage has no run domain, so there is no run whose state a resume could change',
  cancel: 'this stage has no run domain, so there is no run whose state a cancel could change',
}

/** Whether one verb can be acted on now, and why not when it cannot. */
export interface CommandAvailability {
  /** The verb this row is about. */
  readonly verb: CommandVerb
  /** Whether this stage performs the verb. */
  readonly available: boolean
  /** What is missing, naming the domain that would have to exist; `null` when available. */
  readonly reason: string | null
}

/** The command set a card renders and a model is told, from one home. */
export interface CommandCatalogue {
  /** One row per verb of the closed set, in declaration order. */
  readonly commands: readonly CommandAvailability[]
  /** The subjects a status query may name, in declaration order. */
  readonly statusSubjects: readonly StatusSubject[]
}

/**
 * Report whether one verb of the closed set can be acted on in this stage.
 * @param verb - the verb to report about.
 * @returns the availability row, whose reason names the domain this stage lacks.
 */
export function commandAvailability(verb: CommandVerb): CommandAvailability {
  if (!isMutatingCommandVerb(verb)) {
    return { verb, available: true, reason: null }
  }
  return { verb, available: false, reason: UNAVAILABLE_REASONS[verb] }
}

/**
 * The whole closed set, with each verb's availability.
 * @returns the catalogue a card renders and a model is told.
 */
export function describeCommands(): CommandCatalogue {
  return {
    commands: WEB_TEST_COMMANDS.map(commandAvailability),
    statusSubjects: [...STATUS_SUBJECTS],
  }
}

/** One ask resolved into the typed command it names. */
export type ResolvedCommand =
  /** A status question and the subject it reads. */
  | { readonly verb: 'query'; readonly subject: StatusSubject }
  /** A mutating ask, its target, and the project revision the answer was given against. */
  | { readonly verb: MutatingCommandVerb; readonly target: string; readonly expectedRevision: Revision }

/** What resolving a raw ask produced. */
export type CommandResolution =
  /** The ask named every field its verb needs. */
  | { readonly kind: 'resolved'; readonly sessionId: string; readonly command: ResolvedCommand }
  /** The ask left out at least one field its verb needs. */
  | {
    readonly kind: 'incomplete'
    readonly sessionId: string
    readonly verb: CommandVerb
    readonly missing: readonly CommandField[]
  }

/** Why a clarification is being asked for. */
export type ClarificationCause =
  /** The ask named too little to act on; `missing` names what it left out. */
  | 'incomplete-ask'
  /** The session's project has no confirmed environment to act against. */
  | 'undeclared-environment'

/** The specific question a caller has to answer before the ask can be acted on. */
export interface ClarificationRequest {
  /** The verb whose ask cannot be acted on yet. */
  readonly verb: CommandVerb
  /** Which of the two reasons applies. */
  readonly cause: ClarificationCause
  /** The fields the ask left out, for `incomplete-ask`; empty otherwise. */
  readonly missing: readonly string[]
  /** The question to put to the asker, naming the project the ask is about. */
  readonly ask: string
}

/** What one status question answered. It carries no run identity and no receipt. */
export interface StatusReport {
  /** The project the session is testing, as its record is published now. */
  readonly project: ProjectMetadata
  /** Whether the session confirmed the project's current published revision. */
  readonly environmentConfirmed: boolean
  /** Persisted user facts; these do not restore confirmation or authorization. */
  readonly environmentDeclaration: EnvironmentDeclaration | null
  /** Revision described by the saved facts, or null when none were saved. */
  readonly environmentDeclarationRevision: Revision | null
  /** Latest saved URL check with its own revision, or null when unchecked; never refreshed by a query. */
  readonly entryUrlProbe: StoredEntryUrlProbe | null
  /** Each declared fact of the project, as this host finds it. */
  readonly material: ProjectInspection
  /** The closed command set with each verb's availability, for a caller that shows it. */
  readonly commands: readonly CommandAvailability[]
}

/**
 * What one mutating ask resolved to. No member reports an action as performed,
 * because this stage has no domain in which a performed action would be recorded.
 */
export type ActionOutcome =
  /** The ask named too little, or its project has no confirmed environment. */
  | { readonly kind: 'clarification'; readonly clarification: ClarificationRequest }
  /** The project moved since the answer the ask was expressed against. */
  | { readonly kind: 'stale'; readonly verb: MutatingCommandVerb; readonly reason: string }
  /** This stage does not perform the verb. */
  | { readonly kind: 'unavailable'; readonly verb: MutatingCommandVerb; readonly reason: string }

/**
 * Read one request field as the non-empty string a verb needs.
 * @param request - the raw request.
 * @param field - the field the verb declares.
 * @returns the trimmed value, or `undefined` when it is absent, not a string, or blank.
 */
function fieldValue(request: Record<string, unknown>, field: CommandField): string | undefined {
  const value = request[field.name]
  if (typeof value !== 'string') return undefined
  return value.trim().length === 0 ? undefined : value.trim()
}

/**
 * Read one request field as a positive integer count of project revisions.
 * @param request - the raw request.
 * @param field - the field the verb declares.
 * @returns the value, or `undefined` when it is absent or not a positive integer.
 */
function revisionValue(request: Record<string, unknown>, field: CommandField): number | undefined {
  const value = request[field.name]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return undefined
  return value
}

/**
 * Resolve one raw ask into the typed command it names, or report what it left out.
 *
 * A request that names no Session, or a verb outside the closed set, is not a
 * command at all and is refused with an error. An ask that names a verb of the
 * closed set but leaves out one of its fields, or names a status subject outside
 * the closed set, is a command that cannot be acted on yet, and is answered with
 * the fields it owes. The two are different facts, and a caller cannot read the
 * second as the first.
 * @param request - the raw ask from a card or a tool call.
 * @returns the resolved command, or the fields the ask left out.
 * @throws {WebTestConversationError} `unknown-command` when the request names no
 * Session or a verb outside the closed set.
 */
export function resolveCommand(request: Record<string, unknown>): CommandResolution {
  const sessionId = request['sessionId']
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new WebTestConversationError(
      'web-test-conversation/unknown-command',
      `a web testing command must name the Session whose conversation is asking; ${JSON.stringify(sessionId)} names none`,
    )
  }
  const verb = request['verb']
  if (!isCommandVerb(verb)) {
    throw new WebTestConversationError(
      'web-test-conversation/unknown-command',
      `${JSON.stringify(verb)} is not one of the web testing commands ${WEB_TEST_COMMANDS.join(', ')}`,
    )
  }
  if (verb === 'query') {
    const subject = request[QUERY_FIELD.name]
    if (!isStatusSubject(subject)) {
      return { kind: 'incomplete', sessionId, verb, missing: [QUERY_FIELD] }
    }
    return { kind: 'resolved', sessionId, command: { verb, subject } }
  }
  // A new verb added to the closed set without its field set fails to compile at
  // this lookup rather than resolving from fields nobody declared.
  const fields = MUTATING_FIELDS[verb]
  const target = fieldValue(request, fields.target)
  const revision = revisionValue(request, fields.revision)
  if (target === undefined || revision === undefined) {
    return {
      kind: 'incomplete',
      sessionId,
      verb,
      missing: [
        ...(target === undefined ? [fields.target] : []),
        ...(revision === undefined ? [fields.revision] : []),
      ],
    }
  }
  return {
    kind: 'resolved',
    sessionId,
    command: { verb, target, expectedRevision: brandNumber<Revision>(revision) },
  }
}

/**
 * The unavailable outcome for one mutating verb, naming what this stage would need.
 * @param verb - the verb the ask named.
 * @returns the outcome a card and a model both read.
 */
export function unavailableAction(verb: MutatingCommandVerb): ActionOutcome {
  return { kind: 'unavailable', verb, reason: UNAVAILABLE_REASONS[verb] }
}

/**
 * The clarification for an ask that left out a field its verb needs.
 * @param verb - the verb the ask named.
 * @param missing - the fields it left out, in the order the verb declares them.
 * @param projectId - the project the ask is about, named so the answer is unambiguous.
 * @returns the question to put to the asker.
 */
export function incompleteAsk(
  verb: CommandVerb,
  missing: readonly CommandField[],
  projectId: ProjectId,
): ClarificationRequest {
  return {
    verb,
    cause: 'incomplete-ask',
    missing: missing.map(field => field.name),
    ask: `before "${verb}" can act on project '${projectId}', ${missing.map(field => field.ask).join(' and ')}`,
  }
}

/**
 * The clarification for a session whose project has no confirmed environment.
 * @param verb - the verb that cannot act without one.
 * @param projectId - the project the ask is about.
 * @returns the question to put to the asker.
 */
export function undeclaredEnvironment(
  verb: MutatingCommandVerb,
  projectId: ProjectId,
): ClarificationRequest {
  return {
    verb,
    cause: 'undeclared-environment',
    missing: [],
    ask: `project '${projectId}' has no confirmed environment, so confirm the environment it is tested in before any command that changes anything`,
  }
}
