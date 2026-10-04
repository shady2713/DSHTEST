/** Fresh ordinary roots publish complete activity; bounded production owners preserve prior work. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_PROTOTYPE_COMPOSITION_HASH } from '../src/persistent-activity.ts'
import { prepareControlRoot, resolveDataGeneration } from '../src/control-root.ts'
import { WebTestPrototypeControl } from '../src/prototype-control.ts'
import { prototypeActivitySchema } from '../src/recovery-spec.ts'
import type { PrototypeOperationId, PrototypeRunHead, PrototypeRunId } from '../src/recovery-spec.ts'
import { cleanup, newControlRoot, startRuntime } from './harness.ts'
import type { RuntimeHarness } from './harness.ts'

afterEach(cleanup)

const hash = '1'.repeat(64)

function run(id: string, status: 'RUNNING' | 'PAUSED' = 'RUNNING'): PrototypeRunHead {
  return {
    runId: brandString<PrototypeRunId>(id), sessionId: SessionId(`session-${id}`), headRevision: 1,
    status, pauseRequested: status === 'PAUSED', cancelRequested: false,
    operations: [], attachments: [], reports: [],
  }
}

async function productionOwner(fixture: RuntimeHarness): Promise<{ owner: WebTestPrototypeControl; ctx: Context }> {
  await fixture.ctx.plugin(AgentRegistry)
  await fixture.ctx.plugin(WebTestPrototypeControl)
  const owner = fixture.ctx.webTestPrototypeOwner
  const original: unknown = Reflect.get(owner, Symbol.for('cordis.original'))
  if (typeof original !== 'object' || original === null) throw new Error('production owner is absent')
  const ctx: unknown = Reflect.get(original, 'ctx')
  if (!Context.is(ctx)) throw new Error('production owner context is absent')
  return { owner, ctx }
}

describe.skipIf(process.platform !== 'win32')('fresh Runtime and production prototype owner', () => {
  it('publishes the first pointer only after registration and preserves interrupted roots for inspection', async () => {
    const parent = await newControlRoot(), controlRoot = join(parent, 'control')
    const prepared = await prepareControlRoot(controlRoot)
    expect(prepared.created).toBe(true)
    const generation = await resolveDataGeneration(prepared.canonicalRoot, {
      rootCreated: prepared.created,
      initialize: async (selected) => {
        await expect(readFile(join(controlRoot, 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
        await writeFile(join(selected.dataRoot, 'registration-ready'), 'registered')
      },
    })
    expect(await readFile(join(generation.dataRoot, 'registration-ready'), 'utf8')).toBe('registered')
    expect(JSON.parse(await readFile(join(controlRoot, 'current.json'), 'utf8'))).toEqual({ generation: 1, directory: 'data/1' })

    const interrupted = join(parent, 'interrupted')
    const initial = await prepareControlRoot(interrupted)
    await expect(resolveDataGeneration(initial.canonicalRoot, {
      rootCreated: initial.created, initialize: () => Promise.reject(new Error('registration interrupted')),
    })).rejects.toThrow('registration interrupted')
    await expect(readFile(join(interrupted, 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const retry = await prepareControlRoot(interrupted)
    expect(retry.created).toBe(false)
    await expect(resolveDataGeneration(retry.canonicalRoot, {
      rootCreated: retry.created, initialize: () => Promise.resolve(),
    })).rejects.toThrow('unregistered existing history')
  })

  it('publishes a complete explicit empty cut on a fresh root and preserves it on reopen', async () => {
    const fixture = await startRuntime({ freshRoot: true, storageMode: 'generation-json' })
    const cutPath = join(fixture.dataRoot, 'prototype-activity.json')
    try {
      const snapshot = await fixture.runtime.readPersistentActivity()
      expect(snapshot.completenessErrors).toEqual([])
      expect(snapshot.headRevision).toBe(1)
      expect(snapshot.runHeads).toEqual([])
      expect(prototypeActivitySchema.parse(JSON.parse(await readFile(cutPath, 'utf8'))).compositionHash).toBe(EMPTY_PROTOTYPE_COMPOSITION_HASH)
    } finally { await fixture.stop() }
    const before = await readFile(cutPath)
    const reopened = await startRuntime({ controlRoot: fixture.controlRoot, storageMode: 'generation-json' })
    try {
      expect((await reopened.runtime.readPersistentActivity()).completenessErrors).toEqual([])
      expect(await readFile(cutPath)).toEqual(before)
    } finally { await reopened.stop() }
  })

  it('refuses selecting an existing unregistered root or stale interrupted generation', async () => {
    for (const residual of [false, true]) {
      const controlRoot = await newControlRoot()
      if (residual) await mkdir(join(controlRoot, 'data'))
      await expect(startRuntime({ controlRoot, freshRoot: true, storageMode: 'generation-json' })).rejects.toThrow('unregistered existing history')
      await expect(readFile(join(controlRoot, 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('keeps a legacy missing cut and a corrupted cut incomplete without replacing either', async () => {
    const legacy = await startRuntime({ storageMode: 'generation-json' })
    try {
      expect((await legacy.runtime.readPersistentActivity()).completenessErrors).toHaveLength(1)
      const cutPath = join(legacy.dataRoot, 'prototype-activity.json')
      await writeFile(cutPath, '{"format":99}\n')
      const before = await readFile(cutPath)
      expect((await legacy.runtime.readPersistentActivity()).completenessErrors).toHaveLength(1)
      expect(await readFile(cutPath)).toEqual(before)
    } finally { await legacy.stop() }
  })

  it('serializes run registration and admission without losing PAUSED or UNKNOWN heads', async () => {
    const fixture = await startRuntime({ freshRoot: true, storageMode: 'generation-json' })
    try {
      const { owner, ctx } = await productionOwner(fixture)
      const paused = run('paused', 'PAUSED'), active = run('active'), sibling = run('sibling')
      await expect(owner.registerRun(paused, EMPTY_PROTOTYPE_COMPOSITION_HASH, ctx)).rejects.toThrow('empty-plane fingerprint')
      await expect(owner.registerRun(paused, 'not-a-digest', ctx)).rejects.toThrow()
      await owner.registerRun(paused, hash, ctx)
      await owner.registerRun(active, hash, ctx)
      const operationId = brandString<PrototypeOperationId>('original-operation')
      const intent = { kind: 'create', target: 'public-synthetic', parametersHash: '2'.repeat(64) }
      const completionOrder: string[] = []
      await Promise.all([
        owner.registerRun(sibling, hash, ctx).then(() => { completionOrder.push('registration') }),
        owner.admit(active.runId, operationId, intent, ctx).then(() => { completionOrder.push('admission') }),
      ])
      expect(completionOrder).toEqual(['registration', 'admission'])
      await owner.markUnknown(operationId, ctx)
      await owner.registerRun(run('later'), hash, ctx)
      const snapshot = await fixture.runtime.readPersistentActivity()
      expect(snapshot.runHeads.map(head => head.runId)).toEqual(['paused', 'active', 'sibling', 'later'])
      expect(snapshot.runHeads[0]).toEqual(paused)
      expect(snapshot.runHeads[1]?.status).toBe('UNKNOWN')
      expect(snapshot.unsettledOperationIds).toEqual([operationId])
      const registeredCut = prototypeActivitySchema.parse(JSON.parse(await readFile(join(fixture.dataRoot, 'prototype-activity.json'), 'utf8')))
      expect(registeredCut.compositionHash).toBe(hash)
      await expect(owner.registerRun(run('later'), hash, ctx)).rejects.toThrow('already registered')
      await expect(owner.registerRun(run('wrong-composition'), '3'.repeat(64), ctx)).rejects.toThrow('composition')
      await expect(owner.admit(paused.runId, brandString<PrototypeOperationId>('paused-op'), { ...intent, target: 'distinct-paused-target' }, ctx)).rejects.toThrow('not dispatchable')
      await owner.revoke(ctx)
      await expect(owner.registerRun(run('after-revoke'), hash, ctx)).rejects.toThrow('stopped')
    } finally { await fixture.stop() }
  })

  it('rejects unrelated, model and cleared-initiator callers without exposing producer authority', async () => {
    const fixture = await startRuntime({ freshRoot: true, storageMode: 'generation-json' })
    try {
      const { owner, ctx } = await productionOwner(fixture)
      expect(() => owner.registerRun(run('unrelated'), hash, fixture.ctx)).toThrow('exact owning Context')
      // Only the initiator identity is read here; no Agent loop or model provider is involved.
      const initiator = { id: SessionId('model-caller') } as Agent
      expect(() => fixture.ctx.agents.withInitiator(initiator, () => owner.registerRun(run('model'), hash, ctx))).toThrow('trusted Host Service owner')
      expect(() => fixture.ctx.agents.withoutInitiator(() => owner.registerRun(run('cleared'), hash, fixture.ctx))).toThrow('exact owning Context')
      expect(Reflect.get(owner, 'authority')).toBeUndefined()
      expect((await fixture.runtime.readPersistentActivity()).runHeads).toEqual([])
      await owner.registerRun(run('trusted'), hash, ctx)
      expect((await fixture.runtime.readPersistentActivity()).runHeads).toHaveLength(1)
    } finally { await fixture.stop() }
  })

  it('accepts the actual Service instance and withdraws it when its producer fiber is disposed', async () => {
    const fixture = await startRuntime({ freshRoot: true, storageMode: 'generation-json' })
    try {
      await fixture.ctx.plugin(AgentRegistry)
      const fiber = await fixture.ctx.plugin(WebTestPrototypeControl)
      const raw: unknown = Reflect.get(fixture.ctx.webTestPrototypeOwner, Symbol.for('cordis.original'))
      if (!(raw instanceof WebTestPrototypeControl)) throw new Error('actual producer instance is absent')
      const ctx: unknown = Reflect.get(raw, 'ctx')
      if (!Context.is(ctx)) throw new Error('producer Context is absent')
      await raw.registerRun(run('raw-owner'), hash, ctx)
      const committed = await readFile(join(fixture.dataRoot, 'prototype-activity.json'))
      await fiber.dispose()
      expect(fixture.ctx.get('webTestPrototypeOwner')).toBeUndefined()
      expect(() => raw.registerRun(run('after-owner-disposal'), hash, ctx)).toThrow('exact owning Context')
      expect(await readFile(join(fixture.dataRoot, 'prototype-activity.json'))).toEqual(committed)
    } finally { await fixture.stop() }
  })

  it('refuses importing an existing UNKNOWN operation head through initial run registration', async () => {
    const fixture = await startRuntime({ freshRoot: true, storageMode: 'generation-json' })
    try {
      const { owner, ctx } = await productionOwner(fixture)
      const original = run('actual-operation')
      await owner.registerRun(original, hash, ctx)
      const operationId = brandString<PrototypeOperationId>('actual-unresolved-operation')
      await owner.admit(original.runId, operationId, { kind: 'create', target: 'owned-public', parametersHash: hash }, ctx)
      await owner.markUnknown(operationId, ctx)
      const persisted = (await fixture.runtime.readPersistentActivity()).runHeads[0]
      if (!persisted) throw new Error('committed UNKNOWN head is absent')
      const before = await readFile(join(fixture.dataRoot, 'prototype-activity.json'))
      await expect(owner.registerRun({ ...persisted, runId: brandString<PrototypeRunId>('reimported-head') }, hash, ctx))
        .rejects.toThrow('initial running or paused head without operations')
      expect(await readFile(join(fixture.dataRoot, 'prototype-activity.json'))).toEqual(before)
      await owner.registerRun(run('separate-initial-head'), hash, ctx)
      expect((await fixture.runtime.readPersistentActivity()).unsettledOperationIds).toEqual([operationId])
    } finally { await fixture.stop() }
  })
})
