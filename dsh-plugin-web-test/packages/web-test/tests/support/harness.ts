/**
 * Test doubles for the plugin's storage-facing collaborators.
 *
 * The store's business rules are pure decisions over durable records, so the
 * tests drive it through a real `Storage` hub and a real `WebTestStore` and only
 * replace the medium. The in-memory backend below follows the contract
 * `@deepseek-ai/dsh-storage` documents for backends: it stamps a version at
 * first materialization, refuses an open whose stamp differs from the
 * descriptor's, refuses a second open of the same unit, and rejects calls after
 * `close`. Anything the plugin relies on therefore has to be reproduced here, or
 * a test would pass against a backend the real one rejects.
 *
 * @module dsh-plugin-web-test/tests/support/harness
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { withImpliedProjects } from './seed'
import { Storage, StorageError } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import { WebTestStore } from '../../src/store-service.ts'

/** Records a test wants present before the store's first open, keyed by table. */
export type Seed = Record<string, Record<string, unknown>>

/** One in-memory medium plus the version stamp it carries. */
interface Medium {
  version: number | undefined
  tables: Seed
}

/** Mediums shared per home, so a close-and-reopen reads what a database holds. */
const mediumsByHome = new Map<string, Medium>()

/** Temporary homes created so far, cleaned up on the way out when possible. */
const createdHomes: string[] = []

/** The medium behind one home, created on first use. */
function mediumFor(home: string): Medium {
  const existing = mediumsByHome.get(home)
  if (existing !== undefined) return existing
  const created: Medium = { version: undefined, tables: {} }
  mediumsByHome.set(home, created)
  return created
}

/** Build the kv facet over one shared medium. */
function memoryKv(medium: Medium): KvFacet {
  const open = new Set<string>()
  return {
    async open(descriptor: KvUnitDescriptor): Promise<KvUnit> {
      if (medium.version === undefined) {
        // First materialization stamps the descriptor's version, and an empty
        // unit must read as empty rather than reject. Records a test seeded
        // before the open are already in the medium, so a declared table that
        // exists is left exactly as it is.
        medium.version = descriptor.version
        for (const table of descriptor.tables) medium.tables[table] ??= {}
      } else if (medium.version !== descriptor.version) {
        throw new StorageError('version-mismatch',
          `unit ${descriptor.name} carries version ${medium.version}, not ${descriptor.version}`)
      }
      if (open.has(descriptor.name)) {
        throw new StorageError('malformed-medium', `unit ${descriptor.name} is already open`)
      }
      open.add(descriptor.name)
      let closed = false
      const guard = (): void => {
        if (closed) throw new StorageError('malformed-medium', `unit ${descriptor.name} is closed`)
      }
      return {
        async loadAll() {
          guard()
          return { tables: structuredClone(medium.tables), global: null }
        },
        async putRecord(table: string, key: string, value: unknown) {
          guard()
          if (!descriptor.tables.includes(table)) {
            throw new StorageError('malformed-medium', `table ${table} is not declared by the unit`)
          }
          const rows = medium.tables[table] ?? {}
          rows[key] = structuredClone(value)
          medium.tables[table] = rows
        },
        async deleteRecord(table: string, key: string) {
          guard()
          const rows = medium.tables[table]
          if (rows !== undefined) delete rows[key]
        },
        async close() {
          closed = true
          open.delete(descriptor.name)
        },
      }
    },
  }
}

/** A harness: a private DSH home, a hub, and a store opened over it. */
export interface Harness {
  store: WebTestStore
  home: string
  /** Drain the store, leaving the home's medium readable for a reopen. */
  dispose(): Promise<void>
}

/**
 * Open a store over a private home seeded with the records a test needs.
 *
 * `DSH_HOME` is redirected before any path helper reads it, so the plugin's data
 * root, evidence directories and database path all land inside the temporary home
 * and the developer's real `~/.dsh` is never read or written.
 * @param options - `seed` records to place before the open, `home` reuses an
 * existing home to model a host restart, `version` stamps the medium with a
 * version the descriptor does not carry, and `open: false` leaves storage closed.
 * @returns the harness.
 */
export async function harness(options: {
  seed?: Seed
  home?: string
  version?: number
  open?: boolean
} = {}): Promise<Harness> {
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'webtest-home-'))
  if (options.home === undefined) createdHomes.push(home)
  process.env.DSH_HOME = home

  const medium = mediumFor(home)
  if (options.version !== undefined) medium.version = options.version
  for (const [table, rows] of Object.entries(withImpliedProjects(options.seed))) {
    medium.tables[table] = { ...medium.tables[table], ...structuredClone(rows) }
  }

  const ctx = new Context()
  // The services are constructed directly rather than mounted through
  // `ctx.plugin`, whose proxy resolves properties only after the plugin has
  // been applied. Nothing under test reads the Context, and mounting would make
  // the test wait on a lifecycle it is not exercising.
  const storage = new Storage(ctx)
  const backend: StorageBackend = { kv: memoryKv(medium), close: async () => {} }
  storage.backend.register('sqlite', backend)

  const store = new WebTestStore(ctx)
  if (options.open !== false) await store.open(storage)
  return {
    store,
    home,
    ctx,
    async dispose() {
      await store.drain()
    },
  }
}

/** Remove the temporary homes this run created. */
export function cleanupHomes(): void {
  for (const home of createdHomes.splice(0)) {
    mediumsByHome.delete(home)
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      // A locked file on Windows leaves the directory behind; the residue is a
      // throwaway temp path and must not fail the run that created it.
    }
  }
}
