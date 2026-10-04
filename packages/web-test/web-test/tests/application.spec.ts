/** The application owner resolves and registers one install that is not the official product's. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, expect, it } from 'vitest'
import {
  assertWebTestDataRoot,
  DSH_HOME_ENV,
  DSH_TELEMETRY_DISABLED_ENV,
  isWebTestApplication,
  OFFICIAL_DESKTOP_PROFILE_NAME,
  readOfficialHome,
  registerWebTestApplication,
  releaseWebTestEntry,
  resolveWebTestApplication,
  WEB_TEST_APPLICATION_ID,
  WEB_TEST_DATA_ROOT_DIR,
  WEB_TEST_ENTRY_ID,
  WEB_TEST_IDENTITY_ENV,
  WEB_TEST_PROFILE_BUNDLES,
  WEB_TEST_PROFILE_NAME,
  WEB_TEST_UPDATE_CHANNEL,
  type WebTestEntryRelease,
  type WebTestReleaseIdentity,
} from '../src/application.ts'
import type { WebTestEntryId } from '../src/types.ts'

const created: string[] = []

function temporaryBase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'web-test-application-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('resolves an identity whose data root, profile, user data, and channel are its own', () => {
  const base = temporaryBase()
  const application = resolveWebTestApplication({ base })
  const home = join(base, WEB_TEST_DATA_ROOT_DIR)

  expect(application.applicationId).toBe(WEB_TEST_APPLICATION_ID)
  expect(application.updateChannel).toBe(WEB_TEST_UPDATE_CHANNEL)
  expect(application.entryId).toBe(WEB_TEST_ENTRY_ID)
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  expect(application.version).toBe(manifest.version)
  expect(application.home).toBe(home)
  expect(application.profileName).toBe(WEB_TEST_PROFILE_NAME)
  expect(application.profileDir).toBe(join(home, 'profiles', WEB_TEST_PROFILE_NAME))
  expect(application.userDataDir).toBe(join(home, 'browser', 'user-data'))
  expect(application.releaseIdentityPath).toBe(join(home, 'release.json'))
  // The official product keeps the shared home, its own profile, and its own channel.
  expect(application.home).not.toBe(join(homedir(), '.dsh'))
  expect(application.profileDir).not.toBe(join(homedir(), '.dsh', 'profiles', OFFICIAL_DESKTOP_PROFILE_NAME))
  expect(application.updateChannel).not.toBe(OFFICIAL_DESKTOP_PROFILE_NAME)
  // The entry and layer the shipped composition mounts are this package's own artifact.
  expect(application.entryUrl).toBe(new URL('../lib/index.js', import.meta.url).href)
  expect(existsSync(application.compositionLayerPath)).toBe(true)
  // The runtime resolves storage, settings, and credentials only through this environment.
  expect(application.launchEnvironment).toEqual({
    [DSH_HOME_ENV]: home,
    [DSH_TELEMETRY_DISABLED_ENV]: '1',
    [WEB_TEST_IDENTITY_ENV]: '1',
  })
  // Without an explicit base the data root sits beside the operating-system home.
  expect(resolveWebTestApplication().home).toBe(join(homedir(), WEB_TEST_DATA_ROOT_DIR))
})

it('names this application to a shell that carries its launch environment', () => {
  const application = resolveWebTestApplication({ base: temporaryBase() })
  // The official product shares one Harness home with an npm-installed dsh, so a
  // shell reads this marker before it resolves any Electron-owned path.
  expect(isWebTestApplication({})).toBe(false)
  expect(isWebTestApplication({ [WEB_TEST_IDENTITY_ENV]: '   ' })).toBe(false)
  expect(isWebTestApplication(application.launchEnvironment)).toBe(true)
  const ambient = { ...process.env }
  try {
    Object.assign(process.env, application.launchEnvironment)
    expect(isWebTestApplication()).toBe(true)
  } finally {
    for (const key of Object.keys(process.env)) {
      if (ambient[key] === undefined) Reflect.deleteProperty(process.env, key)
    }
    Object.assign(process.env, ambient)
  }
})

it('reads the official home a launcher must not reuse before it applies the launch environment', () => {
  expect(readOfficialHome({})).toBeUndefined()
  expect(readOfficialHome({ [DSH_HOME_ENV]: '   ' })).toBeUndefined()
  expect(readOfficialHome({ [DSH_HOME_ENV]: 'C:\\harness' })).toBe('C:\\harness')

  const base = temporaryBase()
  const officialHome = join(base, '.dsh')
  expect(() => resolveWebTestApplication({ base, dataRootName: '.dsh', officialHome }))
    .toThrow(/is the official Harness home/)
})

it('accepts configured names and identity', () => {
  const base = temporaryBase()
  const application = resolveWebTestApplication({
    base,
    dataRootName: 'web-testing',
    profileName: 'web-testing-desktop',
    applicationId: 'web-testing',
    updateChannel: 'web-testing-labs',
    officialHome: join(base, '.dsh'),
  })

  expect(application.applicationId).toBe('web-testing')
  expect(application.updateChannel).toBe('web-testing-labs')
  expect(application.home).toBe(join(base, 'web-testing'))
  expect(application.profileDir).toBe(join(base, 'web-testing', 'profiles', 'web-testing-desktop'))
})

it('rejects a profile that would select the official product install', () => {
  expect(() => resolveWebTestApplication({ base: temporaryBase(), profileName: OFFICIAL_DESKTOP_PROFILE_NAME }))
    .toThrow(/belongs to the official product/)
  // A blank official home is unset, so it never resolves the data root to the launch directory.
  const base = temporaryBase()
  expect(resolveWebTestApplication({ base, officialHome: '  ' }).home).toBe(join(base, WEB_TEST_DATA_ROOT_DIR))
})

it.each(['..', '.', '', `nested${sep}name`, 'nested/name'])('rejects the data-root name %o', (dataRootName) => {
  expect(() => resolveWebTestApplication({ base: temporaryBase(), dataRootName }))
    .toThrow(/must be one directory name/)
})

it('rejects a profile name that is not one directory name', () => {
  expect(() => resolveWebTestApplication({ base: temporaryBase(), profileName: `..${sep}desktop` }))
    .toThrow(/must be one directory name/)
})

it('registers the data root, profile, user data, and release identity, then releases only what it created', () => {
  const application = resolveWebTestApplication({ base: temporaryBase() })
  const release = registerWebTestApplication(application)

  expect(existsSync(application.profileDir)).toBe(true)
  expect(existsSync(application.userDataDir)).toBe(true)
  const manifest = JSON.parse(readFileSync(join(application.profileDir, 'package.json'), 'utf8')) as {
    dsh: { profile: { bundles: string[] } }
  }
  expect(manifest.dsh.profile.bundles).toEqual([...WEB_TEST_PROFILE_BUNDLES])
  const identity = JSON.parse(readFileSync(application.releaseIdentityPath, 'utf8')) as WebTestReleaseIdentity
  expect(identity).toEqual({
    schemaVersion: 1,
    applicationId: application.applicationId,
    version: application.version,
    updateChannel: application.updateChannel,
    home: application.home,
    profileName: application.profileName,
    userDataDir: application.userDataDir,
    entryId: WEB_TEST_ENTRY_ID,
    compositionLayerPath: application.compositionLayerPath,
  })

  // A second registration never overwrites a person's own profile edits.
  const manifestPath = join(application.profileDir, 'package.json')
  writeFileSync(manifestPath, '{"name":"edited"}\n')
  registerWebTestApplication(application)()
  expect(readFileSync(manifestPath, 'utf8')).toBe('{"name":"edited"}\n')

  release()
  release()
  expect(existsSync(application.home)).toBe(false)
})

it('leaves an install the person already created in place', () => {
  const application = resolveWebTestApplication({ base: temporaryBase() })
  const profileDir = join(application.home, 'profiles', application.profileName)
  mkdirSync(profileDir, { recursive: true })
  const sessions = join(application.home, 'sessions')
  mkdirSync(sessions)

  const release = registerWebTestApplication(application)
  expect(existsSync(sessions)).toBe(true)
  expect(existsSync(application.releaseIdentityPath)).toBe(true)
  expect(existsSync(application.userDataDir)).toBe(true)

  release()
  // Only the paths this registration created are removed.
  expect(existsSync(application.userDataDir)).toBe(false)
  expect(existsSync(profileDir)).toBe(true)
  expect(existsSync(sessions)).toBe(true)
})

it('refuses a booted runtime whose data root is not the registered one', () => {
  const base = temporaryBase()
  const application = resolveWebTestApplication({ base })

  expect(() => { assertWebTestDataRoot(application, application.home) }).not.toThrow()
  expect(() => { assertWebTestDataRoot(application, join(base, '.dsh', 'profiles', OFFICIAL_DESKTOP_PROFILE_NAME)) })
    .toThrow(/is not this application's/)
  expect(() => { assertWebTestDataRoot(application, '.') })
    .toThrow(new RegExp(`apply .*${DSH_HOME_ENV}`))
})

it('releases the Loader entry this application owns', () => {
  const disposed: string[] = []
  const loader: WebTestEntryRelease = {
    entries: () => [{ options: { id: WEB_TEST_ENTRY_ID }, fiber: { dispose: () => { disposed.push(WEB_TEST_ENTRY_ID) } } }],
  }

  releaseWebTestEntry(loader)
  expect(disposed).toEqual([WEB_TEST_ENTRY_ID])

  // A composition that never mounted the owned row fails loud rather than claiming a release.
  expect(() => { releaseWebTestEntry(loader, brandString<WebTestEntryId>('web-test.custom')) })
    .toThrow(/holds no active entry "web-test.custom"/)
  expect(() => { releaseWebTestEntry({ entries: () => [{ options: { id: WEB_TEST_ENTRY_ID } }] }) })
    .toThrow(/holds no active entry/)
})
