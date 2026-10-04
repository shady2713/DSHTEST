/**
 * Per-record medium faults that end a load or a durable write.
 *
 * Two failures the per-record unit must not absorb: a read that exhausts the
 * process handle budget, where the unit's contents are unknown rather than
 * foreign, and a durable write that never lands, which the tracking seam
 * observes so `close()` drains it while the caller still sees the rejection
 * once.
 */

import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonStorageBackend } from '../src/index.ts'
import { resolveWritePolicy } from '../src/atomic.ts'

const state = vi.hoisted(() => ({ readFileFails: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (async (path: unknown, options: unknown) => {
      if (state.readFileFails && String(path).endsWith('.json')) {
        throw Object.assign(new Error('ENFILE: injected handle exhaustion'), { code: 'ENFILE' })
      }
      return (actual.readFile as (p: unknown, o: unknown) => Promise<string>)(path, options)
    }) as typeof actual.readFile,
  }
})

const roots: string[] = []

afterEach(async () => {
  state.readFileFails = false
  await Promise.all(roots.splice(0).map(root => rm(root, { force: true, maxRetries: 10, recursive: true, retryDelay: 20 })))
})

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-storage-json-medium-'))
  roots.push(root)
  return root
}

const descriptor = { name: 'recs', version: 1, layout: 'per-record' as const, tables: ['t'], hasGlobal: false }
const recordPath = (root: string, key: string): string => join(root, 'recs', 't', `${key}.json`)

describe('per-record medium faults', () => {
  it('fails the load when a document read exhausts the process handle budget', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root, resolveWritePolicy([]))
    const unit = await backend.kv.open(descriptor)
    await unit.putRecord('t', 'k', { v: 1 })
    await unit.close()
    // The documents are fine; the PROCESS ran out of handles. That is not a
    // statement about the document, so the load fails instead of reading as
    // absent and silently losing committed records.
    state.readFileFails = true
    const unit2 = await backend.kv.open(descriptor)
    await expect(unit2.loadAll()).rejects.toMatchObject({ code: 'ENFILE' })
    state.readFileFails = false
    expect((await unit2.loadAll()).tables['t']).toEqual({ k: { v: 1 } })
    await backend.close()
  })

  it('rejects a durable write that never lands, and leaves the tree as it was', async () => {
    const root = await freshRoot()
    const backend = new JsonStorageBackend(root, resolveWritePolicy([]))
    const unit = await backend.kv.open(descriptor)
    // A directory where the document belongs: rename cannot replace it on any
    // host, so the write primitive is tracked, observed, and rejected once.
    await mkdir(recordPath(root, 'k'), { recursive: true })
    await expect(unit.putRecord('t', 'k', { v: 1 })).rejects.toMatchObject({ code: 'EPERM' })
    // The failure reached the caller and nothing else: the medium is unchanged
    // and the unit still loads.
    expect(await readdir(join(root, 'recs', 't'))).toEqual(['k.json'])
    expect((await unit.loadAll()).tables['t']).toEqual({})
    await unit.close()
    await backend.close()
  })
})
