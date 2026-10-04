import { SessionId } from '@deepseek-ai/dsh-session'
import type { DesktopBrowserWorkspaceKey } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
/**
 * The Host→Main automation command path over the existing private IPC. The command
 * joins the Host event union rather than opening a second channel, so these cases
 * prove both that a well-formed command reaches its target and that a malformed one
 * fails the Host instead of being silently dropped.
 *
 * The fixture reports the Main's answer through the HTTP body it serves, because the
 * Main rejects any Host event outside the declared union — there is no other place
 * the test could observe the reply.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DESKTOP_BROWSER_AUTOMATION_VERSION, type DesktopBrowserTargetId } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { DesktopHostProcess } from '../src/host-process.ts'
import type { BrowserAutomationTarget } from '../src/browser-automation.ts'

const roots: string[] = []
const hosts: DesktopHostProcess[] = []

/** A host that sends one command, serves the Main's answer at `/`, then answers shutdown. */
function hostSource(command: unknown): string {
  return `import { createServer } from 'node:http'
let answer = null
const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(answer))
})
server.listen(0, '127.0.0.1', () => {
  process.send({ type: 'ready', url: 'http://127.0.0.1:' + String(server.address().port) })
  process.on('message', (message) => {
    if (!message) return
    if (message.type === 'browser-command-result') {
      answer = {
        ...message.result,
        envelope: message.requestId,
        screenshotIsUint8Array: message.result.screenshot instanceof Uint8Array,
        screenshotBytes: Array.from(message.result.screenshot ?? []),
      }
    }
    // Without this the shell's stop waits out its deadline for a shutdown-complete
    // the fixture never sends.
    if (message.type === 'shutdown') { process.send({ type: 'shutdown-complete' }); server.close(); process.disconnect() }
  })
  setTimeout(() => {
    process.send({ type: 'browser-command', command: ${JSON.stringify(command)}, requestId: 77 })
  }, 80)
})
`
}

function projectWithHost(source: string): string {
  const project = mkdtempSync(join(tmpdir(), 'dsh-desktop-browser-ipc-'))
  roots.push(project)
  const packageRoot = join(project, 'node_modules', '@deepseek-ai', 'dsh-desktop-host')
  mkdirSync(join(packageRoot, 'lib'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), '{"name":"@deepseek-ai/dsh-desktop-host","type":"module"}\n')
  writeFileSync(join(packageRoot, 'lib', 'index.js'), source)
  return project
}

function hostProcess(
  runtime: string,
  resolveTarget?: (target: string) => BrowserAutomationTarget | undefined,
  epoch = 0,
): DesktopHostProcess {
  const host = new DesktopHostProcess(
    process.execPath, runtime, runtime, undefined, process.env, undefined, undefined, undefined, undefined, resolveTarget, epoch,
  )
  hosts.push(host)
  return host
}

/** Records which executor the Main reached, so "reached" is an observation. */
function recordingTarget(): { target: BrowserAutomationTarget; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    target: {
      id: 'guest-1' as DesktopBrowserTargetId,
      hostEpoch: 0,
      workspace: 'session:controls-owner' as DesktopBrowserWorkspaceKey,
      url: () => 'https://example.test/',
      authorizedSession: () => SessionId('controls-owner'),
      authorize: () => {},
      authorizedDocument: () => true,
      prepareInput: () => true,
      inputReady: () => true,
      revoke: () => {},
      live: () => true,
      currentObservation: () => undefined,
      observe: async () => {
        calls.push('observe')
        return { hostEpoch: 0, sessionId: SessionId('controls-owner'), target: 'guest-1' as DesktopBrowserTargetId, generation: 1, url: 'https://x.test/', title: 'x', elements: [] }
      },
      revalidate: async () => {
        calls.push('revalidate')
        return { ref: 'e0', role: 'button', name: 'x', x: 1, y: 2, width: 3, height: 4 }
      },
      doubleClick: async () => {},
      pressKey: async () => {},
      canNavigate: () => true,
      navigate: async () => {},
      reload: async () => {},
      screenshot: async () => { calls.push('screenshot'); return new Uint8Array([137, 80, 78, 71, 0, 255]) },
      click: async () => { calls.push('click') },
      type: async () => { calls.push('type') },
    },
  }
}

async function answerFor(baseUrl: string): Promise<unknown> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const body = await (await fetch(`${baseUrl}/result`)).text()
    if (body !== 'null' && body !== '') return JSON.parse(body)
    await new Promise(done => setTimeout(done, 100))
  }
  return null
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Host automation command over private IPC', () => {
  it('runs an admitted command on its target and answers it correlated', async () => {
    const { target, calls } = recordingTarget()
    const host = hostProcess(projectWithHost(hostSource({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 3, hostEpoch: 0, sessionId: SessionId('controls-owner'), target: 'guest-1', body: { kind: 'observe' } })), () => target)
    const { url } = await host.start()
    // The answer carries the command's own requestId, which is what the Host matches on;
    // the IPC envelope's requestId correlates the reply on the wire.
    expect(await answerFor(url)).toMatchObject({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 3, ok: true })
    expect(calls).toEqual(['observe'])
  })

  it('refuses a command whose target the Main does not resolve, without reaching anything', async () => {
    const { target, calls } = recordingTarget()
    const host = hostProcess(projectWithHost(hostSource({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 3, hostEpoch: 0, sessionId: SessionId('controls-owner'), target: 'missing', body: { kind: 'observe' } })), () => undefined)
    const { url } = await host.start()
    expect(await answerFor(url)).toMatchObject({ ok: false, reason: 'wrong-target' })
    expect(calls).toEqual([])
    void target
  })

  it('preserves screenshot Uint8Array bytes when the Host receives its IPC answer', async () => {
    const { target, calls } = recordingTarget()
    const host = hostProcess(projectWithHost(hostSource({
      version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 3, hostEpoch: 0, sessionId: SessionId('controls-owner'), target: 'guest-1', body: { kind: 'screenshot', format: 'png' },
    })), () => target)
    const { url } = await host.start()
    // The child inspects the typed array before its separate HTTP response serializes to JSON.
    expect(await answerFor(url)).toMatchObject({
      version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 3, envelope: 77, ok: true,
      screenshotIsUint8Array: true, screenshotBytes: [137, 80, 78, 71, 0, 255],
    })
    expect(calls).toEqual(['screenshot'])
  })

  it('refuses a command from a Host generation the Main no longer serves', async () => {
    const { target, calls } = recordingTarget()
    const host = hostProcess(projectWithHost(hostSource({ version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 3, hostEpoch: 4, sessionId: SessionId('controls-owner'), target: 'guest-1', body: { kind: 'observe' } })), () => target, 9)
    const { url } = await host.start()
    expect(await answerFor(url)).toMatchObject({ ok: false, reason: 'epoch-mismatch' })
    expect(calls).toEqual([])
  })

  it.each([
    ['an unknown protocol revision', { version: 99, requestId: 3, hostEpoch: 0, sessionId: SessionId('controls-owner'), target: 'guest-1', body: { kind: 'observe' } }],
    ['a missing body', { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 3, hostEpoch: 0, sessionId: SessionId('controls-owner'), target: 'guest-1' }],
    ['a non-integer epoch', { version: DESKTOP_BROWSER_AUTOMATION_VERSION, requestId: 3, hostEpoch: 'now', sessionId: SessionId('controls-owner'), target: 'guest-1', body: { kind: 'observe' } }],
    ['a missing request id', { version: DESKTOP_BROWSER_AUTOMATION_VERSION, hostEpoch: 0, sessionId: SessionId('controls-owner'), target: 'guest-1', body: { kind: 'observe' } }],
  ])('fails the Host on %s rather than dropping it', async (_case, command) => {
    // Sent before readiness: an unrecognised Host message is a startup failure, so the
    // refusal has to surface there rather than after a successful start.
    const host = hostProcess(projectWithHost(`import { createServer } from 'node:http'
const server = createServer((request, response) => { response.end('ok') })
server.listen(0, '127.0.0.1', () => {
  process.send({ type: 'browser-command', command: ${JSON.stringify(command)}, requestId: 77 })
  process.disconnect()
})
`))
    await expect(host.start()).rejects.toThrow('invalid IPC event')
  })
})
