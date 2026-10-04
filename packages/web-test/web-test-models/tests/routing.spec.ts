/**
 * Selection is capability-matched and evidence-bound: a route that has not
 * answered a real request is never ready, and a missing capability is reported
 * rather than substituted around.
 */
import { describe, expect, it, vi } from 'vitest'
import type { LlmConfigurableProvider, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm/types'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { pinnedReference } from '../src/wait.ts'
import { candidateSet, planRoute, selectionServes, workIdOf } from '../src/routing.ts'
import type { RouteCandidate, SelectionContext } from '../src/routing.ts'
import { ROUTE_SELECTION_VERSION } from '../src/identity.ts'
import { maySubstitute, MODEL_TASK_TYPES, requiredModality } from '../src/task.ts'
import type { ConnectionReport, ModelRoute, RouteRejection, RouteSelection, TaskRoute } from '../src/types.ts'

/**
 * One digest standing in for whatever the planner is handed.
 *
 * The planner only carries the value through, so the tests assert on this exact
 * string rather than on a digest computed from a real adapter declaration.
 */
const FINGERPRINT = 'a'.repeat(64) as RouteSelection['fingerprint']

const entry = (provider: string, over: Partial<LlmConfigurableProvider> = {}): LlmConfigurableProvider => ({
  provider,
  displayName: provider,
  settingsNs: `ns-${provider}`,
  settingsPath: [],
  ...over,
})

const model = (id: string, inputModalities: LlmResolvedModelInfo['inputModalities']): LlmResolvedModelInfo => ({
  provider: 'deepseek-official',
  id,
  name: id,
  ...inputModalities === undefined ? {} : { inputModalities },
})

const ready = (route: ModelRoute, taskType: 'analysis' | 'vision' | 'auxiliary'): ConnectionReport => ({
  route,
  taskType,
  verdict: { kind: 'ready', detail: 'answered' },
  capabilities: { inputModalities: ['text', 'image'], toolUpdate: 'in-history', reportedCacheTokens: false },
  requestId: null,
})

describe('requiredModality', () => {
  it('states one modality per task type', () => {
    expect(requiredModality('analysis')).toBe('text')
    expect(requiredModality('auxiliary')).toBe('text')
    expect(requiredModality('vision')).toBe('image')
  })

  it('refuses a task type that declares no requirement', () => {
    expect(() => requiredModality('summarise' as 'analysis')).toThrow(/declares no modality requirement/u)
  })

  it('lists every task type it routes', () => {
    expect(MODEL_TASK_TYPES).toEqual(['analysis', 'vision', 'auxiliary'])
  })
})

describe('maySubstitute', () => {
  it('lets a text route serve either text task and never an image task', () => {
    expect(maySubstitute('analysis', 'auxiliary')).toBe(true)
    expect(maySubstitute('auxiliary', 'analysis')).toBe(true)
    expect(maySubstitute('analysis', 'vision')).toBe(false)
    expect(maySubstitute('vision', 'analysis')).toBe(false)
    expect(maySubstitute('vision', 'vision')).toBe(true)
  })
})

describe('candidateSet', () => {
  const directory = [entry('beta'), entry('alpha')]
  const catalogs = new Map<string, readonly LlmResolvedModelInfo[]>([
    ['alpha', [model('m2', ['text', 'image']), model('m1', ['text'])]],
    ['beta', []],
  ])

  it('probes in a deterministic provider-then-model order', () => {
    const set = candidateSet(directory, catalogs, 'analysis')
    expect(set.candidates.map(c => `${c.route.provider}/${c.route.model}`))
      .toEqual(['alpha/m1', 'alpha/m2', 'beta/none'].slice(0, 2))
  })

  it('reads an ascending directory and an ascending catalog in the same ascending order', () => {
    const set = candidateSet(
      [entry('alpha'), entry('beta')],
      new Map([['alpha', [model('m1', ['text']), model('m2', ['text'])]]]),
      'analysis',
    )
    expect(set.candidates.map(c => `${c.route.provider}/${c.route.model}`)).toEqual(['alpha/m1', 'alpha/m2'])
    // A provider the catalog map says nothing about is refused exactly as one
    // whose adapter returned an empty list is: no declared model, no candidate.
    expect(set.rejections.map(r => `${r.route.provider}:${r.reason}`)).toEqual(['beta:connection-failed'])
  })

  it('keeps two directory entries naming the same provider, in the order the directory gave them', () => {
    const set = candidateSet(
      [entry('alpha', { settingsNs: 'ns-first' }), entry('alpha', { settingsNs: 'ns-second' })],
      catalogs,
      'analysis',
    )
    // Equal provider keys are not an ordering instruction, so neither entry is
    // moved and neither is dropped: every entry keeps the slot it was given.
    expect(set.candidates.map(c => c.entry?.settingsNs))
      .toEqual(['ns-first', 'ns-first', 'ns-second', 'ns-second'])
  })

  it('keeps two catalog entries naming the same model, in the order the catalog gave them', () => {
    const set = candidateSet(
      [entry('alpha')],
      new Map([['alpha', [model('m1', ['text']), model('m1', ['text'])]]]),
      'analysis',
    )
    expect(set.candidates.map(c => c.model.id)).toEqual(['m1', 'm1'])
    expect(set.rejections).toEqual([])
  })

  it('rejects a route whose adapter declares no modality the task needs, before any request', () => {
    const set = candidateSet(directory, catalogs, 'vision')
    expect(set.candidates.map(c => c.route.model)).toEqual(['m2'])
    const absent = set.rejections.filter(rejection => rejection.reason === 'capability-absent')
    expect(absent).toHaveLength(1)
    const only = absent[0] as RouteRejection
    expect(only.route.model).toBe('m1')
    expect(only.detail).toBe('the adapter declares no image input for alpha/m1')
  })

  it('rejects a route whose adapter declared no modalities at all', () => {
    const silent = new Map([['alpha', [model('m1', undefined)]]])
    const set = candidateSet([entry('alpha')], silent, 'analysis')
    expect(set.candidates).toHaveLength(0)
    expect(set.rejections[0]?.reason).toBe('capability-absent')
  })

  it('records a provider with an empty catalog as a connection failure, not a missing capability', () => {
    const set = candidateSet(directory, catalogs, 'analysis')
    const beta = set.rejections.find(r => r.route.provider === 'beta')
    expect(beta?.reason).toBe('connection-failed')
    expect(beta?.detail).toContain('declares no model')
  })

  it('pins each route to the reference the composition read for its provider', () => {
    const pinned = candidateSet(
      [entry('alpha')],
      new Map([['alpha', [model('m1', ['text'])]]]),
      'analysis',
      provider => (provider === 'alpha' ? credentialRef('DEEPSEEK_API_KEY') : null),
    )
    expect(pinned.candidates[0]?.route.credentialRef).toBe(credentialRef('DEEPSEEK_API_KEY'))
    // A composition that mounts no reference source leaves every route unpinned,
    // which is the honest state: the wait then has nothing to pin against.
    const unpinned = candidateSet([entry('alpha')], new Map([['alpha', [model('m1', ['text'])]]]), 'analysis')
    expect(unpinned.candidates[0]?.route.credentialRef).toBeNull()
  })

  it('refuses a reference name outside the credential grammar', () => {
    const refused = candidateSet(
      [entry('alpha')],
      new Map([['alpha', [model('m1', ['text'])]]]),
      'analysis',
      () => pinnedReference('not a ref'),
    )
    expect(refused.candidates[0]?.route.credentialRef).toBeNull()
  })
})

describe('planRoute', () => {
  const context = (over: Partial<SelectionContext>, candidates: RouteCandidate[]): SelectionContext => ({
    candidates,
    rejections: [],
    taskType: 'analysis',
    attempt: () => Promise.resolve(ready(candidates[0]?.route as ModelRoute, 'analysis')),
    now: () => 1_700_000_000_000,
    persist: () => Promise.resolve(true),
    fingerprintOf: () => Promise.resolve(FINGERPRINT),
    ...over,
  })

  const candidate: RouteCandidate = {
    route: { provider: 'alpha', model: 'm1', credentialRef: null },
    entry: entry('alpha'),
    model: model('m1', ['text']),
  }

  it('returns the first route a real request verified, persisted with the version and fingerprint', async () => {
    const put = vi.fn(() => Promise.resolve(true))
    const decision = await planRoute(context({ persist: put }, [candidate]))
    expect(decision.kind).toBe('ready')
    if (decision.kind !== 'ready') return
    expect(decision.selection.version).toBe(ROUTE_SELECTION_VERSION)
    expect(decision.selection.verifiedAt).toBe(1_700_000_000_000)
    expect(decision.selection.fingerprint).toBe(FINGERPRINT)
    expect(put).toHaveBeenCalledOnce()
  })

  it('stops probing at the first verified route', async () => {
    const attempt = vi.fn(() => Promise.resolve(ready(candidate.route, 'analysis')))
    const second: RouteCandidate = { ...candidate, route: { ...candidate.route, model: 'm2' } }
    await planRoute(context({ attempt }, [candidate, second]))
    expect(attempt).toHaveBeenCalledOnce()
  })

  it('reports not ready when every probed route failed, carrying each refusal', async () => {
    const attempt = () => Promise.resolve<ConnectionReport>({
      route: candidate.route,
      taskType: 'analysis',
      verdict: { kind: 'rejected-credential', failure: { message: 'bad key', code: 'AUTH', status: 401 } },
      capabilities: null,
      requestId: null,
    })
    const decision = await planRoute(context({ attempt }, [candidate]))
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('connection-failed')
    expect(decision.rejected[0]?.detail).toContain('HTTP 401')
  })

  it('reports a real refusal ahead of a capability the catalog stage already ruled out', async () => {
    const decision = await planRoute(context({
      attempt: () => Promise.resolve<ConnectionReport>({
        route: candidate.route,
        taskType: 'analysis',
        verdict: { kind: 'rejected-credential', failure: { message: 'bad key', code: 'AUTH', status: 401 } },
        capabilities: null,
        requestId: null,
      }),
      rejections: [{ route: candidate.route, reason: 'capability-absent', detail: 'no image' }],
    }, [candidate]))
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    // A key the operator can replace and a model they can re-choose are both
    // instructions; `capability-absent` names the absence nothing changed, so a
    // refusal a real request produced is the reason a caller acts on.
    expect(decision.reason).toBe('connection-failed')
    // The refusal itself is still carried, so the surface can name it.
    expect(decision.rejected.map(rejection => rejection.detail)).toContain('rejected-credential (HTTP 401): The provider refused the credential. Replace or repair it.')
  })

  it('names both blockers in the top line when a refusal and a capability absence are mixed', async () => {
    // A vision task where one route was refused for a capability and the one
    // that was probed failed its real request: "every candidate route failed a
    // real connection test" would be false, because the capability-absent route
    // was never tested.
    const decision = await planRoute(context({
      taskType: 'vision',
      rejections: [{ route: { ...candidate.route, model: 'm-text-only' }, reason: 'capability-absent', detail: 'no image' }],
      attempt: () => Promise.resolve<ConnectionReport>({
        route: candidate.route,
        taskType: 'vision',
        verdict: { kind: 'rejected-credential', failure: { message: 'bad key', code: 'AUTH', status: 401 } },
        capabilities: null,
        requestId: null,
      }),
    }, [candidate]))
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    // The reason still names the refusal, which is what a caller acts on.
    expect(decision.reason).toBe('connection-failed')
    expect(decision.detail).toContain('every candidate route for vision that was probed failed a real connection test')
    expect(decision.detail).toContain('1 other route was ruled out for a missing')
    // The two rows are still there, one per blocker.
    expect(decision.rejected.map(rejection => rejection.reason)).toEqual(['capability-absent', 'connection-failed'])
  })

  it('counts every capability the catalog stage ruled out, not just the first', async () => {
    const decision = await planRoute(context({
      taskType: 'vision',
      rejections: [
        { route: { ...candidate.route, model: 'm-text-a' }, reason: 'capability-absent', detail: 'no image' },
        { route: { ...candidate.route, model: 'm-text-b' }, reason: 'capability-absent', detail: 'no image' },
      ],
      attempt: () => Promise.resolve<ConnectionReport>({
        route: candidate.route,
        taskType: 'vision',
        verdict: { kind: 'rejected-credential', failure: { message: 'bad key', code: 'AUTH', status: 401 } },
        capabilities: null,
        requestId: null,
      }),
    }, [candidate]))
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.detail).toContain('2 other routes were ruled out for a missing capability')
  })

  it('reports the absent capability only when no candidate was probed at all', async () => {
    // Every candidate was ruled out before a request, so there is no refusal to
    // report and the absence is the whole answer.
    const decision = await planRoute(context({}, []))
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('capability-absent')
    expect(decision.detail).toContain('text modality')
  })

  it('does not serve a verified route the store refused to record', async () => {
    const decision = await planRoute(context({ persist: () => Promise.resolve(false) }, [candidate]))
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('reverification-required')
  })

  it('names the three reasons the planner produces, and nothing else', async () => {
    const refusedAttempt = (): Promise<ConnectionReport> => Promise.resolve({
      route: candidate.route,
      taskType: 'analysis',
      verdict: { kind: 'rejected-credential', failure: { message: 'bad key', code: 'AUTH', status: 401 } },
      capabilities: null,
      requestId: null,
    })
    const [absent, failed, unwritten] = await Promise.all([
      // No candidate survived the catalog stage, so no request was sent.
      planRoute(context({}, [])),
      // One candidate was probed and the provider refused it.
      planRoute(context({ attempt: refusedAttempt }, [candidate])),
      // The request was verified and the store would not commit the record.
      planRoute(context({ persist: () => Promise.resolve(false) }, [candidate])),
    ])
    const reasonOf = (decision: TaskRoute): string => (decision.kind === 'not-ready' ? decision.reason : 'ready')
    // `no-provider-configured` is the service's own rather than the planner's,
    // and `tests/service-refusals.spec.ts` reaches it over the real service.
    expect([absent, failed, unwritten].map(reasonOf).sort())
      .toEqual(['capability-absent', 'connection-failed', 'reverification-required'])
    // Each decision carries the rows behind it, so a surface can name the
    // blocker rather than a bare reason.
    if (absent.kind !== 'not-ready' || failed.kind !== 'not-ready' || unwritten.kind !== 'not-ready') return
    expect(absent.detail).toContain('text modality')
    expect(absent.rejected).toEqual([])
    expect(failed.rejected.map(rejection => rejection.reason)).toEqual(['connection-failed'])
    expect(failed.rejected[0]?.detail).toBe('rejected-credential (HTTP 401): The provider refused the credential. Replace or repair it.')
    expect(unwritten.detail).toContain('the store refused it')
  })
})

describe('selectionServes', () => {
  const selection: RouteSelection = {
    version: ROUTE_SELECTION_VERSION,
    taskType: 'analysis',
    route: { provider: 'alpha', model: 'm1', credentialRef: null },
    fingerprint: FINGERPRINT,
    capabilities: { inputModalities: ['text'], toolUpdate: undefined, reportedCacheTokens: false },
    verifiedAt: 0,
  }

  it('serves a text selection for either text task and never for an image task', () => {
    expect(selectionServes(selection, 'analysis')).toBe(true)
    expect(selectionServes(selection, 'auxiliary')).toBe(true)
    expect(selectionServes(selection, 'vision')).toBe(false)
  })
})

describe('workIdOf', () => {
  const route: ModelRoute = { provider: 'alpha', model: 'm1', credentialRef: null }

  it('names the same work the same way for the same route, task, and unit', () => {
    expect(workIdOf(route, 'analysis', 1)).toBe(workIdOf(route, 'analysis', 1))
  })

  it('separates two units of work on the same route and task type', () => {
    // One unit settling the other's ticket would report finished work as still
    // running and park the wrong unit on a credential change.
    expect(workIdOf(route, 'analysis', 1)).not.toBe(workIdOf(route, 'analysis', 2))
  })

  it('separates the same unit across task types and across routes', () => {
    expect(workIdOf(route, 'analysis', 1)).not.toBe(workIdOf(route, 'vision', 1))
    expect(workIdOf(route, 'analysis', 1))
      .not.toBe(workIdOf({ ...route, model: 'm2' }, 'analysis', 1))
  })
})
