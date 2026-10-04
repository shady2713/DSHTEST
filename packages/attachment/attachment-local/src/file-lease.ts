/** Kernel ownership of one canonical local file store. @module @deepseek-ai/dsh-attachment-local/file-lease */

import { mkdir, open, realpath, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'

type CreateFile = (path: string, access: number, sharing: number, security: null, creation: number, flags: number, template: null) => number
type Close = (handle: number) => number
type LastError = () => number

/** Hold exclusive kernel ownership until the local provider drains and disposes. */
export class FileStoreLease {
  private constructor(private readonly close: () => Promise<void>) {}

  /**
   * Acquire the canonical root; live contenders fail, process death releases ownership.
   * @param root - provider-owned local file root.
   * @returns the held kernel lease, without modifying filesystem permissions.
   */
  static async acquire(root: string): Promise<FileStoreLease> {
    await mkdir(root, { recursive: true })
    const path = join(await realpath(root), 'file-retention.lock')
    if (process.platform === 'win32') {
      const koffi = (await import('koffi')).default
      const kernel = koffi.load('kernel32.dll')
      const create = kernel.func('__stdcall', 'CreateFileW', 'intptr', ['str16', 'uint', 'uint', 'void*', 'uint', 'uint', 'void*']) as CreateFile
      const close = kernel.func('__stdcall', 'CloseHandle', 'int', ['intptr']) as Close
      const lastError = kernel.func('__stdcall', 'GetLastError', 'uint', []) as LastError
      // Share mode zero keeps this HANDLE exclusive even across threads in the same process.
      const handle = create(path, 0xc0000000, 0, null, 4, 0x80, null)
      if (handle === -1) {
        const error = lastError()
        throw new AttachmentError(
          error === 32 ? 'Another provider owns this file store.' : `Unable to acquire file-store ownership (Win32 ${error}).`,
          error === 32 ? 'ATTACHMENT_STORE_OWNED' : 'ATTACHMENT_WRITE_FAILED',
        )
      }
      return new FileStoreLease(() => {
        const closed = close(handle)
        if (closed === 0) throw new AttachmentError('Unable to release file-store ownership.', 'ATTACHMENT_WRITE_FAILED')
        return Promise.resolve()
      })
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const handle: FileHandle = await open(path, 'a')
      try {
        await tryLockExclusive(handle.fd)
        const held = await handle.stat({ bigint: true })
        const current = await stat(path, { bigint: true })
        if (held.ino === current.ino && held.dev === current.dev) return new FileStoreLease(() => handle.close())
      } catch (error) {
        await handle.close()
        if (error instanceof Error && 'code' in error && (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK')) {
          throw new AttachmentError('Another provider owns this file store.', 'ATTACHMENT_STORE_OWNED', { cause: error })
        }
        throw error
      }
      await handle.close()
    }
    throw new AttachmentError('The file-store lock path changed during acquisition.', 'ATTACHMENT_STORE_OWNED')
  }

  /** Close the held kernel descriptor or handle. @returns completion after ownership ends. */
  release(): Promise<void> {
    return this.close()
  }
}
