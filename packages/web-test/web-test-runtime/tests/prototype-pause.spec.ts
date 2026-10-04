/** Run pause closes admission before durable publication and preserves uncertain identities. */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, describe, expect, it } from 'vitest'
import WebTestRuntime, { WebTestPrototypeControl } from '../src/index.ts'
import { PrototypeActivityStore, resolveControlWritePolicy } from '../src/recovery.ts'
import { prototypeActivitySchema, prototypeRunSchema } from '../src/recovery-spec.ts'
import type { PrototypeOperationId, PrototypeRunId } from '../src/recovery-spec.ts'
import { cleanup, startRuntime } from './harness.ts'
import type { RuntimeHarness } from './harness.ts'
import { closeExclusive, openExclusive } from './exclusive-handle.ts'

const compositionHash = '7'.repeat(64)
const runId = brandString<PrototypeRunId>('public-pause-run')
const operationId = brandString<PrototypeOperationId>('original-uncertain-operation')
const intent = { kind: 'owned-create', target: 'public-test-endpoint', parametersHash: '8'.repeat(64) }
const releases: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const release of releases.splice(0).reverse()) await release()
  await cleanup()
})

async function ownerFor(runtime: RuntimeHarness) {
  const agents = await runtime.ctx.plugin(AgentRegistry)
  releases.push(() => agents.dispose())
  const fiber = await runtime.ctx.plugin(WebTestPrototypeControl)
  releases.push(() => fiber.dispose())
  const owner = runtime.ctx.webTestPrototypeOwner
  const original: unknown = Reflect.get(owner, Symbol.for('cordis.original'))
  if (!(original instanceof WebTestPrototypeControl)) throw new Error('production owner absent')
  const ctx: unknown = Reflect.get(original, 'ctx')
  if (!Context.is(ctx)) throw new Error('production owner Context absent')
  return { owner, ctx }
}

async function fixture() {
  const runtime = await startRuntime({ freshRoot: true, storageMode: 'generation-json', windowsRenameDelaysMs: [] })
  releases.push(() => runtime.stop())
  const producer = await ownerFor(runtime)
  await producer.owner.registerRun(prototypeRunSchema.parse({
    runId, sessionId: 'public-paused-session', headRevision: 1, status: 'RUNNING',
    pauseRequested: false, cancelRequested: false, operations: [],
    attachments: ['owned-attachment.bin'], reports: ['owned-report.txt'],
  }), compositionHash, producer.ctx)
  await writeFile(join(runtime.dataRoot, 'owned-attachment.bin'), 'owned attachment')
  await writeFile(join(runtime.dataRoot, 'owned-report.txt'), 'owned report')
  return { ...runtime, ...producer, cutPath: join(runtime.dataRoot, 'prototype-activity.json') }
}

function rawRuntimeContext(runtime: WebTestRuntime): Context {
  const original: unknown = Reflect.get(runtime, Symbol.for('cordis.original'))
  if (!(original instanceof WebTestRuntime)) throw new Error('Runtime absent')
  const ctx: unknown = Reflect.get(original, 'ctx')
  if (!Context.is(ctx)) throw new Error('Runtime Context absent')
  return ctx
}

describe.skipIf(process.platform !== 'win32')('trusted prototype run pause', () => {
  it('settles only the original issued operation after trusted success acknowledgement', async () => {
    const owned = await fixture()
    await owned.owner.admit(runId, operationId, intent, owned.ctx)
    expect(() => owned.owner.markCompleted(operationId, owned.ctx.root)).toThrow('exact owning Context')
    await owned.owner.markCompleted(operationId, owned.ctx)
    const cut = prototypeActivitySchema.parse(JSON.parse(await readFile(owned.cutPath, 'utf8')))
    expect(cut.runs[0]?.operations[0]?.status).toBe('COMPLETED')
    expect(cut.runs[0]?.status).toBe('RUNNING')
    expect((await owned.runtime.readPersistentActivity()).unsettledOperationIds).toEqual([])
    await expect(owned.owner.markCompleted(operationId, owned.ctx)).rejects.toThrow('ISSUED operation is absent')
    await expect(owned.owner.markCompleted(brandString<PrototypeOperationId>('absent'), owned.ctx)).rejects.toThrow('ISSUED operation is absent')
    const unknownId = brandString<PrototypeOperationId>('unknown-refuses-settlement')
    await owned.owner.admit(runId, unknownId, { ...intent, target: 'another-owned-target' }, owned.ctx)
    await owned.owner.markUnknown(unknownId, owned.ctx)
    await expect(owned.owner.markCompleted(unknownId, owned.ctx)).rejects.toThrow('ISSUED operation is absent')
    const before = await readFile(owned.cutPath)
    const revoked = prototypeActivitySchema.parse(JSON.parse(before.toString()))
    revoked.executor = 'revoked'
    writeFileSync(owned.cutPath, `${JSON.stringify(revoked)}\n`)
    await expect(owned.owner.markCompleted(unknownId, owned.ctx)).rejects.toThrow('executor is not active')
    expect((await owned.runtime.readPersistentActivity()).unsettledOperationIds).toEqual([unknownId])
  })

  it('closes synchronously, commits once and preserves UNKNOWN operations and material bytes', async () => {
    const owned = await fixture()
    await owned.owner.admit(runId, operationId, intent, owned.ctx)
    await owned.owner.markUnknown(operationId, owned.ctx)
    const before = prototypeActivitySchema.parse(JSON.parse(await readFile(owned.cutPath, 'utf8')))
    const head = before.runs[0]
    if (!head) throw new Error('head absent')
    const publication = owned.owner.pause(runId, owned.ctx)
    expect(() => { owned.owner.assertDispatchable(runId, owned.ctx) }).toThrow('not dispatchable')
    const receipt = await publication
    expect(receipt).toEqual({ runId, cutRevision: before.revision + 1, headRevision: head.headRevision + 1, status: 'UNKNOWN', pauseRequested: true })
    const committed = await readFile(owned.cutPath)
    expect(await owned.owner.pause(runId, owned.ctx)).toEqual(receipt)
    expect(await readFile(owned.cutPath)).toEqual(committed)
    const after = prototypeActivitySchema.parse(JSON.parse(committed.toString()))
    expect(after.runs[0]).toEqual({ ...head, pauseRequested: true, headRevision: head.headRevision + 1 })
    expect(await readFile(join(owned.dataRoot, 'owned-attachment.bin'), 'utf8')).toBe('owned attachment')
    expect(await readFile(join(owned.dataRoot, 'owned-report.txt'), 'utf8')).toBe('owned report')
  })

  it('refuses queued but unissued work and invalid callers cannot close a valid run', async () => {
    const owned = await fixture()
    expect(() => owned.owner.pause(runId, owned.ctx.root)).toThrow('exact owning Context')
    expect(() => { owned.owner.assertDispatchable(runId, owned.ctx.root) }).toThrow('exact owning Context')
    const initiator = { id: 'model-owned-pause-probe' } as Agent
    expect(() => owned.ctx.agents.withInitiator(initiator, () => owned.owner.pause(runId, owned.ctx))).toThrow('trusted Host')
    expect(() => owned.ctx.agents.withoutInitiator(() => owned.owner.pause(runId, owned.ctx.root))).toThrow('exact owning Context')
    owned.owner.assertDispatchable(runId, owned.ctx)
    const unknown = brandString<PrototypeRunId>('later-legitimate-run')
    expect(() => owned.owner.pause(unknown, owned.ctx)).toThrow('cannot be paused')
    const pending = owned.owner.admit(runId, operationId, intent, owned.ctx)
    const acknowledgement = owned.owner.pause(runId, owned.ctx)
    await expect(pending).rejects.toThrow('not dispatchable')
    expect((await acknowledgement).status).toBe('PAUSED')
    expect((await owned.runtime.readPersistentActivity()).unsettledOperationIds).toEqual([])
    await owned.owner.registerRun(prototypeRunSchema.parse({
      runId: unknown, sessionId: 'later-public-session', headRevision: 1, status: 'RUNNING',
      pauseRequested: false, cancelRequested: false, operations: [], attachments: [], reports: [],
    }), compositionHash, owned.ctx)
    owned.owner.assertDispatchable(unknown, owned.ctx)
  })

  it('keeps in-flight committed ISSUED work while closing the consumer gate before I/O', async () => {
    const owned = await fixture()
    const waiting = Promise.withResolvers<undefined>(), proceed = Promise.withResolvers<undefined>()
    const base = resolveControlWritePolicy([1])
    const store = new PrototypeActivityStore(rawRuntimeContext(owned.runtime), owned.dataRoot, {
      windowsRenameDelaysMs: base.windowsRenameDelaysMs,
      wait: async () => { waiting.resolve(undefined); await proceed.promise },
    })
    await store.hydrate()
    let held: number | undefined = openExclusive(owned.cutPath)
    const admission = store.admit(runId, operationId, intent)
    try {
      await waiting.promise
      const acknowledgement = store.pause(runId)
      expect(() => { store.assertDispatchable(runId) }).toThrow('not dispatchable')
      closeExclusive(held)
      held = undefined
      proceed.resolve(undefined)
      expect((await admission).status).toBe('ISSUED')
      expect(() => { store.assertDispatchable(runId) }).toThrow('not dispatchable')
      expect((await acknowledgement).status).toBe('PAUSED')
      const cut = prototypeActivitySchema.parse(JSON.parse(await readFile(owned.cutPath, 'utf8')))
      expect(cut.runs[0]?.operations).toEqual([{ operationId, businessIntent: intent, status: 'ISSUED' }])
      expect((await readdir(owned.dataRoot)).filter(name => name.endsWith('.tmp'))).toEqual([])
    } finally {
      if (held !== undefined) closeExclusive(held)
      proceed.resolve(undefined)
      await Promise.allSettled([admission])
      await store.close()
    }
  })

  it('does not acknowledge a failed publication or reopen its local gate', async () => {
    const owned = await fixture()
    const before = await readFile(owned.cutPath)
    const held = openExclusive(owned.cutPath)
    try {
      await expect(owned.owner.pause(runId, owned.ctx)).rejects.toMatchObject({ syscall: 'rename' })
      expect(() => { owned.owner.assertDispatchable(runId, owned.ctx) }).toThrow('not dispatchable')
      expect(await readFile(owned.cutPath)).toEqual(before)
      expect((await owned.runtime.readPersistentActivity()).runHeads[0]?.pauseRequested).toBe(false)
    } finally { closeExclusive(held) }
    const receipt = await owned.owner.pause(runId, owned.ctx)
    expect(receipt.status).toBe('PAUSED')
  })

  it('rechecks durable executor and run facts after an admission enters the queue', async () => {
    for (const changed of ['revoked', 'paused'] as const) {
      const owned = await fixture()
      const cut = prototypeActivitySchema.parse(JSON.parse(await readFile(owned.cutPath, 'utf8')))
      const pending = owned.owner.admit(runId, operationId, intent, owned.ctx)
      if (changed === 'revoked') cut.executor = 'revoked'
      else {
        const head = cut.runs[0]
        if (!head) throw new Error('head absent')
        head.pauseRequested = true
        head.status = 'PAUSED'
      }
      writeFileSync(owned.cutPath, `${JSON.stringify(cut)}\n`)
      await expect(pending).rejects.toThrow(changed === 'revoked' ? 'recovery-only' : 'not dispatchable')
      expect((await owned.runtime.readPersistentActivity()).unsettledOperationIds).toEqual([])
    }
  })

  it('refuses durable pause when queued publication observes a revoked executor', async () => {
    const owned = await fixture()
    const cut = prototypeActivitySchema.parse(JSON.parse(await readFile(owned.cutPath, 'utf8')))
    const pending = owned.owner.pause(runId, owned.ctx)
    cut.executor = 'revoked'
    writeFileSync(owned.cutPath, `${JSON.stringify(cut)}\n`)
    await expect(pending).rejects.toThrow('cannot be paused')
    expect(() => { owned.owner.assertDispatchable(runId, owned.ctx) }).toThrow('not dispatchable')
    expect((await owned.runtime.readPersistentActivity()).runHeads[0]?.pauseRequested).toBe(false)
  })

  it.each(['ISSUED', 'UNKNOWN'] as const)('closes cold RUNNING heads with %s operations without changing their durable bytes', async (status) => {
    const owned = await fixture()
    const completedId = brandString<PrototypeOperationId>('previously-completed-operation')
    await owned.owner.admit(runId, completedId, { ...intent, target: 'completed-target' }, owned.ctx)
    await owned.owner.markCompleted(completedId, owned.ctx)
    await owned.owner.admit(runId, operationId, intent, owned.ctx)
    // Fresh live admission remains usable while its consumer owns the unsettled operation.
    owned.owner.assertDispatchable(runId, owned.ctx)
    const secondId = brandString<PrototypeOperationId>('second-live-operation')
    await owned.owner.admit(runId, secondId, { ...intent, target: 'second-live-target' }, owned.ctx)
    await owned.owner.markCompleted(secondId, owned.ctx)
    await owned.stop()
    const cut = prototypeActivitySchema.parse(JSON.parse(await readFile(owned.cutPath, 'utf8')))
    const operation = cut.runs[0]?.operations.find(candidate => candidate.operationId === operationId)
    if (!operation) throw new Error('original operation absent')
    operation.status = status
    await writeFile(owned.cutPath, `${JSON.stringify(cut)}\n`)
    const before = await readFile(owned.cutPath)
    const reopened = await startRuntime({ controlRoot: owned.controlRoot, storageMode: 'generation-json' })
    releases.push(() => reopened.stop())
    const owner = await ownerFor(reopened)
    expect(() => { owner.owner.assertDispatchable(runId, owner.ctx) }).toThrow('not dispatchable')
    await expect(owner.owner.admit(runId, brandString<PrototypeOperationId>('different-cold-operation'), {
      ...intent, target: 'different-cold-target',
    }, owner.ctx)).rejects.toThrow('not dispatchable')
    expect(await readFile(owned.cutPath)).toEqual(before)
    expect((await reopened.runtime.readPersistentActivity()).unsettledOperationIds).toEqual([operationId])
  })

  it('admits a new intent after cold loading a RUNNING head whose operations are all completed', async () => {
    const owned = await fixture()
    await owned.owner.admit(runId, operationId, intent, owned.ctx)
    await owned.owner.markCompleted(operationId, owned.ctx)
    await owned.stop()
    const reopened = await startRuntime({ controlRoot: owned.controlRoot, storageMode: 'generation-json' })
    releases.push(() => reopened.stop())
    const owner = await ownerFor(reopened)
    const nextId = brandString<PrototypeOperationId>('new-intent-after-completed-cut')
    expect((await owner.owner.admit(runId, nextId, { ...intent, target: 'new-owned-target' }, owner.ctx)).status).toBe('ISSUED')
    expect((await reopened.runtime.readPersistentActivity()).unsettledOperationIds).toEqual([nextId])
  })

  it('hydrates PAUSED, UNKNOWN and recovery-only heads without granting a new executor', async () => {
    const owned = await fixture()
    await owned.owner.admit(runId, operationId, intent, owned.ctx)
    await owned.owner.markUnknown(operationId, owned.ctx)
    await owned.owner.pause(runId, owned.ctx)
    await owned.stop()
    const reopened = await startRuntime({ controlRoot: owned.controlRoot, storageMode: 'generation-json' })
    releases.push(() => reopened.stop())
    const owner = await ownerFor(reopened)
    expect(() => { owner.owner.assertDispatchable(runId, owner.ctx) }).toThrow('not dispatchable')
    await expect(owner.owner.admit(runId, operationId, intent, owner.ctx)).rejects.toThrow('not dispatchable')
    const cut = prototypeActivitySchema.parse(JSON.parse(await readFile(owned.cutPath, 'utf8')))
    expect(await owner.owner.pause(runId, owner.ctx)).toEqual({ runId, cutRevision: cut.revision, headRevision: cut.runs[0]?.headRevision, status: 'UNKNOWN', pauseRequested: true })
    await reopened.stop()
    const recoveryOnly = prototypeActivitySchema.parse({ ...cut, format: 2, executor: 'revoked', recoveryOnly: true, predecessorCompositionHash: compositionHash })
    await writeFile(owned.cutPath, `${JSON.stringify(recoveryOnly)}\n`)
    const recovery = await startRuntime({ controlRoot: owned.controlRoot, storageMode: 'generation-json' })
    releases.push(() => recovery.stop())
    const unavailable = await ownerFor(recovery)
    expect(() => unavailable.owner.pause(runId, unavailable.ctx)).toThrow('cannot be paused')
    expect(() => { unavailable.owner.assertDispatchable(runId, unavailable.ctx) }).toThrow('recovery-only')
  })

  it('keeps missing and corrupt legacy cuts readable while mutations fail closed', async () => {
    for (const contents of [undefined, '{"format":99}\n']) {
      const legacy = await startRuntime({ storageMode: 'generation-json' })
      releases.push(() => legacy.stop())
      const cutPath = join(legacy.dataRoot, 'prototype-activity.json')
      if (contents !== undefined) await writeFile(cutPath, contents)
      await legacy.stop()
      const reopened = await startRuntime({ controlRoot: legacy.controlRoot, storageMode: 'generation-json' })
      releases.push(() => reopened.stop())
      const owner = await ownerFor(reopened)
      expect((await reopened.runtime.readPersistentActivity()).completenessErrors).toHaveLength(1)
      expect(() => owner.owner.pause(runId, owner.ctx)).toThrow('cannot be paused')
      expect(() => { owner.owner.assertDispatchable(runId, owner.ctx) }).toThrow('not dispatchable')
      if (contents === undefined) await expect(readFile(cutPath)).rejects.toMatchObject({ code: 'ENOENT' })
      else expect(await readFile(cutPath, 'utf8')).toBe(contents)
    }
  })
})
