/**
 * The control-root write lock: one writer per root, a lock identity that survives
 * aliases and data-generation switches, and a refusal that is never a timeout.
 *
 * The exclusion itself is proved natively — a second `ControlRootLock` over the
 * same object name is refused by the kernel — and the identity rules are proved
 * by recomputing the name the way a second launch would. Only the cases that need
 * a real kernel object skip off Windows: the lock identity, the generation
 * pointer, and the refusal on a host with no object to hold are the same rules
 * everywhere, and the Windows-only signal is the kernel's own exclusion.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONTROL_CONTENTION } from '../src/win32-control-semaphore.ts'
import { CONTROL_POINTER_FILENAME, controlLockName, resolveDataGeneration } from '../src/control-root.ts'
import { ControlRootLock } from '../src/lock.ts'
import { cleanup, newControlRoot, startRuntime, unitBytes } from './harness.ts'
import { canonicalizeControlRoot } from '../src/control-root.ts'

afterEach(cleanup)

describe('single writer per control root', () => {
  it.skipIf(process.platform !== 'win32')('refuses a second claim on the same object and never takes it over', async () => {
    const controlRoot = await newControlRoot()
    const canonical = await canonicalizeControlRoot(controlRoot)
    const name = controlLockName(canonical)

    const holder = await ControlRootLock.acquire(name)
    try {
      await expect(ControlRootLock.acquire(name)).rejects.toMatchObject({ code: 'web-test/control-root-locked' })
      // Contention is decided by ownership, not by elapsed time: waiting well
      // past any plausible timeout changes nothing, because there is no expiry
      // that could hand a stalled writer's object to a later arrival.
      await new Promise(resolve => setTimeout(resolve, 1_500))
      await expect(ControlRootLock.acquire(name)).rejects.toMatchObject({ code: 'web-test/control-root-locked' })
    } finally {
      holder.release()
    }

    // Only after the holder lets go does the next launch own the root, and it
    // owns the same object rather than a fresh one.
    const successor = await ControlRootLock.acquire(name)
    successor.release()
  })

  it.skipIf(process.platform !== 'win32')('refuses a second Runtime before it opens any domain', async () => {
    const first = await startRuntime()
    await first.runtime.registerProject({
      commandId: 'cmd-lock-owner',
      codeRoots: ['C:\\projects\\shop'],
      entryUrls: [],
    })
    const unitBefore = (await unitBytes(first))?.toString('utf8')

    await expect(startRuntime({ controlRoot: first.controlRoot, dataRoot: first.dataRoot }))
      .rejects.toMatchObject({ code: 'web-test/control-root-locked' })
    // The refused writer never reached the medium: the document is byte-identical
    // to what the holder published, so no second write channel was opened.
    expect((await unitBytes(first))?.toString('utf8')).toBe(unitBefore)
    expect(first.runtime.listProjects()).toHaveLength(1)
    await first.stop()

    // Releasing the holder lets a later launch claim the root, still under the
    // same object name.
    const second = await startRuntime({ controlRoot: first.controlRoot, dataRoot: first.dataRoot })
    expect(second.runtime.identity().lockName).toBe(first.runtime.identity().lockName)
    expect(second.runtime.listProjects()).toHaveLength(1)
    await second.stop()
  })

  it('reports the contention code the kernel raised', () => {
    expect(CONTROL_CONTENTION).toBe(32)
  })

  it.skipIf(process.platform !== 'win32')('releases once, however many times the disposer runs', async () => {
    const controlRoot = await newControlRoot()
    const lock = await ControlRootLock.acquire(controlLockName(await canonicalizeControlRoot(controlRoot)))
    lock.release()
    // A double teardown must not restore the semaphore count a second time,
    // which would hand the object to two writers at once.
    expect(() => { lock.release() }).not.toThrow()
    const successor = await ControlRootLock.acquire(controlLockName(await canonicalizeControlRoot(controlRoot)))
    expect(() => { successor.release() }).not.toThrow()
  })

  it.skipIf(process.platform !== 'win32')('reports a lock failure that is not contention as unavailable', async () => {
    // The mapping is unit-pinned in lock.spec.ts; here the claim is that a real
    // refusal leaves the holder's data root byte-identical.
    const holder = await startRuntime()
    await holder.runtime.registerProject({
      commandId: 'cmd-lock-deny',
      codeRoots: ['C:\\projects\\shop'],
      entryUrls: [],
    })
    const before = (await unitBytes(holder))?.toString('utf8')
    await expect(startRuntime({ controlRoot: holder.controlRoot, dataRoot: holder.dataRoot }))
      .rejects.toMatchObject({ code: 'web-test/control-root-locked' })
    expect((await unitBytes(holder))?.toString('utf8')).toBe(before)
    await holder.stop()
  })

  it('refuses to write at all on a host with no kernel object to hold', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    try {
      await expect(ControlRootLock.acquire('Global\\dsh-webtest-control-probe')).rejects.toMatchObject({
        code: 'web-test/control-root-lock-unavailable',
      })
    } finally {
      if (descriptor !== undefined) Object.defineProperty(process, 'platform', descriptor)
    }
  })
})

describe('lock identity', () => {
  it('depends on nothing but the canonical control root', async () => {
    const first = await newControlRoot()
    const second = await newControlRoot()
    const firstName = controlLockName(await canonicalizeControlRoot(first))
    const secondName = controlLockName(await canonicalizeControlRoot(second))
    // Distinct data roots must not share an object, or two unrelated projects
    // would refuse each other.
    expect(firstName).not.toBe(secondName)
    expect(firstName).toMatch(/^Global\\dsh-webtest-control-[0-9a-f]{64}$/u)
    // The canonical form is case-folded, so a differently-cased spelling of one
    // directory resolves to one lock rather than two.
    expect(await canonicalizeControlRoot(first.toUpperCase())).toBe(await canonicalizeControlRoot(first))
  })

  // The alias a Windows installation actually presents is a junction, and the
  // case proves the resolved identity by booting a Runtime over it, so this is
  // the Windows form of the alias rule rather than a portable one.
  it.skipIf(process.platform !== 'win32')('resolves an alias of the control root to the same lock', async () => {
    const controlRoot = await newControlRoot()
    const aliasParent = await newControlRoot()
    const alias = join(aliasParent, 'alias')
    // A junction is the Windows form of an alias: a second path that reaches the
    // same directory. Without resolution each spelling would get its own lock
    // and two writers would run side by side.
    await symlink(controlRoot, alias, 'junction')
    const canonical = await canonicalizeControlRoot(controlRoot)
    expect(await canonicalizeControlRoot(alias)).toBe(canonical)
    expect(controlLockName(await canonicalizeControlRoot(alias))).toBe(controlLockName(canonical))

    const aliasRuntime = await startRuntime({ controlRoot: alias })
    expect(aliasRuntime.runtime.identity().controlRoot).toBe(canonical)
    expect(aliasRuntime.runtime.identity().lockName).toBe(controlLockName(canonical))
    await aliasRuntime.stop()
  })

  it('keeps the lock identity across a data-generation switch', async () => {
    const controlRoot = await newControlRoot()
    const canonical = await canonicalizeControlRoot(controlRoot)
    const first = await resolveDataGeneration(canonical)
    expect(first).toEqual({ generation: 1, dataRoot: await realpath(join(canonical, 'data', '1')) })

    // An upgrade switches the generation the pointer selects. The pointer lives
    // in the control root, so the writer's authority does not move with it.
    await mkdir(join(canonical, 'data', '2'), { recursive: true })
    await writeFile(
      join(canonical, CONTROL_POINTER_FILENAME),
      `${JSON.stringify({ generation: 2, directory: 'data/2' })}\n`,
      'utf8',
    )
    const second = await resolveDataGeneration(canonical)
    expect(second).toEqual({ generation: 2, dataRoot: await realpath(join(canonical, 'data', '2')) })
    expect(second.dataRoot).not.toBe(first.dataRoot)
    expect(controlLockName(canonical)).toBe(controlLockName(canonical))
    expect(JSON.parse(await readFile(join(canonical, CONTROL_POINTER_FILENAME), 'utf8'))).toEqual({
      generation: 2,
      directory: 'data/2',
    })
  })
})

describe('control pointer validation', () => {
  it('refuses a pointer that resolves outside the control root', async () => {
    const controlRoot = await newControlRoot()
    const canonical = await canonicalizeControlRoot(controlRoot)
    await writeFile(
      join(canonical, CONTROL_POINTER_FILENAME),
      `${JSON.stringify({ generation: 9, directory: '../escape' })}\n`,
      'utf8',
    )
    await expect(resolveDataGeneration(canonical)).rejects.toThrow(/resolves outside it/u)
  })

  it('refuses a pointer that is not a data-generation pointer', async () => {
    const controlRoot = await newControlRoot()
    const canonical = await canonicalizeControlRoot(controlRoot)
    await writeFile(join(canonical, CONTROL_POINTER_FILENAME), 'not json at all', 'utf8')
    await expect(resolveDataGeneration(canonical)).rejects.toThrow(/is not JSON/u)
    await writeFile(join(canonical, CONTROL_POINTER_FILENAME), '{"generation":0,"directory":"data/0"}', 'utf8')
    await expect(resolveDataGeneration(canonical)).rejects.toThrow(/is not a data-generation pointer/u)
  })

  it('surfaces a pointer it cannot read', async () => {
    const controlRoot = await newControlRoot()
    const canonical = await canonicalizeControlRoot(controlRoot)
    // A directory where the pointer file belongs is neither absent nor a
    // pointer, and it is not silently treated as a fresh root.
    await mkdir(join(canonical, CONTROL_POINTER_FILENAME), { recursive: true })
    await expect(resolveDataGeneration(canonical)).rejects.toThrow()
  })
})
