/** Owned Electron fixture: sandboxed role webviews, production Broker and independent business facts. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { app, BrowserWindow, webContents } from 'electron'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '../../../../packages/core/session/lib/index.js'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '../../../../packages/test-support/agent-loop-testkit/lib/index.js'
import { readBrowserExecutionOwner } from '../../../../packages/client/ui-sidebar-browser/lib/types/control.js'
import { DesktopBrowserExecutionGroups } from '../../../../packages/experimental/browser-use-web-test/lib/types/group-execution.js'
import { DesktopBrowserGuests } from '../../lib/types/browser-guests.js'
import { HostTargetRegistry } from '../../lib/types/automation-targets.js'
import { runCommand } from '../../lib/types/browser-automation.js'
import { installDesktopBrowserAutomation } from '../../../desktop-host/lib/types/browser-automation.js'
import { HostBrowserControl } from '../../../desktop-host/lib/types/browser-control.js'

app.disableHardwareAcceleration()
app.setPath('userData', process.argv[2])

async function main() {
  const facts = [], pendingResponses = [], identities = []
  let active = 0, maxActive = 0
  const business = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture')
    const role = url.searchParams.get('role')
    if (url.pathname === '/operate' && request.method === 'POST') {
      const fact = { role, record: url.searchParams.get('record'), startedAt: Date.now(), endedAt: null,
        cookie: request.headers.cookie ?? '' }
      facts.push(fact); active += 1; maxActive = Math.max(maxActive, active)
      pendingResponses.push({ response, fact })
      if (pendingResponses.length === 2) {
        for (const pending of pendingResponses) { pending.fact.endedAt = Date.now(); active -= 1; pending.response.end('Recorded') }
      }
      return
    }
    if (url.pathname === '/identity' && request.method === 'POST') {
      let body = ''
      request.on('data', chunk => { body += chunk })
      request.on('end', () => { identities.push({ role, cookie: request.headers.cookie ?? '', ...JSON.parse(body) }); response.end('OK') })
      return
    }
    if (url.pathname === '/worker.js') {
      response.setHeader('content-type', 'application/javascript')
      response.end(`self.addEventListener('install', () => self.skipWaiting());self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));self.addEventListener('message', event => event.ports[0].postMessage(${JSON.stringify(role)}));`)
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><meta charset="utf-8"><title>Role ${role}</title><h1>Role ${role}</h1><button aria-label="Record operation">Record</button><h2 id="status">Ready</h2><script>
document.cookie='role=${role};path=/';localStorage.setItem('role',${JSON.stringify(role)});
document.querySelector('button').onclick=async()=>{document.querySelector('#status').textContent=await(await fetch('/operate?role=${role}&record=group-record-1',{method:'POST'})).text()};
(async()=>{await navigator.serviceWorker.register('/worker.js?role=${role}');await navigator.serviceWorker.ready;while(!navigator.serviceWorker.controller)await new Promise(resolve=>setTimeout(resolve,10));const channel=new MessageChannel();const worker=await new Promise(resolve=>{channel.port1.onmessage=event=>resolve(event.data);navigator.serviceWorker.controller.postMessage('role',[channel.port2])});await fetch('/identity?role=${role}',{method:'POST',body:JSON.stringify({localStorageRole:localStorage.getItem('role'),workerRole:worker})});document.querySelector('#status').textContent='Identity ready'})();
</script>`)
  })
  await new Promise(resolve => business.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${business.address().port}`
  const window = new BrowserWindow({ show: false, width: 1280, height: 700, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: true, backgroundThrottling: false,
  } })
  const registry = new HostTargetRegistry()
  const epoch = registry.connectHost()
  const sessionId = SessionId('native-group-session')
  const owner = readBrowserExecutionOwner({ group: 'native-group', activation: 'native-activation', project: 'native-project',
    run: 'native-run', sessionId, hostEpoch: epoch, workspace: `session:${sessionId}` })
  assert.ok(owner)
  const guests = new DesktopBrowserGuests(() => undefined)
  const controllers = new Map()
  const sender = installDesktopBrowserAutomation(async message => {
    if (message.type === 'browser-command-cancel') { controllers.get(message.requestId)?.abort(); return }
    const controller = new AbortController()
    controllers.set(message.requestId, controller)
    try {
      const result = await runCommand(message.command, { currentEpoch: registry.currentEpoch(),
        target: registry.resolve(message.command.target), signal: controller.signal,
        authorized: command => registry.authorizedCommand(command) })
      sender.accept({ type: 'browser-command-result', requestId: message.requestId, result })
    } finally { controllers.delete(message.requestId) }
  })
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(sessionId)
  ctx.provide('workspaceRegistry', { list: () => [] })
  let control
  await ctx.plugin(HostBrowserControl, { bridge: sender, send: async message => {
    assert.equal(message.type, 'browser-group-binding')
    control.accept({ type: 'browser-group-binding-result', result: registry.bindGroup(message.request) })
  } })
  control = ctx.desktopBrowserControl
  const releasePublication = registry.subscribe(state => control.accept({ type: 'browser-control-state', state }))
  let groups
  class RuntimeProbe extends Service {
    static inject = ['desktopBrowserControl']
    constructor(runtime) {
      super(runtime, 'webTestRuntime')
      groups = new DesktopBrowserExecutionGroups(runtime, control)
    }
  }
  await ctx.plugin(RuntimeProbe)
  const pause = duration => new Promise(resolve => setTimeout(resolve, duration))
  const until = async predicate => { for (let index = 0; index < 500; index += 1) { if (await predicate()) return; await pause(10) } throw new Error('fixture deadline exceeded') }
  const roleGuests = []
  try {
    await window.loadURL('data:text/html,<html><body style="display:flex;margin:0"></body></html>')
    guests.bind(window, () => () => {}, () => registry.currentEpoch(), target => registry.register(target), () => registry.changed())
    for (const role of ['author', 'reviewer']) {
      const executionRole = { owner, role }
      const reservation = guests.acquireRole(window.webContents, executionRole)
      const id = await window.webContents.executeJavaScript(`new Promise(resolve=>{const view=document.createElement('webview');view.style.cssText='width:620px;height:620px;flex:none';view.setAttribute('partition',${JSON.stringify(reservation.partition)});view.src=${JSON.stringify('about:blank#' + reservation.lease)};view.addEventListener('dom-ready',()=>resolve(view.getWebContentsId()),{once:true});document.body.appendChild(view)})`, false)
      const guest = webContents.fromId(id)
      assert.ok(guest)
      roleGuests.push({ role, guest, reservation })
      await guest.loadURL(`${origin}/?role=${role}`)
    }
    await until(() => identities.length === 2 && control.targets().length === 2)
    assert.deepEqual(identities.map(identity => [identity.role, identity.cookie, identity.localStorageRole, identity.workerRole]).sort(),
      [['author', 'role=author', 'author', 'author'], ['reviewer', 'role=reviewer', 'reviewer', 'reviewer']])
    assert.notEqual(roleGuests[0].reservation.partition, roleGuests[1].reservation.partition)
    console.log('ROLE_STORAGE_ISOLATION_OK: cookies, localStorage and Service Worker roles remain separate')
    window.show(); window.focus()
    await until(() => window.isFocused())
    let callbackCount = 0
    await groups.run(agent, owner, control.targets(), new AbortController().signal, async executor => {
      callbackCount += 1
      const observed = await Promise.all(['author', 'reviewer'].map(role => executor.submit(role, { kind: 'observe' })))
      const results = await Promise.all(observed.map((result, index) => {
        assert.equal(result.ok, true)
        const element = result.observation.elements.find(item => item.name === 'Record operation')
        assert.ok(element)
        return executor.submit(['author', 'reviewer'][index], { kind: 'click', ref: element.ref, generation: result.observation.generation })
      }))
      assert.ok(results.every(result => result.ok))
      await until(() => facts.length === 2 && facts.every(fact => fact.endedAt !== null))
      await until(async () => {
        const readback = await Promise.all(['author', 'reviewer'].map(role => executor.submit(role, { kind: 'observe' })))
        return readback.every(result => result.ok && result.observation.elements.some(element => element.name === 'Recorded'))
      })
    })
    assert.equal(callbackCount, 1)
    assert.equal(maxActive, 2)
    assert.equal(facts.length, 2)
    assert.ok(facts[0].startedAt <= facts[1].endedAt && facts[1].startedAt <= facts[0].endedAt)
    assert.deepEqual(facts.map(fact => [fact.role, fact.record, fact.cookie]).sort(),
      [['author', 'group-record-1', 'role=author'], ['reviewer', 'group-record-1', 'role=reviewer']])
    await groups.dispose()
    assert.ok(roleGuests.every(item => registry.resolve(item.reservation.lease)?.authorizedSession() === undefined))
    console.log('EXECUTION_GROUP_FACTS:' + JSON.stringify({ callbackCount, maxActive, facts, identities }))
    console.log('NATIVE_EXECUTION_GROUP_OK')
  } finally {
    for (const controller of controllers.values()) controller.abort()
    await groups.dispose()
    releasePublication()
    sender.dispose()
    await guests.releaseRoleGroup(window.webContents, { owner, role: 'author' })
    await ctx.fiber.dispose()
    if (!window.isDestroyed()) window.destroy()
    for (const pending of pendingResponses) if (!pending.response.writableEnded) pending.response.end('Canceled')
    await new Promise(resolve => business.close(resolve))
  }
}

app.whenReady().then(async () => { await main(); app.exit(0) })
  .catch(error => { console.error(error); app.exit(1) })
