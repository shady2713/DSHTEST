/** Filesystem ownership for the Electron-managed desktop installation. */

import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_HOME_ENV, isWebTestApplication, resolveWebTestApplication } from '@deepseek-ai/dsh-web-test'

/** Profile the official product owns inside the shared Harness home. */
const OFFICIAL_DESKTOP_PROFILE = 'desktop'

/** Identity the official product records for its own install. */
const OFFICIAL_DESKTOP_APPLICATION_ID = 'dsh-desktop'

/** Environment variable carrying the composition layer the Host child must apply. */
export const DESKTOP_HOST_LAYER_ENV = 'DSH_WEB_TEST_COMPOSITION_LAYER'

/** Environment variable carrying the Loader entry id that layer must mount. */
export const DESKTOP_HOST_ENTRY_ENV = 'DSH_WEB_TEST_ENTRY_ID'

/** Stable desktop installation paths under the Harness home the shell runs in. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
  /** Electron `userData`; absent leaves Electron's own default in place. */
  readonly userData?: string
}

/** What the Host child must boot under, named by the identity the shell resolved. */
export interface DesktopHostBoot {
  /** Composition layer the Host passes as its own patch file, never a bundle's. */
  readonly compositionLayer: string
  /** Loader entry id that layer mounts, and whose absence the Host refuses. */
  readonly entryId: string
}

/** The install this shell is running as, read from the identity its launcher applied. */
export interface DesktopApplication {
  /** Identity recorded for this install; distinct per product so both may be installed. */
  readonly applicationId: string
  /** Harness home every service and Electron path resolves under. */
  readonly home: string
  /** Electron-owned paths inside that home. */
  readonly paths: DesktopPaths
  /** Host child boot requirements; absent for the official product, which mounts no owned entry. */
  readonly host: DesktopHostBoot | undefined
}

/**
 * Resolve the identity this shell runs under. The official product owns the
 * shared Harness home and its `desktop` profile, and Electron keeps deriving its
 * own `userData` directory from `app.name`. The Web testing application announces
 * itself through {@link isWebTestApplication}, and then the data root, profile,
 * lock, and browser `userData` directory are all its own.
 *
 * Reading the identity applies nothing: the launching process owns
 * `launchEnvironment` and the install registration — the development launch
 * `scripts/web-test-launch.ts` does both — so a shell launched without the
 * marker is the official product exactly as before.
 * @param env - environment carrying the applied launch environment; defaults to `process.env`.
 * @returns the resolved install, its paths, and the Host child's boot requirements.
 */
export function resolveDesktopApplication(env: NodeJS.ProcessEnv = process.env): DesktopApplication {
  const home = resolveDshHome(undefined, env)
  if (!isWebTestApplication(env)) {
    return {
      applicationId: OFFICIAL_DESKTOP_APPLICATION_ID,
      home,
      paths: resolveDesktopPaths(home, env),
      host: undefined,
    }
  }
  // Resolved without the official-home comparison a first launcher makes: this
  // process already carries this application's own home, so that value is the
  // home it must keep rather than the one it must avoid. The applied data root
  // names the directory its launcher resolved it in, so a launcher that owns a
  // base other than the operating-system home is followed rather than ignored.
  const application = resolveWebTestApplication(appliedBase(env))
  return {
    applicationId: application.applicationId,
    home: application.home,
    paths: {
      profile: application.profileDir,
      lock: join(application.profileDir, 'lock'),
      userData: application.userDataDir,
    },
    host: { compositionLayer: application.compositionLayerPath, entryId: application.entryId },
  }
}

/**
 * Directory the applied data root was resolved in, which is the launcher's base
 * once the launch environment names this application's own root. Absent, the
 * identity resolves in the operating-system home, where a launcher that applied
 * no `DSH_HOME` puts it.
 * @param env - environment carrying the applied launch environment.
 * @returns the base directory, or an empty options set when no root is applied.
 */
function appliedBase(env: NodeJS.ProcessEnv): { readonly base?: string } {
  const applied = env[DSH_HOME_ENV]?.trim()
  return applied === undefined || applied === '' ? {} : { base: dirname(applied) }
}

/**
 * Resolve every Electron-owned path without changing the shared data roots. An
 * explicit `dshHome` names the official product's home, so it is only honoured
 * when this shell is not running as another application.
 * @param dshHome - Harness home shared with npm-installed dsh.
 * @param env - environment carrying the applied launch environment; defaults to `process.env`.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(
  dshHome: string = resolveDshHome(),
  env: NodeJS.ProcessEnv = process.env,
): DesktopPaths {
  if (isWebTestApplication(env)) return resolveDesktopApplication(env).paths
  return {
    profile: join(dshHome, 'profiles', OFFICIAL_DESKTOP_PROFILE),
    lock: join(dshHome, 'profiles', OFFICIAL_DESKTOP_PROFILE, 'lock'),
  }
}

/**
 * Environment the Host child inherits so it boots under this shell's identity
 * rather than the official product's. The official product passes nothing, so
 * its Host keeps composing exactly the layers it always did. The handoff names
 * the same resolved install the shell read for its Electron paths, so the child
 * cannot be handed one identity while the window runs under another.
 * @param application - the install this shell resolved; defaults to the current environment's.
 * @returns the identity handoff, or an empty environment for the official product.
 */
export function desktopHostEnvironment(application: DesktopApplication = resolveDesktopApplication()): NodeJS.ProcessEnv {
  const { host } = application
  if (host === undefined) return {}
  return {
    [DESKTOP_HOST_LAYER_ENV]: host.compositionLayer,
    [DESKTOP_HOST_ENTRY_ENV]: host.entryId,
  }
}
