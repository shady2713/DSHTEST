/** The built provider entry, mounted and disposed by the real Loader. */
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/browser-automation-provider.mjs', import.meta.url))

it('resolves the built provider entry, its eight tools, and its exclusive slot', async () => {
  const configPath = fileURLToPath(new URL('./fixtures/browser-automation-provider.cordis.yml', import.meta.url))
  const originalConfig = await readFile(configPath, 'utf8')
  const result = await runLoaderSmoke({
    label: 'web-test browser automation provider',
    tempDirPrefix: 'web-test-browser-automation-',
    binScript: driver,
    libBinScript: driver,
    configPath,
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.base.json', import.meta.url)),
    mode: 'lib',
  })

  expect(await readFile(configPath, 'utf8')).toBe(originalConfig)
  expect(result.stdout).toContain('WEB_TEST_BROWSER_PROVIDER_OK')
  expect(result.stderr).toBe('')
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
