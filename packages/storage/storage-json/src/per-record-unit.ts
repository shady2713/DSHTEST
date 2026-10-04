/**
 * One opened JSON unit in `per-record` layout: the unit is a directory at
 * `dir`, holding one document per record under `<dir>/<table>/<key>.json`
 * plus `global.json` for the global slot. The directory is the state — this
 * unit holds NO in-memory state of its own: `loadAll` re-reads the tree and
 * every write is one durable file operation. The domain layer owns the live
 * in-memory tables (seeded by the open-time `loadAll`) and serializes writes
 * through its write chain, so this unit never mutates memory and needs no
 * rollback — a failed write simply leaves both the file and the domain's
 * memory unchanged.
 *
 * Per-record contract: a record document that is malformed or stamped with a
 * version outside the accepted set (the descriptor's current version plus
 * its `compatibleVersions`) reads as an absent record — one bad or stale
 * file never bricks the whole unit, and an unaccepted version stamp discards
 * the record instead of migrating it. Record keys become path segments, so
 * they must be path-safe (`[a-zA-Z0-9_-]+`); an unsafe key rejects at write.
 *
 * Legacy bootstrap: when the new tree has no document path, a legacy
 * whole-unit file `<root>/<name>.json` (the pre-per-record layout) seeds
 * per-record documents, provided its stored unit version is in the accepted
 * set — a legacy file stamped with any other version is left alone and reads
 * as the empty unit. Any new document path, including one whose contents are
 * unreadable or stale, suppresses the bootstrap for the whole unit. The
 * legacy file is never changed or deleted.
 * @module @deepseek-ai/dsh-storage-json/src/per-record-unit
 */

import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Dirent } from 'node:fs'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { writeAtomic } from './atomic.ts'
import type { AtomicWritePolicy } from './atomic.ts'
import { parseRecord, serializeRecord } from './format.ts'
import type { UnitState } from './format.ts'

/** Keys become path segments in this layout; this set is path-safe on every OS. */
const SAFE_KEY_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Document reads in flight at once while loading a unit. Tables load one after
 * another, so this is the whole unit's budget rather than one table's: a single
 * unbounded burst outran the process handle budget on Windows, and each
 * resulting `EMFILE` read looked like an absent record, so a table of 10,000
 * records silently lost 1,811 of them. Batching per table alone is not enough,
 * because the table directories themselves are read concurrently.
 */
const READ_BATCH_SIZE = 64

/**
 * Open one `per-record`-layout unit under `root`: the unit directory is
 * `<root>/<name>/`. Loads lazily on the first `loadAll` — this unit holds no
 * state, so opening touches nothing on the medium.
 * @param descriptor - Static identity and shape of the unit.
 * @param root - Absolute backend root directory.
 * @param onClose - Backend callback releasing the unit's open-slot.
 * @param policy - Windows rename retry cadence for every document write.
 * @returns the opened unit.
 */
// oxlint-disable-next-line typescript/require-await -- async keeps both openers' call sites uniform
export async function openPerRecordUnit(
  descriptor: KvUnitDescriptor,
  root: string,
  onClose: () => void,
  policy: AtomicWritePolicy,
): Promise<KvUnit> {
  return new PerRecordJsonUnit(descriptor, join(root, descriptor.name), onClose, policy)
}

/**
 * Read every record document under the unit directory: each declared table's
 * `<key>.json` files plus `global.json`. A missing directory is the empty
 * unit (materialization defers to the first write); a foreign document
 * (missing, unreadable, malformed, or stamped with an unaccepted version)
 * reads as an absent record, per the per-record contract. Table directories
 * load one at a time under a unit-wide read budget, and running out of file
 * handles fails the load instead of masquerading as absence.
 * @param descriptor - Static identity and shape of the unit.
 * @param dir - Absolute unit directory path.
 * @param policy - Windows rename retry cadence for every document write.
 * @returns the authoritative state reconstructed from the tree.
 */
async function loadPerRecordState(descriptor: KvUnitDescriptor, dir: string, policy: AtomicWritePolicy): Promise<UnitState> {
  const versions = acceptedStamps(descriptor)
  const state: UnitState = {
    version: descriptor.version,
    global: null,
    tables: new Map(descriptor.tables.map(table => [table, new Map<string, unknown>()])),
  }
  let entries: Dirent[] | undefined
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Missing directory = empty unit; the legacy bootstrap below still runs
    // (the fresh-upgrade shape is exactly an absent new tree).
  }
  const hasNewDocuments = entries === undefined
    ? false
    : await loadEntriesSequentially(entries, descriptor, dir, state, versions)
  if (!hasNewDocuments) await bootstrapLegacyUnit(descriptor, dir, state, policy)
  return state
}

/**
 * Load every table directory and the global document one at a time, so the
 * concurrent reads of a whole unit stay at {@link READ_BATCH_SIZE} rather than
 * multiplying by the table count. Returns whether the unit tree held any
 * document path, which is what suppresses the legacy bootstrap.
 */
async function loadEntriesSequentially(
  entries: readonly Dirent[],
  descriptor: KvUnitDescriptor,
  dir: string,
  state: UnitState,
  versions: readonly number[],
): Promise<boolean> {
  let hasNewDocuments = false
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const records = state.tables.get(entry.name)
      if (records !== undefined) {
        hasNewDocuments = await loadTableRecords(records, versions, join(dir, entry.name)) || hasNewDocuments
      }
      continue
    }
    if (entry.name === 'global.json' && descriptor.hasGlobal) {
      const global = await readRecord(join(dir, entry.name), versions)
      if (global !== undefined) state.global = global
      hasNewDocuments = true
    }
  }
  return hasNewDocuments
}

/** The version stamps this unit reads as its own: current plus declared compatible versions. */
function acceptedStamps(descriptor: KvUnitDescriptor): readonly number[] {
  return [descriptor.version, ...descriptor.compatibleVersions ?? []]
}

/**
 * Bootstrap an empty per-record tree from a legacy whole-unit file
 * (`<root>/<name>.json`, the pre-per-record layout). Every declared-table
 * record is copied into a current-version document, while the legacy file is
 * retained unchanged. A missing, foreign (another unit's name), malformed,
 * or non-unit legacy file is left alone, and so is one whose stored unit
 * version is outside the accepted set — migrating records the owner never
 * vouched for would stamp them with the current version and turn a
 * discardable stale cache into schema failures at the domain layer. Other
 * read failures propagate.
 * @param descriptor - Static identity and shape of the unit.
 * @param dir - The per-record unit directory (`<root>/<name>`).
 * @param state - The empty tree state; bootstrapped records are added.
 * @param policy - Windows rename retry cadence for every document write.
 */
async function bootstrapLegacyUnit(
  descriptor: KvUnitDescriptor,
  dir: string,
  state: UnitState,
  policy: AtomicWritePolicy,
): Promise<void> {
  const legacyPath = join(dirname(dir), `${descriptor.name}.json`)
  let text: string | undefined
  try {
    text = await readFile(legacyPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  // The legacy document is runtime data: only `unit.name`, `unit.version`,
  // and the tables map shape are checked here — the record values are
  // migrated as-is and the domain layer's schemas judge them.
  let document: { unit?: { name?: unknown; version?: unknown }; tables?: unknown }
  try {
    document = JSON.parse(text) as { unit?: { name?: unknown; version?: unknown }; tables?: unknown }
  } catch {
    return // Malformed legacy file: not ours to interpret or delete.
  }
  if (document.unit?.name !== descriptor.name) return
  const stamped = document.unit.version
  if (typeof stamped !== 'number' || !acceptedStamps(descriptor).includes(stamped)) return
  const tables = document.tables
  if (typeof tables !== 'object' || tables === null) return
  const recordsByTable = tables as Record<string, Record<string, unknown>>
  for (const [table, records] of Object.entries(recordsByTable)) {
    const target = state.tables.get(table)
    if (target === undefined) continue
    for (const [key, value] of Object.entries(records)) {
      const path = join(dir, table, `${key}.json`)
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeAtomic(path, serializeRecord(descriptor.version, value), policy)
      target.set(key, value)
    }
  }
}

/**
 * Read one declared table's record documents into `records`, {@link READ_BATCH_SIZE}
 * at a time.
 * @returns whether the directory contains any `.json` document path,
 * independently of key safety, readability, or stored version.
 */
async function loadTableRecords(records: Map<string, unknown>, versions: readonly number[], dir: string): Promise<boolean> {
  const files = await readdir(dir, { withFileTypes: true })
  const hasDocuments = files.some(file => file.name.endsWith('.json'))
  const documents = files.filter(file => file.name.endsWith('.json')
    && SAFE_KEY_RE.test(file.name.slice(0, -'.json'.length)))
  for (let start = 0; start < documents.length; start += READ_BATCH_SIZE) {
    const batch = await Promise.all(documents.slice(start, start + READ_BATCH_SIZE).map(async (file) => {
      const record = await readRecord(join(dir, file.name), versions)
      if (record === undefined) return undefined
      return [file.name.slice(0, -'.json'.length), record] as const
    }))
    for (const record of batch) {
      if (record !== undefined) records.set(...record)
    }
  }
  return hasDocuments
}

/**
 * Read one record document. A document that is missing, is not a file, cannot
 * be read, is malformed, or is stamped with an unaccepted version is FOREIGN and
 * reads as absent, so one bad document does not reject the unit — the contract
 * the session-projection cache domain relies on.
 *
 * Running out of file handles is the one exception. `EMFILE`/`ENFILE` describe
 * the process, not the document, so treating them as absence is how a 10,000
 * record table lost 1,811 committed records without a word. The unit-wide read
 * budget above is what keeps this from firing during an ordinary load; a genuine
 * exhaustion fails the load, because at that point the unit's contents are
 * unknown rather than foreign.
 */
async function readRecord(path: string, versions: readonly number[]): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EMFILE' || code === 'ENFILE') throw error
    return undefined
  }
  return parseRecord(text, versions)
}

/**
 * One opened `per-record`-layout unit. Stateless by design: the directory is
 * the medium, the domain layer owns the live memory, and each method here is
 * a single durable file operation. Write ordering belongs to the caller (the
 * domain layer's write chain), exactly like the `single`-layout unit.
 */
export class PerRecordJsonUnit implements KvUnit {
  private closed = false
  /** In-flight durable writes; close() drains them before releasing the unit. */
  private readonly inFlight = new Set<Promise<void>>()

  constructor(
    private readonly descriptor: KvUnitDescriptor,
    private readonly dir: string,
    private readonly onClose: () => void,
    private readonly policy: AtomicWritePolicy,
  ) {}

  /** Re-read the tree: the directory is the authoritative state. */
  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen()
    const state = await loadPerRecordState(this.descriptor, this.dir, this.policy)
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [table, records] of state.tables) {
      tables[table] = Object.fromEntries(records)
    }
    return { tables, global: state.global }
  }

  /** Durably replace one record: its own document, atomically. */
  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    assertSafeKey(this.descriptor.name, key)
    await this.tracked(this.writeDocument(join(this.tableDir(table), `${key}.json`), value))
  }

  /** Durably delete one record. Idempotent: a missing key is a no-op. */
  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    assertSafeKey(this.descriptor.name, key)
    await this.tracked(rm(join(this.tableDir(table), `${key}.json`), { force: true }))
  }

  /**
   * Move one record's document aside as `<key>.json.bak.<YYYYMMDDHHmm>`. The
   * moved file no longer ends in `.json`, so every later read ignores it; the
   * bytes stay on disk for inspection. A same-minute backup of the same
   * key overwrites the previous backup (the newer bytes are the ones worth
   * keeping).
   */
  async backupRecord(table: string, key: string): Promise<string> {
    this.assertOpen()
    assertSafeKey(this.descriptor.name, key)
    const path = join(this.tableDir(table), `${key}.json`)
    const moved = `${path}.bak.${backupStamp(new Date())}`
    await this.tracked(rename(path, moved))
    return moved
  }

  /** Durably replace the global singleton. Only valid when declared. */
  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    if (!this.descriptor.hasGlobal) {
      throw new Error(`unit '${this.descriptor.name}' does not declare a global slot`)
    }
    await this.tracked(this.writeDocument(join(this.dir, 'global.json'), value))
  }

  /* jscpd:ignore-start -- the two unit classes are standalone; the drain/guard lifecycle mirrors the shared KvUnit contract */
  /** Drain in-flight writes and release the unit. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled(this.inFlight)
      return
    }
    this.closed = true
    await Promise.allSettled(this.inFlight)
    this.onClose()
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `unit '${this.descriptor.name}' is closed`)
    }
  }
  /* jscpd:ignore-end */

  /** Resolve a declared table's directory; an undeclared table is a caller bug and throws. */
  private tableDir(table: string): string {
    if (!this.descriptor.tables.includes(table)) {
      throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`)
    }
    return join(this.dir, table)
  }

  /** Durably replace one document, creating its parent directory. */
  private writeDocument(path: string, value: unknown): Promise<void> {
    return (async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeAtomic(path, serializeRecord(this.descriptor.version, value), this.policy)
    })()
  }

  /** Track one durable write so close() drains it. */
  private tracked(write: Promise<void>): Promise<void> {
    this.inFlight.add(write)
    // Swallow only on the tracking branch: the caller still awaits `write`
    // itself, so rejections stay observed exactly once.
    write.catch(() => {}).finally(() => this.inFlight.delete(write))
    return write
  }
}

/** Local-time `YYYYMMDDHHmm` suffix for backed-up documents. */
function backupStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
}

/** Reject a record key that would be unsafe as a path segment. */
function assertSafeKey(unit: string, key: string): void {
  if (!SAFE_KEY_RE.test(key)) {
    throw new Error(`unit '${unit}': per-record key '${key}' is not path-safe (must match ${SAFE_KEY_RE})`)
  }
}
