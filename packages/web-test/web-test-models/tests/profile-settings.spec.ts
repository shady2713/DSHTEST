/** Loader-composed official profile persistence, real Messages probes, and pinned policy admission. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { boot, initProfile, loadOverlayPatches, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import Settings from '@deepseek-ai/dsh-settings'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as ApiKey from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { brandString } from '@deepseek-ai/dsh-brand'
import WebTestModels, { ROUTE_POLICY_VERSION } from '../src/index.ts'
import { Context, FiberState, type Fiber } from '@deepseek-ai/cordis'
import type { InputGenerationVersion, PolicyRevisionId, PolicyWorkId, RoutePolicyId, RoutePolicyRevision } from '../src/index.ts'
import { messagesEndpoint, start as startMemory }  from './harness.ts'

async function profileFixture(modelsLayer: 'bundle' | 'overlay' | 'application' = 'bundle', cliOverride = false) {
  const endpoint = await messagesEndpoint()
  onTestFinished(() => endpoint.close())
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'web-test-model-profile-')))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'llm', name: 'cordis:llm' },
    { id: 'credentials', name: 'cordis:credentials', config: { path: join(home, '.credentials.yaml'), dshHome: home, watch: false } },
    { id: 'provider', name: 'cordis:provider', config: { baseURL: endpoint.baseURL, models: [{ id: 'fixture-model', inputModalities: ['text'] }] } },
    ...modelsLayer === 'bundle' ? [{ id: 'web-test-models', name: 'cordis:models', config: { verificationTtlMs: 600000 } }] : [],
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const modelsPatch = loadOverlayPatches('test', fileURLToPath(new URL('../../web-test/web-test.cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert === undefined ? [] : [{ insert: patch.insert
      .filter(row => row.id === 'web-test-models').map(row => ({ ...row, name: 'cordis:models' })) }])
    .filter(patch => patch.insert.length > 0)
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home,
    applicationPatches: modelsLayer === 'application' ? modelsPatch : [],
    overlays: modelsLayer === 'overlay' ? modelsPatch : cliOverride ? [{ id: 'web-test-models', config: { verificationTtlMs: 600000, selections: {}, policies: {} } }] : [],
    telemetryDisabledEnv: undefined,
  }
  const start = async () => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
      ctx.provide('profileContext', profile)
      ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      Object.assign(ctx.loader.builtins, {
        editor: ConfigEditor, settings: Settings, llm: LlmRuntime,
        credentials: LocalCredentials, provider: ApiKey, models: WebTestModels,
      })
    })
    await ctx.loader.await()
    onTestFinished(() => ctx.fiber.dispose())
    return ctx
  }
  return { ctx: await start(), start, endpoint, profile }
}

describe('official model settings profile', () => {
  it('persists and reopens an application-composed selection beneath user patches', async () => {
    const { ctx, endpoint, start, profile } = await profileFixture('application')
    await ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'synthetic-profile-key')
    const before = endpoint.requests().length
    const selected = await ctx.webTestModels.configureRoute('deepseek-official', 'fixture-model', 'analysis')
    expect(selected.kind).toBe('ready')
    expect(endpoint.requests()).toHaveLength(before + 1)
    expect((await ctx.webTestModels.selectRoute('analysis', { reverify: false })).kind).toBe('ready')
    const stored = await ctx.webTestModels.selections?.read()
    expect(stored?.byTask.analysis?.route.model).toBe('fixture-model')
    expect(readFileSync(profile.patchPath, 'utf8')).toContain('verificationTtlMs: 300000')
    await ctx.fiber.dispose()
    const reopened = await start()
    expect((await reopened.webTestModels.selections?.read())?.byTask.analysis?.route.model).toBe('fixture-model')
    expect((await reopened.webTestModels.selectRoute('analysis', { reverify: false })).kind).toBe('not-ready')
    expect(endpoint.requests()).toHaveLength(before + 1)
  })

  it('retains command-line override protection above the application layer', async () => {
    const { ctx, endpoint, profile } = await profileFixture('application', true)
    await ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'synthetic-profile-key')
    const before = endpoint.requests().length
    const patchBefore = readFileSync(profile.patchPath, 'utf8')
    await expect(ctx.webTestModels.configureRoute('deepseek-official', 'fixture-model', 'analysis'))
      .rejects.toThrow('Configuration for "web-test-models" is overridden by a home patch or command-line overlay')
    expect(endpoint.requests()).toHaveLength(before + 1)
    expect(readFileSync(profile.patchPath, 'utf8')).toBe(patchBefore)
  })
  it('refuses persistence when the application inserts its settings owner after the user patch layer', async () => {
    const { ctx, endpoint, profile } = await profileFixture('overlay')
    await ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'synthetic-profile-key')
    const before = endpoint.requests().length
    const patchBefore = readFileSync(profile.patchPath, 'utf8')
    await expect(ctx.webTestModels.configureRoute('deepseek-official', 'fixture-model', 'analysis'))
      .rejects.toThrow('Configuration for "web-test-models" is overridden by a home patch or command-line overlay')
    expect(endpoint.requests()).toHaveLength(before + 1)
    expect(readFileSync(profile.patchPath, 'utf8')).toBe(patchBefore)
  })
  it('persists a selection through a consumer context without changing its settings owner', async () => {
    const { ctx, endpoint, profile } = await profileFixture()
    await ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'synthetic-profile-key')
    let consumer: Context | undefined
    const fiber = ctx.plugin({
      inject: ['webTestModels'],
      apply(context: Context) { consumer = context },
    })
    await fiber.await()
    if (consumer === undefined) throw new Error('fixture consumer did not mount')
    const before = endpoint.requests().length
    const patchBefore = readFileSync(profile.patchPath, 'utf8')
    const survey = await consumer.webTestModels.survey({ reverify: false })
    expect(Object.values(survey.routes).map(route => route.kind)).toEqual(['not-ready', 'not-ready', 'not-ready'])
    expect(endpoint.requests()).toHaveLength(before)
    expect(readFileSync(profile.patchPath, 'utf8')).toBe(patchBefore)
    const selected = await consumer.webTestModels.configureRoute('deepseek-official', 'fixture-model', 'analysis')
    expect(selected.kind).toBe('ready')
    expect(endpoint.requests()).toHaveLength(before + 1)
    const stored = await ctx.webTestModels.selections?.read()
    expect(stored?.byTask.analysis?.taskType).toBe('analysis')
    expect(stored?.byTask.analysis?.route.model).toBe('fixture-model')
    expect(readFileSync(profile.patchPath, 'utf8')).toContain('id: web-test-models')
    expect((await consumer.webTestModels.selectRoute('analysis', { reverify: false })).kind).toBe('ready')
    expect(endpoint.requests()).toHaveLength(before + 1)
  })
  it('rejects credential changes during a probe, re-verifies cached choices after replacement, and refuses unwritten choices', async () => {
    const endpoint = await messagesEndpoint()
    onTestFinished(() => endpoint.close())
    const harness = await startMemory({ baseURL:endpoint.baseURL,key:'synthetic' })
    onTestFinished(() => harness.dispose())
    const selected = await harness.service.selectRoute('analysis',{ reverify:true })
    if(selected.kind !== 'ready') throw new Error('fixture failed')
    await harness.credentials.set(credentialRef('DEEPSEEK_API_KEY'),'replacement')
    expect((await harness.service.selectRoute('analysis',{ reverify:false })).kind).toBe('not-ready')
    expect((await harness.service.selectRoute('analysis',{ reverify:true })).kind).toBe('ready')
    const stream = harness.llm.stream.bind(harness.llm)
    let changed = false
    vi.spyOn(harness.llm,'stream').mockImplementation(options => (async function* () {
      for await(const chunk of stream(options)) {
        if(!changed) { changed = true; await harness.credentials.set(credentialRef('DEEPSEEK_API_KEY'),'during-probe') }
        yield chunk
      }
    })())
    expect((await harness.service.testConnection(selected.selection.route,'analysis')).verdict.kind).toBe('transient')
    vi.restoreAllMocks()
    harness.service.selections={ read:async () => ({ revision:0,byTask:{} }),put:async () => false }
    expect((await harness.service.configureRoute('deepseek-official','deepseek-flash','analysis')).kind).toBe('not-ready')
  })
  it('fails when official settings are attached without a Loader configuration entry', async () => {
    const ctx = new Context()
    ctx.reflect.provide('llm',{})
    ctx.reflect.provide('credentials',{})
    ctx.reflect.provide('settings',{})
    try {
      const failed: Fiber[] = []
      ctx.on('internal/status', (fiber) => { if(fiber.state === FiberState.FAILED) failed.push(fiber) })
      await ctx.plugin(WebTestModels,{ verificationTtlMs:1 }).await()
      await vi.waitFor(() => { expect(failed.length).toBe(1) })
      await expect(failed[0]!.await()).rejects.toThrow('Loader entry id')
    } finally {await ctx.fiber.dispose()}
  })
  it('refuses policy use in a composition without official durable configuration', async () => {
    const endpoint = await messagesEndpoint()
    onTestFinished(() => endpoint.close())
    const harness = await startMemory({ baseURL:endpoint.baseURL,key:'synthetic' })
    onTestFinished(() => harness.dispose())
    await expect(harness.service.getPolicy('requirements')).rejects.toThrow('no durable policy')
    const policy: RoutePolicyRevision = {
      version: ROUTE_POLICY_VERSION, policyId: brandString<RoutePolicyId>('p'), revision: brandString<PolicyRevisionId>('r'),
      taskKind: 'requirements', requiredCapabilities: ['text-input'],
      primary: { provider: 'deepseek-official', model: 'deepseek-v4-pro', credentialRef: null, modelVersion: null }, fallback: null,
      inputGenerationVersion: brandString<InputGenerationVersion>('i'), timeouts: { requestMs: 10, taskMs: 100 },
      validators: [], escalation: [], effectiveFrom: 1,
    }
    await expect(harness.service.issuePolicy(policy)).rejects.toThrow('no durable policy')
  })

  it('fails closed on corrupt policies, capability downgrade, and unknown configured routes', async () => {
    const { ctx, endpoint } = await profileFixture()
    const ref = credentialRef('DEEPSEEK_API_KEY')
    await ctx.credentials.set(ref, 'synthetic-profile-key')
    expect(await ctx.webTestModels.listModels('deepseek-official')).toEqual([expect.objectContaining({ id:'fixture-model' })])
    const failedCatalog=vi.spyOn(ctx.llm,'listModels').mockRejectedValueOnce(new Error('synthetic-echo-key'))
    await expect(ctx.webTestModels.listModels('deepseek-official')).rejects.toThrow('provider catalogue could not be read')
    failedCatalog.mockRestore()
    expect(await ctx.webTestModels.getPolicy('requirements')).toBeUndefined()
    expect(await ctx.webTestModels.getPolicy('exact-value')).toBeUndefined()
    await expect(ctx.webTestModels.admitPolicy('requirements', brandString<PolicyWorkId>('missing'))).rejects.toThrow('no model policy')
    const selected = await ctx.webTestModels.configureRoute('deepseek-official','fixture-model','analysis')
    if(selected.kind !== 'ready') throw new Error('fixture failed')
    const revision: RoutePolicyRevision = {
      version: ROUTE_POLICY_VERSION, policyId: brandString<RoutePolicyId>('policy'), revision: brandString<PolicyRevisionId>('r1'),
      taskKind: 'requirements', requiredCapabilities: ['text-input'], primary: { ...selected.selection.route, modelVersion: null }, fallback: null,
      inputGenerationVersion: brandString<InputGenerationVersion>('inputs'), timeouts: { requestMs: 10, taskMs: 100 },
      validators: [], escalation: [], effectiveFrom: 1,
    }
    await expect(ctx.webTestModels.issuePolicy({ ...revision,requiredCapabilities:[] })).rejects.toThrow('invalid route policy')
    await expect(ctx.webTestModels.issuePolicy({ ...revision,taskKind:'exact-value',requiredCapabilities:[] })).rejects.toThrow('no model route')
    await expect(ctx.webTestModels.issuePolicy({ ...revision,requiredCapabilities:['text-input','image-input'] })).rejects.toThrow('required capability')
    endpoint.status(401)
    expect((await ctx.webTestModels.configureRoute('deepseek-official','fixture-model','analysis')).kind).toBe('not-ready')
    await expect(ctx.webTestModels.issuePolicy(revision)).rejects.toThrow('required capability')
    endpoint.status(200)
    await ctx.webTestModels.issuePolicy({ ...revision,fallback:revision.primary })
    await ctx.webTestModels.issuePolicy({ ...revision, revision: brandString<PolicyRevisionId>('r2'), effectiveFrom: 2 })
    await ctx.webTestModels.issuePolicy({
      ...revision, taskKind: 'defect-explanation', revision: brandString<PolicyRevisionId>('other-kind'), effectiveFrom: 3,
    })
    await ctx.webTestModels.issuePolicy({ ...revision, revision: brandString<PolicyRevisionId>('older'), effectiveFrom: 0 })
    expect((await ctx.webTestModels.getPolicy('requirements'))?.revision).toBe('r2')
    endpoint.status(401)
    await expect(ctx.webTestModels.admitPolicy('requirements',brandString<PolicyWorkId>('refused'))).rejects.toThrow('repair')
    await ctx.settings.mutate('web-test-models',[{ op:'set',path:['policies','broken'],value:{ version:'future' } }])
    await expect(ctx.webTestModels.getPolicy('requirements')).rejects.toThrow('unreadable')
    endpoint.status(200)
    await ctx.settings.mutate('provider',[{ op:'set',path:['models'],value:[{ id:'fixture-model',inputModalities:['image'] }] }])
    expect((await ctx.webTestModels.configureRoute('deepseek-official','fixture-model','analysis')).kind).toBe('not-ready')
  })

  it('persists the exact selected route, reloads it, pins policy work, and parks deletion without switching', async () => {
    const fixture = await profileFixture()
    const ref = credentialRef('DEEPSEEK_API_KEY')
    await fixture.ctx.credentials.set(ref, 'synthetic-profile-key')
    const route = await fixture.ctx.webTestModels.configureRoute('deepseek-official', 'fixture-model', 'analysis')
    expect(route.kind).toBe('ready')
    if (route.kind !== 'ready') throw new Error('fixture probe failed')
    expect(route.selection.route.credentialRef).toBe(ref)
    expect(readFileSync(fixture.profile.patchPath, 'utf8')).not.toContain('synthetic-profile-key')
    const policy: RoutePolicyRevision = {
      version: ROUTE_POLICY_VERSION, policyId: brandString<RoutePolicyId>('policy:test'),
      revision: brandString<PolicyRevisionId>('policy:revision:1'), taskKind: 'requirements',
      requiredCapabilities: ['text-input'], primary: { ...route.selection.route, modelVersion: null }, fallback: null,
      inputGenerationVersion: brandString<InputGenerationVersion>('inputs:1'), timeouts: { requestMs: 1000, taskMs: 10000 },
      validators: ['response-schema'], escalation: ['route-timeout'], effectiveFrom: 1,
    }
    const issued = await fixture.ctx.webTestModels.issuePolicy(policy)
    Reflect.set(issued.primary, 'model', 'caller-mutated-route')
    Reflect.set(issued.validators, 0, 'caller-mutated-validator')
    const history = await fixture.ctx.webTestModels.getPolicy('requirements')
    expect(history?.primary.model).toBe('fixture-model')
    expect(history?.validators).toEqual(['response-schema'])
    Reflect.set(history?.primary ?? {}, 'model', 'reader-mutated-route')
    expect((await fixture.ctx.webTestModels.getPolicy('requirements'))?.primary.model).toBe('fixture-model')
    await expect(fixture.ctx.webTestModels.issuePolicy(policy)).rejects.toThrow('already exists')
    await fixture.ctx.fiber.dispose()
    const reopened = await fixture.start()
    const before = fixture.endpoint.requests().length
    expect((await reopened.webTestModels.selectRoute('analysis', { reverify: false })).kind).toBe('not-ready')
    expect(fixture.endpoint.requests()).toHaveLength(before)
    fixture.endpoint.status(401)
    expect((await reopened.webTestModels.selectRoute('analysis', { reverify: true })).kind).toBe('not-ready')
    fixture.endpoint.status(200)
    expect((await reopened.webTestModels.selectRoute('analysis', { reverify: true })).kind).toBe('ready')
    expect((await reopened.webTestModels.selectRoute('analysis', { reverify: false })).kind).toBe('ready')
    expect((await reopened.webTestModels.getPolicy('requirements'))?.revision).toBe(policy.revision)
    const admitted = await reopened.webTestModels.admitPolicy('requirements', brandString<PolicyWorkId>('work:profile:1'))
    await reopened.credentials.unset(ref)
    await vi.waitFor(() => { expect(reopened.webTestModels.waitingWork()[0]?.parkReason).toBe('credential-removed') })
    expect(admitted.record.primary.model).toBe('fixture-model')
    expect((await reopened.webTestModels.resumeWork(admitted.ticket.workId)).kind).toBe('still-waiting')
    await reopened.credentials.set(ref, 'synthetic-repaired-key')
    expect((await reopened.webTestModels.resumeWork(admitted.ticket.workId)).kind).toBe('resumed')
    expect(admitted.record.revision).toBe(policy.revision)
    expect(admitted.record.primary.model).toBe('fixture-model')
    await expect(reopened.webTestModels.admitPolicy('exact-value', brandString<PolicyWorkId>('work:exact'))).rejects.toThrow('no model policy')
  })
})
