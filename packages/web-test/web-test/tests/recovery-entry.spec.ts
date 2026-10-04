/** The real recovery Service selects a verified successor and preserves its original generation. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { issueRecoveryAuthority, prototypeActivitySchema } from '@deepseek-ai/dsh-web-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { WebTestRecovery } from '../src/recovery-entry.ts'
import { cleanup, startRuntime } from '../../web-test-runtime/tests/harness.ts'

const hash = '3'.repeat(64), replacementHash = '4'.repeat(64)
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  await cleanup()
})

async function fixture(format: 1 | 3, executor: 'active' | 'revoked' = 'revoked') {
  const runtime = await startRuntime({ freshRoot: true, storageMode: 'generation-json', windowsRenameDelaysMs: [] })
  disposers.push(() => runtime.stop())
  const cutPath = join(runtime.dataRoot, 'prototype-activity.json')
  const cut = prototypeActivitySchema.parse({
    format, compositionHash: hash, revision: 2, executor,
    runs: [{
      runId: 'old-unknown-run', sessionId: 'unloaded-session', headRevision: 2, status: 'UNKNOWN',
      pauseRequested: true, cancelRequested: false, attachments: [], reports: ['owned-report.txt'],
      operations: [{ operationId: 'original-operation', status: 'UNKNOWN',
        businessIntent: { kind: 'click', target: 'original-target', parametersHash: hash } }],
    }],
  })
  await writeFile(cutPath, `${JSON.stringify(cut)}\n`)
  await writeFile(join(runtime.dataRoot, 'owned-report.txt'), 'owned report\n')
  await runtime.stop()
  const root = new Context()
  disposers.push(() => root.fiber.dispose())
  await root.plugin(WebTestRecovery, { controlRoot: runtime.controlRoot, windowsRenameDelaysMs: [] })
  const raw: unknown = Reflect.get(root.webTestRecovery, Symbol.for('cordis.original'))
  if (!(raw instanceof WebTestRecovery)) throw new Error('recovery Service absent')
  const ownerCtx: unknown = Reflect.get(raw, 'ctx')
  if (!Context.is(ownerCtx)) throw new Error('recovery Context absent')
  const authority = issueRecoveryAuthority(ownerCtx)
  return { ...runtime, root, recovery: raw, authority, cutPath, cut }
}

describe.skipIf(process.platform !== 'win32')('recovery entry format selection', () => {
  it.each([1, 3] as const)('recovers executor format %s while retaining UNKNOWN, reports and the original selected data', async (format) => {
    const current = await fixture(format)
    const original = await readFile(current.cutPath)
    const pointer = await readFile(join(current.controlRoot, 'current.json'))
    await expect(current.recovery.prepare(replacementHash, current.authority)).rejects.toThrow('freeze is required')
    expect(await readFile(join(current.controlRoot, 'current.json'))).toEqual(pointer)
    expect(await readFile(current.cutPath)).toEqual(original)
    const frozen = await current.recovery.freeze(current.authority)
    expect(frozen.cut).toEqual(current.cut)
    const prepared = await current.recovery.prepare(replacementHash, current.authority)
    expect(await readFile(join(current.controlRoot, prepared.backupDirectory, 'prototype-activity.json'))).toEqual(original)
    await current.recovery.activate(prepared, current.authority)
    const snapshot = await current.recovery.inspect()
    expect(snapshot.completenessErrors).toEqual([])
    expect(snapshot.generation).toBe(2)
    expect(snapshot.runHeads).toEqual(current.cut.runs)
    expect(snapshot.unsettledOperationIds).toEqual(['original-operation'])
    const candidate = prototypeActivitySchema.parse(JSON.parse(await readFile(join(current.controlRoot, prepared.candidateDirectory, 'prototype-activity.json'), 'utf8')))
    expect(candidate.format).toBe(format === 1 ? 2 : 4)
    expect(candidate.executor).toBe('revoked')
    expect(await readFile(current.cutPath)).toEqual(original)
    expect(await readFile(join(current.controlRoot, prepared.candidateDirectory, 'owned-report.txt'), 'utf8')).toBe('owned report\n')
  })

  it.each([1, 3] as const)('refuses active format %s before any generation switch', async (format) => {
    const current = await fixture(format, 'active')
    const pointer = await readFile(join(current.controlRoot, 'current.json'))
    const original = await readFile(current.cutPath)
    await expect(current.recovery.freeze(current.authority)).rejects.toThrow('revoked')
    expect(await readFile(join(current.controlRoot, 'current.json'))).toEqual(pointer)
    expect(await readFile(current.cutPath)).toEqual(original)
  })

  it.each([1, 3] as const)('refuses a changed format %s candidate while preserving the original pointer and cut', async (format) => {
    const current = await fixture(format)
    const pointer = await readFile(join(current.controlRoot, 'current.json'))
    const original = await readFile(current.cutPath)
    await current.recovery.freeze(current.authority)
    const prepared = await current.recovery.prepare(replacementHash, current.authority)
    await writeFile(join(current.controlRoot, prepared.candidateDirectory, 'owned-report.txt'), 'changed report')
    await expect(current.recovery.activate(prepared, current.authority)).rejects.toThrow('inventory mismatch')
    expect(await readFile(join(current.controlRoot, 'current.json'))).toEqual(pointer)
    expect(await readFile(current.cutPath)).toEqual(original)
  })
})
