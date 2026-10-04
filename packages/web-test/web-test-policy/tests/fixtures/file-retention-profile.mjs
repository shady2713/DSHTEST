/** Installed-profile P07 fixture using only its own public files and a local LLM adapter. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerWebTestApplication, resolveWebTestApplication } from '../../../web-test/lib/index.js'
import { runProfile } from '../../../../../apps/cli/lib/profile-boot.js'
import { loadProfileDirectory } from '../../../../boot/app-boot/lib/index.js'
import { createLaunchEnvironmentSnapshot } from '../../../../util/launch-environment/lib/index.js'
import QuickJsPtcRuntime, { isQuickJsPtcRuntime } from '../../../../ptc-runtime/ptc-runtime-quickjs/lib/index.js'

const cliAnchor = fileURLToPath(new URL('../../../../../apps/cli/package.json', import.meta.url))
const baseRequire = createRequire(new URL('../../../../bundle/base/package.json', import.meta.url))
const installed = name => import(pathToFileURL(baseRequire.resolve(name)).href)
const { LocalAttachmentStore } = await installed('@deepseek-ai/dsh-attachment-local')
const { LocalFileSystem } = await installed('@deepseek-ai/dsh-fs-local')
const { LlmAdapter, ToolCallId, createUserMessage } = await installed('@deepseek-ai/dsh-llm')
const application = resolveWebTestApplication({ base: process.cwd() })
Object.assign(process.env, application.launchEnvironment)
const releaseApplication = registerWebTestApplication(application)
const counters = {}
const raw = {}
const fsCounters = {}
const rawFs = {}
let actualPtcRuns = 0
const rawPtcRun = QuickJsPtcRuntime.prototype.run
QuickJsPtcRuntime.prototype.run = function (...args) { actualPtcRuns++; return Reflect.apply(rawPtcRun, this, args) }
for (const name of ['readText', 'readBytes', 'writeText', 'editText']) {
  const method = LocalFileSystem.prototype[name]
  if (typeof method !== 'function') continue
  rawFs[name] = method
  LocalFileSystem.prototype[name] = function (...args) {
    fsCounters[name] = (fsCounters[name] ?? 0) + 1
    return Reflect.apply(method, this, args)
  }
}
for (const name of ['saveFile', 'stageFile', 'stageFileStream', 'commitFileReferences', 'releaseFileReferences',
  'releaseFileStage', 'acquireFileReadLease', 'readFileStream', 'deleteFile']) {
  raw[name] = LocalAttachmentStore.prototype[name]
  LocalAttachmentStore.prototype[name] = function (...args) {
    counters[name] = (counters[name] ?? 0) + 1
    return Reflect.apply(raw[name], this, args)
  }
}
let running
process.on('message', (message) => {
  if (message?.type === 'p07-shutdown') {
    void running?.shutdown.shutdown(1).finally(() => { if (process.connected) process.disconnect() })
  }
})
let program
let modelCalls = 0
class LocalMockAdapter extends LlmAdapter {
  async listModels(provider) { return [{ provider, id: 'local', name: 'Local fixture' }] }
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(options) {
    modelCalls++
    if (options.messages.at(-1)?.role !== 'tool') {
      const args = JSON.stringify({ code: program, description: 'Check owned file management refusals' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('p07-actual-ptc'), name: 'run_code', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('p07-actual-ptc'), name: 'run_code', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'P07 local file checks completed.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'P07 local file checks completed.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function ledger() {
  const directory = join(application.home, 'storages')
  const names = (await readdir(directory)).filter(name => name.startsWith('attachment_files_') && name.endsWith('.json'))
  assert.equal(names.length, 1)
  return JSON.parse(await readFile(join(directory, names[0]), 'utf8')).global
}
try {
  const overlay = join(process.cwd(), 'public-fixture.patch.yml')
  await writeFile(overlay, '- id: session-title-llm\n  disabled: true\n- id: agent-instructions\n  disabled: true\n- id: tools\n  config:\n    mode: both\n')
  const profile = loadProfileDirectory('P07 public fixture', application.profileDir, cliAnchor)
  running = await runProfile({
    environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: { ...application.launchEnvironment, DEEPSEEK_API_KEY: '', DSH_DISABLE_TELEMETRY: '1' } }]),
    profile: 'web', resolvedProfile: { profile, installAnchor: cliAnchor },
    applicationPatchFiles: [application.compositionLayerPath], patchFiles: [overlay],
    args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
  })
  const { ctx } = running
  for (const service of ['webTest', 'webTestPolicy', 'webTestRuntime', 'ptcRuntime', 'sessionController', 'fileUploads', 'sessionLogExports']) {
    assert.ok(ctx.get(service), `installed profile missing ${service}`)
  }
  assert.ok(isQuickJsPtcRuntime(ctx.ptcRuntime), `installed profile provider identity: get=${isQuickJsPtcRuntime(ctx.get('ptcRuntime'))}, language=${ctx.ptcRuntime.language}, isolation=${ctx.ptcRuntime.isolation}`)
  ctx.llm.registerAdapter(['p07-local-mock'], new LocalMockAdapter())
  const sourceRoot = join(application.home, 'public-source')
  await mkdir(sourceRoot)
  const receipt = await ctx.webTestRuntime.registerProject({ commandId: 'cmd-p07-public-project', codeRoots: [sourceRoot], entryUrls: ['http://127.0.0.1/'] })
  const created = await ctx.sessionController.create({ cwd: sourceRoot, agentPreset: 'ptc' })
  const agent = ctx.agents.get(created.sessionId)
  assert.ok(agent)
  await ctx.sessionController.selectModel({ sessionId: created.sessionId, provider: 'p07-local-mock', model: 'local' })
  ctx.webTestPolicy.bindEntry(created.sessionId, receipt.resourceId)
  ctx.webTestPolicy.declareEnvironment({ projectId: receipt.resourceId, commandId: 'cmd-p07-declare', declaration: {
    codeRoots: [sourceRoot], entryUrl: 'http://127.0.0.1/', isTestEnvironment: true,
    login: { state: 'not-required' }, supplementaryRequirements: [],
  } })
  ctx.webTestPolicy.grantFlow({ sessionId: created.sessionId, flowId: 'p07-public', flowRevision: 1, thirdParty: false, actions: 30 })
  const store = ctx.attachments
  // A trusted fixture seeds a released-style unknown object before the user actions.
  const historicBytes = Buffer.from('Public unknown historic P07 file.\n')
  const historic = await Reflect.apply(raw.saveFile, store, [{ data: historicBytes, name: 'historic.txt' }])
  const upload = await ctx.fileUploads.upload(agent, { data: Buffer.from('Public staged P07 upload.\n').toString('base64'), name: 'staged.txt' }, new AbortController().signal)
  const historicPath = store.fileHostPath(historic)
  const uploadPath = store.fileHostPath(upload.file)
  assert.ok(historicPath && uploadPath)
  const beforeLedger = await ledger()
  assert.equal(beforeLedger.objects[historic.attachmentId].unknown, true)
  assert.ok(Object.values(beforeLedger.stages).some(ref => ref?.attachmentId === upload.file.attachmentId))
  const beforeHashes = [hash(await readFile(historicPath)), hash(await readFile(uploadPath))]
  const beforeFsCalls = structuredClone(fsCounters)
  program = `const output = []; for (const path of ${JSON.stringify([historicPath, uploadPath])}) {
    for (const [name, args] of [['read', { file_path: path }], ['write', { file_path: path, content: 'changed' }], ['edit', { file_path: path, old_string: 'Public', new_string: 'Changed' }]]) {
      try { const result = await tools[name](args); output.push({ name, denied: result.isError === true, result }); }
      catch (error) { output.push({ name, denied: true, error: String(error) }); }
    }
  } return { marker: 'REAL_PTC_COMPLETED', output, unavailable: [typeof process, typeof require, typeof fetch, typeof Buffer] };`
  const events = []
  const disposeObserver = ctx.on('session/event', (session, event) => { if (session === agent.session) events.push(event) })
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Run the public P07 checks.' }, { type: 'file', attachment: upload.file }] }))
  await agent.whenIdle()
  disposeObserver()
  const ptcResults = events.filter(event => event.type === 'tool/result' && event.data.message.toolCallId === 'p07-actual-ptc')
  assert.equal(ptcResults.length, 1, `actual Agent tool events: ${events.map(event => event.type).join(', ')}`)
  const resultText = ptcResults[0].data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  assert.ok(resultText.includes('REAL_PTC_COMPLETED'), resultText)
  assert.ok(!resultText.includes('UNKNOWN_TOOL'), resultText)
  const ptcOutput = JSON.parse(resultText)
  assert.equal(actualPtcRuns, 1)
  const nestedPtcDispatches = events.filter(event => event.type === 'tool/ptc-dispatch').length
  assert.equal(nestedPtcDispatches, 6)
  assert.deepEqual(ptcOutput.unavailable, ['undefined', 'undefined', 'undefined', 'undefined'])
  assert.equal(ptcOutput.output.length, 6)
  for (const result of ptcOutput.output) {
    assert.equal(result.denied, true, JSON.stringify(result))
    assert.match(JSON.stringify(result), /web testing policy refused/u)
  }
  assert.deepEqual(fsCounters, beforeFsCalls)
  assert.equal(modelCalls, 2)
  await ctx.sessions.flush(agent.session)
  const afterParent = await ledger()
  assert.ok(Object.values(afterParent.owners).some(row => row.owner.kind === 'session' && row.owner.id === created.sessionId && row.refs.some(ref => ref.attachmentId === upload.file.attachmentId)))
  const beforeManagement = structuredClone(counters)
  const stageTicket = Object.entries(afterParent.stages).find(([, ref]) => ref?.attachmentId === upload.file.attachmentId)?.[0]
  assert.ok(stageTicket)
  const management = [
    ['stageFile', [{ data: Uint8Array.of(1), name: 'user.txt' }]],
    ['stageFileStream', [{ data: (async function* () { yield Uint8Array.of(1) })(), name: 'user-stream.txt' }]],
    ['commitFileReferences', [{ kind: 'session', id: 'public-fake-owner' }, [upload.file]]],
    ['releaseFileReferences', [{ kind: 'session', id: created.sessionId }]],
    ['releaseFileStage', [stageTicket]],
    ['acquireFileReadLease', [[upload.file]]],
    ['readFileStream', [upload.file]],
    ['deleteFile', [upload.file]],
  ]
  for (const [name, args] of management) {
    await assert.rejects(async () => ctx.agents.withInitiator(agent, async () => {
      const result = Reflect.apply(store[name], store, args)
      if (name === 'readFileStream') { for await (const chunk of result) assert.fail(`unexpected ${chunk.byteLength} bytes`) }
      else await result
    }), /web testing policy refused/u)
  }
  assert.deepEqual(counters, beforeManagement)
  assert.deepEqual(await ledger(), afterParent)
  assert.deepEqual([hash(await readFile(historicPath)), hash(await readFile(uploadPath))], beforeHashes)
  const dynamicRunner = ctx.get('dynamicCordisRunner')
  assert.ok(dynamicRunner, 'installed profile missing formal DynamicCordisRunnerService')
  const dynamicBeforeCounters = structuredClone(counters)
  const dynamicBeforeLedger = await ledger()
  async function runHostProof(name, code) {
    const defined = dynamicRunner.define({ sessionId: agent.id, plugin: { kind: 'new', idPrefix: 'pfile' },
      name, purpose: 'Public owned file-management regression', code: { host: code } })
    let activated = false
    try {
      const started = await ctx.agents.withInitiator(agent, () => dynamicRunner.run(agent, defined.pluginId, defined.packageId, 'run'))
      assert.equal(started.ok, true, `formal Dynamic Host activation failed: ${JSON.stringify(started)}`)
      activated = true
      assert.deepEqual(started.waitingFor, [], 'formal Dynamic Host dependency missing')
      const response = await dynamicRunner.invoke(defined.pluginId, started.pluginRunId, 'proof', {})
      assert.equal(response.ok, true, `formal Dynamic Host invoke failed: ${JSON.stringify(response)}`)
      return response.value
    } finally {
      const stopped = await dynamicRunner.stop(agent, defined.pluginId)
      assert.ok(stopped.ok || (!activated && stopped.reason === 'not-running'), `formal Dynamic Host stop failed: ${JSON.stringify(stopped)}`)
      const removed = await dynamicRunner.undefine(agent, defined.pluginId)
      assert.equal(removed.ok, true, 'formal Dynamic Host undefine failed')
    }
  }
  const dynamicPositive = await runHostProof('Public host positive', `return {
    name: 'public-host-positive', inject: ['attachments'], apply(ctx) {
      const path = ctx.attachments.fileHostPath(${JSON.stringify(upload.file)});
      harness.handle('proof', async () => ({ marker: 'HOST_SERVICE_APPLIED', path }));
    }
  };`)
  assert.deepEqual(dynamicPositive, { marker: 'HOST_SERVICE_APPLIED', path: uploadPath })
  const dynamicNegative = await runHostProof('Public host refusals', `return {
    name: 'public-host-refusals', inject: ['attachments','agents'], async apply(ctx) {
      const file = ${JSON.stringify(upload.file)}, ticket = ${JSON.stringify(stageTicket)};
      const owner = ${JSON.stringify({ kind: 'session', id: created.sessionId })};
      const results = [];
      const actions = [
        ['stageFile', () => ctx.attachments.stageFile({data:new Uint8Array([1]),name:'public.txt'})],
        ['stageFileStream', () => ctx.attachments.stageFileStream({data:(async function*(){yield new Uint8Array([1]);})(),name:'public-stream.txt'})],
        ['commitFileReferences', () => ctx.attachments.commitFileReferences(owner,[file])],
        ['releaseFileReferences', () => ctx.attachments.releaseFileReferences(owner)],
        ['releaseFileStage', () => ctx.attachments.releaseFileStage(ticket)],
        ['acquireFileReadLease', () => ctx.attachments.acquireFileReadLease([file])],
        ['readFileStream', async () => {for await (const value of ctx.attachments.readFileStream(file)) { if(value) return 'unexpected-bytes'; }}],
        ['deleteFile', () => ctx.attachments.deleteFile(file)],
        ['withoutInitiator.deleteFile', () => ctx.agents.withoutInitiator(() => ctx.attachments.deleteFile(file))],
        ['attachments.ctx', () => {const context=ctx.attachments.ctx; return context === undefined ? 'unexpected-undefined' : 'unexpected-context';}],
      ];
      for (const [name,action] of actions) {
        try {await action();results.push({name,denied:false});}
        catch(error) {results.push({name,denied:true,message:String(error)});}
      }
      harness.handle('proof', async () => results);
    }
  };`)
  assert.equal(dynamicNegative.length, 10)
  for (const result of dynamicNegative) assert.equal(result.denied, true, `formal Dynamic Host action reached public provider: ${JSON.stringify(result)}`)
  for (const result of dynamicNegative.slice(0, 8)) assert.match(result.message, /web testing policy refused/u)
  assert.match(dynamicNegative[9].message, /Context/u)
  assert.deepEqual(counters, dynamicBeforeCounters, 'formal Dynamic Host refusal changed provider counters')
  const dynamicAfterCounters = structuredClone(counters)
  assert.deepEqual(await ledger(), dynamicBeforeLedger, 'formal Dynamic Host refusal changed owner/stage metadata')
  assert.deepEqual([hash(await readFile(historicPath)), hash(await readFile(uploadPath))], beforeHashes)
  const forked = await ctx.sessionController.fork({ sessionId: created.sessionId })
  const child = ctx.agents.get(forked.sessionId)
  if (child !== undefined) await ctx.sessions.flush(child.session)
  const afterFork = await ledger()
  assert.ok(Object.values(afterFork.owners).some(row => row.owner.id === forked.sessionId && row.refs.some(ref => ref.attachmentId === upload.file.attachmentId)))
  const baseUrl = `http://127.0.0.1:${ctx.webServer.port}/`
  const authentication = await fetch(ctx.connection.authenticatedUrl(baseUrl), { redirect: 'manual' })
  const cookie = authentication.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie, 'owned local browser token exchange did not issue cookie')
  const exported = await fetch(`${baseUrl}api/session.export?sessionId=${created.sessionId}`, { headers: { cookie } })
  assert.equal(exported.status, 200)
  assert.equal(exported.headers.get('content-type'), 'application/zip')
  const archiveBytes = new Uint8Array(await exported.arrayBuffer())
  assert.ok(archiveBytes.byteLength > upload.file.bytes)
  assert.ok((counters.acquireFileReadLease ?? 0) > 0)
  assert.ok((counters.readFileStream ?? 0) > 0)
  const missingDynamicTools = ['cordis_define', 'cordis_run'].filter(name => agent.ctx.tools.get(name, agent) === undefined)
  assert.deepEqual([hash(await readFile(historicPath)), hash(await readFile(uploadPath))], beforeHashes)
  const finalLedger = await ledger()
  assert.equal(finalLedger.objects[historic.attachmentId].unknown, true)
  assert.deepEqual(finalLedger.stages, afterParent.stages)
  console.log(`P07_PROFILE_RESULT:${JSON.stringify({ modelCalls, actualPtcRuns, nestedPtcDispatches,
    provider: ctx.ptcRuntime.isolation, unavailableGuestApis: ptcOutput.unavailable,
    deniedFileActions: ptcOutput.output.filter(result => result.denied).length,
    deniedManagementMethods: management.map(([name]) => name), providerCallsBeforeManagement: beforeManagement,
    dynamicHostPositive: dynamicPositive.marker,
    dynamicHostPolicyDenied: dynamicNegative.slice(0, 8).map(result => result.name),
    dynamicHostIdentityClearDenied: dynamicNegative[8], dynamicHostContextDenied: dynamicNegative[9],
    dynamicHostProviderCallsBefore: dynamicBeforeCounters, dynamicHostProviderCallsAfter: dynamicAfterCounters,
    providerCallsAfter: counters, fsProviderCallsBefore: beforeFsCalls, fsProviderCallsAfter: fsCounters,
    historicUnknownRetained: true, uploadStageRetained: true,
    parentOwner: created.sessionId, forkOwner: forked.sessionId, archiveBytes: archiveBytes.byteLength,
    missingDynamicTools, physicalAllocationMeasured: false })}`)
} finally {
  await running?.shutdown.shutdown(0)
  releaseApplication()
  for (const [name, method] of Object.entries(raw)) LocalAttachmentStore.prototype[name] = method
  for (const [name, method] of Object.entries(rawFs)) LocalFileSystem.prototype[name] = method
  QuickJsPtcRuntime.prototype.run = rawPtcRun
  if (process.connected) process.disconnect()
}
