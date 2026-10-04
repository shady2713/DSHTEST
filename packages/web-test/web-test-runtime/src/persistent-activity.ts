/** Cold, read-only inspection of persisted prototype run heads. */
import { createHash } from 'node:crypto'
import { readFile, realpath, lstat } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep, join } from 'node:path'
import { z } from 'zod'
import { PROTOTYPE_ACTIVITY_FILENAME, prototypeActivitySchema } from './recovery-spec.ts'
import type { PrototypeActivityCut, PrototypeOperationId, PrototypeRunHead } from './recovery-spec.ts'

const pointerSchema = z.object({ generation: z.number().int().positive(), directory: z.string().min(1) }).strict()

/** Empty-plane protocol fingerprint; no business composition is registered until the first run binds its actual digest. */
export const EMPTY_PROTOTYPE_COMPOSITION_HASH = createHash('sha256').update('dsh-webtest-empty-prototype-plane-format-3').digest('hex')

/** Cold observations are incomplete on any read or consistency failure. */
export interface PersistentActivitySnapshot {
  /** Resolved root identity; null when the existing root cannot be resolved. */
  readonly controlRootIdentity: string | null
  /** Wall-clock timestamp of this read. */
  readonly sampledAt: number
  /** Selected generation; null when its pointer cannot be validated. */
  readonly generation: number | null
  /** Committed cut revision; null when no valid cut is available. */
  readonly headRevision: number | null
  /** Durable run heads, independent of loaded Sessions. */
  readonly runHeads: readonly PrototypeRunHead[]
  /** Issued or UNKNOWN operation identities, retained across recovery. */
  readonly unsettledOperationIds: readonly PrototypeOperationId[]
  /** Failures preventing this snapshot from proving inactivity. */
  readonly completenessErrors: readonly string[]
}

/**
 * Resolve only an existing pointer and ordinary contained generation directory.
 * @param controlRoot - existing control root; this function never creates it.
 * @returns canonical identity and the existing selected generation.
 */
export async function readExistingGeneration(controlRoot: string): Promise<{
  controlRootIdentity: string
  generation: number
  dataRoot: string
}> {
  const controlRootIdentity = (await realpath(controlRoot)).toLowerCase()
  const pointerPath = join(controlRootIdentity, 'current.json')
  const pointerState = await lstat(pointerPath)
  if (pointerState.isSymbolicLink() || !pointerState.isFile()) throw new Error('generation pointer is not an ordinary file')
  const pointer = pointerSchema.parse(JSON.parse(await readFile(pointerPath, 'utf8')))
  const dataRoot = await containedOrdinaryDirectory(controlRootIdentity, pointer.directory)
  return { controlRootIdentity, generation: pointer.generation, dataRoot }
}

/**
 * Validate a relative directory without following symlinks or junctions.
 * @param root - resolved root containing the directory.
 * @param directory - relative directory path stored in a durable record.
 * @returns the ordinary directory's absolute path.
 */
export async function containedOrdinaryDirectory(root: string, directory: string): Promise<string> {
  const target = resolve(root, directory)
  const inside = relative(root, target)
  if (isAbsolute(directory) || isAbsolute(inside) || inside === '' || inside === '..' || inside.startsWith(`..${sep}`)) {
    throw new Error('recovery directory escapes the control root')
  }
  let current = root
  for (const component of inside.split(sep)) {
    current = join(current, component)
    const state = await lstat(current)
    if (state.isSymbolicLink() || !state.isDirectory()) throw new Error('recovery directory is not an ordinary directory')
  }
  return target
}

/**
 * Validate a committed cut and the uniqueness needed for cross-run admission.
 * @param dataRoot - existing generation directory.
 * @returns the complete validated cut.
 */
export async function readPrototypeActivity(dataRoot: string): Promise<PrototypeActivityCut> {
  const path = join(dataRoot, PROTOTYPE_ACTIVITY_FILENAME)
  if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) throw new Error('activity cut is not an ordinary file')
  return validatePrototypeActivity(JSON.parse(await readFile(path, 'utf8')))
}

/**
 * Validate durable or imported cuts before publishing any identity ledger.
 * @param value - JSON or explicit prototype-import records.
 * @returns the complete cut with unique run and operation identities.
 */
export function validatePrototypeActivity(value: unknown): PrototypeActivityCut {
  const cut = prototypeActivitySchema.parse(value)
  const runs = new Set<string>()
  const operations = new Set<string>()
  const businessIntents = new Set<string>()
  for (const run of cut.runs) {
    if (runs.has(run.runId)) throw new Error('duplicate run identity')
    runs.add(run.runId)
    for (const operation of run.operations) {
      if (operations.has(operation.operationId)) throw new Error('duplicate operation identity')
      operations.add(operation.operationId)
      const intent = operation.businessIntent
      const key = JSON.stringify([intent.kind, intent.target, intent.parametersHash])
      if (businessIntents.has(key)) throw new Error('duplicate business intent')
      businessIntents.add(key)
      if (operation.status === 'NOT_EXECUTED') {
        const receipt = operation.receipt
        if (receipt.operationId !== operation.operationId || receipt.runId !== run.runId
          || receipt.sessionId !== run.sessionId || receipt.parametersHash !== intent.parametersHash) {
          throw new Error('not-executed receipt does not match original operation')
        }
      }
    }
    if (run.status === 'COMPLETED' && run.operations.some(operation => operation.status !== 'COMPLETED')) {
      throw new Error('completed run has unsettled operations')
    }
  }
  return cut
}

/**
 * Read durable activity without opening a domain, loading Sessions, or writing.
 * @param controlRoot - existing control root whose cold state is inspected.
 * @returns run heads and explicit errors; errors never mean zero activity.
 */
export async function readPersistentActivity(controlRoot: string): Promise<PersistentActivitySnapshot> {
  const sampledAt = Date.now()
  let identity: string | null = null
  let generation: number | null = null
  try {
    const selected = await readExistingGeneration(controlRoot)
    identity = selected.controlRootIdentity
    generation = selected.generation
    const cut = await readPrototypeActivity(selected.dataRoot)
    return {
      controlRootIdentity: identity, sampledAt, generation, headRevision: cut.revision,
      runHeads: cut.runs,
      unsettledOperationIds: cut.runs.flatMap(run => run.operations
        .filter(operation => operation.status === 'ISSUED' || operation.status === 'UNKNOWN').map(operation => operation.operationId)),
      completenessErrors: [],
    }
  }
  catch (error) {
    return {
      controlRootIdentity: identity, sampledAt, generation, headRevision: null,
      runHeads: [], unsettledOperationIds: [], completenessErrors: [String(error)],
    }
  }
}
