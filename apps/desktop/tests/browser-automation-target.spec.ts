/**
 * The Electron binding, exercised against a fake guest so real input ordering and
 * observation generation are testable without a browser. It proves the Main issues
 * the input events a person would, and that a handle from an older observation
 * never reaches the guest.
 */
import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { DesktopBrowserWorkspaceKey } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { DESKTOP_BROWSER_AUTOMATION_VERSION, type DesktopBrowserTargetId } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { LeasedGuestTarget } from '../src/browser-automation-target.ts'
import { admitCommand, runCommand } from '../src/browser-automation.ts'

const WINDOW = { isDestroyed: () => false, isMinimized: () => false, restore: () => {},
  isVisible: () => true, show: () => {}, focus: () => {}, isFocused: () => true }

const TARGET = 'guest-1' as DesktopBrowserTargetId
const EPOCH = 3
const SESSION = SessionId('controls-owner')
const WORKSPACE = 'session:controls-owner' as DesktopBrowserWorkspaceKey

const PAY = { ref: 'e0', role: 'button', name: 'Pay now', x: 120, y: 60, width: 90, height: 30 }
const COUPON = { ref: 'e1', role: 'textbox', name: 'coupon', x: 120, y: 110, width: 200, height: 24 }

const PAGE = {
  url: 'https://shop.test/checkout',
  title: 'Checkout',
  elements: [PAY, COUPON],
}

interface FakeGuest {
  isDestroyed: () => boolean
  getURL: () => string
  focus: () => void
  isFocused: () => boolean
  executeJavaScript: (code: string, userGesture?: boolean, ...args: readonly unknown[]) => Promise<unknown>
  capturePage: () => Promise<{ toPNG: () => Uint8Array }>
  on: EventEmitter['on']
  loadURL: (url: string) => Promise<void>
  reload: () => void
  sendInputEvent: (event: Record<string, unknown>) => Promise<void>
}

/** What the revalidation pass answers with, so a test can move the page under the Host. */
interface FakePage {
  readonly observed: typeof PAGE
  /** null means the element is gone; the object means it is somewhere else now. */
  readonly revalidated: unknown
}

function fakeGuest(page: Partial<FakePage> = {}): {
  guest: FakeGuest
  events: Array<Record<string, unknown>>
  emitter: EventEmitter
  navigation: (inPlace?: boolean) => void
} {
  const state: FakePage = { observed: PAGE, revalidated: { ...PAY, url: PAGE.url, documentVisible: true }, ...page }
  const events: Array<Record<string, unknown>> = []
  const emitter = new EventEmitter()
  const guest: FakeGuest = {
    on: emitter.on.bind(emitter),
    loadURL: async (url) => { events.push({ kind: 'navigate', url }) },
    reload: () => { events.push({ kind: 'reload' }) },
    isDestroyed: () => false,
    getURL: () => PAGE.url,
    focus: () => { events.push({ kind: 'focus' }) },
    isFocused: () => true,
    executeJavaScript: async code => (
      // The verifier re-reads one element by ref; the collector returns the whole page.
      code.includes('const index = Number(String(ref).slice(1))') ? state.revalidated : state.observed
    ),
    capturePage: async () => ({ toPNG: () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }),
    sendInputEvent: async (event) => { events.push(event) },
  }
  return { guest, events, emitter, navigation: (inPlace = false) => { emitter.emit('did-start-navigation', {}, PAGE.url, inPlace, true) } }
}

function command(body: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 5, hostEpoch: EPOCH,
    target: TARGET, sessionId: SESSION, body, ...overrides }
}

describe('LeasedGuestTarget', () => {
  it('refuses native input to a hidden document even when its owning window and guest are focused', async () => {
    const { guest, events } = fakeGuest({ revalidated: { ...PAY, url: PAGE.url, documentVisible: false } })
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    const page = await target.observe()
    expect(await runCommand(command({ kind: 'click', ref: PAY.ref, generation: page.generation }),
      { currentEpoch: EPOCH, target })).toMatchObject({ ok: false, outcome: 'not-executed', reason: 'stale-observation' })
    expect(events).toEqual([])
  })

  it('restores a background owner before rechecking its now-visible document', async () => {
    const read = { ...PAY, url: PAGE.url, documentVisible: false }
    const { guest, events } = fakeGuest({ revalidated: read })
    let visible = false, focused = false
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, {
      ...WINDOW, isVisible: () => visible, isFocused: () => focused,
      show: () => { visible = true; read.documentVisible = true }, focus: () => { focused = true },
    })
    target.authorize(SESSION)
    const page = await target.observe()
    expect(await runCommand(command({ kind: 'click', ref: PAY.ref, generation: page.generation }),
      { currentEpoch: EPOCH, target })).toMatchObject({ ok: true })
    expect(events.filter(event => event['type'] === 'mouseDown')).toMatchObject([{ x: PAY.x, y: PAY.y }])
  })

  it('refuses the restored owner when its second document read is still hidden', async () => {
    const { guest, events } = fakeGuest({ revalidated: { ...PAY, url: PAGE.url, documentVisible: false } })
    let visible = false, focused = false
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, {
      ...WINDOW, isVisible: () => visible, isFocused: () => focused,
      show: () => { visible = true }, focus: () => { focused = true },
    })
    target.authorize(SESSION)
    const page = await target.observe()
    expect(await runCommand(command({ kind: 'click', ref: PAY.ref, generation: page.generation }),
      { currentEpoch: EPOCH, target })).toMatchObject({ ok: false, outcome: 'not-executed', reason: 'stale-observation' })
    expect(events.filter(event => 'type' in event)).toEqual([])
  })

  it('revalidates moved elements after focus without focusing again', async () => {
    const moved = { ...PAY, url: PAGE.url, documentVisible: true }
    const { guest, events } = fakeGuest({ revalidated: moved })
    let focusCount = 0
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE,
      { ...WINDOW, focus: () => { focusCount += 1; moved.x += 200 } })
    target.authorize(SESSION)
    const page = await target.observe()
    expect(await runCommand(command({ kind: 'click', ref: 'e0', generation: page.generation }),
      { currentEpoch: EPOCH, target })).toMatchObject({ ok: true })
    expect(focusCount).toBe(1)
    expect(events.filter(event => event['type'] === 'mouseDown')).toMatchObject([{ x: 320, y: PAY.y }])
  })

  it.each(['window', 'guest'] as const)('refuses native input when %s does not acquire focus', async (denied) => {
    const { guest, events } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH,
      () => ({ ...guest, isFocused: () => denied !== 'guest' }) as never,
      () => true, WORKSPACE, { ...WINDOW, isFocused: () => denied !== 'window' })
    target.authorize(SESSION)
    const page = await target.observe()
    expect(await runCommand(command({ kind: 'type', ref: 'e0', generation: page.generation, text: 'must not arrive' }),
      { currentEpoch: EPOCH, target })).toMatchObject({ ok: false, outcome: 'not-executed', reason: 'action-failed' })
    expect(events.filter(event => 'type' in event)).toEqual([])
  })

  it('rejects a revoked lease without showing or focusing its window', async () => {
    const { guest, events } = fakeGuest()
    let touched = false
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE,
      { ...WINDOW, focus: () => { touched = true } })
    target.authorize(SESSION)
    const page = await target.observe()
    target.revoke()
    expect(await runCommand(command({ kind: 'type', ref: 'e0', generation: page.generation, text: 'no' }),
      { currentEpoch: EPOCH, target })).toMatchObject({ ok: false, outcome: 'not-executed' })
    expect(touched).toBe(false)
    expect(events).toEqual([])
  })

  it('rechecks document generation after its owning window receives focus', async () => {
    const { guest, events, navigation } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE,
      { ...WINDOW, focus: () => { navigation() } })
    target.authorize(SESSION)
    const page = await target.observe()
    expect(await runCommand(command({ kind: 'type', ref: 'e0', generation: page.generation, text: 'no' }),
      { currentEpoch: EPOCH, target })).toMatchObject({ ok: false, outcome: 'not-executed', reason: 'stale-observation' })
    expect(events.filter(event => 'type' in event)).toEqual([])
  })

  it('delivers double-click and Enter through native mouse and keyboard events', async () => {
    const { guest, events } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.observe()
    const options = { currentEpoch: EPOCH, target }
    expect(await runCommand(command({ kind: 'double-click', ref: 'e0', generation: 1 }), options)).toMatchObject({ ok: true })
    expect(events.filter(event => event['type'] === 'mouseDown').map(event => event['clickCount'])).toEqual([1, 2])
    events.length = 0
    expect(await runCommand(command({ kind: 'press-key', ref: 'e0', generation: 1, key: 'Enter' }), options)).toMatchObject({ ok: true })
    expect(events.slice(-3)).toEqual([{ type: 'keyDown', keyCode: 'Enter' }, { type: 'char', keyCode: '\r' }, { type: 'keyUp', keyCode: 'Enter' }])
  })

  it.each([false, true])('invalidates references when a main-frame navigation starts, inPlace=%s', async (inPlace) => {
    const { guest, events, navigation } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.observe()
    navigation(inPlace)
    expect(await runCommand(command({ kind: 'press-key', ref: 'e0', generation: 1, key: 'Enter' }), { currentEpoch: EPOCH, target }))
      .toMatchObject({ outcome: 'not-executed', reason: 'stale-observation' })
    expect(events).toEqual([])
    expect((await target.observe()).generation).toBe(2)
  })

  it.each([
    'https://another.test/checkout', 'https://shop.test/other', 'http://shop.test/checkout',
    'https://user:password@shop.test/checkout', 'javascript:alert(1)', 'file:///checkout',
    'https://shop.test:18812/checkout',
  ])('rejects navigation outside the observed origin and pathname: %s', async (url) => {
    const { guest, events } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.observe()
    expect(await runCommand(command({ kind: 'navigate', generation: 1, url }), { currentEpoch: EPOCH, target }))
      .toMatchObject({ outcome: 'not-executed', reason: 'navigation-denied' })
    expect(events).toEqual([])
  })

  it('retains guest-owner restrictions for an otherwise matching destination', async () => {
    const { guest, events } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, url => url === PAGE.url, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.observe()
    expect(await runCommand(command({ kind: 'navigate', generation: 1, url: PAGE.url + '#active' }), { currentEpoch: EPOCH, target }))
      .toMatchObject({ outcome: 'not-executed', reason: 'navigation-denied' })
    expect(events).toEqual([])
  })

  it.each(['navigate', 'reload'] as const)('invalidates observations before %s dispatch and refuses reuse', async (kind) => {
    const { guest, events } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.observe()
    const body = kind === 'navigate' ? { kind, generation: 1, url: PAGE.url + '?filter=active#active' } : { kind, generation: 1 }
    const options = { currentEpoch: EPOCH, target }
    expect(await runCommand(command(body), options)).toMatchObject({ ok: true })
    expect(await runCommand(command(body), options)).toMatchObject({ outcome: 'not-executed', reason: 'stale-observation' })
    expect(events).toHaveLength(1)
  })

  it('rejects same-index elements whose accessible identity changed', async () => {
    const { guest, events } = fakeGuest({ revalidated: { ...PAY, url: PAGE.url, documentVisible: true, name: 'Delete everything' } })
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.observe()
    expect(await runCommand(command({ kind: 'double-click', ref: 'e0', generation: 1 }), { currentEpoch: EPOCH, target }))
      .toMatchObject({ outcome: 'not-executed', reason: 'stale-observation' })
    expect(events).toEqual([])
  })
  it('observes the page and stamps a fresh generation each time', async () => {
    const { guest } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    const first = await target.observe()
    const second = await target.observe()
    expect(first.generation).toBe(1)
    expect(second.generation).toBe(2)
    expect(first.elements.map(element => element.role)).toEqual(['button', 'textbox'])
    expect(target.currentObservation()?.generation).toBe(2)
  })

  it('is not live while the guest is an inert about:blank', () => {
    const { guest } = fakeGuest()
    const inert = new LeasedGuestTarget(TARGET, EPOCH, () => ({ ...guest, getURL: () => 'about:blank' }) as never, () => true, WORKSPACE, WINDOW)
    expect(inert.live()).toBe(false)
  })

  it('clicks with real mouse events at the element centre', async () => {
    const { guest, events } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.observe()
    expect(target.prepareInput()).toBe(true)
    await target.click(PAY)
    expect(events).toEqual([
      { kind: 'focus' },
      { type: 'mouseMove', x: 120, y: 60 },
      { type: 'mouseDown', x: 120, y: 60, button: 'left', clickCount: 1 },
      { type: 'mouseUp', x: 120, y: 60, button: 'left', clickCount: 1 },
    ])
  })

  it('focuses by a real click then delivers characters as input events', async () => {
    const { guest, events } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.observe()
    expect(target.prepareInput()).toBe(true)
    await target.type(COUPON, 'hi')
    const kinds = events.map(event => 'kind' in event ? event.kind : event['type'])
    expect(kinds).toEqual(['focus', 'mouseMove', 'mouseDown', 'mouseUp', 'char', 'char'])
    expect(events.filter(event => event['type'] === 'char').map(event => event['keyCode'])).toEqual(['h', 'i'])
  })

  it('delivers line breaks as native Enter and normalizes Windows CRLF once', async () => {
    const { guest, events } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.type(COUPON, '第一行\r\nSecond line')
    expect(events.filter(event => event['type'] === 'keyDown')).toEqual([{ type: 'keyDown', keyCode: 'Enter' }])
    expect(events.filter(event => event['type'] === 'char').map(event => event['keyCode']).join('')).toBe('第一行\rSecond line')
  })

  it('screenshots as PNG bytes', async () => {
    const { guest } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    const shot = await target.screenshot()
    expect(shot).toBeInstanceOf(Uint8Array)
    expect([...shot.slice(0, 4)]).toEqual([137, 80, 78, 71])
  })

  it('refuses a click whose element the live document no longer has', async () => {
    const { guest, events } = fakeGuest({ revalidated: null })
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    const observation = await target.observe()
    const result = await runCommand(command({ kind: 'click', ref: 'e0', generation: observation.generation }), { currentEpoch: EPOCH, target })

    expect(result).toMatchObject({ ok: false, reason: 'stale-observation' })
    // Refused before any input reached the guest, which is what makes the reason
    // truthful: nothing was dispatched, so nothing is left in an unknown state.
    expect(events).toEqual([])
  })

  it('refuses a click when the document navigated away from the observed one', async () => {
    const { guest, events } = fakeGuest({ revalidated: { ...PAY, url: 'https://shop.test/other', documentVisible: true } })
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    const observation = await target.observe()
    const result = await runCommand(command({ kind: 'type', ref: 'e0', generation: observation.generation, text: 'x' }), { currentEpoch: EPOCH, target })

    expect(result).toMatchObject({ ok: false, reason: 'stale-observation' })
    expect(events).toEqual([])
  })

  it('aims the input at where the element is now, not where it was observed', async () => {
    const moved = { ...PAY, url: PAGE.url, documentVisible: true, x: 300, y: 400 }
    const { guest, events } = fakeGuest({ revalidated: moved })
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    const observation = await target.observe()
    const result = await runCommand(command({ kind: 'click', ref: 'e0', generation: observation.generation }), { currentEpoch: EPOCH, target })

    expect(result).toMatchObject({ ok: true })
    expect(events.filter(event => event['type'] === 'mouseMove')).toEqual([{ type: 'mouseMove', x: 300, y: 400 }])
  })

  it('never collects a page with a user gesture', async () => {
    const gestures: Array<boolean | undefined> = []
    const { guest } = fakeGuest()
    const observed = { ...guest, executeJavaScript: async (code: string, userGesture?: boolean, ...rest: readonly unknown[]) => {
      gestures.push(userGesture)
      return guest.executeJavaScript(code, userGesture, ...rest)
    } }
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => observed as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.observe()
    await target.revalidate('e0')

    // Reading a page must not hand it user activation.
    expect(gestures).toEqual([false, false])
  })

  it('does not reach the guest when the command carries a superseded generation', async () => {
    const { guest, events } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.observe()
    await target.observe()
    const result = await runCommand(command({ kind: 'click', ref: 'e0', generation: 1 }), { currentEpoch: EPOCH, target })
    expect(result).toMatchObject({ ok: false, reason: 'stale-observation' })
    expect(events).toEqual([])
  })

  it('admits a click against the generation the Main currently holds', async () => {
    const { guest, events } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    const observation = await target.observe()
    const admitted = admitCommand(command({ kind: 'click', ref: 'e0', generation: observation.generation }), { currentEpoch: EPOCH, target })
    expect(admitted).toMatchObject({ requestId: 5, hostEpoch: EPOCH, target: TARGET })
    const result = await runCommand(command({ kind: 'click', ref: 'e0', generation: observation.generation }), { currentEpoch: EPOCH, target })
    expect(result).toMatchObject({ ok: true })
    expect(events).toHaveLength(4)
  })
  it('freezes the explicit binding origin for page navigation and redirects while allowing business paths', () => {
    const { guest, emitter } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    expect(target.permitsNavigation('https://shop.test/orders/42')).toBe(true)
    expect(target.permitsNavigation('https://foreign.test/orders/42')).toBe(false)
    for (const value of ['https://foreign.test/', 'https://shop.test:9443/checkout', 'http://shop.test/checkout']) {
      let blocked = false
      const event = { isMainFrame: true, url: value, preventDefault() { blocked = true } }
      emitter.emit('will-frame-navigate', event)
      expect(blocked).toBe(true)
      blocked = false
      emitter.emit('will-redirect', event, value, false, true)
      expect(blocked).toBe(true)
    }
    target.authorize(undefined)
    expect(target.authorizedDocument()).toBe(false)
    expect(target.permitsNavigation('https://foreign.test/')).toBe(true)
  })

  it.each(['observe', 'screenshot', 'reload'] as const)('refuses %s when the current URL has escaped the bound origin', async (kind) => {
    const { guest, events } = fakeGuest()
    let url = PAGE.url
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => ({ ...guest, getURL: () => url }) as never, () => true, WORKSPACE, WINDOW)
    target.authorize(SESSION)
    await target.observe()
    url = 'https://foreign.test/checkout'
    expect(await runCommand(command(kind === 'screenshot' ? { kind, format: 'png' } : { kind, generation: 1 }), { currentEpoch: EPOCH, target }))
      .toMatchObject({ outcome: 'not-executed', reason: 'navigation-denied' })
    expect(events).toEqual([])
  })

  it('rejects an unbound or foreign Session before reaching the guest', async () => {
    const { guest, events } = fakeGuest()
    const target = new LeasedGuestTarget(TARGET, EPOCH, () => guest as never, () => true, WORKSPACE, WINDOW)
    expect(await runCommand(command({ kind: 'observe' }), { currentEpoch: EPOCH, target })).toMatchObject({ reason: 'session-not-authorized' })
    target.authorize(SESSION)
    expect(await runCommand(command({ kind: 'observe' }, { sessionId: 'foreign-session' }), { currentEpoch: EPOCH, target })).toMatchObject({ reason: 'session-not-authorized' })
    expect(events).toEqual([])
  })

})
