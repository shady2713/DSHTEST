/**
 * What one session's conversation may act on, read from the entry's own
 * association and from the published project that association names.
 *
 * **A session with no project reaches no project.** An unattached session reads
 * as {@link ConversationContext} `ordinary` and nothing else: this module is
 * given the entry's record for one session id and has no second source to fall
 * back to, so there is no "the one declared project" for it to reach. The
 * refusal is a value rather than a missing value, so a caller that forgets to
 * check it is handed a context with no project in it rather than an empty object
 * it might read as "no restriction".
 *
 * **The record is read live, not cached at attachment.** The project revision is
 * what an action is expressed against, so a context that reported the revision
 * the session was attached at would let an action through against a project that
 * has since moved. Reading the published record on every call is what makes a
 * stale answer detectable rather than invisible.
 *
 * **The entry owns the two facts; the policy owns the consequences.** Whether the
 * environment is confirmed follows from the entry's confirmed revision matching
 * the current published revision; the declaration itself
 * lives in the policy's ledger, which publishes no reader, so this context
 * reports the fact and not the declaration — which is also the smaller thing to
 * carry into a card.
 *
 * @module @deepseek-ai/dsh-web-test-conversation/context
 */

import type { ProjectId, ProjectMetadata, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import type { ProjectInspection } from '@deepseek-ai/dsh-web-test-runtime'

/** The two facts the entry records for a session it has attached to a project. */
export interface SessionAssociation {
  /** The project this session is testing; the only one its decisions apply to. */
  readonly projectId: ProjectId
  /** Revision whose environment the user confirmed, or null before confirmation. */
  readonly declaredRevision: Revision | null
}

/** The case of a session attached to one published project. */
export interface AttachedContext {
  /** Which of the two cases this context is. */
  readonly kind: 'attached'
  /** The project this session is testing. */
  readonly projectId: ProjectId
  /** The revision that project's record is published at, read now. */
  readonly revision: Revision
  /** Whether the confirmed revision equals the current published revision. */
  readonly environmentConfirmed: boolean
  /** Each declared fact of the project, as this host finds it. */
  readonly material: ProjectInspection
}

/** What one session's conversation may act on. */
export type ConversationContext =
  /** The session is attached to no project, so it reaches no project at all. */
  | { readonly kind: 'ordinary' }
  /** The session is attached to one published project. */
  | AttachedContext

/**
 * The context of a session the entry has attached to a project.
 *
 * The project's own material is read from the record the runtime publishes, so a
 * session is only ever described by the project it is attached to; a caller
 * holding a context for one session cannot read another's through it.
 * @param association - the entry's record for this session.
 * @param project - the published record of the project it names.
 * @param material - what this host finds among that record's declared facts.
 * @returns the attached context.
 */
export function attachedContext(
  association: SessionAssociation,
  project: ProjectMetadata,
  material: ProjectInspection,
): AttachedContext {
  return {
    kind: 'attached',
    projectId: project.projectId,
    revision: project.revision,
    environmentConfirmed: association.declaredRevision === project.revision,
    material,
  }
}
