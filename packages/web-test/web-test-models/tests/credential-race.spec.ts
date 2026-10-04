/** Credential invalidation across probe, durable commit, and pinned-work recovery. */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { messagesEndpoint, start } from './harness.ts'
import type { WorkTestModels } from './harness.ts'

function barrier() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  return { wait, release }
}

async function fixture() {
  const endpoint = await messagesEndpoint()
  onTestFinished(() => endpoint.close())
  const harness = await start({ baseURL: endpoint.baseURL, key: 'synthetic-race-key' })
  onTestFinished(() => harness.dispose())
  const initial = await harness.service.configureRoute('deepseek-official', 'deepseek-flash', 'analysis')
  if (initial.kind !== 'ready') throw new Error('fixture route did not verify')
  const ticket = harness.service.beginWork('analysis', initial.selection.route)
  return { ...harness, endpoint, ticket }
}

async function holdCommit(harness: WorkTestModels, point: 'live-read' | 'store-write', liveRead = 2) {
  const entered = barrier()
  const released = barrier()
  onTestFinished(() => { released.release() })
  if (point === 'store-write') {
    harness.service.selections = {
      read: () => harness.store.read(),
      async put(selection) {
        entered.release()
        await released.wait
        return harness.store.put(selection)
      },
    }
  } else {
    const resolve = harness.llm.resolveModelInfo.bind(harness.llm)
    let reads = 0
    const spy = vi.spyOn(harness.llm, 'resolveModelInfo').mockImplementation(async (...args) => {
      if (++reads === liveRead) {
        entered.release()
        await released.wait
      }
      return resolve(...args)
    })
    onTestFinished(() => { spy.mockRestore() })
  }
  return { entered: entered.wait, release: released.release }
}

describe('credential invalidation before selection publication', () => {
  it('refuses a passive read spanning a credential change even when the new verification has identical fields', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(2000)
    onTestFinished(() => { clock.mockRestore() })
    const harness = await fixture()
    const gate = await holdCommit(harness, 'live-read', 1)
    const passive = harness.service.selectRoute('analysis', { reverify: false })
    try {
      await gate.entered
      await harness.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'synthetic-new-generation')
      await vi.waitFor(() => { expect(harness.service.waitingWork()).toHaveLength(1) })
      expect((await harness.service.configureRoute('deepseek-official', 'deepseek-flash', 'analysis')).kind).toBe('ready')
    } finally { gate.release(); await passive }
    expect((await passive).kind).toBe('not-ready')
    expect((await harness.service.selectRoute('analysis', { reverify: false })).kind).toBe('ready')
    expect(harness.endpoint.requests()).toHaveLength(2)
  })

  it('refuses an old selection visible before its overwritten write acknowledges completion', async () => {
    let now = 2000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    onTestFinished(() => { clock.mockRestore() })
    const harness = await fixture()
    const entered = barrier(), write = barrier(), visible = barrier(), acknowledged = barrier()
    onTestFinished(() => { write.release(); acknowledged.release() })
    harness.service.selections = {
      read: () => harness.store.read(),
      async put(selection) {
        entered.release(); await write.wait
        const result = await harness.store.put(selection)
        visible.release(); await acknowledged.wait
        return result
      },
    }
    const stale = harness.service.configureRoute('deepseek-official', 'deepseek-flash', 'analysis')
    try {
      await entered.wait
      now = 3000
      await harness.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'synthetic-new-generation')
      await vi.waitFor(() => { expect(harness.service.waitingWork()).toHaveLength(1) })
      harness.service.selections = harness.store
      expect((await harness.service.configureRoute('deepseek-official', 'deepseek-flash', 'analysis')).kind).toBe('ready')
      write.release(); await visible.wait
      expect((await harness.store.read()).byTask.analysis?.verifiedAt).toBe(2000)
      expect((await harness.service.selectRoute('analysis', { reverify: false })).kind).toBe('not-ready')
      expect(harness.endpoint.requests()).toHaveLength(3)
    } finally { write.release(); acknowledged.release(); await stale }
    expect((await stale).kind).toBe('not-ready')
  })

  for (const operation of ['configure', 'plan', 'resume'] as const) {
    for (const point of ['live-read', 'store-write'] as const) {
      it(`${operation} refuses a credential change during ${point} and preserves the pinned wait`, async () => {
        const harness = await fixture()
        const ref = credentialRef('DEEPSEEK_API_KEY')
        if (operation !== 'configure') {
          await harness.credentials.set(ref, 'synthetic-replacement')
          await vi.waitFor(() => { expect(harness.service.waitingWork()).toHaveLength(1) })
        }
        const gate = await holdCommit(harness, point, operation === 'plan' ? 3 : 2)
        const before = harness.endpoint.requests().length
        const selecting = operation === 'configure'
          ? harness.service.configureRoute('deepseek-official', 'deepseek-flash', 'analysis')
          : operation === 'plan'
            ? harness.service.selectRoute('analysis', { reverify: true })
            : harness.service.resumeWork(harness.ticket.workId)
        try {
          await gate.entered
          expect(harness.endpoint.requests()).toHaveLength(before + 1)
          await harness.credentials.unset(ref)
          await vi.waitFor(() => { expect(harness.service.waitingWork()).toHaveLength(1) })
        } finally {
          gate.release()
          await selecting
        }
        expect((await selecting).kind).toBe(operation === 'resume' ? 'still-waiting' : 'not-ready')
        expect((await harness.service.selectRoute('analysis', { reverify: false })).kind).toBe('not-ready')
        expect(harness.endpoint.requests()).toHaveLength(before + 1)
        expect(harness.service.waitingWork()[0]?.route).toEqual(harness.ticket.route)
        expect(harness.service.completeWork(harness.ticket)).toBe(false)
      })
    }
  }

  it('serves a completed verification without probing, then invalidates it on the same reference event', async () => {
    const harness = await fixture()
    const before = harness.endpoint.requests().length
    expect((await harness.service.selectRoute('analysis', { reverify: false })).kind).toBe('ready')
    await harness.credentials.unset(credentialRef('DEEPSEEK_API_KEY'))
    await vi.waitFor(() => { expect(harness.service.waitingWork()).toHaveLength(1) })
    expect((await harness.service.selectRoute('analysis', { reverify: false })).kind).toBe('not-ready')
    expect(harness.endpoint.requests()).toHaveLength(before)
  })

  it('requires verification when an older write overwrites a newer verified commit', async () => {
    const harness = await fixture()
    const gate = await holdCommit(harness, 'store-write')
    const stale = harness.service.configureRoute('deepseek-official', 'deepseek-flash', 'analysis')
    try {
      await gate.entered
      await harness.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'synthetic-new-generation')
      await vi.waitFor(() => { expect(harness.service.waitingWork()).toHaveLength(1) })
      harness.service.selections = harness.store
      expect((await harness.service.configureRoute('deepseek-official', 'deepseek-flash', 'analysis')).kind).toBe('ready')
      expect((await harness.service.selectRoute('analysis', { reverify: false })).kind).toBe('ready')
    } finally {
      gate.release()
      await stale
    }
    expect((await stale).kind).toBe('not-ready')
    expect((await harness.service.selectRoute('analysis', { reverify: false })).kind).toBe('not-ready')
  })
})
