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
import { lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises'
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

/** Local system, which always keeps access. */
export const SID_SYSTEM = 'S-1-5-18'
/** The machine's built-in administrators group. */
export const SID_ADMINISTRATORS = 'S-1-5-32-544'
/** Well-known principal that must never keep access to the data root. */
export const SID_EVERYONE = 'S-1-1-0'

/** Shape of a security identifier, which is a digit-led dash-separated token. */
const SID_PATTERN = /\bS-1-\d+(?:-\d+)+\b/gu

/**
 * Security identifiers the data root keeps access for.
 *
 * SYSTEM and the machine administrators keep it so there is still a recovery path
 * if the owning account's own entry is damaged. Both are identified by their
 * well-known SID rather than by their display name, because a display name is
 * localized: the same account reads `NT AUTHORITY\SYSTEM` on an English machine
 * and something else elsewhere, and comparing names is what let an explicit
 * `Everyone` entry survive a directory that was reported as restricted.
 * @param owner - Security identifier of the account the plugin runs as.
 * @returns the identifiers allowed to remain.
 */
export function sidsToKeep(owner: string): string[] {
  return [owner, SID_SYSTEM, SID_ADMINISTRATORS]
}

/**
 * The security identifier an account has, read from the output of `whoami /user`.
 *
 * Only the identifier itself is used. The surrounding words are localized, so
 * finding the SID by its own syntax keeps this working on a machine whose
 * `whoami` output this code has never seen.
 * @param output - Standard output of `whoami /user`.
 * @returns the identifier named by the output.
 * @throws when the output names no identifier.
 */
export function sidOfAccount(output: string): string {
  const found = SID_PATTERN.exec(output)
  if (found === null) {
    throw new Error(`web-test: no security identifier in the account query output`)
  }
  return found[0]
}

/**
 * Security identifiers an ACL dump grants access to.
 *
 * `icacls /save` writes one line per path, each holding a descriptor in the form
 * `D:(A;;FA;;;S-1-5-18)`. That form is fixed by the platform rather than by the
 * machine's display settings, and it names every entry by identifier, so this
 * reads the whole tree the dump covered, not only the first path's line.
 * @param dump - Contents of an `icacls /save` file.
 * @returns every distinct identifier the dump grants access to.
 */
export function sidsOfAclDump(dump: string): string[] {
  return [...new Set(dump.match(SID_PATTERN) ?? [])]
}

/**
 * Every security identifier a tree grants access to, including paths other than
 * its root.
 *
 * Reading only the root is not enough. An entry written on a file before its
 * parent was restricted keeps that file readable afterwards, which is exactly how
 * an explicit `Everyone` grant survives on a child while the root looks clean.
 * @param dump - Contents of an `icacls /save` file covering the whole tree.
 * @returns the identifiers the dump names.
 */
export function sidsInTree(dump: string): string[] {
  return sidsOfAclDump(dump)
}

/**
 * A deliberately lenient scan used only to check a result.
 *
 * This collects identities rather than enumerating them: any identifier at all
 * in the tree has to be one of the ones allowed to remain. The restriction itself
 * decides what to remove from {@link sidsToKeep}, so a defect in that enumeration
 * cannot also decide that the check passed.
 * @param dump - Contents of an `icacls /save` file.
 * @returns identifiers present in the dump.
 */
export function anySidsPresent(dump: string): string[] {
  return [...new Set(dump.replace(/[^A-Za-z0-9-]/gu, ' ').split(/\s+/u)
    .filter(token => /^S-1-\d+(-\d+)+$/u.test(token)))]
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
 * The call that takes access away from one identity.
 *
 * `/inheritance:r` drops inherited entries only. An explicit grant written by an
 * earlier run, or inherited into a file before its parent was changed, stays in
 * place: that is how an explicit `Everyone` read survives a "restricted"
 * directory. Each unwanted identity therefore has to be removed by name.
 *
 * The name is a SID with the leading `*` that tells `icacls` to read it as an
 * identifier rather than look it up as an account name. That avoids depending on
 * a localized display name; the `*` form has not been exercised on Windows.
 * @param root - Absolute plugin data root to restrict.
 * @param sid - Security identifier to take access from.
 * @returns the argument vector to execute.
 */
export function removalFor(root: string, sid: string): string[] {
  return [ICACLS, root, '/remove:g', `*${sid}`]
}

/**
 * The call that gives the owning account full control, replacing its own entry.
 * @param root - Absolute plugin data root to restrict.
 * @param owner - Account name or security identifier the plugin runs as.
 * @returns the argument vector to execute.
 */
export function grantFor(root: string, owner: string): string[] {
  return [ICACLS, root, '/grant:r', `${owner}:(OI)(CI)F`]
}

/**
 * The calls that restrict one directory, in the order they have to run.
 *
 * The owner is granted first, on purpose. A removal that fails partway through
 * used to leave the directory with no entry for the account running the plugin:
 * `/inheritance:r` had already run and the grant that came after the removals
 * never did, so the plugin could not write to its own data root and the caller's
 * account was worse off than before the call. Granting first means the owning
 * account's access is established before anything is taken away, and stays
 * established if a later step throws.
 * @param root - Absolute plugin data root to restrict.
 * @param sids - Identifiers the tree currently grants access to.
 * @param owner - Account the plugin runs as.
 * @returns the argument vectors to execute in order.
 */
export function restrictCommandsForWindows(
  root: string,
  sids: string[],
  owner: string,
): string[][] {
  const keep = sidsToKeep(owner)
  const unwanted = [...new Set(sids.filter(sid => !keep.includes(sid)))]
  return [
    grantFor(root, owner),
    inheritanceRemovalFor(root),
    ...unwanted.map(sid => removalFor(root, sid)),
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
 * Reparse points at or under the data root, each as an absolute path.
 *
 * `/T` walks into whatever it finds, so a junction planted inside the data root
 * would have its target rewritten even though the target is outside this
 * plugin's directory. The root itself is checked as well: a data root that is a
 * link would send every call through it. An enumeration that fails stops the walk
 * and is reported, because a walk that quietly returns fewer paths than there are
 * would let the restriction proceed over a tree it never actually inspected.
 * @param root - Absolute plugin data root to walk.
 * @returns the paths of the reparse points found, in walk order.
 * @throws when a directory under the root cannot be read.
 */
export async function findReparsePoints(root: string): Promise<string[]> {
  const found: string[] = []
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink()) found.push(root)
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
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
 * Read a tree's access control entries through the platform's ACL dump.
 *
 * `icacls` in its default mode prints a table laid out for a human to read: the
 * first entry on a path is separated from that path by a single space, not by the
 * run of spaces the later columns use, so a parser that looks for a wide gap
 * silently loses the first entry — and it loses it for the very path the caller
 * asked about. `/save` writes the same entries as descriptors that name every
 * principal by identifier, one line per path, in a form fixed by the platform
 * rather than by the machine's display language.
 * @param root - Absolute plugin data root to read.
 * @param exec - Runs one argument vector and resolves with its standard output.
 * @returns the contents of the ACL dump covering the root and everything under it.
 */
async function readAclDump(
  root: string,
  exec: (argv: string[]) => Promise<string>,
): Promise<string> {
  const file = join(root, '.web-test-acl-dump')
  try {
    await exec([ICACLS, root, '/save', file, '/t'])
    return await readFile(file, 'utf8')
  } finally {
    await rm(file, { force: true }).catch(() => {})
  }
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
 * The owning account is granted full control before anything is taken away and
 * is granted again if a later step fails, so an interrupted call never leaves the
 * directory without an entry for the account that has to write there.
 *
 * @param root - Absolute plugin data root to restrict.
 * @param platform - Platform the data root lives on.
 * @param exec - Runs one argument vector and resolves with its standard output.
 * @param owner - Account the plugin runs as.
 * @returns nothing.
 * @throws when the platform refuses the restriction, or when the result still names
 * an identity that must not keep access, so the store does not open over a
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
  const keep = sidsToKeep(owner)
  const recover = async (): Promise<void> => {
    try {
      await exec(restrictTreeCommandsForWindows([grantFor(root, owner)])[0] as string[])
    } catch { /* the original failure is the one worth reporting */ }
  }
  // A link inside the data root, or the root itself, would make /T rewrite a
  // target outside it. The walk happens before any recursive call, and it fails
  // loudly: a walk that returned fewer paths than there are would let the
  // restriction proceed over a tree it never inspected.
  let links: string[]
  try {
    links = await findReparsePoints(root)
  } catch (error) {
    throw new Error(
      `web-test: could not inspect ${root} for reparse points, so the plugin will not`
      + ` rewrite access control entries through it. ${String(error)}`,
      { cause: error },
    )
  }
  if (links.length > 0) {
    throw new Error(
      `web-test: ${root} contains a reparse point (${links[0]}), so the plugin will not`
      + ' rewrite access control entries through it. Remove the link and retry.',
    )
  }
  // Read the whole tree through the platform's own ACL dump. The dump names every
  // entry by identifier and covers each existing child, which is what makes the
  // removal list complete rather than a guess at which identities are present.
  const before = await readAclDump(root, exec)
  const commands = restrictCommandsForWindows(root, sidsInTree(before), owner)
  try {
    for (const argv of commands) await exec(argv)
    // Everything already under the root: the database, its write-ahead log and
    // shared-memory file, and the evidence directories from earlier runs keep the
    // entries they were created with. Evidence created later inherits from the
    // restricted root.
    for (const argv of restrictTreeCommandsForWindows(commands)) await exec(argv)
  } catch (error) {
    await recover()
    throw new Error(
      `web-test: could not restrict ${root} to the current account, so the plugin will not`
      + ` open its database there. ${String(error)}`,
      { cause: error },
    )
  }
  let after: string
  try {
    after = await readAclDump(root, exec)
  } catch (error) {
    await recover()
    throw new Error(
      `web-test: could not read back the access control entries of ${root} to confirm that`
      + ` only ${owner} keeps access. ${String(error)}`,
      { cause: error },
    )
  }
  // The check deliberately does not reuse the enumeration that decided what to
  // remove. It asks only whether any identifier at all is left that must not keep
  // access, so a defect in that enumeration cannot also decide this passed.
  const remaining = anySidsPresent(after).filter(sid => !keep.includes(sid))
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
