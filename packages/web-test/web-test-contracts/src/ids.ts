/**
 * Branded identities, revisions, and command tokens shared by configuration,
 * project metadata, storage, and policy.
 *
 * Every identifier that crosses a process, storage, or wire boundary is branded,
 * so a project identity is never passed where a run identity is expected and a
 * persisted revision is never confused with a resource's own counter. The brands
 * are compile-time only: {@link brandString} and {@link brandNumber} return the
 * value unchanged, so equality, logging, and JSON serialization keep the
 * underlying primitive behavior. Construct an identity through the parse
 * functions in `./identity.ts`, which are the only places that admit an
 * unbranded value from outside the process.
 *
 * @module @deepseek-ai/dsh-web-test-contracts/ids
 */

import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'

/** Stable identity of one registered project, as storage and policy records it. */
export type ProjectId = Branded<'WebTestProjectId'>

/** Identity of one immutable project revision; a project has many. */
export type ProjectRevisionId = Branded<'WebTestProjectRevisionId'>

/** Stable identity of one test run. */
export type RunId = Branded<'WebTestRunId'>

/** Identity of one run's plan revision; revisions are compared before a write. */
export type RunPlanRevisionId = Branded<'WebTestRunPlanRevisionId'>

/** Caller-generated token that makes one write command idempotent within its resource. */
export type CommandId = Branded<'WebTestCommandId'>

/** Identity of one persisted domain record. */
export type RecordId = Branded<'WebTestRecordId'>

/** Monotonic revision number a resource exposes for optimistic concurrency. */
export type Revision = BrandedNumber<'WebTestRevision'>
