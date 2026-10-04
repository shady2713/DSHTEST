/** Internal material seed; no production Runtime mount or business dispatch occurs here. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Context, Service } from '@deepseek-ai/cordis'
import { prepareControlRoot, resolveDataGeneration, controlLockName } from '../../src/control-root.ts'
import { ControlRootLock } from '../../src/lock.ts'
import { PrototypeActivityStore, resolveControlWritePolicy } from '../../src/recovery.ts'
import { prototypeActivitySchema, prototypeOperationSchema } from '../../src/recovery-spec.ts'
import type { PrototypeOperation } from '../../src/recovery-spec.ts'

const [root, countText, compositionHash] = process.argv.slice(2)
assert.ok(root && compositionHash)
const count = Number(countText)
assert.ok([1000, 10000, 100000].includes(count))
assert.match(compositionHash, /^[a-f0-9]{64}$/)
const digest = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex')
const started = performance.now()
const prepared = await prepareControlRoot(root)
assert.equal(prepared.created, true, 'Seed must exclusively create the final root')
const lock = await ControlRootLock.acquire(controlLockName(prepared.canonicalRoot))
const ctx = new Context()
let owningContext: Context | undefined
// A real fixture-owned Service supplies the store role; this is not production Runtime admission.
class MaterialSeedOwner extends Service {
  constructor(context: Context) {
    super(context, 'webTestRuntime')
    owningContext = this.ctx
  }
}
try {
  await ctx.plugin(MaterialSeedOwner)
  assert.ok(owningContext)
  const owner = owningContext
  const result = await resolveDataGeneration(prepared.canonicalRoot, {
    rootCreated: prepared.created,
    initialize: async (generation) => {
      const objects = []
      for (let index = 0; index < 96; index += 1) {
        const kind = index < 64 ? 'attachment' : 'report'
        const path = `${kind}-${String(index).padStart(3, '0')}.txt`
        const bytes = `${JSON.stringify({ kind, index, synthetic: true })}\n${'x'.repeat(1024)}\n`
        await writeFile(join(generation.dataRoot, path), bytes, { flag: 'wx', mode: 0o600 })
        objects.push({ path, sha256: digest(bytes), bytes: Buffer.byteLength(bytes) })
      }
      const runNames = ['completed', 'unknown', 'issued', 'not-executed', 'paused']
      const operations: Array<{ group: number; operation: PrototypeOperation }> = []
      const references: Array<{ operationId: string; attachment: string; report: string; parametersHash: string }> = []
      for (let index = 0; index < count; index += 1) {
        const bucket = index % 20
        const group = bucket < 12 ? 0 : bucket < 14 ? 1 : bucket < 16 ? 2 : bucket < 18 ? 3 : 4
        const operationId = `seed-operation-${String(index)}`
        const attachment = objects[index % 64]
        const report = objects[64 + index % 32]
        assert.ok(attachment && report)
        const parametersHash = digest(JSON.stringify({ index, attachment, report }))
        const status = group === 0 || group === 4 ? 'COMPLETED' : group === 1 ? 'UNKNOWN' : group === 2 ? 'ISSUED' : 'NOT_EXECUTED'
        const operation = prototypeOperationSchema.parse({
          operationId, businessIntent: { kind: 'synthetic-material', target: `owned-record-${String(index)}`, parametersHash }, status,
          ...(status === 'NOT_EXECUTED' ? { receipt: {
            operationId, runId: `seed-${runNames[group]}`, sessionId: `seed-session-${runNames[group]}`,
            callId: `synthetic-call-${String(index)}`, requestId: index, target: 'synthetic-target', hostEpoch: 0,
            parametersHash, outcome: 'not-executed', reason: 'revoked',
          } } : {}),
        })
        operations.push({ group, operation })
        references.push({ operationId, attachment: attachment.path, report: report.path, parametersHash })
      }
      const runs = runNames.map((name, group) => ({
        runId: `seed-${name}`, sessionId: `seed-session-${name}`, headRevision: 1,
        status: group === 0 ? 'COMPLETED' : group === 1 ? 'UNKNOWN' : group === 4 ? 'PAUSED' : 'RUNNING',
        pauseRequested: group === 4, cancelRequested: false,
        operations: operations.filter(row => row.group === group).map(row => row.operation),
        attachments: references.filter((_, index) => operations[index]?.group === group && index % 2 === 0).map(row => row.attachment),
        reports: references.filter((_, index) => operations[index]?.group === group && index % 2 === 1).map(row => row.report),
      }))
      // Fresh no-UNKNOWN admission is tested in a separate existing head, not by escaping an unknown head.
      runs.push({ runId: 'seed-allowed', sessionId: 'seed-session-allowed', headRevision: 1,
        status: 'RUNNING', pauseRequested: false, cancelRequested: false, operations: [], attachments: [], reports: [] })
      const cut = prototypeActivitySchema.parse({ format: 3, compositionHash, revision: 1, executor: 'active', runs })
      await writeFile(join(generation.dataRoot, 'reference-index.json'), `${JSON.stringify({ objects, references })}\n`, { flag: 'wx', mode: 0o600 })
      const preparationMs = performance.now() - started
      const store = new PrototypeActivityStore(owner, generation.dataRoot, resolveControlWritePolicy([20, 40, 80, 160]))
      const commitStart = performance.now()
      await store.initialize(cut)
      const seedCommitMs = performance.now() - commitStart
      // Closing would revoke the seed; disposal here releases only the fixture Service and root lock.
      console.log(`P02_SEED_RESULT:${JSON.stringify({ count, uniqueIntents: count, seededOperationStatuses: {
        COMPLETED: count * 0.7, UNKNOWN: count * 0.1, ISSUED: count * 0.1, NOT_EXECUTED: count * 0.1,
      }, runs: 6, sessions: 6, referenceEntries: count, uniqueReferenceFiles: 96,
      syntheticReceiptCount: count * 0.1, actualAdmitCalls: 0, actualBusinessDispatches: 0,
      preparationMs, seedCommitMs, activityHash: digest(await readFile(join(generation.dataRoot, 'prototype-activity.json'))),
      memory: process.memoryUsage() })}`)
    },
  })
  assert.equal(result.generation, 1)
}
finally {
  try { await ctx.fiber.dispose() }
  finally { lock.release() }
}
