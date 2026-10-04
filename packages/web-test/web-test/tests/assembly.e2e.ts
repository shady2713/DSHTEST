/** Exercise the built file entry and package inventory through a real Loader config. */
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/assembly.mjs', import.meta.url))

it.each([
  ['cordis.yml', 0],
  ['invalid.cordis.yml', 1],
] as const)('checks the built composition from %s', async (fixture, expectedExitCode) => {
  const configPath = fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url))
  const originalConfig = await readFile(configPath, 'utf8')
  const result = await runLoaderSmoke({
    label: 'web-test assembly',
    tempDirPrefix: 'web-test-assembly-',
    binScript: driver,
    libBinScript: driver,
    configPath,
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.base.json', import.meta.url)),
    mode: 'lib',
    expectedExitCode,
  })
  expect(await readFile(configPath, 'utf8')).toBe(originalConfig)
  if (expectedExitCode === 0) {
    expect(result.stdout).toContain('WEB_TEST_ASSEMBLY_OK')
    expect(result.stderr).toBe('')
  } else {
    expect(result.stderr).toContain('applicationId')
    expect(result.stdout).not.toContain('WEB_TEST_ASSEMBLY_OK')
  }
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
