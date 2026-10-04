/**
 * Gate order of the Desktop installation handoff: the chain `main.ts` installs as the coordinator's
 * `beforeRestart`, driven against a fake Host and a real `DesktopUpdateJournal`. The order matters
 * because each step is the only thing standing between a user confirmation and a stopped Host:
 * inspection before the admission lock, a recheck under that lock, admission released whenever the
 * Host is still alive, and the journal record flushed before the shell hands the quit to the
 * installer.
 *
 * The coordinator is replaced by a capture stub, so these tests pin `main.ts` and the real journal,
 * not `electron-updater`. `quitAndInstall` is reached only after this chain resolves true; the
 * coordinator's own handoff is covered by `update-coordinator.spec.ts`.
 */

import { DesktopHostUncleanExitError } from '../src/host-process.ts'
import type { DesktopUpdateState } from '../src/ipc.ts'
import { en } from '../src/locale.ts'
import { DesktopUpdatePreparationError } from '../src/update-error.ts'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

/** One flushed line of the update journal. */
type JournalRecord = { sequence: number; event: string; time: string }

const harness = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  function deferred() {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline })
    return { promise, resolve, reject }
  }
  const windows: FakeWindow[] = []
  const hosts: FakeHost[] = []
  /** Gate steps in the order main.ts performed them, across the Host, Platform, and admission doubles. */
  const trace: string[] = []
  const navigated = deferred()
  const chainInstalled = deferred()
  let prepareUpdate: (() => Promise<boolean>) | undefined
  let updateState: DesktopUpdateState = { phase: 'ready', version: '1.0.1-nightly.1' }
  class FakeWindow extends EventEmitter {
    destroyed = false
    readonly urls: string[] = []
    readonly webContents = Object.assign(new EventEmitter(), {
      id: 42,
      mainFrame: { url: '' },
      setWindowOpenHandler: vi.fn(),
      insertCSS: vi.fn(async () => 'blur'),
      removeInsertedCSS: vi.fn(async () => {}),
      openDevTools: vi.fn(),
      getURL: () => this.urls.at(-1) ?? '',
      getZoomFactor: () => 1,
      isDestroyed: () => this.destroyed,
      setIgnoreMenuShortcuts: vi.fn(),
      focus: vi.fn(),
      sendInputEvent: vi.fn(),
      send: vi.fn(),
    })
    readonly show = vi.fn()
    readonly showInactive = vi.fn()
    readonly hide = vi.fn()
    readonly focus = vi.fn()
    readonly moveTop = vi.fn()
    readonly setMinimumSize = vi.fn()
    readonly getBounds = vi.fn(() => ({ x: 0, y: 0, width: 1280, height: 820 }))
    readonly setSize = vi.fn()
    readonly setTitleBarOverlay = vi.fn()
    readonly setVibrancy = vi.fn()
    readonly setBackgroundColor = vi.fn()
    readonly setMenu = vi.fn()
    constructor(readonly options: { show: boolean; modal?: boolean }) { super(); windows.push(this) }
    isDestroyed() { return this.destroyed }
    isMinimized() { return false }
    isVisible() { return true }
    isFullScreen() { return false }
    setFullScreen() {}
    restore() {}
    setTitle = vi.fn()
    async loadURL(url: string) { this.urls.push(url); this.webContents.mainFrame.url = url; navigated.resolve() }
    static getAllWindows() { return windows.filter(window => !window.destroyed) }
    destroy() { this.destroyed = true; this.emit('closed') }
    close() { this.destroy() }
  }
  class FakeHost {
    readonly updateTasks = vi.fn(async (action: 'inspect' | 'lock' | 'unlock') => {
      trace.push(`tasks:${action}`)
      return false
    })
    readonly inspectQuit = vi.fn(async () => ({ activeTasks: false, scheduledTasks: false }))
    url = 'http://127.0.0.1:3080/?token=test'
    readonly stopping = deferred()
    readonly exited = deferred()
    readonly start = vi.fn(async () => { hosts.push(this); return { url: this.url, injections: [] } })
    readonly stop = vi.fn((_requireCleanStop: boolean) => {
      this.stopping.resolve()
      trace.push('host:stop')
      return this.exited.promise
    })
  }
  const menuBuilder = vi.fn<(template: unknown[]) => { popup: (options: unknown) => void }>(
    () => ({ popup: vi.fn() }))
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    name: 'Desktop gating test',
    whenReady: () => Promise.resolve(),
    getLocale: () => 'en-US',
    getPreferredSystemLanguages: () => ['en-US'],
    getVersion: () => '1.0.0',
    getAppPath: vi.fn<() => string>(() => 'desktop-gating-app'),
    setAppLogsPath: vi.fn(),
    getPath: vi.fn<(name: string) => string>(),
    setAboutPanelOptions: vi.fn(),
    setAsDefaultProtocolClient: vi.fn(),
    isInApplicationsFolder: () => true,
    requestSingleInstanceLock: () => true,
    exit: vi.fn(),
    relaunch: vi.fn(),
    focus: vi.fn(),
    quit: vi.fn(),
  })
  const dialog = {
    showOpenDialog: vi.fn<(options: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>>(),
    showErrorBox: vi.fn(),
    showMessageBox: vi.fn<(options: unknown) => Promise<{ response: number; checkboxChecked: boolean }>>(),
  }
  const platformCloseAndWait = vi.fn(async () => { trace.push('platform:close') })
  const platformDispose = vi.fn(async () => {})
  return {
    windows, hosts, trace, navigated, chainInstalled, FakeWindow, FakeHost,
    app,
    dialog,
    menu: Object.assign(menuBuilder, { buildFromTemplate: menuBuilder, setApplicationMenu: vi.fn() }),
    nativeTheme: { themeSource: 'system', shouldUseDarkColors: false },
    clipboard: { writeText: vi.fn(async () => {}) },
    openExternal: vi.fn(async () => {}),
    protocolHandle: vi.fn(),
    ipcOn: vi.fn(),
    powerMonitor: new EventEmitter(),
    platformCloseAndWait,
    platformDispose,
    get prepareUpdate() { return prepareUpdate! },
    set prepareUpdate(value: () => Promise<boolean>) { prepareUpdate = value },
    get updateState() { return updateState },
    set updateState(value: DesktopUpdateState) { updateState = value },
    reset() {
      windows.length = 0; hosts.length = 0; trace.length = 0
      app.removeAllListeners()
      app.isPackaged = true
      app.quit.mockClear()
      dialog.showMessageBox.mockReset().mockResolvedValue({ response: 1, checkboxChecked: false })
      platformCloseAndWait.mockClear()
      platformDispose.mockClear()
      prepareUpdate = undefined
      updateState = { phase: 'ready', version: '1.0.1-nightly.1' }
    },
  }
})

vi.mock('electron', () => ({
  app: harness.app,
  BrowserWindow: harness.FakeWindow,
  clipboard: harness.clipboard,
  dialog: harness.dialog,
  ipcMain: { on: harness.ipcOn, handle: vi.fn(), removeHandler: vi.fn() },
  Menu: { setApplicationMenu: harness.menu.setApplicationMenu, buildFromTemplate: harness.menu },
  nativeImage: { createFromPath: (path: string) => ({ path }) },
  nativeTheme: harness.nativeTheme,
  net: { fetch: vi.fn() },
  powerMonitor: harness.powerMonitor,
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: harness.protocolHandle },
  session: { defaultSession: {
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    cookies: { get: vi.fn(async () => []) },
    webRequest: { onBeforeSendHeaders: vi.fn() },
  } },
  shell: { openExternal: harness.openExternal },
  Tray: class { setToolTip() {} setContextMenu() {} destroy() {} },
}))

// The shell reads its install before any Electron path is resolved and hands the
// resolved identity to its Host, so this double answers both with the official
// product: Electron keeps its own `userData` and the Host composes no layer.
vi.mock('../src/paths.ts', () => ({
  resolveDesktopPaths: () => ({ profile: 'desktop-gating-profile' }),
  resolveDesktopApplication: () => ({
    applicationId: 'dsh-desktop', home: '/home', paths: { profile: 'desktop-gating-profile' }, host: undefined,
  }),
  desktopHostEnvironment: () => ({}),
}))
vi.mock('../src/runtime-tree.ts', () => ({ readDesktopRuntime: () => ({ release: { version: '1.0.0' } }) }))
vi.mock('../src/project-manager.ts', () => ({ DesktopProjectManager: class {
  readonly applyRelease = vi.fn(async () => {})
  disableAllPlugins = vi.fn(async () => undefined)
} }))
vi.mock('../src/web-document.ts', () => ({
  authenticateWebHost: async () => 'test-cookie',
  forwardWebRequest: vi.fn(),
  serveWebDocument: vi.fn(),
}))
// Crash reporting has its own suite; a boot from here must not write reports.
vi.mock('../src/crash-report.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/crash-report.ts')>(),
  pruneCrashReports: vi.fn(async () => {}),
  writeCrashReport: vi.fn(async () => 'gating-test/crash.log'),
}))
// A real login-shell read spawns a shell; the gate chain only needs its promise settled.
vi.mock('../src/login-shell-environment.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/login-shell-environment.ts')>(),
  readDesktopLoginShellEnvironment: vi.fn(async (base: NodeJS.ProcessEnv) => ({ environment: base, failures: [] })),
}))
vi.mock('../src/host-process.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/host-process.ts')>(),
  DesktopHostProcess: harness.FakeHost,
}))
vi.mock('../src/platform-view.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/platform-view.ts')>(),
  DesktopPlatformView: class {
    notifyLocaleChanged() {}
    setSession() {}
    setBounds() {}
    close() {}
    closeAndWait() { return harness.platformCloseAndWait() }
    dispose() { return harness.platformDispose() }
  },
}))
vi.mock('../src/welcome-backend.ts', () => ({
  connectDesktopWelcome: async () => ({
    analyticsEnabled: async () => false,
    report: vi.fn(async () => {}),
    readLocalePreference: async () => null,
    read: async () => ({ loggedIn: true, hasApiKey: true, localePreference: null }),
    save: async () => ({ ok: true }),
    account: { watch: vi.fn(() => () => {}), state: async () => ({ status: 'signed-out', attempt: null }) },
  }),
}))
// Ordinary feed polling owns its own timers and has its own suite.
vi.mock('../src/update-schedule.ts', () => ({
  resolveDesktopUpdateScheduleConfig: () => ({ intervalMs: 600_000, maxBackoffMs: 3_600_000, jitter: 0 }),
  DesktopUpdateSchedule: class {
    constructor(private readonly updates: { state: DesktopUpdateState }) {}
    async check(): Promise<DesktopUpdateState> { return this.updates.state }
    dispose() {}
  },
}))
vi.mock('../src/update-dialog.ts', () => ({ DesktopUpdateDialog: class {
  isOpen = false
  show(_owner: unknown, options: unknown) { return harness.dialog.showMessageBox(options) }
  cancel() {}
  focus() {}
  dispose() {}
} }))
// The coordinator is replaced so the test can invoke the chain main.ts hands it, which also removes
// the packaged update source the real coordinator requires.
vi.mock('../src/update-coordinator.ts', () => ({ DesktopUpdateCoordinator: class {
  constructor(_publish: unknown, beforeRestart: () => Promise<boolean>) {
    harness.prepareUpdate = beforeRestart
    harness.chainInstalled.resolve()
  }
  get state() { return harness.updateState }
  readonly check = vi.fn(async () => harness.updateState)
  readonly download = vi.fn(async () => harness.updateState)
  readonly install = vi.fn(async () => harness.updateState)
  dispose() {}
} }))

/**
 * Read the journal the booted process wrote into its evidence directory.
 * @param directory - `DSH_DESKTOP_UPDATE_JOURNAL_DIR` the boot used.
 * @returns Every flushed record in write order.
 */
function journalRecords(directory: string): JournalRecord[] {
  const [file] = readdirSync(directory)
  if (file === undefined) throw new Error('gating test: the update journal wrote no file')
  return readFileSync(join(directory, file), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line) as JournalRecord)
}

/**
 * Event names the current run journaled, in write order.
 * @param directory - `DSH_DESKTOP_UPDATE_JOURNAL_DIR` the boot used.
 * @returns The recorded event names.
 */
function journalEvents(directory: string): string[] {
  return journalRecords(directory).map(record => record.event)
}

/**
 * Boot the real main process against the doubles and wait until its backend is serving.
 * @param journalDirectory - Evidence directory the update journal must write into.
 * @returns The single fake Host this run started.
 */
async function boot(journalDirectory: string): Promise<InstanceType<typeof harness.FakeHost>> {
  vi.stubEnv('DSH_DESKTOP_UPDATE_JOURNAL_DIR', journalDirectory)
  await import('../src/main.ts')
  await harness.chainInstalled.promise
  const host = await vi.waitFor(() => {
    const [started] = harness.hosts
    if (started === undefined) throw new Error('gating test: main did not start a Host')
    return started
  })
  await harness.navigated.promise
  return host
}

/**
 * Run the gate and let the fake Host exit cleanly, as a successful stop does.
 * @param host - Host the booted process owns.
 * @returns The chain result once the stop completed.
 */
async function stopCleanly(host: InstanceType<typeof harness.FakeHost>): Promise<boolean> {
  const preparing = harness.prepareUpdate()
  await host.stopping.promise
  host.exited.resolve()
  return preparing
}

let journalDirectory: string

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  harness.reset()
  journalDirectory = mkdtempSync(join(tmpdir(), 'dsh-update-gating-'))
  onTestFinished(() => { rmSync(journalDirectory, { recursive: true, force: true }) })
  // The manifest read at boot is the real one, so no mandatory-update policy is configured.
  harness.app.getAppPath.mockReturnValue(join(import.meta.dirname, '..'))
  harness.app.getPath.mockImplementation(name => name === 'userData' ? journalDirectory : `gating-test-${name}`)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3')
  vi.stubEnv('DSH_DESKTOP_PNPM_ENTRY', 'test-pnpm')
  vi.stubEnv('DSH_DESKTOP_DSH_DIR', 'test-runtime')
  vi.stubEnv('DSH_DESKTOP_PRIMARY_RUNTIME_DIR', 'test-primary-runtime')
  vi.stubEnv('DSH_DESKTOP_MANDATORY_UPDATE_CONFIG', undefined)
  vi.stubEnv('DSH_DESKTOP_OPEN_DEVTOOLS', '0')
  vi.stubGlobal('process', { ...process, platform: 'linux', arch: 'x64', resourcesPath: 'gating-test-resources' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Desktop installation gate order', () => {
  it('inspects the Host before it takes the admission lock, and stops the Host only after both', async () => {
    const host = await boot(journalDirectory)
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })

    await expect(stopCleanly(host)).resolves.toBe(true)
    // The lock is the second admission step; taking it first would race the answer it rechecks under.
    expect(harness.trace).toEqual(['tasks:inspect', 'tasks:lock', 'platform:close', 'host:stop'])
    expect(host.updateTasks.mock.calls).toEqual([['inspect'], ['lock']])
    expect(host.stop.mock.calls).toEqual([[true]])
  })

  it('rechecks under the lock and releases admission when work appeared during the confirmation', async () => {
    const host = await boot(journalDirectory)
    // The first answer is the pre-confirmation inspection, the second the recheck under the lock.
    host.updateTasks.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })

    await expect(harness.prepareUpdate()).rejects.toMatchObject(
      new DesktopUpdatePreparationError('tasks-changed', en.updateTasksChanged))
    expect(host.updateTasks.mock.calls).toEqual([['inspect'], ['lock'], ['unlock']])
    expect(host.stop).not.toHaveBeenCalled()
    expect(journalEvents(journalDirectory)).not.toContain('install-confirmed')
  })

  it('releases admission when stopping the Host fails, leaving the running Host unlocked', async () => {
    const host = await boot(journalDirectory)
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })

    const preparing = harness.prepareUpdate()
    await host.stopping.promise
    host.exited.reject(new Error('child did not exit'))

    await expect(preparing).rejects.toThrow('child did not exit')
    expect(harness.trace).toEqual(['tasks:inspect', 'tasks:lock', 'platform:close', 'host:stop', 'tasks:unlock'])
    expect(journalEvents(journalDirectory)).not.toContain('install-confirmed')
  })

  it('keeps the admission lock when the Host exited but reported an unclean task teardown', async () => {
    const host = await boot(journalDirectory)
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })

    const preparing = harness.prepareUpdate()
    await host.stopping.promise
    host.exited.reject(new DesktopHostUncleanExitError('Task teardown failed after child exit'))

    await expect(preparing).rejects.toMatchObject(new DesktopUpdatePreparationError(
      'stop-failed', en.updateStopFailed, 'Task teardown failed after child exit'))
    // The Host is gone, so its lock died with it; only a live Host is worth unlocking.
    expect(host.updateTasks.mock.calls).toEqual([['inspect'], ['lock']])
    expect(journalEvents(journalDirectory)).not.toContain('install-confirmed')
  })

  it('journals the confirmed installation before the quit reaches the installer branch', async () => {
    const host = await boot(journalDirectory)
    harness.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
    await expect(stopCleanly(host)).resolves.toBe(true)

    const confirmed = journalEvents(journalDirectory)
    expect(confirmed).toContain('install-confirmed')
    // Nothing has asked the process to quit yet, so the confirmation is still the last record.
    expect(confirmed.at(-1)).toBe('install-confirmed')

    const quit = { preventDefault: vi.fn() }
    harness.app.emit('before-quit', quit)
    // The installer owns the quit now: no shell confirmation, nothing prevented.
    expect(quit.preventDefault).not.toHaveBeenCalled()
    expect(host.inspectQuit).not.toHaveBeenCalled()
    const afterQuit = journalRecords(journalDirectory)
    const installed = afterQuit.findIndex(record => record.event === 'install-confirmed')
    const requested = afterQuit.findIndex(record => record.event === 'quit-requested')
    // The quit record comes from the branch the installer flag guards, so the confirmation was
    // already flushed when that flag became readable.
    expect(installed).toBeGreaterThanOrEqual(0)
    expect(requested).toBeGreaterThan(installed)
  })

  it('leaves an unconfirmed quit to the shell confirmation instead of the installer branch', async () => {
    const host = await boot(journalDirectory)

    const quit = { preventDefault: vi.fn() }
    harness.app.emit('before-quit', quit)
    expect(quit.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => { expect(host.inspectQuit).toHaveBeenCalledOnce() })
    expect(journalEvents(journalDirectory)).not.toContain('install-confirmed')
  })
})
