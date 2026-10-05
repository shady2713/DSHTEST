/**
 * A verified role's authority is bound to one run, one generation of it and one
 * agent, so a call queued before a run was cancelled or restarted cannot act
 * under what a later start produced.
 *
 * @module dsh-plugin-web-test/tests/authority-generation
 */

import { describe, expect, it } from 'vitest'
import { harness } from './support/harness.ts'
import { environment, run } from './support/seed.ts'
import type { Harness } from './support/harness.ts'

/** A running test session whose environment declares two roles. */
async function openRun(): Promise<Harness> {
  const h = await harness({
    seed: {
      runs: { 'run-1': run('run-1') },
      environment_revisions: { 'shop-test': environment('shop-test', ['admin', 'finance']) },
    },
  })
  if (h.store.getRun('run-1')?.status === 'resuming') await h.store.controlRun('run-1', 'resume')
  return h
}

/** A run that already verified `finance` as Bob, with authority in hand. */
async function verified(): Promise<{ token: string, h: Harness }> {
  const h = await openRun()
  await h.store.assumeRole('run-1', 'finance', { account: 'Bob', detail: '/whoami' })
  const authority = h.store.mintAuthority('run-1', 'agent-a')
  return { token: authority?.token ?? '', h }
}

describe('authority is bound to a run, a generation and an agent', () => {
  it('refuses a token presented by another agent', async () => {
    const { token, h } = await verified()
    expect(() => h.store.requireAuthority(token, 'agent-b')).toThrow(/another agent/)
  })

  it('refuses a token once its run is cancelled', async () => {
    const { token, h } = await verified()
    await h.store.putRun({ ...h.store.getRun('run-1'), status: 'cancelled' })
    expect(() => h.store.requireAuthority(token, 'agent-a')).toThrow(/is cancelled/)
  })

  it('refuses a token minted in an earlier generation', async () => {
    const { token, h } = await verified()
    const run = h.store.getRun('run-1')
    await h.store.putRun({ ...run, generation: run.generation + 1 })
    expect(() => h.store.requireAuthority(token, 'agent-a')).toThrow(/generation/)
  })

  it('refuses a token it has never issued', async () => {
    const { h } = await verified()
    expect(() => h.store.requireAuthority('not-a-token', 'agent-a')).toThrow(/no valid authority/)
  })

  it('issues a fresh token for the generation that follows', async () => {
    const { h } = await verified()
    const run = h.store.getRun('run-1')
    await h.store.putRun({ ...run, generation: run.generation + 1 })
    const fresh = h.store.mintAuthority('run-1', 'agent-a')
    expect(() => h.store.requireAuthority(fresh?.token ?? '', 'agent-a')).not.toThrow()
  })
})
