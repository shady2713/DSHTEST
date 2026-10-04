/** Build and launch the unpackaged Electron shell against the current workspace. */

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { DesktopRelease } from '../src/release.ts'
import { developmentRuntimeDirectory, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { prepareDevelopmentProject } from './development-project.ts'
import { prepareDevelopmentApp } from './development-app.ts'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const DEVELOPMENT_ROOT = join(BUILD_ROOT, 'development')

interface PackageManifest {
  readonly version?: string
}

function packageVersion(path: string, subject: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  if (typeof manifest.version !== 'string') throw new Error(`desktop development: ${subject} has no version`)
  return manifest.version
}

function debugPort(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`)
  }
  return port
}

/** Debug ports a development launch opens; `--no-debug` chooses none of them. */
export interface DebugPorts {
  readonly main?: number
  readonly renderer?: number
  readonly host?: number
}

function debugPorts(debug: boolean): DebugPorts {
  if (!debug) return {}
  return {
    main: debugPort('DSH_DESKTOP_MAIN_INSPECT_PORT', 9229),
    renderer: debugPort('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222),
    host: debugPort('DSH_DESKTOP_HOST_INSPECT_PORT', 9230),
  }
}

const DEBUG_ENVIRONMENT_KEYS = [
  'DSH_DESKTOP_MAIN_INSPECT_PORT',
  'DSH_DESKTOP_RENDERER_DEBUG_PORT',
  'DSH_DESKTOP_HOST_INSPECT_PORT',
] as const

/**
 * Drop the port variables from the environment a child process inherits.
 * @param environment - the launching environment.
 * @param debug - whether this launch chose its own ports; a debug launch keeps them.
 * @returns the environment without any inherited debug port.
 */
function withoutInheritedDebug(environment: NodeJS.ProcessEnv, debug: boolean): NodeJS.ProcessEnv {
  if (debug) return environment
  const kept = { ...environment }
  for (const key of DEBUG_ENVIRONMENT_KEYS) delete kept[key]
  return kept
}

async function run(command: string, args: readonly string[], cwd: string, environment = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop development: ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function runPackageScript(script: string, cwd: string): Promise<void> {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('desktop development: invoke this launcher through pnpm run dev:desktop or start:desktop, or through a carrier such as dev:web-test')
  }
  await run(process.execPath, [packageManager, 'run', script], cwd)
}

/**
 * The paths and environment one application identity pins for a development
 * launch. A launch without an identity is the official product, and falls back
 * to the disposable development directories.
 */
export interface DevelopmentShellIdentity {
  /** Harness home the shell and its Host child resolve every path under. */
  readonly home: string
  /** Electron `userData` directory the browser profile opens in. */
  readonly userData: string
  /** Variables the identity adds to what Electron inherits. */
  readonly environment: Readonly<NodeJS.ProcessEnv>
}

/** What one development launch hands Electron, resolved before anything spawns. */
export interface DevelopmentShellEnvironment {
  /** Environment the Electron child inherits. */
  readonly environment: NodeJS.ProcessEnv
  /** Harness home the launch reports and pins as `DSH_HOME`. */
  readonly home: string
  /** Electron `userData` directory the launch opens the browser profile in. */
  readonly userData: string
  /** Inspector ports this launch opened. */
  readonly ports: DebugPorts
}

/**
 * Resolve the environment an unpackaged launch hands Electron. An identity
 * outranks `DSH_HOME` and `DSH_DESKTOP_USER_DATA_DIR`, because those name the
 * official product's paths and a shell launched as another application resolves
 * its own.
 * @param debug - whether this launch chose its own inspector ports.
 * @param identity - install the launch runs as; omitted launches the official product.
 * @returns the child environment with the home, userData directory, and ports it names.
 */
export function developmentShellEnvironment(debug: boolean, identity?: DevelopmentShellIdentity): DevelopmentShellEnvironment {
  const ports = debugPorts(debug)
  const home = resolve(identity?.home ?? process.env.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
  const userData = resolve(identity?.userData ?? process.env.DSH_DESKTOP_USER_DATA_DIR ?? join(DEVELOPMENT_ROOT, 'electron-user-data'))
  return {
    home,
    userData,
    ports,
    // A port this launch did not choose is removed from the inherited
    // environment, so `--no-debug` cannot be defeated by an exported value.
    environment: {
      ...withoutInheritedDebug(process.env, debug),
      DSH_HOME: home,
      DSH_DESKTOP_PRIMARY_RUNTIME_DIR: process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR ?? developmentRuntimeDirectory(),
      DSH_DESKTOP_OPEN_DEVTOOLS: debug ? (process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? '1') : '0',
      ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
      ...identity?.environment,
      ...(ports.host === undefined ? {} : { DSH_DESKTOP_HOST_INSPECT_PORT: String(ports.host) }),
    },
  }
}

async function launchElectron(debug: boolean, identity?: DevelopmentShellIdentity): Promise<void> {
  const require = createRequire(import.meta.url)
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  const { environment, home, userData, ports } = developmentShellEnvironment(debug, identity)
  console.log(`desktop development: DSH_HOME=${home}`)
  console.log(`desktop development: userData=${userData}`)
  console.log(debug
    ? `desktop development: inspectors main=${String(ports.main)}, renderer=${String(ports.renderer)}, host=${String(ports.host)}`
    : 'desktop development: no inspector, no remote debugging port, no devtools')
  if (process.platform === 'darwin') {
    const executable = prepareDevelopmentApp({ electron, appRoot: APP_ROOT, directory: DEVELOPMENT_ROOT, home, userData,
      ...ports, openDevtools: environment.DSH_DESKTOP_OPEN_DEVTOOLS! })
    await run(executable, [], APP_ROOT, environment)
    return
  }
  await run(electron, [
    ...(ports.main === undefined ? [] : [`--inspect=127.0.0.1:${String(ports.main)}`]),
    ...(ports.renderer === undefined ? [] : [`--remote-debugging-port=${String(ports.renderer)}`]),
    `--user-data-dir=${userData}`,
    APP_ROOT,
  ], APP_ROOT, environment)
}

/** One development launch, as its command line and any application identity choose. */
export interface DevelopmentShellOptions {
  /** Reuse the artifacts an earlier build produced instead of building again. */
  readonly skipBuild: boolean
  /** Open the inspector ports and the renderer DevTools. */
  readonly debug: boolean
  /** Install the launch runs as; omitted launches the official product. */
  readonly identity?: DevelopmentShellIdentity
}

/**
 * Build, project, and open the unpackaged Electron shell against the current
 * workspace. This is what `dev:desktop` runs; another carrier that owns its own
 * identity calls it with that identity instead of editing this command line.
 * @param options - build, inspector, and identity choices for this launch.
 * @returns once the shell process has exited.
 */
export async function launchDevelopmentShell(options: DevelopmentShellOptions): Promise<void> {
  if (!options.skipBuild) {
    await runPackageScript('build', REPOSITORY_ROOT)
    await runPackageScript('build', APP_ROOT)
  }
  for (const path of [
    join(APP_ROOT, 'lib', 'main.js'),
    join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js'),
  ]) {
    if (!existsSync(path)) throw new Error(`desktop development: missing built artifact ${path}`)
  }
  const version = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const pnpmVersion = packageVersion(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'pnpm package')
  const release: DesktopRelease = {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: execFileSync(createRequire(import.meta.url)('electron') as string, ['-p', 'process.versions.node'],
      { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).trim(),
    pnpmVersion,
  }
  prepareDevelopmentProject({
    projectDir: join(DEVELOPMENT_ROOT, 'project'),
    cliDir: join(REPOSITORY_ROOT, 'apps', 'cli'),
    hostDir: join(REPOSITORY_ROOT, 'apps', 'desktop-host'),
    dependencyDir: join(REPOSITORY_ROOT, 'node_modules', '.pnpm', 'node_modules'),
    release,
    target: resolveDesktopBuildTarget(),
  })
  await preparePrimaryRuntime()
  await launchElectron(options.debug, options.identity)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'skip-build': { type: 'boolean', default: false },
      'no-debug': { type: 'boolean', default: false },
    },
  })
  await launchDevelopmentShell({ skipBuild: values['skip-build'], debug: !values['no-debug'] })
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
