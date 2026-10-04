/**
 * The policy service's public record types.
 *
 * These are the shapes a caller sends and receives. Every wire-level record a
 * decision, a declaration, or a grant produces is the contract package's own
 * type — `PolicyDecision`, `ValidatedEnvironmentConfirmation`, and the branded
 * `ProjectId` and `Revision` — so a Client, the Runtime, and a future executor
 * read the same records this service reads. What this file adds is the request
 * and outcome shapes the contract does not own: which effect is being decided,
 * which flow a grant belongs to, and the state a confirmation question reached.
 *
 * @module @deepseek-ai/dsh-web-test-policy/types
 */

import type {
  LoginDeclaration,
  PolicyDecision,
  ProjectId,
  Revision,
  ValidatedEnvironmentConfirmation,
} from '@deepseek-ai/dsh-web-test-contracts'
import type { WebTestEffect } from './effects.ts'

/** The closed set of effect kinds, as configuration and reports name them. */
export type WebTestEffectKind = WebTestEffect['kind']

/** What one protected directory holds, which is why a test run may not read it. */
export type ProtectedPathRole =
  /** Material the user uploaded into the product. */
  | 'upload'
  /** Material the product retrieved from a tested environment. */
  | 'download'
  /** Staging material a write has not published yet. */
  | 'temporary-material'

/** One protected directory as the composition declares it, before resolution. */
export interface ProtectedPathDeclaration {
  /** Absolute directory path holding material of `role`. */
  path: string
  /** What the directory holds. */
  role: ProtectedPathRole
}

/** One protected directory after the service resolved and froze its identity. */
export interface ProtectedPath {
  /** Canonical identity of the directory, resolved once at load. */
  readonly real: string
  /** What the directory holds, reported in the denial. */
  readonly role: ProtectedPathRole
}

/** One decision request: which entry is asking, and what it would do. */
export interface PolicyQuery {
  /** Session the call belongs to, or `null` for a call with no session. */
  readonly sessionId: string | null
  /** The effect the call would have, or `null` when no adapter recognises it. */
  readonly effect: WebTestEffect | null
  /** The tool or service the call came through, named in the decision subject. */
  readonly entry: string
}

/** The environment a project declared, as the policy resolved it. */
export interface DeclaredEnvironment {
  /** The contract's validated confirmation, with branded identities. */
  readonly confirmation: ValidatedEnvironmentConfirmation
  /** Identity of the declared content; a changed declaration gets a new one. */
  readonly declarationId: string
  /**
   * Canonical identities of the code roots the declaration covers, in the order
   * the user declared them. One declaration covers every root the project
   * registered, so a caller reads the whole tested scope from one record.
   */
  readonly codeRoots: readonly string[]
  /** Origins of the entry URLs the user already started. */
  readonly entryOrigins: readonly string[]
  /** Project revision the declaration was made against. */
  readonly projectRevision: Revision
  /**
   * The login the user stated the environment requires. It is recorded, not
   * resolved: the policy neither holds a credential nor signs in, and a
   * declaration that names no account cannot authorize an identity.
   */
  readonly login: LoginDeclaration
  /** Requirements the user added on top of what the trees and URLs declare. */
  readonly supplementaryRequirements: readonly string[]
}

/** What a caller asks a concrete flow to be authorized to do. */
export interface FlowGrantRequest {
  /** Session whose entry is running the flow. */
  readonly sessionId: string
  /** The concrete flow's record identity; a grant belongs to one flow. */
  readonly flowId: string
  /** Revision of that flow's plan the grant is expressed against. */
  readonly flowRevision: number
  /** Whether this grant reaches a third party rather than the declared entry. */
  readonly thirdParty: boolean
  /** Actions the grant may cover, no greater than the configured maximum. */
  readonly actions: number
}

/** What one granted authorization is, as the caller is told. */
export interface FlowGrantReceipt {
  /** Identity of the grant, stable for one flow at one revision. */
  readonly grantId: string
  /** Project the grant belongs to. */
  readonly projectId: ProjectId
  /** The concrete flow's record identity. */
  readonly flowId: string
  /** Revision of that flow's plan. */
  readonly flowRevision: number
  /** Project revision the grant was made against. */
  readonly projectRevision: Revision
  /** Identity of the environment declaration the grant was made against. */
  readonly declarationId: string
  /** Whether the grant reaches a third party. */
  readonly thirdParty: boolean
  /** Actions still available to the grant. */
  readonly actions: number
  /** Epoch milliseconds after which the grant no longer applies. */
  readonly expiresAt: number
}

/** What one confirmation question was asked against, and until when. */
export interface ConfirmationTicket {
  /** Identity the caller answers with. */
  readonly questionId: string
  /** Project the question belongs to. */
  readonly projectId: ProjectId
  /** The concrete flow the work depends on. */
  readonly flowId: string
  /** Revision of that flow's plan, re-checked when an answer arrives. */
  readonly flowRevision: number
  /** Project revision at the moment the question was asked. */
  readonly projectRevision: Revision
  /** Environment declaration at the moment the question was asked. */
  readonly declarationId: string
  /** Digest of the intended action, re-checked when an answer arrives. */
  readonly actionFingerprint: string
  /** Epoch milliseconds after which the question can no longer be answered. */
  readonly expiresAt: number
}

/** How one confirmation question ended. */
export type ConfirmationState =
  /** Asked and still answerable; waiting on a human grants nothing by itself. */
  | 'pending'
  /** Answered in context, and the answer granted one intent-scoped authorization. */
  | 'answered'
  /** The window closed before an answer arrived. */
  | 'expired'
  /** The answer's call, action, or revisions no longer match the question. */
  | 'mismatched'
  /** The caller chose not to confirm. */
  | 'skipped'
  /** The dependent work was cancelled. */
  | 'cancelled'

/** What a caller asks a business confirmation about. */
export interface ConfirmationRequest extends PolicyQuery {
  /** The concrete flow the dependent work belongs to. */
  readonly flowId: string
  /** Revision of that flow's plan. */
  readonly flowRevision: number
}

/** What the human answered, carrying the context the question was shown with. */
export interface ConfirmationAnswer {
  /** Identity of the question being answered. */
  readonly questionId: string
  /** Digest of the action the question was asked about. */
  readonly actionFingerprint: string
  /** Project revision the caller believed was current. */
  readonly projectRevision: Revision
  /** Flow plan revision the caller believed was current. */
  readonly flowRevision: number
  /** Environment declaration the caller believed was current. */
  readonly declarationId: string
  /** Whether the human confirmed. */
  readonly confirmed: boolean
}

/** What a confirmation round produced. */
export type ConfirmationOutcome =
  /** This effect needs no business confirmation; the plain decision stands. */
  | { readonly required: false; readonly decision: PolicyDecision }
  /** This effect needs one; the decision and the question's state are reported. */
  | {
    /** Always true on this branch. */
    readonly required: true
    /** The decision the action has on its own merits, ignoring the confirmation. */
    readonly decision: PolicyDecision
    /** The open or closed question this outcome refers to. */
    readonly ticket: ConfirmationTicket
    /** How the question stands. */
    readonly state: ConfirmationState
    /** Whether the caller must ask a new question before trying again. */
    readonly reclarify: boolean
  }
