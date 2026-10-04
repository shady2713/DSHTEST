/** A sandboxed renderer fixture; every effect is delivered through the production channel. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { app, BrowserWindow } from 'electron'
import { LeasedGuestTarget } from '../../lib/types/browser-automation-target.js'
import { runCommand } from '../../lib/types/browser-automation.js'
import { installDesktopBrowserAutomation } from '../../../desktop-host/lib/types/browser-automation.js'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '../../../../packages/core/session/lib/index.js'
import { HostBrowserControl } from '../../../desktop-host/lib/types/browser-control.js'
import { HostTargetRegistry } from '../../lib/types/automation-targets.js'

app.disableHardwareAcceleration()
app.setPath('userData', process.argv[2])
// Keep the owned process alive until cleanup and any failure have reached the launcher.
app.on('window-all-closed', () => {})

const html = outside => `<!doctype html><meta charset="utf-8"><title>Native browser controls</title>
<form><input aria-label="Task"><button>Submit</button></form><textarea aria-label="Reason"></textarea>
<a aria-label="Business path" href="/business">Business path</a>
<a aria-label="Foreign click" href="${outside}/click">Foreign click</a>
<a aria-label="Foreign redirect" href="/redirect-away">Foreign redirect</a>
<form action="${outside}/form"><button aria-label="Foreign form">Foreign form</button></form>
<a aria-label="Same-page link" href="#native-positive" style="display:block;width:max-content">Same-page link</a>
<label aria-label="Edit" id="edit">Edit</label><h1 id="status">Ready</h1><h2 id="events">No input</h2>
<button id="focus-target" aria-label="Focus moves target" style="position:fixed;left:100px;top:420px">Focus target</button>
<button id="focus-decoy" aria-label="Focus decoy" style="display:none;position:fixed;left:100px;top:420px">Focus decoy</button><h3 id="focus-result">No focus click</h3>
<script>
window.nativeFixtureInputs = [];
window.nativeFixturePaint = {epoch:performance.timeOrigin, scheduledAt:null, first:null, second:null};
for (const type of ['mousedown', 'mouseup', 'click']) document.addEventListener(type, event => {
  const target = event.target;
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  window.nativeFixtureInputs.push({type, trusted:event.isTrusted, button:event.button,
    name:target.getAttribute('aria-label') || target.id || target.tagName,
    x:event.clientX, y:event.clientY, hit:hit?.getAttribute('aria-label') || hit?.id || hit?.tagName});
}, true);
document.querySelector('#focus-target').addEventListener('click', () => { document.querySelector('#focus-result').textContent = 'Moved target clicked'; });
document.querySelector('#focus-decoy').addEventListener('click', () => { document.querySelector('#focus-result').textContent = 'Decoy clicked'; });
document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault(); document.querySelector('#status').textContent = 'Submitted:' + document.querySelector('input').value;
});
document.querySelector('#edit').addEventListener('dblclick', () => { document.querySelector('#status').textContent = 'Editing'; });
document.querySelector('input').addEventListener('input', event => { document.querySelector('#events').textContent = 'Input:' + event.target.value; });
document.querySelector('textarea').addEventListener('input', event => { document.querySelector('#events').textContent = 'Reason:' + event.target.value; });
document.querySelector('input').addEventListener('keydown', event => { document.querySelector('#events').textContent = 'Key:' + event.key + ':' + event.target.value; });
</script>`
async function main() {
let escapedRequests = 0
let foreignRequests = 0
const foreign = createServer((_request, response) => { foreignRequests += 1; response.end('Foreign origin') })
await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve))
const outside = `http://127.0.0.1:${foreign.address().port}`
const server = createServer((request, response) => {
  if (request.url === '/redirect-away') { response.writeHead(302, { location: outside + '/redirect' }); response.end(); return }
  if (request.url === '/outside') escapedRequests += 1
  if (request.url === '/?redirect=outside' || request.url === '/business?redirect=outside') {
    response.writeHead(302, { location: '/outside' })
    response.end()
    return
  }
  response.setHeader('content-type', 'text/html')
  response.end(html(outside))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const url = `http://127.0.0.1:${address.port}/`
const window = new BrowserWindow({ show: false, webPreferences: {
  sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
} })
const contents = window.webContents
let traceNavigation = false
const navigationEvents = []
const trace = (event, details = {}) => {
  if (!traceNavigation) return
  const entry = { event, ...details }
  navigationEvents.push(entry)
  console.log('NATIVE_NAVIGATION_EVENT:' + JSON.stringify(entry))
}
const navigationPath = value => URL.canParse(value) ? new URL(value).pathname : 'unparsed'
contents.on('did-start-navigation', (_event, value, inPlace, mainFrame) => {
  trace('did-start-navigation', { path: navigationPath(value), inPlace, mainFrame })
})
contents.on('did-finish-load', () => trace('did-finish-load'))
contents.on('did-frame-finish-load', (_event, mainFrame, processId, routingId) => {
  trace('did-frame-finish-load', { mainFrame, processId, routingId })
})
contents.on('did-stop-loading', () => trace('did-stop-loading'))
contents.on('did-fail-load', (_event, errorCode, _description, value, mainFrame) => {
  trace('did-fail-load', { errorCode, path: navigationPath(value), mainFrame })
})
contents.on('will-frame-navigate', event => trace('will-frame-navigate', { path: navigationPath(event.url), mainFrame: event.isMainFrame }))
contents.on('will-redirect', (_event, value, inPlace, mainFrame) => {
  trace('will-redirect', { path: navigationPath(value), inPlace, mainFrame })
})
const stage = async (name, work) => {
  console.log('NATIVE_STAGE_START:' + name)
  let timer
  try {
    const result = await Promise.race([
      work(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('native stage deadline: ' + JSON.stringify({
          stage: name, path: navigationPath(contents.getURL()), loading: contents.isLoading(),
          escapedRequests, foreignRequests, navigationEvents,
        }))), 5000)
      }),
    ])
    console.log('NATIVE_STAGE_END:' + name)
    return result
  } finally { clearTimeout(timer) }
}
const eventTicket = event => {
  let listener
  const promise = new Promise(resolve => { listener = resolve; contents.once(event, listener) })
  return { promise, cancel: () => contents.removeListener(event, listener) }
}
const domInputFacts = async (label, element) => {
  const dom = await contents.executeJavaScript(`(() => {
    const point = ${JSON.stringify({ x: undefined, y: undefined })};
    point.x = ${JSON.stringify(element.x)}; point.y = ${JSON.stringify(element.y)};
    const hit = document.elementFromPoint(point.x, point.y);
    const element = document.querySelector('[aria-label=' + ${JSON.stringify(JSON.stringify(element.name))} + ']');
    const rect = value => ({x:value.x,y:value.y,width:value.width,height:value.height});
    return {expected:${JSON.stringify(element.name)},point,hit:hit?.getAttribute('aria-label') || hit?.id || hit?.tagName,
      rect:element ? rect(element.getBoundingClientRect()) : null,
      fragments:element ? Array.from(element.getClientRects(),rect) : [],
      focused:document.hasFocus(),readyState:document.readyState,
      viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY,devicePixelRatio},
      activeElement:document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName,
      inputs:window.nativeFixtureInputs || []};
  })()`, false)
  console.log('NATIVE_DOM_INPUT_FACTS:' + JSON.stringify({
    label, windowFocused: window.isFocused(), contentsFocused: contents.isFocused(), visible: window.isVisible(),
    bounds: window.getContentBounds(), ...dom,
  }))
}
const clickAndWait = async (name, item, generation, event) => {
  await stage('dom-before-' + name, () => domInputFacts('before-' + name, item))
  const ticket = eventTicket(event)
  try {
    assert.equal((await stage('click-' + name, () => send({ kind: 'click', ref: item.ref, generation }))).ok, true)
    await stage('navigation-' + name, () => ticket.promise)
    await stage('dom-after-' + name, () => domInputFacts('after-' + name, item))
  } catch (error) {
    await stage('dom-failure-' + name, () => domInputFacts('failure-' + name, item))
    throw error
  } finally { ticket.cancel() }
}
const registry = new HostTargetRegistry()
const epoch = registry.connectHost()
const sessionId = SessionId('native-controls-session')
const target = new LeasedGuestTarget('native-controls', epoch, () => contents, () => true, `session:${sessionId}`, window)
registry.register(target)
const sender = installDesktopBrowserAutomation(async message => {
  const result = await runCommand(message.command, { currentEpoch: registry.currentEpoch(), target: registry.resolve(message.command.target) })
  sender.accept({ type: 'browser-command-result', requestId: message.requestId, result })
})
const ctx = new Context()
await ctx.plugin(SessionStore)
ctx.sessions.create(sessionId)
ctx.provide('workspaceRegistry', { list: () => [] })
let control
await ctx.plugin(HostBrowserControl, { bridge: sender, send: async message => {
  control.accept({ type: 'browser-binding-result', result: registry.bind(message.request) })
} })
control = ctx.desktopBrowserControl
const releasePublication = registry.subscribe(state => control.accept({ type: 'browser-control-state', state }))
contents.on('did-navigate', () => registry.changed())
contents.on('did-navigate-in-page', () => registry.changed())
const send = body => control.submit(sessionId, body)
const observe = async () => {
  const result = await send({ kind: 'observe' })
  assert.equal(result.ok, true)
  assert.ok(result.observation)
  return result.observation
}
const until = async predicate => {
  let last
  for (let index = 0; index < 100; index += 1) {
    const page = await observe()
    last = page
    if (predicate(page)) return page
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('native page effect did not become observable: ' + JSON.stringify(last))
}
// Fault injection owns its window and broker; focusability changes must not reach the ordinary navigation owner.
const withIsolatedTarget = async (name, work) => {
  const isolatedWindow = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } })
  const isolatedContents = isolatedWindow.webContents
  const isolatedRegistry = new HostTargetRegistry()
  const isolatedEpoch = isolatedRegistry.connectHost()
  const isolatedSessionId = SessionId('native-controls-' + name)
  const isolatedTarget = new LeasedGuestTarget('native-controls-' + name, isolatedEpoch, () => isolatedContents,
    () => true, `session:${isolatedSessionId}`, isolatedWindow)
  isolatedRegistry.register(isolatedTarget)
  const isolatedCtx = new Context()
  let isolatedSender
  let releaseIsolatedPublication = () => {}
  try {
    await isolatedContents.loadURL(url)
    isolatedSender = installDesktopBrowserAutomation(async message => {
      const result = await runCommand(message.command, {
        currentEpoch: isolatedRegistry.currentEpoch(), target: isolatedRegistry.resolve(message.command.target),
      })
      isolatedSender.accept({ type: 'browser-command-result', requestId: message.requestId, result })
    })
    await isolatedCtx.plugin(SessionStore)
    isolatedCtx.sessions.create(isolatedSessionId)
    isolatedCtx.provide('workspaceRegistry', { list: () => [] })
    let isolatedControl
    await isolatedCtx.plugin(HostBrowserControl, { bridge: isolatedSender, send: async message => {
      isolatedControl.accept({ type: 'browser-binding-result', result: isolatedRegistry.bind(message.request) })
    } })
    isolatedControl = isolatedCtx.desktopBrowserControl
    releaseIsolatedPublication = isolatedRegistry.subscribe(state => isolatedControl.accept({ type: 'browser-control-state', state }))
    isolatedContents.on('did-navigate', () => isolatedRegistry.changed())
    isolatedContents.on('did-navigate-in-page', () => isolatedRegistry.changed())
    await isolatedControl.bind(isolatedSessionId, isolatedTarget.id)
    assert.equal(isolatedTarget.authorizedSession(), isolatedSessionId)
    const isolatedSend = body => isolatedControl.submit(isolatedSessionId, body)
    const isolatedObserve = async () => {
      const result = await isolatedSend({ kind: 'observe' })
      assert.equal(result.ok, true)
      assert.ok(result.observation)
      return result.observation
    }
    const focus = async () => {
      isolatedWindow.show()
      isolatedWindow.focus()
      isolatedContents.focus()
      await stage('isolated-' + name + '-focus', async () => {
        while (!isolatedWindow.isFocused() || !isolatedContents.isFocused()) await new Promise(resolve => setTimeout(resolve, 10))
      })
    }
    await focus()
    await work({ window: isolatedWindow, contents: isolatedContents, send: isolatedSend, observe: isolatedObserve, focus })
  } finally {
    releaseIsolatedPublication()
    isolatedTarget.revoke()
    try { await isolatedCtx.fiber.dispose() }
    finally {
      isolatedSender?.dispose()
      isolatedWindow.destroy()
      console.log('NATIVE_ISOLATED_TARGET_DISPOSED:' + name)
    }
  }
}
try {
  await contents.loadURL(url)
  assert.equal((await send({ kind: 'observe' })).reason, 'session-not-authorized')
  await control.bind(sessionId, target.id)
  assert.equal(target.authorizedSession(), sessionId)
  window.show()
  window.focus()
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('native window did not focus')), 5000)
    const ready = () => { if (window.isFocused()) { clearTimeout(deadline); resolve() } else setTimeout(ready, 10) }; ready()
  })
  assert.equal(window.isFocused(), true, 'native input requires a focused containing window')
  let page = await observe()
  const input = page.elements.find(element => element.name === 'Task')
  assert.ok(input)
  assert.equal((await send({ kind: 'type', ref: input.ref, generation: page.generation, text: 'native-task' })).ok, true)
  page = await observe()
  assert.equal((await send({ kind: 'press-key', ref: input.ref, generation: page.generation, key: 'Enter' })).ok, true)
  page = await until(value => value.elements.some(element => element.role === 'heading' && element.name === 'Submitted:native-task'))
  window.hide()
  assert.equal(window.isVisible(), false)
  const background = await send({ kind: 'type', ref: input.ref, generation: page.generation, text: '-background' })
  if (background.ok) {
    page = await until(value => value.elements.some(element => element.name === 'Input:native-task-background'))
    console.log('NATIVE_BACKGROUND_INPUT_OK: owning window restored and actual field changed')
  } else {
    assert.equal(background.outcome, 'not-executed')
    assert.equal(background.reason, 'action-failed')
    assert.equal(await contents.executeJavaScript("document.querySelector('input').value", false), 'native-task')
    console.log('NATIVE_BACKGROUND_INPUT_NOT_STARTED: unavailable focus refused without changing field')
  }
  await withIsolatedTarget('unfocusable', async isolated => {
    let isolatedPage = await isolated.observe()
    const isolatedInput = isolatedPage.elements.find(element => element.name === 'Task')
    assert.ok(isolatedInput)
    assert.equal((await isolated.send({ kind: 'type', ref: isolatedInput.ref, generation: isolatedPage.generation,
      text: 'independent-native-field' })).ok, true)
    const beforeDenied = await isolated.contents.executeJavaScript("document.querySelector('input').value", false)
    assert.equal(beforeDenied, 'independent-native-field')
    isolatedPage = await isolated.observe()
    isolated.window.setFocusable(false)
    isolated.window.hide()
    isolated.window.blur()
    const denied = await isolated.send({ kind: 'type', ref: isolatedInput.ref, generation: isolatedPage.generation, text: '-must-not-arrive' })
    assert.equal(denied.ok, false)
    assert.equal(denied.outcome, 'not-executed')
    assert.equal(denied.reason, 'action-failed')
    assert.equal(await isolated.contents.executeJavaScript("document.querySelector('input').value", false), beforeDenied)
    console.log('NATIVE_UNFOCUSABLE_INPUT_NOT_STARTED: isolated native field unchanged')
  })
  window.show()
  window.focus()
  contents.focus()
  page = await observe()
  const reason = page.elements.find(element => element.name === 'Reason')
  assert.ok(reason)
  const multiline = '第一行\nSecond line 2026-10-01'
  assert.equal((await send({ kind: 'type', ref: reason.ref, generation: page.generation, text: multiline })).ok, true)
  page = await until(value => value.elements.some(element => element.name === 'Reason:' + multiline))
  console.log('NATIVE_MULTILINE_INPUT_OK: Chinese first line and second line preserved')
  const capture = await send({ kind: 'screenshot', format: 'png' })
  console.log('NATIVE_STAGE:screenshot-settled')
  assert.equal(capture.ok, true)
  assert.ok(capture.screenshot instanceof Uint8Array)
  assert.deepEqual(Array.from(capture.screenshot.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])
  window.hide()
  await contents.executeJavaScript(`window.addEventListener('focus', () => {
    document.querySelector('#focus-target').style.left = '450px';
    document.querySelector('#focus-decoy').style.display = 'block';
  }, {once:true})`, false)
  page = await observe()
  const focusTarget = page.elements.find(element => element.name === 'Focus moves target')
  assert.ok(focusTarget)
  assert.equal((await send({ kind: 'click', ref: focusTarget.ref, generation: page.generation })).ok, true)
  page = await until(value => value.elements.some(element => element.name === 'Moved target clicked'))
  assert.equal(page.elements.some(element => element.name === 'Decoy clicked'), false)
  console.log('NATIVE_FOCUS_LAYOUT_REVALIDATED: moved target clicked and old-coordinate decoy untouched')
  const beforeFocusLoss = await contents.executeJavaScript("document.querySelector('input').value", false)
  const revalidate = target.revalidate.bind(target)
  let validations = 0
  target.revalidate = async ref => {
    const at = await revalidate(ref)
    if (++validations === 2) window.hide()
    return at
  }
  try {
    const lostFocus = await send({ kind: 'type', ref: input.ref, generation: page.generation, text: '-after-blur' })
    assert.equal(lostFocus.ok, false)
    assert.equal(lostFocus.outcome, 'not-executed')
    assert.equal(lostFocus.reason, 'action-failed')
    assert.equal(await contents.executeJavaScript("document.querySelector('input').value", false), beforeFocusLoss)
    console.log('NATIVE_POST_REVALIDATION_FOCUS_LOSS_NOT_STARTED: native field unchanged')
  } finally {
    target.revalidate = revalidate
    window.show()
    window.focus()
  }
  page = await observe()
  const edit = page.elements.find(element => element.name === 'Edit')
  assert.ok(edit)
  assert.equal((await send({ kind: 'double-click', ref: edit.ref, generation: page.generation })).ok, true)
  page = await until(value => value.elements.some(element => element.role === 'heading' && element.name === 'Editing'))
  console.log('NATIVE_STAGE:double-click-observed')
  for (const destination of ['https://example.invalid/', url + 'other', 'javascript:alert(1)']) {
    assert.equal((await send({ kind: 'navigate', generation: page.generation, url: destination })).reason, 'navigation-denied')
    assert.equal(contents.getURL(), url)
  }
  assert.equal((await send({ kind: 'press-key', ref: input.ref, generation: page.generation, key: 'F12' })).reason, 'unknown-operation')
  assert.equal((await send({ kind: 'navigate', generation: page.generation, url: url + '?filter=active#active' })).ok, true)
  assert.equal((await send({ kind: 'reload', generation: page.generation })).reason, 'stale-observation')
  page = await until(value => value.url === url + '?filter=active#active')
  const loaded = new Promise(resolve => contents.once('did-finish-load', resolve))
  assert.equal((await send({ kind: 'reload', generation: page.generation })).ok, true)
  assert.equal((await send({ kind: 'reload', generation: page.generation })).reason, 'stale-observation')
  assert.equal((await send({ kind: 'double-click', ref: edit.ref, generation: page.generation })).reason, 'stale-observation')
  await loaded
  console.log('NATIVE_STAGE:reload-loaded')
  traceNavigation = true
  page = await stage('reload-observe', observe)
  assert.ok(page.generation > 1)
  const samePage = page.elements.find(element => element.name === 'Same-page link')
  assert.ok(samePage)
  const samePageDestination = new URL(page.url)
  samePageDestination.hash = 'native-positive'
  await clickAndWait('Same-page link', samePage, page.generation, 'did-navigate-in-page')
  page = await stage('same-page-link-observe', observe)
  assert.equal(page.url, samePageDestination.href)
  console.log('NATIVE_SAME_PAGE_LINK_OK: trusted native input navigated within the current page')
  for (const name of ['Foreign click', 'Foreign form']) {
    const item = page.elements.find(element => element.name === name)
    assert.ok(item)
    await clickAndWait(name, item, page.generation, 'will-frame-navigate')
    console.log('NATIVE_STAGE:blocked-' + name)
    page = await stage('observe-after-' + name, observe)
    assert.equal(page.url, samePageDestination.href)
    assert.equal(foreignRequests, 0, name + ' must not reach a second origin')
  }
  const business = page.elements.find(element => element.name === 'Business path')
  assert.ok(business)
  const businessLoaded = eventTicket('did-finish-load')
  try {
    assert.equal((await stage('click-business', () => send({ kind: 'click', ref: business.ref, generation: page.generation }))).ok, true)
    await stage('business-loaded', () => businessLoaded.promise)
  } finally { businessLoaded.cancel() }
  page = await stage('business-observe', observe)
  assert.equal(page.url, url + 'business', 'same-origin business navigation remains available')
  assert.equal(foreignRequests, 0)
  const redirectLink = page.elements.find(element => element.name === 'Foreign redirect')
  assert.ok(redirectLink)
  const redirected = eventTicket('will-redirect')
  try {
    assert.equal((await stage('click-foreign-redirect', () => send({ kind: 'click', ref: redirectLink.ref, generation: page.generation }))).ok, true)
    await stage('foreign-redirect-blocked', () => redirected.promise)
  } finally { redirected.cancel() }
  console.log('NATIVE_STAGE:redirect-blocked')
  assert.equal(foreignRequests, 0, 'server redirect must not reach a second origin')
  assert.notEqual(new URL(contents.getURL()).origin, outside)
  page = await stage('observe-after-foreign-redirect', observe)
  const redirectResult = await stage('scoped-redirect-command', () => send({ kind: 'navigate', generation: page.generation, url: url + 'business?redirect=outside' }))
  console.log('NATIVE_SCOPED_REDIRECT_RESULT:' + JSON.stringify({ ok: redirectResult.ok, outcome: redirectResult.outcome, reason: redirectResult.reason }))
  assert.equal(redirectResult.ok, false)
  assert.equal(redirectResult.outcome, 'unknown')
  assert.equal(escapedRequests, 0, 'a same-page URL cannot escape its navigation scope through a redirect')
  assert.notEqual(contents.getURL(), url + 'outside')
  // The UNKNOWN primary action ends here. A separate owner probes the native visibility fault without replaying it.
  await withIsolatedTarget('hidden-document', async isolated => {
    isolated.window.setFocusable(false)
    isolated.window.hide()
    isolated.window.blur()
    isolated.window.setFocusable(true)
    await isolated.focus()
    const loaded = new Promise(resolve => isolated.contents.once('did-finish-load', resolve))
    isolated.contents.reload()
    await stage('isolated-hidden-document-reload', () => loaded)
    const hidden = await isolated.contents.executeJavaScript('({hidden:document.hidden,visibilityState:document.visibilityState,inputCount:window.nativeFixtureInputs.length})', false)
    console.log('NATIVE_ISOLATED_HIDDEN_VISIBILITY:' + JSON.stringify({ ...hidden, nativeVisible: isolated.window.isVisible(),
      nativeFocused: isolated.window.isFocused(), contentsFocused: isolated.contents.isFocused() }))
    if (!hidden.hidden) {
      assert.equal(hidden.visibilityState, 'visible')
      console.log('NATIVE_CURRENT_HIDDEN_DOCUMENT_UNAVAILABLE: native lifecycle did not produce a hidden document')
      return
    }
    assert.equal(hidden.visibilityState, 'hidden')
    const hiddenPage = await isolated.observe()
    const hiddenLink = hiddenPage.elements.find(element => element.name === 'Same-page link')
    assert.ok(hiddenLink)
    const deniedHidden = await isolated.send({ kind: 'click', ref: hiddenLink.ref, generation: hiddenPage.generation })
    assert.equal(deniedHidden.ok, false)
    assert.equal(deniedHidden.outcome, 'not-executed')
    assert.equal(deniedHidden.reason, 'stale-observation')
    assert.equal(await isolated.contents.executeJavaScript('window.nativeFixtureInputs.length', false), hidden.inputCount)
    console.log('NATIVE_CURRENT_HIDDEN_DOCUMENT_NOT_STARTED: actual hidden document received no native input')
  })
  console.log('FROZEN_ORIGIN_REQUEST_COUNTS:' + JSON.stringify({ foreignRequests, escapedRequests }))
  console.log('NATIVE_BROWSER_CONTROLS_OK: Enter submit, double-click edit, scoped navigation, reload; foreign navigation/key and old references denied')
} finally {
  console.log('NATIVE_STAGE_START:cleanup')
  releasePublication()
  await ctx.fiber.dispose()
  sender.dispose()
  window.destroy()
  server.closeAllConnections()
  foreign.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await new Promise(resolve => foreign.close(resolve))
  console.log('NATIVE_STAGE_END:cleanup')
}
}
app.whenReady().then(main).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
