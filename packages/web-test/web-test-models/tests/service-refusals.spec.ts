/**
 * What the service does when a part of the composition declines: a credential
 * read the provider will not answer, an adapter that cannot enumerate or resolve
 * its own catalog, a live read that stops resolving between the request and the
 * digest it binds that request to, a stored record another release wrote, a record
 * the store refuses, and a composition that has configured no provider at all.
 *
 * The runtime, the credential store, and the HTTP endpoint are the production
 * wiring. Where a row needs the *adapter itself* to fail, it makes the real
 * service method refuse rather than replacing the service, because the behaviour
 * under test is how this service reads a refusal — not whether a stand-in fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { RouteSelectionVersion } from '../src/identity.ts'
import type { SelectionStore } from '../src/index.ts'
import type { ModelRoute } from '../src/types.ts'
import { messagesEndpoint, start as startHarness } from './harness.ts'
import type { TestEndpoint, WorkTestModels } from './harness.ts'

/** Synthetic literals: no row here reads, writes, or asserts a real credential. */
const KEY = 'a-stored-key-that-is-not-a-real-secret'
const REPLACEMENT = 'a-replacement-key-that-is-not-a-real-secret'
const REFERENCE: CredentialRef = credentialRef('DEEPSEEK_API_KEY')
/** A provider the harness's composition registers no adapter for, so the runtime refuses the route. */
const UNSERVED = 'a-provider-no-adapter-serves'
/** The provider and model the harness's default catalog names. */
const PROVIDER = 'deepseek-official'
const MODEL = 'deepseek-flash'

/** A store that commits nothing, standing in for a durable write that was refused. */
const refusingStore: SelectionStore = {
  read: () => Promise.resolve({ revision: 0, byTask: {} }),
  put: () => Promise.resolve(false),
}

let endpoint: TestEndpoint
const cleanups: (() => Promise<unknown>)[] = []

beforeEach(async () => {
  endpoint = await messagesEndpoint()
  cleanups.push(() => endpoint.close())
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const dispose of cleanups.splice(0)) await dispose()
})

/**
 * Start a composition over the current endpoint and register its disposal.
 * @param options - whether the provider adapter is mounted at all, and which model its catalog names.
 * @returns the running composition.
 */
async function composition(options: { mountAdapter?: boolean; catalog?: string } = {}): Promise<WorkTestModels> {
  const harness = await startHarness({ baseURL: endpoint.baseURL, key: KEY, ...options })
  cleanups.push(() => harness.dispose())
  return harness
}

/**
 * The route one real request verified, so a walk starts on a real selection
 * rather than on a route a suite invented.
 * @param harness - the running composition.
 * @returns the verified route.
 */
async function verifiedRoute(harness: WorkTestModels): Promise<ModelRoute> {
  const ready = await harness.service.selectRoute('analysis', { reverify: true })
  if (ready.kind !== 'ready') throw new Error(`the fixture route did not verify: ${ready.detail}`)
  return ready.selection.route
}

describe('the credential state a surface may read', () => {
  it('reads a reference the credential provider refuses as unknown rather than unconfigured', async () => {
    const harness = await composition()
    vi.spyOn(harness.credentials, 'describe')
      .mockRejectedValue(new Error('the credential store could not be read'))
    // A refusal is not an absent key: the caller is told nothing rather than
    // throwing, because a key that may still be stored must not be re-entered.
    await expect(harness.service.describeCredential(REFERENCE)).resolves.toBeUndefined()
  })
})

describe('the wait the service holds', () => {
  it('parks work on a reference that stopped resolving, naming the removal', async () => {
    const harness = await composition()
    const pinned = await verifiedRoute(harness)
    const ticket = harness.service.beginWork('analysis', pinned)
    harness.service.noteCredentialAbsent(REFERENCE)
    const waiting = harness.service.waitingWork()
    expect(waiting.map(entry => entry.workId)).toEqual([ticket.workId])
    expect(waiting[0]?.parkReason).toBe('credential-removed')
    // The work is retained, and still on the route it was pinned to.
    expect(waiting[0]?.route).toEqual(pinned)
  })

  it('gives two units of work on one route their own tickets, so settling one keeps the other', async () => {
    const harness = await composition()
    const pinned = await verifiedRoute(harness)
    const first = harness.service.beginWork('analysis', pinned)
    const second = harness.service.beginWork('analysis', pinned)
    // Same route, same task type, two units of work: one shared identity would
    // let the first report the second finished, or park it twice.
    expect(second.workId).not.toBe(first.workId)
    expect(harness.service.completeWork(first)).toBe(true)
    expect(harness.service.completeWork(second)).toBe(true)
    harness.service.noteCredentialAbsent(REFERENCE)
    // The settled unit is not parked, and the second one settled on its own id
    // rather than the first's, so neither is waiting on the other's behalf.
    expect(harness.service.waitingWork()).toEqual([])
  })

  it('parks each of two units of work on the same route under its own identity', async () => {
    const harness = await composition()
    const pinned = await verifiedRoute(harness)
    const first = harness.service.beginWork('analysis', pinned)
    const second = harness.service.beginWork('analysis', pinned)
    await harness.credentials.set(REFERENCE, REPLACEMENT)
    await harness.settled()
    const waiting = harness.service.waitingWork()
    expect(waiting.map(entry => entry.workId).sort()).toEqual([first.workId, second.workId].sort())
    // Resuming one returns that unit's own ticket and leaves the other parked.
    const resumed = await harness.service.resumeWork(first.workId)
    expect(resumed.kind).toBe('resumed')
    expect(harness.service.waitingWork().map(entry => entry.workId)).toEqual([second.workId])
  })

  it('settles finished work, so a credential change no longer parks it', async () => {
    const harness = await composition()
    const pinned = await verifiedRoute(harness)
    const ticket = harness.service.beginWork('analysis', pinned)
    expect(harness.service.completeWork(ticket)).toBe(true)
    harness.service.noteCredentialAbsent(REFERENCE)
    expect(harness.service.waitingWork()).toEqual([])
    // The settled record is retained, so a caller still reads what the work was.
    const outcome = await harness.service.resumeWork(ticket.workId)
    expect(outcome).toEqual({
      kind: 'still-waiting',
      detail: `work ${ticket.workId} is settled, not waiting`,
      verdict: null,
    })
  })

  it('refuses to resume work that never parked, without spending a request', async () => {
    const harness = await composition()
    const pinned = await verifiedRoute(harness)
    const ticket = harness.service.beginWork('analysis', pinned)
    const before = endpoint.requests().length
    const outcome = await harness.service.resumeWork(ticket.workId)
    expect(outcome).toEqual({
      kind: 'still-waiting',
      detail: `work ${ticket.workId} is running, not waiting`,
      verdict: null,
    })
    expect(endpoint.requests()).toHaveLength(before)
  })

  it('keeps a resumed ticket parked when the store refuses the record the request earned', async () => {
    const harness = await composition()
    const pinned = await verifiedRoute(harness)
    const ticket = harness.service.beginWork('analysis', pinned)
    await harness.credentials.set(REFERENCE, REPLACEMENT)
    await harness.settled()
    harness.service.selections = refusingStore
    // The pinned route answered, so the only thing standing in the way is the
    // record the store would not commit: the work stays parked on that route.
    const outcome = await harness.service.resumeWork(ticket.workId)
    expect(outcome).toEqual({
      kind: 'still-waiting',
      detail: 'the pinned route answered but no selection was recorded: the composition can no longer resolve that route, or the store refused the record',
      verdict: null,
    })
    expect(harness.service.waitingWork()[0]?.route).toEqual(pinned)
  })

  it('does not claim a resume for a ticket that stopped waiting while the request was in flight', async () => {
    const harness = await composition()
    const pinned = await verifiedRoute(harness)
    const ticket = harness.service.beginWork('analysis', pinned)
    await harness.credentials.set(REFERENCE, REPLACEMENT)
    await harness.settled()
    // Two callers resume the same parked ticket, as a double-clicked button
    // does. Both read it waiting, both spend their real request, and the
    // registry moves it once: the second caller must not be handed a `resumed`
    // for a ticket the registry never put back into `running`.
    const [first, second] = await Promise.all([
      harness.service.resumeWork(ticket.workId),
      harness.service.resumeWork(ticket.workId),
    ])
    const resumed = [first, second].filter(outcome => outcome.kind === 'resumed')
    const held = [first, second].filter(outcome => outcome.kind === 'still-waiting')
    expect(resumed).toHaveLength(1)
    expect(held).toHaveLength(1)
    expect(held[0]).toEqual({
      kind: 'still-waiting',
      detail: `the pinned route answered but work ${ticket.workId} was no longer waiting on it`,
      verdict: null,
    })
    // Exactly one request per caller, and the ticket runs on its pinned route.
    expect(endpoint.requests()).toHaveLength(3)
    expect(harness.service.waitingWork()).toEqual([])
  })

  it('refuses to settle work a credential change parked, so the wait survives it', async () => {
    const harness = await composition()
    const pinned = await verifiedRoute(harness)
    const ticket = harness.service.beginWork('analysis', pinned)
    harness.service.noteCredentialAbsent(REFERENCE)
    expect(harness.service.waitingWork().map(entry => entry.workId)).toEqual([ticket.workId])
    // Reporting a parked unit finished is a claim the registry cannot support:
    // the work was interrupted mid-flight and nobody has re-verified it.
    expect(harness.service.completeWork(ticket)).toBe(false)
    const still = harness.service.waitingWork()
    expect(still.map(entry => entry.workId)).toEqual([ticket.workId])
    // The interrupted fact stays recoverable: the route it was pinned to, and
    // what interrupted it.
    expect(still[0]?.route).toEqual(pinned)
    expect(still[0]?.parkReason).toBe('credential-removed')
    expect(still[0]?.interruptedBy).toBe(REFERENCE)
  })
})

describe('a stored record the service will not serve', () => {
  it('refuses a record another release wrote, without spending a request', async () => {
    const harness = await composition()
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
    harness.store.seed('analysis', { ...ready.selection, version: brandString<RouteSelectionVersion>('web-test-routes/0') })
    const before = endpoint.requests().length
    const decision = await harness.service.selectRoute('analysis', { reverify: false })
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('reverification-required')
    expect(decision.detail).toContain('another release')
    expect(endpoint.requests()).toHaveLength(before)
  })

  it('refuses a stored capability record the live adapter declares differently, in either direction', async () => {
    // The record's modality list sits beside the digest in the same file, so the
    // two are independent: hand-editing the list leaves the digest valid. The
    // route is text-only, so a record claiming images would send image work
    // somewhere that cannot read it.
    const harness = await composition({ catalog: 'deepseek-v4-pro' })
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
    expect(ready.selection.capabilities.inputModalities).toEqual(['text'])
    harness.store.putDocument({
      vision: {
        ...ready.selection,
        taskType: 'vision',
        capabilities: { ...ready.selection.capabilities, inputModalities: ['text', 'image'] },
      },
    })
    const before = endpoint.requests().length
    const forged = await harness.service.selectRoute('vision', { reverify: false })
    expect(forged.kind).toBe('not-ready')
    if (forged.kind !== 'not-ready') return
    // The record is refused, not read as an absent capability: only a real
    // request says which of the two lists is current.
    expect(forged.reason).toBe('reverification-required')
    expect(forged.detail).toContain('modalities')
    expect(endpoint.requests()).toHaveLength(before)
  })

  it('refuses a record narrower than the live declaration, rather than reading it as still verified', async () => {
    // The other direction is the same fact: the record no longer describes the
    // route. A vision task must not be told the route lacks images when the
    // adapter still declares them.
    const harness = await composition()
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
    expect(ready.selection.capabilities.inputModalities).toEqual(['text', 'image'])
    harness.store.putDocument({
      analysis: {
        ...ready.selection,
        capabilities: { ...ready.selection.capabilities, inputModalities: ['text'] },
      },
    })
    const before = endpoint.requests().length
    const narrowed = await harness.service.selectRoute('analysis', { reverify: false })
    expect(narrowed.kind).toBe('not-ready')
    if (narrowed.kind !== 'not-ready') return
    expect(narrowed.reason).toBe('reverification-required')
    expect(endpoint.requests()).toHaveLength(before)
    // A real request settles it with the declaration the adapter really has.
    const reverified = await harness.service.selectRoute('analysis', { reverify: true })
    expect(reverified.kind).toBe('ready')
  })

  it('reports a stored value that is not a record, without throwing away the whole survey', async () => {
    const harness = await composition()
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
    // A `null` and a bare string under a task type's key are both values a hand
    // edit produces. One of them must cost that task type its decision and
    // nothing else, so reading a `version` off it cannot throw out the survey.
    harness.store.putDocument({ analysis: null, vision: 'web-test-routes/1' })
    const before = endpoint.requests().length
    const survey = await harness.service.survey({ reverify: false })
    expect(survey.routes.analysis).toEqual({
      kind: 'not-ready',
      reason: 'reverification-required',
      detail: 'this stored value is not a selection record and must be verified again',
      rejected: [],
    })
    expect(survey.routes.vision.kind).toBe('not-ready')
    if (survey.routes.vision.kind !== 'not-ready') return
    expect(survey.routes.vision.detail).toContain('not a selection record')
    expect(survey.routes.auxiliary.kind).toBe('not-ready')
    expect(endpoint.requests()).toHaveLength(before)
  })

  it('refuses a verification instant this host\'s clock reads as later than now', async () => {
    const harness = await composition()
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
    // A negative age satisfies any window, so a future instant would read as
    // freshly verified for as long as the clock stays behind it.
    harness.store.seed('analysis', { ...ready.selection, verifiedAt: Date.now() + 1e13 })
    const before = endpoint.requests().length
    const decision = await harness.service.selectRoute('analysis', { reverify: false })
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('reverification-required')
    expect(decision.detail).toContain('clock')
    expect(endpoint.requests()).toHaveLength(before)
    // Allowing a re-verification spends the one real request that replaces the
    // implausible instant with one this host's own clock wrote.
    const reverified = await harness.service.selectRoute('analysis', { reverify: true })
    expect(reverified.kind).toBe('ready')
    if (reverified.kind !== 'ready') return
    expect(reverified.selection.verifiedAt).toBeLessThanOrEqual(Date.now())
    expect(endpoint.requests()).toHaveLength(before + 1)
    const served = await harness.service.selectRoute('analysis', { reverify: false })
    expect(served.kind).toBe('ready')
  })

  it('serves a record whose age is exactly the configured window, and refuses one millisecond more', async () => {
    // The window is inclusive, and only the clock is faked, so the endpoint and
    // the credential store keep working normally.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const now = 1_700_000_000_000
      vi.setSystemTime(now)
      const harness = await composition()
      const ready = await harness.service.selectRoute('analysis', { reverify: true })
      if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
      const { verificationTtlMs } = harness.service.config
      harness.store.seed('analysis', { ...ready.selection, verifiedAt: now - verificationTtlMs })
      const onBoundary = await harness.service.selectRoute('analysis', { reverify: false })
      expect(onBoundary.kind).toBe('ready')
      harness.store.seed('analysis', { ...ready.selection, verifiedAt: now - verificationTtlMs - 1 })
      const past = await harness.service.selectRoute('analysis', { reverify: false })
      expect(past.kind).toBe('not-ready')
      if (past.kind !== 'not-ready') return
      expect(past.detail).toBe('the last verification is older than the configured window')
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires explicit verification when an intact stored record cannot serve its task', async () => {
    // A hand-edited document can hold a record this release would never write:
    // one stored under `vision` on a route whose adapter declares text only. It
    // is faithful to the declaration and still does not carry the image modality
    // the task needs. A read cannot repair the record with an implicit probe.
    const harness = await composition({ catalog: 'deepseek-v4-pro' })
    const analysis = await harness.service.selectRoute('analysis', { reverify: true })
    if (analysis.kind !== 'ready') throw new Error('the fixture route did not verify')
    expect(analysis.selection.capabilities.inputModalities).toEqual(['text'])
    harness.store.putDocument({
      vision: { ...analysis.selection, taskType: 'vision' },
    })
    const before = endpoint.requests().length
    const vision = await harness.service.selectRoute('vision', { reverify: false })
    expect(vision.kind).toBe('not-ready')
    if (vision.kind !== 'not-ready') return
    expect(vision.reason).toBe('reverification-required')
    expect(endpoint.requests()).toHaveLength(before)
  })

  it('requires explicit verification for a task type whose stored record is absent', async () => {
    const harness = await composition()
    const analysis = await harness.service.selectRoute('analysis', { reverify: true })
    if (analysis.kind !== 'ready') throw new Error('the fixture route did not verify')
    const before = endpoint.requests().length
    const vision = await harness.service.selectRoute('vision', { reverify: false })
    expect(vision.kind).toBe('not-ready')
    expect(endpoint.requests()).toHaveLength(before)
    if (vision.kind !== 'not-ready') return
    expect(vision.reason).toBe('reverification-required')
  })

  it('forgets a parked ticket, so a caller can end work it will not resume', async () => {
    const harness = await composition()
    const pinned = await verifiedRoute(harness)
    const ticket = harness.service.beginWork('analysis', pinned)
    harness.service.noteCredentialAbsent(REFERENCE)
    expect(harness.service.waitingWork().map(entry => entry.workId)).toEqual([ticket.workId])
    // Settling is refused while the work is parked, so dropping it is the only
    // way a caller ends a unit it has decided not to resume.
    expect(harness.service.completeWork(ticket)).toBe(false)
    expect(harness.service.forgetWork(ticket.workId)).toBe(true)
    expect(harness.service.waitingWork()).toEqual([])
    expect(harness.service.forgetWork(ticket.workId)).toBe(false)
  })

  it('re-verifies a record whose verification window has passed, and says so when it may not', async () => {
    const harness = await composition()
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
    harness.store.seed('analysis', { ...ready.selection, verifiedAt: 0 })
    const before = endpoint.requests().length
    const refused = await harness.service.selectRoute('analysis', { reverify: false })
    expect(refused.kind).toBe('not-ready')
    if (refused.kind !== 'not-ready') return
    expect(refused.detail).toBe('the last verification is older than the configured window')
    // Refusing to re-verify costs no request; allowing it spends exactly one.
    expect(endpoint.requests()).toHaveLength(before)
    const reverified = await harness.service.selectRoute('analysis', { reverify: true })
    expect(reverified.kind).toBe('ready')
    expect(endpoint.requests()).toHaveLength(before + 1)
  })

  it('refuses a record whose route the live adapter can no longer resolve, without a request', async () => {
    const harness = await composition()
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
    harness.store.seed('analysis', {
      ...ready.selection,
      route: { ...ready.selection.route, provider: UNSERVED },
    })
    const before = endpoint.requests().length
    const decision = await harness.service.selectRoute('analysis', { reverify: false })
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('reverification-required')
    expect(decision.detail).toBe('the provider, its catalog, or its credential reference moved under this selection')
    expect(endpoint.requests()).toHaveLength(before)
  })

  it('re-verifies a hand-edited capability record instead of reading a string as a modality', async () => {
    // The exact case a settings document can produce: a `capabilities` record a
    // user typed as `"image"`. The stored route is text-only, and a string that
    // *contains* the required modality must not turn it into a vision route.
    const harness = await composition({ catalog: 'deepseek-v4-pro' })
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
    expect(ready.selection.capabilities.inputModalities).toEqual(['text'])
    harness.store.putDocument({
      vision: {
        ...ready.selection,
        taskType: 'vision',
        capabilities: { ...ready.selection.capabilities, inputModalities: 'image' },
      },
    })
    const before = endpoint.requests().length
    const decision = await harness.service.selectRoute('vision', { reverify: false })
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('reverification-required')
    // The forged capability is not served, and refusing to verify costs nothing.
    expect(endpoint.requests()).toHaveLength(before)
    // Allowing a re-verification settles it with the one real request it costs,
    // and the text-only route is still no route for an image task.
    const reverified = await harness.service.selectRoute('vision', { reverify: true })
    expect(reverified.kind).toBe('not-ready')
    if (reverified.kind !== 'not-ready') return
    expect(reverified.reason).toBe('capability-absent')
  })

  it('re-verifies a hand-edited record naming a task type this release does not route, without throwing', async () => {
    const harness = await composition()
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
    // A tag outside the closed union: reading the record's requirement would ask
    // a task type that declares none, and a stored record cannot throw a
    // selection into the caller's face.
    harness.store.putDocument({
      vision: { ...ready.selection, taskType: 'a-tag-this-release-does-not-route' },
    })
    const before = endpoint.requests().length
    const decision = await harness.service.selectRoute('vision', { reverify: false })
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('reverification-required')
    expect(endpoint.requests()).toHaveLength(before)
  })

  it('re-verifies a hand-edited record that names no credential reference to address', async () => {
    const harness = await composition()
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
    harness.store.putDocument({
      analysis: { ...ready.selection, route: { ...ready.selection.route, credentialRef: 7 } },
    })
    const before = endpoint.requests().length
    const decision = await harness.service.selectRoute('analysis', { reverify: false })
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('reverification-required')
    expect(endpoint.requests()).toHaveLength(before)
  })

  it('re-verifies a hand-edited record stored under a key its own task type contradicts', async () => {
    const harness = await composition()
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    if (ready.kind !== 'ready') throw new Error('the fixture route did not verify')
    // The store keys by the record's own task type, so a record that names a
    // different one is a file a user moved or typed by hand.
    harness.store.putDocument({
      analysis: { ...ready.selection, taskType: 'auxiliary' },
    })
    const before = endpoint.requests().length
    const decision = await harness.service.selectRoute('analysis', { reverify: false })
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('reverification-required')
    expect(endpoint.requests()).toHaveLength(before)
  })
})

describe('a composition the directory does not support', () => {
  it('reports an adapter that cannot list its own catalog as a connection failure', async () => {
    const harness = await composition()
    vi.spyOn(harness.llm, 'listModels').mockRejectedValue(new Error('the catalog could not be enumerated'))
    // One unreadable catalog leaves the other routes decidable: the decision is
    // reported against the adapter that failed, not thrown out of the planner.
    const decision = await harness.service.selectRoute('analysis', { reverify: true })
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.rejected.map(rejection => rejection.reason)).toEqual(['connection-failed'])
    expect(decision.rejected[0]?.detail).toContain('declares no model')
    expect(endpoint.requests()).toEqual([])
  })

  it('leaves every route unpinned when the composition names no reference source', async () => {
    const harness = await composition()
    harness.service.references = undefined
    const pinned = await verifiedRoute(harness)
    // A profile that names no reference is the honest state: the route is
    // unpinned, and there is no reference a credential change could interrupt.
    expect(pinned.credentialRef).toBeNull()
    const ticket = harness.service.beginWork('analysis', pinned)
    harness.service.noteCredentialAbsent(REFERENCE)
    expect(harness.service.waitingWork()).toEqual([])
    expect(ticket.state).toBe('running')
  })

  it('reports no usable route for a composition that has configured no provider yet', async () => {
    const harness = await composition({ mountAdapter: false })
    const decision = await harness.service.selectRoute('analysis', { reverify: true })
    expect(harness.service.listProviders()).toEqual([])
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('no-provider-configured')
    expect(decision.detail).toContain('configure one in the conversation model card')
    expect(endpoint.requests()).toEqual([])
  })
})

describe('a route the adapter will not serve', () => {
  it('reports a route no adapter serves as a model rejection, without a request', async () => {
    const harness = await composition()
    const route: ModelRoute = { provider: UNSERVED, model: 'deepseek-flash', credentialRef: REFERENCE }
    const report = await harness.service.testConnection(route, 'analysis')
    // The route exists and the model on it does not, so the refusal is reported
    // as a model rejection rather than as a route that was never configured.
    expect(report.route).toEqual(route)
    expect(report.capabilities).toBeNull()
    expect(report.verdict.kind).toBe('rejected-model')
    if (report.verdict.kind === 'ready') return
    expect(report.verdict.failure.code).toBe('rejected-model')
    expect(endpoint.requests()).toEqual([])
  })

  it('classifies a refusal that is not an Error from what it says', async () => {
    const harness = await composition()
    vi.spyOn(harness.llm, 'resolveModelInfo')
      .mockRejectedValue(`${UNSERVED} is not available`)
    const route: ModelRoute = { provider: 'deepseek-official', model: 'deepseek-flash', credentialRef: REFERENCE }
    // A rejection that never became an Error is still a fact to classify, not a
    // crash: the service reads what it says.
    const report = await harness.service.testConnection(route, 'analysis')
    expect(report.verdict.kind).toBe('rejected-model')
    if (report.verdict.kind === 'ready') return
    expect(report.verdict.failure.message).toBe('The provider does not serve the selected model.')
  })
})

describe('a live read that stops resolving between the request and the digest', () => {
  it('refuses to bind a verified route to a digest it can no longer read', async () => {
    // The route answers a real request and the composition then stops resolving
    // the exact model, which is a state a catalog edit between two reads produces.
    // A verification is bound to a digest, so with no digest there is nothing to
    // record: the decision is not ready and the survey survives, rather than the
    // read of `fingerprint` throwing out of the whole planner.
    const harness = await composition()
    const declared = await harness.llm.resolveModelInfo(PROVIDER, MODEL)
    // Only the read that digests the verification fails; every later read
    // resolves again, which is what makes the other task types decidable.
    vi.spyOn(harness.llm, 'resolveModelInfo')
      .mockResolvedValue(declared)
      .mockResolvedValueOnce(declared)
      .mockRejectedValueOnce(new Error('the catalog stopped naming that model'))
    const decision = await harness.service.selectRoute('analysis', { reverify: true })
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('reverification-required')
    expect(decision.detail).toBe(
      'deepseek-official/deepseek-flash answered a real request but the composition can no longer resolve that route, so this verification cannot be bound to it',
    )
    // Nothing was bound to it, so nothing was stored, and the one task type lost
    // its decision rather than the whole survey.
    const stored = await harness.store.read()
    expect(stored.byTask.analysis).toBeUndefined()
    expect((await harness.service.selectRoute('auxiliary', { reverify: true })).kind).toBe('ready')
  })

  it('keeps a resumed ticket parked when the digest of its pinned route can no longer be read', async () => {
    // The same read on the resume path. The work was interrupted by a credential
    // change, so a null selection has to leave it recoverable on its own route
    // instead of throwing the caller out of `resumeWork`.
    const harness = await composition()
    const pinned = await verifiedRoute(harness)
    const ticket = harness.service.beginWork('analysis', pinned)
    await harness.credentials.set(REFERENCE, REPLACEMENT)
    await harness.settled()
    const declared = await harness.llm.resolveModelInfo(PROVIDER, MODEL)
    vi.spyOn(harness.llm, 'resolveModelInfo')
      .mockResolvedValue(declared)
      .mockResolvedValueOnce(declared)
      .mockRejectedValueOnce(new Error('the catalog stopped naming that model'))
    const outcome = await harness.service.resumeWork(ticket.workId)
    expect(outcome).toEqual({
      kind: 'still-waiting',
      detail: 'the pinned route answered but no selection was recorded: the composition can no longer resolve that route, or the store refused the record',
      verdict: null,
    })
    expect(harness.service.waitingWork()[0]?.route).toEqual(pinned)
  })
})
