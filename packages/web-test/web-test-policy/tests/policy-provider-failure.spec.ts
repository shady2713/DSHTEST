/** Provider replacement and failed guard installation leave no duplicate or partial guards. */
import { describe, expect, it } from 'vitest'
import { startPolicy } from './harness.ts'

describe('policy provider installation', () => {
  it('reinstalls one guard when the same web provider is withdrawn and registered again', async () => {
    const app = await startPolicy({ omitServices: ['web'] })
    try {
      const provider = app.standIns.web
      const original: unknown = Object.getOwnPropertyDescriptor(provider, 'fetch')?.value
      const first = app.ctx.provide('web', provider as never)
      await Promise.all(app.ctx.reflect.notify(['web']).map(fiber => fiber.await()))
      await expect(provider.fetch({ url: 'https://outside.invalid' })).rejects.toThrow('denied')
      first()
      await Promise.all(app.ctx.reflect.notify(['web']).map(fiber => fiber.await()))
      await expect(provider.fetch({ url: 'https://outside.invalid' })).rejects.toThrow('denied')
      app.ctx.provide('web', provider as never)
      await Promise.all(app.ctx.reflect.notify(['web']).map(fiber => fiber.await()))
      await expect(provider.fetch({ url: 'https://outside.invalid' })).rejects.toThrow('denied')
      expect(app.providerCalls.get('web.fetch') ?? 0).toBe(0)
      await app.disposePolicy()
      expect(Object.getOwnPropertyDescriptor(provider, 'fetch')?.value).toBe(original)
    } finally { await app.stop() }
  })

  it('restores file-retention guards if a provider cannot install its image guard', async () => {
    const app = await startPolicy({ omitServices: ['attachments'] })
    try {
      const provider = app.standIns.attachments
      const before = Object.getOwnPropertyDescriptor(provider, 'stageFile')
      Object.defineProperty(provider, 'saveImage', { value: Reflect.get(provider, 'saveImage'), configurable: false })
      app.ctx.provide('attachments', provider as never)
      await expect(Promise.all(app.ctx.reflect.notify(['attachments']).map(fiber => fiber.await())))
        .rejects.toThrow('Cannot redefine property: saveImage')
      expect(Object.getOwnPropertyDescriptor(provider, 'stageFile')).toEqual(before)
      await expect(provider.saveImage()).rejects.toThrow('reach its provider body')
      expect(app.providerCalls.get('attachments.saveImage')).toBe(1)
    } finally { await app.stop() }
  })

  it('refuses browser tools without an Agent and defaults missing search paths to the caller directory', async () => {
    const app = await startPolicy()
    try {
      app.admit()
      expect(await app.callTool('web_browser_screenshot', {})).toContain('refused')
      expect(await app.callTool('glob', { pattern: '*.ts' })).toContain('refused')
      expect(await app.callTool('grep', { pattern: 'answer' })).toContain('refused')
    } finally { await app.stop() }
  })
})
