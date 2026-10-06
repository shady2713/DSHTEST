import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/agent.ts'
import { harness } from './support/harness.ts'
import { environment, run, seedOf } from './support/seed.ts'
function byNameOf(ctx: Context): Map<string, Registered> {
  const holder = ctx as unknown as { __byName?: Map<string, Registered> }
  holder.__byName ??= new Map()
  return holder.__byName
}

interface Registered {
  name: string
  execute?: (args: unknown, ctx: unknown) => Promise<unknown>
}

/**
 * `start_run`'s comment used to describe a browser mount per declared role that
 * the tool never performed, and reasoning from it produced a wrong account of a
 * leaked browser. This drives the registered tool and pins what it actually does.
 */
describe('start_run mounts no role browser', () => {
  it('records the run without asking the pool for a browser', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        environment_revisions: { 'acc-x': environment('acc-x', ['buyer']) },
        runs: { run: run('run') },
      }),
    })
    const ensured: string[] = []
    const byName = new Map<string, Registered>()
    const ctx = new Context()
    Object.assign(ctx, {
      tools: {
        register: (definition: Registered) => {
          byName.set(definition.name, definition)
          return () => {}
        },
      },
      webTestStore: store,
      webTestRoleBrowsers: {
        ensure: async (owner: { role: string }) => { ensured.push(owner.role); throw new Error('no browser in a unit test') },
        switchTo: async () => { throw new Error('no browser in a unit test') },
        list: () => [],
        roleOf: () => '',
      },
    })
    apply(ctx)
    try {
      const startRun = byName.get('web_test_start_run')
      expect(startRun).toBeDefined()
      const started = await startRun!.execute!(
        { projectKey: 'shop', environmentRevisionKey: 'acc-x', runKey: 'run', role: 'buyer' },
        { agent: { id: 'agent-1' } },
      ) as { status: string }
      expect(started.status).toBe('running')
      expect(ensured).toEqual([])
    } finally {
      await dispose()
    }
  })

  it('is assume_role that asks the pool, and it names the role it was given', async () => {
    // The counterpart to the test above: one place mounts, the other does not.
    // Which one is which is what the leaked-browser investigation turned on.
    const { store, dispose } = await harness({
      seed: seedOf({
        environment_revisions: { 'acc-x': environment('acc-x', ['buyer', 'approver']) },
        runs: { run: run('run') },
      }),
    })
    const ensured: string[] = []
    const ctx = new Context()
    Object.assign(ctx, {
      tools: {
        register: (definition: Registered) => {
          byNameOf(ctx).set(definition.name, definition)
          return () => {}
        },
      },
      webTestStore: store,
      webTestRoleBrowsers: {
        ensure: async (owner: { role: string }) => { ensured.push(owner.role); throw new Error('no browser in a unit test') },
        switchTo: async () => {},
        list: () => [],
        roleOf: () => '',
      },
    })
    apply(ctx)
    try {
      const assume = byNameOf(ctx).get('web_test_assume_role')
      expect(assume).toBeDefined()
      // It refuses on the missing browser, which is after it asked the pool.
      await expect(assume!.execute!(
        { runKey: 'run', role: 'approver', accountPage: 'http://127.0.0.1:8902/account' },
        { agent: { id: 'agent-1' } },
      )).rejects.toThrow('no browser in a unit test')
      expect(ensured).toEqual(['approver'])
    } finally {
      await dispose()
    }
  })
})
