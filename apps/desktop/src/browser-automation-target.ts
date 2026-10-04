/**
 * Electron binding for one leased guest: the {@link BrowserAutomationTarget} the
 * controlled channel executes against.
 *
 * Observations come from `executeJavaScript`, which the Main initiates and the
 * model never sees; input goes through `sendInputEvent`, the same real input path
 * a person would produce. Nothing here opens a DevTools channel, and no CDP
 * method is reachable from a command.
 */

import type { BrowserWindow, WebContents } from 'electron'
import {
  type DesktopBrowserObservedElement,
  type DesktopBrowserCommandBody,
  type DesktopBrowserObservation,
  type DesktopBrowserObservationGeneration,
  type DesktopBrowserTargetId,
  type DesktopBrowserWorkspaceKey,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BrowserAutomationTarget } from './browser-automation.ts'

/** What the in-page collector returns; the Main stamps identity and generation. */
interface CollectedPage {
  readonly url: string
  readonly title: string
  readonly elements: ReadonlyArray<{
    readonly ref: string
    readonly role: string
    readonly name: string
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }>
}

/**
 * Collect the addressable elements of the current document. Runs in the guest as
 * one synchronous pass and returns plain data; it reads no host state and exposes
 * no function back to the page.
 *
 * The pass never runs with a user gesture. Reading a page must not hand it user
 * activation, which a model-driven read has no business granting.
 */
const COLLECT_PAGE = `(() => {
  const role = (element) => {
    const explicit = element.getAttribute('role')
    if (explicit) return explicit
    const tag = element.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes(element.type))) return 'button'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'select') return 'combobox'
    if (tag === 'input') return element.type === 'checkbox' ? 'checkbox' : element.type === 'radio' ? 'radio' : 'textbox'
    if (tag === 'img') return 'img'
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') return 'heading'
    if (tag === 'p' || tag === 'span' || tag === 'div' || tag === 'label') return 'text'
    return tag
  }
  const name = (element) => (
    element.getAttribute('aria-label')
    || element.getAttribute('name')
    || (element.textContent ?? '').trim().slice(0, 80)
  )
  const elements = []
  const candidates = document.querySelectorAll('a, button, input, textarea, select, label, [role], h1, h2, h3, p, img')
  for (const [index, element] of Array.from(candidates).entries()) {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    elements.push({
      ref: 'e' + String(index),
      role: role(element),
      name: name(element),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
  }
  return { url: location.href, title: document.title, elements: elements.slice(0, 400) }
})()`

/**
 * Re-read the element one observation addressed, in the live document, so an action
 * is not aimed at coordinates the page has since reused. It applies the same
 * candidate order and skips the same non-visible entries, so `ref` keeps its meaning
 * only while the document is unchanged; a different document returns null.
 * @param ref - element handle from the accepted observation.
 * @returns the element as it is now, or null when it no longer exists or is not visible.
 */
const VERIFY_ELEMENT = `((ref) => {
  const role = (element) => {
    const explicit = element.getAttribute('role')
    if (explicit) return explicit
    const tag = element.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes(element.type))) return 'button'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'select') return 'combobox'
    if (tag === 'input') return element.type === 'checkbox' ? 'checkbox' : element.type === 'radio' ? 'radio' : 'textbox'
    if (tag === 'img') return 'img'
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') return 'heading'
    if (tag === 'p' || tag === 'span' || tag === 'div' || tag === 'label') return 'text'
    return tag
  }
  const name = (element) => (
    element.getAttribute('aria-label')
    || element.getAttribute('name')
    || (element.textContent ?? '').trim().slice(0, 80)
  )
  const index = Number(String(ref).slice(1))
  if (!Number.isSafeInteger(index) || index < 0) return null
  const candidates = document.querySelectorAll('a, button, input, textarea, select, label, [role], h1, h2, h3, p, img')
  const element = candidates[index]
  if (!element) return null
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    url: location.href,
    documentVisible: document.visibilityState === 'visible' && !document.hidden,
    role: role(element),
    name: name(element),
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
})`

/** One leased guest, plus the observation the last command was based on. */
export class LeasedGuestTarget implements BrowserAutomationTarget {
  private observation: DesktopBrowserObservation | undefined
  private generation: DesktopBrowserObservationGeneration = 0
  private documentRevision = 0
  private revoked = false
  private navigationScope: URL | undefined
  private sessionId: SessionId | undefined
  private boundOrigin: string | undefined

  /**
   * @param id - identity commands address this target by.
   * @param hostEpoch - Host generation that owns the lease.
   * @param guest - the leased guest; read through a function so a destroyed guest is observed, not cached.
   * @param allowedNavigation - guest-owner policy that also excludes the application Host.
   * @param workspace - storage account approved when the guest was acquired.
   * @param inputWindow - the Main window that owns this guest; input never focuses a different window.
   */
  constructor(
    readonly id: DesktopBrowserTargetId,
    readonly hostEpoch: number,
    private readonly guest: () => WebContents,
    private readonly allowedNavigation: (url: string) => boolean,
    readonly workspace: DesktopBrowserWorkspaceKey,
    private readonly inputWindow: Pick<BrowserWindow, 'isDestroyed' | 'isMinimized' | 'restore' | 'isVisible' | 'show' | 'focus' | 'isFocused'>,
  ) {
    guest().on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame) this.invalidateObservation()
    })
    guest().on('did-navigate-in-page', (_event, _url, mainFrame) => {
      if (mainFrame) this.invalidateObservation()
    })
    guest().on('will-redirect', (event, url, _inPlace, mainFrame) => {
      if (mainFrame && (!this.permitsNavigation(url)
        || (this.navigationScope !== undefined && !this.withinNavigationScope(url, this.navigationScope)))) {
        event.preventDefault()
      }
    })
    guest().on('will-frame-navigate', (event) => {
      if (event.isMainFrame && !this.permitsNavigation(event.url)) event.preventDefault()
    })
    guest().on('did-stop-loading', () => { this.navigationScope = undefined })
  }

  live(): boolean {
    const contents = this.guest()
    return !this.revoked && !contents.isDestroyed() && contents.getURL() !== 'about:blank'
  }

  revoke(): void {
    this.revoked = true
    this.sessionId = undefined
    this.boundOrigin = undefined
    this.invalidateObservation()
  }

  url(): string { return this.guest().getURL() }

  authorizedSession(): SessionId | undefined { return this.sessionId }

  authorize(sessionId: SessionId | undefined): void {
    if (sessionId !== undefined && sessionId !== this.sessionId) {
      const value = this.url()
      if (!URL.canParse(value) || !this.allowedNavigation(value)) throw new Error('desktop browser: binding requires a permitted HTTP(S) document')
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') {
        throw new Error('desktop browser: binding requires a permitted HTTP(S) document')
      }
      this.boundOrigin = url.origin
    }
    if (sessionId !== this.sessionId) this.invalidateObservation()
    this.sessionId = sessionId
    if (sessionId === undefined) this.boundOrigin = undefined
  }

  authorizedDocument(): boolean {
    return this.sessionId !== undefined && this.boundOrigin !== undefined && this.permitsNavigation(this.url())
  }

  /** @param value - page, toolbar, popup, or network navigation. @returns whether the bound origin permits it. */
  permitsNavigation(value: string): boolean {
    if (!URL.canParse(value) || !this.allowedNavigation(value)) return false
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && url.username === '' && url.password === ''
      && (this.boundOrigin === undefined || url.origin === this.boundOrigin)
  }

  currentObservation(): DesktopBrowserObservation | undefined {
    return this.observation
  }

  async observe(): Promise<DesktopBrowserObservation> {
    const contents = this.guest()
    const revision = this.documentRevision
    const collected = await contents.executeJavaScript(COLLECT_PAGE, false) as CollectedPage
    if (revision !== this.documentRevision || collected.url !== contents.getURL()) {
      throw new Error('desktop browser: document changed during observation')
    }
    this.generation += 1
    this.observation = {
      hostEpoch: this.hostEpoch,
      target: this.id,
      generation: this.generation,
      url: collected.url,
      title: collected.title,
      elements: collected.elements,
    }
    return this.observation
  }

  /**
   * Read the addressed element back out of the live document, so the caller acts on
   * where the element is now rather than where it was.
   * @param ref - element handle from the accepted observation.
   * @returns the current element, or undefined when the document changed or remains hidden in its focused window.
   */
  async revalidate(ref: string): Promise<DesktopBrowserObservedElement | undefined> {
    const contents = this.guest()
    // `executeJavaScript` takes the code and a user-gesture flag only, so the handle
    // travels as a JSON literal inside the call to the fixed function expression.
    const read = await contents.executeJavaScript(`(${VERIFY_ELEMENT})(${JSON.stringify(ref)})`, false) as {
      readonly url: string
      readonly documentVisible: boolean
      readonly role: string
      readonly name: string
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    } | null
    // A different document is a different page: the handle means nothing there.
    const observed = this.observation?.elements.find(element => element.ref === ref)
    if (read === null || observed === undefined || read.url !== this.observation?.url
      || read.role !== observed.role || read.name !== observed.name) return undefined
    // Background owners may be restored before the second validation; a focused hidden document cannot receive native input.
    if (!read.documentVisible && this.inputReady()) return undefined
    return { ref, role: read.role, name: read.name, x: read.x, y: read.y, width: read.width, height: read.height }
  }

  async screenshot(): Promise<Uint8Array> {
    // The command allowlist admits PNG only, so the format is fixed here rather than read.
    const image = await this.guest().capturePage()
    return new Uint8Array(image.toPNG())
  }

  prepareInput(): boolean {
    const window = this.inputWindow
    const contents = this.guest()
    if (this.revoked || window.isDestroyed() || contents.isDestroyed()) return false
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
    contents.focus()
    return this.inputReady()
  }

  inputReady(): boolean {
    return !this.revoked && !this.inputWindow.isDestroyed() && !this.guest().isDestroyed()
      && this.inputWindow.isVisible() && !this.inputWindow.isMinimized()
      && this.inputWindow.isFocused() && this.guest().isFocused()
  }

  click(at: DesktopBrowserObservedElement): Promise<void> {
    this.clickAt(at.x, at.y)
    return Promise.resolve()
  }

  type(at: DesktopBrowserObservedElement, text: string): Promise<void> {
    // Focus by the same real click a person would use, then deliver characters as
    // input events; the page never receives a script call for this.
    this.clickAt(at.x, at.y)
    for (const character of text.replace(/\r\n?/gu, '\n')) {
      if (!this.inputReady()) throw new Error('desktop browser: native input focus was lost')
      if (character === '\n') this.sendKey('Enter')
      else this.guest().sendInputEvent({ type: 'char', keyCode: character })
    }
    return Promise.resolve()
  }

  doubleClick(at: DesktopBrowserObservedElement): Promise<void> {
    this.clickAt(at.x, at.y)
    this.clickAt(at.x, at.y, 2)
    return Promise.resolve()
  }

  pressKey(at: DesktopBrowserObservedElement, key: Extract<DesktopBrowserCommandBody, { kind: 'press-key' }>['key']): Promise<void> {
    this.clickAt(at.x, at.y)
    this.sendKey(key)
    return Promise.resolve()
  }

  private sendKey(key: Extract<DesktopBrowserCommandBody, { kind: 'press-key' }>['key']): void {
    if (!this.inputReady()) throw new Error('desktop browser: native input focus was lost')
    const keyCode = key.startsWith('Arrow') ? key.slice(5) : key
    const contents = this.guest()
    contents.sendInputEvent({ type: 'keyDown', keyCode })
    if (key === 'Enter') contents.sendInputEvent({ type: 'char', keyCode: '\r' })
    contents.sendInputEvent({ type: 'keyUp', keyCode })
  }

  canNavigate(value: string): boolean {
    const observed = this.observation
    if (observed === undefined || !URL.canParse(value) || !this.allowedNavigation(value)) return false
    return this.withinNavigationScope(value, new URL(observed.url)) && this.guest().getURL() === observed.url
  }

  async navigate(url: string): Promise<void> {
    this.navigationScope = new URL(url)
    this.invalidateObservation()
    try {
      await this.guest().loadURL(url)
    } finally {
      this.navigationScope = undefined
    }
  }

  reload(): Promise<void> {
    const observed = this.observation
    if (observed === undefined) throw new Error('desktop browser: reload requires a current observation')
    this.navigationScope = new URL(observed.url)
    this.invalidateObservation()
    this.guest().reload()
    return Promise.resolve()
  }

  private invalidateObservation(): void {
    this.documentRevision += 1
    this.observation = undefined
  }

  private withinNavigationScope(value: string, current: URL): boolean {
    if (!URL.canParse(value) || !this.allowedNavigation(value)) return false
    const destination = new URL(value)
    return ['http:', 'https:'].includes(destination.protocol) && destination.username === '' && destination.password === ''
      && destination.origin === current.origin && destination.pathname === current.pathname
  }

  private clickAt(x: number, y: number, clickCount = 1): void {
    if (!this.inputReady()) throw new Error('desktop browser: native input requires its focused owning window')
    const contents = this.guest()
    contents.sendInputEvent({ type: 'mouseMove', x, y })
    contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount })
    contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount })
  }
}
