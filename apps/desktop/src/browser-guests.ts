/** Main-process ownership and fixed isolation policy for Sidebar webview guests. */
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { app, session, type BrowserWindow, type Session, type WebContents } from 'electron'
import type {
  DesktopBrowserLeaseId,
  DesktopBrowserOpenRequest,
  DesktopBrowserReservation,
  DesktopBrowserTargetId,
  DesktopBrowserWorkspaceKey,
  DesktopBrowserExecutionRole,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { DESKTOP_IPC } from './ipc.ts'
import type { BrowserAutomationTarget } from './browser-automation.ts'
import { LeasedGuestTarget } from './browser-automation-target.ts'

/**
 * A target is a lease, so its identity is the lease id under a distinct brand: a
 * caller holding a lease id cannot pass it where a target id is expected without
 * saying that it means the attached, automatable guest.
 * @param lease - lease the guest is attached under.
 * @returns the same identity branded as an automation target.
 */
function targetIdOf(lease: DesktopBrowserLeaseId): DesktopBrowserTargetId {
  return brandString<DesktopBrowserTargetId>(lease)
}

interface GuestLease {
  readonly owner: WebContents
  readonly partition: string
  readonly workspace: DesktopBrowserWorkspaceKey
  readonly executionRole?: DesktopBrowserExecutionRole
  attached: boolean
  guest?: WebContents
  target?: LeasedGuestTarget
  releaseInput?: () => void
  releaseTarget?: (() => void) | undefined
}

/** Owns workspace storage partitions independently from individual tab guests. */
export class DesktopBrowserGuests {
  private readonly partitions = new Map<string, string>()
  private readonly rolePartitions = new Map<string, { partition: string; executionRole: DesktopBrowserExecutionRole }>()
  private readonly leases = new Map<DesktopBrowserLeaseId, GuestLease>()

  /** @param hostUrl - current authenticated DSH Host, which guests cannot request. */
  constructor(private readonly hostUrl: () => string | undefined) {}

  /**
   * Reserve one guest in a workspace's process-lifetime partition.
   * @param owner - authenticated primary application WebContents.
   * @param workspace - workspace identity received over IPC.
   * @returns opaque lease and the partition approved for it.
   */
  acquire(owner: WebContents, workspace: unknown): DesktopBrowserReservation {
    if (typeof workspace !== 'string' || workspace.length === 0 || workspace.length > 4096) {
      throw new Error('desktop browser: a workspace storage identity is required')
    }
    let partition = this.partitions.get(workspace)
    if (partition === undefined) {
      partition = `dsh-sidebar-browser-${randomUUID()}`
      this.configureSession(session.fromPartition(partition))
      this.partitions.set(workspace, partition)
    }
    const lease = randomUUID() as DesktopBrowserLeaseId
    this.leases.set(lease, { owner, partition, workspace: brandString<DesktopBrowserWorkspaceKey>(workspace), attached: false })
    return { lease, partition }
  }

  /**
   * Reserve a role guest for the trusted Main execution-group coordinator.
   * @param owner - authenticated application window; ordinary renderer IPC cannot call this method.
   * @param executionRole - complete project, batch, activation and role identity.
   * @returns role-isolated guest reservation, reused only for that exact role identity.
   */
  acquireRole(owner: WebContents, executionRole: DesktopBrowserExecutionRole): DesktopBrowserReservation {
    const key = JSON.stringify([executionRole.owner.project, executionRole.owner.run, executionRole.owner.group,
      executionRole.owner.activation, executionRole.owner.sessionId, executionRole.owner.hostEpoch,
      executionRole.owner.workspace, executionRole.role])
    let storage = this.rolePartitions.get(key)
    if (storage === undefined) {
      storage = { partition: `dsh-execution-role-${randomUUID()}`, executionRole }
      this.configureSession(session.fromPartition(storage.partition))
      this.rolePartitions.set(key, storage)
    }
    const lease = brandString<DesktopBrowserLeaseId>(randomUUID())
    this.leases.set(lease, { owner, partition: storage.partition, workspace: executionRole.owner.workspace,
      executionRole, attached: false })
    return { lease, partition: storage.partition }
  }

  /**
   * Close all role guests and forget their storage reuse keys after group revocation.
   * @param owner - owning application window.
   * @param executionRole - identity of the group to release; the role field does not narrow release.
   * @returns after every owned group guest is destroyed; new acquisitions get fresh partitions.
   */
  async releaseRoleGroup(owner: WebContents, executionRole: DesktopBrowserExecutionRole): Promise<void> {
    const group = executionRole.owner
    const matches = (role: DesktopBrowserExecutionRole): boolean => role.owner.group === group.group
      && role.owner.activation === group.activation
      && role.owner.hostEpoch === group.hostEpoch
    const owned = [...this.leases].filter(([, lease]) => lease.owner === owner && lease.executionRole !== undefined
      && matches(lease.executionRole))
    const result = await Promise.allSettled(owned.map(([id]) => this.release(owner, id)))
    for (const [key, storage] of this.rolePartitions) {
      if (matches(storage.executionRole)) this.rolePartitions.delete(key)
    }
    const failures: unknown[] = []
    for (const item of result) {
      if (item.status === 'rejected') {
        const reason: unknown = item.reason
        failures.push(reason)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'desktop browser: role guest release failed')
  }

  /**
   * Release only a lease issued to this application window; workspace storage survives.
   * @param owner - authenticated IPC sender.
   * @param id - lease received over IPC.
   */
  async release(owner: WebContents, id: unknown): Promise<void> {
    if (typeof id !== 'string') throw new Error('desktop browser: invalid guest lease')
    const key = id as DesktopBrowserLeaseId
    const lease = this.leases.get(key)
    if (lease === undefined) return
    if (lease.owner !== owner) throw new Error('desktop browser: guest belongs to another window')
    lease.releaseInput?.()
    lease.releaseTarget?.()
    this.leases.delete(key)
    const guest = lease.guest
    if (guest !== undefined && !guest.isDestroyed()) {
      const destroyed = new Promise<void>((resolve) => { guest.once('destroyed', resolve) })
      guest.close({ waitForBeforeUnload: false })
      await destroyed
    }
  }

  /**
   * Install attachment checks before the application document can create a webview.
   * @param window - primary application window.
   * @param attachInput - attaches native input after guest ownership is verified and returns its disposer.
   * @param hostEpoch - reads the connected Host generation when a guest attaches.
   * @param registerTarget - receives one automation target per attached guest and returns its disposer.
   * @param changed - publishes updated Main-owned target URLs after navigation.
   */
  bind(
    window: BrowserWindow,
    attachInput: (guest: WebContents, name: DesktopBrowserLeaseId) => () => void,
    hostEpoch: () => number = () => 0,
    registerTarget?: (target: BrowserAutomationTarget) => () => void,
    changed?: () => void,
  ): void {
    const owner = window.webContents
    owner.on('will-attach-webview', (event, preferences, params) => {
      const id = typeof params.src === 'string' && params.src.startsWith('about:blank#')
        ? params.src.slice('about:blank#'.length) : ''
      const lease = this.leases.get(id as DesktopBrowserLeaseId)
      if (lease === undefined || lease.owner !== owner || lease.attached || params.partition !== lease.partition) {
        event.preventDefault()
        return
      }
      lease.attached = true
      // Keep Electron's allowpopups dispatch flag; the guest handler still denies native windows.
      for (const key of Object.keys(preferences)) {
        if (key !== 'disablePopups') Reflect.deleteProperty(preferences, key)
      }
      Object.assign(preferences, {
        partition: lease.partition,
        nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
        webviewTag: false, plugins: false, navigateOnDragDrop: false, disableDialogs: true,
        devTools: !app.isPackaged,
      })
      params.httpreferrer = ''
    })
    owner.on('did-attach-webview', (_event, guest) => {
      let attachedLease: DesktopBrowserLeaseId | undefined
      // The first document is an inert about:blank carrying the approved lease.
      // Bind on the main-process event before the renderer can navigate the ready guest.
      guest.once('dom-ready', () => {
        const url = guest.getURL()
        const id = (url.startsWith('about:blank#') ? url.slice('about:blank#'.length) : '') as DesktopBrowserLeaseId
        const lease = this.leases.get(id)
        if (lease === undefined || lease.owner !== owner || lease.guest !== undefined) {
          guest.close({ waitForBeforeUnload: false })
          return
        }
        lease.guest = guest
        attachedLease = id
        lease.releaseInput = attachInput(guest, id)
        // A target is a lease: its identity is the lease id, so a command cannot
        // address a guest this window does not own or outlive.
        lease.target = new LeasedGuestTarget(
          targetIdOf(id), hostEpoch(), () => guest, url => this.allowedNavigation(url), lease.workspace,
          window,
        )
        if (lease.executionRole !== undefined) Object.assign(lease.target, { executionRole: lease.executionRole })
        lease.releaseTarget = registerTarget?.(lease.target)
        guest.once('destroyed', () => { lease.releaseInput?.(); lease.releaseTarget?.(); this.leases.delete(id) })
      })
      guest.setWindowOpenHandler(({ url, postBody }) => {
        const lease = attachedLease === undefined ? undefined : this.leases.get(attachedLease)
        if (attachedLease !== undefined && lease?.guest === guest && lease.owner === owner && !owner.isDestroyed()
          && postBody === undefined && this.allowedNavigation(url)
          && (lease.target?.authorizedSession() === undefined || lease.target.permitsNavigation(url))) {
          const request: DesktopBrowserOpenRequest = { lease: attachedLease, url: new URL(url).href }
          owner.send(DESKTOP_IPC.browserOpenRequested, request)
        }
        return { action: 'deny' }
      })
      guest.on('will-frame-navigate', (event) => {
        if (event.isMainFrame && !this.allowedNavigation(event.url)) event.preventDefault()
      })
      guest.on('will-redirect', (event, url, _inPlace, mainFrame) => {
        if (mainFrame && !this.allowedNavigation(url)) event.preventDefault()
      })
      guest.on('did-navigate', () => { changed?.() })
      guest.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame) changed?.() })
      guest.on('will-attach-webview', (event) => { event.preventDefault() })
      guest.on('login', (event, _details, _authInfo, callback) => { event.preventDefault(); callback() })
    })
    const releaseAll = (): void => {
      for (const [id, lease] of this.leases) {
        if (lease.owner === owner) void this.release(owner, id).catch((error: unknown) => { console.error(error) })
      }
    }
    owner.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) releaseAll()
    })
    owner.on('render-process-gone', releaseAll)
    owner.once('destroyed', releaseAll)
  }

  private configureSession(browserSession: Session): void {
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setDevicePermissionHandler(() => false)
    browserSession.setDisplayMediaRequestHandler((_request, callback) => { callback({}) })
    browserSession.on('will-download', (event) => { event.preventDefault() })
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      const network = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      const lease = details.resourceType === 'mainFrame'
        ? [...this.leases.values()].find(item => item.guest?.id === details.webContentsId) : undefined
      const outsideBinding = lease?.target?.authorizedSession() !== undefined && !lease.target.permitsNavigation(details.url)
      callback({ cancel: outsideBinding || (network
        ? url.username !== '' || url.password !== '' || this.isApplicationHost(url)
        : !['about:', 'data:', 'blob:'].includes(url.protocol)) })
    })
  }

  private allowedNavigation(value: string): boolean {
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.username === '' && url.password === ''
      && !this.isApplicationHost(url)
  }

  private isApplicationHost(url: URL): boolean {
    const value = this.hostUrl()
    if (value === undefined) return false
    const host = new URL(value)
    return url.port === host.port
      && (url.hostname === host.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  }
}
