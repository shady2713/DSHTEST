/** Test-only current built profile consumer for seeded operation and reference materials. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { loadProfileDirectory } from '../../../../boot/app-boot/lib/index.js'
import { runProfile } from '../../../../../apps/cli/lib/profile-boot.js'
import { createLaunchEnvironmentSnapshot } from '../../../../util/launch-environment/lib/index.js'
import { issueRecoveryAuthority, readPersistentActivity } from '../../lib/index.js'

const [mode, root, compositionHash, countText] = process.argv.slice(2)
assert.ok(root && compositionHash)
assert.ok(['ordinary', 'cold-reopen', 'bad-cut', 'recovery'].includes(mode))
const count = Number(countText)
const controlRoot = join(root, 'control')
const built = path => new URL(path, import.meta.url).href
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const beforePointer = await readFile(join(controlRoot, 'current.json'))
const selected = JSON.parse(beforePointer)
const dataRoot = join(controlRoot, selected.directory)
const beforeActivity = await readFile(join(dataRoot, 'prototype-activity.json'))
const index = JSON.parse(await readFile(join(dataRoot, 'reference-index.json'), 'utf8'))
for (const object of index.objects) assert.equal(hash(await readFile(join(dataRoot, object.path))), object.sha256)
const directory = join(root, `profile-${mode}`)
await mkdir(directory)
await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'p02-representative-test', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }), { flag: 'wx' })
const entries = mode === 'recovery' ? [
  { id: 'recovery', name: built('../../../web-test/lib/recovery-entry.js'), config: { controlRoot } },
] : [
  { id: 'storage', name: built('../../../../storage/storage/lib/index.js') },
  { id: 'json', name: built('../../../../storage/storage-json/lib/index.js'), config: { root: join(root, 'unused-backend') } },
  { id: 'domain', name: built('../../../../storage/storage-domain/lib/index.js'), config: { backend: 'json' } },
  { id: 'agents', name: built('../../../../core/agent/lib/index.js') },
  { id: 'runtime', name: built('../../lib/index.js'), config: { controlRoot, storageMode: 'generation-json' } },
  { id: 'owner', name: built('../../../web-test/lib/prototype-entry.js') },
]
await writeFile(join(directory, 'cordis.patch.yml'), `- insert: ${JSON.stringify(entries)}\n`, { flag: 'wx' })
const installAnchor = fileURLToPath(new URL('../../../../../apps/cli/package.json', import.meta.url))
const profile = loadProfileDirectory('p02 representative test', directory, installAnchor)
const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_HOME: join(root, 'home'), DSH_TELEMETRY_DISABLED: '1' } }])
const openStart = performance.now()
const running = await runProfile({ environment, profile: 'p02-representative-test', resolvedProfile: { profile, installAnchor }, applicationPatchFiles: [], patchFiles: [], args: ['--no-open'] })
const openMs = performance.now() - openStart
let result
try {
  const readStart = performance.now()
  const snapshot = await readPersistentActivity(controlRoot)
  if (snapshot.completenessErrors.length === 0) {
    const rows = new Map(snapshot.runHeads.flatMap(run => run.operations.map(operation => [operation.operationId, { run, operation }])))
    const objects = new Map(index.objects.map(object => [object.path, object]))
    assert.equal(index.references.length, count)
    let runReferenceEntries = 0
    for (const run of snapshot.runHeads) {
      for (const path of [...run.attachments, ...run.reports]) assert.ok(objects.has(path))
      runReferenceEntries += run.attachments.length + run.reports.length
    }
    assert.equal(runReferenceEntries, count)
    for (let ordinal = 0; ordinal < count; ordinal += 1) {
      const reference = index.references[ordinal]
      const row = rows.get(`seed-operation-${String(ordinal)}`)
      assert.ok(reference && row)
      const parametersHash = hash(JSON.stringify({ index: ordinal, attachment: objects.get(reference.attachment), report: objects.get(reference.report) }))
      assert.equal(reference.operationId, row.operation.operationId)
      assert.equal(reference.parametersHash, parametersHash)
      assert.deepEqual(row.operation.businessIntent, { kind: 'synthetic-material', target: `owned-record-${String(ordinal)}`, parametersHash })
      const bucket = ordinal % 20
      const name = bucket < 12 ? 'completed' : bucket < 14 ? 'unknown' : bucket < 16 ? 'issued' : bucket < 18 ? 'not-executed' : 'paused'
      assert.equal(row.run.runId, `seed-${name}`)
      assert.equal(row.operation.status, name === 'completed' || name === 'paused' ? 'COMPLETED' : name === 'unknown' ? 'UNKNOWN' : name === 'issued' ? 'ISSUED' : 'NOT_EXECUTED')
    }
  }
  const readMs = performance.now() - readStart
  if (mode === 'recovery') {
    const recovery = running.ctx.get('webTestRecovery')
    assert.ok(recovery)
    for (const service of ['webTestRuntime', 'agents', 'tools']) assert.equal(running.ctx.get(service), undefined)
    const authority = issueRecoveryAuthority(Reflect.get(recovery, Symbol.for('cordis.original')).ctx)
    const recoveryStart = performance.now()
    const frozen = await recovery.freeze(authority)
    const prepared = await recovery.prepare(compositionHash, authority)
    await recovery.activate(prepared, authority)
    const after = await recovery.inspect()
    assert.deepEqual(after.runHeads, snapshot.runHeads)
    assert.deepEqual(after.unsettledOperationIds, snapshot.unsettledOperationIds)
    const candidate = JSON.parse(await readFile(join(controlRoot, prepared.candidateDirectory, 'prototype-activity.json'), 'utf8'))
    assert.equal(candidate.format, 4)
    assert.equal(candidate.recoveryOnly, true)
    assert.equal(candidate.executor, 'revoked')
    for (const object of index.objects) assert.equal(hash(await readFile(join(controlRoot, prepared.candidateDirectory, object.path))), object.sha256)
    assert.equal(hash(await readFile(join(dataRoot, 'prototype-activity.json'))), hash(beforeActivity))
    result = { openMs, readMs, recoveryMs: performance.now() - recoveryStart, frozenFiles: frozen.files.length,
      retainedOperations: after.runHeads.reduce((sum, run) => sum + run.operations.length, 0), recoveryOnly: true,
      predecessorUnchanged: true, unknownIdentitiesUnchanged: true, generation: after.generation }
  } else {
    const runtime = running.ctx.get('webTestRuntime')
    const owner = running.ctx.get('webTestPrototypeOwner')
    assert.ok(runtime && owner)
    const ownerCtx = Reflect.get(owner, Symbol.for('cordis.original')).ctx
    const intent = { kind: 'bounded-owned-receipt', target: 'receipt-public.txt', parametersHash: hash('one owned receipt\n') }
    if (mode === 'cold-reopen') {
      assert.deepEqual(snapshot.completenessErrors, [])
      assert.equal(snapshot.runHeads.reduce((sum, run) => sum + run.operations.length, 0), count + 1)
      assert.equal(JSON.parse(beforeActivity).executor, 'revoked')
      await assert.rejects(owner.admit('seed-allowed', 'cold-fresh-operation', intent, ownerCtx))
      assert.equal(hash(await readFile(join(dataRoot, 'prototype-activity.json'))), hash(beforeActivity))
      result = { openMs, readMs, coldReopenRetainedCount: count + 1, revokedAdmissionDenied: true, cutUnchanged: true }
    } else if (mode === 'bad-cut') {
      assert.ok(snapshot.completenessErrors.length > 0)
      await assert.rejects(owner.admit('seed-allowed', 'one-real-admission', intent, ownerCtx))
      assert.equal(hash(await readFile(join(dataRoot, 'prototype-activity.json'))), hash(beforeActivity))
      assert.equal(hash(await readFile(join(controlRoot, 'current.json'))), hash(beforePointer))
      result = { openMs, readMs, badCutQueryRefused: true, admissionRefused: true, originalCutAndPointerUnchanged: true }
    } else {
      assert.deepEqual(snapshot.completenessErrors, [])
      assert.equal(snapshot.runHeads.reduce((sum, run) => sum + run.operations.length, 0), count)
      assert.throws(() => owner.assertDispatchable('seed-unknown', ownerCtx))
      assert.throws(() => owner.assertDispatchable('seed-issued', ownerCtx))
      assert.throws(() => owner.assertDispatchable('seed-paused', ownerCtx))
      const beforeColdDenied = hash(await readFile(join(dataRoot, 'prototype-activity.json')))
      for (const head of ['seed-unknown', 'seed-issued', 'seed-paused']) {
        await assert.rejects(owner.admit(head, `new-intent-${head}`, { ...intent, target: `fresh-${head}` }, ownerCtx))
      }
      assert.equal(hash(await readFile(join(dataRoot, 'prototype-activity.json'))), beforeColdDenied)
      const unknown = snapshot.runHeads.find(run => run.runId === 'seed-unknown').operations[0]
      const beforeDenied = hash(await readFile(join(dataRoot, 'prototype-activity.json')))
      await assert.rejects(owner.admit('seed-allowed', 'new-identity-same-unknown-intent', unknown.businessIntent, ownerCtx))
      assert.equal(hash(await readFile(join(dataRoot, 'prototype-activity.json'))), beforeDenied)
      const commitStart = performance.now()
      await owner.admit('seed-allowed', 'one-real-admission', intent, ownerCtx)
      owner.assertDispatchable('seed-allowed', ownerCtx)
      await writeFile(join(dataRoot, 'receipt-public.txt'), 'one owned receipt\n', { flag: 'wx' })
      assert.equal(hash(await readFile(join(dataRoot, 'receipt-public.txt'))), intent.parametersHash)
      await owner.markCompleted('one-real-admission', ownerCtx)
      const commitMs = performance.now() - commitStart
      const settled = hash(await readFile(join(dataRoot, 'prototype-activity.json')))
      await assert.rejects(owner.admit('seed-allowed', 'same-intent-new-operation', intent, ownerCtx))
      assert.equal(hash(await readFile(join(dataRoot, 'prototype-activity.json'))), settled)
      await owner.revoke(ownerCtx)
      const after = await runtime.readPersistentActivity()
      assert.deepEqual(after.unsettledOperationIds, snapshot.unsettledOperationIds)
      for (const run of snapshot.runHeads.filter(run => run.runId !== 'seed-allowed')) {
        assert.deepEqual(after.runHeads.find(row => row.runId === run.runId), run)
      }
      result = { openMs, readMs, commitMs, actualAdmitCallsSucceeded: 1, actualOwnedFileWrites: 1,
        actualBusinessNetworkCalls: 0, coldUnknownAndIssuedDenied: true, duplicateUnknownIntentInAllowedHeadDenied: true,
        revoked: true, seededHeadsUnchanged: true, outboxCovered: false }
    }
  }
}
finally {
  const closeStart = performance.now()
  await running.shutdown.shutdown(0)
  if (result) result.closeMs = performance.now() - closeStart
}
console.log(`P02_CONSUMER_RESULT:${JSON.stringify({ mode, count, ...result, memory: process.memoryUsage(), realApiCalls: 0, guiActions: 0 })}`)
