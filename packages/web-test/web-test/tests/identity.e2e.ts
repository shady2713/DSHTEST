/** The application's own data root, profile, and egress closure, composed by the real Loader. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { readOfficialHome, resolveWebTestApplication } from '../src/application.ts'

const driver = fileURLToPath(new URL('./fixtures/identity.mjs', import.meta.url))

it('registers, composes, mounts, and releases the application through a real Loader', async () => {
  // The launcher owns the launch environment: the data root only separates the two
  // products when it is applied before the runtime resolves any path, and the official
  // home is read before that application takes the variable over.
  const cwd = mkdtempSync(join(tmpdir(), 'web-test-identity-'))
  onTestFinished(() => { rmSync(cwd, { recursive: true, force: true }) })
  const officialHome = readOfficialHome()
  const application = resolveWebTestApplication({
    base: cwd,
    ...(officialHome === undefined ? {} : { officialHome }),
  })

  const result = await runLoaderSmoke({
    label: 'web-test identity',
    cwd,
    binScript: driver,
    libBinScript: driver,
    // The fixture writes its own root config into the isolated cwd the harness owns.
    configPath: driver,
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.base.json', import.meta.url)),
    mode: 'lib',
    env: application.launchEnvironment,
  })

  expect(result.stderr).toBe('')
  expect(result.stdout).toBe(`WEB_TEST_IDENTITY_OK ${application.home}\n`)
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
