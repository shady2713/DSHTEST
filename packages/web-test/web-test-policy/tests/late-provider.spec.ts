/** A newly mounted or replaced provider receives the live policy backstop. */
import { describe, expect, it } from 'vitest'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { startPolicy } from './harness.ts'

describe('policy provider lifecycle', () => {
  it('refuses private reads when the filesystem loads after policy and when it is replaced', async () => {
    const app = await startPolicy({ withoutFileSystem: true })
    try {
      const first = await app.ctx.plugin(LocalFileSystem, { cwd: app.codeRoot })
      const old = app.ctx.fs
      await expect(old.readText(await old.resolve(app.outsideFile))).rejects.toThrow('denied')
      await first.dispose()
      await expect(old.readText(await old.resolve(app.outsideFile))).rejects.toThrow('denied')
      await app.ctx.plugin(LocalFileSystem, { cwd: app.codeRoot })
      expect(app.ctx.fs).not.toBe(old)
      await expect(app.ctx.fs.readText(await app.ctx.fs.resolve(app.outsideFile))).rejects.toThrow('denied')
    }
    finally {
      await app.stop()
    }
  })
})
