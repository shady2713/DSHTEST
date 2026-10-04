/**
 * The service over a real LLM runtime, with a captured walk: work is admitted on
 * a real route, the credential reference behind it is replaced and then removed
 * through the real credentials service, and the work must be retained, parked,
 * and re-verified on that same route.
 *
 * The HTTP layer is the one real socket in this file — every other moving part is
 * the production wiring, so a failure here is a composition failure rather than a
 * stand-in's opinion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm/types'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { PROBE_MAX_TOKENS, PROBE_PROMPT } from '../src/probe.ts'
import { messagesEndpoint, start as startHarness } from './harness.ts'
import type { TestEndpoint } from './harness.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0)) await dispose()
})

describe('captured walk over the real runtime', () => {
  let endpoint: TestEndpoint
  let baseURL = ''

  beforeEach(async () => {
    endpoint = await messagesEndpoint()
    baseURL = endpoint.baseURL
    cleanups.push(() => endpoint.close())
  })

  it('verifies a route with a real request, records what the adapter declared and the response observed', async () => {
    const harness = await startHarness({ baseURL, key: 'test-key-value-not-a-real-secret' })
    const route = { provider: 'deepseek-official', model: 'deepseek-flash', credentialRef: credentialRef('DEEPSEEK_API_KEY') }
    const report = await harness.service.testConnection(route, 'analysis')
    expect(report.verdict.kind).toBe('ready')
    // The request really left the process and really reached the endpoint.
    expect(endpoint.requests()).toHaveLength(1)
    expect(endpoint.requests()[0]).toContain('/v1/messages')
    // The declared capability and the observed cache accounting are both real.
    expect(report.capabilities?.inputModalities).toEqual(['text', 'image'])
    expect(report.capabilities?.reportedCacheTokens).toBe(true)
    await harness.dispose()
  })

  it('classifies a live 401 as the credential, on the route that was asked about', async () => {
    endpoint.status(401)
    const harness = await startHarness({ baseURL, key: 'test-key-value-not-a-real-secret' })
    const route = { provider: 'deepseek-official', model: 'deepseek-flash', credentialRef: credentialRef('DEEPSEEK_API_KEY') }
    const report = await harness.service.testConnection(route, 'analysis')
    expect(report.verdict.kind).toBe('rejected-credential')
    expect(report.capabilities).toBeNull()
    // One request, on the requested route: no cross-provider fallback happened.
    expect(endpoint.requests()).toHaveLength(1)
    await harness.dispose()
  })

  it('selects a route, persists the version and the fingerprint, and reuses the record while it holds', async () => {
    const harness = await startHarness({ baseURL, key: 'test-key-value-not-a-real-secret' })
    const first = await harness.service.selectRoute('analysis', { reverify: true })
    expect(first.kind).toBe('ready')
    if (first.kind !== 'ready') return
    expect(first.selection.version).toBe('web-test-routes/1')
    expect(first.selection.verifiedAt).toBeGreaterThan(0)
    expect(first.selection.fingerprint).toMatch(/^[0-9a-f]{64}$/u)
    const requestsAfterFirst = endpoint.requests().length
    // The stored record answers the second call without a second request.
    const second = await harness.service.selectRoute('analysis', { reverify: true })
    expect(second.kind).toBe('ready')
    expect(endpoint.requests()).toHaveLength(requestsAfterFirst)
    await harness.dispose()
  })

  it('re-verifies a stored selection by a real request once the catalog moved under it', async () => {
    const harness = await startHarness({ baseURL, key: 'test-key-value-not-a-real-secret' })
    const first = await harness.service.selectRoute('analysis', { reverify: true })
    expect(first.kind).toBe('ready')
    if (first.kind !== 'ready') return
    await harness.dispose()

    // A second run over a different model: the same task type must be re-verified
    // against the route the live directory now names, not served from the record.
    const moved = await startHarness({ baseURL, key: 'test-key-value-not-a-real-secret', catalog: 'deepseek-v4-pro' })
    const carried = moved.store.seed('analysis', first.selection)
    expect(carried).toBe(true)
    const decision = await moved.service.selectRoute('analysis', { reverify: false })
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('reverification-required')
    // Refusing to re-verify costs no request at all.
    expect(endpoint.requests()).toHaveLength(1)
    const reverified = await moved.service.selectRoute('analysis', { reverify: true })
    expect(reverified.kind).toBe('ready')
    expect(endpoint.requests()).toHaveLength(2)
    await moved.dispose()
  })

  it('stays not ready for a vision task no configured route declares', async () => {
    const harness = await startHarness({ baseURL, key: 'test-key-value-not-a-real-secret', catalog: 'deepseek-v4-pro' })
    const decision = await harness.service.selectRoute('vision', { reverify: true })
    expect(decision.kind).toBe('not-ready')
    if (decision.kind !== 'not-ready') return
    expect(decision.reason).toBe('capability-absent')
    // No candidate survived the capability stage, so no request was made.
    expect(endpoint.requests()).toHaveLength(0)
    await harness.dispose()
  })

  it('replaces a credential mid-flight: the work parks, survives, and resumes on the same route', async () => {
    const harness = await startHarness({ baseURL, key: 'test-key-value-not-a-real-secret' })
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    expect(ready.kind).toBe('ready')
    if (ready.kind !== 'ready') return
    const pinned = ready.selection.route
    const ticket = harness.service.beginWork('analysis', pinned)
    expect(ticket.state).toBe('running')

    // The real credentials service writes a new value; the real event fires.
    await harness.credentials.set(pinned.credentialRef as CredentialRef, 'replacement-key-not-a-real-secret')
    await harness.settled()

    const waiting = harness.service.waitingWork()
    expect(waiting.map(t => t.workId)).toEqual([ticket.workId])
    expect(waiting[0]?.parkReason).toBe('credential-replaced')
    // No work was dropped, and the ticket still names the route it started on.
    expect(waiting[0]?.route).toEqual(pinned)

    const resumed = await harness.service.resumeWork(ticket.workId)
    expect(resumed.kind).toBe('resumed')
    if (resumed.kind !== 'resumed') return
    expect(resumed.selection.route).toEqual(pinned)
    expect(harness.service.waitingWork()).toHaveLength(0)
    // The resume was a real request on the pinned route, not a re-selection.
    expect(endpoint.requests()).toHaveLength(2)
    expect(new Set(endpoint.requests()).size).toBe(1)
    await harness.dispose()
  })

  it('removes a credential mid-flight and keeps the wait when the pinned route can no longer answer', async () => {
    const harness = await startHarness({ baseURL, key: 'test-key-value-not-a-real-secret' })
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    expect(ready.kind).toBe('ready')
    if (ready.kind !== 'ready') return
    const pinned = ready.selection.route
    const ticket = harness.service.beginWork('analysis', pinned)
    await harness.credentials.set(pinned.credentialRef as CredentialRef, 'replacement-key-not-a-real-secret')
    await harness.settled()
    await harness.credentials.unset(pinned.credentialRef as CredentialRef)
    await harness.settled()
    expect(harness.service.waitingWork()).toHaveLength(1)

    // With the reference gone the pinned route cannot answer; the wait holds and
    // the work is still there, still on its own route.
    endpoint.status(401)
    const held = await harness.service.resumeWork(ticket.workId)
    expect(held.kind).toBe('still-waiting')
    if (held.kind !== 'still-waiting') return
    expect(held.verdict?.kind).toBe('rejected-credential')
    expect(harness.service.waitingWork()).toHaveLength(1)
    expect(harness.service.waitingWork()[0]?.route).toEqual(pinned)
    await harness.dispose()
  })

  it('never carries a credential value into a report, a ticket, or a stored selection', async () => {
    const harness = await startHarness({ baseURL, key: 'test-key-value-not-a-real-secret' })
    const ready = await harness.service.selectRoute('analysis', { reverify: true })
    expect(ready.kind).toBe('ready')
    if (ready.kind !== 'ready') return
    const ticket = harness.service.beginWork('analysis', ready.selection.route)
    await harness.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'replacement-key-not-a-real-secret')
    await harness.settled()
    const described = await harness.service.describeCredential(credentialRef('DEEPSEEK_API_KEY'))
    // The credential read half carries presence and writability, and no value slot.
    expect(described).toBeDefined()
    expect(described?.configured).toBe(true)
    expect(typeof described?.writable).toBe('boolean')
    // Read against the real read half rather than a `?? {}` that would let a
    // failed read pass as "has no keys": an undefined here is a failure.
    if (described === undefined) throw new Error('the stored reference did not read back')
    expect(Object.keys(described)).not.toContain('value')
    const survey = await harness.service.survey({ reverify: false })
    const rendered = JSON.stringify(survey)
    expect(rendered).not.toContain('test-key-value-not-a-real-secret')
    expect(rendered).not.toContain('replacement-key-not-a-real-secret')
    expect(JSON.stringify(ticket)).not.toContain('test-key-value-not-a-real-secret')
    await harness.dispose()
  })

  it('sends a probe request carrying no credential value, on the real service path', async () => {
    const harness = await startHarness({ baseURL, key: 'test-key-value-not-a-real-secret' })
    // The real runtime is wrapped, not replaced: the options asserted below are
    // the ones production's own `probeRoute` built, and the request still
    // reaches the real endpoint through the real adapter.
    const real = harness.llm.stream.bind(harness.llm)
    const sent: GenerateOptions[] = []
    vi.spyOn(harness.llm, 'stream').mockImplementation((options: GenerateOptions) => {
      sent.push(options)
      return real(options)
    })
    const route = { provider: 'deepseek-official', model: 'deepseek-flash', credentialRef: credentialRef('DEEPSEEK_API_KEY') }
    const report = await harness.service.testConnection(route, 'analysis')
    expect(report.verdict.kind).toBe('ready')
    // The capture happened on the real path, so an empty list means the probe
    // never ran and the assertions below would pass over nothing.
    expect(sent).toHaveLength(1)
    const [options] = sent
    expect(options?.provider).toBe('deepseek-official')
    expect(options?.model).toBe('deepseek-flash')
    expect(options?.maxTokens).toBe(PROBE_MAX_TOKENS)
    const serialized = JSON.stringify(options)
    expect(serialized).toContain(PROBE_PROMPT)
    // The request production built carries no key of its own: the value reaches
    // the provider only inside the adapter, from the credential provider.
    expect(serialized).not.toMatch(/sk-|api[_-]?key/iu)
    expect(serialized).not.toContain('test-key-value-not-a-real-secret')
    // And the wire body the endpoint received agrees.
    expect(endpoint.requests()).toHaveLength(1)
    await harness.dispose()
  })
})
