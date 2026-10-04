/**
 * The control root's single-writer claim.
 *
 * Acquiring this is the precondition for opening any authoritative domain: a
 * second writer on the same control root is refused outright rather than
 * degraded to an in-process guard, because two writers that both believe they
 * hold the root corrupt the head they both publish.
 *
 * The claim is refused on a host that has no kernel object to hold rather than
 * satisfied by something weaker. A file lock would block the reader, search, and
 * directory-removal paths the data root needs; an in-memory flag would not
 * exclude a second process at all. Neither is a substitute, so a non-Windows
 * host reports that it cannot establish the required exclusivity and the caller
 * writes nothing.
 *
 * @module @deepseek-ai/dsh-web-test-runtime/lock
 */

import { WebTestRuntimeError } from './errors.ts'
import { acquireControlSemaphore, CONTROL_CONTENTION, Win32ControlError } from './win32-control-semaphore.ts'
import type { HeldControlSemaphore } from './win32-control-semaphore.ts'

/**
 * One held control-root claim. Constructed only by {@link ControlRootLock.acquire};
 * `release` is the disposer a plugin registers, and it is idempotent so a double
 * teardown cannot restore the semaphore count twice.
 */
export class ControlRootLock {
  private released = false

  private constructor(private readonly held: HeldControlSemaphore) {}

  /**
   * Claim the control root named by `lockName`.
   * @param lockName - full kernel object name from `controlLockName`.
   * @returns the held claim.
   * @throws {WebTestRuntimeError} `control-root-locked` when another holder owns
   * the object, or `control-root-lock-unavailable` when this host cannot hold it.
   */
  static async acquire(lockName: string): Promise<ControlRootLock> {
    if (process.platform !== 'win32') {
      throw new WebTestRuntimeError(
        'web-test/control-root-lock-unavailable',
        `control lock: ${lockName} needs a Windows named kernel object, which process.platform '${process.platform}' cannot provide`,
      )
    }
    try {
      return new ControlRootLock(await acquireControlSemaphore(lockName))
    } catch (error) {
      if (error instanceof Win32ControlError) {
        throw new WebTestRuntimeError(
          error.win32Code === CONTROL_CONTENTION ? 'web-test/control-root-locked' : 'web-test/control-root-lock-unavailable',
          `control lock: cannot claim '${lockName}': ${error.message}`,
        )
      }
      throw error
    }
  }

  /**
   * Restore the semaphore count and close the handle, so the kernel object is
   * destroyed once the last holder is gone and a successor starts fresh. The
   * kernel performs the same release when a holder's process dies, which is why
   * a crash never leaves the object blocking a successor. Idempotent.
   */
  release(): void {
    if (this.released) return
    this.released = true
    this.held.release()
  }
}
