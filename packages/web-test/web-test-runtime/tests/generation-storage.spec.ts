/** The production route writes only beneath the locked data-generation pointer. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, newControlRoot, registration, startRuntime } from './harness.ts'

afterEach(cleanup)

describe.skipIf(process.platform !== 'win32')('generation-owned storage', () => {
  it('ignores a different shared backend root and reopens the selected generation', async () => {
    const controlRoot = join(await newControlRoot(), 'control')
    const sharedRoot = await newControlRoot()
    const first = await startRuntime({ controlRoot, freshRoot: true, dataRoot: sharedRoot, storageMode: 'generation-json' })
    const receipt = await first.runtime.registerProject(registration('cmd-generation-storage'))
    const actualFile = join(first.runtime.identity().dataRoot, 'webtest.json')
    expect(await readFile(actualFile, 'utf8')).toContain(receipt.resourceId)
    await expect(readFile(join(sharedRoot, 'webtest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await first.stop()
    const second = await startRuntime({ controlRoot, dataRoot: sharedRoot, storageMode: 'generation-json' })
    try {
      expect(await second.runtime.registerProject(registration('cmd-generation-storage'))).toEqual(receipt)
    }
    finally {
      await second.stop()
    }
  })
})
