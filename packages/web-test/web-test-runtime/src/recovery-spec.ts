/** Durable activity records; legacy formats retain their original strict readers. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Original durable prototype batch identity. */
export type PrototypeRunId = Branded<'WebTestPrototypeRunId'>
/** Original durable prototype operation identity, retained across batches. */
export type PrototypeOperationId = Branded<'WebTestPrototypeOperationId'>

/** File holding one atomically committed prototype activity cut. */
export const PROTOTYPE_ACTIVITY_FILENAME = 'prototype-activity.json'

const identity = z.string().min(1)
const digest = z.string().regex(/^[a-f0-9]{64}$/)

/** The exact business intent, independent of run and command identities. */
export const prototypeIntentSchema = z.object({
  kind: identity,
  target: identity,
  parametersHash: digest,
}).strict()

/** An operation retains its original identity through recovery. */
const legacyOperationSchema = z.object({
  operationId: identity.transform(value => brandString<PrototypeOperationId>(value)),
  businessIntent: prototypeIntentSchema,
  status: z.enum(['ISSUED', 'UNKNOWN', 'COMPLETED']),
}).strict()

/** Real correlated browser denial retained by the trusted operation owner. */
export const prototypeNotExecutedReceiptSchema = z.object({
  operationId: identity.transform(value => brandString<PrototypeOperationId>(value)),
  runId: identity.transform(value => brandString<PrototypeRunId>(value)),
  sessionId: identity.transform(value => brandString<SessionId>(value)),
  callId: identity.transform(value => brandString<Branded<'ToolCallId'>>(value)),
  requestId: z.number().int().nonnegative(),
  target: identity.transform(value => brandString<Branded<'DesktopBrowserTargetId'>>(value)),
  hostEpoch: z.number().int().nonnegative(),
  parametersHash: digest,
  outcome: z.literal('not-executed'),
  reason: z.enum(['unknown-operation', 'wrong-target', 'stale-observation', 'epoch-mismatch',
    'revoked', 'action-failed', 'navigation-denied', 'session-not-authorized']),
}).strict()

/** Current operations distinguish confirmed non-execution from uncertainty and success. */
export const prototypeOperationSchema = z.discriminatedUnion('status', [
  legacyOperationSchema,
  legacyOperationSchema.extend({
    status: z.literal('NOT_EXECUTED'),
    receipt: prototypeNotExecutedReceiptSchema,
  }).strict(),
])

/** A prototype run head retains pause/cancel intent and material references. */
const legacyRunSchema = z.object({
  runId: identity.transform(value => brandString<PrototypeRunId>(value)),
  sessionId: identity.transform(value => brandString<SessionId>(value)),
  headRevision: z.number().int().positive(),
  status: z.enum(['RUNNING', 'PAUSED', 'UNKNOWN', 'COMPLETED']),
  pauseRequested: z.boolean(),
  cancelRequested: z.boolean(),
  operations: z.array(legacyOperationSchema),
  attachments: z.array(identity),
  reports: z.array(identity),
}).strict()

/** Current run heads retain all terminal denial receipts. */
export const prototypeRunSchema = legacyRunSchema.extend({ operations: z.array(prototypeOperationSchema) }).strict()

/** Formats 1/2 remain strict and read-only; fresh executors write 3 and recover into 4. */
export const prototypeActivitySchema = z.discriminatedUnion('format', [
  z.object({
    format: z.literal(1),
    compositionHash: digest,
    revision: z.number().int().positive(),
    executor: z.enum(['active', 'revoked']),
    runs: z.array(legacyRunSchema),
  }).strict(),
  z.object({
    format: z.literal(2),
    compositionHash: digest,
    revision: z.number().int().positive(),
    executor: z.literal('revoked'),
    recoveryOnly: z.literal(true),
    predecessorCompositionHash: digest,
    runs: z.array(legacyRunSchema),
  }).strict(),
  z.object({
    format: z.literal(3),
    compositionHash: digest,
    revision: z.number().int().positive(),
    executor: z.enum(['active', 'revoked']),
    runs: z.array(prototypeRunSchema),
  }).strict(),
  z.object({
    format: z.literal(4),
    compositionHash: digest,
    revision: z.number().int().positive(),
    executor: z.literal('revoked'),
    recoveryOnly: z.literal(true),
    predecessorCompositionHash: digest,
    runs: z.array(prototypeRunSchema),
  }).strict(),
])

/** One validated prototype business intent. */
export type PrototypeBusinessIntent = z.infer<typeof prototypeIntentSchema>
/** One validated prototype operation. */
export type PrototypeOperation = z.infer<typeof prototypeOperationSchema>
/** Trusted receipt correlated with the original tool call and wire reply. */
export type PrototypeNotExecutedReceipt = z.infer<typeof prototypeNotExecutedReceiptSchema>
/** One validated prototype run head. */
export type PrototypeRunHead = z.infer<typeof prototypeRunSchema>
/** One complete committed activity cut, never an in-flight scheduler projection. */
export type PrototypeActivityCut = z.infer<typeof prototypeActivitySchema>

/** A frozen cut binds every generation file to the original composition. */
export interface FrozenRunManifest {
  /** Canonical control-root identity shared with the writer lock. */
  readonly controlRootIdentity: string
  /** Kernel object name shared with the ordinary Runtime. */
  readonly lockName: string
  /** Generation whose last committed cut was frozen. */
  readonly generation: number
  /** SHA-256 of the exact committed activity file. */
  readonly activityHash: string
  /** SHA-256 of the complete sorted generation inventory. */
  readonly backupHash: string
  /** Original immutable generation-file inventory. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly sha256: string }>
  /** Original run heads, including all unresolved operations and references. */
  readonly cut: PrototypeActivityCut
}

/** A prepared update names the backup, candidate, and old/new compositions. */
export interface RecoveryUpdateIntent {
  /** Same immutable manifest used for checking and candidate construction. */
  readonly frozen: FrozenRunManifest
  /** Original combination digest. */
  readonly oldPackageHash: string
  /** Candidate combination digest. */
  readonly newPackageHash: string
  /** Sibling backup directory, relative to the control root. */
  readonly backupDirectory: string
  /** Candidate directory, relative to the control root. */
  readonly candidateDirectory: string
  /** Monotonic generation assigned to the candidate. */
  readonly candidateGeneration: number
  /** Complete candidate inventory digest checked before pointer publication. */
  readonly candidateHash: string
}
