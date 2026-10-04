/** Owned Electron renderer loading the current shared Client from a runProfile-composed Host. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { app, BrowserWindow } from 'electron'

const owned = resolve(process.argv[2])
const output = resolve(process.argv[3])
assert.notEqual(owned, output)
const scenario = process.argv.find(value => value.startsWith('--scenario='))?.slice('--scenario='.length) ?? 'rate-limit'
assert.ok(['rate-limit', 'timeout', 'reopen', 'late'].includes(scenario), 'Unknown owned scenario')
const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const require = createRequire(join(repo, 'apps/cli/package.json'))
const credentialsRequire = createRequire(join(repo, 'packages/credentials/credentials-local/package.json'))
const load = name => bounded(import(pathToFileURL(require.resolve(name)).href))
const allowedEnvironment = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC'])
for (const key of Object.keys(process.env)) {
  if (!allowedEnvironment.has(key.toUpperCase())) Reflect.deleteProperty(process.env, key)
}
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('lang', 'en-US')
app.setPath('userData', join(owned, 'electron'))
// Empty, owned locations are established before importing or booting any Harness plugin.
Object.assign(process.env, { HOME: owned, USERPROFILE: owned, APPDATA: owned, LOCALAPPDATA: owned, TEMP: owned, TMP: owned, DSH_HOME: join(owned, 'home'),
  DSH_AGENTS_HOME: join(owned, 'agents'), DSH_BUNDLED_SKILL_DIR: join(owned, 'skills'), DSH_TELEMETRY_DISABLED: '1' })
process.chdir(owned)

mkdirSync(output, { recursive: true })
const startedAt = Date.now(), stages = [], deadline = new AbortController()
let currentStage = 'entry'
function checkpoint(stage, data = {}) {
  currentStage = stage
  stages.push({ stage, elapsedMs: Date.now() - startedAt, ...data })
  writeFileSync(join(output, 'progress.json'), JSON.stringify({ currentStage, stages }, null, 2) + '\n')
}
checkpoint('entry')
// This fixture owns its final exit after profile/server teardown and error reporting.
app.on('window-all-closed', () => { checkpoint('owned-window-all-closed') })
const totalTimer = setTimeout(() => {
  const beforeReady = currentStage === 'entry'
  const reason = new Error(`Owned fixture deadline exceeded at ${currentStage}`)
  checkpoint('deadline-exceeded')
  deadline.abort(reason)
  if (beforeReady) { console.error(reason.message); app.exit(1) }
}, 65_000)

async function bounded(promise) {
  deadline.signal.throwIfAborted()
  let abort
  const aborted = new Promise((_resolve, reject) => {
    abort = () => reject(deadline.signal.reason)
    deadline.signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([promise, aborted]) }
  finally { deadline.signal.removeEventListener('abort', abort) }
}

async function until(read, message, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await bounded(Promise.resolve(read()))
    if (value) return value
    await delay(25)
  }
  throw new Error(message)
}

async function main() {
  await mkdir(output, { recursive: true })
  const requests = [], events = [], remote = {}, samples = [], rendererErrors = [], prompts = []
  const retryAfterMs = 8000
  const queuedText = 'Keep this queued input for a later turn'
  const freshText = 'Resume this same session after reopening'
  const completedText = 'OWNED_REOPEN_COMPLETED'
  const lateText = 'OWNED_LATE_RESPONSE_MUST_NOT_COMMIT'
  const transport = {}, reopening = {}
  let heldResponse
  // These Messages events match the maintained llm-deepseek mock-server fixture.
  const startEvents = [
    { type: 'message_start', message: { id: 'owned-message', model: 'deepseek-v4-flash', usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ]
  const completionEvents = text => [
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  const sse = frames => frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('')
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => { chunks.push(chunk) })
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      requests.push({ at: Date.now(), path: request.url, method: request.method,
        containsQueuedInput: body.includes(queuedText), containsFreshInput: body.includes(freshText) })
      if (scenario === 'timeout' || scenario === 'late') {
        heldResponse = response
        response.on('close', () => {
          transport.closedAt = Date.now()
          checkpoint('provider-response-closed', { requests: requests.length })
        })
        response.on('error', error => { transport.writeErrorCode = error.code })
        checkpoint('provider-request-held', { requests: requests.length, streaming: scenario === 'late' })
        if (scenario === 'late') {
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          response.write(sse(startEvents))
          transport.startedAt = Date.now()
        }
        return
      }
      if (scenario === 'reopen' && (requests.length === 2 || requests.length === 3)) {
        checkpoint('provider-request-completed', { requests: requests.length })
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(sse([...startEvents, ...completionEvents(completedText)]))
        return
      }
      checkpoint('provider-request-429', { requests: requests.length })
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(retryAfterMs / 1000) })
      response.end(JSON.stringify({ error: { message: 'Owned local rate limit', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }))
    })
  })
  let running, window, offEvent, offStream, agent, queued, facts
  const cleanup = { windowDestroyed: false, profileDisposed: false, serverClosed: false }
  try {
    checkpoint('loopback429-bind-start')
    await bounded(new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen) }))
    const port = server.address().port
    checkpoint('loopback429-bound', { port, hasLocalModelUrl: true })
    checkpoint('module-import-start')
    const { initProfile, loadProfileDirectory } = await load('@deepseek-ai/dsh-app-boot')
    const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment')
    const { credentialRef } = await bounded(import(pathToFileURL(credentialsRequire.resolve('@deepseek-ai/dsh-credentials')).href))
    const { createUserMessage } = await load('@deepseek-ai/dsh-llm')
    const { runProfile } = await load('@deepseek-ai/dsh/profile-boot')
    checkpoint('module-import-complete')
    const profileDir = join(owned, 'home/profiles/desktop')
    await mkdir(profileDir, { recursive: true })
    initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    const key = credentialRef('DSH_DESKTOP_CANCEL_LOCAL_KEY')
    const patches = [
      { id: 'hmr', disabled: true },
      { id: 'deepseek-account', disabled: true },
      { id: 'llm-deepseek-account', disabled: true },
      { id: 'account-controller', disabled: true },
      { id: 'ui-settings-account', disabled: true },
      { id: 'session-title-llm', disabled: true },
      { id: 'session-telemetry-otel', disabled: true },
      { id: 'desktop-product-telemetry', disabled: true },
      { id: 'product-analytics', disabled: true },
      { id: 'open-in-app', disabled: true },
      { id: 'ui-open-in-app', disabled: true },
      { id: 'session-log-deepseek', config: { enabled: false } },
      { id: 'ui-plugin-manager', config: { registryProbeEnabled: false } },
      { id: 'agent-instructions', disabled: true },
      { id: 'session-persistence-jsonl', config: { root: join(owned, 'sessions') } },
      { id: 'storage-json', config: { root: join(owned, 'storage') } },
      { id: 'workspace-controller', config: { documentsDirectory: join(owned, 'Documents') } },
      { id: 'credentials', config: { dshHome: join(owned, 'home'), watch: false } },
      { id: 'llm-deepseek', config: { baseURL: `http://127.0.0.1:${port}/v1`, apiKeyEnv: key,
        ...scenario === 'timeout' ? { streamIdleTimeoutMs: 500,
          retryPolicy: { mode: 'normal', maxRetries: 1, backoff: { initialDelayMs: retryAfterMs, maxDelayMs: retryAfterMs, jitterRatio: 0 } } } : {} } },
      { id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
      { id: 'webserver', config: { host: '127.0.0.1', port: 0, compression: 'gzip', compressionLevel: 1, compressionThresholdBytes: 1024 } },
      { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: true } },
      { id: 'directory-picker', disabled: true },
      { insert: [ { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
        { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' } ] },
    ]
    await writeFile(join(profileDir, 'cordis.patch.yml'), JSON.stringify(patches) + '\n')
    const installAnchor = require.resolve('@deepseek-ai/dsh/package.json')
    const profile = loadProfileDirectory('dsh', profileDir, installAnchor)
    assert.deepEqual(profile.skippedBundles, [])
    checkpoint('profile-boot-start')
    const booting = runProfile({ profile: 'desktop', environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]),
      resolvedProfile: { profile, installAnchor },
      patchFiles: [], applicationPatchFiles: [], args: ['--no-open', '--port', '0'] })
    booting.then(value => {
      running = value
      if (deadline.signal.aborted) void value.shutdown.shutdown(1)
    }, () => {})
    running = await bounded(booting)
    const ctx = running.ctx
    checkpoint('profile-boot-complete', { webPort: ctx.webServer.port, hasApplicationUrl: true })
    if (process.argv.includes('--boot-only')) {
      facts = { mode: 'boot-only', bootCompleted: true, windowCreated: false, cleanup }
      return
    }
    checkpoint('client-settings-start')
    await bounded(ctx.credentials.set(key, 'owned-local-synthetic-key'))
    await bounded(ctx.settings.mutate('ui-settings-general', [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-09-28.1' }]))
    await bounded(ctx.settings.mutate('locale', [{ op: 'set', path: ['preference'], value: 'en' }]))
    checkpoint('client-settings-complete')
    await mkdir(join(owned, 'workspace'), { recursive: true })
    checkpoint('workspace-prepare-start')
    await bounded(ctx.workspaceRegistry.initializeDefault(async () => join(owned, 'workspace')))
    checkpoint('workspace-prepare-complete')
    offEvent = ctx.on('session/event', (session, event) => {
      events.push(event)
      if (event.type === 'turn/start') agent = ctx.agents.get(session.id)
      if (event.type === 'llm/retry') {
        checkpoint('retry-scheduled', { status: event.data.failure.status })
        agent = ctx.agents.get(session.id)
      }
    })
    offStream = ctx.on('agent/assistant-stream', ({ agent: source, frame }) => {
      if (scenario === 'late' && frame.type === 'chunk' && frame.chunk.type === 'block-start') {
        agent = source
        transport.blockObservedAt = Date.now()
        checkpoint('provider-stream-block-observed')
      }
    })
    checkpoint('window-create-start')
    window = new BrowserWindow({ width: 1180, height: 820, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    checkpoint('window-created')
    window.webContents.on('render-process-gone', (_event, details) => rendererErrors.push(details))
    let cancelRequestId
    const responses = []
    window.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.requestWillBeSent' && new URL(params.request.url).pathname === '/api/session/prompt') {
        const request = JSON.parse(params.request.postData)
        prompts.push({ at: Date.now(), rpcId: request.rpcId, sessionId: request.payload.args.request.sessionId })
      }
      if (method === 'Network.requestWillBeSent' && new URL(params.request.url).pathname === '/api/session/cancel') {
        cancelRequestId = params.requestId
        remote.request = JSON.parse(params.request.postData)
        remote.issuedAt = Date.now()
        checkpoint('cancel-request-observed', { hasRpcId: typeof remote.request.rpcId === 'string' })
      }
      if (method === 'Network.loadingFinished' && params.requestId === cancelRequestId) {
        responses.push(window.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId }).then(body => {
          remote.reply = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body)
          remote.repliedAt = Date.now()
          checkpoint('cancel-reply-observed', { accepted: remote.reply.result?.value?.accepted === true })
        }))
      }
    })
    const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`)
    checkpoint('window-loadURL-start')
    await bounded(window.loadURL(url))
    checkpoint('window-loadURL-complete')
    checkpoint('network-observer-attach-start')
    window.webContents.debugger.attach('1.3')
    checkpoint('network-observer-enable-start')
    await bounded(window.webContents.debugger.sendCommand('Network.enable'))
    checkpoint('network-observer-ready')
    window.show(); window.focus()
    async function click(selector, text) {
      const rect = await until(() => window.webContents.executeJavaScript(`(() => {
        const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => {
          const rect = item.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && ${text === undefined ? 'true' : `(item.getAttribute('aria-label') === ${JSON.stringify(text)} || item.textContent.trim() === ${JSON.stringify(text)})`};
        }); if (!element) return null; const rect = element.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      })()`), `UI element absent: ${selector} ${text ?? ''}`)
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...rect })
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...rect })
    }
    const composer = '[data-composer-input][contenteditable="true"]'
    checkpoint('ui-ready-wait')
    await click(composer)
    checkpoint('ui-ready', { sessions: ctx.sessions.list().length })
    await window.webContents.insertText('Answer with one word, then stop.')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    checkpoint('native-composer-submitted')
    let retry
    if (scenario === 'late') {
      await until(() => transport.blockObservedAt !== undefined && agent !== undefined, 'The real Messages stream did not start')
    } else {
      retry = await until(() => events.find(event => event.type === 'llm/retry'), 'No real provider retry was scheduled')
      assert.equal(retry.data.mode, 'normal')
      if (scenario === 'timeout') {
        assert.equal(retry.data.failure.code, 'TIMEOUT')
        assert.equal(retry.data.failure.providerRetryAfterMs, undefined)
        await until(() => transport.closedAt, 'The timed-out Messages request remained open')
      } else {
        assert.equal(retry.data.failure.status, 429)
        assert.equal(retry.data.failure.providerRetryAfterMs, retryAfterMs)
      }
      assert.equal(retry.data.delayMs, retryAfterMs)
    }
    assert.equal(requests.length, 1)
    assert.ok(agent)
    queued = createUserMessage({ content: [{ type: 'text', text: queuedText }], source: { kind: 'user' } })
    // Session observers cannot reenter append; enqueue after retry publication returns.
    agent.send(queued, 'next-turn', false)
    checkpoint('pending-inbox-prepared', { pending: agent.inbox.nextTurn.length })
    assert.equal(agent.inbox.nextTurn.length, 1)
    checkpoint('native-stop-click-start')
    await click('button', 'Stop generating')
    await until(() => remote.reply, 'The real session/cancel Remote did not reply')
    await Promise.all(responses)
    assert.equal(remote.request.type, 'client-request')
    assert.equal(remote.request.method, 'session/cancel')
    assert.equal(remote.request.payload.args.request.sessionId, agent.id)
    assert.equal(remote.reply.type, 'server-response')
    assert.equal(remote.reply.rpcId, remote.request.rpcId)
    assert.deepEqual(remote.reply.result, { ok: true, value: { accepted: true } })
    const dueAt = retry === undefined ? remote.repliedAt + 400 : retry.time + retryAfterMs
    if (retry !== undefined) assert.ok(remote.repliedAt < dueAt, 'Stop must reach Host before the retry is due')
    await bounded(agent.whenIdle())
    checkpoint('session-idle')
    const end = await until(() => events.find(event => event.type === 'turn/end'), 'No turn/end after Stop')
    assert.deepEqual(end.data.reason, { kind: 'aborted', reason: { kind: 'user' } })
    const settledEventCount = events.length
    if (scenario === 'late') {
      await until(() => transport.closedAt, 'Cancellation did not close the active Messages response')
      await delay(Math.max(0, dueAt - Date.now()))
      transport.lateAttemptedAt = Date.now()
      transport.responseDestroyedAtAttempt = heldResponse.destroyed
      assert.ok(transport.closedAt <= transport.lateAttemptedAt)
      assert.equal(transport.responseDestroyedAtAttempt, true)
      heldResponse.write(sse(completionEvents(lateText)), error => {
        transport.lateWriteRejected = error !== undefined && error !== null
        if (error) transport.writeErrorCode = error.code
      })
      heldResponse.end()
      checkpoint('provider-late-completion-attempted', { responseAlreadyClosed: true })
    }
    for (const offset of [250, 1250, 3250]) {
      await delay(Math.max(0, dueAt + offset - Date.now()))
      samples.push({ at: Date.now(), dueAt, requests: requests.length, pending: agent.inbox.nextTurn.length, status: agent.status })
      checkpoint('post-deadline-sample', { offsetMs: offset, requests: requests.length })
      assert.equal(requests.length, 1)
      assert.equal(agent.status, 'idle')
      assert.deepEqual(agent.inbox.nextTurn, [queued])
    }
    assert.equal(events.filter(event => event.type === 'llm/retry-started').length, 0)
    if (scenario === 'late') {
      assert.equal(events.filter(event => event.type === 'llm/retry').length, 0)
      assert.equal(events.length, settledEventCount, 'A cancelled turn accepted a late event')
      assert.equal(JSON.stringify(events).includes(lateText), false)
      assert.equal(transport.lateWriteRejected, true)
    } else assert.equal(events.filter(event => event.type === 'assistant/message').length, 0)
    if (scenario === 'reopen') {
      checkpoint('client-reopen-start')
      await bounded(window.loadURL(window.webContents.getURL()))
      await click(composer)
      await delay(500)
      assert.equal(requests.length, 1)
      assert.equal(agent.status, 'idle')
      assert.deepEqual(agent.inbox.nextTurn, [queued])
      reopening.beforePrompt = { requests: requests.length, pending: agent.inbox.nextTurn.length, status: agent.status }
      checkpoint('client-reopened', reopening.beforePrompt)
      await window.webContents.insertText(freshText)
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
      checkpoint('native-reopened-composer-submitted')
      const completed = await until(() => events.find(event => event.type === 'turn/end' && event.data.turn === 3 && event.data.reason.kind === 'completed'), 'Reopened Client did not complete the fresh-input turn')
      await bounded(agent.whenIdle())
      // ReactLoopInbox claims one queued next-turn item per turn.
      assert.equal(requests.length, 3)
      assert.equal(requests[1].containsQueuedInput, true)
      assert.equal(requests[1].containsFreshInput, false)
      assert.equal(requests[2].containsFreshInput, true)
      assert.equal(agent.inbox.nextTurn.length, 0)
      assert.equal(prompts.length, 2)
      assert.equal(prompts.at(-1).sessionId, agent.id)
      assert.equal(ctx.sessions.list().length, 1)
      assert.equal(events.filter(event => event.type === 'turn/end').length, 3)
      assert.equal(events.filter(event => event.type === 'turn/end' && event.data.reason.kind === 'completed').length, 2)
      const assistantMessages = events.filter(event => event.type === 'assistant/message')
      assert.equal(assistantMessages.length, 2)
      for (const message of assistantMessages) assert.ok(JSON.stringify(message).includes(completedText))
      assert.equal(events.filter(event => event.type === 'llm/retry').length, 1)
      assert.equal(events.filter(event => event.type === 'llm/retry-started').length, 0)
      await delay(500)
      assert.equal(requests.length, 3)
      reopening.afterPrompt = { requests: requests.length, pending: agent.inbox.nextTurn.length, status: agent.status,
        sessionId: agent.id, prompt: prompts.at(-1), turnEnd: completed }
      checkpoint('reopened-turn-completed', { requests: requests.length, pending: agent.inbox.nextTurn.length })
    }
    assert.deepEqual(rendererErrors, [])
    facts = { mechanism: 'Electron BrowserWindow current shared Client → session/cancel Remote → formal runProfile Host',
      nativeGesture: 'sendInputEvent mouseDown/mouseUp on visible Stop button', observer: 'read-only Electron Network debugger',
      scenario, sessionId: agent.id, remote, retry, turnEnd: end, requests, samples, transport, reopening, inbox: { nextTurn: agent.inbox.nextTurn.length },
      limitations: ['Host runs in the fixture Main process; Desktop HostProcess IPC is not exercised', 'Owned local Messages protocol; real provider and general recovery are not exercised'], cleanup }
    await writeFile(join(output, 'session-events.json'), JSON.stringify(events, null, 2) + '\n')
    await bounded(window.capturePage().then(image => writeFile(join(output, 'stopped.png'), image.toPNG())))
  } catch (error) {
    checkpoint('failure', { errorType: error instanceof Error ? error.name : 'non-error' })
    await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), remote, events, requests, samples }, null, 2) + '\n')
    throw error
  } finally {
    clearTimeout(totalTimer)
    checkpoint('cleanup-start')
    const forceCleanup = setTimeout(() => {
      checkpoint('cleanup-deadline-exceeded', cleanup)
      app.exit(1)
    }, 10_000)
    const errors = []
    for (const release of [
      () => { offEvent?.() },
      () => { offStream?.() },
      () => {
        checkpoint('cleanup-window-start')
        if (window !== undefined) {
          if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach()
          if (deadline.signal.aborted) window.webContents.forcefullyCrashRenderer()
          window.destroy()
        }
        cleanup.windowDestroyed = window === undefined || window.isDestroyed()
        checkpoint('cleanup-window-complete', { windowDestroyed: cleanup.windowDestroyed })
      },
      async () => {
        checkpoint('cleanup-profile-start')
        if (running !== undefined) { await running.shutdown.shutdown(facts === undefined ? 1 : 0); cleanup.profileDisposed = true }
        checkpoint('cleanup-profile-complete', { profileDisposed: cleanup.profileDisposed })
      },
      async () => {
        server.closeAllConnections()
        if (server.listening) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
        cleanup.serverClosed = !server.listening
      },
    ]) {
      try { await release() } catch (error) { errors.push(String(error)) }
    }
    clearTimeout(forceCleanup)
    checkpoint('cleanup-complete', { ...cleanup, errorCount: errors.length, profileBootIncomplete: running === undefined })
    if (facts !== undefined && facts.mode !== 'boot-only') await cp(join(owned, 'sessions'), join(output, 'sessions'), { recursive: true })
    if (facts !== undefined) await writeFile(join(output, 'facts.json'), JSON.stringify(facts, null, 2) + '\n')
    if (errors.length > 0) throw new Error(`Owned cleanup failed: ${errors.join('; ')}`)
  }
  console.log('DESKTOP_CANCEL_REMOTE_OK')
}

app.whenReady().then(async () => {
  checkpoint('electron-ready')
  if (process.argv.includes('--readiness-only')) { clearTimeout(totalTimer); console.log('DESKTOP_CANCEL_ELECTRON_READY'); app.exit(0); return }
  await main()
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
