/**
 * The one owner that turns this application's resolved identity into a running
 * harness tree, on this application's own data root.
 *
 * A launcher does four things in an order nothing may reorder: it reads the
 * official Harness home while the ambient environment still names it, resolves
 * the identity against it, applies {@link WebTestApplication.launchEnvironment}
 * before any runtime path is resolved, and only then registers the install and
 * boots. {@link WebTestLaunchRequest.applicationPatchFiles} carries
 * {@link WebTestApplication.compositionLayerPath} as the launcher's own patch
 * layer rather than a bundle's `dsh.bundle.patch`, because a bundle resolves
 * its declared patch files against its own package directory and this
 * application is not a bundle. The profile the boot composes holds the bundle
 * list in the manifest {@link registerWebTestApplication} wrote, so the layer is
 * applied exactly once and the runtime's own `--patch` loader fails on a
 * missing file rather than booting an application that never mounted.
 *
 * The module takes the runtime boot as an argument instead of importing one, so
 * the shipped entry keeps carrying no dependency beyond its own identity
 * module, and a carrier may boot the same request in process or as a child
 * `dsh` invocation.
 * @module @deepseek-ai/dsh-web-test/launcher
 */

import { existsSync } from 'node:fs'
import {
  assertWebTestDataRoot,
  readOfficialHome,
  registerWebTestApplication,
  releaseWebTestEntry,
  resolveWebTestApplication,
  type WebTestApplication,
  type WebTestApplicationOptions,
  type WebTestEntryRelease,
} from './application.ts'

/** Everything a harness profile boot needs, resolved by this launcher. */
export interface WebTestLaunchRequest {
  /** Profile to boot: this application's own, which the boot finds under the applied data root. */
  readonly profile: string
  /** Command-line overlays applied after user patches. */
  readonly patchFiles: readonly string[]
  /** Application composition applied after bundles and before user patches. */
  readonly applicationPatchFiles: readonly string[]
  /** Inner arguments for the booted tree, handed through verbatim. */
  readonly args: readonly string[]
  /** Environment every runtime path resolves under. */
  readonly environment: Readonly<NodeJS.ProcessEnv>
}

/** A settled runtime boot: the runtime's own handle plus the facts the launcher checks. */
export interface WebTestBooted<T> {
  /** The booted runtime's handle, returned to the caller unchanged. */
  readonly runtime: T
  /** Data root the booted runtime's own home resolver returned. */
  readonly home: string
  /** Ids of the Loader entries the booted tree holds. */
  readonly entryIds: readonly string[]
}

/** Boots the harness runtime from a request this launcher composed. */
export type WebTestRuntimeBoot<T> = (request: WebTestLaunchRequest) => Promise<WebTestBooted<T>>

/** A running launch: the registered application, the booted runtime, and the release path. */
export interface WebTestLaunch<T> {
  /** Identity and paths the boot runs under. */
  readonly application: WebTestApplication
  /** The exact request the runtime was booted from. */
  readonly request: WebTestLaunchRequest
  /** The booted runtime's own handle. */
  readonly booted: T
  /**
   * Release the mounted entry and then the registered install, in that order,
   * so a live row is never left behind over a removed data root.
   * @param loader - the booted runtime's Loader tree, when it still holds this application's entry.
   */
  release(loader?: WebTestEntryRelease): void
}

/** Inputs for {@link launchWebTestApplication}; only the runtime boot is required. */
export interface WebTestLaunchOptions<T> extends Omit<WebTestApplicationOptions, 'officialHome'> {
  /** Boots the harness runtime; the launcher owns nothing else about how it starts. */
  readonly boot: WebTestRuntimeBoot<T>
  /** Inner arguments for the booted tree. */
  readonly args?: readonly string[]
  /**
   * Environment the launch environment is applied to and the boot inherits;
   * defaults to `process.env`, which is what an in-process boot resolves under.
   */
  readonly env?: NodeJS.ProcessEnv
}

/**
 * Refuse a launch whose composition layer is not on disk: the layer is what
 * mounts the entry and closes every product egress, so a boot without it would
 * report a healthy runtime that serves the official product's telemetry.
 * @param application - resolved identity naming the layer.
 * @throws when the layer file is absent.
 */
function requireCompositionLayer(application: WebTestApplication): void {
  if (existsSync(application.compositionLayerPath)) return
  throw new Error(
    `web-test: the composition layer ${application.compositionLayerPath} is absent; the boot would mount no `
    + `${JSON.stringify(application.entryId)} entry and leave every product egress open, so it is refused`,
  )
}

/**
 * Check a booted runtime against the identity it was launched with. A clean
 * start proves nothing on its own, so a caller reads the booted tree's own
 * values and the launcher refuses a runtime that resolved another data root or
 * never mounted the owned entry.
 * @param application - resolved identity the runtime was booted from.
 * @param booted - the booted runtime's handle and the facts read from its tree.
 * @throws when the resolved data root is another one, or the owned entry did not mount.
 */
export function assertWebTestLaunched<T>(application: WebTestApplication, booted: WebTestBooted<T>): void {
  assertWebTestDataRoot(application, booted.home)
  if (booted.entryIds.includes(application.entryId)) return
  throw new Error(
    `web-test: the booted tree holds no ${JSON.stringify(application.entryId)} entry; the composition layer `
    + `${application.compositionLayerPath} did not apply, so this application did not mount`,
  )
}

/**
 * Launch this application: read the official home, resolve the identity against
 * it, apply the launch environment, register the install, and boot the harness
 * runtime with the composition layer as the launcher's own patch layer. A boot
 * that resolves another data root or never mounts the owned entry is disposed
 * and rethrown rather than returned as a running application.
 * @param options - runtime boot, inner arguments, the environment to apply, and the identity's own names.
 * @returns the running launch, its request, and the release path.
 * @throws when the identity selects the official product's profile or home, when the composition layer
 * is absent, when the boot fails, or when the booted runtime fails
 * {@link assertWebTestLaunched}.
 */
export async function launchWebTestApplication<T>(options: WebTestLaunchOptions<T>): Promise<WebTestLaunch<T>> {
  const env = options.env ?? process.env
  // Read first: applying the launch environment hands DSH_HOME to this
  // application, after which the ambient value no longer names the official home.
  const officialHome = readOfficialHome(env)
  const application = resolveWebTestApplication({
    ...options,
    ...(officialHome === undefined ? {} : { officialHome }),
  })
  requireCompositionLayer(application)
  // Applied before the runtime resolves any path, and before registration, so
  // the profile directory written below is the one the boot composes.
  Object.assign(env, application.launchEnvironment)
  const releaseInstall = registerWebTestApplication(application)
  const release = (loader?: WebTestEntryRelease): void => {
    if (loader !== undefined) releaseWebTestEntry(loader, application.entryId)
    releaseInstall()
  }
  const request: WebTestLaunchRequest = Object.freeze({
    profile: application.profileName,
    patchFiles: Object.freeze([]),
    applicationPatchFiles: Object.freeze([application.compositionLayerPath]),
    args: Object.freeze([...(options.args ?? [])]),
    environment: env,
  })
  let booted: WebTestBooted<T>
  try {
    booted = await options.boot(request)
  } catch (error) {
    releaseInstall()
    throw error
  }
  try {
    assertWebTestLaunched(application, booted)
  } catch (error) {
    releaseInstall()
    throw error
  }
  return { application, request, booted: booted.runtime, release }
}
