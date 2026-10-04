/**
 * Request and result records for the four domains this contract owns:
 * configuration, project metadata, storage, and policy.
 *
 * Each record is the single declaration of its wire fields; the generated
 * Client Remote projects these same types, so a hand-written mirror DTO would
 * be a second home. A request is what a caller sends, a validated form is the
 * same request after field-level parsing branded its identities, and a receipt
 * is what the authoritative committer returns — `accepted` records a committed
 * write only and never means a test passed.
 *
 * @module @deepseek-ai/dsh-web-test-contracts/records
 */

import type { CommandId, ProjectId, RecordId, Revision } from './ids.ts'

/** Format every project identity must match. */
export const PROJECT_ID_PATTERN = /^project-[0-9a-f]{32}$/u

/** Format every project revision identity must match. */
export const PROJECT_REVISION_ID_PATTERN = /^project-rev-[0-9a-f]{32}$/u

/** Format every run identity must match. */
export const RUN_ID_PATTERN = /^run-[0-9a-f]{32}$/u

/** Format every run plan revision identity must match. */
export const RUN_PLAN_REVISION_ID_PATTERN = /^plan-rev-[0-9a-f]{32}$/u

/** Format every command token must match. */
export const COMMAND_ID_PATTERN = /^cmd-[0-9a-zA-Z-]{1,64}$/u

/** Format every stored record identity must match. */
export const RECORD_ID_PATTERN = /^record-[0-9a-f]{32}$/u

/** Longest absolute path a project may declare. */
export const MAX_PATH_LENGTH = 260

/** Longest entry URL a project may declare. */
export const MAX_URL_LENGTH = 2048

/** Most code roots one project revision may declare. */
export const MAX_CODE_ROOTS = 16

/** Most entry URLs one project revision may declare. */
export const MAX_ENTRY_URLS = 32

/** Most requirements the user may add to one environment declaration. */
export const MAX_SUPPLEMENTARY_REQUIREMENTS = 16

/** Longest single supplementary requirement a declaration may carry. */
export const MAX_REQUIREMENT_LENGTH = 512

/**
 * Reasons a policy decision reached, as a closed discriminated union.
 *
 * `denied-missing-confirmation` is distinct from
 * `denied-expired-authorization` because a required business confirmation is a
 * gate of its own: a question that timed out, stayed pending, was skipped, or
 * was cancelled reached no confirmation, which is not the same fact as an
 * authorization that existed and has since lapsed. The policy service tells the
 * two apart so a caller knows whether to re-ask or to re-verify.
 */
export type PolicyDecisionReason =
  | 'allowed-in-scope'
  | 'denied-outside-scope'
  | 'denied-protected-path'
  | 'denied-unknown-target'
  | 'denied-expired-authorization'
  | 'denied-missing-confirmation'

/**
 * One policy outcome for a named subject, carrying the reason that produced
 * it. `evaluatePolicy` returns this record and no other policy type: it is the
 * single home for a policy result on the wire.
 */
export interface PolicyDecision {
  /** Whether the confirmed declaration covers the request; never an authorization on its own. */
  readonly allowed: boolean
  /** Closed reason for the outcome; a new reason extends this union. */
  readonly reason: PolicyDecisionReason
  /** Field or path the decision was made against, for the caller's diagnostic. */
  readonly subject: string
}

/**
 * How the declared environment authenticates, as the user stated it.
 *
 * The two branches are the whole set: either no login stands between the caller
 * and the environment, or one does and the user names which account holds it.
 * There is no branch for a login whose account the user did not name, because a
 * declaration that cannot say who would sign in is not a fact this contract can
 * carry forward, and an inferred one would be a credential the product invented.
 */
export type LoginDeclaration =
  /** The user stated that reaching the environment needs no login. */
  | { readonly state: 'not-required' }
  /** The environment needs a login; `accountLabel` names the account holding it. */
  | {
    /** Always true on this branch. */
    readonly state: 'required'
    /**
     * Name of the account that holds the login, for a caller that shows the
     * declaration and one that has to pick the right identity. It is a label
     * and never a secret: a password, token, or key has no branch here.
     */
    readonly accountLabel: string
  }

/**
 * One environment fact a user declares; ordinary inference cannot stand in for it.
 *
 * **One active declaration covers every code root registered by a project.** The
 * roots are a set the user declared together, so they are confirmed together and
 * a grant made against this declaration applies to all of them. A project cannot
 * assign different environment facts to individual roots: confirming another
 * declaration replaces the project's active declaration, it does not add a
 * separately scoped environment. The login and the supplementary requirements
 * belong to the same declaration for the same reason: they are facts the user
 * stated about this environment, not about one tree.
 *
 * A type alias for the reason given on {@link RegisterProjectRequest}.
 */
export type EnvironmentDeclaration = {
  /** Absolute code roots this declaration covers, in the order declared. */
  readonly codeRoots: string[]
  /** Absolute entry URL the user already started, when one applies. */
  readonly entryUrl: string | null
  /** Whether this environment is a test environment rather than production. */
  readonly isTestEnvironment: boolean
  /** The login this environment requires, as the user stated it. */
  readonly login: LoginDeclaration
  /** Requirements the user added on top of what the trees and URLs declare. */
  readonly supplementaryRequirements: string[]
}

/**
 * Register one project and its starting metadata.
 *
 * This is a type alias rather than an interface because the field readers in
 * `./fields.ts` take `Record<string, unknown>`, and only a type alias carries
 * the implicit index signature that makes such an assignment legal. An
 * interface would need a cast to reach the parser, and this package makes none.
 */
export type RegisterProjectRequest = {
  /** Caller token making this command idempotent within the data root. */
  readonly commandId: string
  /** Code roots the user provided. */
  readonly codeRoots: string[]
  /** Entry URLs the user already started. */
  readonly entryUrls: string[]
}

/** A project registration after its fields are parsed and branded. */
export interface ValidatedProjectRegistration {
  /** Command token, branded so it cannot be passed as a project identity. */
  readonly commandId: CommandId
  /** Code roots the project tests, each length-checked. */
  readonly codeRoots: string[]
  /** Entry URLs the user already started, each length-checked. */
  readonly entryUrls: string[]
}

/** One project's registered identity and current metadata. */
export interface ProjectMetadata {
  /** Stable identity storage and policy record the project under. */
  readonly projectId: ProjectId
  /** Monotonic revision number compared before a later write. */
  readonly revision: Revision
  /** Code roots the project tests, in the order the user declared them. */
  readonly codeRoots: string[]
  /** Entry URLs the user already started. */
  readonly entryUrls: string[]
}

/**
 * Write one domain record through the single authoritative committer.
 *
 * A type alias for the reason given on {@link RegisterProjectRequest}.
 */
export type SubmitRecordRequest = {
  /** Caller token making this command idempotent within its resource. */
  readonly commandId: string
  /** Identity of the record being written. */
  readonly recordId: string
  /** Revision the caller last read, so a stale write is refused. */
  readonly expectedRevision: number
}

/** A record submission after its fields are parsed and branded. */
export interface ValidatedRecordSubmission {
  /** Command token, branded so it cannot be passed as a record identity. */
  readonly commandId: CommandId
  /** Identity of the record being written, branded. */
  readonly recordId: RecordId
  /** Revision the caller last read. */
  readonly expectedRevision: Revision
}

/** One committed domain record's identity and revision. */
export interface RecordCommit {
  /** Identity of the committed record. */
  readonly recordId: RecordId
  /** Revision the committer accepted. */
  readonly acceptedRevision: Revision
}

/**
 * Ask whether one action is permitted before anything executes.
 *
 * A type alias for the reason given on {@link RegisterProjectRequest}.
 */
export type EvaluatePolicyRequest = {
  /** Project whose declaration and authorization apply. */
  readonly projectId: string
  /** Action path or field the decision is requested for. */
  readonly subject: string
  /** Absolute path the action would touch, when it touches one. */
  readonly targetPath: string | null
}

/** A policy request after its fields are parsed and branded. */
export interface ValidatedPolicyRequest {
  /** Project whose declaration applies, branded. */
  readonly projectId: ProjectId
  /** Action the decision is requested for. */
  readonly subject: string
  /** Absolute path the action would touch, when it touches one. */
  readonly targetPath: string | null
}

/**
 * Evaluate the read-only declaration a project was registered with.
 *
 * A type alias for the reason given on {@link RegisterProjectRequest}.
 */
export type ConfirmEnvironmentRequest = {
  /** Project whose environment is being declared. */
  readonly projectId: string
  /** Caller token making this command idempotent within the project. */
  readonly commandId: string
  /** Declaration the user confirmed. */
  readonly declaration: EnvironmentDeclaration
}

/** An environment confirmation after its fields are parsed and branded. */
export interface ValidatedEnvironmentConfirmation {
  /** Project whose environment is declared, branded. */
  readonly projectId: ProjectId
  /** Command token, branded so it cannot be passed as a project identity. */
  readonly commandId: CommandId
  /** Declaration the user confirmed. */
  readonly declaration: EnvironmentDeclaration
}

/** Receipt every write command returns; `accepted` records a committed write only. */
export interface CommandReceipt {
  /** The command token this receipt answers. */
  readonly commandId: CommandId
  /** Identity of the resource the command acted on. */
  readonly resourceId: ProjectId | RecordId
  /** Revision the committer accepted. */
  readonly acceptedRevision: Revision
  /** Outcome tag: `accepted` records a committed write only. */
  readonly outcome: 'accepted' | 'pending-user'
  /** Why the command waits, when it does. */
  readonly pendingReason: string | null
}
