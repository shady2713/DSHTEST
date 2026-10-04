/** Entry declarations must not enable actions without a backing capability. */
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebTest from '../src/index.ts'
import { en, zh } from '../src/locales.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

it('keeps identity metadata separate from availability and the actual data root', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const originalHome = process.env.DSH_HOME
  const fiber = ctx.plugin(WebTest)
  await fiber
  const service = ctx.get('webTest')!
  expect(service.identity).toEqual({
    applicationId: 'dsh-web-test', dataRootName: 'web-test', profileName: 'web-test',
  })
  expect(service.listEntryPoints().map(entry => entry.id)).toContain('web-test.browser-automation')
  for (const entry of service.listEntryPoints()) {
    expect(service.provides(entry.id)).toBe(false)
    expect(entry.profileName).toBe('web-test')
  }
  expect(service.provides('missing')).toBe(false)
  expect(process.env.DSH_HOME).toBe(originalHome)
  await fiber.dispose()
  expect(ctx.get('webTest')).toBeUndefined()
})

it('records a mounted capability for exactly the lifetime of its contribution', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const fiber = ctx.plugin(WebTest)
  await fiber
  const service = ctx.get('webTest')!

  const release = service.mount('web-test.browser-automation')
  expect(service.provides('web-test.browser-automation')).toBe(true)
  await release()
  expect(service.provides('web-test.browser-automation')).toBe(false)
  expect(() => service.mount('web-test.undeclared')).toThrow('web-test.undeclared')
  await fiber.dispose()
})

it('gives every declared entry point a title in both dictionaries', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const fiber = ctx.plugin(WebTest)
  await fiber
  const service = ctx.get('webTest')!

  for (const entry of service.listEntryPoints()) {
    expect(zh[entry.titleKey]).toBeTruthy()
    expect(en[entry.titleKey]).toBeTruthy()
  }
  await fiber.dispose()
})
