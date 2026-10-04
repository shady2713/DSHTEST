// @vitest-environment jsdom
/** Write-only first-run form behavior and published configuration API adapter. */
import { fireEvent, render, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { ModelConfiguration, type ModelConfigurationOperations } from '../src/client/ModelConfiguration.tsx'
import { createModelConfigurationOperations } from '../src/client/configuration-operations.ts'
import { zh } from '../src/client/locales.ts'
import type { ProviderConfiguration } from '../src/types.ts'

afterEach(cleanup)
const provider: ProviderConfiguration = { provider: 'deepseek-official', settingsNs: 'provider', settingsPath: [], credentialRef: 'DEEPSEEK_API_KEY', catalogState: 'ready', models: ['fixture-model'] }
const secret = 'synthetic-only-key'
function form(override: Partial<ModelConfigurationOperations> = {}) {
  const operations = {
    load: vi.fn(async () => [provider]), save: vi.fn(async () => true), remove: vi.fn(async () => true), ...override,
  }
  const refresh = vi.fn()
  return { operations, refresh, view: render(<ModelConfiguration operations={operations} refresh={refresh} t={key => zh[key]} />) }
}

describe('conversation model configuration', () => {
  it('keeps a usable provider selected while an unrelated directory is unavailable', async () => {
    const unavailable: ProviderConfiguration = { ...provider, provider: 'unavailable', catalogState: 'unavailable', models: [] }
    const fixture = form({ load: async () => [unavailable, provider] })
    await waitFor(() => { expect(fixture.view.getByLabelText(zh['config.provider'])).toHaveProperty('value', provider.provider) })
    expect(fixture.view.getByLabelText(zh['config.model'])).toHaveProperty('value', 'fixture-model')
    expect(fixture.view.queryByText(zh['config.catalog-unavailable'])).toBeNull()
    fireEvent.change(fixture.view.getByLabelText(zh['config.provider']), { target: { value: unavailable.provider } })
    expect(fixture.view.getByText(zh['config.catalog-unavailable'])).toBeDefined()
    expect(fixture.view.getByText(zh['config.save']).hasAttribute('disabled')).toBe(true)
    fireEvent.change(fixture.view.getByLabelText(zh['config.model']), { target: { value: 'explicit-model' } })
    fireEvent.click(fixture.view.getByText(zh['config.save']))
    await waitFor(() => { expect(fixture.operations.save).toHaveBeenCalledWith(unavailable, 'explicit-model', 'analysis', '') })
  })
  it('handles provider changes, failed outcomes, invalid submits, and refused removal safely', async () => {
    const second = { ...provider,provider:'second',models:[] }
    const fixture = form({ load:async () => [provider,second],save:async () => false,remove:async () => false })
    await waitFor(() => { expect(fixture.view.getByRole('status').textContent).toBe(zh['config.hint']) })
    fireEvent.change(fixture.view.getByLabelText(zh['config.provider']),{ target:{ value:'second' } })
    fireEvent.submit(fixture.view.container.querySelector('form')!)
    fireEvent.change(fixture.view.getByLabelText(zh['config.provider']),{ target:{ value:'deepseek-official' } })
    fireEvent.change(fixture.view.getByLabelText(zh['config.task']),{ target:{ value:'vision' } })
    fireEvent.click(fixture.view.getByText(zh['config.save']))
    await waitFor(() => { expect(fixture.view.getByRole('status').textContent).toBe(zh['config.failed']) })
    fireEvent.click(fixture.view.getByText(zh['config.remove']))
    await waitFor(() => { expect(fixture.refresh).toHaveBeenCalledTimes(2) })
    fireEvent.change(fixture.view.getByLabelText(zh['config.provider']),{ target:{ value:'' } })
    fireEvent.change(fixture.view.getByLabelText(zh['config.task']),{ target:{ value:'' } })
    fireEvent.submit(fixture.view.container.querySelector('form')!)
  })
  it('contains load and removal exceptions, including load failure after unmount', async () => {
    const refused = form({ load:async () => {throw new Error(secret)} })
    await waitFor(() => { expect(refused.view.getByRole('status').textContent).toBe(zh['config.failed']) })
    refused.view.unmount()
    const fixture = form({ remove:async () => {throw new Error(secret)} })
    await waitFor(() => { expect(fixture.view.getByRole('status').textContent).toBe(zh['config.hint']) })
    fireEvent.click(fixture.view.getByText(zh['config.remove']))
    await waitFor(() => { expect(fixture.view.getByRole('status').textContent).toBe(zh['config.failed']) })
    fixture.view.unmount()
    let reject: (error: Error) => void = () => {}
    const pending = form({ load:() => new Promise((_resolve, fail) => { reject = fail }) })
    pending.view.unmount()
    reject(new Error(secret))
  })
  it('clears the write-only secret before awaiting a real connection and keeps it out of feedback', async () => {
    let finish: (value: boolean) => void = () => {}
    const save = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    const fixture = form({ save })
    await waitFor(() => { expect(fixture.view.getByLabelText(zh['config.model']).getAttribute('value')).toBe('fixture-model') })
    const input = fixture.view.getByLabelText(zh['config.key']) as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: ` ${secret} ` } })
    fireEvent.click(fixture.view.getByText(zh['config.save']))
    fireEvent.submit(fixture.view.container.querySelector('form')!)
    expect(save).toHaveBeenCalledWith(provider, 'fixture-model', 'analysis', secret)
    expect(input.value).toBe('')
    expect(fixture.view.container.textContent).not.toContain(secret)
    finish(true)
    await waitFor(() => { expect(fixture.view.getByRole('status').textContent).toBe(zh['config.saved']) })
    expect(fixture.refresh).toHaveBeenCalledOnce()
  })
  it('renders only locale-owned failure text when errors echo the key', async () => {
    const fixture = form({ save: async () => { throw new Error(secret) } })
    await waitFor(() => { expect(fixture.view.getByRole('status').textContent).toBe(zh['config.hint']) })
    fireEvent.change(fixture.view.getByLabelText(zh['config.key']), { target: { value: secret } })
    fireEvent.click(fixture.view.getByText(zh['config.save']))
    await waitFor(() => { expect(fixture.view.getByRole('status').textContent).toBe(zh['config.failed']) })
    expect(fixture.view.container.innerHTML).not.toContain(secret)
  })
  it('allows blank-key configuration, explicit task choice, and credential removal', async () => {
    const fixture = form()
    await waitFor(() => { expect(fixture.view.getByRole('status').textContent).toBe(zh['config.hint']) })
    fireEvent.change(fixture.view.getByLabelText(zh['config.task']), { target: { value: 'auxiliary' } })
    fireEvent.change(fixture.view.getByLabelText(zh['config.model']), { target: { value: 'another-model' } })
    fireEvent.click(fixture.view.getByText(zh['config.save']))
    await waitFor(() => { expect(fixture.operations.save).toHaveBeenCalledWith(provider, 'another-model', 'auxiliary', '') })
    await waitFor(() => { expect(fixture.view.getByText(zh['config.remove']).hasAttribute('disabled')).toBe(false) })
    fireEvent.click(fixture.view.getByText(zh['config.remove']))
    await waitFor(() => { expect(fixture.view.getByRole('status').textContent).toBe(zh['config.removed']) })
    expect(fixture.operations.remove).toHaveBeenCalledWith('DEEPSEEK_API_KEY')
  })
  it('keeps missing providers unavailable and ignores a load after unmount', async () => {
    const fixture = form({ load: async () => [] })
    await waitFor(() => { expect(fixture.view.getByRole('status').textContent).toBe(zh['config.no-provider']) })
    expect(fixture.view.getByText(zh['config.save']).hasAttribute('disabled')).toBe(true)
    let resolve: (value: ProviderConfiguration[]) => void = () => {}
    const pending = form({ load: () => new Promise((done) => { resolve = done }) })
    pending.view.unmount()
    resolve([provider])
  })
})

describe('official configuration Remotes adapter', () => {
  it('stops on each refused persistence stage and supports nested provider profiles', async () => {
    const ctx = new Context()
    class Remote extends Service { constructor(){super(ctx,'remote')} }
    new Remote()
    let loadOk = false, describeOk = false, writeOk = false, keyOk = false, probeOk = false
    let namespaces: unknown[] = []
    ctx.provide('remote.webTestPresentation',{ configuration:async () => ({ ok:loadOk,value:{ providers:[] } }),configureRoute:async () => ({ ok:probeOk,value:{ ready:false } }) })
    ctx.provide('remote.settings',{ describe:async () => ({ ok:describeOk,value:{ namespaces } }),mutate:async () => ({ ok:writeOk }) })
    ctx.provide('remote.credentials',{ set:async () => ({ ok:keyOk }),unset:async () => ({ ok:false }) })
    try {
      const operations = createModelConfigurationOperations(ctx)
      await expect(operations.load()).rejects.toThrow('unavailable')
      expect(await operations.save(provider,'m','analysis',secret)).toBe(false)
      describeOk=true
      expect(await operations.save(provider,'m','analysis',secret)).toBe(false)
      namespaces=[{ ns:'provider',revision:1,value:null }]
      expect(await operations.save(provider,'m','analysis',secret)).toBe(false)
      writeOk=true
      expect(await operations.save({ ...provider,credentialRef:null },'m','analysis',secret)).toBe(false)
      expect(await operations.save(provider,'m','analysis',secret)).toBe(false)
      keyOk=true
      expect(await operations.save(provider,'m','analysis',secret)).toBe(false)
      probeOk=true
      namespaces=[{ ns:'provider',revision:2,value:{ nested:{ models:[] } } }]
      expect(await operations.save({ ...provider,settingsPath:['nested'] },'m','analysis','')).toBe(false)
      expect(await operations.remove('TEST_KEY')).toBe(false)
      loadOk=true
      expect(await operations.load()).toEqual([])
    } finally {await ctx.fiber.dispose()}
  })
  it('uses settings mutate and credentials set, probes only after successful writes, and deletes through credentials', async () => {
    const ctx = new Context()
    class Remote extends Service { constructor() { super(ctx, 'remote') } }
    new Remote()
    const set = vi.fn(async () => ({ ok:true }))
    const unset = vi.fn(async () => ({ ok:true }))
    const mutate = vi.fn(async () => ({ ok:true }))
    const configureRoute = vi.fn(async () => ({ ok:true, value:{ ready:true, detail:null } }))
    ctx.provide('remote.credentials', { set, unset })
    ctx.provide('remote.settings', { describe: async () => ({ ok:true, value:{ namespaces:[{ ns:'provider', revision:4, value:{ models:[{ id:'fixture-model', inputModalities:['text'] }] } }] } }), mutate })
    ctx.provide('remote.webTestPresentation', { configuration: async () => ({ ok:true, value:{ providers:[provider] } }), configureRoute })
    try {
      const operations = createModelConfigurationOperations(ctx)
      expect(await operations.load()).toEqual([provider])
      expect(await operations.save(provider, 'fixture-model', 'analysis', secret)).toBe(true)
      expect(set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', secret)
      expect(JSON.stringify(mutate.mock.calls)).not.toContain(secret)
      expect(configureRoute).toHaveBeenCalledWith('deepseek-official', 'fixture-model', 'analysis')
      await operations.save(provider, 'vision-model', 'vision', '')
      expect(set).toHaveBeenCalledOnce()
      expect(await operations.remove('DEEPSEEK_API_KEY')).toBe(true)
      expect(unset).toHaveBeenCalledWith('DEEPSEEK_API_KEY')
    } finally { await ctx.fiber.dispose() }
  })
})
