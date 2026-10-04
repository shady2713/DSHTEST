/** The fixed capability probe is the sole image admitted by the Web testing policy. */
import { describe, expect, it } from 'vitest'
import { startRealCapabilities } from './harness.ts'

describe('application model image probe', () => {
  it('projects its fixed image while refusing user uploads, unrelated references and forged metadata', async () => {
    const app = await startRealCapabilities()
    try {
      const ref = await app.policy.createModelProbeImage()
      const target = { width: 1, height: 1, maxBytes: 4096 }
      const image = await app.store.readImageRequest(ref, target)
      expect(image.attachment.attachmentId).toBe(ref.attachmentId)
      expect(ref.width).toBe(1)
      expect(ref.height).toBe(1)
      await expect(app.store.readImageRequest(app.imageRef, target)).rejects.toThrow('denied')
      await expect(app.store.readImageRequest({ ...ref, width: 2 }, target)).rejects.toThrow('denied')
      expect((await app.store.readImage(ref)).ref.attachmentId).toBe(ref.attachmentId)
      await expect(app.store.readImage(app.imageRef)).rejects.toThrow('denied')
      await expect(app.store.saveImage({ data: new Uint8Array([1]), mediaType: 'image/png' })).rejects.toThrow('denied')
    }
    finally {
      await app.stop()
    }
  })

  it('withdraws the probe writer when its policy owner unloads', async () => {
    const app = await startRealCapabilities()
    try {
      await app.policy.createModelProbeImage()
      await app.disposePolicy()
      await expect(app.policy.createModelProbeImage()).rejects.toThrow('no attachment provider')
    }
    finally {
      await app.stop()
    }
  })
})
