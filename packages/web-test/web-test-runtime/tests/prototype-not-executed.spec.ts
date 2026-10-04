/** Confirmed denials remain distinct from UNKNOWN and retain immutable recovery evidence. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { WebTestPrototypeControl } from '../src/prototype-control.ts'
import { checkPrototypeFormat1, checkPrototypeFormat3, issueRecoveryAuthority, RecoveryCoordinator, resolveControlWritePolicy } from '../src/recovery.ts'
import type { RecoveryAuthority } from '../src/recovery.ts'
import { prototypeActivitySchema, prototypeNotExecutedReceiptSchema, prototypeRunSchema } from '../src/recovery-spec.ts'
import type { PrototypeOperationId, PrototypeRunId } from '../src/recovery-spec.ts'
import { validatePrototypeActivity } from '../src/persistent-activity.ts'
import { cleanup, startRuntime } from './harness.ts'

const hash = '8'.repeat(64)
const run = prototypeRunSchema.parse({
  runId: 'denied-run', sessionId: 'denied-session', headRevision: 1, status: 'RUNNING',
  pauseRequested: false, cancelRequested: false, operations: [], attachments: [], reports: [],
})
const operationId = brandString<PrototypeOperationId>('denied-operation')
const intent = { kind: 'click', target: 'public-target', parametersHash: hash }
const receipt = prototypeNotExecutedReceiptSchema.parse({
  operationId, runId: run.runId, sessionId: run.sessionId, callId: 'real-tool-call', requestId: 23,
  target: 'observed-main-target', hostEpoch: 4, parametersHash: hash,
  outcome: 'not-executed', reason: 'stale-observation',
})
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  await cleanup()
})

async function fixture(controlRoot?: string) {
  const runtime = await startRuntime({
    ...(controlRoot ? { controlRoot } : { freshRoot: true }),
    storageMode: 'generation-json', windowsRenameDelaysMs: [],
  })
  disposers.push(() => runtime.stop())
  await runtime.ctx.plugin(AgentRegistry)
  const ownerFiber = await runtime.ctx.plugin(WebTestPrototypeControl)
  disposers.push(() => ownerFiber.dispose())
  const raw: unknown = Reflect.get(runtime.ctx.webTestPrototypeOwner, Symbol.for('cordis.original'))
  if (!(raw instanceof WebTestPrototypeControl)) throw new Error('prototype owner absent')
  const ctx: unknown = Reflect.get(raw, 'ctx')
  if (!Context.is(ctx)) throw new Error('prototype Context absent')
  return { ...runtime, owner: raw, ownerCtx: ctx, cutPath: join(runtime.dataRoot, 'prototype-activity.json') }
}

async function coordinator(controlRoot: string) {
  const root = new Context()
  let ownerCtx: Context | undefined, authority: RecoveryAuthority | undefined
  const fiber = await root.plugin(class RecoveryOwner extends Service {
    constructor(ctx: Context) {
      super(ctx, 'webTestRecovery')
      ownerCtx = this.ctx
      authority = issueRecoveryAuthority(this.ctx)
    }
  })
  disposers.push(() => fiber.dispose())
  if (!ownerCtx || !authority) throw new Error('recovery owner absent')
  const value = await RecoveryCoordinator.open(controlRoot, ownerCtx, authority, resolveControlWritePolicy([]))
  const currentAuthority = authority
  disposers.push(() => value.close(currentAuthority))
  return { value, authority }
}

describe.skipIf(process.platform !== 'win32')('confirmed prototype non-execution', () => {
  it('commits a real-owner denial, retains all receipt fields and forbids reusing its intent after cold reopen', async () => {
    const current = await fixture()
    await expect(checkPrototypeFormat1(current.dataRoot)).rejects.toThrow('format 1')
    await expect(checkPrototypeFormat3(current.dataRoot)).rejects.toThrow('format 3')
    await current.owner.registerRun(run, hash, current.ownerCtx)
    await current.owner.admit(run.runId, operationId, intent, current.ownerCtx)
    expect(() => current.owner.markNotExecuted(operationId, receipt, current.ctx)).toThrow('exact owning Context')
    await current.owner.markNotExecuted(operationId, receipt, current.ownerCtx)
    const cut = validatePrototypeActivity(JSON.parse(await readFile(current.cutPath, 'utf8')))
    expect(cut.format).toBe(3)
    expect(cut.runs[0]?.operations[0]).toEqual({ operationId, businessIntent: intent, status: 'NOT_EXECUTED', receipt })
    expect(cut.runs[0]?.status).toBe('RUNNING')
    expect((await current.runtime.readPersistentActivity()).unsettledOperationIds).toEqual([])
    await expect(current.owner.markCompleted(operationId, current.ownerCtx)).rejects.toThrow('ISSUED')
    await expect(current.owner.markUnknown(operationId, current.ownerCtx)).rejects.toThrow('unsettled')
    await expect(current.owner.markNotExecuted(operationId, receipt, current.ownerCtx)).rejects.toThrow('ISSUED')
    await expect(current.owner.admit(run.runId, brandString<PrototypeOperationId>('new-id'), intent, current.ownerCtx))
      .rejects.toThrow('already has an operation')
    const bytes = await readFile(current.cutPath)
    await current.stop()
    const reopened = await fixture(current.controlRoot)
    reopened.owner.assertDispatchable(run.runId, reopened.ownerCtx)
    expect(await readFile(reopened.cutPath)).toEqual(bytes)
    await expect(reopened.owner.admit(run.runId, brandString<PrototypeOperationId>('cold-new-id'), intent, reopened.ownerCtx))
      .rejects.toThrow('already has an operation')
  })

  it('rejects mismatched original-operation associations without changing durable bytes', async () => {
    const current = await fixture()
    await current.owner.registerRun(run, hash, current.ownerCtx)
    await current.owner.admit(run.runId, operationId, intent, current.ownerCtx)
    const bytes = await readFile(current.cutPath)
    for (const changed of [
      { ...receipt, operationId: brandString<PrototypeOperationId>('another-operation') },
      { ...receipt, runId: brandString<PrototypeRunId>('another-run') },
      { ...receipt, sessionId: SessionId('another-session') },
      { ...receipt, parametersHash: '9'.repeat(64) },
    ]) {
      await expect(current.owner.markNotExecuted(operationId, changed, current.ownerCtx)).rejects.toThrow('does not match')
      expect(await readFile(current.cutPath)).toEqual(bytes)
    }
    await expect(current.owner.markNotExecuted(brandString<PrototypeOperationId>('absent'), receipt, current.ownerCtx))
      .rejects.toThrow('ISSUED')
    await current.owner.markUnknown(operationId, current.ownerCtx)
    const unknownBytes = await readFile(current.cutPath)
    await expect(current.owner.markNotExecuted(operationId, receipt, current.ownerCtx)).rejects.toThrow('ISSUED')
    expect(await readFile(current.cutPath)).toEqual(unknownBytes)
    await current.stop()
    const reopened = await fixture(current.controlRoot)
    expect(() => { reopened.owner.assertDispatchable(run.runId, reopened.ownerCtx) }).toThrow('not dispatchable')
    expect((await reopened.runtime.readPersistentActivity()).unsettledOperationIds).toEqual([operationId])
  })

  it('preserves a denial in the verified backup and adjacent recovery candidate', async () => {
    const current = await fixture()
    await current.owner.registerRun(run, hash, current.ownerCtx)
    await current.owner.admit(run.runId, operationId, intent, current.ownerCtx)
    await current.owner.markNotExecuted(operationId, receipt, current.ownerCtx)
    await current.owner.revoke(current.ownerCtx)
    const bytes = await readFile(current.cutPath)
    await current.stop()
    const recovery = await coordinator(current.controlRoot)
    const frozen = await recovery.value.freeze(recovery.authority)
    const prepared = await recovery.value.prepare('9'.repeat(64), checkPrototypeFormat3, recovery.authority)
    expect(await readFile(join(current.controlRoot, prepared.backupDirectory, 'prototype-activity.json'))).toEqual(bytes)
    await recovery.value.activate(prepared, recovery.authority)
    expect(await readFile(current.cutPath)).toEqual(bytes)
    const candidate = validatePrototypeActivity(JSON.parse(await readFile(join(current.controlRoot, prepared.candidateDirectory, 'prototype-activity.json'), 'utf8')))
    expect(candidate.format).toBe(4)
    expect(candidate.runs).toEqual(frozen.cut.runs)
    await recovery.value.close(recovery.authority)
    const reopened = await fixture(current.controlRoot)
    expect((await reopened.runtime.readPersistentActivity()).unsettledOperationIds).toEqual([])
    expect(() => { reopened.owner.assertDispatchable(run.runId, reopened.ownerCtx) }).toThrow('recovery-only')
    await expect(reopened.owner.markNotExecuted(operationId, receipt, reopened.ownerCtx)).rejects.toThrow('not active')
  })

  it.each([1, 2] as const)('reads legacy format %s without allowing mutation or rewriting its generation', async (format) => {
    const current = await fixture()
    const legacy = {
      format, compositionHash: hash, revision: 1, executor: format === 1 ? 'active' : 'revoked',
      ...(format === 2 ? { recoveryOnly: true, predecessorCompositionHash: hash } : {}), runs: [run],
    }
    await writeFile(current.cutPath, `${JSON.stringify(legacy)}\n`)
    await current.stop()
    const bytes = await readFile(current.cutPath)
    const reopened = await fixture(current.controlRoot)
    expect((await reopened.runtime.readPersistentActivity()).completenessErrors).toEqual([])
    expect(() => { reopened.owner.assertDispatchable(run.runId, reopened.ownerCtx) }).toThrow('legacy')
    if (format === 1) await expect(checkPrototypeFormat1(reopened.dataRoot)).rejects.toThrow('revoked')
    await expect(reopened.owner.registerRun({ ...run, runId: brandString<PrototypeRunId>('fresh-run') }, hash, reopened.ownerCtx)).rejects.toThrow('legacy')
    await expect(reopened.owner.markNotExecuted(operationId, receipt, reopened.ownerCtx)).rejects.toThrow('not active')
    await expect(reopened.owner.markCompleted(operationId, reopened.ownerCtx)).rejects.toThrow('not active')
    await expect(reopened.owner.markUnknown(operationId, reopened.ownerCtx)).rejects.toThrow('not active')
    expect(() => reopened.owner.pause(run.runId, reopened.ownerCtx)).toThrow('cannot be paused')
    if (format === 1) await expect(reopened.owner.revoke(reopened.ownerCtx)).rejects.toThrow('read-only')
    else await reopened.owner.revoke(reopened.ownerCtx)
    expect(await readFile(current.cutPath)).toEqual(bytes)
  })

  it('keeps the legacy 1 to 2 recovery path and original bytes intact', async () => {
    const current = await fixture()
    const legacy = { format: 1, compositionHash: hash, revision: 1, executor: 'revoked', runs: [run] }
    await writeFile(current.cutPath, `${JSON.stringify(legacy)}\n`)
    await current.stop()
    const bytes = await readFile(current.cutPath)
    const recovery = await coordinator(current.controlRoot)
    await recovery.value.freeze(recovery.authority)
    const prepared = await recovery.value.prepare('9'.repeat(64), checkPrototypeFormat1, recovery.authority)
    await recovery.value.activate(prepared, recovery.authority)
    expect(await readFile(current.cutPath)).toEqual(bytes)
    expect(await checkPrototypeFormat1(join(current.controlRoot, prepared.backupDirectory))).toEqual(legacy)
    const candidate = prototypeActivitySchema.parse(JSON.parse(await readFile(join(current.controlRoot, prepared.candidateDirectory, 'prototype-activity.json'), 'utf8')))
    expect(candidate.format).toBe(2)
  })
})

describe('durable browser denial validation', () => {
  const operation = { operationId, businessIntent: intent, status: 'NOT_EXECUTED', receipt }
  const cut = { format: 3, compositionHash: hash, revision: 1, executor: 'active', runs: [{ ...run, operations: [operation] }] }

  it('rejects a terminal denial in legacy strict formats', () => {
    expect(() => validatePrototypeActivity({ ...cut, format: 1 })).toThrow()
    expect(() => validatePrototypeActivity({ ...cut, format: 2, executor: 'revoked', recoveryOnly: true, predecessorCompositionHash: hash })).toThrow()
  })

  it.each([
    { receipt: undefined },
    { receipt: { ...receipt, requestId: -1 } },
    { receipt: { ...receipt, outcome: 'unknown' } },
    { receipt: { ...receipt, reason: 'invalid-reply' } },
    { receipt: { ...receipt, operationId: 'unrelated-operation' } },
    { receipt: { ...receipt, runId: 'unrelated-run' } },
    { receipt: { ...receipt, sessionId: 'unrelated-session' } },
    { receipt: { ...receipt, parametersHash: '9'.repeat(64) } },
  ])('rejects incomplete or mismatched durable receipts %#', (change) => {
    expect(() => validatePrototypeActivity({ ...cut, runs: [{ ...run, operations: [{ ...operation, ...change }] }] })).toThrow()
  })

  it('does not interpret a denied operation as a completed run', () => {
    expect(() => validatePrototypeActivity({ ...cut, runs: [{ ...run, status: 'COMPLETED', operations: [operation] }] })).toThrow('completed run')
  })
})
