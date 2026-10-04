// @vitest-environment jsdom
/**
 * The browser plugin on a real cordis Context with a fake Remote, plus the
 * route-state source the dock entry binds.
 *
 * The generated Remote contribution is not imported here: this suite exercises
 * the source and the registration directly, so it states no cast over the slot
 * registry's erased inject option.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { RemoteError, SlotTestRuntime, sessionSnapshot, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { InputState, InputZone } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { createRouteStatusSource, inject, mountWebTestPresentation } from '../src/client/mount.ts'
import * as ClientEntry from '../src/client/index.ts'
import type { RouteStateReadResult, RouteStatusInjected } from '../src/client/slots.ts'
import type { RouteStateResponse, TaskRouteState } from '../src/types.ts'

usePinnedBrowserLanguages('zh-CN')

const ORDINARY_COMMANDS = {
  queryStatus: async () => ({ ok: false, error: new RemoteError('web-test-conversation/no-project', 'no project', {}) }),
  listProjects: async () => ({ ok: true, value: [] }),
}

it('loads the Client entry before its own Remote namespace exists', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const unmount = vi.fn(async () => {})
  const mounted = vi.fn()
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution) {
      mounted(contribution.package)
      const namespace = contribution.package === '@deepseek-ai/dsh-web-test-conversation' ? undefined : await this.ctx.plugin({
        name: 'fixture-web-test-namespace',
        apply(inner: Context) {
          inner.provide('remote.webTestPresentation', {
            routeState: async () => ({ ok: true, value: { entries: [] } }),
            configuration: async () => ({ ok: true, value: { providers: [] } }),
          })
          inner.provide('remote.webTestCommands', ORDINARY_COMMANDS)
        },
      })
      return async () => { await namespace?.dispose(); await unmount() }
    }
  }
  new Remote()
  ctx.provide('remote.settings', {})
  ctx.provide('remote.credentials', {})
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({
    name: 'root', children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  expect(ctx.get('remote.webTestPresentation')).toBeUndefined()
  const plugin = await ctx.plugin(ClientEntry)
  expect(mounted).toHaveBeenCalledWith('@deepseek-ai/dsh-web-test-presentation')
  expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(1)
  await plugin.dispose()
  expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(0)
  expect(unmount).toHaveBeenCalledTimes(2)
})

const CONTRIBUTION: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-web-test-presentation',
  descriptors: [],
}

const READY: TaskRouteState = {
  taskType: 'analysis',
  state: 'ready',
  detail: null,
  provider: 'deepseek',
  model: 'deepseek-chat',
}

const RESPONSE: RouteStateResponse = { entries: [READY] }

/** A read that answered. */
const ok = (response: RouteStateResponse): RouteStateReadResult => ({ ok: true, response })

/** A read the Host refused, carrying the message it chose. */
const refused = (detail: string): RouteStateReadResult => ({ ok: false, detail })

/** The quiescent composer state the dock's owner share carries. */
const INPUT_STATE: InputState = {
  draft: '', attachmentIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [],
}

/** A real Client Context with the slot, the locale runtime, and a fake Remote. */
async function bench(answer: RouteStateResponse, failure?: RemoteError) {
  const ctx = new Context()
  const unmount = vi.fn(async () => {})
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }

    async $mount(received: TypertRemoteContribution) {
      expect(received).toBe(CONTRIBUTION)
      return unmount
    }
  }
  new Remote()
  const routeState = vi.fn(async () => failure === undefined
    ? { ok: true as const, value: answer }
    : { ok: false as const, error: failure })
  ctx.provide('remote.webTestPresentation', { routeState, configuration: async () => ({ ok:true, value:{ providers:[] } }) })
  ctx.provide('remote.webTestCommands', ORDINARY_COMMANDS)
  ctx.provide('remote.settings', {})
  ctx.provide('remote.credentials', {})
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const dispose = await mountWebTestPresentation(ctx, CONTRIBUTION)
  // The returned disposer is what a test drives; teardown only drops the
  // context, so a case that already disposed the strip is not disposed twice.
  onTestFinished(async () => {
    await ctx.fiber.dispose()
  })
  // `StoredEntry.inject` is erased to `Record<string, unknown>`; the registration
  // call in mount.ts is what types the shares it returns. The dock is
  // session-scoped, so the runtime passes a session id this face deliberately
  // ignores: route state is one Host-wide answer, not per-session state.
  const face = (): RouteStatusInjected | undefined =>
    ctx.slots.entries('conversation.input.dock')[0]?.inject?.() as RouteStatusInjected | undefined
  return {
    ctx,
    dispose,
    routeState,
    unmount,
    face,
    // `StoredEntry` keeps `id`/`order` under `options` and `locale` beside it;
    // this is the same flattened view the renderer reads.
    entry: () => {
      const entry = ctx.slots.entries('conversation.input.dock')[0]
      return entry === undefined ? undefined : { ...entry.options, locale: entry.locale }
    },
  }
}

describe('createRouteStatusSource', () => {
  it('reads once the strip observes it and publishes the answer', async () => {
    const read = vi.fn(async () => ok(RESPONSE))
    const source = createRouteStatusSource(read)
    expect(source.getSnapshot()).toEqual({ phase: 'loading' })

    const seen: unknown[] = []
    const release = source.subscribe(() => { seen.push(source.getSnapshot()) })
    await vi.waitFor(() => { expect(source.getSnapshot().phase).toBe('loaded') })
    expect(read).toHaveBeenCalledTimes(1)
    expect(seen.length).toBeGreaterThan(0)
    release()
  })

  it('reads once for the first observer, not once per observer', async () => {
    const read = vi.fn(async () => ok(RESPONSE))
    const source = createRouteStatusSource(read)
    const first = source.subscribe(() => {})
    const second = source.subscribe(() => {})
    await vi.waitFor(() => { expect(source.getSnapshot().phase).toBe('loaded') })
    expect(read).toHaveBeenCalledTimes(1)
    first()
    second()
  })

  it('re-reads on request and shows the check while it runs', async () => {
    let release!: (result: RouteStateReadResult) => void
    const read = vi.fn(() => new Promise<RouteStateReadResult>((resolve) => { release = resolve }))
    const source = createRouteStatusSource(read)
    const stop = source.subscribe(() => {})
    release(ok(RESPONSE))
    await vi.waitFor(() => { expect(source.getSnapshot().phase).toBe('loaded') })

    source.reload()
    expect(source.getSnapshot()).toEqual({ phase: 'loading' })
    release(ok(RESPONSE))
    await vi.waitFor(() => { expect(source.getSnapshot().phase).toBe('loaded') })
    expect(read).toHaveBeenCalledTimes(2)
    stop()
  })

  it('publishes the message a refused read carries instead of a ready state', async () => {
    const source = createRouteStatusSource(async () => refused('route state unavailable'))
    const stop = source.subscribe(() => {})
    await vi.waitFor(() => { expect(source.getSnapshot().phase).toBe('unavailable') })
    expect(source.getSnapshot()).toEqual({ phase: 'unavailable', detail: 'route state unavailable' })
    stop()
  })

  it('replaces a loaded snapshot when a later read is refused', async () => {
    const read = vi.fn<() => Promise<RouteStateReadResult>>()
      .mockResolvedValueOnce(ok(RESPONSE))
      .mockResolvedValueOnce(refused('the socket closed'))
    const source = createRouteStatusSource(read)
    const stop = source.subscribe(() => {})
    await vi.waitFor(() => { expect(source.getSnapshot().phase).toBe('loaded') })

    source.reload()
    await vi.waitFor(() => { expect(source.getSnapshot().phase).toBe('unavailable') })
    expect(source.getSnapshot()).toEqual({ phase: 'unavailable', detail: 'the socket closed' })
    stop()
  })

  it('drops a read that answers after a newer one started', async () => {
    const slow = Promise.withResolvers<RouteStateReadResult>()
    const read = vi.fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(ok(RESPONSE))
    const source = createRouteStatusSource(read)
    const stop = source.subscribe(() => {})
    source.reload()
    await vi.waitFor(() => { expect(read).toHaveBeenCalledTimes(2) })

    slow.resolve(ok({ entries: [] }))
    await Promise.resolve()
    await Promise.resolve()
    expect(source.getSnapshot().phase).toBe('loaded')
    expect(source.getSnapshot()).toEqual({ phase: 'loaded', entries: [READY] })
    stop()
  })

  it('stops publishing once the last observer leaves', async () => {
    const read = vi.fn(async () => ok(RESPONSE))
    const source = createRouteStatusSource(read)
    const stop = source.subscribe(() => {})
    await vi.waitFor(() => { expect(source.getSnapshot().phase).toBe('loaded') })
    stop()

    source.reload()
    // The read still runs; its answer must not reach a source nobody observes.
    await vi.waitFor(() => { expect(read).toHaveBeenCalledTimes(2) })
    expect(source.getSnapshot().phase).toBe('loaded')
  })
})

describe('web-test-presentation browser plugin', () => {
  it('contributes exactly one dock entry while mounted', async () => {
    const b = await bench(RESPONSE)
    expect(b.ctx.slots.entries('conversation.input.dock')).toHaveLength(1)
    expect(b.entry()).toMatchObject({
      id: 'web-test-presentation',
      order: 20,
      locale: 'web-test-presentation',
    })
  })

  it('reads no route state until the dock entry observes it', async () => {
    const b = await bench(RESPONSE)
    expect(b.routeState).not.toHaveBeenCalled()
  })

  it('resolves the registered entry\'s read through the mounted Remote', async () => {
    const b = await bench(RESPONSE)
    const source = b.face()?.hooks.routeStatus
    const stop = source?.subscribe(() => {})
    await vi.waitFor(() => { expect(source?.getSnapshot().phase).toBe('loaded') })
    expect(b.routeState).toHaveBeenCalledTimes(1)
    expect(source?.getSnapshot()).toEqual({ phase: 'loaded', entries: [READY] })
    stop?.()
  })

  it('re-checks through the mounted Remote when the entry is refreshed', async () => {
    const b = await bench(RESPONSE)
    b.face()?.refresh()
    await vi.waitFor(() => {
      expect(b.face()?.hooks.routeStatus.getSnapshot())
        .toEqual({ phase: 'loaded', entries: [READY] })
    })
    expect(b.routeState).toHaveBeenCalledTimes(1)
  })

  it('withdraws the Remote when the strip is unmounted', async () => {
    const b = await bench(RESPONSE)
    expect(b.entry()).toBeDefined()
    await b.dispose()
    expect(b.entry()).toBeUndefined()
    expect(b.unmount).toHaveBeenCalledTimes(1)
  })

  it('reports a refused Remote call as the Host message, not as an empty route list', async () => {
    const b = await bench(RESPONSE, new RemoteError('gateway/internal', 'route state unavailable', {}))
    const source = b.face()?.hooks.routeStatus
    const stop = source?.subscribe(() => {})
    await vi.waitFor(() => { expect(source?.getSnapshot().phase).toBe('unavailable') })
    expect(source?.getSnapshot()).toEqual({ phase: 'unavailable', detail: '' })
    stop?.()
  })

  it('leaves nothing behind when a second mount of the same browser half fails', async () => {
    const b = await bench(RESPONSE)
    // This namespace's dictionaries are already registered, so the second mount
    // fails loud rather than leaving two dock entries and one dangling Remote.
    await expect(mountWebTestPresentation(b.ctx, CONTRIBUTION))
      .rejects.toThrow(/already has locale "zh"/)
    expect(b.ctx.slots.entries('conversation.input.dock')).toHaveLength(1)
    expect(b.unmount).toHaveBeenCalledTimes(1)
  })
})

/**
 * The same plugin on the production slot ring: the registered entry rendered
 * through the real renderer, so the dock adapter's five prop shares come from
 * the framework rather than from a hand-built props object.
 */
async function renderBench(answer: RouteStateResponse) {
  const runtime = await SlotTestRuntime.create()
  const ctx = runtime.ctx
  const unmount = vi.fn(async () => {})
  // The double rejects `$mount` because it has no wire. This spec needs only the
  // mount handshake; the wire itself is the scripted namespace provided below.
  runtime.remote.$mount = async (...received: never[]) => {
    expect(received[0]).toBe(CONTRIBUTION)
    return unmount
  }
  const routeState = vi.fn(async () => ({ ok: true as const, value: answer }))
  // The double carries namespaces as plain members, which is how the plugin
  // reaches them; it is mounted with `ctx.plugin` rather than the runtime's
  // `mount`, whose precheck reads the namespace from cordis' own registry.
  runtime.remote.provideNamespaces({
    webTestPresentation: { routeState, configuration: async () => ({ ok:true, value:{ providers:[] } }) },
    settings: {}, credentials: {}, webTestCommands: ORDINARY_COMMANDS,
  })
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.declare({
    'conversation.input.dock': { kind: 'list', scope: 'session' },
  })
  await ctx.plugin({
    inject: [...inject],
    apply: serviceCtx => mountWebTestPresentation(serviceCtx, CONTRIBUTION),
  }).await()
  const id = await runtime.sessions.add({ id: 's1' })
  // Held for the whole test, not just this function: `using` would release the
  // reference before the first render and the session-scoped dock would crash.
  const reference = runtime.sessions.retain(id)
  onTestFinished(async () => {
    reference.release()
    await runtime.dispose()
  })
  // The dock's owner share is the composer's point-in-time zone. This strip reads
  // neither field, so the fixtures are the quiescent minimum.
  const owner: InputZone = { session: sessionSnapshot(id), input: INPUT_STATE }
  return { runtime, routeState, view: runtime.renderSlot('conversation.input.dock', owner, { session: reference }) }
}

describe('the registered dock entry through the real renderer', () => {
  it('shows every task type with its route state and re-checks on request', async () => {
    const b = await renderBench({ entries: [
      READY,
      { taskType: 'vision', state: 'refused-modality', detail: 'no image input declared', provider: null, model: null },
    ] })
    await vi.waitFor(() => { expect(b.view.view.getByText('deepseek/deepseek-chat')).toBeTruthy() })
    expect(b.view.view.getAllByText('分析')[0]).toBeTruthy()
    expect(b.view.view.getByText('就绪')).toBeTruthy()
    expect(b.view.view.getByText('缺少所需模态')).toBeTruthy()
    expect(b.view.view.getByRole('alert').textContent).toBe('no image input declared')

    b.view.view.getByRole('button', { name: '重新检查' }).click()
    await vi.waitFor(() => { expect(b.routeState).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => { expect(b.view.view.getByText('deepseek/deepseek-chat')).toBeTruthy() })
  })
})
