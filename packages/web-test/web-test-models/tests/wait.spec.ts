/**
 * The captured walk: a credential is replaced and then removed while work is in
 * flight, and the work must be retained, resumable, and returned on the route it
 * was pinned to — never silently moved to another model.
 */
import { describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { pinnedReference, WorkRegistry } from '../src/wait.ts'
import type { ConnectionReport, ModelRoute, WorkTicket } from '../src/types.ts'

const PINNED: ModelRoute = {
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  credentialRef: credentialRef('DEEPSEEK_API_KEY'),
}
const OTHER: ModelRoute = {
  provider: 'gateway',
  model: 'gateway-small',
  credentialRef: credentialRef('GATEWAY_API_KEY'),
}

const readyOn = (route: ModelRoute, taskType: 'analysis'): ConnectionReport => ({
  route,
  taskType,
  verdict: { kind: 'ready', detail: 'answered' },
  capabilities: { inputModalities: ['text', 'image'], toolUpdate: undefined, reportedCacheTokens: false },
  requestId: null,
})

const refusedOn = (route: ModelRoute, taskType: 'analysis'): ConnectionReport => ({
  route,
  taskType,
  verdict: { kind: 'rejected-credential', failure: { message: 'bad key', code: 'AUTH', status: 401 } },
  capabilities: null,
  requestId: null,
})

describe('pinnedReference', () => {
  it('brands a name in the reference grammar and reads everything else as not pinned', () => {
    expect(pinnedReference('DEEPSEEK_API_KEY')).toBe(credentialRef('DEEPSEEK_API_KEY'))
    expect(pinnedReference('not a ref')).toBeNull()
    expect(pinnedReference(null)).toBeNull()
    expect(pinnedReference(undefined)).toBeNull()
  })
})

describe('WorkRegistry', () => {
  it('admits work pinned to a route and keeps re-admission from re-pinning it', () => {
    const registry = new WorkRegistry()
    const first = registry.admit({ workId: 'w1', taskType: 'analysis', route: PINNED })
    const again = registry.admit({ workId: 'w1', taskType: 'analysis', route: OTHER })
    expect(again.route).toEqual(PINNED)
    expect(registry.read('w1')?.route).toEqual(PINNED)
    expect(first.state).toBe('running')
  })

  it('reads an untracked identity as absent', () => {
    expect(new WorkRegistry().read('nope')).toBeUndefined()
  })

  it('parks only the work whose pinned reference changed, keeping the original route', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'pinned', taskType: 'analysis', route: PINNED })
    registry.admit({ workId: 'elsewhere', taskType: 'analysis', route: OTHER })
    const parked = registry.parkForReference(PINNED.credentialRef as NonNullable<ModelRoute['credentialRef']>, true, 1_000)
    expect(parked.map(t => t.workId)).toEqual(['pinned'])
    const ticket = registry.read('pinned') as WorkTicket
    expect(ticket.state).toBe('waiting')
    expect(ticket.parkReason).toBe('credential-replaced')
    expect(ticket.parkedAt).toBe(1_000)
    expect(ticket.interruptedBy).toBe(PINNED.credentialRef)
    expect(ticket.route).toEqual(PINNED)
    // The unrelated work keeps running: a change to one reference is not a stop
    // for every route in the process.
    expect(registry.read('elsewhere')?.state).toBe('running')
    expect(registry.waiting().map(t => t.workId)).toEqual(['pinned'])
  })

  it('names a removal as a removal', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'w1', taskType: 'analysis', route: PINNED })
    registry.parkForReference(PINNED.credentialRef as NonNullable<ModelRoute['credentialRef']>, false, 5)
    expect(registry.read('w1')?.parkReason).toBe('credential-removed')
  })

  it('does not restart the wait when a second change lands on an already-parked ticket', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'w1', taskType: 'analysis', route: PINNED })
    const ref = PINNED.credentialRef as NonNullable<ModelRoute['credentialRef']>
    registry.parkForReference(ref, true, 1_000)
    const second = registry.parkForReference(ref, true, 9_000)
    expect(second).toEqual([])
    expect(registry.read('w1')?.parkedAt).toBe(1_000)
  })

  it('resumes a parked ticket on its own pinned route, and only then', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'w1', taskType: 'analysis', route: PINNED })
    registry.parkForReference(PINNED.credentialRef as NonNullable<ModelRoute['credentialRef']>, true, 1_000)
    expect(registry.resume('w1', readyOn(PINNED, 'analysis'))).toBe(true)
    const ticket = registry.read('w1') as WorkTicket
    expect(ticket.state).toBe('running')
    expect(ticket.parkReason).toBeNull()
    expect(ticket.parkedAt).toBeNull()
    expect(ticket.interruptedBy).toBeNull()
  })

  it('resumes a parked ticket from a report that names its pinned route, not the same object', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'w1', taskType: 'analysis', route: PINNED })
    registry.parkForReference(PINNED.credentialRef as NonNullable<ModelRoute['credentialRef']>, true, 1_000)
    // A report rebuilt from the same route is the same route. Refusing it on
    // object identity strands the work in its wait after it has just verified.
    const rebuilt: ConnectionReport = { ...readyOn(PINNED, 'analysis'), route: { ...PINNED } }
    expect(registry.resume('w1', rebuilt)).toBe(true)
    expect(registry.read('w1')?.state).toBe('running')
  })

  it('refuses to resume a ticket onto a route it was not pinned to', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'w1', taskType: 'analysis', route: PINNED })
    registry.parkForReference(PINNED.credentialRef as NonNullable<ModelRoute['credentialRef']>, true, 1_000)
    // A caller that hands back a different route's report cannot re-pin the work.
    expect(registry.resume('w1', readyOn(OTHER, 'analysis'))).toBe(false)
    expect(registry.read('w1')?.state).toBe('waiting')
  })

  it('refuses a resume whose report names the same provider and model on another reference', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'w1', taskType: 'analysis', route: PINNED })
    registry.parkForReference(PINNED.credentialRef as NonNullable<ModelRoute['credentialRef']>, true, 1_000)
    // The reference is what a credential change attributes the work by, so a
    // swapped reference is a different route even when the model is the same.
    const swapped: ConnectionReport = {
      ...readyOn(PINNED, 'analysis'),
      route: { ...PINNED, credentialRef: credentialRef('OTHER_API_KEY') },
    }
    expect(registry.resume('w1', swapped)).toBe(false)
    expect(registry.read('w1')?.state).toBe('waiting')
  })

  it('refuses to resume work that is not waiting', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'w1', taskType: 'analysis', route: PINNED })
    expect(registry.resume('w1', readyOn(PINNED, 'analysis'))).toBe(false)
  })

  it('refuses a resume of an identity it does not track', () => {
    const registry = new WorkRegistry()
    expect(registry.resume('never-admitted', readyOn(PINNED, 'analysis'))).toBe(false)
  })

  it('settles finished work once, and can forget it, without losing a parked ticket', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'done', taskType: 'analysis', route: PINNED })
    registry.admit({ workId: 'kept', taskType: 'analysis', route: OTHER })
    expect(registry.settle('done')).toBe(true)
    expect(registry.read('done')?.state).toBe('settled')
    // Settling twice did not move the ticket this time, so it does not claim to.
    expect(registry.settle('done')).toBe(false)
    expect(registry.settle('never-admitted')).toBe(false)
    expect(registry.forget('done')).toBe(true)
    expect(registry.read('done')).toBeUndefined()
    expect(registry.read('kept')?.state).toBe('running')
  })

  it('does not park settled work', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'done', taskType: 'analysis', route: PINNED })
    registry.settle('done')
    registry.parkForReference(PINNED.credentialRef as NonNullable<ModelRoute['credentialRef']>, true, 1)
    expect(registry.read('done')?.state).toBe('settled')
  })

  it('hands out copies, so a caller cannot mutate the registry through a ticket', () => {
    const registry = new WorkRegistry()
    const ticket = registry.admit({ workId: 'w1', taskType: 'analysis', route: PINNED })
    expect(Object.isFrozen(ticket)).toBe(false)
    expect(registry.read('w1')?.state).toBe('running')
    // Reading again proves the stored record is independent of the returned value.
    const second = registry.read('w1') as WorkTicket
    expect(second).not.toBe(ticket)
    expect(second).toEqual(ticket)
  })

  it('refuses to settle a parked ticket, so the recoverable wait keeps it', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'w1', taskType: 'analysis', route: PINNED })
    registry.parkForReference(PINNED.credentialRef as NonNullable<ModelRoute['credentialRef']>, true, 1)
    // Work interrupted mid-flight is not work that finished, and settling it
    // would remove it from the wait the card requires to stay recoverable.
    expect(registry.settle('w1')).toBe(false)
    const ticket = registry.read('w1') as WorkTicket
    expect(ticket.state).toBe('waiting')
    expect(registry.waiting().map(entry => entry.workId)).toEqual(['w1'])
    // The interrupted fact survives the refused settle: the pinned route, when
    // it parked, and which reference interrupted it.
    expect(ticket.route).toEqual(PINNED)
    expect(ticket.parkReason).toBe('credential-replaced')
    expect(ticket.interruptedBy).toBe(PINNED.credentialRef)
    // Once the work is genuinely finished on its pinned route, settling it is
    // what the registry accepts.
    expect(registry.resume('w1', readyOn(PINNED, 'analysis'))).toBe(true)
    expect(registry.settle('w1')).toBe(true)
    expect(registry.waiting()).toEqual([])
  })

  it('refuses a resume carrying a refusal, so a wait ends only on an answer', () => {
    const registry = new WorkRegistry()
    registry.admit({ workId: 'w1', taskType: 'analysis', route: PINNED })
    registry.parkForReference(PINNED.credentialRef as NonNullable<ModelRoute['credentialRef']>, true, 1)
    const refused = refusedOn(PINNED, 'analysis')
    expect(refused.verdict.kind).toBe('rejected-credential')
    // The pinned route was addressed and did not answer, so the wait continues.
    expect(registry.resume('w1', refused)).toBe(false)
    const ticket = registry.read('w1') as WorkTicket
    expect(ticket.state).toBe('waiting')
    expect(ticket.route).toEqual(PINNED)
    expect(registry.waiting().map(entry => entry.workId)).toEqual(['w1'])
  })
})
