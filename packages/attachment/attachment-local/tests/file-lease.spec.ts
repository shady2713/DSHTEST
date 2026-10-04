import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileStoreLease } from '../src/file-lease.ts'

const kernel = vi.hoisted(() => ({
  create: vi.fn(), close: vi.fn(), lastError: vi.fn(), flock: vi.fn(),
  handleClose: vi.fn(), handleStat: vi.fn(), pathStat: vi.fn(),
}))
vi.mock('koffi', () => ({ default: { load: () => ({
  func: (_convention: string, name: string) => ({
    CreateFileW: kernel.create, CloseHandle: kernel.close, GetLastError: kernel.lastError,
  })[name],
}) } }))
vi.mock('@deepseek-ai/node-addon-system/flock', () => ({ tryLockExclusive: kernel.flock }))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined), realpath: vi.fn().mockResolvedValue('/canonical-store'),
  open: vi.fn().mockImplementation(() => Promise.resolve({ fd: 14, close: kernel.handleClose, stat: kernel.handleStat })),
  stat: kernel.pathStat,
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => {
  vi.clearAllMocks()
  for (const mock of Object.values(kernel)) mock.mockReset()
  kernel.create.mockReturnValue(99)
  kernel.close.mockReturnValue(1)
  kernel.handleClose.mockResolvedValue(undefined)
  kernel.flock.mockResolvedValue(undefined)
  kernel.handleStat.mockResolvedValue({ ino: 3n, dev: 4n })
  kernel.pathStat.mockResolvedValue({ ino: 3n, dev: 4n })
})
afterEach(() => { Object.defineProperty(process, 'platform', platform) })

function selectPlatform(value: 'win32' | 'linux'): void {
  Object.defineProperty(process, 'platform', { ...platform, value })
}

describe('canonical store kernel ownership', () => {
  it('opens a Windows handle with exclusive sharing and closes the exact handle', async () => {
    selectPlatform('win32')
    const lease = await FileStoreLease.acquire('/store')
    expect(kernel.create).toHaveBeenCalledWith(expect.stringContaining('file-retention.lock'), 0xc0000000, 0, null, 4, 0x80, null)
    await lease.release()
    expect(kernel.close).toHaveBeenCalledWith(99)
  })

  it.each([32, 5])('reports Windows acquisition error %s without publishing a lease', async (code) => {
    selectPlatform('win32')
    kernel.create.mockReturnValue(-1)
    kernel.lastError.mockReturnValue(code)
    await expect(FileStoreLease.acquire('/store')).rejects.toMatchObject({
      code: code === 32 ? 'ATTACHMENT_STORE_OWNED' : 'ATTACHMENT_WRITE_FAILED',
    })
    expect(kernel.close).not.toHaveBeenCalled()
  })

  it('reports a Windows close failure', async () => {
    selectPlatform('win32')
    const lease = await FileStoreLease.acquire('/store')
    kernel.close.mockReturnValue(0)
    expect(() => lease.release()).toThrow('Unable to release')
  })

  it('locks the POSIX descriptor and closes it after identity verification', async () => {
    selectPlatform('linux')
    const lease = await FileStoreLease.acquire('/store')
    expect(kernel.flock).toHaveBeenCalledWith(14)
    await lease.release()
    expect(kernel.handleClose).toHaveBeenCalledOnce()
  })

  it.each(['EAGAIN', 'EWOULDBLOCK'])('closes a contending POSIX descriptor for %s', async (code) => {
    selectPlatform('linux')
    kernel.flock.mockRejectedValue(Object.assign(new Error('contended'), { code }))
    await expect(FileStoreLease.acquire('/store')).rejects.toMatchObject({ code: 'ATTACHMENT_STORE_OWNED' })
    expect(kernel.handleClose).toHaveBeenCalledOnce()
  })

  it.each([new Error('lock syscall failed'), Object.assign(new Error('permission denied'), { code: 'EACCES' }), 'native failure'])
  ('preserves a POSIX acquisition failure after closing its descriptor: %s', async (error) => {
    selectPlatform('linux')
    kernel.flock.mockRejectedValue(error)
    await expect(FileStoreLease.acquire('/store')).rejects.toBe(error)
    expect(kernel.handleClose).toHaveBeenCalledOnce()
  })

  it('retries an inode or device replacement and refuses a continuously replaced lock path', async () => {
    selectPlatform('linux')
    kernel.pathStat.mockResolvedValueOnce({ ino: 5n, dev: 4n }).mockResolvedValueOnce({ ino: 3n, dev: 6n })
    const lease = await FileStoreLease.acquire('/store')
    expect(kernel.handleClose).toHaveBeenCalledTimes(2)
    await lease.release()
    kernel.pathStat.mockResolvedValue({ ino: 5n, dev: 4n })
    await expect(FileStoreLease.acquire('/store')).rejects.toMatchObject({ code: 'ATTACHMENT_STORE_OWNED' })
    expect(kernel.handleClose).toHaveBeenCalledTimes(6)
  })
})
