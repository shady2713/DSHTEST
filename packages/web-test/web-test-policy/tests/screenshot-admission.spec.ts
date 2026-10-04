/** Actual Policy and local attachment storage; the carrier here is a unit seam, not a Native proof. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm/message'
import { DesktopBrowserControl, DESKTOP_BROWSER_AUTOMATION_VERSION } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { DesktopBrowserBinding, DesktopBrowserCommandBody, DesktopBrowserCommandResult,
  DesktopBrowserControlledTarget, DesktopBrowserTargetId, DesktopBrowserWorkspaceKey } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { join, dirname } from 'node:path'
import { startConversation } from '../../web-test-conversation/tests/harness.ts'
import { screenshotProjection } from '../src/screenshot-projection.ts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')

class LifecycleStore extends LocalAttachmentStore {
  afterSave: (() => Promise<void>) | undefined
  override async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    const ref = await super.saveImage(input)
    await this.afterSave?.()
    return ref
  }
}

class CaptureControl extends DesktopBrowserControl {
  calls = 0
  reject = false
  unbindAfterCapture = false
  bytes: Uint8Array = png
  live: DesktopBrowserBinding | undefined
  readonly target = { target: brandString<DesktopBrowserTargetId>('owned-capture'), hostEpoch: 1,
    workspace: brandString<DesktopBrowserWorkspaceKey>('capture-workspace'), url: 'http://localhost:3000/checkout' }
  targets(): readonly DesktopBrowserControlledTarget[] { return [this.target] }
  bind(id: SessionId, _target: DesktopBrowserTargetId): Promise<DesktopBrowserBinding> {
    this.live = { ...this.target, sessionId: id }
    return Promise.resolve(this.live)
  }
  unbind(_id: SessionId): Promise<void> { this.live = undefined; return Promise.resolve() }
  binding(id: SessionId): DesktopBrowserBinding | undefined { return this.live?.sessionId === id ? this.live : undefined }
  submit(_id: SessionId, body: DesktopBrowserCommandBody): Promise<DesktopBrowserCommandResult> {
    this.calls += 1
    expect(body).toEqual({ kind: 'screenshot', format: 'png' })
    if (this.unbindAfterCapture) this.live = undefined
    return Promise.resolve(this.reject
      ? { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: this.calls, ok: false, outcome: 'unknown', reason: 'execution-failed' }
      : { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: this.calls, ok: true, screenshot: this.bytes })
  }
}

async function fixture() {
  const app = await startConversation()
  await app.ctx.plugin(SessionProjectionRegistry)
  await app.ctx.plugin(LifecycleStore, { dshHome: join(dirname(app.codeRoot), 'capture-home') })
  await app.ctx.plugin(CaptureControl)
  const agent = await app.rootAgent('capture-owner')
  const project = await app.registerProject('cmd-capture-project')
  app.attachAndDeclare(agent.session.id, project, 'cmd-capture-declare')
  app.ctx.webTestPolicy.grantFlow({ sessionId: agent.session.id, flowId: 'capture-flow', flowRevision: 1, thirdParty: false, actions: 30 })
  const control = app.ctx.desktopBrowserControl as CaptureControl
  await control.bind(agent.session.id, control.target.target)
  const capture = () => app.ctx.agents.withInitiator(agent,
    () => app.ctx.webTestPolicy.captureBrowserScreenshot(agent.session.id, new AbortController().signal))
  return { ...app, agent, control, capture }
}

describe('owned browser screenshot admission', () => {
  it('stores only accepted capture bytes, restricts image reads to their Session and exact metadata, and reconstructs reads after reopen', async () => {
    const app = await fixture()
    try {
      await expect(app.ctx.webTestPolicy.captureBrowserScreenshot(app.agent.session.id, new AbortController().signal)).rejects.toThrow('calling Agent')
      await expect(app.ctx.agents.withInitiator(app.agent, () => app.ctx.webTestPolicy.captureBrowserScreenshot(SessionId('foreign'), new AbortController().signal))).rejects.toThrow('calling Agent')
      expect(app.control.calls).toBe(0)
      expect(Reflect.get(app.ctx.webTestPolicy, 'saveCapturedImage')).toBeUndefined()
      expect(Reflect.get(app.ctx.webTestPolicy, 'probeImages')).toBeUndefined()
      expect(Reflect.get(app.ctx.webTestPolicy, 'browserControl')).toBeUndefined()
      const captured = await app.capture()
      expect((await app.capture()).image).toEqual(captured.image)
      expect(captured).toMatchObject({ target: app.control.target.target, hostEpoch: 1, image: { width: 1, height: 1 } })
      expect((await app.ctx.attachments.readImage(captured.image)).ref).toEqual(captured.image)
      const ownRead = await app.ctx.agents.withInitiator(app.agent, () => app.ctx.attachments.readImage(captured.image))
      expect(ownRead).toMatchObject({ ref: captured.image })
      await expect(app.ctx.attachments.readImage({ ...captured.image, name: 'forged' })).rejects.toThrow('denied')
      await expect(app.ctx.attachments.saveImage({ data: png, mediaType: 'image/png' })).rejects.toThrow('denied')
      const foreign = await app.rootAgent('foreign-image-reader')
      await expect(app.ctx.agents.withInitiator(foreign, () => app.ctx.attachments.readImage(captured.image))).rejects.toThrow('denied')

      const callId = ToolCallId('captured-original')
      app.agent.session.append('tool/call', { turn: 1, step: 1, callId, name: 'web_browser_screenshot', arguments: '{}' })
      app.agent.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId,
        content: [{ type: 'image', attachment: captured.image }], isError: false }) }, { surfaceOp: 'append' })
      const seed = app.agent.session.snapshotEvents()
      const emptyState = screenshotProjection.init(app.agent.session.header, app.agent.session.inheritedEventCount)
      expect(screenshotProjection.apply(emptyState, seed[0]!))
        .toMatchObject({ images: [] })
      const original: unknown = Reflect.get(app.ctx.webTestPolicy, Symbol.for('cordis.original'))
      if (typeof original !== 'object' || original === null) throw new Error('actual Policy owner absent')
      const ownerCtx: unknown = Reflect.get(original, 'ctx')
      if (!Context.is(ownerCtx)) throw new Error('actual Policy owner Context absent')
      await ownerCtx.fiber.dispose()
      await app.ctx.plugin((await import('../src/index.ts')).WebTestPolicy, {
        protectedPaths: [], confirmationRequiredFor: [], confirmationTtlMs: 60000, authorizationValidityMs: 300000, maxActionsPerFlow: 30,
      })
      const reopened = app.ctx.sessions.create(SessionId('cold-capture-history'), { seed })
      expect(app.ctx.sessionProjections.stateOf(reopened, 'webTestScreenshots')?.images).toEqual([captured.image])
      const projected = await app.ctx.attachments.readImageRequest(captured.image, { width: 1, height: 1, maxBytes: 4096 })
      expect(projected.attachment).toEqual(captured.image)
      await expect(app.ctx.webTestPolicy.captureBrowserScreenshot(reopened.id, new AbortController().signal)).rejects.toThrow('calling Agent')
    } finally { await app.stop() }
  })

  it.each(['unknown', 'unbind', 'invalid-bytes'] as const)('admits no readable image after %s', async (failure) => {
    const app = await fixture()
    try {
      app.control.reject = failure === 'unknown'
      app.control.unbindAfterCapture = failure === 'unbind'
      if (failure === 'invalid-bytes') app.control.bytes = new Uint8Array([1, 2, 3])
      await expect(app.capture()).rejects.toThrow()
      expect(app.control.calls).toBe(1)
      expect(app.ctx.sessionProjections.stateOf(app.agent.session, 'webTestScreenshots')?.images).toEqual([])
    } finally { await app.stop() }
  })

  it.each(['unbind', 'cancel', 'provider-unload'] as const)('rejects a capture when %s occurs during image publication', async (failure) => {
    const app = await fixture()
    try {
      const abort = new AbortController()
      const store = app.ctx.attachments as LifecycleStore
      store.afterSave = async () => {
        if (failure === 'unbind') await app.control.unbind(app.agent.session.id)
        if (failure === 'cancel') abort.abort()
        if (failure === 'provider-unload') {
          const original: unknown = Reflect.get(store, Symbol.for('cordis.original'))
          if (typeof original !== 'object' || original === null) throw new Error('store owner absent')
          const ctx: unknown = Reflect.get(original, 'ctx')
          if (!Context.is(ctx)) throw new Error('store Context absent')
          await ctx.fiber.dispose()
        }
      }
      await expect(app.ctx.agents.withInitiator(app.agent,
        () => app.ctx.webTestPolicy.captureBrowserScreenshot(app.agent.session.id, abort.signal))).rejects.toThrow()
      expect(app.control.calls).toBe(1)
      expect(app.ctx.sessionProjections.stateOf(app.agent.session, 'webTestScreenshots')?.images).toEqual([])
    } finally { await app.stop() }
  })

  it('reconstructs only paired successful screenshots and validates optional persisted image metadata', () => {
    const session = Session.create(SessionId('projection-only'))
    const image: ImageAttachmentRef = {
      attachmentId: brandString<ImageAttachmentRef['attachmentId']>('sha256:owned'), mediaType: 'image/png',
      bytes: 68, width: 1, height: 1, name: 'owned.png', originalDimensions: { width: 2, height: 2 },
    }
    for (const [name, isError] of [['read_image', false], ['web_browser_screenshot', true],
      ['web_browser_screenshot', false], ['web_browser_screenshot', false]] as const) {
      const callId = ToolCallId(`call-${session.seq}`)
      session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' })
      session.append('tool/result', { turn: 1, step: 1,
        message: createToolResultMessage({ callId, content: [{ type: 'image', attachment: image }], isError }) }, { surfaceOp: 'append' })
    }
    const state = session.snapshotEvents().reduce((previous, event) => screenshotProjection.apply(previous, event),
      screenshotProjection.init(session.header, session.inheritedEventCount))
    expect(state).toEqual({ pending: [], images: [image] })
    expect(screenshotProjection.stateSchema.parse(state)).toEqual(state)
    const unnamed = screenshotProjection.stateSchema.parse({ pending: [],
      images: [{ ...image, name: undefined, originalDimensions: undefined }] })
    expect(unnamed.images)
      .toEqual([{ attachmentId: image.attachmentId, mediaType: image.mediaType, bytes: 68, width: 1, height: 1 }])
    expect(screenshotProjection.stateSchema.safeParse({ pending: [], images: [{ ...image, width: 0 }] }).success).toBe(false)
  })
})
