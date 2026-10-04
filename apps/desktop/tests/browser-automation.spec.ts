import { SessionId } from '@deepseek-ai/dsh-session'
import type { DesktopBrowserWorkspaceKey } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
/**
 * Refusal controls for the Host↔Main browser automation channel. Every case drives
 * `runCommand`, the same entry point the Main uses, so a pass here is a property of
 * the admission path rather than of a test-only shortcut.
 */
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_BROWSER_AUTOMATION_VERSION,
  type DesktopBrowserObservation,
  type DesktopBrowserObservedElement,
  type DesktopBrowserTargetId,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import {
  acceptsGeneration,
  admitCommand,
  readCommandBody,
  runCommand,
  type BrowserAutomationTarget,
} from '../src/browser-automation.ts'

const TARGET = 'target-a' as DesktopBrowserTargetId
const EPOCH = 7

function observation(generation: number): DesktopBrowserObservation {
  return {
    hostEpoch: EPOCH,
    target: TARGET,
    generation,
    url: 'https://example.test/checkout',
    title: 'Checkout',
    elements: [{ ref: 'e1', role: 'button', name: 'Pay', x: 10, y: 20, width: 80, height: 30 }],
  }
}

interface TargetOptions {
  readonly generation?: number | undefined
  readonly live?: boolean
  readonly hostEpoch?: number
  readonly failAction?: boolean
  readonly calls?: string[]
  /** What the live document says about the addressed element; undefined means gone. */
  readonly revalidated?: DesktopBrowserObservedElement | undefined
}

function target(options: TargetOptions = {}): BrowserAutomationTarget {
  const generation = options.generation === undefined ? 1 : options.generation
  const calls = options.calls ?? []
  return {
    id: TARGET,
    hostEpoch: options.hostEpoch ?? EPOCH,
    workspace: 'session:controls-owner' as DesktopBrowserWorkspaceKey,
    url: () => 'https://example.test/',
    authorizedSession: () => SessionId('controls-owner'),
    authorize: () => {},
    authorizedDocument: () => true,
    prepareInput: () => true,
    inputReady: () => true,
    revoke: () => {},
    live: () => options.live ?? true,
    currentObservation: () => (generation === undefined ? undefined : observation(generation)),
    observe: async () => { calls.push('observe'); return observation(generation ?? 1) },
    revalidate: async () => {
      calls.push('revalidate')
      return 'revalidated' in options ? options.revalidated : { ref: 'e0', role: 'button', name: 'Go', x: 5, y: 6, width: 7, height: 8 }
    },
    doubleClick: async () => { calls.push('double-click') },
    pressKey: async () => { calls.push('press-key') },
    canNavigate: () => true,
    navigate: async () => { calls.push('navigate') },
    reload: async () => { calls.push('reload') },
    screenshot: async () => { calls.push('screenshot'); return new Uint8Array([137, 80, 78, 71]) },
    click: async () => {
      calls.push('click')
      if (options.failAction) throw new Error('guest detached during click')
    },
    type: async () => { calls.push('type'); if (options.failAction) throw new Error('guest detached during type') },
  }
}

function command(body: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: DESKTOP_BROWSER_AUTOMATION_VERSION,
    requestId: 11,
    hostEpoch: EPOCH,
    target: TARGET,
    sessionId: SessionId('controls-owner'),
    body,
    ...overrides,
  }
}

it('cancels a pending element read before native input and releases the foreground queue', async () => {
  const entered = Promise.withResolvers<undefined>(), pending = Promise.withResolvers<DesktopBrowserObservedElement | undefined>()
  const controller = new AbortController()
  const calls: string[] = []
  const first = runCommand(command({ kind: 'click', ref: 'e1', generation: 1 }), { currentEpoch: EPOCH,
    target: { ...target({ calls }), revalidate: async () => { entered.resolve(undefined); return pending.promise } },
    signal: controller.signal })
  await entered.promise
  const second = runCommand(command({ kind: 'click', ref: 'e1', generation: 1 }, { requestId: 12 }), {
    currentEpoch: EPOCH, target: target({ calls }) })
  controller.abort()
  expect(await first).toMatchObject({ outcome: 'not-executed' })
  expect((await second).ok).toBe(true)
  pending.resolve(observation(1).elements[0])
  await Promise.resolve()
  expect(calls.filter(call => call === 'click')).toHaveLength(1)
})

it('serializes foreground validation and input across targets while allowing independent observations', async () => {
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const calls: string[] = []
  const firstTarget = { ...target({ calls }), revalidate: async () => {
    entered.resolve(undefined); await release.promise; return observation(1).elements[0]
  } }
  const first = runCommand(command({ kind: 'click', ref: 'e1', generation: 1 }), { currentEpoch: EPOCH, target: firstTarget })
  await entered.promise
  const secondCalls: string[] = []
  const second = runCommand(command({ kind: 'click', ref: 'e1', generation: 1 }), { currentEpoch: EPOCH, target: target({ calls: secondCalls }) })
  const observed = await runCommand(command({ kind: 'observe' }), { currentEpoch: EPOCH, target: target({ calls: secondCalls }) })
  expect(observed.ok).toBe(true)
  expect(secondCalls).toEqual(['observe'])
  release.resolve(undefined)
  expect((await first).ok).toBe(true)
  expect((await second).ok).toBe(true)
  expect(secondCalls).toEqual(['observe', 'revalidate', 'revalidate', 'click'])
})

describe('readCommandBody', () => {
  it('reads new commands and rejects unsupported keys and malformed generations', () => {
    expect(readCommandBody({ kind: 'double-click', ref: 'e0', generation: 1 })).toEqual({ kind: 'double-click', ref: 'e0', generation: 1 })
    expect(readCommandBody({ kind: 'press-key', ref: 'e0', generation: 1, key: 'Enter' })).toEqual({ kind: 'press-key', ref: 'e0', generation: 1, key: 'Enter' })
    expect(readCommandBody({ kind: 'navigate', generation: 1, url: 'https://example.test/checkout#active' })).toBeDefined()
    expect(readCommandBody({ kind: 'reload', generation: 1 })).toEqual({ kind: 'reload', generation: 1 })
    expect(readCommandBody({ kind: 'press-key', ref: 'e0', generation: 1, key: 'Control+L' })).toBeUndefined()
    expect(readCommandBody({ kind: 'press-key', ref: 'e0', generation: 1, key: 'F12' })).toBeUndefined()
    expect(readCommandBody({ kind: 'navigate', generation: 1, url: 9 })).toBeUndefined()
    expect(readCommandBody({ kind: 'reload', generation: '1' })).toBeUndefined()
  })
  it('accepts exactly the four declared operations and nothing else', () => {
    expect(readCommandBody({ kind: 'observe' })).toEqual({ kind: 'observe' })
    expect(readCommandBody({ kind: 'screenshot', format: 'png' })).toEqual({ kind: 'screenshot', format: 'png' })
    expect(readCommandBody({ kind: 'click', ref: 'e1', generation: 2 })).toEqual({ kind: 'click', ref: 'e1', generation: 2 })
    expect(readCommandBody({ kind: 'type', ref: 'e1', generation: 2, text: 'x' })).toEqual({ kind: 'type', ref: 'e1', generation: 2, text: 'x' })
  })

  it('refuses an escape hatch that would hand the page or model host control', () => {
    expect(readCommandBody({ kind: 'evaluate', expression: 'process' })).toBeUndefined()
    expect(readCommandBody({ kind: 'sendCommand', method: 'Browser.close' })).toBeUndefined()
    expect(readCommandBody({ kind: 'executeJavaScript', code: '1' })).toBeUndefined()
    expect(readCommandBody({ kind: 'screenshot', format: 'pdf' })).toBeUndefined()
    expect(readCommandBody({ kind: 'click', ref: 'e1', generation: 1.5 })).toBeUndefined()
    expect(readCommandBody({ kind: 'click', ref: 'e1' })).toBeUndefined()
    expect(readCommandBody({ kind: 'type', ref: 'e1', generation: 1 })).toBeUndefined()
  })
})

it('refuses revision 1 without dispatching any operation', async () => {
  const calls: string[] = []
  expect(await runCommand(command({ kind: 'observe' }, { version: 1 }), { currentEpoch: EPOCH, target: target({ calls }) }))
    .toMatchObject({ outcome: 'not-executed', reason: 'unknown-operation' })
  expect(calls).toEqual([])
})

describe('admitCommand', () => {
  it('admits a well-formed command from the current epoch', () => {
    const admitted = admitCommand(command({ kind: 'observe' }), { currentEpoch: EPOCH, target: target() })
    expect(admitted).toMatchObject({ requestId: 11, hostEpoch: EPOCH, target: TARGET })
  })

  it('refuses a command carrying an older or newer Host generation', () => {
    const current = { currentEpoch: EPOCH, target: target() }
    expect(admitCommand(command({ kind: 'observe' }, { hostEpoch: EPOCH - 1 }), current))
      .toMatchObject({ reason: 'epoch-mismatch' })
    expect(admitCommand(command({ kind: 'observe' }, { hostEpoch: EPOCH + 1 }), current))
      .toMatchObject({ reason: 'epoch-mismatch' })
  })

  it('refuses a target this Host does not own, including one inherited from an older epoch', () => {
    const current = { currentEpoch: EPOCH, target: target() }
    expect(admitCommand(command({ kind: 'observe' }, { target: 'target-b' }), current))
      .toMatchObject({ reason: 'wrong-target' })
    expect(admitCommand(command({ kind: 'observe' }, { target: 'target-a' }), { currentEpoch: EPOCH, target: target({ hostEpoch: EPOCH - 1 }) }))
      .toMatchObject({ reason: 'epoch-mismatch' })
    expect(admitCommand(command({ kind: 'observe' }), { currentEpoch: EPOCH, target: undefined }))
      .toMatchObject({ reason: 'wrong-target' })
  })

  it('refuses a protocol revision it does not speak', () => {
    expect(admitCommand(command({ kind: 'observe' }, { version: DESKTOP_BROWSER_AUTOMATION_VERSION + 1 }), { currentEpoch: EPOCH, target: target() }))
      .toMatchObject({ reason: 'unknown-operation' })
  })

  it('refuses a destroyed target as revoked rather than acting on it', () => {
    expect(admitCommand(command({ kind: 'observe' }), { currentEpoch: EPOCH, target: target({ live: false }) }))
      .toMatchObject({ reason: 'revoked' })
  })
})

describe('acceptsGeneration', () => {
  it('admits element actions only against the generation the Host last observed', () => {
    expect(acceptsGeneration({ kind: 'click', ref: 'e1', generation: 3 }, 3)).toBe(true)
    expect(acceptsGeneration({ kind: 'click', ref: 'e1', generation: 2 }, 3)).toBe(false)
    expect(acceptsGeneration({ kind: 'type', ref: 'e1', generation: 3, text: 'x' }, undefined)).toBe(false)
    expect(acceptsGeneration({ kind: 'observe' }, undefined)).toBe(true)
    expect(acceptsGeneration({ kind: 'screenshot', format: 'png' }, 1)).toBe(true)
  })
})

describe('runCommand', () => {
  it('observes, screenshots, clicks and types against one visible target', async () => {
    const calls: string[] = []
    const observed = await runCommand(command({ kind: 'observe' }), { currentEpoch: EPOCH, target: target({ calls }) })
    expect(observed).toMatchObject({ ok: true })
    expect(observed.ok && observed.observation).toMatchObject({ generation: 1, target: TARGET })

    const shot = await runCommand(command({ kind: 'screenshot', format: 'png' }), { currentEpoch: EPOCH, target: target({ calls }) })
    expect(shot.ok && shot.screenshot).toBeInstanceOf(Uint8Array)

    expect(await runCommand(command({ kind: 'click', ref: 'e1', generation: 1 }), { currentEpoch: EPOCH, target: target({ calls }) }))
      .toMatchObject({ ok: true })
    expect(await runCommand(command({ kind: 'type', ref: 'e1', generation: 1, text: 'hello' }), { currentEpoch: EPOCH, target: target({ calls }) }))
      .toMatchObject({ ok: true })
    // Every action reads its element back out of the live document first, so the
    // recorded order shows the recheck happening before the input, never after.
    expect(calls).toEqual(['observe', 'screenshot', 'revalidate', 'revalidate', 'click', 'revalidate', 'revalidate', 'type'])
  })

  it('refuses an action whose element the live document no longer has', async () => {
    const calls: string[] = []
    const result = await runCommand(command({ kind: 'click', ref: 'e1', generation: 1 }),
      { currentEpoch: EPOCH, target: target({ calls, revalidated: undefined }) })

    // Refused before dispatch, which is what makes `stale-observation` truthful here.
    expect(result).toMatchObject({ ok: false, reason: 'stale-observation' })
    expect(calls).toEqual(['revalidate'])
  })

  it('does not act on an element handle from a superseded observation', async () => {
    const calls: string[] = []
    const result = await runCommand(command({ kind: 'click', ref: 'e1', generation: 2 }), { currentEpoch: EPOCH, target: target({ generation: 5, calls }) })
    expect(result).toMatchObject({ ok: false, reason: 'stale-observation' })
    expect(calls).toEqual([])
  })

  it('does not act after the Host generation moved on', async () => {
    const calls: string[] = []
    const result = await runCommand(command({ kind: 'click', ref: 'e1', generation: 1 }, { hostEpoch: EPOCH - 1 }), { currentEpoch: EPOCH, target: target({ calls }) })
    expect(result).toMatchObject({ ok: false, reason: 'epoch-mismatch' })
    expect(calls).toEqual([])
  })

  it('does not act on a target it never owned', async () => {
    const calls: string[] = []
    const result = await runCommand(command({ kind: 'click', ref: 'e1', generation: 1 }, { target: 'target-b' }), { currentEpoch: EPOCH, target: target({ calls }) })
    expect(result).toMatchObject({ ok: false, reason: 'wrong-target' })
    expect(calls).toEqual([])
  })

  it.each(['click', 'type'] as const)('reports a failed %s dispatch as an unknown outcome', async (kind) => {
    const calls: string[] = []
    const body = kind === 'click' ? { kind, ref: 'e1', generation: 1 } : { kind, ref: 'e1', generation: 1, text: 'coupon' }
    const result = await runCommand(command(body), { currentEpoch: EPOCH, target: target({ failAction: true, calls }) })
    expect(result).toMatchObject({ requestId: 11, ok: false, outcome: 'unknown', reason: 'execution-failed' })
    expect(calls).toEqual(['revalidate', 'revalidate', kind])
  })

  it('reports validation failure before input dispatch as not executed', async () => {
    const calls: string[] = []
    const guest = { ...target({ calls }), revalidate: async () => { throw new Error('document unavailable') } }
    const result = await runCommand(command({ kind: 'click', ref: 'e1', generation: 1 }), { currentEpoch: EPOCH, target: guest })
    expect(result).toMatchObject({ requestId: 11, outcome: 'not-executed', reason: 'action-failed' })
    expect(calls).toEqual([])
  })

  it('does not deliver input to a guest revoked during revalidation', async () => {
    const read = Promise.withResolvers<DesktopBrowserObservedElement | undefined>()
    const calls: string[] = []
    let live = true
    const guest = { ...target({ calls }), live: () => live, revalidate: () => read.promise }
    const waiting = runCommand(command({ kind: 'click', ref: 'e1', generation: 1 }), { currentEpoch: EPOCH, target: guest })
    live = false
    read.resolve(observation(1).elements[0])
    await expect(waiting).resolves.toMatchObject({ outcome: 'not-executed', reason: 'revoked' })
    expect(calls).toEqual([])
  })

  it.each(['focus', 'lease', 'session', 'origin', 'generation'] as const)('refuses %s changes while post-focus revalidation awaits', async (change) => {
    const read = Promise.withResolvers<DesktopBrowserObservedElement | undefined>()
    const reached = Promise.withResolvers<boolean>()
    const calls: string[] = []
    let valid = true
    let reads = 0
    const base = target({ calls })
    const guest: BrowserAutomationTarget = {
      ...base,
      live: () => change !== 'lease' || valid,
      authorizedSession: () => change === 'session' && !valid ? undefined : SessionId('controls-owner'),
      authorizedDocument: () => change !== 'origin' || valid,
      currentObservation: () => change === 'generation' && !valid ? undefined : observation(1),
      inputReady: () => change !== 'focus' || valid,
      revalidate: async () => {
        if (++reads === 1) return observation(1).elements[0]
        reached.resolve(true)
        return await read.promise
      },
    }
    const waiting = runCommand(command({ kind: 'type', ref: 'e1', generation: 1, text: 'must not arrive' }),
      { currentEpoch: EPOCH, target: guest })
    await reached.promise
    valid = false
    read.resolve(observation(1).elements[0])
    const reasons = { focus: 'action-failed', lease: 'revoked', session: 'session-not-authorized', origin: 'navigation-denied', generation: 'stale-observation' }
    await expect(waiting).resolves.toMatchObject({ ok: false, outcome: 'not-executed', reason: reasons[change] })
    expect(calls).toEqual([])
  })

  it('refuses an operation outside the allowlist without reaching the target', async () => {
    const calls: string[] = []
    const result = await runCommand(command({ kind: 'evaluate', expression: 'process.env' }), { currentEpoch: EPOCH, target: target({ calls }) })
    expect(result).toMatchObject({ ok: false, reason: 'unknown-operation' })
    expect(calls).toEqual([])
  })
})
