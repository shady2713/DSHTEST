/** Explicit URL checks through the command Remote and official tool registry. */
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandNumber } from '@deepseek-ai/dsh-brand'
import type { Revision } from '@deepseek-ai/dsh-web-test-contracts'
import { startConversation } from './harness.ts'
import type { ConversationHarness } from './harness.ts'

let app: ConversationHarness | undefined
let server: Server | undefined
afterEach(async () => {
  await app?.stop()
  app = undefined
  if (server !== undefined) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server!.close((error) => { if (error === undefined) resolve(); else reject(error) }))
    server = undefined
  }
})

describe.skipIf(process.platform !== 'win32')('explicit conversation URL checks', () => {
  it('registers without network, checks through the shared Remote, and queries without repeating requests', async () => {
    let requests = 0
    server = createServer((_request, response) => { requests += 1; response.writeHead(401); response.end() })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Expected an allocated loopback address')
    const entryUrl = `http://127.0.0.1:${address.port}/login`
    app = await startConversation()
    const harness = app
    const remote = await harness.mountCommands()
    const agent = await harness.rootAgent('explicit-url-check')
    const project = await remote.commands.registerProject({
      sessionId: agent.session.id,
      registration: { commandId: 'cmd-url-onboard', codeRoots: [harness.codeRoot, harness.otherCodeRoot], entryUrls: [entryUrl] },
    })
    expect(requests).toBe(0)
    expect(remote.commands.queryStatus({ sessionId: agent.session.id, verb: 'query', subject: 'material' }).entryUrlProbe).toBeNull()
    expect(requests).toBe(0)
    const result = await remote.call('probeEntryUrls', { request: { sessionId: agent.session.id, projectId: project.projectId, expectedRevision: project.revision } })
    expect(result).toMatchObject({ ok: true, value: { projectId: project.projectId, revision: project.revision, entryUrls: [{ declared: entryUrl, state: 'response', statusCode: 401 }] } })
    expect(requests).toBe(1)
    const saved = harness.ctx.webTestRuntime.readEntryUrlProbe(project.projectId)
    for (const subject of ['material', 'environment', 'project', 'commands'] as const) {
      expect(remote.commands.queryStatus({ sessionId: agent.session.id, verb: 'query', subject })).toMatchObject({
        environmentConfirmed: false, entryUrlProbe: saved,
      })
    }
    expect(JSON.parse(await harness.callTool(agent, 'web_test_query', { subject: 'material' }))).toMatchObject({ entryUrlProbe: saved })
    expect(requests).toBe(1)
    expect(JSON.parse(await harness.callTool(agent, 'web_test_probe_entry_urls', { projectId: project.projectId, expectedRevision: project.revision }))).toMatchObject({ entryUrls: [{ state: 'response', statusCode: 401 }] })
    expect(requests).toBe(2)
    const advanced = await remote.commands.updateProject({
      projectId: project.projectId,
      sessionId: agent.session.id, commandId: 'cmd-url-revision', expectedRevision: project.revision,
      codeRoots: project.codeRoots, entryUrls: [`${entryUrl}/corrected`],
    })
    const stale = remote.commands.queryStatus({ sessionId: agent.session.id, verb: 'query', subject: 'material' })
    expect(stale.project.revision).toBe(advanced.revision)
    expect(stale.entryUrlProbe?.revision).toBe(project.revision)
    await expect(remote.commands.probeEntryUrls({ sessionId: agent.session.id, projectId: project.projectId, expectedRevision: project.revision })).rejects.toMatchObject({ code: 'web-test/stale-revision' })
    expect(requests).toBe(2)
    const stranger = await harness.rootAgent('unattached-url-check')
    await expect(remote.commands.probeEntryUrls({ sessionId: stranger.session.id, projectId: project.projectId, expectedRevision: brandNumber<Revision>(1) })).rejects.toMatchObject({ code: 'web-test-conversation/no-project' })
    expect(requests).toBe(2)
    const tool = harness.ctx.tools.get('web_test_probe_entry_urls', agent)
    expect(tool?.presentCall?.({ projectId: project.projectId, expectedRevision: project.revision })).toMatchObject({ card: 'generic', title: 'Check registered entry URLs' })
    await remote.unload()
    expect(harness.ctx.tools.get('web_test_probe_entry_urls', agent)).toBeUndefined()
  })

  it('passes model tool cancellation to the transport and keeps the cancelled observation', async () => {
    let announce!: () => void
    const started = new Promise<void>((resolve) => { announce = resolve })
    server = createServer(() => { announce() })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Expected an allocated loopback address')
    const entryUrl = `http://127.0.0.1:${address.port}`
    app = await startConversation()
    const remote = await app.mountCommands()
    const agent = await app.rootAgent('cancel-url-tool')
    const project = await app.registerProject('cmd-cancel-url-tool', entryUrl)
    await remote.commands.attachProject({ sessionId: agent.session.id, projectId: project.projectId })
    const controller = new AbortController()
    const call = app.ctx.tools.execute({
      name: 'web_test_probe_entry_urls', callId: ToolCallId('call-cancel-url'),
      arguments: { projectId: project.projectId, expectedRevision: project.revision }, agent, signal: controller.signal,
    })
    await started
    controller.abort()
    await call
    expect(app.ctx.webTestRuntime.readEntryUrlProbe(project.projectId)?.entryUrls).toEqual([{ declared: entryUrl, state: 'cancelled' }])
  })

  it('passes Remote caller cancellation through the real shared RPC carrier', async () => {
    let announce!: () => void
    const started = new Promise<void>((resolve) => { announce = resolve })
    server = createServer(() => { announce() })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Expected an allocated loopback address')
    const entryUrl = `http://127.0.0.1:${address.port}`
    app = await startConversation()
    const remote = await app.mountCommands()
    const agent = await app.rootAgent('cancel-url-rpc')
    const project = await app.registerProject('cmd-cancel-url-rpc', entryUrl)
    await remote.commands.attachProject({ sessionId: agent.session.id, projectId: project.projectId })
    const controller = new AbortController()
    const call = remote.call('probeEntryUrls', { request: { sessionId: agent.session.id, projectId: project.projectId, expectedRevision: project.revision } }, controller.signal)
    const rejected = expect(call).rejects.toThrow()
    await started
    controller.abort()
    await rejected
    expect(app.ctx.webTestRuntime.readEntryUrlProbe(project.projectId)?.entryUrls).toEqual([{ declared: entryUrl, state: 'cancelled' }])
  })
})
