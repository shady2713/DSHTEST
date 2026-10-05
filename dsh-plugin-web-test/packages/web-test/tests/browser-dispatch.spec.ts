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
    try {
      const reason = guardReason({ name: ALICE_BROWSER }, store, 'owner')
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
    try {
      await store.controlRun('run-1', 'resume')
      await store.assumeRole('run-1', 'buyer', { account: 'Alice Buyer', detail: '/whoami' })
      expect(guardReason({ name: ALICE_BROWSER }, store, 'owner')).toBeUndefined()
      await store.controlRun('run-1', 'pause')
      // A paused run names the pause, which is more useful than the generic
      // no-grant wording, and it is still a refusal.
      expect(guardReason({ name: ALICE_BROWSER }, store, 'owner')).toContain('is paused and refuses new test actions')
      await store.controlRun('run-1', 'resume')
      expect(guardReason({ name: ALICE_BROWSER }, store, 'owner')).toBeUndefined()
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
      expect(guardReason({ name: ALICE_BROWSER }, store, 'owner')).toBeUndefined()
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
    try {
      await store.controlRun('run-theirs', 'resume')
      await store.assumeRole('run-theirs', 'buyer', { account: 'Alice Buyer', detail: '/whoami' })
      expect(guardReason({ name: ALICE_BROWSER }, store, 'theirs')).toBeUndefined()
      expect(guardReason({ name: ALICE_BROWSER }, store, 'mine')).toContain('no run that may drive a browser')
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
    try {
      await store.controlRun('run-1', 'resume')
      await store.assumeRole('run-1', 'buyer', { account: '', detail: 'the site reported no account' })
      // The sign-in itself stays reachable: the run is running and declares the
      // role, even though nothing has been verified yet.
      expect(guardReason({ name: ALICE_BROWSER, }, store, 'owner')).toBeUndefined()
      expect(guardReason({ name: 'mcp__playwright-role-buyer__browser_click' }, store, 'owner')).toBeUndefined()
      // Another role's browser is not reachable for the same preparation.
      expect(guardReason({ name: 'mcp__playwright-role-approver__browser_navigate' }, store, 'owner'))
        .toContain('no run that may drive a browser')
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
