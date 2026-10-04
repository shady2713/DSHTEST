/**
 * The shell runs as the Web testing application because a development launch
 * applies its launch environment before Electron starts, and that identity
 * reaches both the Electron-owned paths and the Host child the shell spawns.
 *
 * The assertions below stop at the environment the child inherits: opening a
 * window is a supervised step, and everything the branch decides — the data
 * root, the browser `userData`, the composition layer, and the entry the Host
 * refuses to report ready without — is decided before a process exists.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  assertDesktopHostLaunched,
  desktopHostBootRequest,
  readDesktopHostIdentity,
  type DesktopHostIdentity,
} from '../../desktop-host/src/desktop-identity.ts'
import { DSH_HOME_ENV, DSH_TELEMETRY_DISABLED_ENV, WEB_TEST_IDENTITY_ENV } from '@deepseek-ai/dsh-web-test'
import { afterEach, describe, expect, it } from 'vitest'
import { developmentShellEnvironment } from '../scripts/dev.ts'
import { prepareWebTestShellLaunch, type WebTestShellLaunch } from '../scripts/web-test-launch.ts'
import { desktopHostEnvironment, resolveDesktopApplication } from '../src/paths.ts'

const roots: string[] = []
const launches: WebTestShellLaunch[] = []

afterEach(() => {
  for (const launch of launches.splice(0)) launch.release()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** An empty directory this launch may own for the duration of one test. */
function base(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-web-test-launch-'))
  roots.push(root)
  return root
}

/** A launch prepared against a private environment, so no test mutates `process.env`. */
interface Prepared {
  readonly launch: WebTestShellLaunch
  readonly env: NodeJS.ProcessEnv
}

/** Apply the Web testing identity to a fresh environment over a private data root. */
function prepare(): Prepared {
  const env: NodeJS.ProcessEnv = {}
  const launch = prepareWebTestShellLaunch({ base: base(), env })
  launches.push(launch)
  return { launch, env }
}

/** The identity the Host read, refusing a handoff that named no install. */
function hostIdentity(env: NodeJS.ProcessEnv): DesktopHostIdentity {
  // The handoff as `main.ts` builds it: the identity this shell resolved, and
  // the data root the launching environment put in the inherited variables.
  const handoff = { ...desktopHostEnvironment(resolveDesktopApplication(env)), DSH_HOME: env[DSH_HOME_ENV] }
  const identity = readDesktopHostIdentity(handoff)
  if (identity === undefined) throw new Error('web-test shell launch: the handoff named no install')
  return identity
}

describe('the launch that makes the identity branch reachable', () => {
  it('applies a launch environment the shell resolves as this application', () => {
    const { launch, env } = prepare()

    // The identity marker is what `src/paths.ts` branches on, and nothing in
    // this app wrote it before a launcher did.
    expect(env[WEB_TEST_IDENTITY_ENV]).toBe('1')
    expect(env[DSH_HOME_ENV]).toBe(launch.application.home)
    expect(env[DSH_TELEMETRY_DISABLED_ENV]).toBe('1')

    const application = resolveDesktopApplication(env)
    expect(application.applicationId).toBe('dsh-web-test')
    // Every Electron-owned path moves under the new data root, and Electron
    // reads them while this shell's modules load.
    expect(application.paths.userData).toBe(launch.application.userDataDir)
    expect(application.paths.profile).toBe(launch.application.profileDir)
  })

  it('refuses a data root the ambient environment already names', () => {
    const root = base()

    // A developer who exports the official `DSH_HOME` must not have it reused.
    expect(() => prepareWebTestShellLaunch({ base: root, env: { [DSH_HOME_ENV]: resolve(join(root, '.dsh-web-test')) } }))
      .toThrow(/is the official Harness home/)
  })

  it('registers the install the launch booted under', () => {
    const { launch } = prepare()

    expect(existsSync(launch.application.userDataDir)).toBe(true)
    expect(readFileSync(join(launch.application.profileDir, 'package.json'), 'utf8')).toContain('"name": "dsh-profile-web-test"')
    expect(existsSync(launch.application.releaseIdentityPath)).toBe(true)
  })

  it('leaves nothing behind when the registration is released', () => {
    const { launch } = prepare()

    launch.release()
    launches.splice(launches.indexOf(launch), 1)

    expect(existsSync(launch.application.profileDir)).toBe(false)
    expect(existsSync(launch.application.userDataDir)).toBe(false)
  })
})

describe('the environment the Electron child inherits', () => {
  it('carries the identity, so the child resolves the install the launcher registered', () => {
    const { launch } = prepare()

    const { environment, home, userData } = developmentShellEnvironment(false, launch.identity)
    expect({ home, userData }).toEqual({ home: launch.application.home, userData: launch.application.userDataDir })
    expect(environment[WEB_TEST_IDENTITY_ENV]).toBe('1')
    expect(environment[DSH_HOME_ENV]).toBe(launch.application.home)
    expect(resolveDesktopApplication(environment).applicationId).toBe('dsh-web-test')
  })

  it('leaves a launch without an identity as the official product', () => {
    const { environment } = developmentShellEnvironment(false)

    expect(resolveDesktopApplication(environment).applicationId).toBe('dsh-desktop')
    // Nothing is handed to the Host, so its composition is unchanged.
    expect(resolveDesktopApplication(environment).host).toBeUndefined()
  })
})

describe('the handoff the Host child reads', () => {
  it('names the layer the Host applies and the entry that layer must mount', () => {
    const { launch, env } = prepare()

    const identity = hostIdentity(env)
    expect(identity).toEqual({
      compositionLayer: launch.application.compositionLayerPath,
      entryId: launch.application.entryId,
      home: launch.application.home,
    })

    const request = desktopHostBootRequest(identity)
    expect(request.profile).toBe('desktop')
    expect(request.applicationPatchFiles).toEqual([launch.application.compositionLayerPath])
    // The layer is a patch file the runtime's own loader opens by path.
    expect(existsSync(launch.application.compositionLayerPath)).toBe(true)
  })

  it('passes the Host launch check for a tree that mounted the entry and fails one that did not', () => {
    const { launch, env } = prepare()
    const identity = hostIdentity(env)
    const entryIds = [launch.application.entryId]

    expect(() => { assertDesktopHostLaunched(identity, { home: launch.application.home, entryIds }) }).not.toThrow()
    expect(() => { assertDesktopHostLaunched(identity, { home: launch.application.home, entryIds: [] }) })
      .toThrow(/holds no "web-test" entry/)
  })
})
