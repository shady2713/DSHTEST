/** Tools-only QuickJS WebAssembly PTC execution in an owned Worker per run. */
import { Worker } from 'node:worker_threads'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { PtcRuntime, DUNDER_MEMBER, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcBindingNamespace, PtcRunRequest, PtcRunSpec, PtcRunResult, PtcRunFailure } from '@deepseek-ai/dsh-ptc-runtime'
import { encodeJson, decodeJson, parseWorkerMessage } from './protocol.ts'
import type { Config, ResolvedConfig, WorkerInput, WorkerMessage, HostReply } from './protocol.ts'

export type { Config } from './protocol.ts'
const genuine = new WeakSet<object>()
interface RuntimeState { config: ResolvedConfig; live: Set<{ abort: () => void; finished: Promise<void> }>; disposed: boolean }
const states = new WeakMap<object, RuntimeState>()
function ownerOf(provider: object): object | undefined {
  let current = provider
  const seen = new Set<object>()
  while (!seen.has(current)) {
    if (states.has(current)) return current
    seen.add(current)
    const original: unknown = Reflect.get(current, Symbol.for('cordis.original'))
    if (typeof original !== 'object' || original === null) return undefined
    current = original
  }
  return undefined
}
function stateOf(provider: object): RuntimeState {
  const owner = ownerOf(provider)
  const state = owner === undefined ? undefined : states.get(owner)
  if (!state) throw new Error('quickjs: missing provider owner state')
  return state
}
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/
const timerMaximum = 2_147_483_647
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/**
 * Recognize only exact provider instances registered by this module, including Cordis shadows.
 * @param value - Provider observed by trusted Host policy code.
 * @returns Whether the provider was constructed by this exact implementation.
 */
export function isQuickJsPtcRuntime(value: unknown): value is QuickJsPtcRuntime {
  if (typeof value !== 'object' || value === null) return false
  const owner = ownerOf(value)
  return owner !== undefined && genuine.has(owner)
}

function captureBindings(request: PtcRunRequest): Map<string, PtcBindingNamespace> {
  const result = new Map<string, PtcBindingNamespace>()
  const globals = new Set<string>()
  const add = (name: string): void => {
    if (!identifier.test(name) || PORTABLE_RESERVED_WORDS.has(name) || RESERVED_BINDING_GLOBALS.has(name) || globals.has(name)) throw new Error(`quickjs: unusable or duplicate binding global ${JSON.stringify(name)}`)
    globals.add(name)
  }
  for (const namespace of request.bindings) {
    add(namespace.global)
    result.set(namespace.global, { ...namespace, functions: { ...namespace.functions } })
  }
  for (const namespace of result.values()) {
    if (!namespace.errorClass) continue
    add(namespace.errorClass.name)
    const member = namespace.errorClass.memberNameProperty
    if (!member || RESERVED_ERROR_MEMBERS.has(member) || DUNDER_MEMBER.test(member)) throw new Error('quickjs: unusable error member property')
  }
  return result
}
function workerUrl(): URL {
  if (!import.meta.url.endsWith('.ts')) return new URL('./worker.js', import.meta.url)
  const api = import.meta.resolve('tsx/esm/api')
  const config = fileURLToPath(new URL('../../../../tsconfig.host.json', import.meta.url))
  const source = `import { register } from ${JSON.stringify(api)}; register({ tsconfig: ${JSON.stringify(config)} }); await import(${JSON.stringify(new URL('./worker.ts', import.meta.url).href)});`
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`)
}

/** QuickJS has ECMAScript built-ins and explicitly injected async bindings, without Node APIs. */
export class QuickJsPtcRuntime extends PtcRuntime {
  static Config: z<Config, ResolvedConfig> = z.object({
    timeoutMs: z.number().default(120_000), maxTimeoutMs: z.number().default(600_000),
    memoryLimitBytes: z.number().default(67_108_864), maxStackBytes: z.number().default(1_048_576),
    maxOutputBytes: z.number().default(16_777_216), maxMessageBytes: z.number().default(16_777_216),
    maxLogMessages: z.number().default(512),
    maxPendingCalls: z.number().default(128), maxSourceBytes: z.number().default(1_048_576),
    maxJobsPerTick: z.number().default(128), workerHeapMb: z.number().default(128),
  })
  readonly language = 'typescript'
  readonly isolation = 'worker-thread-quickjs-wasm'
  constructor(ctx: Context, config: Config) {
    super(ctx)
    states.set(this, { config: QuickJsPtcRuntime.Config(config), live: new Set(), disposed: false })
    for (const [key, value] of Object.entries(stateOf(this).config)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`quickjs: ${key} must be a positive safe integer`)
    if (stateOf(this).config.timeoutMs > stateOf(this).config.maxTimeoutMs || stateOf(this).config.maxTimeoutMs > timerMaximum) throw new Error('quickjs: invalid timeout defaults or timer range')
    if (stateOf(this).config.maxOutputBytes < 256) throw new Error('quickjs: maxOutputBytes must allow a diagnostic envelope (at least 256 bytes)')
    if (new.target === QuickJsPtcRuntime) genuine.add(this)
    ctx.effect(() => async () => {
      stateOf(this).disposed = true
      const active = [...stateOf(this).live]
      for (const run of active) run.abort()
      await Promise.all(active.map(run => run.finished))
    }, 'QuickJS ptc-runtime worker cleanup')
  }
  override get executionInstructions(): string { return 'Each call runs in a fresh QuickJS WebAssembly context in a separate Worker. Only ECMAScript built-ins, console and declared async bindings are available. Node, imports, filesystem, network, timers and process APIs are unavailable. TypeScript syntax must be erasable. Return lossless JSON; await every binding you need before returning.' }
  override get timeout(): { defaultMs: number; maxMs: number } {
    return { defaultMs: stateOf(this).config.timeoutMs, maxMs: stateOf(this).config.maxTimeoutMs }
  }

  /**
   * Resolve deployment defaults; explicit file sandbox requests and unbounded deadlines are unsupported.
   * @param request - Program and host-owned binding declarations.
   * @returns Absolute directory metadata and a capped finite deadline.
   */
  resolve(request: PtcRunRequest): PtcRunSpec {
    if (stateOf(this).disposed) throw new Error('quickjs: resolve after disposal')
    if (request.sandboxPolicy !== undefined) throw new Error('quickjs: sandboxPolicy is unsupported; this provider has no direct filesystem')
    const cwd = request.cwd ?? process.cwd()
    if (!isAbsolute(cwd)) throw new Error('quickjs: cwd must be absolute')
    const timeoutMs = request.timeoutMs === undefined ? stateOf(this).config.timeoutMs : request.timeoutMs
    if (timeoutMs === null || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('quickjs: timeoutMs must be finite and positive')
    return { ...request, cwd, timeoutMs: Math.min(timeoutMs, stateOf(this).config.maxTimeoutMs) }
  }

  /**
   * Execute resolved inputs and await the owning Worker exit before returning.
   * @param spec - Inputs returned by resolve, with no file sandbox authority.
   * @returns Captured logs and completion or a classified execution failure.
   */
  async run(spec: PtcRunSpec): Promise<PtcRunResult> {
    if (stateOf(this).disposed) throw new Error('quickjs: run after disposal')
    if (spec.sandboxPolicy !== undefined || !isAbsolute(spec.cwd) || spec.timeoutMs === null || !Number.isFinite(spec.timeoutMs) || spec.timeoutMs <= 0 || spec.timeoutMs > stateOf(this).config.maxTimeoutMs) throw new Error('quickjs: run requires supported resolved inputs')
    const bindings = captureBindings(spec)
    if (Buffer.byteLength(spec.program) > stateOf(this).config.maxSourceBytes) return { logs: [], error: { kind: 'protocol', message: 'Program exceeds source limit' } }
    if (spec.signal?.aborted) return { logs: [], error: { kind: 'abort', message: 'Execution cancelled' } }
    const logs: string[] = []
    let logBytes = Buffer.byteLength('{"logs":[]}')
    const completion = Promise.withResolvers<PtcRunResult>()
    const finished = Promise.withResolvers<void>()
    let worker: Worker | undefined
    const lifecycle = { settled: false }
    let outstanding = 0
    let lastCallId = 0
    const finish = (error?: PtcRunFailure, json?: string): void => {
      if (lifecycle.settled) return
      lifecycle.settled = true
      clearTimeout(timer)
      spec.signal?.removeEventListener('abort', abort)
      let result: PtcRunResult
      try { result = { logs: [...logs], ...(error ? { error } : {}), ...(json === undefined ? {} : { value: decodeJson(json) }) } }
      catch (failure) { result = { logs: [...logs], error: { kind: 'protocol', message: messageOf(failure) } } }
      if (Buffer.byteLength(JSON.stringify(result)) > stateOf(this).config.maxOutputBytes) result = { logs: [], error: { kind: 'output-limit', message: 'Execution output exceeds configured byte limit' } }
      void (async () => {
        try { if (worker) await worker.terminate() }
        catch (failure) { result = { logs: [], error: { kind: 'worker-exit', message: messageOf(failure) } } }
        finally { stateOf(this).live.delete(live); finished.resolve(); completion.resolve(result) }
      })()
    }
    const abort = (): void => { finish({ kind: 'abort', message: 'Execution cancelled' }) }
    const live = { abort, finished: finished.promise }
    stateOf(this).live.add(live)
    const timer = setTimeout(() => { finish({ kind: 'timeout', message: 'Execution deadline reached' }) }, spec.timeoutMs)
    spec.signal?.addEventListener('abort', abort, { once: true })
    const input: WorkerInput = {
      program: spec.program, deadline: Date.now() + spec.timeoutMs, config: stateOf(this).config,
      bindings: [...bindings.values()].map(namespace => ({
        global: namespace.global, members: Object.keys(namespace.functions),
        ...(namespace.errorClass ? { errorClass: namespace.errorClass } : {}),
      })),
    }
    try {
      worker = new Worker(workerUrl(), {
        workerData: input, execArgv: ['--disable-warning=ExperimentalWarning'],
        env: import.meta.url.endsWith('.ts') ? { TSX_DISABLE_CACHE: '1' } : {},
        resourceLimits: { maxOldGenerationSizeMb: stateOf(this).config.workerHeapMb },
      })
      const ownerWorker = worker
      worker.on('error', (error) => { finish({ kind: 'worker-exit', message: messageOf(error) }) })
      worker.on('exit', (code) => { if (!lifecycle.settled) finish({ kind: 'worker-exit', message: `Worker exited before completion (${code})` }) })
      worker.on('message', (payload: unknown) => {
        if (lifecycle.settled) return
        let message: WorkerMessage
        try { message = parseWorkerMessage(payload) }
        catch (error) { finish({ kind: 'protocol', message: messageOf(error) }); return }
        if (message.kind === 'log') {
          if (logs.length >= stateOf(this).config.maxLogMessages) {
            finish({ kind: 'output-limit', message: 'Console message count exceeds configured limit' })
            return
          }
          logBytes += Buffer.byteLength(JSON.stringify(message.text)) + (logs.length === 0 ? 0 : 1)
          if (logBytes > stateOf(this).config.maxOutputBytes) {
            finish({ kind: 'output-limit', message: 'Execution output exceeds configured byte limit' })
            return
          }
          logs.push(message.text)
          return
        }
        if (message.kind === 'done') { finish(message.error, message.json); return }
        const namespace = bindings.get(message.global)
        const binding = namespace && Object.hasOwn(namespace.functions, message.member) ? namespace.functions[message.member] : undefined
        if (!binding || message.id <= lastCallId || ++outstanding > stateOf(this).config.maxPendingCalls || Buffer.byteLength(message.json) > stateOf(this).config.maxMessageBytes) { finish({ kind: 'protocol', message: 'Invalid binding request' }); return }
        lastCallId = message.id
        let argument: ReturnType<typeof decodeJson>
        try { argument = decodeJson(message.json) }
        catch (error) { finish({ kind: 'protocol', message: messageOf(error) }); return }
        void (async () => {
          let reply: HostReply
          try {
            const json = encodeJson(await binding(argument))
            if (Buffer.byteLength(json) > stateOf(this).config.maxMessageBytes) throw new Error('Binding result exceeds configured message limit')
            reply = { id: message.id, json }
          } catch (error) {
            const text = messageOf(error)
            reply = { id: message.id, error: Buffer.byteLength(text) > stateOf(this).config.maxMessageBytes ? 'Binding failure exceeds configured message limit' : text }
          }
          finally { outstanding-- }
          if (!lifecycle.settled) ownerWorker.postMessage(reply)
        })()
      })
    } catch (error) { finish({ kind: 'worker-exit', message: messageOf(error) }) }
    return completion.promise
  }
}
export default QuickJsPtcRuntime
