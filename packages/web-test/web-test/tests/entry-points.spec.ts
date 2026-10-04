/** Entry declarations stay unavailable until a mounted capability provides them. */

import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebTest from '../src/index.ts'
import { webTestEntryPoints } from '../src/entry-points.ts'
import { en, zh } from '../src/locales.ts'
import type { WebTestEntryPointId } from '../src/types.ts'
import type { WebTestLocaleKey } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

it('declares the browser automation entry point with a dictionary key it owns', () => {
  const entries = webTestEntryPoints()

  expect(entries.map(entry => entry.id)).toEqual([
    'web-test.projects', 'web-test.cases', 'web-test.reports', 'web-test.browser-automation',
  ])
  const automation = entries.find(entry => entry.id === 'web-test.browser-automation')
  expect(automation!.titleKey satisfies WebTestLocaleKey).toBe('webTest.entryPoints.browserAutomation.title')
  for (const entry of entries) {
    expect(zh[entry.titleKey]).not.toBe('')
    expect(en[entry.titleKey]).not.toBe('')
  }
})

it('refuses to mount an entry point the application does not declare', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const fiber = ctx.plugin(WebTest)
  await fiber
  const service = ctx.get('webTest')!

  const undeclared = 'web-test.browser' as WebTestEntryPointId
  expect(() => service.mount(undeclared)).toThrow('web-test.browser')
  expect(service.provides(undeclared)).toBe(false)
  await fiber.dispose()
})
