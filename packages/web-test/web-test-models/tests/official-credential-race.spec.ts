/** Official Loader, Settings, ConfigEditor and synthetic credentials across a passive route read. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, onTestFinished, vi } from 'vitest'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import Settings from '@deepseek-ai/dsh-settings'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as ApiKey from '@deepseek-ai/dsh-llm-deepseek-api-key'
import WebTestModels from '../src/index.ts'
import { messagesEndpoint } from './harness.ts'
function barrier() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  return { wait, release }
}
async function officialFixture() {
  const endpoint = await messagesEndpoint()
  onTestFinished(() => endpoint.close())
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'm1-independent-official-')))
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
    { id: 'provider', name: 'cordis:provider', config: { baseURL: endpoint.baseURL, models: [{ id: 'route-a', inputModalities: ['text'] }, { id: 'route-b', inputModalities: ['text'] }] } },
    { id: 'web-test-models', name: 'cordis:models', config: { verificationTtlMs: 600000 } },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, applicationPatches: [], overlays: [], telemetryDisabledEnv: undefined }
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
  return { ctx, endpoint, profile }
}
it('official persisted settings do not serve an old passive route after another route verifies a replaced credential', async () => {
  const { ctx, endpoint, profile } = await officialFixture()
  const ref = credentialRef('DEEPSEEK_API_KEY')
  await ctx.credentials.set(ref, 'synthetic-independent-generation-1')
  expect((await ctx.webTestModels.configureRoute('deepseek-official', 'route-a', 'analysis')).kind).toBe('ready')
  const oldRoute = (await ctx.webTestModels.selections!.read()).byTask.analysis!.route
  const ticket = ctx.webTestModels.beginWork('analysis', oldRoute)
  const entered = barrier(), released = barrier()
  onTestFinished(() => { released.release() })
  const original = ctx.llm.resolveModelInfo.bind(ctx.llm)
  let hold = true
  const spy = vi.spyOn(ctx.llm, 'resolveModelInfo').mockImplementation(async (...args) => {
    if (hold) { hold = false; entered.release(); await released.wait }
    return original(...args)
  })
  onTestFinished(() => { spy.mockRestore() })
  const passive = ctx.webTestModels.selectRoute('analysis', { reverify: false })
  try {
    await entered.wait
    await ctx.credentials.set(ref, 'synthetic-independent-generation-2')
    await vi.waitFor(() => { expect(ctx.webTestModels.waitingWork()[0]?.workId).toBe(ticket.workId) })
    expect((await ctx.webTestModels.configureRoute('deepseek-official', 'route-b', 'analysis')).kind).toBe('ready')
    const latest = (await ctx.webTestModels.selections!.read()).byTask.analysis!.route.model
    expect(latest).toBe('route-b')
    expect(readFileSync(profile.patchPath, 'utf8')).toContain('model: route-b')
    released.release()
    const old = await passive
    expect(endpoint.requests()).toHaveLength(2)
    expect(old.kind).toBe('not-ready')
  } finally { released.release(); await passive }
})
