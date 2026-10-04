/**
 * Identity a desktop shell hands its Host child, and the checks a booted tree
 * must pass before this Host reports ready.
 *
 * The shell owns the Electron side of an install — the browser `userData`
 * directory, the profile directory, and the lock — and passes the two facts the
 * child cannot derive on its own: the composition layer it must apply as its own
 * patch file, and the Loader entry that layer mounts. The child never guesses:
 * a handoff that names a layer but not its entry or data root is a shell that
 * resolved a half-written identity, so the Host refuses it instead of booting the
 * official product's composition under another application's name.
 */

import { isAbsolute, resolve } from 'node:path'

/**
 * Environment variable carrying the composition layer this Host must apply.
 * The shell writes both names from `apps/desktop/src/paths.ts`, which this
 * process cannot import; `apps/desktop/tests/web-test-shell-launch.spec.ts`
 * hands a handoff built there to {@link readDesktopHostIdentity} and reads it
 * back, so a rename on either side fails a test rather than passing silently.
 */
export const DESKTOP_HOST_LAYER_ENV = 'DSH_WEB_TEST_COMPOSITION_LAYER'

/** Environment variable carrying the Loader entry id that layer must mount. */
export const DESKTOP_HOST_ENTRY_ENV = 'DSH_WEB_TEST_ENTRY_ID'

/** Facts this Host was launched to boot under. */
export interface DesktopHostIdentity {
  /** Composition layer passed to the profile boot as the launcher's own patch file. */
  readonly compositionLayer: string
  /** Loader entry id the booted tree must hold. */
  readonly entryId: string
  /** Data root the shell pinned for this Host, which the booted runtime must resolve. */
  readonly home: string
}

/** The profile-context name every desktop composition carries, whichever install booted it. */
export const DESKTOP_PROFILE_CONTEXT_NAME = 'desktop'

/** The profile boot this Host issues: the composition layers and the profile-context name. */
export interface DesktopHostBootRequest {
  /** Profile-context name; the web-app bundle's product rows gate on it. */
  readonly profile: string
  /** Command-line overlays above user patches. */
  readonly patchFiles: readonly string[]
  /** Application composition applied before user patches. */
  readonly applicationPatchFiles: readonly string[]
}

/** Read an environment value, treating a blank value as unset. */
function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value
}

/**
 * Read the identity a desktop shell handed this Host.
 *
 * Absence is the official product: it composes no owned layer and mounts no
 * owned entry, so the Host asserts nothing about the tree it boots. A present
 * layer without its entry or data root is refused, because a Host that mounted
 * nothing would report a healthy application that never became this one.
 *
 * A relative layer is refused for the same reason. The profile boot applies a
 * layer by path, so a relative one is read against this child's working
 * directory — the profile directory — instead of the install that owns it, and
 * the failure surfaces as an unrelated missing file in a directory no
 * application registered. This handoff is written by a process that resolved
 * the layer from a package's own install, so a relative value there is an
 * unresolved identity, not a path this Host may interpret.
 * @param env - environment inherited from the shell; defaults to `process.env`.
 * @returns the identity, or undefined for the official product.
 * @throws when a handoff names a layer without the entry id or data root it belongs to, or names a relative layer.
 */
export function readDesktopHostIdentity(env: NodeJS.ProcessEnv = process.env): DesktopHostIdentity | undefined {
  const compositionLayer = present(env[DESKTOP_HOST_LAYER_ENV])
  if (compositionLayer === undefined) return undefined
  if (!isAbsolute(compositionLayer)) {
    throw new Error(
      `desktop host: ${DESKTOP_HOST_LAYER_ENV} names ${JSON.stringify(compositionLayer)}, which is relative. `
      + 'The profile boot applies a layer by path, so a relative one would be read against this child\'s working '
      + 'directory rather than the install that owns it, and the shell must hand over an absolute path',
    )
  }
  const entryId = present(env[DESKTOP_HOST_ENTRY_ENV])
  if (entryId === undefined) {
    throw new Error(
      `desktop host: ${DESKTOP_HOST_LAYER_ENV} names ${compositionLayer} but ${DESKTOP_HOST_ENTRY_ENV} is unset, `
      + 'so this Host cannot tell whether the layer applied and refuses to boot',
    )
  }
  const home = present(env['DSH_HOME'])
  if (home === undefined) {
    throw new Error(
      `desktop host: ${DESKTOP_HOST_LAYER_ENV} names ${compositionLayer} but DSH_HOME is unset, `
      + 'so this Host cannot tell which data root it was launched for and refuses to boot',
    )
  }
  return { compositionLayer, entryId, home: resolve(home) }
}

/**
 * Compose the profile boot for a resolved identity.
 *
 * The profile-context name stays `desktop` whatever install booted it. The
 * web-app bundle enables `desktop-product-telemetry`, `product-analytics`, and
 * `ui-sidebar-browser` only under that name, so a name that flipped to the
 * Web testing one would disable all three, the Browser sidebar included, and
 * mount no owned entry: the same disabled telemetry rows as the layer, for the
 * wrong reason. The layer is what closes the product egress, and the mounted
 * entry is the tell that separates the two.
 * @param identity - the shell's handoff, or undefined for the official product.
 * @returns the profile-context name and the patch layers the boot applies.
 */
export function desktopHostBootRequest(identity: DesktopHostIdentity | undefined): DesktopHostBootRequest {
  return {
    profile: DESKTOP_PROFILE_CONTEXT_NAME,
    patchFiles: [],
    applicationPatchFiles: identity === undefined ? [] : [identity.compositionLayer],
  }
}

/** What a booted runtime reports about the install it actually came up under. */
export interface DesktopHostBootedTree {
  /** Data root the booted runtime's own home resolver returned. */
  readonly home: string
  /** Ids of the Loader entries the booted tree holds. */
  readonly entryIds: readonly string[]
}

/**
 * Check a booted tree against the identity it was launched with. A clean start
 * shows nothing on its own, so the Host reads the tree's own data root and
 * entries rather than trusting the composition it asked for.
 * @param identity - the identity this Host was launched under.
 * @param booted - the data root and entry ids read from the booted tree.
 * @throws when the tree resolved another data root, or never mounted the owned entry.
 */
export function assertDesktopHostLaunched(identity: DesktopHostIdentity, booted: DesktopHostBootedTree): void {
  if (resolve(booted.home) !== identity.home) {
    throw new Error(
      `desktop host: the running data root ${resolve(booted.home)} is not the ${identity.home} this Host was `
      + 'launched for, so the composition would serve another install and the boot is refused',
    )
  }
  if (booted.entryIds.includes(identity.entryId)) return
  throw new Error(
    `desktop host: the booted tree holds no ${JSON.stringify(identity.entryId)} entry, so the composition layer `
    + `${identity.compositionLayer} did not apply and this application did not mount`,
  )
}
