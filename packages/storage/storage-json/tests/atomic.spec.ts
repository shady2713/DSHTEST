/**
 * Atomic publish under Windows rename refusals.
 *
 * The refusal is injected where a real one comes from — `rename()` itself —
 * and every case checks the whole publish, not just the loop: the temp file
 * the helper wrote is still the rename source on each attempt, the target
 * keeps the old bytes until a rename actually lands, and the caller's error is
 * the last refusal rather than the first.
 *
 * The Windows-only case takes no injection at all. It holds a real
 * `CreateFileW` handle on the target denying delete sharing, so the refusal is
 * the medium's own, and the assertions run inside the failing rename.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeAtomic, resolveWritePolicy } from '../src/atomic.ts'
import type { AtomicWritePolicy } from '../src/atomic.ts'
import { Config } from '../src/index.ts'
import { closeExclusive, openExclusive } from './exclusive-handle.ts'

/** One rename the helper attempted, as the wrapper saw it. */
interface RenameAttempt {
  from: string
  to: string
}

/** What `rename()` throws on Windows: `NodeJS.ErrnoException` plus the destination. */
interface RenameError extends NodeJS.ErrnoException {
  dest: string
}

const state = vi.hoisted(() => ({
  attempts: [] as RenameAttempt[],
  injected: [] as RenameError[],
  failures: [] as string[],
  onRefusal: undefined as ((error: RenameError) => Promise<void>) | undefined,
  tempRemovalFails: false,
  waits: [] as number[],
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      state.attempts.push({ from: String(args[0]), to: String(args[1]) })
      const code = state.failures.shift()
      if (code !== undefined) {
        const error = Object.assign(new Error(`${code}: injected rename failure`), {
          code,
          syscall: 'rename',
          path: String(args[0]),
          dest: String(args[1]),
        })
        state.injected.push(error)
        throw error
      }
      try {
        await actual.rename(...args)
      } catch (error) {
        await state.onRefusal?.(error as RenameError)
        throw error
      }
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (state.tempRemovalFails && String(args[0]).endsWith('.tmp')) {
        throw Object.assign(new Error('EBUSY: injected temp removal failure'), { code: 'EBUSY' })
      }
      await actual.rm(...args)
    },
  }
})

const scratchDirs: string[] = []
const platform = Object.getOwnPropertyDescriptor(process, 'platform')

/** Fail the next `count` renames with `code`, and record the errors thrown. */
function failRenames(codes: string[]): void {
  state.failures.push(...codes)
}

afterEach(async () => {
  if (platform !== undefined) Object.defineProperty(process, 'platform', platform)
  state.attempts.length = 0
  state.injected.length = 0
  state.failures.length = 0
  state.onRefusal = undefined
  state.tempRemovalFails = false
  state.waits.length = 0
  await Promise.all(scratchDirs.splice(0).map(dir => rm(dir, { force: true, maxRetries: 10, recursive: true, retryDelay: 20 })))
})

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-storage-json-atomic-'))
  scratchDirs.push(dir)
  return dir
}

/**
 * A policy that records each wait instead of performing it, so the case
 * asserts the cadence the helper chose without spending its time.
 */
function recordingPolicy(delays: readonly number[]): AtomicWritePolicy {
  return {
    windowsRenameDelaysMs: delays,
    wait: async (delayMs: number) => { state.waits.push(delayMs) },
  }
}

/** The one temp file every attempt must rename; fails the case when attempts disagree. */
function singleTemp(): string {
  const sources = new Set(state.attempts.map(attempt => attempt.from))
  expect([...sources]).toHaveLength(1)
  return [...sources][0] as string
}

describe('atomic publish rename retry', () => {
  it('defaults the Windows rename delays to four retries', () => {
    expect(Config({ root: 'C:/data' })).toMatchObject({ windowsRenameDelaysMs: [20, 40, 80, 160] })
  })

  it('keeps one temp file across attempts and publishes once a refusal stops', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const dir = await scratch()
    const target = join(dir, 'unit.json')
    await writeFile(target, 'old', 'utf8')
    failRenames(['EPERM', 'EPERM', 'EPERM'])

    await writeAtomic(target, 'new', recordingPolicy([20, 40, 80, 160]))

    const tmp = singleTemp()
    expect(state.attempts.map(attempt => attempt.to)).toEqual([target, target, target, target])
    expect(state.waits).toEqual([20, 40, 80])
    // The refusal left the target alone; the rename that landed replaced it,
    // and the temp file it renamed is gone.
    expect(await readFile(target, 'utf8')).toBe('new')
    await expect(readFile(tmp, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('makes five attempts and four waits, then throws the last refusal', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const dir = await scratch()
    const target = join(dir, 'unit.json')
    await writeFile(target, 'old', 'utf8')
    // EBUSY and EPERM are both refusals, and the caller receives the one that
    // spent the budget rather than the earliest one.
    failRenames(['EPERM', 'EBUSY', 'EBUSY', 'EPERM', 'EBUSY'])

    const caught = await writeAtomic(target, 'new', recordingPolicy([20, 40, 80, 160])).then(
      () => { throw new Error('the publish resolved although every rename was refused') },
      (error: unknown) => error,
    )

    expect(state.attempts).toHaveLength(5)
    expect(state.waits).toEqual([20, 40, 80, 160])
    expect(caught).toBe(state.injected[4])
    expect(await readFile(target, 'utf8')).toBe('old')
    await expect(readFile(singleTemp(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retries an EACCES refusal the shared rename step treats as transient', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const dir = await scratch()
    const target = join(dir, 'unit.json')
    await writeFile(target, 'old', 'utf8')
    failRenames(['EACCES', 'EACCES'])

    await writeAtomic(target, 'new', recordingPolicy([20, 40, 80, 160]))

    expect(state.attempts).toHaveLength(3)
    expect(state.waits).toEqual([20, 40])
    expect(await readFile(target, 'utf8')).toBe('new')
  })

  it('throws a terminal failure that appears mid-sequence instead of the earlier refusal', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const dir = await scratch()
    const target = join(dir, 'unit.json')
    await writeFile(target, 'old', 'utf8')
    failRenames(['EPERM', 'EPERM', 'ENOSPC'])

    const caught = await writeAtomic(target, 'new', recordingPolicy([20, 40, 80, 160])).then(
      () => { throw new Error('the publish resolved although the last rename failed') },
      (error: unknown) => error,
    )

    expect(state.attempts).toHaveLength(3)
    expect(state.waits).toEqual([20, 40])
    expect(caught).toBe(state.injected[2])
    expect(await readFile(target, 'utf8')).toBe('old')
  })

  it('refuses immediately for a code outside the Windows contention set', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const dir = await scratch()
    const target = join(dir, 'unit.json')
    await writeFile(target, 'old', 'utf8')
    failRenames(['ENOSPC'])

    const caught = await writeAtomic(target, 'new', recordingPolicy([20, 40, 80, 160])).then(
      () => { throw new Error('the publish resolved although the rename failed') },
      (error: unknown) => error,
    )

    expect(state.attempts).toHaveLength(1)
    expect(state.waits).toEqual([])
    expect(caught).toBe(state.injected[0])
  })

  it('refuses immediately for a contention code off Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    const dir = await scratch()
    const target = join(dir, 'unit.json')
    await writeFile(target, 'old', 'utf8')
    failRenames(['EPERM'])

    const caught = await writeAtomic(target, 'new', recordingPolicy([20, 40, 80, 160])).then(
      () => { throw new Error('the publish resolved although the rename failed') },
      (error: unknown) => error,
    )

    expect(state.attempts).toHaveLength(1)
    expect(state.waits).toEqual([])
    expect(caught).toBe(state.injected[0])
  })

  it('publishes on the first attempt when no delay is configured', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const dir = await scratch()
    const target = join(dir, 'unit.json')
    await writeFile(target, 'old', 'utf8')
    failRenames(['EBUSY'])

    const caught = await writeAtomic(target, 'new', recordingPolicy([])).then(
      () => { throw new Error('the publish resolved although the rename failed') },
      (error: unknown) => error,
    )

    expect(state.attempts).toHaveLength(1)
    expect(state.waits).toEqual([])
    expect(caught).toBe(state.injected[0])
  })

  it('keeps the publish failure when removing the temp file also fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const dir = await scratch()
    const target = join(dir, 'unit.json')
    await writeFile(target, 'old', 'utf8')
    failRenames(['ENOSPC'])
    state.tempRemovalFails = true

    const caught = await writeAtomic(target, 'new', recordingPolicy([20, 40, 80, 160])).then(
      () => { throw new Error('the publish resolved although the rename failed') },
      (error: unknown) => error,
    )

    expect(caught).toBe(state.injected[0])
  })
})

describe.skipIf(process.platform !== 'win32')('atomic publish under a real held handle', () => {
  it('repairs a refusal caused by a handle that releases, without losing the bytes', async () => {
    const dir = await scratch()
    const target = join(dir, 'unit.json')
    await writeFile(target, 'old', 'utf8')
    // Registered before anything else can fail, so a failed assertion still
    // releases the handle instead of leaking it into the rest of the run.
    let handle: number | undefined = openExclusive(target)
    let observed = false
    state.onRefusal = async (error) => {
      if (observed) return
      observed = true
      const attempt = state.attempts[0] as RenameAttempt
      expect(error.syscall).toBe('rename')
      expect(['EPERM', 'EBUSY']).toContain(error.code)
      expect(error.path).toBe(attempt.from)
      expect(error.dest).toBe(attempt.to)
      // A refused rename changed nothing: the target still holds the old
      // bytes, and the temp file the helper wrote is still the rename source
      // with the complete new bytes in it.
      expect(await readFile(target, 'utf8')).toBe('old')
      expect(await readFile(attempt.from, 'utf8')).toBe('new')
      closeExclusive(handle as number)
      handle = undefined
    }

    try {
      await writeAtomic(target, 'new', resolveWritePolicy([20, 40, 80, 160]))
      expect(observed).toBe(true)
      expect(state.attempts.length).toBeGreaterThan(1)
      const tmp = singleTemp()
      expect(await readFile(target, 'utf8')).toBe('new')
      await expect(readFile(tmp, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readdir(dir)).toEqual(['unit.json'])
    } finally {
      if (handle !== undefined) closeExclusive(handle)
    }
  })
})
