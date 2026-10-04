/**
 * Shared bootstrap for the Web testing Runtime suites: a temporary control root,
 * the storage stack routed at the data generation the control root's pointer
 * selects, and the Runtime service itself.
 *
 * The json backend is the routed medium because the unit is a `single`-layout
 * document: one real file at `<dataRoot>/webtest.json` that a suite can read and
 * hash to prove what is and is not durable. Nothing here mocks storage, so every
 * assertion about the head and the project records is made against bytes the
 * backend actually wrote.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import WebTestRuntime, { WEB_TEST_UNIT, canonicalizeControlRoot, resolveDataGeneration } from '../src/index.ts'

/** One booted Runtime and the paths its medium occupies. */
export interface RuntimeHarness {
  /** Context the Runtime plugin is mounted on. */
  readonly ctx: Context
  /** Control root as configured, before alias resolution. */
  readonly controlRoot: string
  /** Canonical control-root path the lock identity derives from. */
  readonly canonicalRoot: string
  /** Data generation directory the json backend is rooted at. */
  readonly dataRoot: string
  /** The mounted Runtime service. */
  readonly runtime: InstanceType<typeof WebTestRuntime>
  /** Absolute path of the single-layout unit document. */
  readonly unitPath: string
  /** Close the domain and release the lock, in that order. */
  stop(): Promise<void>
}

/** Where one suite points a boot, and where its storage backend is rooted. */
export interface StartOptions {
  /** Let the Runtime create a genuinely absent final root instead of preselecting a legacy generation. */
  freshRoot?: boolean
  /** Route Web testing through its own generation backend instead of the shared default. */
  storageMode?: 'configured' | 'generation-json'
  /** Control root to claim; a fresh temporary one by default. */
  controlRoot?: string
  /** Override the backend root instead of following the generation pointer. */
  dataRoot?: string
  /** Request deadline for explicit loopback URL observations. */
  entryUrlProbeTimeoutMs?: number
  /** Cadence for Runtime-owned atomic publications. */
  windowsRenameDelaysMs?: number[]
}

const created: string[] = []

/** Register a directory for removal after the suite. */
export function track(root: string): string {
  created.push(root)
  return root
}

/** Remove every directory the suite created. */
export async function cleanup(): Promise<void> {
  await Promise.all(created.splice(0).map(root => rm(root, { recursive: true, force: true })))
}

/** Create a temporary control root with no data generation pointer yet. */
export async function newControlRoot(): Promise<string> {
  return track(await mkdtemp(join(tmpdir(), 'dsh-webtest-control-')))
}

/**
 * Boot the storage stack and the Runtime over one control root.
 *
 * The backend root is the data generation the control root's pointer selects,
 * which is what makes a generation switch observable: two calls with different
 * pointers put the same domain name on two different medium files while the lock
 * identity stays one.
 * @param options - control root to claim and where to root the backend.
 * @returns the booted harness.
 */
export async function startRuntime(options: StartOptions = {}): Promise<RuntimeHarness> {
  const controlRoot = options.controlRoot ?? (options.freshRoot ? join(await newControlRoot(), 'control') : await newControlRoot())
  const canonicalRoot = options.freshRoot ? undefined : await canonicalizeControlRoot(controlRoot)
  const dataRoot = options.dataRoot ?? (canonicalRoot === undefined
    ? join(dirname(controlRoot), 'shared') : (await resolveDataGeneration(canonicalRoot)).dataRoot)
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(
    { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
    { root: dataRoot },
  )
  await ctx.plugin(
    { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
    { backend: 'json' },
  )
  let fiber
  try {
    fiber = await ctx.plugin(WebTestRuntime, {
      controlRoot, storageMode: options.storageMode ?? 'configured',
      ...(options.entryUrlProbeTimeoutMs === undefined ? {} : { entryUrlProbeTimeoutMs: options.entryUrlProbeTimeoutMs }),
      ...(options.windowsRenameDelaysMs === undefined ? {} : { windowsRenameDelaysMs: options.windowsRenameDelaysMs }),
    })
  }
  catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
  return {
    ctx,
    controlRoot,
    canonicalRoot: canonicalRoot ?? ctx.webTestRuntime.identity().controlRoot,
    dataRoot: options.freshRoot ? ctx.webTestRuntime.identity().dataRoot : dataRoot,
    runtime: ctx.webTestRuntime,
    unitPath: join(dataRoot, `${WEB_TEST_UNIT}.json`),
    stop: async () => { await fiber.dispose() },
  }
}

/**
 * Read the unit document as it currently stands on disk.
 * @param harness - the booted harness whose medium is read.
 * @returns the file's exact bytes, or `undefined` when no write has materialized it.
 */
export async function unitBytes(harness: RuntimeHarness): Promise<Buffer | undefined> {
  return readFile(harness.unitPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
}

/**
 * Build a registration request the contract parser accepts.
 * @param commandId - the command token making the call idempotent.
 * @param overrides - fields to replace, for the parameter-reuse and validation cases.
 * @returns the raw request record.
 */
export function registration(commandId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { commandId, codeRoots: ['C:\\projects\\shop'], entryUrls: ['http://localhost:3000/checkout'], ...overrides }
}
