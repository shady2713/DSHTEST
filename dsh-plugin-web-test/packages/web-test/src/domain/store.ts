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

/**
 * Program that reports the account this process runs as, with its identifier.
 *
 * The identifier is what the access control dump speaks in. Resolving the name
 * the operating system already knows this process by is what lets a grant and a
 * removal be compared against the same spelling.
 */
export const WHOAMI = 'whoami.exe'

/** Local system, which always keeps access. */
export const SID_SYSTEM = 'S-1-5-18'
/** The machine's built-in administrators group. */
export const SID_ADMINISTRATORS = 'S-1-5-32-544'
/** Well-known principal that must never keep access to the data root. */
export const SID_EVERYONE = 'S-1-1-0'

/**
 * Aliases a real SDDL string writes in place of a numeric identifier.
 *
 * `icacls /save` does not write `S-1-5-18` for the local system; it writes `SY`,
 * and `BA` for the administrators group, `WD` for everyone. A parser that only
 * looks for a numeric identifier reads a real dump as granting access to nobody,
 * which is how a directory that still had everyone on it came back as
 * restricted. Every alias is resolved to its numeric form so that comparison is
 * against one representation rather than two.
 */
export const SDDL_ALIASES: Readonly<Record<string, string>> = {
  WD: SID_EVERYONE,
  SY: SID_SYSTEM,
  BA: SID_ADMINISTRATORS,
  BU: 'S-1-5-32-545',
  BG: 'S-1-5-32-546',
  IU: 'S-1-5-4',
  IS: 'S-1-5-19',
  RS: SID_SYSTEM,
  SU: SID_ADMINISTRATORS,
  CO: 'S-1-5-29',
  AN: 'S-1-5-7',
  AU: 'S-1-5-11',
  BR: 'S-1-5-32-558',
  PS: 'S-1-5-6',
}

/** Shape of a security identifier, which is a digit-led dash-separated token. */
const SID_PATTERN = /\bS-1-\d+(?:-\d+)+\b/gu
/**
 * The identity field of an access control entry.
 *
 * In `(A;;FA;;;WD)` the fields are separated by semicolons and the identity is
 * the last of them. It is not wrapped in parentheses of its own, which is why a
 * reader looking for `(WD)` never finds it.
 */
const IDENTITY_FIELD = /;;;([^();]+)(?=[^()]*\))/gu
/** One parenthesised entry of a descriptor, allowing nested flags in its middle. */
const ENTRY_PATTERN = /\((?:[^()]|\([^()]*\))*\)/gu

/**
 * Decode an access control dump into text.
 *
 * `icacls /save` writes UTF-16LE, and on the machine this was first observed it
 * wrote it without a byte order mark. Reading that as UTF-8 yields replacement
 * characters between every character, so a scan for identifiers finds none and
 * the caller concludes the tree grants access to nobody: the function reports
 * success over a directory it never actually read. Deciding by byte pattern
 * rather than by declared encoding is what makes a missing mark harmless.
 * @param raw - The file's bytes exactly as read.
 * @returns the dump as text.
 */
export function decodeAclDump(raw: Buffer): string {
  // A marked document says what it is, so trust it and drop the mark.
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return raw.subarray(2).toString('utf16le')
  }
  // Otherwise decide by the bytes: a UTF-16LE ASCII document interleaves every
  // ASCII byte with a NUL. That holds whether or not a mark said so, which is the
  // case that matters — the machine this was first observed on wrote no mark.
  if (raw.length >= 2 && raw[1] === 0x00) return raw.toString('utf16le')
  return raw.toString('utf8')
}

/**
 * Resolve every identity a descriptor names to a numeric identifier.
 * @param descriptor - One parenthesised entry of an access control descriptor.
 * @returns the identifiers it names, aliases resolved, duplicates dropped.
 */
export function sidsOfDescriptor(descriptor: string): string[] {
  const found = [...descriptor.matchAll(IDENTITY_FIELD)]
    .map(match => resolveIdentity(match[1] as string))
  return [...new Set(found.filter((sid): sid is string => sid !== undefined))]
}

/**
 * Turn one identity field into a numeric identifier.
 * @param token - A field from an access control entry, as the platform wrote it.
 * @returns the identifier, or `undefined` when the field names no known identity.
 */
export function resolveIdentity(token: string): string | undefined {
  const trimmed = token.trim()
  if (/^S-1-\d+(?:-\d+)+$/u.test(trimmed)) return trimmed
  return SDDL_ALIASES[trimmed]
}

/**
 * Security identifiers an access control dump grants access to.
 *
 * Only real entries are read. A file with no descriptor in it is not evidence
 * that the tree grants access to nobody, and treating it that way is how an
 * unreadable dump turned into a clean bill of health.
 * @param dump - Decoded contents of an `icacls /save` file.
 * @returns every distinct identifier the dump grants access to.
 * @throws when the dump carries no descriptor at all, because that means the
 * file was not the expected format and nothing about the tree is known.
 */
export function sidsOfAclDump(dump: string): string[] {
  const entries = dump.match(ENTRY_PATTERN) ?? []
  if (entries.length === 0) {
    throw new Error('web-test: the access control dump carried no entries, so the directory'
      + ' could not be read and nothing about its permissions is known')
  }
  return [...new Set(entries.flatMap(entry => sidsOfDescriptor(entry)))]
}

/**
 * Security identifiers the data root keeps access for.
 *
 * SYSTEM and the machine administrators keep it so there is still a recovery path
 * if the owning account's own entry is damaged. All three are compared as numeric
 * identifiers, never as display names: a display name is localized, and comparing
 * names is what let an explicit everyone entry survive a directory reported as
 * restricted.
 * @param ownerSid - Numeric identifier of the account the plugin runs as.
 * @returns the identifiers allowed to remain.
 */
export function sidsToKeep(ownerSid: string): string[] {
  return [ownerSid, SID_SYSTEM, SID_ADMINISTRATORS]
}

/**
 * Every security identifier a tree grants access to, including paths other than
 * its root.
 *
 * Reading only the root is not enough. An entry written on a file before its
 * parent was restricted keeps that file readable afterwards, which is exactly how
 * an explicit everyone grant survives on a child while the root looks clean.
 * @param dump - Decoded contents of an `icacls /save` file covering the tree.
 * @returns the identifiers the dump names.
 */
export function sidsInTree(dump: string): string[] {
  return sidsOfAclDump(dump)
}

/**
 * A deliberately lenient scan used only to check a result.
 *
 * This asks whether any identity at all is left that must not keep access. It
 * shares no enumeration with the code that decided what to remove, so a defect in
 * that enumeration cannot also decide that the check passed.
 * @param dump - Decoded contents of an `icacls /save` file.
 * @returns every identity named, in either spelling, numeric or aliased.
 */
export function anySidsPresent(dump: string): string[] {
  // Deliberately a different reading of the same text: it takes the last field
  // of every entry directly, where the restriction resolves identifiers through
  // the alias table. A defect in one is not automatically a defect in the other.
  const entries = dump.match(/\([^()]*\)/gu) ?? []
  const found: string[] = []
  for (const entry of entries) {
    const fields = entry.replace(/^\(|\)$/gu, '').split(';')
    const last = fields[fields.length - 1]?.trim() ?? ''
    if (last === '') continue
    const resolved = /^(?:S-1-\d+)(?:-\d+)+$/u.test(last) ? last : SDDL_ALIASES[last]
    if (resolved !== undefined) found.push(resolved)
  }
  return [...new Set(found)]
}

/**
 * The security identifier an account has, read from the output of `whoami /user`.
 *
 * Only the identifier itself is used. The surrounding words are localized, so
 * finding the identifier by its own syntax keeps this working on a machine whose
 * `whoami` output this code has never seen.
 * @param output - Standard output of `whoami /user`.
 * @returns the identifier named by the output.
 * @throws when the output names no identifier.
 */
export function sidOfAccount(output: string): string {
  const found = output.match(SID_PATTERN)
  if (found === null || found[0] === undefined) {
    throw new Error('web-test: no security identifier in the account query output')
  }
  return found[0]
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
  // The leading `*` is what tells the tool to read the rest as an identifier
  // rather than look it up as an account name. Without it a numeric identifier
  // is resolved as a name and the grant lands on nothing.
  const named = /^S-1-\d+(?:-\d+)+$/u.test(owner) ? `*${owner}` : owner
  return [ICACLS, root, '/grant:r', `${named}:(OI)(CI)F`]
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
  ownerSid: string,
): string[][] {
  const keep = sidsToKeep(ownerSid)
  const unwanted = [...new Set(sids.filter(sid => !keep.includes(sid)))]
  return [
    grantFor(root, ownerSid),
    inheritanceRemovalFor(root),
    ...unwanted.map(sid => removalFor(root, sid)),
    // `/inheritance:r` drops the entries a directory inherited, and the machine's
    // own system and administrators entries are among them. Keeping a principal
    // in the comparison only stops it from being removed; it does not put an
    // entry back. The grant below is what actually keeps them, which is the
    // difference between a stated policy and an implemented one.
    grantFor(root, SID_SYSTEM),
    grantFor(root, SID_ADMINISTRATORS),
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
    return decodeAclDump(await readFile(file))
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
  ownerSid?: string,
): Promise<void> {
  if (restrictsDirectoryToOwner(platform)) return
  // The account has to be named the same way the dump names it. The dump speaks
  // in numeric identifiers, so a caller that supplies a `DOMAIN\\USERNAME` name
  // is asking to have that name compared against identifiers it can never equal:
  // the result is a removal command aimed at the owner's own entry, issued
  // because the two spellings never matched.
  const account = ownerSid ?? sidOfAccount(await exec([WHOAMI, '/user']))
  const keep = sidsToKeep(account)
  const recover = async (): Promise<void> => {
    // Recovery is not a best effort: a directory left without an entry for the
    // account that has to write there is worse than the failure that caused it,
    // and silently swallowing a failed recovery would report success over a
    // directory nobody can use.
    await exec(restrictTreeCommandsForWindows([
      grantFor(root, account),
      grantFor(root, SID_SYSTEM),
      grantFor(root, SID_ADMINISTRATORS),
    ])[0] as string[])
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
  const commands = restrictCommandsForWindows(root, sidsInTree(before), account)
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
      + ` only ${account} keeps access. ${String(error)}`,
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
      + ` to ${account}, so the plugin will not open its database there.`,
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
