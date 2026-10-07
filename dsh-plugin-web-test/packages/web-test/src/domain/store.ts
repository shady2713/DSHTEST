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
import { mkdir, readdir } from 'node:fs/promises'
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
 * Principals that keep access when the data root is restricted.
 *
 * SYSTEM and the local Administrators group have to keep it, or the machine
 * loses its own recovery path and the plugin cannot open its own database.
 * @param owner - Account the plugin runs as.
 * @returns the principal names allowed to remain.
 */
export function principalsToKeep(owner: string): string[] {
  return [owner, 'NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators']
}

/**
 * Read the principals an access control entry list currently names.
 *
 * `icacls` prints one entry per line with the path in the first column and the
 * principal after it, separated by a run of spaces wide enough to align the
 * column; an entry continuing the previous path leaves that column blank. A
 * principal can contain a space (`NT AUTHORITY\\SYSTEM`), so the name is taken as
 * everything between the column separator and the rights, which open with a
 * parenthesis.
 * @param output - Standard output of `icacls` on a path.
 * @returns the principal names named by the output, in the order printed.
 */
export function principalsOf(output: string): string[] {
  return output.split('\n').flatMap((line) => {
    const match = /^.*?\s{2,}([^:]+):\(/.exec(line)
    return match === null ? [] : [(match[1] as string).trim()]
  })
}

/**
 * The call that drops every entry a directory inherits from its parent.
 * @param root - Absolute plugin data root to restrict.
 * @returns the argument vector to execute.
 */
export function inheritanceRemovalFor(root: string): string[] {
  return [ICACLS, root, '/inheritance:r']
}

/**
 * The call that takes access away from one named principal.
 *
 * `/inheritance:r` drops inherited entries only. An explicit grant written by an
 * earlier run, or inherited into a file before its parent was changed, stays in
 * place: that is how an explicit `Everyone` read survives a "restricted"
 * directory. Each unwanted principal therefore has to be removed by name.
 * @param root - Absolute plugin data root to restrict.
 * @param principal - Principal to take access from.
 * @returns the argument vector to execute.
 */
export function removalFor(root: string, principal: string): string[] {
  return [ICACLS, root, '/remove:g', principal]
}

/**
 * The call that gives the owning account full control, replacing its own entry.
 * @param root - Absolute plugin data root to restrict.
 * @param owner - Account the plugin runs as.
 * @returns the argument vector to execute.
 */
export function grantFor(root: string, owner: string): string[] {
  return [ICACLS, root, '/grant:r', `${owner}:(OI)(CI)F`]
}

/**
 * The calls that restrict one directory, in the order they have to run.
 *
 * Read the current entries, drop the inherited ones, take access away from every
 * principal that is not the owning account, then write that account's own full
 * control. Reading first is what makes the removal complete rather than a guess.
 * @param root - Absolute plugin data root to restrict.
 * @param current - Standard output of `icacls` on that directory.
 * @param owner - Account the plugin runs as.
 * @returns the argument vectors to execute in order.
 */
export function restrictCommandsForWindows(
  root: string,
  current: string,
  owner: string,
): string[][] {
  const keep = principalsToKeep(owner)
  const unwanted = [...new Set(principalsOf(current).filter(name => !keep.includes(name)))]
  return [
    inheritanceRemovalFor(root),
    ...unwanted.map(name => removalFor(root, name)),
    grantFor(root, owner),
  ]
}

/**
 * Append the recursive form of each call.
 *
 * Restricting a directory only governs what is created afterwards: an existing
 * SQLite database, its write-ahead log and shared-memory file, and the evidence
 * directories from earlier runs keep the entries they were created with.
 * @param commands - Calls produced for one directory.
 * @returns the same calls with `/T` appended, to run against everything under it.
 */
export function restrictTreeCommandsForWindows(commands: string[][]): string[][] {
  return commands.map(argv => [...argv, '/T'])
}

/**
 * Reparse points under the data root, each as an absolute path.
 *
 * `/T` walks into whatever it finds, so a junction planted inside the data root
 * would have its target rewritten even though the target is outside this
 * plugin's directory. The walk stops descending at the first link it meets and
 * reports it, so the caller can fail rather than reach outside.
 * @param root - Absolute plugin data root to walk.
 * @returns the paths of the reparse points found, in walk order.
 */
export async function findReparsePoints(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) found.push(full)
      else if (entry.isDirectory()) await walk(full)
    }
  }
  await walk(root)
  return found
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
 * @param platform - Platform the data root lives on.
 * @param exec - Runs one argument vector and resolves with its standard output.
 * @param owner - Account the plugin runs as.
 * @returns nothing.
 * @throws when the platform refuses the restriction, or when the result still names
 * a principal that must not keep access, so the store does not open over a
 * directory another local account can read.
 */
export async function restrictDataRootToOwner(
  root: string,
  platform: NodeJS.Platform = process.platform,
  exec: (argv: string[]) => Promise<string> = async (argv) =>
    (await execFile(argv[0] as string, argv.slice(1), { windowsHide: true })).stdout,
  owner: string = grantedAccountFor(),
): Promise<void> {
  if (restrictsDirectoryToOwner(platform)) return
  const keep = principalsToKeep(owner)
  try {
    // The root and everything already under it. Evidence directories are created
    // later and inherit from the root, so they need no call of their own.
    // Read first: that read is what makes the removal list complete instead of a
    // guess at which principals are present.
    const current = await exec([ICACLS, root])
    const commands = restrictCommandsForWindows(root, current, owner)
    for (const argv of commands) await exec(argv)
    // A link inside the data root would make /T rewrite a target outside it, so
    // the walk happens before the recursive calls rather than after.
    const links = await findReparsePoints(root)
    if (links.length > 0) {
      throw new Error(
        `web-test: ${root} contains a reparse point (${links[0]}), so the plugin will not`
        + ` rewrite access control entries through it. Remove the link and retry.`,
      )
    }
    // Everything already under the root: the database, its write-ahead log and
    // shared-memory file, and the evidence directories from earlier runs keep the
    // entries they were created with. Evidence created later inherits from the
    // restricted root.
    for (const argv of restrictTreeCommandsForWindows(commands)) await exec(argv)
  } catch (error) {
    throw new Error(
      `web-test: could not restrict ${root} to the current account, so the plugin will not`
      + ` open its database there. ${String(error)}`,
      { cause: error },
    )
  }
  let after: string
  try {
    after = await exec([ICACLS, root, '/T'])
  } catch (error) {
    throw new Error(
      `web-test: could not read back the access control entries of ${root} to confirm that`
      + ` only ${owner} keeps access. ${String(error)}`,
      { cause: error },
    )
  }
  const remaining = [...new Set(principalsOf(after).filter(name => !keep.includes(name)))]
  if (remaining.length > 0) {
    throw new Error(
      `web-test: ${root} still grants access to ${remaining.join(', ')} after restricting it`
      + ` to ${owner}, so the plugin will not open its database there.`,
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
