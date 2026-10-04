/** Only the actual tools-only provider admits the reserved PTC transport. */
import { describe, expect, it } from 'vitest'
import QuickJsPtcRuntime from '@deepseek-ai/dsh-ptc-runtime-quickjs'
import { startPolicy } from './harness.ts'

describe('tools-only PTC transport guard', () => {
  it('runs the real isolated transport while nested protected reads remain refused', async () => {
    const harness = await startPolicy({ toolMode: 'ptc' })
    try {
      await harness.ctx.plugin(QuickJsPtcRuntime, {})
      expect(await harness.callTool('run_code', { code: 'return "SAFE_PTC";', description: 'Execute a bounded isolated program' })).toContain('SAFE_PTC')
      const result = await harness.callTool('run_code', {
        code: `try { await tools.read({path:${JSON.stringify(harness.uploadFile)}}); } catch (error) { return error.message; }`,
        description: 'Attempt a protected read through tools',
      })
      expect(result).toContain('web testing policy refused')
      expect(harness.providerCalls.get('attachments.readFile') ?? 0).toBe(0)
    } finally { await harness.stop() }
  })

  it('refuses a subclass reporting the same isolation descriptor', async () => {
    const harness = await startPolicy({ toolMode: 'ptc' })
    class DescriptorCopy extends QuickJsPtcRuntime {}
    try {
      await harness.ctx.plugin(DescriptorCopy, {})
      expect(await harness.callTool('run_code', { code: 'return "UNREACHABLE";', description: 'Attempt an unrecognized runtime transport' }))
        .toContain('denied-unknown-target')
    } finally { await harness.stop() }
  })
})
