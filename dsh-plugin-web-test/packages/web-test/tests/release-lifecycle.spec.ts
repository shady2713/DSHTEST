/**
 * Releasing role browsers, tested against `releaseAll` and `releaseRun`
 * themselves.
 *
 * These run on a pool whose parent context stays alive for the whole test. A
 * release that only works because the context is on its way out proves nothing:
 * the parent would dispose the fibers anyway, so a broken `releaseAll` would
 * look correct.
 *
 * @module dsh-plugin-web-test/tests/release-lifecycle
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  RoleBrowserPool,
  disposeAll,
  mountKeysOfRun,
  allMountKeys,
  namespaceFor,
  recordMount,
  detachMount,
  restoreMount,
} from '../src/role-browser.ts'
import type { MountOwner } from '../src/role-browser.ts'

/**
 * A pool with recording disposers filed under the keys `mounts` holds.
 *
 * The workspace cannot import the browser provider, so a real mount never
 * happens here. The disposers are what `releaseAll` and `releaseRun` act on, and
 * recording them is enough to show which handles each call reaches.
 */
describe('releasing role browsers', () => {
  it('releaseAll on a pool with nothing mounted resolves, and repeats', async () => {
    const context = new Context()
    const pool = new RoleBrowserPool(context, '/usr/bin/chrome', true)
    await expect(pool.releaseAll()).resolves.toBeUndefined()
    await expect(pool.releaseAll()).resolves.toBeUndefined()
    expect(pool.list()).toEqual([])
  })

  it('releaseRun for a run that owns nothing resolves', async () => {
    const context = new Context()
    const pool = new RoleBrowserPool(context, '/usr/bin/chrome', true)
    await expect(pool.releaseRun('run-nobody')).resolves.toBeUndefined()
    expect(pool.list()).toEqual([])
  })
})

/** One mounted browser's owner. */
function owner(run: string, role: string, generation = 1, sessionId = 's1'): MountOwner {
  return {
    sessionId,
    projectKey: 'shop',
    environmentKey: 'env',
    runKey: run,
    role,
    generation,
    serverName: `playwright-role-${role}`,
  }
}


describe('choosing which mounts a release reaches', () => {
  it('reaches both runs that declared the same role', () => {
    // The Windows finding: run A verified `buyer`, run C started another `buyer`
    // browser, and cancelling C left C's browser running. A release that selects
    // by role name reaches one mount, not both.
    const owners = [owner('run-a', 'buyer'), owner('run-c', 'buyer')]
    expect(mountKeysOfRun(owners, 'run-c')).toHaveLength(1)
    expect(mountKeysOfRun(owners, 'run-c')[0]).toContain('run-c')
    expect(allMountKeys(owners)).toHaveLength(2)
  })

  it('gives the same answer whatever order the mounts are listed in', () => {
    const a = owner('run-a', 'buyer')
    const b = owner('run-b', 'approver')
    const c = owner('run-c', 'buyer')
    expect(mountKeysOfRun([a, b, c], 'run-c')).toEqual(mountKeysOfRun([c, b, a], 'run-c'))
    expect(allMountKeys([a, b, c]).sort()).toEqual(allMountKeys([c, b, a]).sort())
  })

  it('releases nothing for a run that owns no mount', () => {
    const owners = [owner('run-a', 'buyer'), owner('run-b', 'approver')]
    expect(mountKeysOfRun(owners, 'run-nobody')).toEqual([])
  })

  it('treats a later generation of the same run and role as one mount', () => {
    // A generation is a restart of the run, not a second browser: the earlier
    // mount is released before the new one is filed, so they share a key and a
    // release reaches whichever is live.
    const owners = [
      owner('run-a', 'buyer', 1, 'session-1'),
      owner('run-a', 'buyer', 2, 'session-1'),
    ]
    expect(allMountKeys(owners)).toHaveLength(1)
  })
})

describe('sweeping disposers', () => {
  it('closes every handle even when one refuses, and reports only the refusals', async () => {
    // The Windows finding: one browser refusing to close must not leave the rest
    // running, and must not be reported as a clean release.
    const closed: string[] = []
    const dispose = async (key: string): Promise<void> => {
      if (key === 'stuck') throw new Error(`web-test: ${key} refused to close`)
      closed.push(key)
    }
    const failures = await disposeAll(dispose, ['first', 'stuck', 'last'])
    expect(closed).toEqual(['first', 'last'])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('stuck refused to close')
  })

  it('retries a refused handle on the next sweep', async () => {
    let stuck = true
    const dispose = async (key: string): Promise<void> => {
      if (key === 'stuck' && stuck) throw new Error('web-test: still open')
      return undefined
    }
    expect(await disposeAll(dispose, ['stuck'])).toHaveLength(1)
    stuck = false
    expect(await disposeAll(dispose, ['stuck'])).toEqual([])
  })

  it('reports nothing when every handle closed', async () => {
    expect(await disposeAll(async () => undefined, ['a', 'b'])).toEqual([])
  })
})

describe('reading an identity', () => {
  it('reads each run through its own mount when both declare the same role', () => {
    // Run A verified `buyer`; run C then started a second `buyer` browser and
    // confirmed its identity. Reading whichever started last would confirm C
    // against A's browser, or A against C's.
    const a = owner('run-a', 'buyer')
    const c = owner('run-c', 'buyer')
    const started = new Map([
      [RoleBrowserPool.keyOf(a), { role: 'buyer', serverName: 'playwright-role-buyer', toolNames: [] }],
      [RoleBrowserPool.keyOf(c), { role: 'buyer', serverName: 'playwright-role-buyer-g2', toolNames: [] }],
    ])
    expect(namespaceFor(started, a)).toBe('mcp__playwright-role-buyer__')
    expect(namespaceFor(started, c)).toBe('mcp__playwright-role-buyer-g2__')
  })

  it('falls back to the role name when that owner has no mount yet', () => {
    expect(namespaceFor(new Map(), owner('run-c', 'buyer')))
      .toBe('mcp__playwright-role-buyer__')
  })
})

describe('claiming a mount', () => {
  it('claims the run at mount time, before any identity is confirmed', () => {
    // The Windows finding: `assume_role` reads the identity through the plugin's
    // own guard, and that read was refused because the claim only appeared once
    // verification had already succeeded.
    const started = new Map<string, { role: string, serverName: string, toolNames: readonly string[] }>()
    const owners = new Map()
    const claims = new Map()
    const c = owner('run-c', 'buyer', 3, 'session-1')
    const browser = { role: 'buyer', serverName: 'playwright-role-buyer', toolNames: [] }
    recordMount(started, owners, claims, RoleBrowserPool.keyOf(c), c, browser)
    expect(claims.get('playwright-role-buyer'))
      .toEqual({ runKey: 'run-c', generation: 3 })
    expect(owners.get('playwright-role-buyer')?.runKey).toBe('run-c')
  })

  it('gives each same-role mount its own claim instead of overwriting one', () => {
    const started = new Map<string, { role: string, serverName: string, toolNames: readonly string[] }>()
    const owners = new Map()
    const claims = new Map()
    const a = owner('run-a', 'buyer')
    const c = owner('run-c', 'buyer')
    recordMount(started, owners, claims, RoleBrowserPool.keyOf(a),
      a, { role: 'buyer', serverName: 'playwright-role-buyer', toolNames: [] })
    recordMount(started, owners, claims, RoleBrowserPool.keyOf(c),
      c, { role: 'buyer', serverName: 'playwright-role-buyer-g2', toolNames: [] })
    expect(claims.get('playwright-role-buyer')?.runKey).toBe('run-a')
    expect(claims.get('playwright-role-buyer-g2')?.runKey).toBe('run-c')
  })
})

describe('releasing one mount', () => {
  it('stops tracking the mount and hands back its disposer', () => {
    const started = new Map<string, { role: string, serverName: string, toolNames: readonly string[] }>()
    const owners = new Map()
    const claims = new Map()
    const keysByRole = new Map<string, Set<string>>()
    const c = owner('run-c', 'buyer')
    const key = RoleBrowserPool.keyOf(c)
    const calls: string[] = []
    recordMount(started, owners, claims, key, c,
      { role: 'buyer', serverName: 'playwright-role-buyer', toolNames: [] })
    keysByRole.set('buyer', new Set([key]))

    const detached = detachMount(
      new Map([[key, async () => { calls.push('closed') }]]),
      started, owners, claims, keysByRole, key,
    )
    expect(detached.browser?.role).toBe('buyer')
    expect(detached.owner?.runKey).toBe('run-c')
    expect(started.has(key)).toBe(false)
    expect(owners.has('playwright-role-buyer')).toBe(false)
    expect(claims.has('playwright-role-buyer')).toBe(false)
    expect(keysByRole.has('buyer')).toBe(false)
  })

  it('puts a refused mount back, so a later release still finds it', () => {
    const started = new Map<string, { role: string, serverName: string, toolNames: readonly string[] }>()
    const owners = new Map()
    const claims = new Map()
    const keysByRole = new Map<string, Set<string>>()
    const c = owner('run-c', 'buyer')
    const key = RoleBrowserPool.keyOf(c)
    recordMount(started, owners, claims, key, c,
      { role: 'buyer', serverName: 'playwright-role-buyer', toolNames: [] })
    keysByRole.set('buyer', new Set([key]))

    const mounts = new Map([[key, async () => { throw new Error('refused') }]])
    const detached = detachMount(mounts, started, owners, claims, keysByRole, key)
    restoreMount(mounts, started, owners, keysByRole, key, detached)

    // Everything the next release needs is back: the handle, the mount, the owner.
    expect(mounts.has(key)).toBe(true)
    expect(started.has(key)).toBe(true)
    expect(owners.get('playwright-role-buyer')?.runKey).toBe('run-c')
    expect([...keysByRole.get('buyer') ?? []]).toEqual([key])
  })
})

describe('releaseAll reaches every disposer', () => {
  it('closes mounts whose key is a composite, not a role name', async () => {
    // The 0.8.0 defect: `releaseAll` walked the mount keys and handed each one
    // to `releaseRole`, which looks the key up in `keysByRole` and finds nothing,
    // so every disposer was left uncalled. A pool with one mount must end empty.
    const pool = new RoleBrowserPool(new Context(), '/usr/bin/chrome', true)
    const owner = {
      projectKey: 'shop', environmentKey: 'acc', runKey: 'run-a',
      role: 'buyer', generation: 1, sessionId: 's1', serverName: 'playwright-role-buyer',
    }
    let closed = 0
    pool.mounts.set(RoleBrowserPool.keyOf(owner), async () => { closed += 1 })

    await pool.releaseAll()

    expect(closed).toBe(1)
    expect(pool.mounts.size).toBe(0)
  })

  it('closes them all even when one disposer refuses', async () => {
    const pool = new RoleBrowserPool(new Context(), '/usr/bin/chrome', true)
    const base = {
      projectKey: 'shop', environmentKey: 'acc', generation: 1,
      sessionId: 's1', serverName: 'playwright-role-buyer',
    }
    let good = 0
    pool.mounts.set(RoleBrowserPool.keyOf({ ...base, runKey: 'run-a', role: 'buyer' }),
      async () => { throw new Error('refused') })
    pool.mounts.set(RoleBrowserPool.keyOf({ ...base, runKey: 'run-b', role: 'buyer' }),
      async () => { good += 1 })

    await expect(pool.releaseAll()).rejects.toThrow('not every role browser closed')
    expect(good).toBe(1)
    expect(pool.mounts.has(RoleBrowserPool.keyOf({ ...base, runKey: 'run-a', role: 'buyer' }))).toBe(true)
  })
})

describe('releaseRun reaches only that run’s disposers', () => {
  it('closes the run it was asked about and leaves the other run mounted', async () => {
    // The 0.8.0 defect: the run's targets were read from the claim index, whose
    // entries are server names, and those were then handed to `releaseRole`,
    // which looks a role name up in `keysByRole`. Nothing matched, so a cancel
    // released nothing while a later, unrelated cancel closed the leftover.
    const pool = new RoleBrowserPool(new Context(), '/usr/bin/chrome', true)
    const base = {
      projectKey: 'shop', environmentKey: 'acc', generation: 1, sessionId: 's1',
    }
    let closedA = 0
    let closedB = 0
    const a = { ...base, runKey: 'run-a', role: 'buyer', serverName: 'playwright-role-buyer' }
    const b = { ...base, runKey: 'run-b', role: 'buyer', serverName: 'playwright-role-buyer-g2' }
    recordMount(pool.started, pool.owners, pool.claims, RoleBrowserPool.keyOf(a), a,
      { role: 'buyer', serverName: a.serverName, toolNames: [] })
    recordMount(pool.started, pool.owners, pool.claims, RoleBrowserPool.keyOf(b), b,
      { role: 'buyer', serverName: b.serverName, toolNames: [] })
    pool.mounts.set(RoleBrowserPool.keyOf(a), async () => { closedA += 1 })
    pool.mounts.set(RoleBrowserPool.keyOf(b), async () => { closedB += 1 })

    await pool.releaseRun('run-a')

    expect(closedA).toBe(1)
    expect(closedB).toBe(0)
    expect(pool.mounts.has(RoleBrowserPool.keyOf(b))).toBe(true)
    expect(pool.owners.has(b.serverName)).toBe(true)
  })
})

describe('releaseRole clears what it released', () => {
  it('drops the claim and the mount of every key the role holds', async () => {
    // `releaseRole` used to delete the `started` rows and then read them, so the
    // browser it looked for was always gone and every claim of that role stayed
    // behind for the next `ensure` to pick up.
    const pool = new RoleBrowserPool(new Context(), '/usr/bin/chrome', true)
    const base = {
      projectKey: 'shop', environmentKey: 'acc', generation: 1, sessionId: 's1', role: 'buyer',
    }
    const keys = [
      { ...base, runKey: 'run-a', serverName: 'playwright-role-buyer' },
      { ...base, runKey: 'run-b', serverName: 'playwright-role-buyer-g2' },
    ].map((o) => {
      recordMount(pool.started, pool.owners, pool.claims, RoleBrowserPool.keyOf(o), o,
        { role: 'buyer', serverName: o.serverName, toolNames: [] })
      pool.mounts.set(RoleBrowserPool.keyOf(o), async () => {})
      pool.addKeyForRole('buyer', RoleBrowserPool.keyOf(o))
      return RoleBrowserPool.keyOf(o)
    })

    await pool.releaseRole('buyer')

    expect(pool.claims.size).toBe(0)
    expect(pool.started.size).toBe(0)
    expect(pool.mounts.size).toBe(0)
    expect(pool.owners.size).toBe(0)
    expect(keys.every(key => !pool.keysByRole.get('buyer')?.has(key))).toBe(true)
  })
})

describe('a release that arrives while the mount is starting', () => {
  it('reaches the in-flight mount and leaves a mark for it to consume', async () => {
    // `releaseRun` picked its targets from the owners alone, and a mount that has
    // not finished has no owner row yet. The release therefore found nothing, and
    // the browser the start then completed stayed up for a cancelled run.
    const pool = new RoleBrowserPool(new Context(), '/usr/bin/chrome', true)
    const inFlight = {
      projectKey: 'shop', environmentKey: 'acc', runKey: 'run-c',
      role: 'buyer', generation: 1, sessionId: 's1', serverName: 'playwright-role-buyer',
    }
    const key = RoleBrowserPool.keyOf(inFlight)
    const pending = Reflect.get(pool, 'pending') as Map<
      string, { settled: Promise<unknown>, owner: typeof inFlight }
    >
    pending.set(key, { settled: Promise.resolve(inFlight), owner: inFlight })

    await pool.releaseRun('run-c')

    const abandoned = Reflect.get(pool, 'abandoned') as Set<string>
    expect(abandoned.has(key)).toBe(true)
    // Consumed exactly once, so it cannot fire against a later mount of this key.
    expect(abandoned.delete(key)).toBe(true)
    expect(abandoned.has(key)).toBe(false)
  })
})

describe('adopting a browser the environment mounted first', () => {
  it('re-files the owner so later calls are not compared to the empty run', async () => {
    // `putEnvironment` mounts with no run, so the first `assume_role` adopts that
    // mount instead of starting a second one. Adoption returns before it mounts,
    // so this path runs without a browser provider.
    const pool = new RoleBrowserPool(new Context(), '/usr/bin/chrome', true)
    const preStart = {
      projectKey: 'shop', environmentKey: 'acc', runKey: '', role: 'buyer',
      generation: 0, sessionId: '', serverName: 'playwright-role-buyer',
    }
    const browser = { role: 'buyer', serverName: preStart.serverName, toolNames: [] }
    recordMount(pool.started, pool.owners, pool.claims, RoleBrowserPool.keyOf(preStart), preStart, browser)
    pool.mounts.set(RoleBrowserPool.keyOf(preStart), async () => {})
    pool.addKeyForRole('buyer', RoleBrowserPool.keyOf(preStart))

    const run = { ...preStart, runKey: 'run-a', generation: 1, sessionId: 's1' }
    const adopted = await pool.ensure(run)

    expect(adopted.serverName).toBe(preStart.serverName)
    // The owner has to name the run, or the credential is compared against `''`.
    expect(pool.owners.get(preStart.serverName)?.runKey).toBe('run-a')
    expect(pool.claims.get(preStart.serverName)?.runKey).toBe('run-a')
    // And a cancel has to be able to select it.
    expect(pool.ownerOfServer(preStart.serverName)?.sessionId).toBe('s1')
  })
})
