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

import { execFile as execFileCallback } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'

import { restrictsDirectoryToOwner } from '../store-service.ts'
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
/** Business-changing operations, durable before the action that causes them. */
export const TABLE_OPERATIONS = 'operations'
/** Cases as analysis proposed them and the operator ruled on them. */
export const TABLE_CASE_PLANS = 'case_plans'

/** Account each role's browser presented, written when a run switches role. */
export const TABLE_ROLE_IDENTITIES = 'role_identities'

/**
 * Absolute path of the plugin-owned data root.
 *
 * `dshHomePath` only joins path segments; it never creates them and never
 * registers the path with the host, so the plugin owns this directory outright.
 * @returns the absolute plugin data root.
 */
const execFile = promisify(execFileCallback)

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
  await restrictDataRootToOwner(root)
  return root
}

/**
 * Program name of the platform's own access control tool.
 *
 * The name has to resolve on its own: passing a shell's `/c` as the program name
 * makes `execFile` look for a program literally called `/c` and fail with ENOENT.
 * @returns the executable to spawn directly, without a shell.
 */
export const ICACLS = 'icacls.exe'

/**
 * The `icacls` call that drops every inherited access control entry on a
 * directory, leaving the current user able to use it.
 *
 * The root is reset rather than edited, so the entries come from the parent
 * directory rather than from whatever a previous run left behind. The directory
 * is named directly and no reparse point is followed into: the target is this
 * plugin's own data root and nothing under it yet.
 * @param root - Absolute plugin data root to restrict.
 * @returns the argument vector to execute.
 */
export function restrictCommandsForWindows(root: string): string[] {
  return [ICACLS, root, '/inheritance:r', '/grant:r', `${grantedAccountFor()}:(OI)(CI)F`]
}

/**
 * The `icacls` call that re-applies the same restriction to everything already
 * under a directory.
 *
 * Restricting the directory itself only governs what is created afterwards: an
 * existing SQLite database, its write-ahead log and shared-memory file, and the
 * evidence directories from earlier runs keep the entries they were created
 * with. Recursion stays inside the plugin's own data root and no reparse point
 * is followed, so nothing outside it is touched.
 * @param root - Absolute plugin data root to walk.
 * @returns the argument vector to execute.
 */
export function restrictTreeCommandsForWindows(root: string): string[] {
  return [...restrictCommandsForWindows(root), '/T']
}

/**
 * Name the operating system recognises for the account running this process.
 * @returns the account name without a domain qualifier.
 */
export function grantedAccountFor(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const name = env['USERNAME'] ?? env['USER'] ?? ''
  // Windows resolves an unqualified account name against its own domain, which
  // is not necessarily the one this process runs in. Naming the domain too is
  // what makes the grant land on the account that owns the directory.
  const domain = env['USERDOMAIN'] ?? ''
  return domain === '' ? name : `${domain}\\${name}`
}

/**
 * Restrict the data root to the account running this process.
 *
 * On Windows a mode passed to `mkdir` is ignored and `chmod` only toggles the
 * read-only bit, so the mode above is recorded but not enforced and the
 * directory keeps the entries it inherits from the plugin parent. There is no
 * POSIX permission interface in Node for this platform, so the only public route
 * is the platform's own tool.
 *
 * @param root - Absolute plugin data root to restrict.
 * @returns nothing.
 * @throws when the platform refuses the restriction, so the store does not open
 * over a directory that is readable by other accounts.
 */
export async function restrictDataRootToOwner(
  root: string,
  platform: NodeJS.Platform = process.platform,
  run: (argv: string[]) => Promise<unknown> = (argv) => execFile(
    argv[0] as string, argv.slice(1), { windowsHide: true },
  ),
): Promise<void> {
  if (restrictsDirectoryToOwner(platform)) return
  try {
    // The root and everything already under it. Evidence directories are created
    // later and inherit from the root, so they need no call of their own.
    await run(restrictCommandsForWindows(root))
    await run(restrictTreeCommandsForWindows(root))
  } catch (error) {
    throw new Error(
      `web-test: could not restrict ${root} to the current account, so the plugin will not`
      + ` open its database there. ${String(error)}`,
      { cause: error },
    )
  }
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
  tables: [
    TABLE_PROJECTS,
    TABLE_ENVIRONMENT_REVISIONS,
    TABLE_RUNS,
    TABLE_POLICIES,
    TABLE_CASE_RESULTS,
    TABLE_OPERATIONS,
    TABLE_CASE_PLANS,
    TABLE_ROLE_IDENTITIES,
  ],
}
