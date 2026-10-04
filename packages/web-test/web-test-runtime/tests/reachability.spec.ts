/** Real loopback HEAD requests: redirects, credentials, deadline, cancellation and persistence. */
import { createServer } from 'node:http'
import type { Server, IncomingMessage, ServerResponse } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ProjectId } from '@deepseek-ai/dsh-web-test-contracts'
import { observeEntryUrl } from '../src/reachability.ts'
import { Config } from '../src/index.ts'
import { cleanup, registration, startRuntime, unitBytes } from './harness.ts'
import type { RuntimeHarness } from './harness.ts'

const servers: Server[] = []
const runtimes: RuntimeHarness[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.stop()))
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  })))
  await cleanup()
})

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected a loopback address')
  return `http://127.0.0.1:${address.port}`
}

async function boot(timeout = 200): Promise<RuntimeHarness> {
  const harness = await startRuntime({ entryUrlProbeTimeoutMs: timeout })
  runtimes.push(harness)
  return harness
}

describe('registered URL transport', () => {
  it('resolves a finite integer deadline and refuses invalid config at load', () => {
    expect(Config({ controlRoot: 'C:\\control' }).entryUrlProbeTimeoutMs).toBe(10_000)
    expect(Config({ controlRoot: 'C:\\control', entryUrlProbeTimeoutMs: 1 }).entryUrlProbeTimeoutMs).toBe(1)
    for (const timeout of [0, -1, 60_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => Config({ controlRoot: 'C:\\control', entryUrlProbeTimeoutMs: timeout })).toThrow()
    }
  })

  it('keeps HTTP errors and redirects without requesting a redirect target or sending cookies or auth', async () => {
    let externalRequests = 0
    const external = await listen((_request, response) => { externalRequests += 1; response.end() })
    const seen: { url: string | undefined; method: string | undefined; auth: string | undefined; cookie: string | undefined }[] = []
    const origin = await listen((request, response) => {
      seen.push({ url: request.url, method: request.method, auth: request.headers.authorization, cookie: request.headers.cookie })
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: `${external}/forbidden`, 'Set-Cookie': 'secret=1' })
      } else response.writeHead(404)
      response.end('This body must not be retained')
    })
    const signal = new AbortController().signal
    expect(await observeEntryUrl(`${origin}/redirect`, 2000, signal)).toEqual({ declared: `${origin}/redirect`, state: 'response', statusCode: 302 })
    expect(await observeEntryUrl(`${origin}/missing`, 2000, signal)).toEqual({ declared: `${origin}/missing`, state: 'response', statusCode: 404 })
    expect(seen).toEqual([
      { url: '/redirect', method: 'HEAD', auth: undefined, cookie: undefined },
      { url: '/missing', method: 'HEAD', auth: undefined, cookie: undefined },
    ])
    expect(externalRequests).toBe(0)
  })

  it('rejects credentials and non-http declarations without requests', async () => {
    let requests = 0
    const origin = await listen((_request, response) => { requests += 1; response.end() })
    const signal = new AbortController().signal
    for (const [declared, reason] of [
      ['not-a-url', 'invalid-url'], ['file:///secret', 'unsupported-protocol'],
      [origin.replace('http://', 'http://user:password@'), 'credentials'],
    ] as const) expect(await observeEntryUrl(declared, 100, signal)).toEqual({ declared, state: 'unusable', reason })
    expect(requests).toBe(0)
  })

  it('reports a complete deadline and a transport disconnect separately', async () => {
    const origin = await listen((request) => { if (request.url === '/disconnect') request.socket.destroy() })
    const signal = new AbortController().signal
    expect(await observeEntryUrl(`${origin}/hang`, 100, signal)).toEqual({ declared: `${origin}/hang`, state: 'timeout' })
    expect(await observeEntryUrl(`${origin}/disconnect`, 2000, signal)).toEqual({ declared: `${origin}/disconnect`, state: 'unreachable' })
  })

  it('retains TLS connection failures without weakening HTTPS certificate verification', async () => {
    const origin = await listen((_request, response) => { response.end() })
    const declared = origin.replace('http:', 'https:')
    expect(await observeEntryUrl(declared, 2000, new AbortController().signal)).toEqual({ declared, state: 'unreachable' })
  })

  it('closes an in-flight request on cancellation and sends no request for already-cancelled work', async () => {
    let announce!: () => void
    const started = new Promise<void>((resolve) => { announce = resolve })
    let closed!: () => void
    const stopped = new Promise<void>((resolve) => { closed = resolve })
    let requests = 0
    const origin = await listen((request) => { requests += 1; request.socket.once('close', closed); announce() })
    const controller = new AbortController()
    const pending = observeEntryUrl(origin, 5000, controller.signal)
    await started
    controller.abort()
    expect(await pending).toEqual({ declared: origin, state: 'cancelled' })
    await stopped
    expect(await observeEntryUrl(origin, 5000, controller.signal)).toEqual({ declared: origin, state: 'cancelled' })
    expect(requests).toBe(1)
  })
})

describe.skipIf(process.platform !== 'win32')('durable registered URL observations', () => {
  it('saves an empty check and returns copies without changing the durable result', async () => {
    const harness = await boot()
    const receipt = await harness.runtime.registerProject(registration('cmd-empty-check', { entryUrls: [] }))
    const projectId = brandString<ProjectId>(receipt.resourceId)
    const project = harness.runtime.readProject(projectId)!
    const saved = await harness.runtime.probeEntryUrls(projectId, project.revision)
    expect(saved.entryUrls).toEqual([])
    expect(harness.runtime.readEntryUrlProbe(projectId)).toEqual(saved)
    const clone = harness.runtime.readEntryUrlProbe(projectId)!
    expect(clone).not.toBe(saved)
    expect(clone.entryUrls).not.toBe(saved.entryUrls)
    await expect(harness.runtime.probeEntryUrls(brandString<ProjectId>(`project-${'0'.repeat(32)}`), project.revision)).rejects.toMatchObject({ code: 'web-test/record-unpublished' })
  })

  it.each(['project', 'revision', 'addresses'] as const)('refuses a saved check with mismatched %s', async (mismatch) => {
    const first = await boot()
    const receipt = await first.runtime.registerProject(registration(`cmd-probe-corrupt-${mismatch}`, { entryUrls: [] }))
    const projectId = brandString<ProjectId>(receipt.resourceId)
    const project = first.runtime.readProject(projectId)!
    await first.runtime.probeEntryUrls(projectId, project.revision)
    await first.stop()
    runtimes.splice(runtimes.indexOf(first), 1)
    const raw = JSON.parse((await unitBytes(first))!.toString()) as {
      tables: { entry_url_probes: Record<string, Record<string, unknown>> }
    }
    const stored = raw.tables.entry_url_probes[projectId]!
    if (mismatch === 'project') stored.projectId = `project-${'0'.repeat(32)}`
    else if (mismatch === 'revision') stored.revision = 2
    else stored.entryUrls = [{ declared: 'http://unregistered.example/', state: 'cancelled' }]
    await writeFile(first.unitPath, JSON.stringify(raw))
    const reopened = await startRuntime({ controlRoot: first.controlRoot })
    runtimes.push(reopened)
    expect(() => reopened.runtime.readEntryUrlProbe(projectId)).toThrow(expect.objectContaining({ code: 'web-test/record-mismatch' }))
  })

  it('refuses an oversized target list at the durable boundary before any check can run', async () => {
    const first = await boot()
    const receipt = await first.runtime.registerProject(registration('cmd-probe-oversized', { entryUrls: [] }))
    await first.stop()
    runtimes.splice(runtimes.indexOf(first), 1)
    const raw = JSON.parse((await unitBytes(first))!.toString()) as { tables: { projects: Record<string, Record<string, unknown>> } }
    raw.tables.projects[receipt.resourceId]!.entryUrls = Array.from({ length: 33 }, (_, index) => `http://unrequested.example/${index}`)
    await writeFile(first.unitPath, JSON.stringify(raw))
    await expect(startRuntime({ controlRoot: first.controlRoot })).rejects.toMatchObject({ code: 'invalid-record' })
  })

  it('checks only registered URLs, saves each finding, and reopens without network or writes', async () => {
    let requests = 0
    const origin = await listen((request, response) => {
      requests += 1
      if (request.url === '/hang') return
      if (request.url === '/disconnect') { request.socket.destroy(); return }
      response.writeHead(request.url === '/redirect' ? 302 : 403, { Location: `${origin}/outside` })
      response.end()
    })
    const first = await boot()
    const urls = [`${origin}/error`, `${origin}/redirect`, `${origin}/hang`, `${origin}/disconnect`, 'file:///unsupported']
    const receipt = await first.runtime.registerProject(registration('cmd-entry-check', { entryUrls: urls }))
    const projectId = brandString<ProjectId>(receipt.resourceId)
    const project = first.runtime.readProject(projectId)!
    expect(requests).toBe(0)
    expect(first.runtime.readEntryUrlProbe(projectId)).toBeUndefined()
    const checked = await first.runtime.probeEntryUrls(projectId, project.revision)
    expect(checked.entryUrls).toEqual([
      { declared: urls[0], state: 'response', statusCode: 403 },
      { declared: urls[1], state: 'response', statusCode: 302 },
      { declared: urls[2], state: 'timeout' },
      { declared: urls[3], state: 'unreachable' },
      { declared: urls[4], state: 'unusable', reason: 'unsupported-protocol' },
    ])
    const savedBytes = await unitBytes(first)
    expect(savedBytes?.toString()).toContain('entry_url_probes')
    expect(requests).toBe(4)
    await first.stop()
    runtimes.splice(runtimes.indexOf(first), 1)
    const second = await startRuntime({ controlRoot: first.controlRoot, dataRoot: first.dataRoot })
    runtimes.push(second)
    expect(second.runtime.readEntryUrlProbe(projectId)).toEqual(checked)
    expect(await unitBytes(second)).toEqual(savedBytes)
    expect(requests).toBe(4)
  })

  it('records cancelled targets and refuses to publish a check after the project revision changes', async () => {
    let announce!: () => void
    let started = new Promise<void>((resolve) => { announce = resolve })
    let requests = 0
    const origin = await listen(() => { requests += 1; announce() })
    const harness = await boot(5000)
    const receipt = await harness.runtime.registerProject(registration('cmd-entry-cancel', { entryUrls: [`${origin}/first`, `${origin}/second`] }))
    const projectId = brandString<ProjectId>(receipt.resourceId)
    const project = harness.runtime.readProject(projectId)!
    const controller = new AbortController()
    const check = harness.runtime.probeEntryUrls(projectId, project.revision, controller.signal)
    await started
    controller.abort()
    const cancelled = await check
    expect(cancelled.entryUrls.map(entry => entry.state)).toEqual(['cancelled', 'cancelled'])
    expect(requests).toBe(1)
    expect(harness.runtime.readEntryUrlProbe(projectId)).toEqual(cancelled)
    started = new Promise<void>((resolve) => { announce = resolve })
    const staleController = new AbortController()
    const stale = harness.runtime.probeEntryUrls(projectId, project.revision, staleController.signal)
    const rejected = expect(stale).rejects.toMatchObject({ code: 'web-test/stale-revision' })
    await started
    const prepared = harness.runtime.prepareProjectUpdate(projectId)
    await harness.runtime.commitProjectUpdate(
      { commandId: 'cmd-entry-change', recordId: prepared.recordId, expectedRevision: prepared.expectedRevision },
      prepared, { codeRoots: project.codeRoots, entryUrls: [`${origin}/changed`] },
    )
    staleController.abort()
    await rejected
    expect(harness.runtime.readEntryUrlProbe(projectId)).toEqual(cancelled)
    await expect(harness.runtime.probeEntryUrls(projectId, project.revision)).rejects.toMatchObject({ code: 'web-test/stale-revision' })
    expect(requests).toBe(2)
  })

  it('disposal closes in-flight probes and saves cancellation before releasing the domain', async () => {
    let announce!: () => void
    const started = new Promise<void>((resolve) => { announce = resolve })
    const origin = await listen(() => { announce() })
    const harness = await boot(5000)
    const receipt = await harness.runtime.registerProject(registration('cmd-entry-dispose', { entryUrls: [origin] }))
    const projectId = brandString<ProjectId>(receipt.resourceId)
    const project = harness.runtime.readProject(projectId)!
    const pending = harness.runtime.probeEntryUrls(projectId, project.revision)
    await started
    await harness.stop()
    runtimes.splice(runtimes.indexOf(harness), 1)
    expect((await pending).entryUrls).toEqual([{ declared: origin, state: 'cancelled' }])
    const next = await startRuntime({ controlRoot: harness.controlRoot, dataRoot: harness.dataRoot })
    runtimes.push(next)
    expect(next.runtime.readEntryUrlProbe(projectId)?.entryUrls).toEqual([{ declared: origin, state: 'cancelled' }])
    await expect(harness.runtime.probeEntryUrls(projectId, project.revision)).rejects.toThrow()
  })
})
