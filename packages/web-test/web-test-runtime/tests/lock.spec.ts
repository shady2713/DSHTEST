/**
 * How a control-root acquisition failure is reported.
 *
 * The distinction matters to a caller: `control-root-locked` means a live writer
 * holds the root and the right response is to wait for it to exit, while
 * `control-root-lock-unavailable` means this writer never got an object at all
 * and must not open a write channel. Anything the platform layer raises that is
 * neither is passed through unchanged rather than reclassified. The mapping is
 * host-independent, so this suite runs everywhere with the platform pinned to
 * the one whose kernel object the mapping classifies.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Win32ControlError } from '../src/win32-control-semaphore.ts'

afterEach(() => {
  vi.doUnmock('../src/win32-control-semaphore.ts')
  vi.resetModules()
})

/**
 * Report `process.platform` as Windows for the duration of one call.
 *
 * The claim refuses on a host with no kernel object to hold before it ever asks
 * the platform layer, so pinning the platform is what lets the mapping below be
 * pinned on a host that has no real object to contend for.
 * @param call - the claim to attempt.
 * @returns whatever the claim resolves with.
 */
async function asWindows<T>(call: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  try {
    return await call()
  } finally {
    if (descriptor !== undefined) Object.defineProperty(process, 'platform', descriptor)
  }
}

/**
 * Load a fresh `ControlRootLock` whose kernel acquisition is replaced.
 * @param outcome - what the kernel layer does with the request.
 * @returns the claim class and the name it was asked for.
 */
async function lockWithAcquisition(outcome: 'contended' | 'denied' | 'explode'): Promise<{
  ControlRootLock: typeof import('../src/lock.ts').ControlRootLock
  requested: string[]
}> {
  const requested: string[] = []
  vi.doMock('../src/win32-control-semaphore.ts', async () => {
    const actual = await vi.importActual<typeof import('../src/win32-control-semaphore.ts')>(
      '../src/win32-control-semaphore.ts',
    )
    return {
      ...actual,
      acquireControlSemaphore: (name: string) => {
        requested.push(name)
        if (outcome === 'contended') return Promise.reject(new actual.Win32ControlError('WaitForSingleObject', 32, name))
        if (outcome === 'denied') return Promise.reject(new actual.Win32ControlError('CreateSemaphoreW', 5, name))
        return Promise.reject(new TypeError('the platform layer failed in an unexpected way'))
      },
    }
  })
  vi.resetModules()
  return { ControlRootLock: (await import('../src/lock.ts')).ControlRootLock, requested }
}

describe('acquisition failure mapping', () => {
  it('names contention as a locked root', async () => {
    const { ControlRootLock: claim, requested } = await lockWithAcquisition('contended')
    await expect(asWindows(() => claim.acquire('Global\\dsh-webtest-control-a'))).rejects.toMatchObject({
      code: 'web-test/control-root-locked',
    })
    expect(requested).toEqual(['Global\\dsh-webtest-control-a'])
  })

  it('names any other kernel refusal as an unavailable lock', async () => {
    // A name another principal pre-created with a DACL this writer does not
    // satisfy surfaces as access denied, which is not contention and must not be
    // reported as a live writer holding the root.
    const { ControlRootLock: claim } = await lockWithAcquisition('denied')
    await expect(asWindows(() => claim.acquire('Global\\dsh-webtest-control-b'))).rejects.toMatchObject({
      code: 'web-test/control-root-lock-unavailable',
    })
  })

  it('passes an unexpected platform failure through unchanged', async () => {
    const { ControlRootLock: claim } = await lockWithAcquisition('explode')
    // Reclassifying a bug as a lock conflict would send a caller into a wait it
    // can never leave, so the original failure keeps its own identity.
    await expect(asWindows(() => claim.acquire('Global\\dsh-webtest-control-c'))).rejects.toBeInstanceOf(TypeError)
  })

  it('exposes the kernel error it maps', () => {
    const error = new Win32ControlError('CreateSemaphoreW', 5, 'Global\\dsh-webtest-control-d')
    expect(error).toMatchObject({ syscall: 'CreateSemaphoreW', win32Code: 5, subject: 'Global\\dsh-webtest-control-d' })
    expect(error.message).toBe(
      'control lock: CreateSemaphoreW failed with Win32 5 (Global\\dsh-webtest-control-d)',
    )
  })
})
