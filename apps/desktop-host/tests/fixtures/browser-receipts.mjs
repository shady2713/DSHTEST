/** Observe the production submit method without changing its authorization or dispatch. */
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'

const canonical = value => JSON.stringify(value, (_key, item) => item !== null && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const commands = {
  web_browser_observe: 'observe', web_browser_screenshot: 'screenshot',
  web_browser_click: 'click', web_browser_type: 'type', web_browser_double_click: 'double-click',
  web_browser_press_key: 'press-key', web_browser_navigate: 'navigate', web_browser_reload: 'reload',
}

/** @param control - The same installed service used by the provider. @returns owned correlation and disposer. */
export function observeBrowserReceipts(control) {
  const active = new AsyncLocalStorage()
  const original = control.submit
  const previous = Object.getOwnPropertyDescriptor(control, 'submit')
  assert.equal(typeof original, 'function')
  if (previous && (!('value' in previous) || !previous.configurable)) throw new Error('submit observer requires a replaceable method')
  let disposed = false
  function submit(sessionId, body, signal) {
    const scope = active.getStore()
    if (!scope) return Reflect.apply(original, this, [sessionId, body, signal])
    assert.equal(disposed, false, 'receipt observer disposed')
    assert.equal(scope.closed, false, 'receipt scope closed')
    scope.signal.throwIfAborted()
    assert.equal(sessionId, scope.sessionId, 'submit Session must match actual tool caller')
    assert.equal(canonical(body), canonical(scope.expectedBody), 'submit body must match actual tool arguments')
    assert.equal(scope.started, false, 'one actual tool may submit only one browser command')
    scope.started = true
    // Keep the provider signal: SessionResources may link it to provider retirement.
    return Promise.resolve(Reflect.apply(original, this, [sessionId, body, signal])).then(result => {
      scope.reply = result
      scope.late = scope.closed || disposed || scope.signal.aborted
      return result
    })
  }
  Object.defineProperty(control, 'submit', {value: submit, configurable: true, writable: true, enumerable: previous?.enumerable ?? false})
  return {
    async run(exec, operationId, binding, parametersHash, next) {
      assert.equal(typeof exec.token, 'symbol', 'actual ToolRuntime execution token required')
      assert.ok(exec.signal instanceof AbortSignal, 'actual ToolRuntime execution signal required')
      exec.signal.throwIfAborted()
      assert.ok(exec.agent)
      const kind = commands[exec.name]
      assert.ok(kind, 'only a registered browser tool may correlate a receipt')
      const expectedBody = kind === 'screenshot' ? {kind, format: 'png'} : {kind, ...exec.arguments}
      const scope = {token: exec.token, signal: exec.signal, callId: exec.callId, sessionId: exec.agent.session.id,
        operationId: operationId ?? null, target: binding.target, hostEpoch: binding.hostEpoch,
        parametersHash, expectedBody, started: false, closed: false, reply: undefined, late: false}
      try {
        const result = await active.run(scope, next)
        return {result, receipt: disposed ? undefined : receipt(scope)}
      } finally { scope.closed = true }
    },
    dispose() {
      disposed = true
      if (Object.getOwnPropertyDescriptor(control, 'submit')?.value !== submit) return
      if (previous) Object.defineProperty(control, 'submit', previous)
      else delete control.submit
    },
  }
}

function receipt(scope) {
  const reply = scope.reply
  if (!reply || scope.late || scope.signal.aborted) return undefined
  assert.equal(Number.isSafeInteger(reply.requestId) && reply.requestId > 0, true, 'real Host requestId required')
  assert.equal(typeof reply.ok, 'boolean')
  if (reply.observation) {
    assert.equal(reply.observation.target, scope.target)
    assert.equal(reply.observation.hostEpoch, scope.hostEpoch)
  }
  return {callId: scope.callId, operationId: scope.operationId, sessionId: scope.sessionId,
    requestId: reply.requestId, target: scope.target, hostEpoch: scope.hostEpoch,
    parametersHash: scope.parametersHash, ok: reply.ok,
    ...reply.ok ? {outcome: 'executed', observationGeneration: reply.observation?.generation ?? null}
      : {outcome: reply.outcome, reason: reply.reason}}
}

/** Keep failure true and project the same actual receipt into model content and the durable metadata. */
export function withBrowserFailureReceipt(result, receipt) {
  if (!result.isError || !receipt) return result
  const guidance = receipt.ok ? 'EXECUTED: Main accepted the command, but the tool failed afterwards. Do not repeat it.'
    : receipt.outcome === 'not-executed' ? 'NOT_EXECUTED: The command was confirmed not executed. Observe again before proposing a new intent.'
      : 'UNKNOWN: The command outcome is unknown. Stop; do not repeat it.'
  const priorMeta=result.meta
  const metadata=priorMeta!==null&&typeof priorMeta==='object'&&!Array.isArray(priorMeta)?priorMeta
    : priorMeta===undefined?{}:{priorMeta}
  return {...result, content: [...result.content, {type: 'text', text: `${guidance}\n${JSON.stringify({browserCommand: receipt})}`}],
    meta: {...metadata, browserCommand: receipt}}
}
