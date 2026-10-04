/**
 * The plugin's own durable storage.
 *
 * Business records live in one KV unit owned by this plugin, never in DSH
 * shared attachments and never in session state. The unit is declared with the
 * `single` layout on purpose: that layout stores the whole unit as one
 * version-stamped document and the backend *rejects* an open whose stamped
 * version is unknown, which is what authoritative business data needs. The
 * `per-record` layout would instead discard a record it cannot read and let the
 * open succeed, turning a schema mismatch into apparent data loss.
 *
 * The unit is opened straight on this plugin's SQLite backend rather than
 * through the host's Storage Domain. Domain routing is a host `Config`
 * decision (`backend` plus per-domain `routes`), so a domain opened that way
 * lands on whatever backend the host routes `web_test` to — in a stock profile
 * that is the JSON backend, and this plugin's own database would stay empty.
 * Reaching for the backend by name keeps the data in the plugin's own file
 * without the plugin having to rewrite a host-owned row.
 *
 * @module dsh-plugin-web-test/domain/store
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { SCHEMA_VERSION } from '../records.ts'

/** Plugin-owned data root name under `$DSH_HOME/plugins`. */
export const DATA_ROOT_NAME = 'dsh-plugin-web-test'

/** Unit name; also the file-name and SQL-identifier segment, so it stays unique. */
export const DOMAIN_NAME = 'web_test'

/**
 * Storage backend name registered by this plugin's own bundle row.
 *
 * Named here rather than read from configuration because the plugin owns the
 * row that registers it; a host that never mounted it fails loud at open.
 */
export const BACKEND_NAME = 'sqlite'

/** Record kind keys; each is also a declared table name in the unit. */
export const TABLE_PROJECTS = 'projects'
/** Environment revisions the operator confirmed for a project. */
export const TABLE_ENVIRONMENT_REVISIONS = 'environment_revisions'
/** Test runs, their phases, and their evidence index. */
export const TABLE_RUNS = 'runs'
/** Project-level execution policy. */
export const TABLE_POLICIES = 'policies'
/** Structured per-case results produced by a test run. */
export const TABLE_CASE_RESULTS = 'case_results'

/**
 * Absolute path of the plugin-owned data root.
 *
 * `dshHomePath` only joins path segments; it never creates them and never
 * registers the path with the host, so the plugin owns this directory outright.
 * @returns the absolute plugin data root.
 */
export function dataRoot(): string {
  return dshHomePath('plugins', DATA_ROOT_NAME)
}

/**
 * Create the plugin data root if absent, owner-only.
 *
 * Evidence and business data stay out of reach of other accounts on the
 * machine, which is also what the SQLite backend documents for its own files.
 * @returns the absolute plugin data root.
 * @throws when the directory cannot be created with owner-only permissions.
 */
export async function ensureDataRoot(): Promise<string> {
  const root = dataRoot()
  await mkdir(root, { recursive: true, mode: 0o700 })
  return root
}

/**
 * Path of the plugin's own SQLite database.
 *
 * The path is a plain join under the data root, so the bundle's
 * `cordis.patch.yml` can point the backend here without the plugin reading
 * Host configuration at runtime.
 * @returns the absolute database path.
 */
/** Sub-directory of the data root that holds run evidence. */
export const EVIDENCE_DIR = 'evidence'

/** File path of the SQLite medium. */
export function databasePath(): string {
  return join(dataRoot(), 'web-test.sqlite')
}

/**
 * The directory a run's evidence belongs in.
 *
 * Evidence is the plugin's own record of what a test actually did, so it lives
 * under the plugin's data root rather than wherever the browser happened to
 * write a file.
 * @param runKey - Run whose evidence directory to locate.
 * @returns the absolute directory path for that run.
 */
export function evidenceDir(runKey: string): string {
  return join(dataRoot(), EVIDENCE_DIR, runKey)
}

/**
 * The plugin's unit declaration.
 *
 * Declared once at module load so a malformed descriptor fails loud before any
 * medium is touched. `single` keeps reads at an exact version match, so a
 * database written by a newer plugin build refuses to open instead of reading
 * as empty.
 */
export const WEB_TEST_UNIT: KvUnitDescriptor = {
  name: DOMAIN_NAME,
  version: SCHEMA_VERSION,
  layout: 'single',
  hasGlobal: false,
  tables: [TABLE_PROJECTS, TABLE_ENVIRONMENT_REVISIONS, TABLE_RUNS, TABLE_POLICIES, TABLE_CASE_RESULTS],
}
