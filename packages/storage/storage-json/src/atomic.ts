/**
 * Atomic whole-file replacement for the JSON backend.
 *
 * Publish protocol: write a same-directory temp file, fsync it, then
 * `rename()` over the target. Rename is an atomic replace on POSIX and on
 * Windows (libuv maps it to `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`),
 * and replacement is the intended semantic here — unlike the session-log
 * backend's link()+unlink() no-clobber protocol, a unit file has exactly one
 * writer per process and last-write-wins is correct. After the rename the
 * parent directory is fsynced on POSIX so the new entry is crash-durable.
 *
 * Windows refuses the replacement while another process holds a handle on the
 * target that denies delete sharing, which virus scanners, indexers, and
 * backup agents all do briefly. libuv reports that refusal without saying which
 * native cause produced it, so a publish that hits a briefly held handle waits
 * and renames the same temp file again rather than failing. The retry step is
 * `renameAtomicTemp` from `@deepseek-ai/dsh-atomic-write`, which treats Windows
 * `EACCES`, `EBUSY`, and `EPERM` as transient; the retry budget is
 * configuration. The temp file is never deleted or rewritten between attempts:
 * a retry republishes the identical complete bytes, and an exhausted budget
 * reports the last refusal.
 * @module @deepseek-ai/dsh-storage-json/src/atomic
 */

import { open, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { renameAtomicTemp } from '@deepseek-ai/dsh-atomic-write'
import type { AtomicRenamePolicy } from '@deepseek-ai/dsh-atomic-write'

/**
 * The rename retry cadence `renameAtomicTemp` defines, kept under this name
 * because this backend's units, its config schema, and its tests all name the
 * publish policy `AtomicWritePolicy`, and the durable flow around it — the
 * fsync of the temp file and, on POSIX, of the parent directory — stays local.
 */
export type AtomicWritePolicy = AtomicRenamePolicy

/**
 * The Windows rename retry budget a deployment gets without configuring one.
 * `apply` passes the configured budget instead, so this is the fallback for a
 * caller that constructs a backend directly.
 */
export const SHIPPED_WINDOWS_RENAME_DELAYS_MS: readonly number[] = [20, 40, 80, 160]

/**
 * Resolve the publish cadence from the configured Windows rename delays.
 * @param windowsRenameDelaysMs - Delay in milliseconds before each retry.
 * @returns a policy that waits each delay on a real timer.
 */
export function resolveWritePolicy(windowsRenameDelaysMs: readonly number[]): AtomicWritePolicy {
  return {
    windowsRenameDelaysMs,
    wait: (delayMs: number) => new Promise(resolve => setTimeout(resolve, delayMs)),
  }
}

/**
 * Durably replace `path` with `data`.
 * @param path - Absolute target file path.
 * @param data - Full new file content.
 * @param policy - Windows rename retry cadence.
 * @returns resolution after the replacement is crash-durable.
 */
export async function writeAtomic(path: string, data: string, policy: AtomicWritePolicy): Promise<void> {
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    const handle = await open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameAtomicTemp(tmp, path, policy)
    await fsyncDirectory(dirname(path))
  } catch (primaryError) {
    try {
      await rm(tmp, { force: true })
    } catch (cleanupError) {
      // A temp file Windows still holds must not replace the publish failure
      // the caller has to act on.
      void cleanupError
    }
    throw primaryError
  }
}

/** fsync a POSIX directory so a just-renamed entry is crash-durable. */
/* v8 ignore start -- Windows rejects O_RDONLY directory opens; POSIX coverage exercises this. */
async function fsyncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/* v8 ignore stop */
