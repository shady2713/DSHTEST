/**
 * The shell resolves the install it runs under, and every Electron-owned path
 * follows that identity rather than the official product's.
 */
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { WEB_TEST_IDENTITY_ENV } from '@deepseek-ai/dsh-web-test'
import { describe, expect, it } from 'vitest'
import {
  desktopHostEnvironment,
  DESKTOP_HOST_ENTRY_ENV,
  DESKTOP_HOST_LAYER_ENV,
  resolveDesktopApplication,
  resolveDesktopPaths,
} from '../src/paths.ts'

/** A launch environment as a carrier applied it, on this machine's home. */
function webTestEnvironment(): NodeJS.ProcessEnv {
  return { [WEB_TEST_IDENTITY_ENV]: '1' }
}

describe('the official product', () => {
  it('keeps the shared home, its desktop profile, and Electron its own userData', () => {
    const home = join(tmpdir(), 'dsh-official-home')
    const paths = resolveDesktopPaths(home)

    expect(paths).toEqual({ profile: join(home, 'profiles', 'desktop'), lock: join(home, 'profiles', 'desktop', 'lock') })
    // Absent, not empty: leaving it unset keeps Electron deriving its own
    // directory from `app.name`, which the installed product already has.
    expect(paths.userData).toBeUndefined()
  })

  it('resolves its identity from the environment and hands its Host nothing to compose', () => {
    const application = resolveDesktopApplication({ DSH_HOME: 'C:\\harness' })

    expect(application.applicationId).toBe('dsh-desktop')
    expect(application.home).toBe(join('C:\\', 'harness'))
    expect(application.host).toBeUndefined()
    // The handoff follows the install the caller resolved, so the child never
    // boots under a second identity read.
    expect(desktopHostEnvironment(application)).toEqual({})
  })
})

describe('the Web testing application', () => {
  it('owns its data root, profile, lock, and browser userData', () => {
    const home = join(homedir(), '.dsh-web-test')
    const application = resolveDesktopApplication(webTestEnvironment())

    expect(application.applicationId).toBe('dsh-web-test')
    expect(application.home).toBe(home)
    expect(application.paths).toEqual({
      profile: join(home, 'profiles', 'web-test'),
      lock: join(home, 'profiles', 'web-test', 'lock'),
      userData: join(home, 'browser', 'user-data'),
    })
    // Nothing under the official product's home is reused.
    const officialHome = join(homedir(), '.dsh')
    expect(application.paths.profile.startsWith(`${officialHome}${sep}`)).toBe(false)
  })

  it('keeps every path it owns inside its own data root', () => {
    const { home, paths } = resolveDesktopApplication(webTestEnvironment())

    for (const path of [paths.profile, paths.lock, paths.userData]) {
      expect(path === undefined ? home : path.startsWith(home)).toBe(true)
    }
  })

  it('hands its Host the composition layer and the entry that layer mounts', () => {
    const application = resolveDesktopApplication(webTestEnvironment())
    const { compositionLayer, entryId } = application.host ?? {}

    expect(compositionLayer).toMatch(/web-test\.cordis\.patch\.yml$/)
    expect(entryId).toBe('web-test')
    // The Host receives the layer as a patch file, never as a bundle's own
    // `dsh.bundle.patch`, which a bundle resolves against its package directory.
    expect(desktopHostEnvironment(application)).toEqual({
      [DESKTOP_HOST_LAYER_ENV]: compositionLayer,
      [DESKTOP_HOST_ENTRY_ENV]: entryId,
    })
  })

  it('resolves its own paths from an explicit home argument too', () => {
    // A caller that names the official product's home still gets this
    // application's paths, because the applied launch environment outranks it.
    const application = resolveDesktopApplication(webTestEnvironment())
    expect(resolveDesktopPaths(join(homedir(), '.dsh'), webTestEnvironment())).toEqual(application.paths)
  })

  it('follows the data root the applied launch environment names', () => {
    // A launcher that owns a base other than the operating-system home applies
    // that root, and the shell resolves the install it names rather than
    // re-deriving one of its own.
    const home = join(tmpdir(), 'dsh-web-test-launch', '.dsh-web-test')
    const application = resolveDesktopApplication({ ...webTestEnvironment(), DSH_HOME: home })

    expect(application.home).toBe(home)
    expect(application.paths.userData).toBe(join(home, 'browser', 'user-data'))
  })
})
