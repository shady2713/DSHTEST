/**
 * Admission policy for the Host↔Main browser automation channel.
 *
 * This module decides whether a command may act and against what. It performs no
 * Electron work, so every refusal is testable without a browser: the executor it
 * calls is the only part that needs a live guest.
 *
 * The channel exists for a test target the Host already owns. It carries no script
 * evaluation, no DevTools command, and no route to a second target, and a page can
 * never reach it — only the connected Host sends commands, and the Main answers
 * only them.
 */

import {
  DESKTOP_BROWSER_AUTOMATION_VERSION,
  readBrowserRoleBinding,
  type DesktopBrowserCommand,
  type DesktopBrowserCommandBody,
  type DesktopBrowserCommandResult,
  type DesktopBrowserDenialReason,
  type DesktopBrowserObservedElement,
  type DesktopBrowserObservation,
  type DesktopBrowserObservationGeneration,
  type DesktopBrowserTargetId,
  type DesktopBrowserWorkspaceKey,
  type DesktopBrowserExecutionRole,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Compile-time exhaustiveness for the closed operation unions. The repository's
 * `assertNever` lives in a package this application does not depend on, and
 * adding it would rewrite the release lockfile; this binding gives the same
 * guarantee — a new union member becomes a type error at the assignment — without
 * a new dependency.
 * @param value - member the switch did not handle.
 * @param context - closed union whose handling is incomplete.
 * @returns never, so a caller can use it as the branch result.
 */
function unreachable(value: never, context: string): never {
  throw new Error(`${context}: unhandled member ${JSON.stringify(value)}`)
}

/** The live guest a command addresses, as the Main sees it. */
export interface BrowserAutomationTarget {
  /** Identity the Host addresses. */
  readonly id: DesktopBrowserTargetId
  /** Host generation that owns this target; a newer Host does not inherit it. */
  readonly hostEpoch: number
  readonly workspace: DesktopBrowserWorkspaceKey
  readonly executionRole?: DesktopBrowserExecutionRole
  /** @returns the current guest URL, including user-initiated navigation. */
  url: () => string
  /** @returns the explicitly authorized Session, or undefined before binding or after withdrawal. */
  authorizedSession: () => SessionId | undefined
  /** @param sessionId - Main-acknowledged owner, or undefined to withdraw its authorization and references. */
  authorize: (sessionId: SessionId | undefined) => void
  /** @returns whether the current document remains inside the origin frozen at explicit binding. */
  authorizedDocument: () => boolean
  /** Whether the guest still exists and may act. */
  readonly live: () => boolean
  /** Withdraw this target, including commands waiting for element revalidation. */
  revoke: () => void
  /** Newest observation handed to this Host, or undefined when none exists. */
  readonly currentObservation: () => DesktopBrowserObservation | undefined
  /** @returns the observation the executor produced, already stamped with its generation. */
  observe: () => Promise<DesktopBrowserObservation>
  /**
   * Read one observed element back out of the live document.
   * @param ref - element handle from the accepted observation.
   * @returns where the element is now, or undefined when the page has moved on and
   *   the handle no longer addresses what the Host observed.
   */
  revalidate: (ref: string) => Promise<DesktopBrowserObservedElement | undefined>
  /** Restore and focus only the guest's owning window. @returns whether native input can be dispatched now. */
  prepareInput: () => boolean
  /** Read current window and guest focus without changing either. @returns whether native input can be dispatched now. */
  inputReady: () => boolean
  /** @returns PNG bytes for the target; the allowlist admits no other format. */
  screenshot: () => Promise<Uint8Array>
  /**
   * @param at - the revalidated element the Main aims at, not the observed one; its
   *   `ref` is the handle the Host addressed.
   */
  click: (at: DesktopBrowserObservedElement) => Promise<void>
  /**
   * @param at - the revalidated element the Main aims at, not the observed one.
   * @param text - characters to deliver as real input events.
   */
  type: (at: DesktopBrowserObservedElement, text: string) => Promise<void>
  /** @param at - revalidated element to receive two native mouse clicks. */
  doubleClick: (at: DesktopBrowserObservedElement) => Promise<void>
  /** @param at - revalidated element to focus. @param key - allowlisted native key. */
  pressKey: (at: DesktopBrowserObservedElement, key: Extract<DesktopBrowserCommandBody, { kind: 'press-key' }>['key']) => Promise<void>
  /** @param url - destination. @returns whether Main's navigation restrictions permit it. */
  canNavigate: (url: string) => boolean
  /** @param url - admitted destination; invalidates the current observation before dispatch. */
  navigate: (url: string) => Promise<void>
  /** Reload the observed document and invalidate its references before dispatch. */
  reload: () => Promise<void>
}

/** Refusal of a message that never reached a target, reported with a reason. */
export interface BrowserAutomationRefusal {
  readonly requestId: number
  readonly reason: DesktopBrowserDenialReason
}

/**
 * Read the operation kind of an untrusted payload without widening the allowlist.
 * Returns undefined for anything outside the declared operations and native keys.
 * @param payload - untrusted operation body from private IPC.
 * @returns the declared operation, or undefined when its fields are unreadable.
 */
export function readCommandBody(payload: unknown): DesktopBrowserCommandBody | undefined {
  if (typeof payload !== 'object' || payload === null || !('kind' in payload)) return undefined
  const candidate = payload as Record<string, unknown>
  switch (candidate['kind']) {
    case 'observe':
      return { kind: 'observe' }
    case 'screenshot':
      return candidate['format'] === 'png' ? { kind: 'screenshot', format: 'png' } : undefined
    case 'click':
    case 'double-click': {
      const ref = candidate['ref']
      const generation = candidate['generation']
      if (typeof ref !== 'string' || typeof generation !== 'number' || !Number.isSafeInteger(generation)) return undefined
      return { kind: candidate['kind'], ref, generation }
    }
    case 'type': {
      const ref = candidate['ref']
      const generation = candidate['generation']
      const text = candidate['text']
      if (typeof ref !== 'string' || typeof text !== 'string' || typeof generation !== 'number'
        || !Number.isSafeInteger(generation)) return undefined
      return { kind: 'type', ref, generation, text }
    }
    case 'press-key': {
      const ref = candidate['ref']
      const generation = candidate['generation']
      const key = candidate['key']
      if (typeof ref !== 'string' || typeof generation !== 'number' || !Number.isSafeInteger(generation)) return undefined
      switch (key) {
        case 'Enter': case 'Escape': case 'Tab': case 'Backspace': case 'Delete':
        case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
          return { kind: 'press-key', ref, generation, key }
        default: return undefined
      }
    }
    case 'navigate':
    case 'reload': {
      const generation = candidate['generation']
      if (typeof generation !== 'number' || !Number.isSafeInteger(generation)) return undefined
      if (candidate['kind'] === 'reload') return { kind: 'reload', generation }
      return typeof candidate['url'] === 'string' ? { kind: 'navigate', url: candidate['url'], generation } : undefined
    }
    default:
      return undefined
  }
}

/**
 * Validate a command received over the wire, returning the refusal to send back
 * when it is not admissible. Every field is checked because the sender is the
 * connected Host process, not the page, and a malformed message must not be
 * silently treated as a valid one.
 * @param payload - untrusted command envelope from private IPC.
 * @param options - current Host generation and resolved Main-owned guest.
 * @returns the admitted command or its correlated pre-execution refusal.
 */
export function admitCommand(
  payload: unknown,
  options: BrowserAutomationOptions,
): DesktopBrowserCommand | BrowserAutomationRefusal {
  if (typeof payload !== 'object' || payload === null) {
    return { requestId: 0, reason: 'unknown-operation' }
  }
  const candidate = payload as Record<string, unknown>
  const requestId = candidate['requestId']
  const id = typeof requestId === 'number' && Number.isSafeInteger(requestId) ? requestId : 0
  if (candidate['version'] !== DESKTOP_BROWSER_AUTOMATION_VERSION) return { requestId: id, reason: 'unknown-operation' }
  if (typeof candidate['hostEpoch'] !== 'number' || !Number.isSafeInteger(candidate['hostEpoch'])) {
    return { requestId: id, reason: 'unknown-operation' }
  }
  if (candidate['hostEpoch'] !== options.currentEpoch) return { requestId: id, reason: 'epoch-mismatch' }
  if (typeof candidate['target'] !== 'string') return { requestId: id, reason: 'unknown-operation' }
  if (options.target === undefined) return { requestId: id, reason: 'wrong-target' }
  if (options.target.hostEpoch !== options.currentEpoch) return { requestId: id, reason: 'epoch-mismatch' }
  if (candidate['target'] !== options.target.id) return { requestId: id, reason: 'wrong-target' }
  if (typeof candidate['sessionId'] !== 'string' || candidate['sessionId'].length === 0
    || candidate['sessionId'] !== options.target.authorizedSession()) return { requestId: id, reason: 'session-not-authorized' }
  if (!options.target.live()) return { requestId: id, reason: 'revoked' }
  if (!options.target.authorizedDocument()) return { requestId: id, reason: 'navigation-denied' }
  const body = readCommandBody(candidate['body'])
  if (body === undefined) return { requestId: id, reason: 'unknown-operation' }
  const sessionId = options.target.authorizedSession()
  if (sessionId === undefined) return { requestId: id, reason: 'session-not-authorized' }
  const role = candidate.role === undefined ? undefined : readBrowserRoleBinding(candidate.role)
  if ((candidate.role !== undefined && role === undefined) || (options.target.executionRole !== undefined && role === undefined)
    || (role !== undefined && (options.authorized === undefined || !options.authorized({ version: DESKTOP_BROWSER_AUTOMATION_VERSION,
      requestId: id, hostEpoch: options.currentEpoch, target: options.target.id, sessionId, role, body })))) {
    return { requestId: id, reason: 'session-not-authorized' }
  }
  if (options.signal?.aborted === true) return { requestId: id, reason: 'revoked' }
  return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: id, hostEpoch: options.currentEpoch,
    target: options.target.id, sessionId, ...(role === undefined ? {} : { role }), body }
}

/** Main-owned execution state, read again after each asynchronous element validation. */
export interface BrowserAutomationOptions {
  readonly currentEpoch: number
  readonly target: BrowserAutomationTarget | undefined
  readonly signal?: AbortSignal
  /** @param command - validated command. @returns whether its current role grant remains authorized. */
  readonly authorized?: (command: DesktopBrowserCommand) => boolean
}

let foregroundTail: Promise<void> = Promise.resolve()

function interrupted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return work
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { reject(new Error('desktop browser: command canceled')) }
    signal.addEventListener('abort', abort, { once: true })
    void work.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) }).catch(() => {})
  })
}

function isRefusal(value: DesktopBrowserCommand | BrowserAutomationRefusal): value is BrowserAutomationRefusal {
  return !('body' in value)
}

/**
 * Whether a command's element reference still describes the page as the Host last
 * observed it. An action computed against an older generation is refused instead
 * of being applied to whatever now occupies those coordinates.
 * @param body - allowlisted operation and its observation generation.
 * @param current - current Main observation, absent after navigation or withdrawal.
 * @returns whether the operation may use this generation.
 */
export function acceptsGeneration(
  body: DesktopBrowserCommandBody,
  current: DesktopBrowserObservationGeneration | undefined,
): boolean {
  switch (body.kind) {
    case 'observe':
    case 'screenshot':
      return true
    case 'click':
    case 'type':
    case 'double-click':
    case 'press-key':
    case 'navigate':
    case 'reload':
      return current !== undefined && current === body.generation
    default:
      return unreachable(body, 'desktop browser automation body')
  }
}

/**
 * Admission plus execution for one command. The caller resolves which target a
 * command addresses; this function decides, runs, and always answers with a
 * correlated result so the Host never has to infer one.
 * @param payload - untrusted command envelope from private IPC.
 * @param options - current Host generation and resolved Main-owned guest.
 * @returns correlated success, confirmed non-execution, or an unknown dispatched outcome.
 */
export function runCommand(
  payload: unknown,
  options: BrowserAutomationOptions,
): Promise<DesktopBrowserCommandResult> {
  const body = typeof payload === 'object' && payload !== null && 'body' in payload ? readCommandBody(payload.body) : undefined
  if (body !== undefined && ['click', 'type', 'double-click', 'press-key'].includes(body.kind)) {
    const task = foregroundTail.then(() => executeCommand(payload, options))
    foregroundTail = task.then(() => {}, () => {})
    return task
  }
  return executeCommand(payload, options)
}

async function executeCommand(payload: unknown, options: BrowserAutomationOptions): Promise<DesktopBrowserCommandResult> {
  const admitted = admitCommand(payload, options)
  if (isRefusal(admitted)) {
    return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: admitted.requestId, ok: false, outcome: 'not-executed', reason: admitted.reason }
  }
  const target = options.target
  if (target === undefined) {
    return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: admitted.requestId, ok: false, outcome: 'not-executed', reason: 'wrong-target' }
  }
  const body: DesktopBrowserCommandBody = admitted.body
  if (!acceptsGeneration(body, target.currentObservation()?.generation)) {
    return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: admitted.requestId, ok: false, outcome: 'not-executed', reason: 'stale-observation' }
  }
  // A generation counter only proves the Host and the Main agree on which observation
  // was accepted; it does not prove the page still looks that way. Every action reads
  // its element back out of the live document first, so a navigation or a layout
  // change is refused here — before any input reaches the guest — and the input is
  // aimed at the element's current position rather than its remembered one.
  const stale = { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: admitted.requestId, ok: false, outcome: 'not-executed', reason: 'stale-observation' } as const
  let dispatched = false
  const authorized = (): boolean => options.signal?.aborted !== true
    && (admitted.role === undefined || options.authorized?.(admitted) === true)
  try {
    switch (body.kind) {
      case 'observe':
        dispatched = true
        return {
          version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: admitted.requestId, ok: true,
          observation: await target.observe(),
        }
      case 'screenshot':
        dispatched = true
        return {
          version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: admitted.requestId, ok: true,
          screenshot: await target.screenshot(),
        }
      case 'click':
      case 'type':
      case 'double-click':
      case 'press-key': {
        const at = await interrupted(target.revalidate(body.ref), options.signal)
        if (at === undefined) return stale
        if (!authorized()) return { ...stale, reason: 'revoked' }
        if (!target.live()) return { ...stale, reason: 'revoked' }
        if (target.authorizedSession() !== admitted.sessionId) return { ...stale, reason: 'session-not-authorized' }
        if (!target.authorizedDocument()) return { ...stale, reason: 'navigation-denied' }
        if (!acceptsGeneration(body, target.currentObservation()?.generation)) return stale
        if (!target.prepareInput()) return { ...stale, reason: 'action-failed' }
        if (!target.live()) return { ...stale, reason: 'revoked' }
        if (target.authorizedSession() !== admitted.sessionId) return { ...stale, reason: 'session-not-authorized' }
        if (!target.authorizedDocument()) return { ...stale, reason: 'navigation-denied' }
        if (!acceptsGeneration(body, target.currentObservation()?.generation)) return stale
        const focusedAt = await interrupted(target.revalidate(body.ref), options.signal)
        if (focusedAt === undefined) return stale
        if (!authorized()) return { ...stale, reason: 'revoked' }
        if (!target.live()) return { ...stale, reason: 'revoked' }
        if (!authorized()) return { ...stale, reason: 'revoked' }
        if (target.authorizedSession() !== admitted.sessionId) return { ...stale, reason: 'session-not-authorized' }
        if (!target.authorizedDocument()) return { ...stale, reason: 'navigation-denied' }
        if (!acceptsGeneration(body, target.currentObservation()?.generation)) return stale
        if (!target.inputReady()) return { ...stale, reason: 'action-failed' }
        dispatched = true
        switch (body.kind) {
          case 'click': await target.click(focusedAt); break
          case 'type': await target.type(focusedAt, body.text); break
          case 'double-click': await target.doubleClick(focusedAt); break
          case 'press-key': await target.pressKey(focusedAt, body.key); break
          default: return unreachable(body, 'desktop browser element action')
        }
        return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: admitted.requestId, ok: true }
      }
      case 'navigate':
      case 'reload': {
        const url = body.kind === 'navigate' ? body.url : target.currentObservation()?.url
        if (url === undefined) return stale
        if (!target.canNavigate(url)) return { ...stale, reason: 'navigation-denied' }
        if (!target.live()) return { ...stale, reason: 'revoked' }
        if (!acceptsGeneration(body, target.currentObservation()?.generation)) return stale
        dispatched = true
        if (body.kind === 'navigate') await target.navigate(url)
        else await target.reload()
        return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: admitted.requestId, ok: true }
      }
      default:
        return unreachable(body, 'desktop browser automation body')
    }
  } catch (_error) {
    // Input delivery can fail after a partial action; an exception cannot undo it.
    return dispatched
      ? { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: admitted.requestId, ok: false, outcome: 'unknown', reason: 'execution-failed' }
      : { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: admitted.requestId, ok: false, outcome: 'not-executed', reason: 'action-failed' }
  }
}
