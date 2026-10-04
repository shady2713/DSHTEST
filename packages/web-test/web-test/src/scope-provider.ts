/** Host-owned clock and published-project reader for the Web testing policy. */
import type { Context } from '@deepseek-ai/cordis'
import { SystemClock, WebTestRuntimeScope } from '@deepseek-ai/dsh-web-test-policy'
import type {} from '@deepseek-ai/dsh-web-test-runtime'

/** Loader identity of the policy's production observations. */
export const name = 'web-test-scope-provider'
/** The project reader becomes available only after its writer has opened. */
export const inject = ['webTestRuntime', 'webTestContracts']

/**
 * Mount policy observations for this application's lifetime.
 * @param ctx - application profile context.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(SystemClock)
  await ctx.plugin(WebTestRuntimeScope, ctx.webTestRuntime)
}
