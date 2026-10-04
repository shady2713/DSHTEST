/** Bounded recovery prototype through actual runProfile, using only owned public data. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { createLaunchEnvironmentSnapshot } from '../../../../util/launch-environment/lib/index.js'
import { runProfile } from '../../../../../apps/cli/lib/profile-boot.js'
import { issueRecoveryAuthority } from '../../../web-test-runtime/lib/index.js'

const [mode, root, businessUrl] = process.argv.slice(2)
assert.ok(root)
const controlRoot = join(root, 'control')
const installAnchor = fileURLToPath(new URL('../../../../../apps/cli/package.json', import.meta.url))
const intent = { kind: 'create', target: 'public-record-1', parametersHash: '3'.repeat(64) }
const built = path => new URL(path, import.meta.url).href
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const digestEntries = async paths => hash(Buffer.concat(await Promise.all(paths.map(path => readFile(new URL(path, import.meta.url))))))
const oldHash = await digestEntries(['../../../web-test-runtime/lib/index.js', '../../lib/prototype-entry.js', '../../web-test.cordis.patch.yml'])
const newHash = await digestEntries(['../../../web-test-runtime/lib/index.js', '../../lib/recovery-entry.js'])

async function launch(recovery) {
  const dir = join(root, recovery ? 'recovery-profile' : 'old-profile')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'public-m0-recovery-profile', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }))
  const entries = recovery ? [{ id: 'recovery', name: built('../../lib/recovery-entry.js'), config: { controlRoot } }] : [
    { id: 'storage', name: built('../../../../storage/storage/lib/index.js') },
    { id: 'json', name: built('../../../../storage/storage-json/lib/index.js'), config: { root: join(root, 'unused-backend') } },
    { id: 'domain', name: built('../../../../storage/storage-domain/lib/index.js'), config: { backend: 'json' } },
    { id: 'agents', name: built('../../../../core/agent/lib/index.js') },
    { id: 'runtime', name: built('../../../web-test-runtime/lib/index.js'), config: { controlRoot, storageMode: 'generation-json' } },
    { id: 'prototype-owner', name: built('../../lib/prototype-entry.js') },
  ]
  await writeFile(join(dir, 'cordis.patch.yml'), `- insert: ${JSON.stringify(entries)}\n`)
  const profile = loadProfileDirectory('m0 public recovery', dir, installAnchor)
  const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: {
    DSH_HOME: join(root, 'home'), DSH_TELEMETRY_DISABLED: '1',
  } }])
  return runProfile({ environment, profile: recovery ? 'm0-recovery' : 'm0-old',
    resolvedProfile: { profile, installAnchor }, applicationPatchFiles: [], patchFiles: [], args: ['--no-open'] })
}

const running = await launch(mode !== 'old')
if (mode === 'old') {
  const runtime = running.ctx.webTestRuntime
  const owner = running.ctx.webTestPrototypeOwner
  assert.ok(owner, 'The installed prototype producer activated')
  const ownerCtx = Reflect.get(owner, Symbol.for('cordis.original')).ctx
  for (const run of [
    { runId: 'paused-run', sessionId: 'never-loaded-paused', headRevision: 1, status: 'PAUSED', pauseRequested: true, cancelRequested: false,
      operations: [], attachments: ['attachment.txt'], reports: ['report.txt'] },
    { runId: 'old-run', sessionId: 'never-loaded-unknown', headRevision: 1, status: 'RUNNING', pauseRequested: false, cancelRequested: false,
      operations: [], attachments: [], reports: [] },
    { runId: 'new-run', sessionId: 'never-loaded-new', headRevision: 1, status: 'RUNNING', pauseRequested: false, cancelRequested: false,
      operations: [], attachments: [], reports: [] },
  ]) await owner.registerRun(run, oldHash, ownerCtx)
  const dataRoot = runtime.identity().dataRoot
  await writeFile(join(dataRoot, 'attachment.txt'), 'public attachment\n')
  await writeFile(join(dataRoot, 'report.txt'), 'public report\n')
  await owner.admit('old-run', 'original-operation', intent, ownerCtx)
  try { await fetch(businessUrl, { method: 'POST', body: 'public-record-1' }) }
  catch (error) { /* The public endpoint records the operation and drops its response. */ }
  await owner.markUnknown('original-operation', ownerCtx)
  assert.deepEqual(running.ctx.agents.list(), [])
  process.send?.({ type: 'ready', snapshot: await runtime.readPersistentActivity() })
  process.on('message', message => {
    if (message?.type !== 'revoke') return
    void (async () => {
      await owner.revoke(ownerCtx)
      await assert.rejects(owner.admit('new-run', 'new-command-operation', intent, ownerCtx))
      process.send?.({ type: 'revoked' })
    })().catch(error => { console.error(error); process.exitCode = 1 })
  })
  // The prototype's stalled executor never answers a business-completion request.
  setInterval(() => {}, 1000)
} else {
  try {
    const recovery = running.ctx.webTestRecovery
    if (recovery === undefined) {
      await running.shutdown.shutdown(1)
      throw new Error('recovery profile entry did not activate; see its Loader diagnostic')
    }
    const authority = issueRecoveryAuthority(Reflect.get(recovery, Symbol.for('cordis.original')).ctx)
    assert.equal(running.ctx.get('webTestRuntime'), undefined)
    assert.equal(running.ctx.get('agents'), undefined)
    assert.equal(running.ctx.get('tools'), undefined)
    const before = await recovery.inspect()
    assert.deepEqual(before.completenessErrors, [])
    const frozen = await recovery.freeze(authority)
    assert.equal(frozen.cut.format, 3)
    const beforeReport = hash(await readFile(join(controlRoot, 'data', '1', 'report.txt')))
    const prepared = await recovery.prepare(newHash, authority)
    await recovery.activate(prepared, authority)
    const after = await recovery.inspect()
    assert.equal(after.generation, 2)
    assert.deepEqual(after.runHeads, before.runHeads)
    assert.deepEqual(after.unsettledOperationIds, ['original-operation'])
    assert.equal(hash(await readFile(join(controlRoot, prepared.candidateDirectory, 'report.txt'))), beforeReport)
    assert.equal(hash(await readFile(join(controlRoot, 'data', '1', 'report.txt'))), beforeReport)
    const cut = JSON.parse(await readFile(join(controlRoot, prepared.candidateDirectory, 'prototype-activity.json'), 'utf8'))
    assert.equal(cut.format, 4)
    assert.equal(cut.recoveryOnly, true)
    assert.equal(cut.executor, 'revoked')
    console.log(`RECOVERY_PROFILE_RESULT:${JSON.stringify({ before, after, oldHash, newHash, frozenGeneration: frozen.generation,
      retainedReportHash: beforeReport, recoveryOnly: true, businessServicesAbsent: true })}`)
  } finally { await running.shutdown.shutdown(0) }
}
