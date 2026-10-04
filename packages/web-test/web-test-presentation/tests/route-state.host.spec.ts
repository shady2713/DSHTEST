/** Read-only Host readiness and explicit configuration over the model authority. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { isRouteFingerprint, ROUTE_SELECTION_VERSION } from '@deepseek-ai/dsh-web-test-models'
// Type-only: the authority's domain types. Erased, so this suite never loads the
// authority's implementation.
import type {
  NotReadyReason,
  TaskRoute,
} from '@deepseek-ai/dsh-web-test-models'
import { WebTestPresentation } from '../src/index.ts'
import { routeStates, type RouteAuthority } from '../src/route-state.ts'
import { ROUTE_TASK_TYPES, type RouteState, type RouteTaskType, type TaskRouteState } from '../src/types.ts'

/** A key-shaped value a provider quotes back inside its own refusal. */
const SECRET = 'sk-web-test-must-never-cross-the-remote'

/** The branded digest a stored selection carries, read off the selection this file builds. */
type FixtureDigest = Extract<TaskRoute, { readonly kind: 'ready' }>['selection']['fingerprint']

/**
 * Brand a fixture digest through the authority's own guard, so the fixture fails
 * as a wrong-shaped digest rather than through a cast.
 */
function digest(hex: string): FixtureDigest {
  if (!isRouteFingerprint(hex)) throw new Error(`fixture digest "${hex}" is not a route fingerprint`)
  return hex
}

const READY: TaskRoute = {
  kind: 'ready',
  selection: {
    version: ROUTE_SELECTION_VERSION,
    taskType: 'analysis',
    route: { provider: 'deepseek', model: 'deepseek-chat', credentialRef: null },
    fingerprint: digest('a'.repeat(64)),
    capabilities: { inputModalities: ['text', 'image'], toolUpdate: 'addition-only', reportedCacheTokens: true },
    verifiedAt: 1,
  },
}

const BLOCKED: TaskRoute = {
  kind: 'not-ready', reason: 'connection-failed', detail: SECRET,
  rejected: [{ route: { provider: 'p', model: 'm', credentialRef: null }, reason: 'connection-failed', detail: SECRET }],
}

/** Not-ready reasons that already name the action, with the state each maps to. */
const SELF_EXPLAINING = [
  ['no-provider-configured', 'not-configured'],
  ['capability-absent', 'capability-absent'],
  ['reverification-required', 'reverify'],
] as const satisfies readonly (readonly [NotReadyReason, RouteState])[]

function notReady(reason: NotReadyReason): TaskRoute {
  return { kind: 'not-ready', reason, detail: `${reason} detail`, rejected: [] }
}

/** The options one `selectRoute` call was given. */
interface AskedOptions {
  /** The task type the decision was requested for. */
  readonly taskType: RouteTaskType
  /** Whether the caller asked the authority to re-verify. */
  readonly reverify: boolean
}

/** An authority that records the options it was asked with, so they can be asserted. */
type ScriptedAuthority = RouteAuthority & {
  /** The options every `selectRoute` call was given, in call order. */
  readonly asked: readonly AskedOptions[]
}

/**
 * An authority that answers every task type with the same scripted decision.
 *
 * `options` is declared so the `{ reverify: false }` the surface sends is part
 * of the fake's own type and can be asserted rather than merely inferred.
 * @param decision - the decision every task type is answered with.
 * @returns the scripted authority.
 */
function authorityOf(decision: TaskRoute): ScriptedAuthority {
  const asked: AskedOptions[] = []
  return {
    asked,
    selectRoute: async (taskType, options) => {
      asked.push({ taskType, reverify: options.reverify })
      return decision.kind === 'ready' ? { ...decision, selection: { ...decision.selection, taskType } } : decision
    },
  }
}

function stateOf(entries: readonly TaskRouteState[], taskType: RouteTaskType): TaskRouteState {
  const found = entries.find(entry => entry.taskType === taskType)
  if (found === undefined) throw new Error(`no row for ${taskType}`)
  return found
}

describe('routeStates', () => {
  it('reports every task type in strip order', async () => {
    const entries = await routeStates(authorityOf(READY))
    expect(entries.map(entry => entry.taskType)).toEqual([...ROUTE_TASK_TYPES])
  })

  it('names the provider and model a ready route runs on, with nothing to act on', async () => {
    const [first] = await routeStates(authorityOf(READY))
    expect(first).toEqual({
      taskType: 'analysis',
      state: 'ready',
      detail: null,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
  })

  it.each(SELF_EXPLAINING)('keeps a task type not ready and names the action for %s', async (reason, state) => {
    const [first] = await routeStates(authorityOf(notReady(reason)))
    expect(first).toEqual({
      taskType: 'analysis',
      state,
      detail: `${reason} detail`,
      provider: null,
      model: null,
    })
  })

  it('leaves a failed decision unverified without calling connection tests or copying provider text', async () => {
    const testConnection = vi.fn()
    const authority = { ...authorityOf(BLOCKED), testConnection }
    const entries = await routeStates(authority)
    expect(stateOf(entries, 'analysis')).toEqual({
      taskType: 'analysis', state: 'transient', detail: 'connection verification requires an explicit test',
      provider: null, model: null,
    })
    expect(testConnection).not.toHaveBeenCalled()
    expect(JSON.stringify(entries)).not.toContain(SECRET)
  })

  it('asks for a route without paying for a re-verification', async () => {
    const authority = authorityOf(READY)
    await routeStates(authority)
    expect(authority.asked).toEqual(
      ROUTE_TASK_TYPES.map(taskType => ({ taskType, reverify: false })),
    )
  })

})

describe('WebTestPresentation', () => {
  it('reports a failed directory without withholding other provider models or exposing its exception', async () => {
    const ctx = new Context()
    const authority = {
      listProviders: () => ['broken', 'account'].map(provider => ({ provider, settingsNs: provider, settingsPath: [] })),
      listModels: async (provider: string) => {
        if (provider === 'broken') throw new Error(SECRET)
        return [{ id: 'account-model' }]
      },
    }
    ctx.reflect.provide('webTestModels', authority)
    const service = new WebTestPresentation(ctx)
    try {
      const response = await service.configuration()
      expect(response.providers).toEqual([
        { provider: 'broken', settingsNs: 'broken', settingsPath: [], credentialRef: null, catalogState: 'unavailable', models: [] },
        { provider: 'account', settingsNs: 'account', settingsPath: [], credentialRef: null, catalogState: 'ready', models: ['account-model'] },
      ])
      expect(JSON.stringify(response)).not.toContain(SECRET)
    } finally { await ctx.fiber.dispose() }
  })
  it('lists safe provider configuration and validates exact-route requests', async () => {
    const ctx = new Context()
    let ready = true
    const authority = {
      listProviders: () => [{ provider:'p', settingsNs:'provider', settingsPath:['profiles','p'] }],
      references: { forProvider: () => 'TEST_KEY' } as { forProvider:()=>string } | undefined,
      listModels: async () => [{ id:'m' }],
      configureRoute: async () => ready ? { kind:'ready' } : { kind:'not-ready',detail:'safe refusal' },
    }
    ctx.reflect.provide('webTestModels',authority)
    const service = new WebTestPresentation(ctx)
    try {
      expect(await service.configuration()).toEqual({ providers:[{ provider:'p',settingsNs:'provider',settingsPath:['profiles','p'],credentialRef:'TEST_KEY',catalogState:'ready',models:['m'] }] })
      expect(await service.configureRoute('p','m','analysis')).toEqual({ ready:true,detail:null })
      ready = false
      expect(await service.configureRoute('p','m','vision')).toEqual({ ready:false,detail:'safe refusal' })
      await expect(service.configureRoute('','m','analysis')).rejects.toThrow('invalid model route')
      await expect(service.configureRoute('p','','analysis')).rejects.toThrow('invalid model route')
      await expect(service.configureRoute('p','m','unknown')).rejects.toThrow('invalid task requirement')
      authority.references = undefined
      expect((await service.configuration()).providers[0]?.credentialRef).toBeNull()
    } finally { await ctx.fiber.dispose() }
  })
  it('answers the route state over the injected authority and releases on disposal', async () => {
    const ctx = new Context()
    // `reflect.provide` is the seam for standing in for a service this package
    // does not own; `ctx.provide` would demand the authority's whole class.
    ctx.reflect.provide('webTestModels', authorityOf(READY))
    const service = new WebTestPresentation(ctx)
    try {
      const answer = await service.routeState()
      expect(answer.entries.map(entry => entry.state)).toEqual(['ready', 'ready', 'ready'])
      expect(answer.entries[0]?.model).toBe('deepseek-chat')
    } finally {
      await ctx.fiber.dispose()
    }
    expect(ctx.get('webTestPresentation')).toBeUndefined()
  })
})
