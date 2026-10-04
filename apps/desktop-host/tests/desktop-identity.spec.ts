/**
 * The Host reads the identity its shell handed over, composes the layer it names
 * under the desktop profile-context name, and refuses a tree that came up on
 * another data root or never mounted the owned entry.
 */
import { join } from 'node:path'
import { expect, describe, it } from 'vitest'
import {
  assertDesktopHostLaunched,
  desktopHostBootRequest,
  DESKTOP_HOST_ENTRY_ENV,
  DESKTOP_HOST_LAYER_ENV,
  readDesktopHostIdentity,
} from '../src/desktop-identity.ts'

const HOME = 'C:\\data\\.dsh-web-test'
const LAYER = 'C:\\runtime\\dsh-web-test\\web-test.cordis.patch.yml'
const handoff: NodeJS.ProcessEnv = {
  [DESKTOP_HOST_LAYER_ENV]: LAYER,
  [DESKTOP_HOST_ENTRY_ENV]: 'web-test',
  DSH_HOME: HOME,
}

describe('the identity a shell hands its Host', () => {
  it('reads the layer, its entry, and the data root the shell pinned', () => {
    expect(readDesktopHostIdentity(handoff)).toEqual({ compositionLayer: LAYER, entryId: 'web-test', home: HOME })
  })

  it('reports no identity for the official product, which mounts no owned entry', () => {
    // Absence, not a default: the official product composes no layer and asserts
    // nothing about the tree it boots.
    expect(readDesktopHostIdentity({})).toBeUndefined()
    expect(readDesktopHostIdentity({ [DESKTOP_HOST_LAYER_ENV]: '  ' })).toBeUndefined()
    expect(readDesktopHostIdentity({ [DESKTOP_HOST_ENTRY_ENV]: 'web-test' })).toBeUndefined()
  })

  it('refuses a handoff that names a layer without what the layer belongs to', () => {
    // A Host that mounted nothing would report a healthy application that never
    // became the one the shell launched.
    expect(() => readDesktopHostIdentity({ ...handoff, [DESKTOP_HOST_ENTRY_ENV]: ' ' }))
      .toThrow(/names .* but DSH_WEB_TEST_ENTRY_ID is unset/)
    expect(() => readDesktopHostIdentity({ ...handoff, DSH_HOME: undefined }))
      .toThrow(/names .* but DSH_HOME is unset/)
  })

  it('refuses a relative layer, which the profile boot would read against its working directory', () => {
    // The profile boot applies a layer by path, so a relative one is read
    // against this child's working directory — the profile directory — and the
    // failure surfaces as a missing file in a directory no application owns.
    expect(() => readDesktopHostIdentity({ ...handoff, [DESKTOP_HOST_LAYER_ENV]: 'web-test.cordis.patch.yml' }))
      .toThrow(/names "web-test\.cordis\.patch\.yml", which is relative/)
    expect(() => readDesktopHostIdentity({ ...handoff, [DESKTOP_HOST_LAYER_ENV]: join('..', 'layer', 'patch.yml') }))
      .toThrow(/the shell must hand over an absolute path/)
  })
})

describe('the profile boot a resolved identity composes', () => {
  it('applies the layer as the launcher patch while the profile name stays the desktop one', () => {
    const identity = readDesktopHostIdentity(handoff)

    // The web-app bundle enables `desktop-product-telemetry`, `product-analytics`,
    // and `ui-sidebar-browser` only under the `desktop` profile-context name, so
    // the layer — not the name — is what closes the product egress.
    expect(desktopHostBootRequest(identity)).toEqual({ profile: 'desktop', applicationPatchFiles: [LAYER], patchFiles: [] })
  })

  it('composes no layer for the official product', () => {
    expect(desktopHostBootRequest(readDesktopHostIdentity({}))).toEqual({ profile: 'desktop', applicationPatchFiles: [], patchFiles: [] })
  })
})

describe('a booted tree against the identity it was launched with', () => {
  // The handoff a shell hands over is complete, so the absence the official
  // product reports is not a case these checks may pass through.
  const identity = readDesktopHostIdentity(handoff)
  if (identity === undefined) throw new Error('desktop identity: the test handoff is incomplete')

  it('accepts the data root and entry it was launched for', () => {
    expect(() => { assertDesktopHostLaunched(identity, { home: HOME, entryIds: ['other', 'web-test'] }) })
      .not.toThrow()
  })

  it('refuses a runtime that resolved another data root', () => {
    expect(() => { assertDesktopHostLaunched(identity, { home: 'C:\\data\\.dsh', entryIds: ['web-test'] }) })
      .toThrow(/is not the .* this Host was launched for/)
  })

  it('refuses a tree that never mounted the owned entry', () => {
    expect(() => { assertDesktopHostLaunched(identity, { home: HOME, entryIds: [] }) })
      .toThrow(/holds no "web-test" entry, so the composition layer .* did not apply/)
  })
})
