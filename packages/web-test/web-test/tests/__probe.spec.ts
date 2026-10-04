/**
 * The Web testing identity package's own entry declarations stay declarations:
 * they report availability rather than registering a Client control, so a
 * capability that never mounts leaves its entry unavailable.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebTest } from '../src/index.ts'
import { webTestEntryPoints } from '../src/entry-points.ts'

describe('web testing entry declarations', () => {
  it('lists every declared entry as unavailable until a capability mounts', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(WebTest)
    const service = ctx.get('webTest') as WebTest
    expect(service.listEntryPoints().map(entry => entry.id))
      .toEqual(webTestEntryPoints().map(entry => entry.id))
    for (const entry of service.listEntryPoints()) {
      expect(service.provides(entry.id)).toBe(false)
    }
    await fiber.dispose()
  })
})
