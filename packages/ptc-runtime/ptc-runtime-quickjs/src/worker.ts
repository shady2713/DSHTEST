/** Internal Worker-only QuickJS owner; no Node capability is installed in the guest. */
import { parentPort, workerData } from 'node:worker_threads'
import { stripTypeScriptTypes } from 'node:module'
import { getQuickJS } from 'quickjs-emscripten'
import type { QuickJSDeferredPromise, QuickJSHandle } from 'quickjs-emscripten'
import type { PtcRunFailure } from '@deepseek-ai/dsh-ptc-runtime'
import { GUEST_CODEC, parseHostReply, parseWorkerInput, decodeJson } from './protocol.ts'
import type { HostReply, WorkerInput, WorkerMessage } from './protocol.ts'

if (!parentPort) throw new Error('QuickJS entry requires its owning Worker')
const port = parentPort
async function execute(input: WorkerInput): Promise<void> {
  const module = await getQuickJS()
  const runtime = module.newRuntime()
  runtime.setMemoryLimit(input.config.memoryLimitBytes)
  runtime.setMaxStackSize(input.config.maxStackBytes)
  runtime.setInterruptHandler(() => Date.now() >= input.deadline)
  const ctx = runtime.newContext()
  const pending = new Map<number, { promise: QuickJSDeferredPromise; reject: QuickJSHandle; member: string }>()
  const owned: QuickJSHandle[] = []
  let sequence = 0
  let done = false
  let main: QuickJSHandle | undefined
  let pumpScheduled = false
  let logBytes = 0
  let logMessages = 0
  let outputRejected = false
  function send(message: WorkerMessage): void { port.postMessage(message) }
  function errorText(handle: QuickJSHandle): string { const dumped: unknown = ctx.dump(handle); return typeof dumped === 'object' && dumped !== null && 'message' in dumped ? String(dumped.message) : String(dumped) }
  function finish(error?: PtcRunFailure, json?: string): void {
    if (done) return
    done = true
    send({ kind: 'done', ...(error ? { error } : {}), ...(json === undefined ? {} : { json }) })
    port.removeAllListeners('message')
    for (const call of pending.values()) call.promise.dispose()
    pending.clear()
    main?.dispose()
    for (const handle of owned.reverse()) handle.dispose()
    ctx.dispose()
    runtime.dispose()
    port.close()
  }
  function hold(handle: QuickJSHandle): QuickJSHandle { owned.push(handle); return handle }
  function unwrap(result: ReturnType<typeof ctx.evalCode>): QuickJSHandle {
    if (result.error) { const message = errorText(result.error); result.error.dispose(); throw new Error(message) }
    return result.value
  }
  const codec = hold(unwrap(ctx.evalCode(GUEST_CODEC)))
  const encoder = hold(ctx.getProp(codec, 'encode'))
  const parser = hold(ctx.getProp(codec, 'parse'))
  const formatter = hold(ctx.getProp(codec, 'format'))
  const ordinaryError = hold(ctx.getProp(codec, 'error'))
  const makeError = hold(ctx.getProp(codec, 'makeError'))
  function encode(value: QuickJSHandle): string {
    const result = unwrap(ctx.callFunction(encoder, ctx.undefined, value))
    try { return ctx.getString(result) } finally { result.dispose() }
  }
  function parse(json: string): QuickJSHandle {
    const text = ctx.newString(json)
    try { return unwrap(ctx.callFunction(parser, ctx.undefined, text)) } finally { text.dispose() }
  }
  function schedulePump(): void {
    if (done || pumpScheduled) return
    pumpScheduled = true
    setImmediate(() => { pumpScheduled = false; pump() })
  }
  function pump(): void {
    if (done || main === undefined) return
    if (Date.now() >= input.deadline) { finish({ kind: 'timeout', message: 'Execution deadline reached' }); return }
    const jobs = runtime.executePendingJobs(input.config.maxJobsPerTick)
    if (jobs.error) { const message = errorText(jobs.error); jobs.error.dispose(); finish({ kind: 'exception', message }); return }
    const count = jobs.value
    const state = ctx.getPromiseState(main)
    if (state.type === 'fulfilled') {
      let json: string | undefined
      let failure: PtcRunFailure | undefined
      try { json = ctx.typeof(state.value) === 'undefined' ? undefined : encode(state.value) }
      catch (error) { failure = { kind: 'invalid-output', message: error instanceof Error ? error.message : String(error) } }
      finally { state.value.dispose() }
      finish(failure, json)
    } else if (state.type === 'rejected') {
      const message = errorText(state.error)
      state.error.dispose()
      finish({ kind: Date.now() >= input.deadline ? 'timeout' : logBytes > input.config.maxOutputBytes ? 'output-limit' : 'exception', message })
    } else if (count > 0) schedulePump()
  }

  port.on('message', (payload: unknown) => {
    if (done) return
    let reply: HostReply
    try { reply = parseHostReply(payload) }
    catch (error) { finish({ kind: 'protocol', message: error instanceof Error ? error.message : String(error) }); return }
    const call = pending.get(reply.id)
    if (!call) { finish({ kind: 'protocol', message: 'Unknown Host completion' }); return }
    pending.delete(reply.id)
    let value: QuickJSHandle | undefined
    let failure: PtcRunFailure | undefined
    try {
      const wire = reply.json === undefined ? reply.error : reply.json
      if (wire === undefined || Buffer.byteLength(wire) > input.config.maxMessageBytes) throw new Error('Host completion exceeds configured message limit')
      if (reply.error !== undefined) {
        const message = ctx.newString(reply.error), member = ctx.newString(call.member)
        try { value = unwrap(ctx.callFunction(call.reject, ctx.undefined, message, member)) }
        finally { message.dispose(); member.dispose() }
        call.promise.reject(value)
      } else {
        if (reply.json === undefined) throw new Error('Missing Host completion JSON')
        decodeJson(reply.json)
        value = parse(reply.json)
        call.promise.resolve(value)
      }
    } catch (error) { failure = { kind: 'protocol', message: error instanceof Error ? error.message : String(error) } }
    finally { value?.dispose(); call.promise.dispose() }
    if (failure) { finish(failure); return }
    schedulePump()
  })

  try {
    const consoleObject = ctx.newObject()
    for (const name of ['log', 'info', 'warn', 'error', 'debug']) {
      const logger = ctx.newFunction(name, (...args) => {
        const text = unwrap(ctx.callFunction(formatter, ctx.undefined, ...args))
        try {
          const value = ctx.getString(text)
          logBytes += Buffer.byteLength(JSON.stringify(value)) + 1
          logMessages++
          if (outputRejected || logBytes > input.config.maxOutputBytes || logMessages > input.config.maxLogMessages) {
            if (!outputRejected) send({ kind: 'done', error: { kind: 'output-limit', message: 'Console output exceeds configured limits' } })
            outputRejected = true
            throw new Error('Console output exceeds configured limits')
          }
          send({ kind: 'log', text: value })
        } finally { text.dispose() }
        return ctx.undefined
      })
      ctx.setProp(consoleObject, name, logger)
      logger.dispose()
    }
    ctx.setProp(ctx.global, 'console', consoleObject)
    consoleObject.dispose()
    for (const namespace of input.bindings) {
      let reject = ordinaryError
      if (namespace.errorClass) {
        const descriptor = namespace.errorClass
        const name = ctx.newString(descriptor.name), member = ctx.newString(descriptor.memberNameProperty)
        let factory: QuickJSHandle
        try { factory = unwrap(ctx.callFunction(makeError, ctx.undefined, name, member)) }
        finally { name.dispose(); member.dispose() }
        const constructor = ctx.getProp(factory, 'constructor')
        ctx.setProp(ctx.global, descriptor.name, constructor)
        constructor.dispose()
        reject = hold(ctx.getProp(factory, 'reject'))
        factory.dispose()
      }
      const object = ctx.newObject(ctx.null)
      for (const member of namespace.members) {
        const rejectFactory = reject
        const binding = ctx.newFunction(member, (...args) => {
          if (args.length !== 1) throw new Error('Binding requires one JSON argument')
          if (pending.size >= input.config.maxPendingCalls) throw new Error('Too many pending binding calls')
          const argument = args[0]
          if (argument === undefined) throw new Error('Binding requires one JSON argument')
          const json = encode(argument)
          if (Buffer.byteLength(json) > input.config.maxMessageBytes) throw new Error('Binding argument exceeds message limit')
          const promise = ctx.newPromise()
          const id = ++sequence
          pending.set(id, { promise, reject: rejectFactory, member })
          send({ kind: 'call', id, global: namespace.global, member, json })
          return promise.handle.dup()
        })
        ctx.setProp(object, member, binding)
        binding.dispose()
      }
      ctx.setProp(ctx.global, namespace.global, object)
      object.dispose()
    }
    const prefix = 'async function __dsh_program__() {\n', suffix = '\n}'
    const transformed = stripTypeScriptTypes(prefix + input.program + suffix, { mode: 'strip' })
    main = unwrap(ctx.evalCode(`(${transformed})()`, 'ptc-program.js', { type: 'global' }))
    schedulePump()
  } catch (error) {
    finish({ kind: Date.now() >= input.deadline ? 'timeout' : logBytes > input.config.maxOutputBytes ? 'output-limit' : 'exception', message: error instanceof Error ? error.message : String(error) })
  }
}
let input: WorkerInput | undefined
try { input = parseWorkerInput(workerData) }
catch (error) {
  port.postMessage({ kind: 'done', error: { kind: 'protocol', message: error instanceof Error ? error.message : String(error) } } satisfies WorkerMessage)
  port.close()
}
if (input !== undefined) await execute(input)
