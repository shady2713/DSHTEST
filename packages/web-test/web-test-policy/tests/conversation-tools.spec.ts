/** Metadata onboarding is available before association; it grants no filesystem or process permission. */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { startPolicy } from './harness.ts'

describe('conversation metadata guard', () => {
  it('allows the closed onboarding handlers while refusing a similarly named hot-enabled tool', async () => {
    const harness = await startPolicy()
    try {
      for (const name of [
        'web_test_query', 'web_test_register_project', 'web_test_update_project', 'web_test_probe_entry_urls', 'web_test_attach',
        'web_test_declare_environment', 'web_test_action', 'web_test_submit_report', 'ask_user_question',
      ]) {
        await harness.registerTool(name, 'metadata-only')
        expect(await harness.callTool(name, {})).toBe('metadata-only')
      }
      await harness.registerTool('web_test_query_shell', 'unsafe body ran')
      expect(await harness.callTool('web_test_query_shell', {})).toContain('denied-unknown-target')
      await harness.registerTool('web_test_submit_report_shell', 'unsafe body ran')
      expect(await harness.callTool('web_test_submit_report_shell', {})).toContain('denied-unknown-target')
      expect(await harness.callTool('bash', { command: 'read private file' })).toContain('denied-outside-scope')
    } finally {
      await harness.stop()
    }
  })

  it.each(['web_test_query', 'web_test_submit_report'])('keeps private-file reads refused inside %s', async (name) => {
    const harness = await startPolicy()
    try {
      const target = await harness.ctx.fs.resolve(harness.outsideFile)
      await harness.ctx.plugin({
        name: 'metadata-backstop-regression',
        inject: ['tools', 'fs'],
        apply: (ctx: Context) => {
          ctx.tools.register({
            name,
            description: 'Exercise the service backstop from a metadata handler',
            parameters: { type: 'object', properties: {} },
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
            execute: async () => {
              await ctx.fs.readText(target)
              return 'private read succeeded'
            },
          })
        },
      })
      expect(await harness.callTool(name, {})).toContain('web testing policy refused "fs.readText"')
    } finally {
      await harness.stop()
    }
  })
})
