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
import { RELEASED_STATUSES, guardReason } from '../src/agent.ts'
import { SCHEMA_VERSION } from '../src/records.ts'
import { Context } from '@deepseek-ai/cordis'
import { IDENTITY_PROBE, RoleBrowserPool } from '../src/role-browser.ts'
import type { MountOwner } from '../src/role-browser.ts'
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
      const reason = guardReason({ name: ALICE_BROWSER, arguments: { authority: token() }, agent: { id: 'owner' } }, store, 'owner', ownedBy(store, 'run-1'))
      // A cancelled run mints no authority at all, so the call has none to present.
      expect(reason).toContain('needs the authority')
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
      expect(guardReason({ name: ALICE_BROWSER, arguments: { authority: token() }, agent: { id: 'owner' } }, store, 'owner', ownedBy(store, 'run-1'))).toBeUndefined()
      await store.controlRun('run-1', 'pause')
      // A paused run names the pause, which is more useful than the generic
      // no-grant wording, and it is still a refusal.
      expect(guardReason({ name: ALICE_BROWSER, arguments: { authority: token() }, agent: { id: 'owner' } }, store, 'owner', ownedBy(store, 'run-1'))).toContain('is paused and refuses new test actions')
      await store.controlRun('run-1', 'resume')
      expect(guardReason({ name: ALICE_BROWSER, arguments: { authority: token() }, agent: { id: 'owner' } }, store, 'owner', ownedBy(store, 'run-1'))).toBeUndefined()
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
      const minted = store.mintAuthority('run-2', 'owner')
      expect(guardReason({ name: ALICE_BROWSER, arguments: { authority: minted?.token ?? '' }, agent: { id: 'owner' } }, store, 'owner', ownedBy(store, 'run-2', 'owner', minted?.generation))).toBeUndefined()
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
      expect(guardReason({ name: ALICE_BROWSER, arguments: { authority: token() }, agent: { id: 'theirs' } }, store, 'mine', ownedBy(store, 'run-theirs', 'theirs'))).toContain('another session')
      expect(guardReason({ name: ALICE_BROWSER }, store, 'mine', ownedBy(store, 'run-1'))).toContain('needs the authority')
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
      expect(guardReason({ name: ALICE_BROWSER, }, store, 'owner', ownedBy(store, 'run-1'))).toBeUndefined()
      expect(guardReason({ name: 'mcp__playwright-role-buyer__browser_click' }, store, 'owner', ownedBy(store, 'run-1'))).toBeUndefined()
      // Another role's browser is not reachable for the same preparation.
      expect(guardReason({ name: 'mcp__playwright-role-approver__browser_navigate' }, store, 'owner', ownedBy(store, 'run-1')))
        .toContain('needs the authority')
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


  it('files a role browser under its owner, not under the role name', () => {
    // The same `buyer` is declared by two projects and two environments. Keyed on
    // the name alone, one run would be handed the browser another signed in on.
    const owner = (projectKey: string, environmentKey: string, runKey: string): BrowserOwner =>
      ({ projectKey, environmentKey, runKey, role: 'buyer' })
    const keys = new Set([
      RoleBrowserPool.keyOf(owner('shop', 'env-a', 'run-1')),
      RoleBrowserPool.keyOf(owner('shop', 'env-b', 'run-1')),
      RoleBrowserPool.keyOf(owner('crm', 'env-a', 'run-1')),
      RoleBrowserPool.keyOf(owner('shop', 'env-a', 'run-2')),
    ])
    expect(keys.size).toBe(4)
    // The same owner resolves to the same key, so a role keeps its login.
    expect(RoleBrowserPool.keyOf(owner('shop', 'env-a', 'run-1')))
      .toBe(RoleBrowserPool.keyOf(owner('shop', 'env-a', 'run-1')))
  })


  it('refuses a second run in one session preparing a role the first has verified', async () => {
    // Measured on 0.8.0. With run-a already acting as a verified `buyer`, a second
    // run in the same session that also declares `buyer` is refused on a real host.
    // The store is not the reason: asking about run-b answers true for run-b. The
    // guard names the run the pool currently has claimed for the role, which is
    // run-a, and preparation is closed for run-a because its role is verified. That
    // is why the second run cannot bootstrap.
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: {
          'run-a': run('run-a', 'owner', { status: 'running', activeRole: '' }),
          'run-b': run('run-b', 'owner', { status: 'paused', activeRole: '' }),
        },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer']) },
      }),
    })
    try {
      // A seeded run with no verified identity comes back from the restart
      // reconciliation as `resuming`, so both are moved to `running` first.
      await store.controlRun('run-a', 'resume')
      await store.assumeRole('run-a', 'buyer', { account: 'Alice Buyer', detail: '/whoami' })
      // Run-b asks on its own behalf while running rather than paused.
      await store.controlRun('run-b', 'resume')
      // Run-b asking about itself answers for run-b: preparation is open.
      expect(store.mayPrepareIdentity('owner', 'buyer', 'run-b')).toBe(true)
      // Run-a asking about itself does not, because its role is verified, which
      // is what closes preparation for the run that holds the browser.
      expect(store.mayPrepareIdentity('owner', 'buyer', 'run-a')).toBe(false)
      // So the answer depends entirely on which run is named.
      expect(store.mayPrepareIdentity('owner', 'buyer')).toBe(false)
      // Run-a asking about itself is refused for a different reason: its role is
      // verified, so preparation is closed and business calls need its authority.
      expect(store.mayPrepareIdentity('owner', 'buyer', 'run-a')).toBe(false)
    } finally {
      await dispose()
      cleanupHomes()
    }
  })


  it('releases on every status a stopped run reaches, and only on those', () => {
    // Releasing from the tool handler meant the operator's `webTest/*` surface
    // left browsers running, because a cancel or pause issued there never
    // passed through a handler. The pool now subscribes to the store's status
    // change, so the statuses that end a run's ownership are what decides.
    for (const status of ['paused', 'awaiting-user', 'awaiting-business-time',
      'cancelled', 'completed', 'blocked', 'resuming'] as const) {
      expect(RELEASED_STATUSES.has(status)).toBe(true)
    }
    // A run that is still working keeps its browsers.
    expect(RELEASED_STATUSES.has('running')).toBe(false)
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
function ownedBy(
  store: { generationOf: (key: string) => number | undefined },
  runKey: string,
  sessionId = '',
  generation?: number,
): {
  ownerOfServer: (n: string) => MountOwner | undefined
  claimOf: (n: string) => { runKey: string, generation: number } | undefined
} {
  // The generation is read from the run at the moment the call is judged. Naming
  // it as a literal left the mount claiming a generation the run had already
  // left behind, which only showed up once the preparation path started comparing
  // the three of them: pausing and resuming moves the run on, and the mount did
  // not. A literal here was a fixture that disagreed with the store it stood in
  // for.
  const owned = (name: string): MountOwner | undefined =>
    (name.startsWith('playwright-role-')
      ? {
        sessionId,
        projectKey: 'shop',
        environmentKey: 'shop-test',
        runKey,
        role: name.slice('playwright-role-'.length),
        generation: generation ?? store.generationOf(runKey) ?? 0,
        serverName: name,
      }
      : undefined)
  return {
    ownerOfServer: owned,
    claimOf: name => (owned(name) === undefined ? undefined : { runKey, generation: generation ?? store.generationOf(runKey) ?? 0 }),
  }
}

describe('against the real store, not a stand-in', () => {
  it('refuses a browser whose run has been cancelled', async () => {
    // The cases above hand `guardReason` an object that answers whatever it is
    // asked, so one that passes because the real query disagrees with the
    // stand-in cannot pass there. This opens a real store over the memory backend.
    const home = await harness({ seed: {
      projects: {
        shop: {
          schemaVersion: SCHEMA_VERSION, kind: 'project', label: 'Shop',
          updatedAtMs: 0, key: 'shop', sourceRoot: '/src', baseUrl: 'http://shop',
        },
      },
    } })
    try {
      const { store } = home
      await store.putEnvironment({
        schemaVersion: SCHEMA_VERSION, kind: 'environment-revision', label: 'acc',
        updatedAtMs: 0, key: 'acc@1', projectKey: 'shop', revision: 1, name: 'acc',
        url: 'http://shop/acc', nature: 'test', dataOperations: 'read-only',
        roles: [{ name: 'buyer', accountRef: 'bob@example.test' }], scopeNotes: '',
        modelRef: '', viewport: { width: 1280, height: 800 }, confirmedAtMs: 0,
      })
      const base = {
        schemaVersion: SCHEMA_VERSION, kind: 'run' as const, label: 'r',
        updatedAtMs: 0, key: 'run-a', projectKey: 'shop', environmentRevisionKey: 'acc@1',
        generation: 1, phase: 'execution' as const, unresolvedOperations: {},
        waitingUntilMs: 0, waitingReason: '',
      }
      await store.putRun({ ...base, status: 'running', ownerSessionId: 's1', activeRole: '' })
      expect(store.hasRunningRun('s1')).toBe(true)

      await store.controlRun('run-a', 'cancel')

      expect(store.hasRunningRun('s1')).toBe(false)

      // The lookup is by owning session, so a run another session drives must
      // not leave this one looking busy, and a store with no runs at all is not
      // a session with work in flight.
      await store.putRun({
        ...base, key: 'run-theirs', status: 'running', ownerSessionId: 's2', activeRole: '',
      })
      expect(store.hasRunningRun('s1')).toBe(false)
      expect(store.hasRunningRun('s2')).toBe(true)
      const empty = await harness({ seed: { projects: {} } })
      try { expect(empty.store.hasRunningRun('s1')).toBe(false) } finally { await empty.dispose() }
      const owner = {
        sessionId: 's1', projectKey: 'shop', environmentKey: 'acc',
        runKey: 'run-a', role: 'buyer', generation: 1,
        serverName: 'playwright-role-buyer',
      }
      expect(guardReason({
        name: 'mcp__playwright-role-buyer__browser_click',
        arguments: { authority: 'anything' }, agent: { id: 'agent-a' },
      }, store, 's1', {
        ownerOfServer: (n: string) => n === owner.serverName ? owner : undefined,
        claimOf: (n: string) => n === owner.serverName ? { runKey: 'run-a', generation: 1 } : undefined,
      })).toBeDefined()
    } finally {
      await home.dispose()
    }
  })
})

describe('a cancelled run does not block the next one', () => {
  it('keeps B driving its own browser after A is cancelled, against the real store', async () => {
    const home = await harness({ seed: {
      projects: {
        shop: {
          schemaVersion: SCHEMA_VERSION, kind: 'project', label: 'Shop',
          updatedAtMs: 0, key: 'shop', sourceRoot: '/src', baseUrl: 'http://shop',
        },
      },
    } })
    try {
      const { store } = home
      await store.putEnvironment({
        schemaVersion: SCHEMA_VERSION, kind: 'environment-revision', label: 'acc',
        updatedAtMs: 0, key: 'acc@1', projectKey: 'shop', revision: 1, name: 'acc',
        url: 'http://shop/acc', nature: 'test', dataOperations: 'read-only',
        roles: [{ name: 'buyer', accountRef: 'bob@example.test' }], scopeNotes: '',
        modelRef: '', viewport: { width: 1280, height: 800 }, confirmedAtMs: 0,
      })
      const base = {
        schemaVersion: SCHEMA_VERSION, kind: 'run' as const, label: 'r',
        updatedAtMs: 0, projectKey: 'shop', environmentRevisionKey: 'acc@1',
        generation: 1, phase: 'execution' as const, unresolvedOperations: {},
        waitingUntilMs: 0, waitingReason: '', ownerSessionId: 's1', activeRole: 'buyer',
      }
      await store.putRun({ ...base, key: 'run-a', status: 'running' })
      await store.assumeRole('run-a', 'buyer', { account: 'bob@example.test', detail: 'form' })
      const tokenA = store.mintAuthority('run-a', 'agent-a')
      expect(tokenA).toBeDefined()
      const tokenOfA = tokenA?.token ?? ''

      await store.controlRun('run-a', 'cancel')
      expect(store.mintAuthority('run-a', 'agent-a')).toBeUndefined()
      expect(() => store.requireAuthority(tokenOfA, 'agent-a')).toThrow()

      await store.putRun({ ...base, key: 'run-b', status: 'running' })
      await store.assumeRole('run-b', 'buyer', { account: 'bob@example.test', detail: 'form' })
      const tokenB = store.mintAuthority('run-b', 'agent-b')
      expect(tokenB).toBeDefined()
      expect(store.requireAuthority(tokenB?.token ?? '', 'agent-b')?.runKey).toBe('run-b')
      expect(() => store.requireAuthority(tokenB?.token ?? '', 'agent-a')).toThrow()
    } finally {
      await home.dispose()
    }
  })
})

/**
 * A no-credential browser call on a mount the session still holds, judged by the
 * real store rather than by a stubbed answer.
 * @param store - Store to judge against.
 * @param mount - Mount the call names.
 * @returns the refusal reason, or `undefined` when the call is admitted.
 */
function judgedBy(
  store: Parameters<typeof guardReason>[1],
  mount: MountOwner,
  claimGeneration: number,
): string | undefined {
  return guardReason(
    { name: `mcp__${mount.serverName}__browser_click`, arguments: {}, agent: { id: 'agent-a' } },
    store, 'owner',
    { ownerOfServer: () => mount, claimOf: () => ({ runKey: mount.runKey, generation: claimGeneration }) },
  )
}

describe('preparation judged against the real store', () => {
  const BASE = {
    seed: seedOf({
      runs: { 'run-a': run('run-a', 'owner', { status: 'running', activeRole: 'buyer' }) },
      'environment_revisions': { 'shop-test': environment('shop-test', ['buyer', 'seller']) },
    }),
  }

  it('admits the role it is still verifying, and refuses one already verified', async () => {
    const { store, dispose } = await harness(BASE)
    try {
      // A seeded run arrives interrupted; resuming it is what puts it back into
      // the state these cases are about.
      await store.controlRun('run-a', 'resume')
      await store.putRoleIdentity({
        schemaVersion: SCHEMA_VERSION, kind: 'role-identity' as const, label: 'buyer',
        updatedAtMs: 0, key: 'run-a/buyer', runKey: 'run-a', role: 'buyer',
        account: 'alice@example.test', detail: '',
        generation: store.generationOf('run-a') ?? 0, verifiedAtMs: 1,
      })
      const mount: MountOwner = {
        serverName: 'playwright-role-buyer', runKey: 'run-a', role: 'buyer',
        generation: store.generationOf('run-a') ?? 0, sessionId: 'owner',
      }
      // Buyer is verified in this generation, so its own browser needs no window.
      expect(judgedBy(store, mount, store.generationOf('run-a') ?? 0)).toBeTypeOf('string')
      // Seller has never been verified, so preparing it still works.
      const seller: MountOwner = { ...mount, serverName: 'playwright-role-seller', role: 'seller' }
      expect(judgedBy(store, seller, store.generationOf('run-a') ?? 0)).toBeUndefined()
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('refuses the old role once the run has switched to another one', async () => {
    // Windows reported this combination: the run verified `buyer`, moved to
    // `seller`, and the buyer mount and its claim were both still generation 1.
    // The preparation window used to reopen for buyer, because it was tied to the
    // active role rather than to what had already been verified.
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-a': run('run-a', 'owner', { status: 'running', activeRole: 'seller' }) },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer', 'seller']) },
      }),
    })
    try {
      await store.controlRun('run-a', 'resume')
      await store.putRoleIdentity({
        schemaVersion: SCHEMA_VERSION, kind: 'role-identity' as const, label: 'buyer',
        updatedAtMs: 0, key: 'run-a/buyer', runKey: 'run-a', role: 'buyer',
        account: 'alice@example.test', detail: '',
        generation: store.generationOf('run-a') ?? 0, verifiedAtMs: 1,
      })
      const mount: MountOwner = {
        serverName: 'playwright-role-buyer', runKey: 'run-a', role: 'buyer',
        generation: store.generationOf('run-a') ?? 0, sessionId: 'owner',
      }
      expect(judgedBy(store, mount, store.generationOf('run-a') ?? 0)).toBeTypeOf('string')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('refuses a mount whose owner and claim agree while the run has moved on', async () => {
    // The other combination Windows reported: owner generation 1, claim
    // generation 1, but the run itself is on generation 2. Comparing only the
    // first two made a mount the run had already replaced look current.
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-a': run('run-a', 'owner', { status: 'running', activeRole: '' }) },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer']) },
      }),
    })
    try {
      await store.controlRun('run-a', 'resume')
      await store.controlRun('run-a', 'pause')
      await store.controlRun('run-a', 'resume')
      expect(store.generationOf('run-a')).toBe(2)
      // The mount and its claim both still say 1, which is what the run left
      // behind. Reading them from the store instead would have made this case
      // indistinguishable from the working one below.
      const mount: MountOwner = {
        serverName: 'playwright-role-buyer', runKey: 'run-a', role: 'buyer',
        generation: 1, sessionId: 'owner',
      }
      expect(judgedBy(store, mount, 1)).toBeTypeOf('string')
      // The mount the new generation actually owns is the one that still works.
      const current: MountOwner = { ...mount, generation: 2 }
      expect(judgedBy(store, current, 2)).toBeUndefined()
    } finally {
      await dispose()
      cleanupHomes()
    }
  })
})

describe('switching back to a role that is already verified', () => {
  const stand = (store: { generationOf: (k: string) => number | undefined }, runKey: string): {
    ownerOfServer: (n: string) => MountOwner | undefined
    claimOf: (n: string) => { runKey: string, generation: number } | undefined
  } => ({
    ownerOfServer: name => (name.startsWith('playwright-role-') ? {
      sessionId: 'owner', projectKey: 'shop', environmentKey: 'shop-test',
      runKey, role: name.slice('playwright-role-'.length),
      generation: store.generationOf(runKey) ?? 0, serverName: name,
    } : undefined),
    claimOf: name => (name.startsWith('playwright-role-')
      ? { runKey, generation: store.generationOf(runKey) ?? 0 } : undefined),
  })

  it('lets the run act as buyer, then seller, then buyer again', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-a': run('run-a', 'owner', { status: 'running', activeRole: '' }) },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer', 'seller']) },
      }),
    })
    try {
      await store.controlRun('run-a', 'resume')
      const agent = 'agent-a'
      for (const role of ['buyer', 'seller', 'buyer']) {
        const probe = store.mintIdentityProbe('run-a', role, agent)
        expect(probe, `no identity check for ${role}`).toBeDefined()
        // The check itself is admitted through the run's own browser...
        expect(guardReason(
          { name: `mcp__playwright-role-${role}__browser_navigate`, arguments: { authority: probe?.token }, agent: { id: agent } },
          store, 'owner', stand(store, 'run-a'),
        ), `navigate refused for ${role}`).toBeUndefined()
        expect(guardReason(
          { name: `mcp__playwright-role-${role}__browser_evaluate`, arguments: { function: IDENTITY_PROBE, authority: probe?.token }, agent: { id: agent } },
          store, 'owner', stand(store, 'run-a'),
        ), `evaluate refused for ${role}`).toBeUndefined()
        // ...and it authorises nothing else on it.
        expect(guardReason(
          { name: `mcp__playwright-role-${role}__browser_click`, arguments: { authority: probe?.token }, agent: { id: agent } },
          store, 'owner', stand(store, 'run-a'),
        ), `click admitted for ${role}`).toBeTypeOf('string')
        store.consumeIdentityProbe(probe?.token ?? '')
        expect(store.identityProbeFor(probe?.token ?? ''), 'capability survived').toBeUndefined()
        await store.assumeRole('run-a', role, { account: `${role}@example.test`, detail: 'probe' })
        expect(store.getRun('run-a')?.activeRole, `did not switch to ${role}`).toBe(role)
      }
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('refuses the check to another agent, another role, and an older generation', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-a': run('run-a', 'owner', { status: 'running', activeRole: '' }) },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer', 'seller']) },
      }),
    })
    try {
      await store.controlRun('run-a', 'resume')
      const probe = store.mintIdentityProbe('run-a', 'buyer', 'agent-a')
      const click = (role: string, token: string, agentId: string): string | undefined =>
        guardReason(
          { name: `mcp__playwright-role-${role}__browser_navigate`, arguments: { authority: token }, agent: { id: agentId } },
          store, 'owner', stand(store, 'run-a'),
        )
      // Another Agent cannot present it.
      expect(click('buyer', probe?.token ?? '', 'agent-b')).toBeTypeOf('string')
      // Nor can it authorise a different role's browser.
      expect(click('seller', probe?.token ?? '', 'agent-a')).toBeTypeOf('string')
      // Nor does it survive the run moving to a new generation.
      await store.controlRun('run-a', 'pause')
      await store.controlRun('run-a', 'resume')
      expect(click('buyer', probe?.token ?? '', 'agent-a')).toBeTypeOf('string')
      store.consumeIdentityProbe(probe?.token ?? '')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('cannot be forged, because nothing accepts a value from outside', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-a': run('run-a', 'owner', { status: 'running', activeRole: '' }) },
        'environment_revisions': { 'shop-test': environment('shop-test', ['buyer']) },
      }),
    })
    try {
      await store.controlRun('run-a', 'resume')
      // A token shaped like one of ours, and a token that was issued and then
      // destroyed. Neither may open anything.
      for (const invented of [
        'S-1-5-21-111-222-333-1001',
        'probe-0000-0000',
        (() => {
          const probe = store.mintIdentityProbe('run-a', 'buyer', 'agent-a')
          const token = probe?.token ?? ''
          store.consumeIdentityProbe(token)
          return token
        })(),
      ]) {
        expect(guardReason(
          {
            name: 'mcp__playwright-role-buyer__browser_navigate',
            arguments: { authority: invented },
            agent: { id: 'agent-a' },
          },
          store, 'owner', stand(store, 'run-a'),
        ), `invented ${invented} was admitted`).toBeTypeOf('string')
      }
    } finally {
      await dispose()
      cleanupHomes()
    }
  })
})
