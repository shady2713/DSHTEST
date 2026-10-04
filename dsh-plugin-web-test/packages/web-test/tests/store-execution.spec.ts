/**
 * Durable execution: operator control, session-scoped holds, business-changing
 * operations, business-time waits, role isolation, and restart reconciliation.
 *
 * Each test states the rule it protects rather than the method that implements
 * it, so a behaviour change has to change these tests on purpose.
 *
 * @module dsh-plugin-web-test/tests/store-execution
 */

import { afterAll, describe, expect, it } from 'vitest'
import { cleanupHomes, harness } from './support/harness.ts'
import type { Harness } from './support/harness.ts'
import { environment, run } from './support/seed.ts'

afterAll(cleanupHomes)

/**
 * A harness whose seeded run is executing.
 *
 * A `running` run found when the store opens is a run a previous process left
 * behind, so the store parks it in `resuming` until an operator continues it.
 * Tests that are not about that rule say so here, by taking the deliberate step
 * the rule asks for.
 * @param options - `roles` declares the environment's roles; `status` and `owner`
 * set the run's starting state; `extra` adds raw fields.
 * @returns the harness, with the run continued to `running`.
 */
async function openRun(options: {
  key?: string
  owner?: string
  status?: string
  roles?: string[]
  extra?: Record<string, unknown>
} = {}): Promise<Harness> {
  const key = options.key ?? 'run-1'
  const h = await harness({
    seed: {
      runs: { [key]: run(key, options.owner ?? 'session-a', { ...(options.status === undefined ? {} : { status: options.status }), ...options.extra }) },
      ...(options.roles === undefined
        ? {}
        : { 'environment_revisions': { 'shop-test': environment('shop-test', options.roles) } }),
    },
  })
  if (h.store.getRun(key)?.status === 'resuming') await h.store.controlRun(key, 'resume')
  return h
}

/**
 * A harness holding several runs, each owned by a different session.
 *
 * One home serves them all, because two independent homes would be two
 * independent media and could not show how the runs interact.
 * @param owners - Run key paired with the session that owns it.
 * @returns the harness, with every run continued to `running`.
 */
async function openRuns(owners: Record<string, string>): Promise<Harness> {
  const seed: Record<string, Record<string, unknown>> = {}
  for (const [key, owner] of Object.entries(owners)) seed[key] = run(key, owner)
  const h = await harness({ seed: { runs: seed } })
  for (const key of Object.keys(owners)) {
    if (h.store.getRun(key)?.status === 'resuming') await h.store.controlRun(key, 'resume')
  }
  return h
}

describe('run control', () => {
  it('refuses a pause of an already paused run and names the state', async () => {
    const h = await openRun()
    await h.store.controlRun('run-1', 'pause')
    await expect(h.store.controlRun('run-1', 'pause')).rejects.toThrow(/is paused and cannot pause/)
  })

  it('keeps a cancelled run terminal, because its browser and evidence are gone', async () => {
    const h = await openRun()
    await h.store.controlRun('run-1', 'cancel')
    for (const action of ['resume', 'pause', 'continue', 'await-user'] as const) {
      await expect(h.store.controlRun('run-1', action)).rejects.toThrow(/is cancelled/)
    }
  })

  it('does not let a completed run be re-opened', async () => {
    const h = await openRun({ status: 'completed' })
    await expect(h.store.controlRun('run-1', 'resume')).rejects.toThrow(/is completed/)
  })

  it('resumes a paused run straight to running, with no re-establishment phase', async () => {
    const h = await openRun()
    await h.store.controlRun('run-1', 'pause')
    const resumed = await h.store.controlRun('run-1', 'resume')
    expect(resumed.status).toBe('running')
    expect(h.store.holdForSession('session-a')).toBeUndefined()
  })

  it('parks a run for an operator answer and continues it only from that state', async () => {
    const h = await openRun()
    expect((await h.store.controlRun('run-1', 'await-user')).status).toBe('awaiting-user')
    await expect(h.store.controlRun('run-1', 'resume')).rejects.toThrow(/is awaiting-user/)
    expect((await h.store.controlRun('run-1', 'continue')).status).toBe('running')
  })

  it('refuses an await-user on a run that is not running', async () => {
    const h = await openRun()
    await h.store.controlRun('run-1', 'pause')
    await expect(h.store.controlRun('run-1', 'await-user')).rejects.toThrow(/is paused and cannot await-user/)
  })

  it('names a missing run instead of creating one', async () => {
    const h = await harness()
    await expect(h.store.controlRun('nope', 'pause')).rejects.toThrow(/no run "nope"/)
  })
})

describe('session-scoped holds', () => {
  it('stops the owning session and no other, so two runs do not block each other', async () => {
    const h = await openRuns({ 'run-1': 'session-a', 'run-2': 'session-b' })
    await h.store.controlRun('run-1', 'pause')
    expect(h.store.holdForSession('session-a')?.runKey).toBe('run-1')
    // A different session keeps working: a pause is not a global stop.
    expect(h.store.holdForSession('session-b')).toBeUndefined()
  })

  it('stops every session when the held run has no owner, because it cannot tell whose work it ends', async () => {
    const h = await openRun({ owner: '' })
    await h.store.controlRun('run-1', 'pause')
    expect(h.store.holdForSession('session-a')?.runKey).toBe('run-1')
    expect(h.store.holdForSession('session-b')?.runKey).toBe('run-1')
  })

  it('releases the hold when a cancelled run becomes terminal', async () => {
    const h = await openRun()
    await h.store.controlRun('run-1', 'pause')
    await h.store.controlRun('run-1', 'cancel')
    expect(h.store.holdForSession('session-a')).toBeUndefined()
    expect(h.store.heldRunList()).toEqual([])
  })

  it('lists every held run for the operator', async () => {
    const h = await openRuns({ 'run-1': 'session-a', 'run-2': 'session-b' })
    await h.store.controlRun('run-1', 'pause')
    await h.store.controlRun('run-2', 'await-user')
    expect(h.store.heldRunList()).toEqual([
      { runKey: 'run-1', status: 'paused' },
      { runKey: 'run-2', status: 'awaiting-user' },
    ])
  })
})

describe('business-changing operations', () => {
  it('records the intent durably as dispatching, before the action runs', async () => {
    const h = await openRun({ roles: ['admin'] })
    const record = await h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', 'admin')
    expect(record.dispatch.kind).toBe('dispatching')
    expect(record.role).toBe('admin')
    expect(h.store.getOperation('run-1', 'op-1')?.key).toBe('run-1/op-1')
  })

  it('refuses to submit the same operation again once its outcome is unresolved', async () => {
    const h = await openRun()
    await h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', '')
    await expect(h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', ''))
      .rejects.toThrow(/is dispatching; its outcome is unresolved/)
  })

  it('refuses a repeat after a lost connection marked it unknown, whatever digest it claims', async () => {
    const h = await openRun()
    await h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', '')
    await h.store.markOperationUnknown('run-1', 'op-1', 'the connection dropped after the click')
    // A different digest is still the same change, so the same key stays refused.
    await expect(h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:bb', ''))
      .rejects.toThrow(/its outcome is unresolved/)
    expect(h.store.getOperation('run-1', 'op-1')?.dispatch).toEqual({
      kind: 'unknown',
      reason: 'the connection dropped after the click',
    })
  })

  it('keeps an unknown operation unknown instead of rewriting the reason', async () => {
    const h = await openRun()
    await h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', '')
    await h.store.markOperationUnknown('run-1', 'op-1', 'first loss')
    const again = await h.store.markOperationUnknown('run-1', 'op-1', 'second loss')
    expect(again.dispatch).toEqual({ kind: 'unknown', reason: 'first loss' })
  })

  it('settles from an independent observation and refuses a second settlement', async () => {
    const h = await openRun()
    await h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', '')
    const settled = await h.store.settleOperation('run-1', 'op-1', 'observed-success')
    expect(settled.dispatch).toEqual({ kind: 'settled', outcome: 'observed-success' })
    await expect(h.store.settleOperation('run-1', 'op-1', 'observed-absent'))
      .rejects.toThrow(/already settled as observed-success/)
  })

  it('refuses to replace an observed outcome with a loss report', async () => {
    const h = await openRun()
    await h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', '')
    await h.store.settleOperation('run-1', 'op-1', 'observed-success')
    await expect(h.store.markOperationUnknown('run-1', 'op-1', 'the page stopped loading'))
      .rejects.toThrow(/already settled as observed-success/)
  })

  it('refuses a role the environment never declared', async () => {
    const h = await openRun({ roles: ['admin'] })
    await expect(h.store.beginOperation('run-1', 'op-1', 'refund #7', 'sha256:cc', 'finance'))
      .rejects.toThrow(/role "finance" was not declared/)
  })

  it('refuses an operation on a run that is not executing', async () => {
    const h = await openRun()
    await h.store.controlRun('run-1', 'pause')
    await expect(h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', ''))
      .rejects.toThrow(/is paused; only a running run may change business data/)
  })

  it('reports which operations still have no established outcome', async () => {
    const h = await openRun()
    await h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', '')
    await h.store.settleOperation('run-1', 'op-1', 'observed-success')
    await h.store.beginOperation('run-1', 'op-2', 'refund #7', 'sha256:bb', '')
    expect(h.store.unresolvedOperations('run-1').map(operation => operation.operationKey)).toEqual(['op-2'])
  })

  it('lists every operation, and one run\'s operations on their own', async () => {
    const h = await openRuns({ 'run-1': 'session-a', 'run-2': 'session-b' })
    await h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', '')
    await h.store.beginOperation('run-2', 'op-1', 'create order #8', 'sha256:cc', '')
    expect(h.store.listOperations().map(operation => operation.runKey).sort()).toEqual(['run-1', 'run-2'])
    expect(h.store.listOperations('run-1').map(operation => operation.runKey)).toEqual(['run-1'])
  })
})

describe('restart reconciliation', () => {
  it('turns an in-flight operation into unknown instead of repeating it', async () => {
    const first = await openRun()
    await first.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', '')
    await first.dispose()
    // The host restarted while the operation was in flight; nothing observed it.
    const second = await harness({ home: first.home })
    const operation = second.store.getOperation('run-1', 'op-1')
    expect(operation?.dispatch.kind).toBe('unknown')
    expect(second.store.reconciliation.unknownOperations).toEqual([
      { runKey: 'run-1', operationKey: 'op-1', reason: expect.stringContaining('must be reconciled with the operator') },
    ])
    await expect(second.store.reconciliation.unknownOperations).toBeDefined()
    // Continuing the run does not make the unresolved operation submittable.
    await second.store.controlRun('run-1', 'resume')
    await expect(second.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', ''))
      .rejects.toThrow(/its outcome is unresolved/)
    await second.dispose()
  })

  it('leaves a run waiting for business time waiting, with its deadline intact', async () => {
    const first = await openRun()
    const until = Date.now() + 3_600_000
    await first.store.waitUntil('run-1', until, 'settlement window')
    await first.dispose()
    const second = await harness({ home: first.home })
    expect(second.store.getRun('run-1')).toMatchObject({
      status: 'awaiting-business-time',
      waitingUntilMs: until,
      waitingReason: 'settlement window',
    })
    // A restart is not a reason to prompt for continuation, so nothing is queued.
    expect(second.store.reconciliation.blockedRuns).toEqual([])
    await second.dispose()
  })

  it('leaves a run waiting for an answer waiting for that answer', async () => {
    const first = await openRun()
    await first.store.controlRun('run-1', 'await-user')
    await first.dispose()
    const second = await harness({ home: first.home })
    expect(second.store.getRun('run-1')?.status).toBe('awaiting-user')
    expect(second.store.reconciliation.blockedRuns).toEqual([])
    await second.dispose()
  })

  it('leaves an interrupted run needing a deliberate continuation, not running again', async () => {
    const first = await openRun()
    await first.dispose()
    const second = await harness({ home: first.home })
    expect(second.store.getRun('run-1')?.status).toBe('resuming')
    expect(second.store.reconciliation.blockedRuns).toEqual(['run-1'])
    // It refuses new work until an operator continues it.
    expect(second.store.holdForSession('session-a')?.status).toBe('resuming')
    await expect(second.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', ''))
      .rejects.toThrow(/is resuming/)
    expect((await second.store.controlRun('run-1', 'resume')).status).toBe('running')
    await second.dispose()
  })

  it('preserves a pause the operator chose, because a restart is not an operator decision', async () => {
    const first = await openRun()
    await first.store.controlRun('run-1', 'pause')
    await first.dispose()
    const second = await harness({ home: first.home })
    expect(second.store.getRun('run-1')?.status).toBe('paused')
    expect(second.store.reconciliation.blockedRuns).toEqual([])
    await second.dispose()
  })

  it('leaves a settled operation alone across a restart', async () => {
    const first = await openRun()
    await first.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', '')
    await first.store.settleOperation('run-1', 'op-1', 'observed-success')
    await first.dispose()
    const second = await harness({ home: first.home })
    expect(second.store.getOperation('run-1', 'op-1')?.dispatch)
      .toEqual({ kind: 'settled', outcome: 'observed-success' })
    expect(second.store.reconciliation.unknownOperations).toEqual([])
    await second.dispose()
  })

  it('reports nothing on a clean first start', async () => {
    const h = await openRun({ status: 'completed' })
    expect(h.store.reconciliation).toEqual({ blockedRuns: [], unknownOperations: [] })
  })
})

describe('business-time waits', () => {
  it('persists the deadline so the wait outlives the process', async () => {
    const first = await openRun()
    const until = Date.now() + 3_600_000
    const waited = await first.store.waitUntil('run-1', until, 'settlement window')
    expect(waited.status).toBe('awaiting-business-time')
    expect(waited.waitingUntilMs).toBe(until)
    await first.dispose()
    const second = await harness({ home: first.home })
    expect(second.store.getRun('run-1')?.waitingUntilMs).toBe(until)
    expect(second.store.getRun('run-1')?.waitingReason).toBe('settlement window')
    await second.dispose()
  })

  it('refuses to resume before the deadline and says how long is left', async () => {
    const h = await openRun()
    await h.store.waitUntil('run-1', Date.now() + 3_600_000, 'settlement window')
    await expect(h.store.resumeWait('run-1')).rejects.toThrow(/waits until .*from now/)
  })

  it('resumes once the deadline has passed and clears the deadline', async () => {
    const h = await openRun()
    await h.store.waitUntil('run-1', Date.now() + 5, 'settlement window')
    await new Promise(resolve => setTimeout(resolve, 30))
    const resumed = await h.store.resumeWait('run-1')
    expect(resumed.status).toBe('running')
    expect(resumed.waitingUntilMs).toBe(0)
    expect(resumed.waitingReason).toBe('')
    expect(h.store.holdForSession('session-a')).toBeUndefined()
  })

  it('refuses a deadline in the past, which is a bug rather than a wait', async () => {
    const h = await openRun()
    await expect(h.store.waitUntil('run-1', Date.now() - 1, 'oops')).rejects.toThrow(/is not in the future/)
  })

  it('refuses to park a run that is already waiting', async () => {
    const h = await openRun()
    await h.store.waitUntil('run-1', Date.now() + 3_600_000, 'settlement window')
    await expect(h.store.waitUntil('run-1', Date.now() + 3_600_000, 'again'))
      .rejects.toThrow(/is awaiting-business-time; only a running run can wait/)
  })
})

describe('role isolation', () => {
  it('records the role the run acts as', async () => {
    const h = await openRun({ roles: ['admin', 'finance'] })
    expect((await h.store.assumeRole('run-1', 'finance')).activeRole).toBe('finance')
    expect((await h.store.assumeRole('run-1', '')).activeRole).toBe('')
  })

  it('refuses an undeclared role', async () => {
    const h = await openRun({ roles: ['admin'] })
    await expect(h.store.assumeRole('run-1', 'finance')).rejects.toThrow(/role "finance" was not declared/)
  })

  it('refuses a role change while an operation is unresolved, because the effect belonged to the old account', async () => {
    const h = await openRun({ roles: ['admin', 'finance'] })
    await h.store.assumeRole('run-1', 'admin')
    await h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', 'admin')
    await expect(h.store.assumeRole('run-1', 'finance')).rejects.toThrow(/still has 1 unresolved operation/)
    await h.store.settleOperation('run-1', 'op-1', 'observed-success')
    expect((await h.store.assumeRole('run-1', 'finance')).activeRole).toBe('finance')
  })
})

describe('result admission', () => {
  it('refuses a new result for a run that is not executing', async () => {
    const h = await openRun({ status: 'cancelled' })
    expect(() => h.store.requireExecutable('run-1')).toThrow(/is cancelled; only a running run may record new results/)
  })

  it('accepts a result for a run that is executing', async () => {
    const h = await openRun()
    expect(h.store.requireExecutable('run-1').key).toBe('run-1')
  })
})

describe('lifecycle and durability', () => {
  it('refuses new dispatch once draining', async () => {
    const h = await openRun()
    expect(h.store.accepting).toBe(true)
    await h.store.drain()
    expect(h.store.accepting).toBe(false)
    expect(h.store.status()).toBeUndefined()
  })

  it('clears holds on rearm, but does not reopen storage by itself', async () => {
    const h = await openRun()
    await h.store.controlRun('run-1', 'pause')
    await h.store.drain()
    h.store.rearm()
    expect(h.store.heldRunList()).toEqual([])
    expect(h.store.state).toBe('active')
    // The unit is gone until the next open, so the store is not accepting yet.
    expect(h.store.accepting).toBe(false)
  })

  it('counts operations in the status snapshot', async () => {
    const h = await openRun()
    await h.store.beginOperation('run-1', 'op-1', 'create order #7', 'sha256:aa', '')
    expect(h.store.status()?.recordCounts).toMatchObject({ project: 0, run: 1, operation: 1 })
  })

  it('refuses to open a unit carrying a version this schema does not know', async () => {
    await expect(harness({ version: 99 })).rejects.toThrow(/carries version 99, not 3/)
  })

  it('reads a record written by an earlier build that lacked the later fields', async () => {
    // A run stored before owner, role and wait fields existed has none of them.
    const h = await harness({
      seed: {
        runs: {
          'run-legacy': {
            schemaVersion: 3,
            kind: 'run',
            key: 'run-legacy',
            label: 'run-legacy',
            updatedAtMs: 1,
            projectKey: 'shop',
            environmentRevisionKey: 'shop-test',
            phase: 'execution',
            status: 'completed',
            unresolvedOperations: {},
          },
        },
      },
    })
    const stored = h.store.getRun('run-legacy')
    expect(stored).toMatchObject({ ownerSessionId: '', activeRole: '', waitingUntilMs: 0, waitingReason: '' })
  })

  it('refuses to read a record that does not match its table schema', async () => {
    await expect(harness({
      seed: { runs: { 'run-bad': { kind: 'run', key: 'run-bad' } } },
    })).rejects.toThrow(/record runs\/run-bad does not match the current schema/)
  })
})
