/**
 * Application identity, data root, and release ownership for the Web testing product.
 *
 * One owner resolves this application's own install and registers it: the data root
 * every harness service resolves storage, settings, and credentials through, the
 * profile inside it, the browser `userData` directory, and the release identity a shell
 * reads. {@link WebTestApplication.launchEnvironment} is what separates the application
 * from the official product's shared Harness home; resolving or reading the identity
 * changes no process configuration by itself, and a launcher applies the environment
 * before the runtime resolves any path. A shell reads
 * {@link isWebTestApplication} to learn which install it is running under, so
 * it resolves this application's Electron-owned paths rather than the official
 * product's; applying the environment stays the launching process's job.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WebTestEntryId } from './types.ts'

/** Loader entry id this application owns in every composition that mounts it. */
export const WEB_TEST_ENTRY_ID = brandString<WebTestEntryId>('web-test')

/** Identity this application records for its own artifacts. */
export const WEB_TEST_APPLICATION_ID = 'dsh-web-test'

/** Data-root directory this application creates beside the official Harness home. */
export const WEB_TEST_DATA_ROOT_DIR = '.dsh-web-test'

/** Profile this application owns inside its own data root. */
export const WEB_TEST_PROFILE_NAME = 'web-test'

/** Profile the official product owns inside the shared Harness home. */
export const OFFICIAL_DESKTOP_PROFILE_NAME = 'desktop'

/** Bootstrap variable that selects the data root every harness service resolves. */
export const DSH_HOME_ENV = 'DSH_HOME'

/** Runtime switch the harness reads at boot to keep the Session-log exporter closed. */
export const DSH_TELEMETRY_DISABLED_ENV = 'DSH_TELEMETRY_DISABLED'

/**
 * Bootstrap variable that announces this application to a shell carrying it. A
 * launcher that applies {@link WebTestApplication.launchEnvironment} hands the
 * shell this marker, so the shell resolves this application's own data root,
 * profile, and browser `userData` instead of the official product's.
 */
export const WEB_TEST_IDENTITY_ENV = 'DSH_WEB_TEST_IDENTITY'

/** Update channel this application publishes and checks; the official product keeps its own. */
export const WEB_TEST_UPDATE_CHANNEL = 'web-test'

/** Bundles this application's profile selects: the shared core plus the desktop surface. */
export const WEB_TEST_PROFILE_BUNDLES: readonly string[] = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
]

/** Directory under the data root that holds every profile. */
const PROFILES_DIR = 'profiles'

/** Directory under the data root that holds Electron user data. */
const BROWSER_DIR = 'browser'

/** Directory name Electron reads as `userData` for this application. */
const USER_DATA_DIR = 'user-data'

/** File under the data root holding the registered release identity. */
const RELEASE_IDENTITY_FILENAME = 'release.json'

/** Profile manifest file name inside a profile directory. */
const PROFILE_MANIFEST_FILENAME = 'package.json'

/** Name this package publishes, and the only manifest it accepts as its own. */
const PACKAGE_NAME = '@deepseek-ai/dsh-web-test'

/** Shipped composition layer, read from the package root. */
const COMPOSITION_LAYER_FILENAME = 'web-test.cordis.patch.yml'

/** Built service entry the shipped composition layer mounts, under the package root. */
const ENTRY_RELATIVE_PATH = join('lib', 'index.js')

/** Inputs to {@link resolveWebTestApplication}; every field has a default. */
export interface WebTestApplicationOptions {
  /** Directory that holds the data root; defaults to the operating-system home. */
  base?: string
  /** Data-root directory name under `base`; defaults to `.dsh-web-test`. */
  dataRootName?: string
  /** Profile directory name under the data root's `profiles`; defaults to `web-test`. */
  profileName?: string
  /** Identity recorded in this application's own artifacts. */
  applicationId?: string
  /** Update channel this application publishes and checks. */
  updateChannel?: string
  /**
   * Harness home the application must not reuse. A launcher reads it with
   * {@link readOfficialHome} before it applies {@link WebTestApplication.launchEnvironment};
   * omitted means the launcher makes no comparison.
   */
  officialHome?: string
}

/** Resolved application identity and the paths its own install owns. */
export interface WebTestApplication {
  /** Identity recorded in this application's own artifacts. */
  readonly applicationId: string
  /** Version of the package that owns this application. */
  readonly version: string
  /** Update channel this application publishes and checks. */
  readonly updateChannel: string
  /** Loader entry id this application owns in every composition that mounts it. */
  readonly entryId: WebTestEntryId
  /** `file:` URL of this package's built service entry, which the composition layer mounts. */
  readonly entryUrl: string
  /** Absolute path of this package's shipped composition layer, which a launcher passes as a patch file. */
  readonly compositionLayerPath: string
  /** Data root of this application; every harness service resolves storage under it. */
  readonly home: string
  /** Profile this application owns inside its own data root. */
  readonly profileName: string
  /** Absolute profile directory, outside the official product's profile tree. */
  readonly profileDir: string
  /** Absolute browser `userData` directory inside this application's data root. */
  readonly userDataDir: string
  /** Absolute path of the registered release identity inside the data root. */
  readonly releaseIdentityPath: string
  /** Environment a launcher applies so the runtime resolves this application's data root. */
  readonly launchEnvironment: Readonly<NodeJS.ProcessEnv>
}

/** Release identity the registration writes into the application's own data root. */
export interface WebTestReleaseIdentity {
  /** Schema version of this record. */
  readonly schemaVersion: 1
  /** Identity of the registered application. */
  readonly applicationId: string
  /** Version of the package that owns this application. */
  readonly version: string
  /** Update channel this application publishes and checks. */
  readonly updateChannel: string
  /** Data root the registered application owns. */
  readonly home: string
  /** Profile the registered application owns. */
  readonly profileName: string
  /** Browser `userData` directory the registered application owns. */
  readonly userDataDir: string
  /** Loader entry id this application owns. */
  readonly entryId: WebTestEntryId
  /** Composition layer a launcher passes so the entry mounts and egress stays closed. */
  readonly compositionLayerPath: string
}

/** One Loader entry, as the tree reports it. */
export interface WebTestLoaderEntry {
  /** Row identity the composition declared. */
  readonly options: { readonly id?: WebTestEntryId }
  /** Fiber that runs the row; disposing it stops the row and unregisters its services. */
  readonly fiber?: { dispose(): void }
}

/** The Loader tree this application releases its own entry through. */
export interface WebTestEntryRelease {
  /** Every entry the tree holds, nested groups included. */
  entries(): Iterable<WebTestLoaderEntry>
}

/** Whether a parsed value is a plain record, so file data can be read field by field. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An install of this package, and the directory its own files live in. */
interface WebTestPackageInstall {
  /** Directory holding this package's manifest, composition layer, and built entry. */
  readonly root: string
  /** Version the release identity records. */
  readonly version: string
}

/**
 * Read the install manifest at `root`, or `undefined` when the directory holds
 * none. The manifest is a file on disk this package does not write, so an
 * unreadable or non-record one is reported as "no install here" and never
 * thrown: a caller that has a second anchor must still be able to try it.
 * @param root - directory that may hold an install's `package.json`.
 * @returns the parsed manifest, or `undefined` when the directory holds none.
 */
function readInstallManifest(root: string): Record<string, unknown> | undefined {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch {
    /* v8 ignore start -- reached only from a module a bundle inlined, whose directory holds no readable manifest */
    // Every read and parse failure means the same thing to the caller: there is
    // no install manifest to trust at that path.
    return undefined
    /* v8 ignore stop */
  }
  /* v8 ignore next -- this file is the package scope of a loaded module, which Node already parsed as an object */
  return isRecord(manifest) ? manifest : undefined
}

/**
 * This package's install at `root`, or `undefined` when that directory holds a
 * different package or none. The manifest name is what proves the directory is
 * this package's own and not a neighbour's.
 * @param root - directory that may hold this package's install.
 * @returns the install, or `undefined` when `root` is not one.
 */
function installAt(root: string): WebTestPackageInstall | undefined {
  const manifest = readInstallManifest(root)
  /* v8 ignore next -- a source import always names this install; a directory that does not is reached only from a bundle */
  if (manifest === undefined || manifest.name !== PACKAGE_NAME) return undefined
  /* v8 ignore next -- a manifest declaring this package's name is an installable manifest, which declares a version */
  if (typeof manifest.version !== 'string') return undefined
  return { root, version: manifest.version }
}

/* v8 ignore start -- reached only from a module a bundle inlined; the built-file regression
   apps/desktop/tests/web-test-bundle-resolution.spec.ts covers this against the real bundle */
/**
 * The install of this package that the importing module resolves by name, or
 * `undefined` when it resolves none. This is the anchor that survives being
 * inlined: the importing application is what declares this package among its
 * own dependencies, and that declaration is what names this install. A package
 * manager that links the install through a symlink resolves the link's own
 * spelling, so the manifest is resolved again to report the real directory.
 * @returns the named install, or `undefined` when the importer declares none.
 */
function namedInstall(): WebTestPackageInstall | undefined {
  let manifestPath: string
  try {
    manifestPath = fileURLToPath(import.meta.resolve(`${PACKAGE_NAME}/package.json`))
  } catch {
    // The importing module resolves no such package, so it declares none and
    // there is no install to find.
    return undefined
  }
  return installAt(dirname(realpathSync(manifestPath)))
}
/* v8 ignore stop */

/**
 * This package's own install: the directory its manifest, composition layer, and
 * built entry live in, together with the version its release identity records.
 *
 * The module's own location answers this whenever the package is loaded as
 * itself, from `src/` or from its built `lib/`. A bundler that inlines a
 * workspace devDependency into an application — the Desktop main bundle does,
 * because this package is not among the manifest `dependencies` it ships —
 * leaves `import.meta.url` naming that application instead, and a walk upward
 * from there reaches the application's own manifest, never this package's. The
 * module's directory is therefore accepted only when its manifest declares this
 * package, and otherwise the install is the one the importing module resolves by
 * the name this package publishes.
 * @returns the verified install.
 * @throws when neither anchor names an install of this package, which is an
 * application that inlined this module without declaring it. The shipped layer
 * cannot be read then, and a launch that cannot read it is refused rather than
 * pointed at a directory that holds no such file.
 */
function resolveOwnInstall(): WebTestPackageInstall {
  const besideModule = installAt(dirname(dirname(fileURLToPath(import.meta.url))))
  /* v8 ignore next -- a source import always names this install, so the fallback is a bundled module's path */
  if (besideModule !== undefined) return besideModule
  /* v8 ignore start -- reached only from a module a bundle inlined, where the module's own
     directory names another application; namedInstall covers this built-file regression */
  const named = namedInstall()
  if (named !== undefined) return named
  throw new Error(
    `web-test: ${PACKAGE_NAME} is installed neither beside ${fileURLToPath(import.meta.url)} nor under any `
    + `dependency of it, so its ${COMPOSITION_LAYER_FILENAME} cannot be read; an application that inlines this `
    + `module must declare ${PACKAGE_NAME} in its own dependencies`,
  )
  /* v8 ignore stop */
}

/**
 * Reject a name that is not one directory segment, so a configured name cannot escape
 * the directory this application owns.
 * @param label - field name used in the diagnostic.
 * @param value - configured name.
 * @returns the validated name.
 * @throws when the name is empty, relative, or contains a path separator.
 */
function requireDirectoryName(label: string, value: string): string {
  if (value === '' || value === '.' || value === '..' || /[/\\]/.test(value)) {
    throw new Error(`web-test: ${label} must be one directory name, got ${JSON.stringify(value)}`)
  }
  return value
}

/** Read a harness-home override, treating a blank value as unset. */
function presentHome(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value
}

/**
 * Read the official Harness home a launcher must not reuse, which is the home in
 * effect before it applies this application's launch environment. Once that
 * environment is applied the variable already names this application's own root,
 * so a launcher reads the value first.
 * @param env - environment to read; defaults to `process.env`.
 * @returns the ambient harness home, or `undefined` when none is set.
 */
export function readOfficialHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return presentHome(env[DSH_HOME_ENV])
}

/**
 * Resolve this application's own install: identity, data root, profile, browser user
 * data, and the launch environment a launcher must apply before the runtime resolves
 * any path. Resolution reads the package manifest; it creates nothing.
 * @param options - base directory, names, identity, and the official home to avoid.
 * @returns the frozen resolved application identity.
 * @throws when a configured name is not one directory segment, when the profile would
 * be the official product's, when the data root would be the official Harness home, or
 * when this package's own install cannot be resolved from the module that read it.
 */
export function resolveWebTestApplication(options: WebTestApplicationOptions = {}): WebTestApplication {
  const dataRootName = requireDirectoryName('dataRootName', options.dataRootName ?? WEB_TEST_DATA_ROOT_DIR)
  const profileName = requireDirectoryName('profileName', options.profileName ?? WEB_TEST_PROFILE_NAME)
  if (profileName === OFFICIAL_DESKTOP_PROFILE_NAME) {
    throw new Error(
      `web-test: profileName ${JSON.stringify(OFFICIAL_DESKTOP_PROFILE_NAME)} belongs to the official product `
      + 'inside the shared Harness home; this application owns its own profile',
    )
  }
  const home = resolve(join(resolve(options.base ?? homedir()), dataRootName))
  const officialHome = presentHome(options.officialHome)
  if (officialHome !== undefined && home === resolve(officialHome)) {
    throw new Error(
      `web-test: data root ${home} is the official Harness home; this application must own a separate one `
      + 'so both products may be installed side by side',
    )
  }
  const install = resolveOwnInstall()
  return Object.freeze({
    applicationId: options.applicationId ?? WEB_TEST_APPLICATION_ID,
    version: install.version,
    updateChannel: options.updateChannel ?? WEB_TEST_UPDATE_CHANNEL,
    entryId: WEB_TEST_ENTRY_ID,
    entryUrl: pathToFileURL(join(install.root, ENTRY_RELATIVE_PATH)).href,
    compositionLayerPath: join(install.root, COMPOSITION_LAYER_FILENAME),
    home,
    profileName,
    profileDir: join(home, PROFILES_DIR, profileName),
    userDataDir: join(home, BROWSER_DIR, USER_DATA_DIR),
    releaseIdentityPath: join(home, RELEASE_IDENTITY_FILENAME),
    launchEnvironment: Object.freeze({
      [DSH_HOME_ENV]: home,
      [DSH_TELEMETRY_DISABLED_ENV]: '1',
      [WEB_TEST_IDENTITY_ENV]: '1',
    }),
  })
}

/**
 * Whether an environment names this application, which is what a shell reads
 * before it resolves any Electron-owned path: the official product shares one
 * Harness home with an npm-installed `dsh`, and this application owns a
 * separate data root, profile, and browser `userData`. A blank value is unset,
 * so an exported-but-empty variable never selects this application's install.
 * @param env - environment to read; defaults to `process.env`.
 * @returns true only when the launch environment named this application.
 */
export function isWebTestApplication(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[WEB_TEST_IDENTITY_ENV] ?? '').trim() !== ''
}

/** Build the profile manifest this application's own profile resolves its bundles from. */
function profileManifest(application: WebTestApplication): Record<string, unknown> {
  return {
    name: `dsh-profile-${application.profileName}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...WEB_TEST_PROFILE_BUNDLES] } },
  }
}

/** Build the release identity a shell or updater reads to find this application's install. */
function releaseIdentity(application: WebTestApplication): WebTestReleaseIdentity {
  return {
    schemaVersion: 1,
    applicationId: application.applicationId,
    version: application.version,
    updateChannel: application.updateChannel,
    home: application.home,
    profileName: application.profileName,
    userDataDir: application.userDataDir,
    entryId: application.entryId,
    compositionLayerPath: application.compositionLayerPath,
  }
}

/**
 * Register this application's install inside its own data root: the data root, its
 * profile directory and manifest, the browser `userData` directory, and the release
 * identity. An existing profile manifest is never overwritten, so a person's own edits
 * survive a re-registration.
 * @param application - resolved identity from {@link resolveWebTestApplication}.
 * @returns the effect disposer that removes exactly the paths this registration created.
 */
export function registerWebTestApplication(application: WebTestApplication): () => void {
  const manifestPath = join(application.profileDir, PROFILE_MANIFEST_FILENAME)
  const created = new Set<string>()
  for (const dir of [
    application.home, application.profileDir, application.userDataDir,
    join(application.home, 'attachments'), join(application.home, 'downloads'), join(application.home, 'staging'),
  ]) {
    if (!existsSync(dir)) created.add(dir)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, `${JSON.stringify(profileManifest(application), undefined, 2)}\n`, { mode: 0o600 })
    created.add(manifestPath)
  }
  writeFileSync(
    application.releaseIdentityPath,
    `${JSON.stringify(releaseIdentity(application), undefined, 2)}\n`,
    { mode: 0o600 },
  )
  return () => {
    for (const path of [...created].sort((left, right) => right.length - left.length)) {
      rmSync(path, { recursive: true, force: true })
    }
    created.clear()
  }
}

/**
 * Assert that a booted runtime resolved this application's data root rather than the
 * official product's shared one. A clean boot proves nothing on its own, so a launcher
 * checks the resolved root against the identity it registered.
 * @param application - resolved identity from {@link resolveWebTestApplication}.
 * @param resolvedHome - data root the booted runtime resolved for storage and settings.
 * @throws when the resolved data root is not this application's own.
 */
export function assertWebTestDataRoot(application: WebTestApplication, resolvedHome: string): void {
  if (resolve(resolvedHome) !== application.home) {
    throw new Error(
      `web-test: the running data root ${resolve(resolvedHome)} is not this application's ${application.home}; `
      + `apply ${JSON.stringify(application.launchEnvironment)} before the runtime resolves any path`,
    )
  }
}

/**
 * Release the Loader entry this application owns, so a disposal leaves no running
 * registration behind: the row stops, its service unregisters, and it no longer
 * appears in the request package inventory. The row stays in the composition that
 * declared it, which is that configuration's own record.
 * @param loader - the running Loader tree.
 * @param entryId - owned entry id; defaults to {@link WEB_TEST_ENTRY_ID}.
 * @throws when the tree holds no active entry with that id.
 */
export function releaseWebTestEntry(loader: WebTestEntryRelease, entryId: WebTestEntryId = WEB_TEST_ENTRY_ID): void {
  const entry = [...loader.entries()].find(candidate => candidate.options.id === entryId)
  if (entry?.fiber === undefined) {
    throw new Error(`web-test: the Loader holds no active entry ${JSON.stringify(entryId)}`)
  }
  entry.fiber.dispose()
}
