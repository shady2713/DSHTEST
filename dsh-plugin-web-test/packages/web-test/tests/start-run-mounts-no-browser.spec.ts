import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/agent.ts'
import { harness } from './support/harness.ts'
import { environment, run, seedOf } from './support/seed.ts'
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
})
