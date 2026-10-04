/**
 * The control root: the one stable directory whose identity decides who may
 * write, independent of which data generation is currently selected.
 *
 * Two things live here and they must not be confused. The control root itself
 * is permanent: it is where the data-generation pointer is kept, and the write
 * lock's identity is a digest of ITS resolved path. The data generation the
 * pointer selects is replaceable — an upgrade switches it — so nothing about
 * the lock may depend on which one is active. That separation is what lets a
 * second launch after an upgrade contend for the same lock instead of opening a
 * second write channel on a fresh directory.
 *
 * "Resolved" means the final directory, not the path a caller spelled: a
 * junction or symlink alias of the same directory has the same real path, so
 * aliases collapse onto one lock. The canonical form is case-folded because the
 * only kernel object it feeds is a Windows named object, whose namespace is
 * case-insensitive; two spellings differing only in case are one lock.
 *
 * @module @deepseek-ai/dsh-web-test-runtime/control-root
 */

import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

/** File inside the control root naming the active data generation. */
export const CONTROL_POINTER_FILENAME = 'current.json'

/** Directory inside the control root that holds one subdirectory per generation. */
export const DATA_DIRECTORY_NAME = 'data'

/** Object-name prefix of the control-root write lock. */
export const CONTROL_LOCK_PREFIX = 'Global\\dsh-webtest-control-'

/** Stored data-generation pointer. */
const pointerSchema = z.object({
  generation: z.number().int().positive(),
  directory: z.string().min(1),
}).strict()

/** The active data generation: which number it is and where it lives. */
export interface DataGeneration {
  /** Monotonic generation number recorded in the pointer. */
  readonly generation: number
  /** Absolute path of that generation's data directory. */
  readonly dataRoot: string
}

/** Root identity and evidence that this process exclusively created its final directory. */
export interface PreparedControlRoot {
  /** Alias-resolved, case-folded directory identity. */
  readonly canonicalRoot: string
  /** True only when this call created the final directory rather than following an existing path. */
  readonly created: boolean
}

/** Initial generation registration performed while the caller holds the control-root lock. */
export interface FreshGenerationRegistration {
  /** Creation result from prepareControlRoot; absence of a pointer alone is insufficient. */
  readonly rootCreated: boolean
  /** Commit the complete initial activity before the generation pointer becomes visible. */
  readonly initialize: (generation: DataGeneration) => Promise<void>
}

/**
 * Atomically create only a previously absent final root and resolve its identity.
 * @param controlRoot - Configured root; parents may be created without claiming existing history.
 * @returns Identity and whether this process created the final root.
 */
export async function prepareControlRoot(controlRoot: string): Promise<PreparedControlRoot> {
  const absolute = resolve(controlRoot)
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 })
  let created = false
  try {
    await mkdir(absolute, { mode: 0o700 })
    created = true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return { canonicalRoot: (await realpath(absolute)).toLowerCase(), created }
}

/**
 * Derive the write lock's object name from a control root's canonical path.
 *
 * The only input is the canonical control-root path. No application identity,
 * version, profile, or data generation takes part, so the same control root
 * always yields the same name — which is what makes two launches of different
 * application builds contend rather than run side by side.
 * @param canonicalRoot - alias-resolved, case-folded control-root path.
 * @returns the full Windows kernel object name of the control lock.
 */
export function controlLockName(canonicalRoot: string): string {
  const digest = createHash('sha256').update(canonicalRoot, 'utf8').digest('hex')
  return `${CONTROL_LOCK_PREFIX}${digest}`
}

/**
 * Resolve a control root to its final identity, creating it when absent.
 *
 * The directory is created owner-only and then resolved through `realpath`, so
 * a caller may pass a path that contains a junction, a symlink, or a
 * differently-cased spelling and still get the one identity every other writer
 * computes.
 * @param controlRoot - the control-root directory as configured.
 * @returns the canonical, case-folded control-root path.
 */
export async function canonicalizeControlRoot(controlRoot: string): Promise<string> {
  const absolute = resolve(controlRoot)
  await mkdir(absolute, { recursive: true, mode: 0o700 })
  return (await realpath(absolute)).toLowerCase()
}

/**
 * Read the active data generation, creating the first one when the control root
 * has no pointer yet.
 *
 * A pointer that names a directory outside the control root is rejected: the
 * pointer is a file the data root's owner can edit, and following it out of the
 * control root would let a corrupted or edited pointer move the write lock's
 * medium somewhere the lock identity does not describe.
 * @param canonicalRoot - canonical control-root path from {@link canonicalizeControlRoot}.
 * @param registration - Optional first-generation activity registration, for a root this process created.
 * @returns the active generation and its absolute data directory.
 * @throws when the stored pointer is unreadable, malformed, or escapes the control root.
 */
export async function resolveDataGeneration(canonicalRoot: string, registration?: FreshGenerationRegistration): Promise<DataGeneration> {
  const pointerPath = join(canonicalRoot, CONTROL_POINTER_FILENAME)
  const stored = await readPointer(pointerPath)
  if (stored !== undefined) {
    const dataRoot = resolve(canonicalRoot, stored.directory)
    const inside = relative(canonicalRoot, dataRoot)
    if (isAbsolute(inside) || inside === '' || inside === '..' || inside.startsWith(`..${sep}`)) {
      throw new Error(`control root '${canonicalRoot}': data pointer '${stored.directory}' resolves outside it`)
    }
    const resolvedRoot = await ensureDataDirectory(canonicalRoot, dataRoot)
    return { generation: stored.generation, dataRoot: resolvedRoot }
  }
  if (registration !== undefined && (!registration.rootCreated || (await readdir(canonicalRoot)).length > 0)) {
    throw new Error('control root has unregistered existing history; fresh activity initialization is refused')
  }
  const directory = `${DATA_DIRECTORY_NAME}/${String(1)}`
  const dataRoot = join(canonicalRoot, DATA_DIRECTORY_NAME, '1')
  const resolvedRoot = await ensureDataDirectory(canonicalRoot, dataRoot)
  const generation = { generation: 1, dataRoot: resolvedRoot }
  await registration?.initialize(generation)
  await writeFile(pointerPath, `${JSON.stringify({ generation: 1, directory })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return generation
}

/** Create generation directories without following a symlink or junction out of the locked root. */
async function ensureDataDirectory(canonicalRoot: string, dataRoot: string): Promise<string> {
  let current = canonicalRoot
  for (const component of relative(canonicalRoot, dataRoot).split(sep)) {
    current = join(current, component)
    let state
    try {
      state = await lstat(current)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(current, { mode: 0o700 })
      state = await lstat(current)
    }
    if (state.isSymbolicLink() || !state.isDirectory()) {
      throw new Error(`control root '${canonicalRoot}': data directory '${current}' is not an ordinary directory`)
    }
  }
  const resolved = await realpath(dataRoot)
  const inside = relative(canonicalRoot, resolved)
  if (isAbsolute(inside) || inside === '' || inside === '..' || inside.startsWith(`..${sep}`)) {
    throw new Error(`control root '${canonicalRoot}': resolved data directory escapes the locked root`)
  }
  return resolved
}

/**
 * Read the generation pointer, treating an absent file as "never selected".
 * @param pointerPath - absolute path of the pointer file.
 * @returns the parsed pointer, or `undefined` when no pointer exists yet.
 * @throws when the file exists but is not a valid pointer.
 */
async function readPointer(pointerPath: string): Promise<z.infer<typeof pointerSchema> | undefined> {
  let text: string
  try {
    text = await readFile(pointerPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`control pointer '${pointerPath}' is not JSON: ${String(error)}`, { cause: error })
  }
  const result = pointerSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`control pointer '${pointerPath}' is not a data-generation pointer: ${result.error.message}`)
  }
  return result.data
}
