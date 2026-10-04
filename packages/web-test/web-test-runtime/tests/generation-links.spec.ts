/** A generation cannot redirect the writer to a medium outside its control lock. */
import { mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalizeControlRoot, resolveDataGeneration } from '../src/index.ts'
import { prepareControlRoot } from '../src/control-root.ts'
import { cleanup, newControlRoot } from './harness.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})

afterEach(async () => { vi.resetAllMocks(); await cleanup() })

describe.skipIf(process.platform !== 'win32')('generation directory links', () => {
  it('propagates invalid configured directory errors without declaring a root created', async () => {
    const parent = await newControlRoot()
    await expect(prepareControlRoot(join(parent, 'invalid\0control'))).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' })
    expect(await readdir(parent)).toEqual([])
  })

  it('keeps a malformed stored directory pointer unchanged when filesystem lookup refuses it', async () => {
    const root = await canonicalizeControlRoot(await newControlRoot())
    await mkdir(join(root, 'data'))
    const pointer = JSON.stringify({ generation: 1, directory: 'data/invalid\0generation' })
    await writeFile(join(root, 'current.json'), pointer)
    await expect(resolveDataGeneration(root)).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' })
    expect(await readFile(join(root, 'current.json'), 'utf8')).toBe(pointer)
    expect(await readdir(join(root, 'data'))).toEqual([])
  })

  it('refuses a generation replaced by a junction after its ordinary-directory check', async () => {
    const root = await canonicalizeControlRoot(await newControlRoot()), outside = await newControlRoot()
    const generation = join(root, 'data', '1'), retained = join(root, 'data', 'retained')
    await mkdir(generation, { recursive: true })
    const pointer = JSON.stringify({ generation: 1, directory: 'data/1' })
    await writeFile(join(root, 'current.json'), pointer)
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    // Delay only the lookup return; both the sampled metadata and the replacement are real filesystem operations.
    vi.mocked(fs.lstat).mockImplementation(async (path, options) => {
      const state = await actual.lstat(path, options)
      if (path === generation) {
        await rename(generation, retained)
        await symlink(outside, generation, 'junction')
      }
      return state
    })
    await expect(resolveDataGeneration(root)).rejects.toThrow('resolved data directory escapes the locked root')
    expect(await readFile(join(root, 'current.json'), 'utf8')).toBe(pointer)
    expect(await readdir(outside)).toEqual([])
    expect(await readdir(retained)).toEqual([])
  })

  it('refuses two control roots pointing their generations at the same medium', async () => {
    const shared = await newControlRoot()
    for (let index = 0; index < 2; index += 1) {
      const root = await canonicalizeControlRoot(await newControlRoot())
      await mkdir(join(root, 'data'))
      await symlink(shared, join(root, 'data', '1'), 'junction')
      await writeFile(join(root, 'current.json'), JSON.stringify({ generation: 1, directory: 'data/1' }))
      await expect(resolveDataGeneration(root)).rejects.toThrow('not an ordinary directory')
    }
    await expect(readFile(join(shared, 'webtest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a linked parent before creating the initial generation or pointer', async () => {
    const root = await canonicalizeControlRoot(await newControlRoot())
    const outside = await newControlRoot()
    await symlink(outside, join(root, 'data'), 'junction')
    await expect(resolveDataGeneration(root)).rejects.toThrow('not an ordinary directory')
    await expect(readFile(join(root, 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(outside, '1', 'webtest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(mkdir(join(outside, '1'))).resolves.toBeUndefined()
  })
})
