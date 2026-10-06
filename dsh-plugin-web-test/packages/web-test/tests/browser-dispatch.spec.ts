/**
 * Browser reachability is granted per run, not per session or per plugin.
 *
 * Cancelling a run has to take its browser away, or the model keeps driving a
 * page for a run the operator stopped. It must not take the browser away from
 * everything afterwards, or one cancellation would jam every later run. These
 * tests pin both halves against the real store rather than a stub, because the
 * grant is computed from a run's status, its owner, and its verified role.
 *
 * @module dsh-plugin-web-test/tests/browser-dispatch
 */

import { describe, expect, it } from 'vitest'
import { guardReason } from '../src/agent.ts'
import { Context } from '@deepseek-ai/cordis'
import { RoleBrowserPool } from '../src/role-browser.ts'
import { cleanupHomes, harness } from './support/harness.ts'
import { environment, run, seedOf } from './support/seed.ts'

const ALICE_BROWSER = 'mcp__playwright-role-buyer__browser_navigate'

describe('browser dispatch authorisation', () => {
  it('withholds the browser from a cancelled run', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run('run-1', 'owner', { status: 'cancelled' }) },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer']) },
      }),
    })
      // A verified role's own calls now need the authority it was issued.
      const token = (): string => store.mintAuthority('run-1', 'owner')?.token ?? ''
    try {
      const reason = guardReason({ name: ALICE_BROWSER, arguments: { authority: token() }, agent: { id: 'owner' } }, store, 'owner', ownedBy('run-1'))
      expect(reason).toContain('no run that may drive a browser')
      expect(reason).toContain('cancelled')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('withholds the browser while a run is paused, and restores it on resume', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run('run-1', 'owner') },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer']) },
        role_identities: { 'run-1/buyer': identity('run-1', 'buyer') },
      }),
    })
      // A verified role's own calls now need the authority it was issued.
      const token = (): string => store.mintAuthority('run-1', 'owner')?.token ?? ''
    try {
      await store.controlRun('run-1', 'resume')
      await store.assumeRole('run-1', 'buyer', { account: 'Alice Buyer', detail: '/whoami' })
      expect(guardReason({ name: ALICE_BROWSER, arguments: { authority: token() }, agent: { id: 'owner' } }, store, 'owner', ownedBy('run-1'))).toBeUndefined()
      await store.controlRun('run-1', 'pause')
      // A paused run names the pause, which is more useful than the generic
      // no-grant wording, and it is still a refusal.
      expect(guardReason({ name: ALICE_BROWSER, arguments: { authority: token() }, agent: { id: 'owner' } }, store, 'owner')).toContain('is paused and refuses new test actions')
      await store.controlRun('run-1', 'resume')
      expect(guardReason({ name: ALICE_BROWSER, arguments: { authority: token() }, agent: { id: 'owner' } }, store, 'owner', ownedBy('run-1'))).toBeUndefined()
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('gives a new run its own browser after an earlier run was cancelled', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run('run-1', 'owner', { status: 'cancelled' }) },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer']) },
        role_identities: { 'run-2/buyer': identity('run-2', 'buyer') },
      }),
    })
      // A verified role's own calls now need the authority it was issued.
      const token = (): string => store.mintAuthority('run-2', 'owner')?.token ?? ''
    try {
      // The cancelled run is still in the store, so this fails only if the
      // grant is read from the session rather than from the run that is
      // actually executing.
      // A fresh run is inserted the way start_run would, then it is acting on
      // its own terms while run-1 stays cancelled in the store.
      const fresh = await store.putRun(run('run-2', 'owner'))
      expect(fresh.status).toBe('running')
      await store.assumeRole('run-2', 'buyer', { account: 'Alice Buyer', detail: '/whoami' })
      expect(store.verifiedAccount('run-2', 'buyer')).toBe('Alice Buyer')
      expect(guardReason({ name: ALICE_BROWSER, arguments: { authority: token() }, agent: { id: 'owner' } }, store, 'owner', ownedBy('run-1'))).toBeUndefined()
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('leaves another session alone', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: {
          'run-theirs': run('run-theirs', 'theirs'),
          'run-mine': run('run-mine', 'mine', { status: 'cancelled' }),
        },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer']) },
        role_identities: { 'run-theirs/buyer': identity('run-theirs', 'buyer') },
      }),
    })
      // A verified role's own calls now need the authority it was issued.
      const token = (): string => store.mintAuthority('run-theirs', 'theirs')?.token ?? ''
    try {
      await store.controlRun('run-theirs', 'resume')
      await store.assumeRole('run-theirs', 'buyer', { account: 'Alice Buyer', detail: '/whoami' })
      expect(guardReason({ name: ALICE_BROWSER, arguments: { authority: token() }, agent: { id: 'theirs' } }, store, 'theirs')).toBeUndefined()
      expect(guardReason({ name: ALICE_BROWSER }, store, 'mine', ownedBy('run-1'))).toContain('no run that may drive a browser')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('withholds the browser when the role was never confirmed against the site', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run('run-1', 'owner') },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer']) },
      }),
    })
      // A verified role's own calls now need the authority it was issued.
      const token = (): string => store.mintAuthority('run-theirs', 'theirs')?.token ?? ''
    try {
      await store.controlRun('run-1', 'resume')
      await store.assumeRole('run-1', 'buyer', { account: '', detail: 'the site reported no account' })
      // The sign-in itself stays reachable: the run is running and declares the
      // role, even though nothing has been verified yet.
      expect(guardReason({ name: ALICE_BROWSER, }, store, 'owner', ownedBy('run-1'))).toBeUndefined()
      expect(guardReason({ name: 'mcp__playwright-role-buyer__browser_click' }, store, 'owner', ownedBy('run-1'))).toBeUndefined()
      // Another role's browser is not reachable for the same preparation.
      expect(guardReason({ name: 'mcp__playwright-role-approver__browser_navigate' }, store, 'owner', ownedBy('owner')))
        .toContain('no run that may drive a browser')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('binds a role name per environment, so the same name elsewhere is a different identity', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: {
            'run-a': run('run-a', 'owner', { environmentRevisionKey: 'shop-one' }),
            'run-b': run('run-b', 'owner', { environmentRevisionKey: 'shop-two' }),
          },
        'environment_revisions': {
          'shop-one': environment('shop-one', ['buyer'], { buyer: 'Alice Buyer' }),
          'shop-two': environment('shop-two', ['buyer'], { buyer: 'Bob Seller' }),
        },
      }),
    })
    try {
      const a = store.getRun('run-a')
      const b = store.getRun('run-b')
      if (a === undefined || b === undefined) throw new Error('seeded runs missing')
      // Same role name in two confirmed environments: each run is bound to its
      // own environment's account, so one run's verification never stands in for
      // the other's.
      expect(store.expectedAccount(a, 'buyer')).toBe('Alice Buyer')
      expect(store.expectedAccount(b, 'buyer')).toBe('Bob Seller')
    }
    finally {
      await dispose()
      cleanupHomes()
    }
  })


describe('a role browser that cannot start', () => {
  it('raises the failure to the caller and records no browser', async () => {
    // The browser-use registry holds one provider slot and `register` refuses a
    // second one, so a second role's mount throws while its fiber activates.
    // Awaiting the fiber reports that; a caller that never awaited it recorded
    // the role as started anyway, and the only later symptom was `unknown tool`
    // for a client that had never existed.
    //
    // This workspace cannot import the provider module, so the failure reached
    // here is that import rather than the registry's refusal. What the test
    // pins is the behaviour both failures must have: the start raises, and
    // nothing is left claiming the role is up.
    const context = new Context()
    const pool = new RoleBrowserPool(context, '/usr/bin/chrome', true)
    await expect(pool.ensure('buyer')).rejects.toThrow()
    expect(pool.list()).toEqual([])
  })

  it('gives concurrent callers of one role the same start, not a half-built record', async () => {
    const context = new Context()
    const pool = new RoleBrowserPool(context, '/usr/bin/chrome', true)
    const both = Promise.all([pool.ensure('buyer'), pool.ensure('buyer')])
    await expect(both).rejects.toThrow()
    expect(pool.list()).toEqual([])
  })
})


  it('refuses a preparation that names a run other than the one being asked about', async () => {
    // Two runs in one session can each declare `buyer`. `mayPrepareIdentity` used
    // to answer for whichever run was running, so a call queued against a
    // cancelled run was let in through the other one's open window. The owner is
    // now part of the question: the store only answers for the run that holds the
    // browser the call would drive.
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: {
          'run-a': run('run-a', 'owner', { status: 'cancelled', activeRole: '' }),
          'run-b': run('run-b', 'owner', { status: 'running', activeRole: '' }),
        },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer']) },
      }),
    })
    try {
      // B is the session's running run. Asking about B answers for B.
      expect(store.mayPrepareIdentity('owner', 'buyer', 'run-b'))
        .toBe(store.mayPrepareIdentity('owner', 'buyer'))
      // Asking about A does not, even though A and B sit in the same session and
      // declare the same role. This is the pairing that let a queued call through.
      expect(store.mayPrepareIdentity('owner', 'buyer', 'run-a')).toBe(false)
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

})

/**
 * A recorded identity for a role, as a role switch would store.
 * @param runKey - Run the role belongs to.
 * @param role - Role name.
 * @returns the record.
 */
function identity(runKey: string, role: string): Record<string, unknown> {
  return {
    schemaVersion: 3,
    kind: 'role-identity',
    key: `${runKey}/${role}`,
    runKey,
    role,
    account: 'Alice Buyer',
    detail: '/whoami',
    verifiedAtMs: 1,
    label: `${role} as Alice Buyer`,
    updatedAtMs: 1,
  }
}

/**
 * The run that owns a role's browser, as the pool records it.
 * @param runKey - Run that claimed the role.
 * @returns An owner lookup for the guard to consult per role.
 */
function ownedBy(runKey: string): (role: string) => { runKey: string, generation: number } {
  return () => ({ runKey, generation: 1 })
}
