/**
 * Launch the unpackaged Electron shell as the Web testing application.
 *
 * `src/paths.ts` reads an applied launch environment to decide which install the
 * shell runs as, and this launcher is the process that applies it: it reads the
 * official Harness home before the launch environment replaces that value,
 * resolves the Web testing identity against it, registers the install, and opens
 * Electron with the environment it applied. The environment goes in before
 * Electron starts, because every Electron-owned path is read while this shell's
 * modules load.
 *
 * It does not call `launchWebTestApplication`. That launcher's contract is a
 * harness runtime booted in the calling process whose Loader entries the caller
 * lists, and this shell boots no runtime: its Host child boots the tree in
 * another process and checks the data root and the mounted entry itself through
 * `assertDesktopHostLaunched`. A boot callback that reported the shell's own
 * start would have to invent the entry ids that check reads, so the shell
 * performs the three steps it can observe — read, apply, register — and the Host
 * keeps the launch assertions that belong to a booted tree.
 */

import { parseArgs } from 'node:util'
import {
  readOfficialHome,
  registerWebTestApplication,
  resolveWebTestApplication,
  type WebTestApplication,
} from '@deepseek-ai/dsh-web-test'
import { launchDevelopmentShell, type DevelopmentShellIdentity } from './dev.ts'

/** Inputs for {@link prepareWebTestShellLaunch}. */
export interface WebTestShellLaunchOptions {
  /** Environment the launch environment is applied to; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /** Directory that holds the data root; defaults to the operating-system home. */
  readonly base?: string
}

/** What a Web testing launch resolved, registered, and hands the Electron child. */
export interface WebTestShellLaunch {
  /** Identity this launch registered the install under. */
  readonly application: WebTestApplication
  /** Paths and variables this install pins for Electron and its Host child. */
  readonly identity: DevelopmentShellIdentity
  /**
   * Remove the data root, profile, and browser directory this registration
   * created. A launch that ends leaves its install in place, the way an
   * installed product's stays.
   */
  release(): void
}

/**
 * Apply the Web testing identity to a development launch, and register the
 * install it names. Nothing here spawns a process, so a caller can resolve the
 * identity and read the environment the shell will inherit without opening a
 * window.
 * @param options - environment the launch environment is applied to, and the base directory of the data root.
 * @returns the registered application, the identity Electron inherits, and the release path.
 * @throws when the identity would reuse the official product's home or profile.
 */
export function prepareWebTestShellLaunch(options: WebTestShellLaunchOptions = {}): WebTestShellLaunch {
  const env = options.env ?? process.env
  // Read first: applying the launch environment hands DSH_HOME to this
  // application, after which the ambient value no longer names the official home.
  const officialHome = readOfficialHome(env)
  const application = resolveWebTestApplication({
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(officialHome === undefined ? {} : { officialHome }),
  })
  Object.assign(env, application.launchEnvironment)
  return {
    application,
    identity: {
      home: application.home,
      userData: application.userDataDir,
      environment: { ...application.launchEnvironment },
    },
    release: registerWebTestApplication(application),
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'skip-build': { type: 'boolean', default: false },
      'no-debug': { type: 'boolean', default: false },
    },
  })
  const launch = prepareWebTestShellLaunch()
  console.log(`web-test development: data root=${launch.application.home}`)
  console.log(`web-test development: profile=${launch.application.profileName}, userData=${launch.application.userDataDir}`)
  console.log(`web-test development: composition layer=${launch.application.compositionLayerPath}`)
  await launchDevelopmentShell({
    skipBuild: values['skip-build'],
    debug: !values['no-debug'],
    identity: launch.identity,
  })
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
