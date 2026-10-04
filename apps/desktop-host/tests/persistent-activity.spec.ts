/** Desktop admission consumes cold durable Runtime heads, even with no loaded Agents. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { issuePrototypeAuthority, prototypeActivitySchema } from '@deepseek-ai/dsh-web-test-runtime'
import type { PrototypeAuthority } from '@deepseek-ai/dsh-web-test-runtime'
import { cleanup, startRuntime } from '../../../packages/web-test/web-test-runtime/tests/harness.ts'
import { installDesktopQuitInspection } from '../src/quit-inspection.ts'
import { installDesktopUpdateTaskControl } from '../src/update-tasks.ts'

afterEach(cleanup)

async function producerAuthority(ctx: Context): Promise<PrototypeAuthority> {
  let authority: PrototypeAuthority | undefined
  await ctx.plugin(class PrototypeOwner extends Service {
    static inject = ['webTestRuntime']
    constructor(inner: Context) {
      super(inner, 'webTestPrototypeOwner')
      authority = issuePrototypeAuthority(this.ctx)
    }
  })
  if (authority === undefined) throw new Error('prototype producer did not activate')
  return authority
}

describe.skipIf(process.platform !== 'win32')('Desktop cold Web testing activity', () => {
  it('counts paused and UNKNOWN heads and refuses ordinary installation locking', async () => {
    const fixture = await startRuntime({ storageMode: 'generation-json' })
    try {
      const authority = await producerAuthority(fixture.ctx)
      fixture.ctx.provide('agents', { list: () => [], currentInitiator: () => undefined } as never)
      fixture.ctx.provide('jobs', { list: () => [] } as never)
      await fixture.runtime.initializePrototypeActivity(prototypeActivitySchema.parse({
        format: 1, compositionHash: '1'.repeat(64), revision: 1, executor: 'revoked',
        runs: [
          { runId: 'cold-paused', sessionId: 'unloaded-paused', headRevision: 1, status: 'PAUSED', pauseRequested: true,
            cancelRequested: false, operations: [], attachments: [], reports: [] },
          { runId: 'cold-unknown', sessionId: 'unloaded-unknown', headRevision: 1, status: 'UNKNOWN', pauseRequested: false,
            cancelRequested: false, attachments: [], reports: [], operations: [{ operationId: 'original-operation', status: 'UNKNOWN',
              businessIntent: { kind: 'create', target: 'public-record', parametersHash: '2'.repeat(64) } }] },
        ],
      }), authority)
      const path = join(fixture.dataRoot, 'prototype-activity.json')
      const before = await readFile(path)
      const quit = installDesktopQuitInspection(fixture.ctx)
      const updates = installDesktopUpdateTaskControl(fixture.ctx)
      expect(await quit()).toEqual({ activeTasks: true, scheduledTasks: false })
      expect(await updates('inspect')).toBe(true)
      await expect(updates('lock')).rejects.toThrow('persistent work requires recovery admission')
      expect(await updates('unlock')).toBe(true)
      expect(await readFile(path)).toEqual(before)
      expect(fixture.ctx.agents.list()).toEqual([])
    } finally { await fixture.stop() }
  })

  it('does not admit an unregistered cold domain as an idle installation', async () => {
    const fixture = await startRuntime({ storageMode: 'generation-json' })
    try {
      fixture.ctx.provide('agents', { list: () => [], currentInitiator: () => undefined } as never)
      fixture.ctx.provide('jobs', { list: () => [] } as never)
      await expect(installDesktopQuitInspection(fixture.ctx)()).rejects.toThrow('inspection is incomplete')
      await expect(installDesktopUpdateTaskControl(fixture.ctx)('lock')).rejects.toThrow('inspection is incomplete')
    } finally { await fixture.stop() }
  })

  it('admits a complete explicitly registered empty domain without modifying it', async () => {
    const fixture = await startRuntime({ storageMode: 'generation-json' })
    try {
      const authority = await producerAuthority(fixture.ctx)
      fixture.ctx.provide('agents', { list: () => [], currentInitiator: () => undefined } as never)
      fixture.ctx.provide('jobs', { list: () => [] } as never)
      await fixture.runtime.initializePrototypeActivity(prototypeActivitySchema.parse({
        format: 1, compositionHash: '1'.repeat(64), revision: 1, executor: 'active', runs: [],
      }), authority)
      const path = join(fixture.dataRoot, 'prototype-activity.json')
      const before = await readFile(path)
      expect(await installDesktopQuitInspection(fixture.ctx)()).toEqual({ activeTasks: false, scheduledTasks: false })
      expect(await installDesktopUpdateTaskControl(fixture.ctx)('lock')).toBe(false)
      expect(await readFile(path)).toEqual(before)
    } finally { await fixture.stop() }
  })
})
