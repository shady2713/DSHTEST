/** The installed application profile must mount its actual project and configuration services. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/full-profile.mjs', import.meta.url))

it.skipIf(process.platform !== 'win32')('boots the complete installed Web testing profile', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'web-test-full-profile-'))
  onTestFinished(() => { rmSync(cwd, { recursive: true, force: true }) })
  const result = await runLoaderSmoke({
    label: 'web-test complete profile', cwd,
    binScript: driver, libBinScript: driver, configPath: driver,
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.base.json', import.meta.url)),
    mode: 'lib',
  })
  expect(result.stdout).toContain('WEB_TEST_FULL_PROFILE_READY')
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
