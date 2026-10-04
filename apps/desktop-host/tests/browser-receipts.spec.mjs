import assert from 'node:assert/strict'
import { test } from 'node:test'
import { observeBrowserReceipts, withBrowserFailureReceipt } from './fixtures/browser-receipts.mjs'

const signal = new AbortController().signal
const execution = (callId, generation) => ({token: Symbol(callId), callId, name: 'web_browser_click',
  agent: {session: {id: 'owned-session'}}, arguments: {generation, ref: 'e1'}, signal})
const binding = {target: 'owned-target', hostEpoch: 4}
const failed = {isError: true, content: [{type: 'text', text: 'tool failure'}], error: {message: 'kept'}}

test('preserves the real guarded method, this, body, signal and paired non-execution', async () => {
  let calls = 0
  const control = {guarded: true, async submit(session, body, linkedSignal) {
    assert.equal(this, control); assert.equal(this.guarded, true)
    assert.equal(session, 'owned-session'); assert.deepEqual(body, {kind: 'click', generation: 9, ref: 'e1'})
    assert.equal(linkedSignal, signal); calls++
    return {version: 1, requestId: 72, ok: false, outcome: 'not-executed', reason: 'stale-observation'}
  }}
  const original = control.submit, observer = observeBrowserReceipts(control), exec = execution('call-a', 9)
  const observed = await observer.run(exec, 'run:call-a', binding, 'args-hash', async () => {
    await control.submit(exec.agent.session.id, {kind: 'click', ...exec.arguments}, signal)
    return failed
  })
  assert.equal(calls, 1); assert.equal(observed.receipt.requestId, 72)
  assert.equal(observed.receipt.callId, 'call-a'); assert.equal(observed.receipt.outcome, 'not-executed')
  const projected = withBrowserFailureReceipt(observed.result, observed.receipt)
  assert.equal(projected.isError, true); assert.equal(projected.error, failed.error)
  assert.deepEqual(projected.meta.browserCommand, observed.receipt)
  assert.equal(projected.content[1].text.includes('"requestId":72'), true)
  observer.dispose(); assert.equal(control.submit, original)
})

test('concurrent actual call scopes retain independent request IDs', async () => {
  const replies = [Promise.withResolvers(), Promise.withResolvers()]
  const started = Promise.withResolvers()
  let pending = 0
  const control = {async submit(_session, body) {
    if (++pending === 2) started.resolve()
    return replies[body.generation - 1].promise
  }}
  const observer = observeBrowserReceipts(control)
  const running = Promise.all([1, 2].map(generation => {
    const exec = execution(`call-${generation}`, generation)
    return observer.run(exec, `run:${exec.callId}`, binding, 'hash', async () => {
      await control.submit('owned-session', {kind: 'click', ...exec.arguments}, signal)
      return failed
    })
  }))
  await started.promise
  replies[1].resolve({requestId: 2, ok: false, outcome: 'unknown', reason: 'connection-lost'})
  replies[0].resolve({requestId: 1, ok: false, outcome: 'unknown', reason: 'connection-lost'})
  const results = await running
  assert.deepEqual(results.map(item => [item.receipt.callId, item.receipt.requestId]), [['call-1', 1], ['call-2', 2]])
  assert.equal(withBrowserFailureReceipt(failed, results[0].receipt).content[1].text.includes('Stop; do not repeat'), true)
  observer.dispose()
})

test('a reply after tool scope completion cannot supply a receipt', async (t) => {
  const reply = Promise.withResolvers()
  const control = {submit() {return reply.promise}}
  const observer = observeBrowserReceipts(control)
  t.after(() => observer.dispose())
  let pending
  const observed = await observer.run(execution('late-call', 1), 'op', binding, 'hash', async () => {
    pending = control.submit('owned-session', {kind: 'click', generation: 1, ref: 'e1'}, signal)
    return failed
  })
  assert.equal(observed.receipt, undefined)
  reply.resolve({requestId: 18, ok: false, outcome: 'not-executed', reason: 'revoked'})
  await pending
  assert.equal(observed.receipt, undefined)
  assert.equal(withBrowserFailureReceipt(observed.result, observed.receipt), failed)
})

test('a disposed observer restores submit and excludes an in-flight reply', async (t) => {
  const reply = Promise.withResolvers(), started = Promise.withResolvers()
  const control = {submit() {started.resolve(); return reply.promise}}
  const original = control.submit, observer = observeBrowserReceipts(control)
  t.after(() => observer.dispose())
  const running = observer.run(execution('disposed-call', 1), 'op', binding, 'hash', async () => {
    await control.submit('owned-session', {kind: 'click', generation: 1, ref: 'e1'}, signal)
    return failed
  })
  await started.promise
  observer.dispose()
  assert.equal(control.submit, original)
  reply.resolve({requestId: 19, ok: false, outcome: 'unknown', reason: 'connection-lost'})
  assert.equal((await running).receipt, undefined)
})

test('a callback inherited from a completed tool scope refuses a later submit', async (t) => {
  const proceed = Promise.withResolvers()
  let calls = 0, pending
  const control = {submit() {calls++; return Promise.resolve({requestId: 20, ok: true})}}
  const observer = observeBrowserReceipts(control)
  t.after(() => observer.dispose())
  await observer.run(execution('closed-call', 1), 'op', binding, 'hash', async () => {
    pending = proceed.promise.then(() => control.submit('owned-session', {kind: 'click', generation: 1, ref: 'e1'}, signal))
    return failed
  })
  proceed.resolve()
  await assert.rejects(pending, /receipt scope closed/)
  assert.equal(calls, 0)
})

test('an accepted actual submit followed by tool failure remains an error without another submit', async (t) => {
  let calls = 0
  const control = {async submit() {calls++; return {requestId: 21, ok: true}}}
  const observer = observeBrowserReceipts(control)
  t.after(() => observer.dispose())
  const observed = await observer.run(execution('accepted-call', 1), 'op', binding, 'hash', async () => {
    await control.submit('owned-session', {kind: 'click', generation: 1, ref: 'e1'}, signal)
    return failed
  })
  const projected = withBrowserFailureReceipt(observed.result, observed.receipt)
  assert.equal(calls, 1)
  assert.equal(projected.isError, true)
  assert.equal(projected.error, failed.error)
  assert.equal(projected.meta.browserCommand.outcome, 'executed')
  assert.match(projected.content[1].text, /^EXECUTED: .*Do not repeat it\./)
})

test('failure projection preserves primitive metadata without inferring receipts from text', () => {
  const receipt = {callId: 'actual-call', requestId: 22, ok: false, outcome: 'unknown'}
  for (const meta of [null, false, 0, 'original', ['original']]) {
    const result = {...failed, meta}
    const projected = withBrowserFailureReceipt(result, receipt)
    assert.equal(projected.meta.priorMeta, meta)
    assert.equal(projected.meta.browserCommand, receipt)
    assert.equal(projected.isError, true)
  }
  const result = {...failed, content: [{type: 'text', text: 'not-executed requestId=22'}]}
  assert.equal(withBrowserFailureReceipt(result, undefined), result)
})

test('an execution cancelled before its scope cannot invoke the operation', async (t) => {
  const controller = new AbortController()
  controller.abort(new Error('execution already cancelled'))
  let calls = 0
  const control = {async submit() {calls++; return {requestId: 23, ok: true}}}
  const observer = observeBrowserReceipts(control)
  t.after(() => observer.dispose())
  await assert.rejects(observer.run({...execution('cancelled-call', 1), signal: controller.signal}, 'op', binding, 'hash', async () => {
    await control.submit('owned-session', {kind: 'click', generation: 1, ref: 'e1'}, signal)
    return failed
  }), /execution already cancelled/)
  assert.equal(calls, 0)
})

test('cancelling an execution with a pending reply preserves transport output without a receipt', async (t) => {
  const controller = new AbortController()
  const reply = Promise.withResolvers(), started = Promise.withResolvers()
  const control = {submit(_session, _body, actualSignal) {
    assert.equal(actualSignal, signal)
    started.resolve()
    return reply.promise
  }}
  const observer = observeBrowserReceipts(control)
  t.after(() => observer.dispose())
  const actualReply = {requestId: 24, ok: false, outcome: 'not-executed', reason: 'revoked'}
  const running = observer.run({...execution('abort-pending-call', 1), signal: controller.signal}, 'op', binding, 'hash', async () => {
    const result = await control.submit('owned-session', {kind: 'click', generation: 1, ref: 'e1'}, signal)
    assert.equal(result, actualReply)
    return failed
  })
  await started.promise
  controller.abort()
  reply.resolve(actualReply)
  const observed = await running
  assert.equal(observed.receipt, undefined)
  assert.equal(withBrowserFailureReceipt(observed.result, observed.receipt), failed)
})

test('cancelling after the reply and before the tool returns excludes the captured receipt', async (t) => {
  const controller = new AbortController()
  const control = {async submit() {return {requestId: 25, ok: false, outcome: 'not-executed', reason: 'revoked'}}}
  const observer = observeBrowserReceipts(control)
  t.after(() => observer.dispose())
  const observed = await observer.run({...execution('abort-after-reply-call', 1), signal: controller.signal}, 'op', binding, 'hash', async () => {
    await control.submit('owned-session', {kind: 'click', generation: 1, ref: 'e1'}, signal)
    controller.abort()
    return failed
  })
  assert.equal(observed.receipt, undefined)
  assert.equal(withBrowserFailureReceipt(observed.result, observed.receipt), failed)
})

test('disposing after the reply and before tool post-processing returns excludes the captured receipt', async (t) => {
  const replied = Promise.withResolvers(), finish = Promise.withResolvers()
  const control = {async submit() {return {requestId: 26, ok: false, outcome: 'not-executed', reason: 'revoked'}}}
  const observer = observeBrowserReceipts(control)
  t.after(() => observer.dispose())
  const running = observer.run(execution('dispose-after-reply-call', 1), 'op', binding, 'hash', async () => {
    await control.submit('owned-session', {kind: 'click', generation: 1, ref: 'e1'}, signal)
    replied.resolve()
    await finish.promise
    return failed
  })
  await replied.promise
  observer.dispose()
  finish.resolve()
  const observed = await running
  assert.equal(observed.receipt, undefined)
  assert.equal(withBrowserFailureReceipt(observed.result, observed.receipt), failed)
})

test('cancelling while the operation waits before submit prevents transport dispatch', async (t) => {
  const controller = new AbortController()
  const waiting = Promise.withResolvers(), proceed = Promise.withResolvers()
  let calls = 0
  const control = {async submit() {calls++; return {requestId: 27, ok: true}}}
  const observer = observeBrowserReceipts(control)
  t.after(() => observer.dispose())
  const running = observer.run({...execution('abort-before-submit-call', 1), signal: controller.signal}, 'op', binding, 'hash', async () => {
    waiting.resolve()
    await proceed.promise
    await control.submit('owned-session', {kind: 'click', generation: 1, ref: 'e1'}, signal)
    return failed
  })
  await waiting.promise
  controller.abort(new Error('execution cancelled before submit'))
  proceed.resolve()
  await assert.rejects(running, /execution cancelled before submit/)
  assert.equal(calls, 0)
})

test('combined execution cancellation and observer disposal exclude a pending reply', async (t) => {
  const controller = new AbortController()
  const started = Promise.withResolvers(), reply = Promise.withResolvers()
  const control = {submit() {started.resolve(); return reply.promise}}
  const observer = observeBrowserReceipts(control)
  t.after(() => observer.dispose())
  const running = observer.run({...execution('cancel-dispose-call', 1), signal: controller.signal}, 'op', binding, 'hash', async () => {
    await control.submit('owned-session', {kind: 'click', generation: 1, ref: 'e1'}, signal)
    return failed
  })
  await started.promise
  controller.abort()
  observer.dispose()
  reply.resolve({requestId: 28, ok: false, outcome: 'not-executed', reason: 'revoked'})
  const observed = await running
  assert.equal(observed.receipt, undefined)
  assert.equal(withBrowserFailureReceipt(observed.result, observed.receipt), failed)
})

test('refuses mismatched sessions, bodies, duplicate submits and absent real execution token before dispatch', async () => {
  let dispatched = 0
  const control = {async submit() {dispatched++; return {requestId: 1, ok: true}}}
  const observer = observeBrowserReceipts(control), exec = execution('call-a', 1)
  await assert.rejects(observer.run(exec, 'op', binding, 'hash', () => control.submit('foreign-session', {kind: 'click', ...exec.arguments}, signal)))
  await assert.rejects(observer.run(exec, 'op', binding, 'hash', () => control.submit('owned-session', {kind: 'click', generation: 99, ref: 'e1'}, signal)))
  assert.equal(dispatched, 0)
  await assert.rejects(observer.run({...exec, token: 'forged'}, 'op', binding, 'hash', () => Promise.resolve(failed)))
  await assert.rejects(observer.run(exec, 'op', binding, 'hash', async () => {
    await control.submit('owned-session', {kind: 'click', ...exec.arguments}, signal)
    return control.submit('owned-session', {kind: 'click', ...exec.arguments}, signal)
  }))
  assert.equal(dispatched, 1); observer.dispose()
})

test('missing replies never become non-execution, success metadata remains exact', async () => {
  const control = {async submit() {throw new Error('lost before correlated reply')}}
  const observer = observeBrowserReceipts(control), exec = execution('call-a', 1)
  const observed = await observer.run(exec, 'op', binding, 'hash', async () => {
    try {await control.submit('owned-session', {kind: 'click', ...exec.arguments}, signal)} catch (_lostReply) {return failed}
  })
  assert.equal(observed.receipt, undefined); assert.equal(withBrowserFailureReceipt(failed, observed.receipt), failed)
  const success = {isError: false, content: [], meta: {image: {attachmentId: 'exact-ref'}}}
  assert.equal(withBrowserFailureReceipt(success, {requestId: 1, ok: true}), success)
  observer.dispose()
})
