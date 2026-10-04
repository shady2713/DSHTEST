/** Native Windows publication faults through the real Runtime and its production producer. */
import { createHash } from 'node:crypto'
import { readFile, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AtomicRenamePolicy } from '@deepseek-ai/dsh-atomic-write'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'
import WebTestRuntime, { Config, WebTestPrototypeControl } from '../src/index.ts'
import { PrototypeActivityStore, resolveControlWritePolicy } from '../src/recovery.ts'
import { prototypeActivitySchema, prototypeRunSchema } from '../src/recovery-spec.ts'
import type { PrototypeOperationId, PrototypeRunId } from '../src/recovery-spec.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import { cleanup, startRuntime } from './harness.ts'
import { closeExclusive, openExclusive } from './exclusive-handle.ts'

const releases: Array<() => Promise<void>> = []
const hash = (value: Buffer): string => createHash('sha256').update(value).digest('hex')
const runId = brandString<PrototypeRunId>('atomic-running')
const unknownId = brandString<PrototypeOperationId>('atomic-unknown-operation')
const compositionHash = '5'.repeat(64)
const intent = { kind: 'public-test', target: 'owned-public-record', parametersHash: '6'.repeat(64) }

afterEach(async () => {
  for (const release of releases.splice(0).reverse()) await release()
  await cleanup()
})

async function fixture(delays: number[]) {
  const runtime = await startRuntime({ freshRoot: true, storageMode: 'generation-json', windowsRenameDelaysMs: delays })
  releases.push(() => runtime.stop())
  const agents = await runtime.ctx.plugin(AgentRegistry)
  releases.push(() => agents.dispose())
  const producer = await runtime.ctx.plugin(WebTestPrototypeControl)
  releases.push(() => producer.dispose())
  const owner = runtime.ctx.webTestPrototypeOwner
  const original: unknown = Reflect.get(owner, Symbol.for('cordis.original'))
  if (!(original instanceof WebTestPrototypeControl)) throw new Error('production prototype owner missing')
  const ownerCtx: unknown = Reflect.get(original, 'ctx')
  if (!Context.is(ownerCtx)) throw new Error('production prototype owner Context missing')
  for (const id of ['atomic-unknown', runId]) {
    await owner.registerRun(prototypeRunSchema.parse({ runId: id, sessionId: `public-unloaded-${id}`,
      headRevision: 1, status: 'RUNNING', pauseRequested: false, cancelRequested: false,
      operations: [], attachments: [], reports: [] }), compositionHash, ownerCtx)
  }
  await owner.admit(brandString<PrototypeRunId>('atomic-unknown'), unknownId, intent, ownerCtx)
  await owner.markUnknown(unknownId, ownerCtx)
  const rawRuntime: unknown = Reflect.get(runtime.runtime, Symbol.for('cordis.original'))
  if (!(rawRuntime instanceof WebTestRuntime)) throw new Error('Runtime owner missing')
  const rawCtx: unknown = Reflect.get(rawRuntime, 'ctx')
  if (!Context.is(rawCtx)) throw new Error('Runtime owner Context missing')
  const cutPath = join(runtime.dataRoot, 'prototype-activity.json')
  return { ...runtime, owner, ownerCtx, rawCtx, cutPath }
}

async function temporary(root: string): Promise<string> {
  const names = (await readdir(root)).filter(name => name.startsWith('prototype-activity.json.') && name.endsWith('.tmp'))
  expect(names).toHaveLength(1)
  const name = names[0]
  if (!name) throw new Error('publication temp missing')
  return join(root, name)
}

describe.skipIf(process.platform !== 'win32')('Runtime atomic publication on Windows', () => {
  it('retries the closed, synced temp after the actual target handle is released', async () => {
    const owned = await fixture([20, 40, 80, 160])
    const before = await readFile(owned.cutPath)
    const waiting = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    const base = resolveControlWritePolicy([1])
    let completeTemp: Buffer | undefined
    const policy: AtomicRenamePolicy = { windowsRenameDelaysMs: base.windowsRenameDelaysMs, wait: async (delay) => {
      completeTemp = await readFile(await temporary(owned.dataRoot))
      waiting.resolve(undefined)
      await proceed.promise
      await base.wait(delay)
    } }
    const store = new PrototypeActivityStore(owned.rawCtx, owned.dataRoot, policy)
    let held: number | undefined = openExclusive(owned.cutPath)
    const publication = store.revoke()
    try {
      await waiting.promise
      await expect(store.admit(runId, brandString<PrototypeOperationId>('refused-during-retry'), intent)).rejects.toThrow('stopped')
      expect(await readFile(owned.cutPath)).toEqual(before)
      closeExclusive(held)
      held = undefined
      proceed.resolve(undefined)
      await publication
      expect(await readFile(owned.cutPath)).toEqual(completeTemp)
      const snapshot = await owned.runtime.readPersistentActivity()
      expect(prototypeActivitySchema.parse(JSON.parse((await readFile(owned.cutPath)).toString())).executor).toBe('revoked')
      expect(snapshot.unsettledOperationIds).toEqual([unknownId])
      expect((await readdir(owned.dataRoot)).filter(name => name.endsWith('.tmp'))).toEqual([])
    } finally {
      if (held !== undefined) closeExclusive(held)
      proceed.resolve(undefined)
      await publication
      await store.close()
    }
  })

  it.each([{ delays: [] }, { delays: [0, 1] }])('keeps the stopped executor and UNKNOWN when the configured budget $delays is exhausted', async ({ delays }) => {
    const owned = await fixture(delays)
    const before = await readFile(owned.cutPath)
    const held = openExclusive(owned.cutPath)
    let primary: unknown
    try {
      primary = await owned.owner.revoke(owned.ownerCtx).then(() => undefined, (error: unknown) => error)
      expect(primary).toMatchObject({ syscall: 'rename' })
      await expect(owned.owner.admit(runId, brandString<PrototypeOperationId>('refused-before-unlock'), intent, owned.ownerCtx)).rejects.toThrow('stopped')
      expect(await readFile(owned.cutPath)).toEqual(before)
    } finally { closeExclusive(held) }
    await expect(owned.owner.admit(runId, brandString<PrototypeOperationId>('refused-after-unlock'), intent, owned.ownerCtx)).rejects.toThrow('stopped')
    await expect(owned.owner.revoke(owned.ownerCtx)).rejects.toBe(primary)
    expect(await readFile(owned.cutPath)).toEqual(before)
    expect((await owned.runtime.readPersistentActivity()).unsettledOperationIds).toEqual([unknownId])
    expect((await readdir(owned.dataRoot)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('returns the primary rename failure when an actual temp handle also blocks cleanup', async () => {
    const owned = await fixture([])
    const before = await readFile(owned.cutPath)
    const held = openExclusive(owned.cutPath)
    let tempHandle: number | undefined
    let tempPath: string | undefined
    const base = resolveControlWritePolicy([0])
    const policy: AtomicRenamePolicy = { windowsRenameDelaysMs: base.windowsRenameDelaysMs, wait: async (delay) => {
      tempPath = await temporary(owned.dataRoot)
      tempHandle = openExclusive(tempPath)
      await base.wait(delay)
    } }
    const store = new PrototypeActivityStore(owned.rawCtx, owned.dataRoot, policy)
    try {
      await expect(store.revoke()).rejects.toMatchObject({ syscall: 'rename', dest: owned.cutPath })
      expect(await readFile(owned.cutPath)).toEqual(before)
      if (!tempPath) throw new Error('cleanup-denying temp handle absent')
      expect(hash(await readFile(tempPath))).not.toBe(hash(before))
      await expect(store.admit(runId, brandString<PrototypeOperationId>('refused-cleanup-failure'), intent)).rejects.toThrow('stopped')
    } finally {
      if (tempHandle !== undefined) closeExclusive(tempHandle)
      closeExclusive(held)
      await store.close()
    }
  })

  it('refuses a disappeared temp without consuming further Windows retry delays', async () => {
    const owned = await fixture([])
    const before = await readFile(owned.cutPath)
    let held: number | undefined = openExclusive(owned.cutPath)
    let waits = 0
    const base = resolveControlWritePolicy([0, 0])
    const policy: AtomicRenamePolicy = { windowsRenameDelaysMs: base.windowsRenameDelaysMs, wait: async (delay) => {
      waits += 1
      await rename(await temporary(owned.dataRoot), join(owned.dataRoot, 'retained-publication.tmp'))
      if (held !== undefined) closeExclusive(held)
      held = undefined
      await base.wait(delay)
    } }
    const store = new PrototypeActivityStore(owned.rawCtx, owned.dataRoot, policy)
    try {
      await expect(store.revoke()).rejects.toMatchObject({ code: 'ENOENT', syscall: 'rename' })
      expect(waits).toBe(1)
      expect(await readFile(owned.cutPath)).toEqual(before)
      await expect(store.admit(runId, brandString<PrototypeOperationId>('refused-missing-temp'), intent)).rejects.toThrow('stopped')
    } finally {
      if (held !== undefined) closeExclusive(held)
      await store.close()
    }
  })
})

it('validates configured rename delays before storage opens', () => {
  expect(Config({ controlRoot: 'public-owned-root' }).windowsRenameDelaysMs).toEqual([20, 40, 80, 160])
  expect(Config({ controlRoot: 'public-owned-root', windowsRenameDelaysMs: [] }).windowsRenameDelaysMs).toEqual([])
  expect(() => Config({ controlRoot: 'public-owned-root', windowsRenameDelaysMs: [-1] })).toThrow()
  expect(() => Config({ controlRoot: 'public-owned-root', windowsRenameDelaysMs: [0.5] })).toThrow()
})
