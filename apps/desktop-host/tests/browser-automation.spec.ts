/** Host half of the browser automation channel, exercised without Electron. */

import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DESKTOP_BROWSER_AUTOMATION_VERSION, type DesktopBrowserTargetId } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { installDesktopBrowserAutomation } from '../src/browser-automation.ts'

const TARGET = 'guest-1' as DesktopBrowserTargetId
const EPOCH = 3

/** One command addressed to the connected generation. */
function command(overrides: { hostEpoch?: number; requestId?: number } = {}) {
  return {
    version: DESKTOP_BROWSER_AUTOMATION_VERSION,
    requestId: overrides.requestId ?? 77,
    hostEpoch: overrides.hostEpoch ?? EPOCH,
    target: TARGET,
    sessionId: SessionId('host-controls-owner'),
    body: { kind: 'observe' },
  } as const
}

function observed(requestId = 77) {
  return {
    version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId, ok: true,
    observation: { hostEpoch: EPOCH, target: TARGET, generation: 4, url: 'https://shop.example/', title: 'Shop', elements: [] },
  }
}

/** Records what reached the wire; the test decides when and what the Main answers. */
function transport() {
  const sent: Record<string, unknown>[] = []
  const channel = installDesktopBrowserAutomation(async (message) => {
    sent.push(message as Record<string, unknown>)
  })
  const answer = (index: number, result: unknown) => channel.accept({
    type: 'browser-command-result',
    requestId: sent[index]?.['requestId'],
    result,
  })
  return { channel, sent, answer }
}

it('refuses a command outright while no Main is connected, without writing to the wire', async () => {
  const { channel, sent } = transport()

  await expect(channel.submit(command())).resolves.toMatchObject({ ok: false, outcome: 'not-executed', reason: 'revoked' })
  expect(sent).toEqual([])
})

it('refuses a command stamped with another generation rather than sending it', async () => {
  const { channel, sent, answer } = transport()
  channel.connectHost(EPOCH)

  await expect(channel.submit(command({ hostEpoch: EPOCH + 1 }))).resolves.toMatchObject({
    ok: false, outcome: 'not-executed', reason: 'epoch-mismatch',
  })
  expect(sent).toEqual([])

  // The same command carrying the connected generation does reach the Main.
  const waiting = channel.submit(command())
  expect(answer(0, observed())).toBe(true)
  await expect(waiting).resolves.toMatchObject({ ok: true })
})

it('answers a connected command with the Main result correlated by its own envelope id', async () => {
  const { channel, sent, answer } = transport()
  channel.connectHost(EPOCH)

  const waiting = channel.submit(command())
  answer(0, {
    version: DESKTOP_BROWSER_AUTOMATION_VERSION,
    requestId: 77,
    ok: true,
    observation: { hostEpoch: EPOCH, target: TARGET, generation: 4, url: 'https://shop.example/', title: 'Shop', elements: [] },
  })

  const result = await waiting
  expect(result).toMatchObject({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 77, ok: true })
  // The envelope id is the Host's own counter, never the command's id, so two calls
  // from different owners cannot land in one pending slot.
  expect(sent[0]).toMatchObject({ type: 'browser-command', requestId: 1 })
  expect(result.ok && result.observation?.generation).toBe(4)
})

it('returns the command id when a dispatched call loses its generation', async () => {
  const { channel } = transport()
  channel.connectHost(EPOCH)
  const inFlight = channel.submit(command({ requestId: 77 }))

  channel.connectHost(EPOCH + 1)

  // 77 is the caller's id; the envelope was 1. Reporting the envelope here would hand
  // the caller a result it cannot recognise as its own.
  await expect(inFlight).resolves.toMatchObject({ requestId: 77, ok: false, outcome: 'unknown', reason: 'epoch-changed' })
})

it('fails a call whose answer names a different command rather than adopting it', async () => {
  const { channel, answer } = transport()
  channel.connectHost(EPOCH)

  const waiting = channel.submit(command({ requestId: 77 }))
  answer(0, { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 78, ok: true })

  await expect(waiting).resolves.toMatchObject({ requestId: 77, ok: false, outcome: 'unknown', reason: 'invalid-reply' })
})

it('does not let a late answer for an already-settled call reopen it', async () => {
  const { channel, answer } = transport()
  channel.connectHost(EPOCH)
  const waiting = channel.submit(command())
  answer(0, observed())
  await expect(waiting).resolves.toMatchObject({ ok: true })

  // The same envelope a second time belongs to no pending call, so it is refused
  // rather than resolving anything.
  expect(channel.accept({ type: 'browser-command-result', requestId: 1, result: { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 77, ok: false, reason: 'revoked' } })).toBe(false)
})

it('keeps concurrent commands apart and answers each with its own result', async () => {
  const { channel, sent, answer } = transport()
  channel.connectHost(EPOCH)

  const first = channel.submit(command({ requestId: 1 }))
  const second = channel.submit(command({ requestId: 2 }))
  expect(sent.map(message => message['requestId'])).toEqual([1, 2])

  answer(1, { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 2, ok: false, outcome: 'not-executed', reason: 'stale-observation' })
  answer(0, { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 1, ok: false, outcome: 'not-executed', reason: 'wrong-target' })

  await expect(first).resolves.toMatchObject({ requestId: 1, reason: 'wrong-target' })
  await expect(second).resolves.toMatchObject({ requestId: 2, reason: 'stale-observation' })
})

it('reports an unknown outcome when a newer Main generation takes over', async () => {
  const { channel } = transport()
  channel.connectHost(EPOCH)
  const inFlight = channel.submit(command())
  expect(inFlight).toBeInstanceOf(Promise)

  channel.connectHost(EPOCH + 1)

  await expect(inFlight).resolves.toMatchObject({ ok: false, outcome: 'unknown', reason: 'epoch-changed' })
})

it('ignores a disconnect announcement for a generation it is not serving', async () => {
  const { channel, answer } = transport()
  channel.connectHost(EPOCH)
  channel.disconnectHost(EPOCH + 1)

  const waiting = channel.submit(command())
  answer(0, observed())

  await expect(waiting).resolves.toMatchObject({ ok: true })
})

it('distinguishes unanswered dispatches from later refusals when the channel closes', async () => {
  const disconnecting = transport()
  disconnecting.channel.connectHost(EPOCH)
  const dropped = disconnecting.channel.submit(command())
  disconnecting.channel.disconnectHost(EPOCH)
  await expect(dropped).resolves.toMatchObject({ ok: false, outcome: 'unknown', reason: 'connection-lost' })

  const stopping = transport()
  stopping.channel.connectHost(EPOCH)
  const held = stopping.channel.submit(command())
  stopping.channel.dispose()
  await expect(held).resolves.toMatchObject({ ok: false, outcome: 'unknown', reason: 'channel-closed' })
  await expect(stopping.channel.submit(command())).resolves.toMatchObject({ ok: false, outcome: 'not-executed', reason: 'revoked' })
})

it('does not infer non-execution or retry when the IPC write fails', async () => {
  const sent: object[] = []
  const channel = installDesktopBrowserAutomation(async (message) => {
    sent.push(message)
    throw new Error('channel closed')
  })
  channel.connectHost(EPOCH)

  await expect(channel.submit(command())).resolves.toMatchObject({ ok: false, outcome: 'unknown', reason: 'connection-lost' })
  expect(sent).toHaveLength(1)
})

it('reports an answer that belongs to no waiting call instead of applying it', () => {
  const { channel } = transport()
  channel.connectHost(EPOCH)

  expect(channel.accept({ type: 'browser-command-result', requestId: 9, result: { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 9, ok: true } })).toBe(false)
})

it('preserves an explicit unknown result from Main with the original command id', async () => {
  const { channel, answer } = transport()
  channel.connectHost(EPOCH)
  const waiting = channel.submit(command())
  answer(0, { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 77, ok: false, outcome: 'unknown', reason: 'execution-failed' })
  await expect(waiting).resolves.toEqual({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 77, ok: false, outcome: 'unknown', reason: 'execution-failed' })
})

it('leaves other IPC messages to their own handlers', () => {
  const { channel } = transport()

  expect(channel.accept({ type: 'update-tasks', requestId: 1, active: true })).toBe(false)
  expect(channel.accept({ type: 'shutdown-complete' })).toBe(false)
  expect(channel.accept('browser-command-result')).toBe(false)
  expect(channel.accept(undefined)).toBe(false)
  expect(channel.accept({ type: 'browser-command-result', requestId: '1', result: {} })).toBe(false)
})

it('sends cancellation for the exact envelope and retains the correlated dispatch outcome', async () => {
  const { channel, sent, answer } = transport()
  channel.connectHost(EPOCH)
  const aborted = new AbortController()
  aborted.abort()
  expect(await channel.submit(command(), aborted.signal)).toMatchObject({ outcome: 'not-executed', reason: 'revoked' })
  expect(sent).toEqual([])
  const controller = new AbortController()
  const pending = channel.submit(command(), controller.signal)
  controller.abort()
  expect(sent[1]).toEqual({ type: 'browser-command-cancel', requestId: 1, hostEpoch: EPOCH })
  answer(0, observed())
  expect((await pending).ok).toBe(true)
  controller.abort()
  expect(sent).toHaveLength(2)
})

it('fails the waiting call when the Main answer is unreadable rather than reporting success', async () => {
  const { channel, answer } = transport()
  channel.connectHost(EPOCH)

  const waiting = channel.submit(command())
  answer(0, { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 77, ok: true, observation: { generation: 4, target: TARGET, url: 'x', title: 'y' } })

  await expect(waiting).resolves.toMatchObject({ ok: false, outcome: 'unknown', reason: 'invalid-reply' })
})

it('rejects a denial reason outside the closed set', async () => {
  const { channel, answer } = transport()
  channel.connectHost(EPOCH)

  const waiting = channel.submit(command())
  answer(0, { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 77, ok: false, reason: 'anything-goes' })

  await expect(waiting).resolves.toMatchObject({ ok: false, outcome: 'unknown', reason: 'invalid-reply' })
})

it('keeps concurrent commands with the same caller id in distinct envelope slots', async () => {
  const { channel, sent, answer } = transport()
  channel.connectHost(EPOCH)
  const first = channel.submit(command())
  const second = channel.submit(command())
  expect(sent.map(message => message['requestId'])).toEqual([1, 2])
  answer(1, { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 77, ok: false, outcome: 'not-executed', reason: 'wrong-target' })
  answer(0, observed())
  await expect(first).resolves.toMatchObject({ requestId: 77, ok: true })
  await expect(second).resolves.toMatchObject({ requestId: 77, outcome: 'not-executed', reason: 'wrong-target' })
})

it('settles a disconnected call even while its write callback remains pending', async () => {
  const write = Promise.withResolvers<undefined>()
  const channel = installDesktopBrowserAutomation(() => write.promise)
  channel.connectHost(EPOCH)
  try {
    const waiting = channel.submit(command())
    channel.disconnectHost(EPOCH)
    await expect(waiting).resolves.toMatchObject({ requestId: 77, outcome: 'unknown', reason: 'connection-lost' })
    expect(channel.accept({ type: 'browser-command-result', requestId: 1, result: observed() })).toBe(false)
  } finally {
    write.resolve(undefined)
    channel.dispose()
  }
})

it('preserves a correlated completion when the write callback fails later', async () => {
  const write = Promise.withResolvers<undefined>()
  const channel = installDesktopBrowserAutomation(() => write.promise)
  channel.connectHost(EPOCH)
  const waiting = channel.submit(command())
  channel.accept({ type: 'browser-command-result', requestId: 1, result: observed() })
  write.reject(new Error('late transport error'))
  await expect(waiting).resolves.toMatchObject({ requestId: 77, ok: true })
})

it.each([
  { version: 1, requestId: 77, ok: true },
  { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 77, ok: true },
  { ...observed(), observation: { ...observed().observation, target: 'other-target' } },
  { ...observed(), observation: { ...observed().observation, hostEpoch: EPOCH + 1 } },
  { ...observed(), screenshot: new Uint8Array([1]) },
  { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 77, ok: false, outcome: 'not-executed', reason: 'execution-failed' },
  { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 77, ok: false, outcome: 'unknown', reason: 'wrong-target' },
])('classifies incomplete or inconsistent replies as unknown: %j', async (reply) => {
  const { channel, answer } = transport()
  channel.connectHost(EPOCH)
  const waiting = channel.submit(command())
  answer(0, reply)
  await expect(waiting).resolves.toMatchObject({ requestId: 77, outcome: 'unknown', reason: 'invalid-reply' })
})
