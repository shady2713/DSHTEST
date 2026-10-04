/**
 * The launcher owns the launch order, refuses a launch without its composition
 * layer, and disposes a boot that came up on another data root or never mounted
 * the owned entry.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  DSH_HOME_ENV,
  DSH_TELEMETRY_DISABLED_ENV,
  releaseWebTestEntry,
  resolveWebTestApplication,
  WEB_TEST_DATA_ROOT_DIR,
  WEB_TEST_ENTRY_ID,
  type WebTestEntryRelease,
} from '../src/application.ts'
import {
  assertWebTestLaunched,
  launchWebTestApplication,
  type WebTestLaunchRequest,
  type WebTestRuntimeBoot,
} from '../src/launcher.ts'

// The composition layer is a package-root file, so an absent one is a publish
// fault rather than something a test may produce by deleting the source tree.
const hidden = vi.hoisted(() => new Set<string>())
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) =>
      typeof path === 'string' && hidden.has(path) ? false : actual.existsSync(path),
  }
})

const created: string[] = []

function temporaryBase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'web-test-launcher-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  hidden.clear()
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A runtime that reports the data root it resolved from the request it was given. */
function resolvingBoot(observe?: (request: WebTestLaunchRequest) => void): WebTestRuntimeBoot<string> {
  return async (request) => {
    observe?.(request)
    return {
      runtime: 'booted',
      home: request.environment[DSH_HOME_ENV] ?? '',
      entryIds: [WEB_TEST_ENTRY_ID],
    }
  }
}

it('reads the official home, applies the launch environment, registers, then boots', async () => {
  const base = temporaryBase()
  const officialHome = join(base, '.dsh')
  const env: NodeJS.ProcessEnv = { [DSH_HOME_ENV]: officialHome }
  const dataRoot = join(base, WEB_TEST_DATA_ROOT_DIR)
  const seen: Record<string, string> = {}
  const bootedProfiles: string[] = []

  const launch = await launchWebTestApplication({
    base,
    env,
    args: ['--resume', 'session-1'],
    boot: resolvingBoot((request) => {
      // Registration and the launch environment are both in place when the
      // runtime resolves any path, so the profile it composes is the one
      // written under this application's own data root.
      const root = request.environment[DSH_HOME_ENV] ?? ''
      bootedProfiles.push(request.profile)
      seen.root = root
      seen.telemetry = request.environment[DSH_TELEMETRY_DISABLED_ENV] ?? ''
      seen.manifest = String(existsSync(join(root, 'profiles', WEB_TEST_ENTRY_ID, 'package.json')))
      seen.release = String(existsSync(join(root, 'release.json')))
    }),
  })

  expect(seen).toEqual({ root: dataRoot, telemetry: '1', manifest: 'true', release: 'true' })
  expect(bootedProfiles).toEqual([WEB_TEST_ENTRY_ID])
  // The ambient official home named the home the identity must not reuse, and
  // the launch environment took the variable over afterwards.
  expect(env[DSH_HOME_ENV]).toBe(dataRoot)
  expect(env[DSH_HOME_ENV]).not.toBe(officialHome)
  expect(launch.application.entryId).toBe(WEB_TEST_ENTRY_ID)
  expect(launch.booted).toBe('booted')
  // The composition layer is the launcher's own patch layer, so the entry mounts
  // exactly once and a missing layer fails the boot rather than the application.
  expect(launch.request.profile).toBe(launch.application.profileName)
  expect(launch.request.applicationPatchFiles).toEqual([launch.application.compositionLayerPath])
  expect(launch.request.args).toEqual(['--resume', 'session-1'])
  expect(launch.request.environment).toBe(env)

  launch.release()
  expect(existsSync(launch.application.home)).toBe(false)
})

it('applies the launch environment to the ambient environment when none is given', async () => {
  const base = temporaryBase()
  const ambient = { ...process.env }
  try {
    const launch = await launchWebTestApplication({ base, boot: resolvingBoot() })

    expect(launch.request.environment).toBe(process.env)
    expect(launch.request.args).toEqual([])
    expect(process.env[DSH_HOME_ENV]).toBe(join(base, WEB_TEST_DATA_ROOT_DIR))
    launch.release()
  } finally {
    for (const key of Object.keys(process.env)) {
      if (ambient[key] === undefined) Reflect.deleteProperty(process.env, key)
    }
    Object.assign(process.env, ambient)
  }
})

it('refuses a launch whose data root would be the official product home', async () => {
  const base = temporaryBase()
  const env: NodeJS.ProcessEnv = { [DSH_HOME_ENV]: join(base, '.dsh') }
  const boot = vi.fn<WebTestRuntimeBoot<string>>()

  await expect(launchWebTestApplication({ base, dataRootName: '.dsh', env, boot }))
    .rejects.toThrow(/is the official Harness home/)
  expect(boot).not.toHaveBeenCalled()
  expect(existsSync(join(base, '.dsh'))).toBe(false)
})

it('refuses a launch whose composition layer is absent, before it registers anything', async () => {
  const base = temporaryBase()
  const application = resolveWebTestApplication({ base })
  hidden.add(application.compositionLayerPath)
  const boot = vi.fn<WebTestRuntimeBoot<string>>()

  await expect(launchWebTestApplication({ base, env: {}, boot }))
    .rejects.toThrow(/composition layer .* is absent/)
  expect(boot).not.toHaveBeenCalled()
  // The refusal precedes registration, so no data root was left behind.
  expect(existsSync(application.home)).toBe(false)
})

it('releases the registered install when the runtime boot fails', async () => {
  const base = temporaryBase()
  const application = resolveWebTestApplication({ base })
  const boot = vi.fn<WebTestRuntimeBoot<string>>(async () => { throw new Error('runtime refused the request') })

  await expect(launchWebTestApplication({ base, env: {}, boot })).rejects.toThrow('runtime refused the request')
  expect(boot).toHaveBeenCalledOnce()
  expect(existsSync(application.home)).toBe(false)
})

it('disposes a booted tree that resolved another data root and releases the install', async () => {
  const base = temporaryBase()
  const application = resolveWebTestApplication({ base })

  await expect(launchWebTestApplication({
    base,
    env: {},
    boot: async () => ({ runtime: 'booted', home: join(base, '.dsh'), entryIds: [WEB_TEST_ENTRY_ID] }),
  })).rejects.toThrow(/is not this application's/)
  expect(existsSync(application.home)).toBe(false)
})

it('disposes a booted tree that never mounted the owned entry and releases the install', async () => {
  const base = temporaryBase()
  const application = resolveWebTestApplication({ base })

  await expect(launchWebTestApplication({
    base,
    env: {},
    boot: async request => ({ runtime: 'booted', home: request.environment[DSH_HOME_ENV] ?? '', entryIds: ['other'] }),
  })).rejects.toThrow(/holds no "web-test" entry; the composition layer .* did not apply/)
  expect(existsSync(application.home)).toBe(false)
})

it('releases the mounted entry and then the registered install', async () => {
  const base = temporaryBase()
  const disposed: string[] = []
  const loader: WebTestEntryRelease = {
    entries: () => [{ options: { id: WEB_TEST_ENTRY_ID }, fiber: { dispose: () => { disposed.push(WEB_TEST_ENTRY_ID) } } }],
  }
  const launch = await launchWebTestApplication({ base, env: {}, boot: resolvingBoot() })

  expect(existsSync(launch.application.home)).toBe(true)
  launch.release(loader)
  // The row stops before the data root it was mounted in is removed.
  expect(disposed).toEqual([WEB_TEST_ENTRY_ID])
  expect(existsSync(launch.application.home)).toBe(false)
})

it('releases only the install when the caller holds no tree', async () => {
  const base = temporaryBase()
  const launch = await launchWebTestApplication({ base, env: {}, boot: resolvingBoot() })

  launch.release()
  expect(existsSync(launch.application.home)).toBe(false)
  // A tree that never mounted the owned row still fails loud, so no release
  // claims a row it cannot see.
  expect(() => { releaseWebTestEntry({ entries: () => [] }) }).toThrow(/holds no active entry/)
})

it('asserts the booted tree resolved this data root and mounted the owned entry', () => {
  const application = resolveWebTestApplication({ base: temporaryBase() })
  const mounted = { runtime: 'booted', home: application.home, entryIds: [WEB_TEST_ENTRY_ID] }

  expect(() => { assertWebTestLaunched(application, mounted) }).not.toThrow()
  expect(() => { assertWebTestLaunched(application, { ...mounted, home: join(application.home, '..') }) })
    .toThrow(/is not this application's/)
  expect(() => { assertWebTestLaunched(application, { ...mounted, entryIds: [] }) })
    .toThrow(/holds no "web-test" entry/)
})
