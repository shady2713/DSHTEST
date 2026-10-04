/** Real image storage remains closed to late results and follows actual provider retirement. */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { brandString } from '@deepseek-ai/dsh-brand'
import { DesktopBrowserControl, DESKTOP_BROWSER_AUTOMATION_VERSION } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { DesktopBrowserBinding, DesktopBrowserCommandBody, DesktopBrowserCommandResult,
  DesktopBrowserControlledTarget, DesktopBrowserTargetId, DesktopBrowserWorkspaceKey } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { startConversation } from '../../web-test-conversation/tests/harness.ts'
import { startPolicy } from './harness.ts'

class DeferredImageStore extends LocalAttachmentStore {
  readonly saved = Promise.withResolvers<ImageAttachmentRef>()
  readonly release = Promise.withResolvers<undefined>()

  override async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    const ref = await super.saveImage(input)
    this.saved.resolve(ref)
    await this.release.promise
    return ref
  }
}

/** Only the carrier bytes are test-owned; retirement runs through actual Cordis fibers. */
class OwnedControl extends DesktopBrowserControl {
  calls = 0
  live: DesktopBrowserBinding | undefined
  readonly target = { target: brandString<DesktopBrowserTargetId>('lifecycle-guest'), hostEpoch: 1,
    workspace: brandString<DesktopBrowserWorkspaceKey>('lifecycle-workspace'), url: 'http://localhost:3000/checkout' }
  targets(): readonly DesktopBrowserControlledTarget[] { return [this.target] }
  bind(sessionId: SessionId, _target: DesktopBrowserTargetId): Promise<DesktopBrowserBinding> {
    this.live = { ...this.target, sessionId }
    return Promise.resolve(this.live)
  }
  unbind(_sessionId: SessionId): Promise<void> { this.live = undefined; return Promise.resolve() }
  binding(sessionId: SessionId): DesktopBrowserBinding | undefined {
    return this.live?.sessionId === sessionId ? this.live : undefined
  }
  submit(_sessionId: SessionId, body: DesktopBrowserCommandBody): Promise<DesktopBrowserCommandResult> {
    expect(body).toEqual({ kind: 'screenshot', format: 'png' })
    this.calls += 1
    return Promise.resolve({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: this.calls, ok: true,
      screenshot: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64') })
  }
}

describe('owned screenshot provider lifecycle', () => {
  it('closes capture after control retirement and uses only the newly bound replacement', async () => {
    const app = await startConversation()
    try {
      await app.ctx.plugin(LocalAttachmentStore, { dshHome: join(app.codeRoot, 'capture-home') })
      const first = await app.ctx.plugin(OwnedControl)
      const old = app.ctx.desktopBrowserControl as OwnedControl
      const agent = await app.rootAgent('lifecycle-owner')
      const project = await app.registerProject('cmd-lifecycle-project')
      app.attachAndDeclare(agent.session.id, project, 'cmd-lifecycle-declare')
      app.ctx.webTestPolicy.grantFlow({ sessionId: agent.session.id, flowId: 'lifecycle-flow', flowRevision: 1,
        thirdParty: false, actions: 5 })
      const capture = () => app.ctx.agents.withInitiator(agent,
        () => app.ctx.webTestPolicy.captureBrowserScreenshot(agent.session.id, new AbortController().signal))
      await old.bind(agent.session.id, old.target.target)
      await capture()
      expect(old.calls).toBe(1)
      await first.dispose()
      await expect(capture()).rejects.toThrow('live binding and attachment provider')
      expect(old.calls).toBe(1)

      await app.ctx.plugin(OwnedControl)
      const replacement = app.ctx.desktopBrowserControl as OwnedControl
      expect(replacement).not.toBe(old)
      await expect(capture()).rejects.toThrow('live binding and attachment provider')
      await replacement.bind(agent.session.id, replacement.target.target)
      await capture()
      expect(replacement.calls).toBe(1)
      expect(old.calls).toBe(1)
    }
    finally { await app.stop() }
  })

  it('rejects a real committed image whose probe Promise returns after Policy unload', async () => {
    const app = await startPolicy({ omitServices: ['attachments'] })
    let pending: Promise<ImageAttachmentRef> | undefined
    let store: DeferredImageStore | undefined
    try {
      await app.ctx.plugin(DeferredImageStore, { dshHome: join(app.root, 'late-image-home') })
      store = app.ctx.attachments as DeferredImageStore
      pending = app.policy.createModelProbeImage()
      const outcome = expect(pending).rejects.toThrow('model image probe owner was disposed')
      const ref = await store.saved.promise
      await app.disposePolicy()
      store.release.resolve(undefined)
      await outcome
      expect((await store.readImage(ref)).ref).toEqual(ref)
      await expect(app.policy.createModelProbeImage()).rejects.toThrow('no attachment provider')
    }
    finally {
      store?.release.resolve(undefined)
      if (pending !== undefined) await Promise.allSettled([pending])
      await app.stop()
    }
  })

  it('retains retired-provider read protection while the replacement receives a working probe writer', async () => {
    const app = await startPolicy({ omitServices: ['attachments'] })
    try {
      const first = await app.ctx.plugin(LocalAttachmentStore, { dshHome: join(app.root, 'first-image-home') })
      const old = app.ctx.attachments
      const firstImage = await app.policy.createModelProbeImage()
      expect((await old.readImage(firstImage)).ref).toEqual(firstImage)
      await first.dispose()
      await expect(old.readImage(firstImage)).rejects.toThrow('denied')
      await expect(app.policy.createModelProbeImage()).rejects.toThrow('no attachment provider')

      await app.ctx.plugin(LocalAttachmentStore, { dshHome: join(app.root, 'second-image-home') })
      expect(app.ctx.attachments).not.toBe(old)
      const secondImage = await app.policy.createModelProbeImage()
      expect((await app.ctx.attachments.readImage(secondImage)).ref).toEqual(secondImage)
      await expect(old.saveImage({ data: new Uint8Array([1]), mediaType: 'image/png' })).rejects.toThrow('denied')
      await app.disposePolicy()
      await expect(app.policy.createModelProbeImage()).rejects.toThrow('no attachment provider')
    }
    finally {
      await app.stop()
    }
  })
})
