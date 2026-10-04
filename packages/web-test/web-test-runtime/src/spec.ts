/**
 * The Web testing Runtime's storage domain: one unit whose global slot is the
 * catalog head and whose single table holds each project's committed metadata.
 *
 * The head is the only authoritative resource-registration entry point. It
 * carries four things at once — the published entry points, the ledger of
 * registered create commands, the ledger of published update commands, and the
 * undelivered notifications — because the commit protocol publishes all four in
 * ONE head write. A commit that wrote them separately could publish an entry
 * point whose ledger row never landed, or a notification for a commit that was
 * rolled back; there are no cross-record transactions in the storage domain, so
 * co-publication is what makes the head a commit point rather than a report of
 * one.
 *
 * Every stored record is validated by zod at the durable boundary, and this
 * declaration deliberately omits `invalidRecords: 'backup-and-skip'`: an
 * authoritative record that fails its schema rejects the whole open with
 * `invalid-record` instead of being moved aside and silently read as absent.
 * Test history that a later release cannot read is a failure to surface, not
 * data to drop.
 *
 * The physical layout is the simple one StorageDesignDecision chose: one
 * `single`-layout unit, no segments and no checkpoints. Segments and manifests
 * are not declared here because no measurement shows a need for them.
 *
 * @module @deepseek-ai/dsh-web-test-runtime/spec
 */

import { z, type ZodType } from 'zod'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { COMMAND_ID_PATTERN, MAX_ENTRY_URLS, MAX_URL_LENGTH, PROJECT_ID_PATTERN } from '@deepseek-ai/dsh-web-test-contracts/types'
import type { CommandId, EnvironmentDeclaration, ProjectId, ProjectMetadata, RecordId, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import { parseEnvironmentDeclaration } from '@deepseek-ai/dsh-web-test-contracts/parse'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { StoredEntryUrlProbe } from './reachability.ts'

/** Backend unit (and storage-domain) name holding every Web testing business record. */
export const WEB_TEST_UNIT = 'webtest'

/**
 * Storage format version of the `webtest` unit. A stored unit stamped with any
 * other version is refused at open rather than migrated: this stage has no
 * predecessor to read and no forward format to guess.
 *
 * Version 2 records the project table's move from one `codeRoot` to the ordered
 * `codeRoots` list. A unit stamped 1 therefore fails its version check at open
 * instead of reaching the record schema, which is the refusal this constant
 * exists to make: the two layouts describe different facts, so reading one as
 * the other would invent a root the user never declared.
 */
export const WEB_TEST_UNIT_VERSION = 2

/** Stored project identity; the format rule is the contract's, not a second declaration. */
const projectIdSchema = z.string().regex(PROJECT_ID_PATTERN).transform(value => brandString<ProjectId>(value))

/** Stored command token, branded so it cannot be read as a project identity. */
const commandIdSchema = z.string().regex(COMMAND_ID_PATTERN).transform(value => brandString<CommandId>(value))

/** Stored revision: a positive integer, branded so a resource counter is never read as one. */
const revisionSchema = z.number().int().positive().transform(value => brandNumber<Revision>(value))

/** SHA-256 of the normalized command parameters, as the ledger records it. */
const parametersHashSchema = z.string().regex(/^[0-9a-f]{64}$/u)

/** Canonical four-digit-year UTC calendar instant, as every published timestamp is. */
const instantSchema = z.iso.datetime({ precision: 3 }).refine(value => !value.startsWith('0000-'), {
  message: 'Expected a canonical four-digit-year UTC calendar instant',
})

/**
 * The metadata one update holds while it is not yet published: the revision it
 * will carry and the content that revision carries. It is deliberately the
 * content alone — which command staged it and under which digest is recorded by
 * the head write that publishes it, so nothing here outlives a commit that never
 * published one.
 */
export type StagedUpdate = Pick<ProjectMetadata, 'revision' | 'codeRoots' | 'entryUrls'>

/** Durable validation of {@link StagedUpdate}. */
const stagedUpdateSchema: ZodType<StagedUpdate> = z.object({
  revision: revisionSchema,
  codeRoots: z.array(z.string().min(1)).min(1),
  entryUrls: z.array(z.string().min(1).max(MAX_URL_LENGTH)).max(MAX_ENTRY_URLS),
}).strict()

/**
 * One project's stored record: the published content the contract's
 * `ProjectMetadata` declares, plus the update a commit staged on it.
 *
 * The record's own fields always hold content for a revision the catalog head
 * publishes, and `pending` holds the next revision's content until a later
 * record write folds it in. A commit therefore never overwrites what a published
 * entry names: it adds a revision beside it, and the head write that publishes
 * the staged revision is what a read follows.
 */
export type StoredProject = ProjectMetadata & { readonly pending: StagedUpdate | null }

/**
 * Durable validation of {@link StoredProject}. The declared output type is what
 * ties this schema to the contract's `ProjectMetadata`: a field it stopped
 * validating, or one it invented, would no longer produce that type and the
 * declaration below would stop compiling.
 */
const storedProjectSchema: ZodType<StoredProject> = z.object({
  projectId: projectIdSchema,
  revision: revisionSchema,
  codeRoots: z.array(z.string().min(1)).min(1),
  entryUrls: z.array(z.string().min(1).max(MAX_URL_LENGTH)).max(MAX_ENTRY_URLS),
  pending: stagedUpdateSchema.nullable(),
}).strict().refine(
  record => record.pending === null || record.pending.revision === record.revision + 1,
  { message: 'A staged update must name the revision one past the record\'s own revision' },
)

/**
 * One registered create command's ledger row. `reserved` means the resource
 * identity is allocated and durable but the entity is not yet published;
 * `published` means the entry point and the receipt committed together, so the
 * row is also the idempotency answer a resend returns.
 */
const createIntentSchema = z.object({
  commandId: commandIdSchema,
  parametersHash: parametersHashSchema,
  reservedProjectId: projectIdSchema,
  phase: z.enum(['reserved', 'published']),
  acceptedRevision: revisionSchema.nullable(),
}).strict().refine(
  intent => (intent.phase === 'published') === (intent.acceptedRevision !== null),
  { message: 'A published create intent must carry the revision it accepted, and a reserved one none' },
)

/** Stored type of {@link createIntentSchema}. */
export type CreateIntent = z.infer<typeof createIntentSchema>

/**
 * One published update command's ledger row, written by the same head write that
 * published its entry, so the row is the idempotency answer a resend returns. An
 * update that is staged but not published has no row: the uncommitted content
 * lives on the project record, where no read consults it, and the head asserts
 * only what it has published.
 */
const updateIntentSchema = z.object({
  commandId: commandIdSchema,
  projectId: projectIdSchema,
  parametersHash: parametersHashSchema,
  targetRevision: revisionSchema,
}).strict()

/** Stored type of {@link updateIntentSchema}. */
export type UpdateIntent = z.infer<typeof updateIntentSchema>

/** One published entry point the head references, together with the revision it published. */
const publishedEntrySchema = z.object({
  projectId: projectIdSchema,
  metadataRevision: revisionSchema,
  publishedAt: instantSchema,
}).strict()

/** Stored type of {@link publishedEntrySchema}. */
export type PublishedEntry = z.infer<typeof publishedEntrySchema>

/** One undelivered notification, appended by the same head write that published its entry. */
const catalogNotificationSchema = z.object({
  sequence: z.number().int().positive(),
  kind: z.literal('project-published'),
  projectId: projectIdSchema,
  metadataRevision: revisionSchema,
  publishedAt: instantSchema,
}).strict()

/** One queued notification a consumer drains through the outbox. */
export type CatalogNotification = z.infer<typeof catalogNotificationSchema>

/**
 * The catalog head: the whole authoritative registration state of one data
 * root. `entries` is keyed by project identity, `intents` and `updates` by
 * command token, and `notifications` holds the undelivered tail in ascending
 * sequence order.
 */
const catalogHeadSchema = z.object({
  headRevision: z.number().int().nonnegative(),
  entries: z.record(projectIdSchema, publishedEntrySchema),
  intents: z.record(commandIdSchema, createIntentSchema),
  updates: z.record(commandIdSchema, updateIntentSchema),
  notifications: z.array(catalogNotificationSchema),
  notificationSequence: z.number().int().nonnegative(),
}).strict()

/** The authoritative head value this Runtime reads and republishes. */
export type CatalogHead = z.infer<typeof catalogHeadSchema>

/** A saved user declaration; reopening it never restores execution permission. */
export interface StoredEnvironment {
  /** Published project revision the user described. */
  readonly revision: Revision
  /** User-supplied login, environment, and supplementary requirements. */
  readonly declaration: EnvironmentDeclaration
}

const sessionIdSchema = z.string().min(1).max(128).transform(value => brandString<SessionId>(value))
const sessionProjectSchema = z.object({ sessionId: sessionIdSchema, projectId: projectIdSchema }).strict()
const environmentDeclarationSchema = z.record(z.string(), z.unknown()).transform((value, context) => {
  try {
    return parseEnvironmentDeclaration(value, 'declaration')
  } catch (_error) {
    context.addIssue({ code: 'custom', message: 'Invalid saved environment declaration' })
    return z.NEVER
  }
})
const storedEnvironmentSchema: ZodType<StoredEnvironment> = z.object({
  revision: revisionSchema,
  declaration: environmentDeclarationSchema,
}).strict()

const entryUrlObservationSchema = z.discriminatedUnion('state', [
  z.object({ declared: z.string().min(1).max(MAX_URL_LENGTH), state: z.literal('response'), statusCode: z.number().int().min(100).max(999) }).strict(),
  z.object({ declared: z.string().min(1).max(MAX_URL_LENGTH), state: z.literal('timeout') }).strict(),
  z.object({ declared: z.string().min(1).max(MAX_URL_LENGTH), state: z.literal('unreachable') }).strict(),
  z.object({ declared: z.string().min(1).max(MAX_URL_LENGTH), state: z.literal('cancelled') }).strict(),
  z.object({ declared: z.string().min(1).max(MAX_URL_LENGTH), state: z.literal('unusable'), reason: z.enum(['invalid-url', 'unsupported-protocol', 'credentials']) }).strict(),
])
const storedEntryUrlProbeSchema: ZodType<StoredEntryUrlProbe> = z.object({
  projectId: projectIdSchema,
  revision: revisionSchema,
  checkedAt: instantSchema,
  entryUrls: z.array(entryUrlObservationSchema).max(MAX_ENTRY_URLS),
}).strict()

/**
 * The value a data root serves before its first commit: nothing is registered,
 * published, or queued, and revision 0 is the cut every first write compares
 * against. A fresh object per call keeps a caller's spread from aliasing it.
 * @returns an empty head.
 */
export function emptyCatalogHead(): CatalogHead {
  return { headRevision: 0, entries: {}, intents: {}, updates: {}, notifications: [], notificationSequence: 0 }
}

/**
 * The `webtest` storage domain. `global` is the catalog head; the `projects`
 * table is the child entity each creation builds and the record each update
 * stages on, typed as {@link StoredProject} — the contract's `ProjectMetadata`
 * plus the update a commit has not folded in, which {@link storedProjectSchema}
 * is the durable validation of. `invalidRecords` is intentionally absent so a
 * stored record that fails its schema rejects the open rather than being moved
 * aside and read as absent.
 */
export const webTestDomain = defineDomain({
  name: WEB_TEST_UNIT,
  version: WEB_TEST_UNIT_VERSION,
  global: { schema: catalogHeadSchema, initial: emptyCatalogHead() },
  tables: {
    projects: domainTable<ProjectId, StoredProject>(storedProjectSchema),
    sessions: domainTable<SessionId, { readonly sessionId: SessionId; readonly projectId: ProjectId }>(sessionProjectSchema),
    environments: domainTable<ProjectId, StoredEnvironment>(storedEnvironmentSchema),
    entry_url_probes: domainTable<ProjectId, StoredEntryUrlProbe>(storedEntryUrlProbeSchema),
  },
})

/**
 * Derive one project's stored record identity from its project identity, so a
 * `RecordId` submitted for a project's metadata always names that project and
 * nothing else.
 * @param projectId - the project whose record is addressed.
 * @returns the record identity the commit protocol expects for that project.
 */
export function recordIdOf(projectId: ProjectId): RecordId {
  return brandString<RecordId>(`record-${projectId.slice('project-'.length)}`)
}
