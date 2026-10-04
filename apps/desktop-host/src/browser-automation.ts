/**
 * Host end of the controlled browser automation channel.
 *
 * The Host owns the tool call and the Main owns the guest, so this module turns one
 * tool call into a single correlated IPC message and the Main's answer back into that
 * call's result. It stamps nothing it was not told: the generation a command carries is
 * the one the Main announced, and a command is refused here rather than put on the wire
 * while no Main is listening.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import {
  DESKTOP_BROWSER_AUTOMATION_VERSION,
  type DesktopBrowserAutomationBridge,
  type DesktopBrowserCommand,
  type DesktopBrowserCommandResult,
  type DesktopBrowserDenialReason,
  type DesktopBrowserObservedElement,
  type DesktopBrowserObservation,
  type DesktopBrowserTargetId,
  type DesktopBrowserUnknownReason,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser'

/** Delivers one message to the connected Main and settles when that IPC write finished. */
export type DesktopBrowserCommandTransport = (message: object) => Promise<void>

/**
 * The Host's half of the channel. `accept` is the only path a Main message takes into
 * it, so an answer that is uncorrelated or unreadable is reported instead of applied
 * to whichever call happens to be waiting.
 */
export interface DesktopBrowserAutomationSender extends DesktopBrowserAutomationBridge {
  /**
   * @param message - One inbound IPC payload.
   * @returns true when the payload was this channel's answer, which no other handler
   *   may then reinterpret; false leaves the message to the caller's other handlers.
   */
  accept(message: unknown): boolean
  /** Settle unanswered dispatches with unknown outcomes; refuse later submissions before dispatch. */
  dispose(): void
}

const DENIAL_REASONS: readonly DesktopBrowserDenialReason[] = [
  'unknown-operation', 'wrong-target', 'stale-observation', 'epoch-mismatch', 'revoked', 'action-failed', 'navigation-denied',
  'session-not-authorized',
]

const UNKNOWN_REASONS: readonly DesktopBrowserUnknownReason[] = [
  'connection-lost', 'epoch-changed', 'channel-closed', 'invalid-reply', 'execution-failed',
]

function isDenialReason(value: unknown): value is DesktopBrowserDenialReason {
  return typeof value === 'string' && (DENIAL_REASONS as readonly string[]).includes(value)
}

function isUnknownReason(value: unknown): value is DesktopBrowserUnknownReason {
  return typeof value === 'string' && (UNKNOWN_REASONS as readonly string[]).includes(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readElement(value: unknown): DesktopBrowserObservedElement | undefined {
  if (!isRecord(value)) return undefined
  const { ref, role, name, x, y, width, height } = value
  if (!isText(ref) || !isText(role) || !isText(name)) return undefined
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return undefined
  return { ref, role, name, x, y, width, height }
}

function readObservation(value: unknown): DesktopBrowserObservation | undefined {
  if (!isRecord(value) || !isCount(value['generation'])) return undefined
  const { hostEpoch, target, generation, url, title, elements } = value
  if (!isCount(hostEpoch) || !isText(target) || !isText(url) || !isText(title) || !Array.isArray(elements)) {
    return undefined
  }
  const read: DesktopBrowserObservedElement[] = []
  for (const item of elements) {
    const element = readElement(item)
    if (element === undefined) return undefined
    read.push(element)
  }
  return { hostEpoch, target: brandString<DesktopBrowserTargetId>(target), generation, url, title, elements: read }
}

/**
 * Read one answer that crossed the process boundary. Every field the provider branches
 * on is checked here, because the Main is a cooperating process and a truncated or
 * reordered payload must not reach the tool result as if it were complete.
 * @param payload - Untrusted result carried by the answer.
 * @returns the typed result, or undefined when the payload is not a complete one.
 */
export function readCommandResult(payload: unknown): DesktopBrowserCommandResult | undefined {
  if (!isRecord(payload) || payload['version'] !== DESKTOP_BROWSER_AUTOMATION_VERSION) return undefined
  const { requestId, ok } = payload
  if (!isCount(requestId) || typeof ok !== 'boolean') return undefined
  if (!ok) {
    const reason = payload['reason']
    if (payload['outcome'] === 'not-executed' && isDenialReason(reason)) {
      return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId, ok: false, outcome: 'not-executed', reason }
    }
    if (payload['outcome'] === 'unknown' && isUnknownReason(reason)) {
      return { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId, ok: false, outcome: 'unknown', reason }
    }
    return undefined
  }
  const observation = payload['observation']
  const screenshot = payload['screenshot']
  const read = observation === undefined ? undefined : readObservation(observation)
  if (observation !== undefined && read === undefined) return undefined
  if (screenshot !== undefined && !(screenshot instanceof Uint8Array)) return undefined
  return {
    version: DESKTOP_BROWSER_AUTOMATION_VERSION,
    requestId,
    ok: true,
    ...(read === undefined ? {} : { observation: read }),
    ...(screenshot === undefined ? {} : { screenshot }),
  }
}

/**
 * Install the Host half of the channel.
 *
 * @param send - Transport that delivers one message to the connected Main.
 * @returns Sender that distinguishes pre-dispatch denials from unknown outcomes after
 *   dispatch. Disconnect, invalid replies, and failed writes never authorize a retry.
 */
export function installDesktopBrowserAutomation(
  send: DesktopBrowserCommandTransport,
): DesktopBrowserAutomationSender {
  let epoch: number | undefined
  let nextRequestId = 1
  let disposed = false
  const pending = new Map<number, {
    readonly command: DesktopBrowserCommand
    readonly settled: ReturnType<typeof Promise.withResolvers<DesktopBrowserCommandResult>>
    readonly releaseCancellation: () => void
  }>()

  const deny = (requestId: number, reason: DesktopBrowserDenialReason): DesktopBrowserCommandResult => ({
    version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId, ok: false, outcome: 'not-executed', reason,
  })

  const unknown = (requestId: number, reason: DesktopBrowserUnknownReason): DesktopBrowserCommandResult => ({
    version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId, ok: false, outcome: 'unknown', reason,
  })

  const revoke = (reason: DesktopBrowserUnknownReason): void => {
    for (const [envelope, { command, settled, releaseCancellation }] of pending) {
      pending.delete(envelope)
      releaseCancellation()
      settled.resolve(unknown(command.requestId, reason))
    }
  }

  return {
    connectHost(connected: number): void {
      if (connected !== epoch) {
        epoch = connected
        revoke('epoch-changed')
      }
    },

    async submit(command: DesktopBrowserCommand, signal?: AbortSignal): Promise<DesktopBrowserCommandResult> {
      const isCanceled = (): boolean => signal?.aborted === true
      if (disposed || epoch === undefined || isCanceled()) return deny(command.requestId, 'revoked')
      if (command.hostEpoch !== epoch) return deny(command.requestId, 'epoch-mismatch')
      const envelope = nextRequestId++
      const settled = Promise.withResolvers<DesktopBrowserCommandResult>()
      const canceled = (): void => {
        if (!pending.has(envelope)) return
        try { void send({ type: 'browser-command-cancel', requestId: envelope, hostEpoch: command.hostEpoch }).catch(failedWrite) }
        catch (_error) { failedWrite() }
      }
      const releaseCancellation = (): void => { signal?.removeEventListener('abort', canceled) }
      pending.set(envelope, { command, settled, releaseCancellation })
      const failedWrite = (): void => {
        if (!pending.delete(envelope)) return
        releaseCancellation()
        settled.resolve(unknown(command.requestId, 'connection-lost'))
      }
      signal?.addEventListener('abort', canceled, { once: true })
      try {
        // A failed write cannot establish whether Main received or executed the command.
        // Waiting for its callback must not block settlement after disconnect.
        void send({ type: 'browser-command', command, requestId: envelope }).catch(failedWrite)
        if (isCanceled()) canceled()
      } catch (_error) {
        failedWrite()
      }
      return await settled.promise
    },

    accept(message: unknown): boolean {
      if (!isRecord(message) || message['type'] !== 'browser-command-result') return false
      const envelope = message['requestId']
      if (!isCount(envelope)) return false
      const waiting = pending.get(envelope)
      if (waiting === undefined) return false
      pending.delete(envelope)
      waiting.releaseCancellation()
      const result = readCommandResult(message['result'])
      if (result === undefined || !matchesCommand(result, waiting.command)) {
        waiting.settled.resolve(unknown(waiting.command.requestId, 'invalid-reply'))
        return true
      }
      waiting.settled.resolve(result)
      return true
    },

    disconnectHost(disconnected: number): void {
      if (disconnected !== epoch) return
      epoch = undefined
      revoke('connection-lost')
    },

    dispose(): void {
      disposed = true
      epoch = undefined
      revoke('channel-closed')
    },
  }
}

function matchesCommand(result: DesktopBrowserCommandResult, command: DesktopBrowserCommand): boolean {
  if (result.requestId !== command.requestId) return false
  if (!result.ok) return true
  switch (command.body.kind) {
    case 'observe':
      return result.observation !== undefined && result.screenshot === undefined
        && result.observation.hostEpoch === command.hostEpoch && result.observation.target === command.target
    case 'screenshot':
      return result.screenshot !== undefined && result.observation === undefined
    case 'click':
    case 'type':
    case 'double-click':
    case 'press-key':
    case 'navigate':
    case 'reload':
      return result.observation === undefined && result.screenshot === undefined
    default: {
      const unsupported: never = command.body
      throw new Error(`Unsupported browser operation: ${JSON.stringify(unsupported)}`)
    }
  }
}
