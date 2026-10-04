/** Browser entry for the first-run model-configuration strip and its Remote contribution. */
import type { Context } from '@deepseek-ai/cordis'
import contribution from '@deepseek-ai/dsh-web-test-presentation/remote'
import commands from '@deepseek-ai/dsh-web-test-conversation/remote'
import { mountWebTestPresentation } from './mount.ts'

/** The Remote registry must exist before this entry can mount its own namespace. */
export const inject = ['remote']

/**
 * Mount the route-state Remote and its dock entry.
 * @param ctx - Client runtime.
 * @returns disposer joining the dock registration and the Remote withdrawal.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountWebTestPresentation(ctx, contribution, commands)
}
