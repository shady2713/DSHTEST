/** Raw Runtime calls retain producer identity, lifetime and durable admission checks. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, describe, expect, it } from 'vitest'
import WebTestRuntime, { WebTestPrototypeControl, issuePrototypeAuthority } from '../src/index.ts'
import type { PrototypeAuthority } from '../src/recovery.ts'
import { prototypeActivitySchema, prototypeNotExecutedReceiptSchema, prototypeRunSchema } from '../src/recovery-spec.ts'
import type { PrototypeActivityCut, PrototypeOperationId } from '../src/recovery-spec.ts'
import { cleanup, startRuntime } from './harness.ts'

const hash = '7'.repeat(64)
const run = prototypeRunSchema.parse({
  runId: 'raw-provider-run', sessionId: 'raw-provider-session', headRevision: 1, status: 'RUNNING',
  pauseRequested: false, cancelRequested: false, operations: [], attachments: [], reports: [],
})
const initial: PrototypeActivityCut = { format: 3, compositionHash: hash, revision: 1, executor: 'active', runs: [] }
const operationId = brandString<PrototypeOperationId>('raw-provider-operation')
const intent = { kind: 'click', target: 'raw-provider-target', parametersHash: hash }
const receipt = prototypeNotExecutedReceiptSchema.parse({
  operationId, runId: run.runId, sessionId: run.sessionId, callId: 'raw-provider-call', requestId: 17,
  target: 'raw-provider-target', hostEpoch: 1, parametersHash: hash,
  outcome: 'not-executed', reason: 'stale-observation',
})
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  await cleanup()
})

async function fixture() {
  const current = await startRuntime({ storageMode: 'generation-json', windowsRenameDelaysMs: [] })
  disposers.push(() => current.stop())
  await current.ctx.plugin(AgentRegistry)
  const ownerFiber = await current.ctx.plugin(WebTestPrototypeControl)
  disposers.push(() => ownerFiber.dispose())
  const owner: unknown = Reflect.get(current.ctx.webTestPrototypeOwner, Symbol.for('cordis.original'))
  if (!(owner instanceof WebTestPrototypeControl)) throw new Error('production producer is absent')
  const ownerCtx: unknown = Reflect.get(owner, 'ctx')
  if (!Context.is(ownerCtx)) throw new Error('production producer Context is absent')
  const raw: unknown = Reflect.get(current.runtime, Symbol.for('cordis.original'))
  if (!(raw instanceof WebTestRuntime)) throw new Error('actual Runtime provider is absent')
  const authority = issuePrototypeAuthority(ownerCtx)
  return { ...current, raw, authority, ownerFiber, cutPath: join(current.dataRoot, 'prototype-activity.json') }
}

function prototypeCalls(runtime: WebTestRuntime, authority: PrototypeAuthority): Array<() => unknown> {
  return [
    () => runtime.initializePrototypeActivity(initial, authority),
    () => runtime.registerPrototypeRun(run, hash, authority),
    () => runtime.admitPrototypeOperation(run.runId, operationId, intent, authority),
    () => runtime.markPrototypeOperationUnknown(operationId, authority),
    () => runtime.markPrototypeOperationCompleted(operationId, authority),
    () => runtime.markPrototypeOperationNotExecuted(operationId, receipt, authority),
    () => runtime.pausePrototypeRun(run.runId, authority),
    () => { runtime.assertPrototypeRunDispatchable(run.runId, authority) },
    () => runtime.revokePrototypeDispatch(authority),
  ]
}

describe.skipIf(process.platform !== 'win32')('Runtime producer authority on actual providers', () => {
  it('accepts the raw ACTIVE Service for all prototype methods and preserves UNKNOWN and intent deduplication', async () => {
    const current = await fixture()
    expect(Reflect.get(current.raw, Symbol.for('cordis.original'))).toBeUndefined()
    const active = current.ctx.get('webTestRuntime')
    if (!active) throw new Error('ACTIVE Runtime provider is absent')
    expect(Reflect.get(active, Symbol.for('cordis.original')) === current.raw).toBe(true)
    await current.raw.initializePrototypeActivity(initial, current.authority)
    await current.raw.registerPrototypeRun(run, hash, current.authority)
    current.raw.assertPrototypeRunDispatchable(run.runId, current.authority)
    await current.raw.admitPrototypeOperation(run.runId, operationId, intent, current.authority)
    await current.raw.markPrototypeOperationNotExecuted(operationId, receipt, current.authority)
    const completedId = brandString<PrototypeOperationId>('raw-completed-operation')
    await current.raw.admitPrototypeOperation(run.runId, completedId, { ...intent, target: 'raw-completed-target' }, current.authority)
    await current.raw.markPrototypeOperationCompleted(completedId, current.authority)
    await expect(current.raw.admitPrototypeOperation(run.runId, brandString<PrototypeOperationId>('duplicate'), intent, current.authority))
      .rejects.toThrow('already has an operation')
    const unknownId = brandString<PrototypeOperationId>('raw-unknown-operation')
    await current.raw.admitPrototypeOperation(run.runId, unknownId, { ...intent, target: 'raw-unknown-target' }, current.authority)
    await current.raw.markPrototypeOperationUnknown(unknownId, current.authority)
    await expect(current.raw.markPrototypeOperationCompleted(unknownId, current.authority)).rejects.toThrow('ISSUED')
    const paused = await current.raw.pausePrototypeRun(run.runId, current.authority)
    expect(paused.status).toBe('UNKNOWN')
    await current.raw.revokePrototypeDispatch(current.authority)
    const saved = await current.runtime.readPersistentActivity()
    expect(saved.unsettledOperationIds).toEqual([unknownId])
    expect(saved.runHeads[0]?.operations.map(operation => operation.status)).toEqual(['NOT_EXECUTED', 'COMPLETED', 'UNKNOWN'])
    expect(saved.runHeads[0]?.pauseRequested).toBe(true)
    expect(prototypeActivitySchema.parse(JSON.parse(await readFile(current.cutPath, 'utf8'))).executor).toBe('revoked')
  })

  it('refuses copied authority and disposed producers through every raw prototype method without writing', async () => {
    const current = await fixture()
    await current.raw.initializePrototypeActivity(initial, current.authority)
    const before = await readFile(current.cutPath)
    const copied = Object.freeze({ ...current.authority })
    for (const call of prototypeCalls(current.raw, copied)) expect(call).toThrow('private producer authority')
    await current.ownerFiber.dispose()
    for (const call of prototypeCalls(current.raw, current.authority)) expect(call).toThrow('trusted Host Service owner')
    expect(await readFile(current.cutPath)).toEqual(before)
  })

  it('refuses a retained raw provider after Runtime disposal without changing the durable cut', async () => {
    const current = await fixture()
    await current.raw.initializePrototypeActivity(initial, current.authority)
    const before = await readFile(current.cutPath)
    await current.stop()
    expect(current.ctx.get('webTestRuntime')).toBeUndefined()
    for (const call of prototypeCalls(current.raw, current.authority)) expect(call).toThrow('trusted Host Service owner')
    expect(await readFile(current.cutPath)).toEqual(before)
  })
})
