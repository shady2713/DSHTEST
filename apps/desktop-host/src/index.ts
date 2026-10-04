/** Launch the Desktop profile through the Web application and report its URL to Electron. */

import { delimiter, join } from 'node:path'
import { inspect } from 'node:util'
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import * as desktopOffice from './office.ts'

import { assertDesktopHostLaunched, desktopHostBootRequest, readDesktopHostIdentity } from './desktop-identity.ts'
import { installDesktopUpdateTaskControl } from './update-tasks.ts'
import { installDesktopQuitInspection } from './quit-inspection.ts'
import { installPlatformSessionPublisher } from './platform-session.ts'
import { installOfficeEngineResolution } from './office-engine.ts'
import { installDesktopBrowserAutomation } from './browser-automation.ts'
import { HostBrowserControl, readBrowserControlState } from './browser-control.ts'
import type { DesktopBrowserControlState } from '@deepseek-ai/dsh-client-ui-sidebar-browser'

async function main(): Promise<void> {
  const runtimeDir = process.argv[2] as string
  const projectDir = process.argv[3] as string
  // Read before the boot: the shell resolved the install this Host runs under, and
  // a shell that launched the official product hands over nothing to compose.
  const identity = readDesktopHostIdentity()
  const bootRequest = desktopHostBootRequest(identity)
  installOfficeEngineResolution(runtimeDir)
  const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const profile = loadProfileDirectory('dsh', projectDir, installAnchor)
  reportSkippedBundles('dsh', profile)
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    // The profile directory is the shell's own — the Web testing application's
    // data root carries it when another application launched this shell — while
    // the profile-context name stays the desktop one.
    profile: bootRequest.profile,
    resolvedProfile: { profile, installAnchor },
    patchFiles: bootRequest.patchFiles,
    applicationPatchFiles: bootRequest.applicationPatchFiles,
    args: ['--no-open', '--port', '19387'],
    ...(process.argv[5] === undefined ? {} : {
      packageManager: {
        command: process.execPath,
        args: ['--expose-internals', process.argv[5]],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          PATH: `${process.argv[6] ?? ''}${delimiter}${process.env.PATH ?? ''}`,
        },
      },
    }),
  })
  let stopping: Promise<void> | undefined
  const control: {
    updateTasks?: ReturnType<typeof installDesktopUpdateTaskControl>
    quitInspection?: ReturnType<typeof installDesktopQuitInspection>
    browserControl?: HostBrowserControl
  } = {}
  const send = (message: object): Promise<void> => new Promise((resolve, reject) => {
    if (!process.connected || process.send === undefined) { resolve(); return }
    process.send(message, (error) => { if (error === null) resolve(); else reject(error) })
  })
  // The channel exists for the Host's whole life: a mounted capability connects its
  // generation through it, and shutdown revokes whatever is still waiting.
  const browserAutomation = installDesktopBrowserAutomation(async (message) => {
    if (!process.connected || process.send === undefined) throw new Error('desktop browser automation: Main disconnected')
    await send(message)
  })
  let browserState: DesktopBrowserControlState | undefined
  const stop = (): Promise<void> => stopping ??= (async () => {
    // Settle dispatched commands as unknown even when application startup is pending.
    control.browserControl?.disconnect()
    browserAutomation.dispose()
    // Startup failure is reported by main; shutdown only owns a tree that booted.
    const running = await application.catch(() => undefined)
    await running?.shutdown.shutdown(0)
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect()
  })()
  process.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return
    if (browserAutomation.accept(message)) return
    if (message.type === 'browser-control-state') {
      if (!('state' in message)) throw new Error('desktop browser: Main omitted target state')
      const state = readBrowserControlState(message.state)
      if (state === undefined) throw new Error('desktop browser: Main sent invalid target state')
      browserState = state
      if (control.browserControl !== undefined) control.browserControl.accept(message)
      else browserAutomation.connectHost(state.hostEpoch)
      return
    }
    if (control.browserControl?.accept(message)) return
    if (message.type === 'shutdown') { void stop(); return }
    if (message.type === 'quit-inspection') {
      if (!('requestId' in message) || !Number.isSafeInteger(message.requestId)) return
      const requestId = message.requestId
      void (async () => {
        try {
          if (stopping !== undefined || control.quitInspection === undefined) throw new Error('desktop quit: Host is unavailable')
          const inspection = await control.quitInspection()
          await send({ type: 'quit-inspection', requestId, ...inspection })
        } catch (error) {
          // The shell treats an unknown state as interruptible work and asks before quitting.
          await send({ type: 'quit-inspection', requestId, activeTasks: true, scheduledTasks: false,
            error: error instanceof Error ? error.message : String(error) })
        }
      })().catch((error: unknown) => { console.error(error) })
      return
    }
    if (message.type !== 'update-tasks' || !('requestId' in message) || !Number.isSafeInteger(message.requestId)
      || !('action' in message) || !['inspect', 'lock', 'unlock'].includes(String(message.action))) return
    void (async () => {
      try {
        if (stopping !== undefined || control.updateTasks === undefined) throw new Error('desktop update: Host is unavailable')
        const active = await control.updateTasks(message.action as 'inspect' | 'lock' | 'unlock')
        await send({ type: 'update-tasks', requestId: message.requestId, active })
      } catch (error) {
        await send({ type: 'update-tasks', requestId: message.requestId, active: true,
          error: error instanceof Error ? error.message : String(error) })
      }
    })().catch((error: unknown) => { console.error(error) })
  })
  process.once('disconnect', () => { void stop() })
  await send({ type: 'browser-control-ready' })
  const { ctx } = await application
  await ctx.plugin(HostBrowserControl, { bridge: browserAutomation, send })
  control.browserControl = ctx.desktopBrowserControl as HostBrowserControl
  if (browserState !== undefined) control.browserControl.accept({ type: 'browser-control-state', state: browserState })
  // A shell running as another application asked for a composition this tree must
  // show, so the runtime's own data root and entries are read before any ready
  // event reaches the window: a different root or a missing entry is a failed
  // launch, not a running application.
  if (identity !== undefined) {
    const entryIds = [...ctx.loader.entries()].map(entry => entry.options.id)
    assertDesktopHostLaunched(identity, { home: resolveDshHome(), entryIds })
  }
  control.updateTasks = installDesktopUpdateTaskControl(ctx)
  control.quitInspection = installDesktopQuitInspection(ctx)
  await ctx.plugin(desktopOffice, {
    runtimeDir,
    source: process.argv[4] ?? join(runtimeDir, '..', 'runtime', 'primary-runtime'),
    root: join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime'),
  })
  installPlatformSessionPublisher(ctx, (session) => {
    if (process.connected) process.send?.({ type: 'platform-session', session })
  })
  const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`)
  if (process.connected) process.send?.({ type: 'ready', url, injections: ctx.webServer.collectIndexInjections() }, (error) => { if (error !== null) console.error(error) })
}

/** Upper bound of the startup diagnostic carried over IPC; the head holds the message and stack. */
const MAX_FATAL_DIAGNOSTIC_CHARS = 64 * 1024

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    // The shell receives the complete inspected error here, not through stderr:
    // stderr bytes and this IPC message race, and the shell reports the first
    // failure it sees.
    const diagnostic = inspect(error, { depth: 4, maxArrayLength: 50 }).slice(0, MAX_FATAL_DIAGNOSTIC_CHARS)
    if (process.connected) process.send?.({ type: 'fatal', message, diagnostic }, (error) => { if (error !== null) console.error(error) })
    console.error(error)
    process.exitCode = 1
    if (process.connected) process.disconnect()
  })
}
