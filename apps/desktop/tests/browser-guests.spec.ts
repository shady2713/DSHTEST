/** Main-owned guest enforcement for toolbar requests and popup routing. */
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { readBrowserExecutionRole } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { BrowserAutomationTarget } from '../src/browser-automation.ts'
import { HostTargetRegistry } from '../src/automation-targets.ts'

const browserSession = vi.hoisted(() => ({
  setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
  setDisplayMediaRequestHandler: vi.fn(), on: vi.fn(),
  webRequest: { onBeforeRequest: vi.fn<(handler: (
    details: { resourceType: string; url: string; webContentsId: number }, callback: (value: { cancel: boolean }) => void,
  ) => void) => void>() },
}))
vi.mock('electron', () => ({ app: { isPackaged: true }, session: { fromPartition: () => browserSession } }))
const { DesktopBrowserGuests } = await import('../src/browser-guests.ts')

it('uses separate stores for roles and activations, reuses only an exact role and forgets a released group', async () => {
  const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() })
  const guests = new DesktopBrowserGuests(() => undefined)
  const role = readBrowserExecutionRole({ owner: { group: 'group', activation: 'activation', project: 'project', run: 'run',
    sessionId: 'session', hostEpoch: 1, workspace: 'cwd:workspace' }, role: 'author' })!
  const first = guests.acquireRole(owner as never, role)
  const again = guests.acquireRole(owner as never, role)
  const other = guests.acquireRole(owner as never, { ...role, role: readBrowserExecutionRole({ ...role, role: 'reviewer' })!.role })
  const resumed = guests.acquireRole(owner as never, { ...role, owner: readBrowserExecutionRole({ ...role,
    owner: { ...role.owner, activation: 'next-activation' } })!.owner })
  const sidebar = guests.acquire(owner as never, role.owner.workspace)
  expect(first.partition).toBe(again.partition)
  expect(new Set([first.partition, other.partition, resumed.partition, sidebar.partition]).size).toBe(4)
  await guests.releaseRoleGroup(owner as never, role)
  expect(guests.acquireRole(owner as never, role).partition).not.toBe(first.partition)
  expect(guests.acquireRole(owner as never, { ...role, owner: readBrowserExecutionRole({ ...role,
    owner: { ...role.owner, activation: 'next-activation' } })!.owner }).partition).toBe(resumed.partition)
})

it('blocks second-origin toolbar requests and popup routing for an explicitly bound guest', async () => {
  const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() })
  const guests = new DesktopBrowserGuests(() => 'http://127.0.0.1:19387')
  const reservation = guests.acquire(owner as never, 'session:controls-owner')
  const registry = new HostTargetRegistry()
  let target: BrowserAutomationTarget | undefined
  guests.bind({ webContents: owner } as never, () => () => {}, () => registry.currentEpoch(), (registered) => {
    target = registered
    return registry.register(registered)
  })
  registry.connectHost()
  let url = 'about:blank#' + reservation.lease
  let popup: ((request: { url: string; postBody?: object }) => { action: string }) | undefined
  const guest = Object.assign(new EventEmitter(), {
    id: 42, getURL: () => url, isDestroyed: () => false,
    setWindowOpenHandler: (handler: typeof popup) => { popup = handler },
    close() { guest.emit('destroyed') },
  })
  owner.emit('will-attach-webview', { preventDefault: () => { throw new Error('approved attachment rejected') } }, {}, { src: url, partition: reservation.partition })
  owner.emit('did-attach-webview', {}, guest)
  guest.emit('dom-ready')
  expect(target?.hostEpoch).toBe(1)
  const intercept = browserSession.webRequest.onBeforeRequest.mock.calls.at(-1)![0]
  const callback = vi.fn()
  intercept({ resourceType: 'mainFrame', webContentsId: 42, url }, callback)
  expect(callback).toHaveBeenLastCalledWith({ cancel: false })
  url = 'http://127.0.0.1:15001/checkout'
  target!.authorize(SessionId('controls-owner'))
  for (const escaped of ['about:blank', 'data:text/html,outside', 'blob:http://127.0.0.1:15001/outside']) {
    intercept({ resourceType: 'mainFrame', webContentsId: 42, url: escaped }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })
  }
  intercept({ resourceType: 'mainFrame', webContentsId: 42, url: 'http://127.0.0.1:15002/foreign' }, callback)
  expect(callback).toHaveBeenLastCalledWith({ cancel: true })
  intercept({ resourceType: 'mainFrame', webContentsId: 42, url: 'http://127.0.0.1:15001/orders' }, callback)
  expect(callback).toHaveBeenLastCalledWith({ cancel: false })
  intercept({ resourceType: 'script', webContentsId: 42, url: 'http://127.0.0.1:15002/asset.js' }, callback)
  expect(callback).toHaveBeenLastCalledWith({ cancel: false })
  expect(popup!({ url: 'http://127.0.0.1:15002/foreign' })).toEqual({ action: 'deny' })
  expect(owner.send).not.toHaveBeenCalled()
  expect(popup!({ url: 'http://127.0.0.1:15001/orders' })).toEqual({ action: 'deny' })
  expect(owner.send).toHaveBeenCalledOnce()
  expect(owner.send.mock.calls[0]?.[1]).toMatchObject({ lease: reservation.lease, url: 'http://127.0.0.1:15001/orders' })
  const previous = target!
  registry.connectHost()
  expect(previous.live()).toBe(false)
  expect(previous.authorizedSession()).toBeUndefined()
  expect(registry.resolve(previous.id)).toBeUndefined()
  owner.emit('did-start-navigation', {}, 'dsh-app://app/', false, true)
  const replacement = guests.acquire(owner as never, 'session:controls-owner')
  url = 'about:blank#' + replacement.lease
  const replacedGuest = Object.assign(new EventEmitter(), {
    id: 43, getURL: () => url, isDestroyed: () => false,
    setWindowOpenHandler: () => {}, close() { replacedGuest.emit('destroyed') },
  })
  owner.emit('will-attach-webview', { preventDefault: () => { throw new Error('replacement rejected') } }, {}, { src: url, partition: replacement.partition })
  owner.emit('did-attach-webview', {}, replacedGuest)
  replacedGuest.emit('dom-ready')
  url = 'http://127.0.0.1:15001/orders'
  expect(target?.hostEpoch).toBe(2)
  expect(target?.authorizedSession()).toBeUndefined()
  expect(target?.id).not.toBe(previous.id)
  expect(registry.state().targets).toMatchObject([{ hostEpoch: 2, url }])
  expect(registry.resolve(previous.id)).toBeUndefined()
  await guests.release(owner as never, replacement.lease)
  expect(target?.live()).toBe(false)
})
