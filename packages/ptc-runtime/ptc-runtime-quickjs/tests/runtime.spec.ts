import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { PtcBindingNamespace, PtcRunRequest } from '@deepseek-ai/dsh-ptc-runtime'
import QuickJsPtcRuntime, { isQuickJsPtcRuntime } from '../src/index.ts'
import type { Config } from '../src/index.ts'

async function setup(config: Partial<Config> = {}) {
  const ctx = new Context()
  await ctx.plugin(QuickJsPtcRuntime, config)
  onTestFinished(() => ctx.fiber.dispose())
  const runtime = ctx.ptcRuntime
  return { ctx, runtime, run: (request: PtcRunRequest) => runtime.run(runtime.resolve(request)) }
}
function tools(functions: PtcBindingNamespace['functions']): PtcBindingNamespace[] {
  return [{ global: 'tools', functions, errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' } }]
}
describe('QuickJS Worker execution', () => {
  it('runs erasable TypeScript and captures logs with a fresh context each time', async () => {
    const { run } = await setup()
    expect(await run({ program: 'const n: number = 6; console.log("ready", {n}); globalThis.once=1; return n * 7;', bindings: [] })).toEqual({ logs: ['ready {"n":6}'], value: 42 })
    expect(await run({ program: 'return typeof globalThis.once;', bindings: [] })).toEqual({ logs: [], value: 'undefined' })
  })
  it('has no Node, filesystem, network or dynamic import capability', async () => {
    const { run } = await setup()
    const result = await run({ program: 'return [typeof process,typeof require,typeof module,typeof fetch,typeof WebSocket,typeof Buffer,typeof setTimeout,Function("return typeof process")()];', bindings: [] })
    expect(result.value).toEqual(Array(8).fill('undefined'))
    expect((await run({ program: 'return await import("node:fs");', bindings: [] })).error?.kind).toBe('exception')
  })
  it('bridges asynchronous tools and typed rejection without losing JSON keys', async () => {
    const { run } = await setup()
    const bindings = tools({ echo: async (args) => { await new Promise(resolve => setTimeout(resolve, 5)); return { args: args as { text: string } } }, fail: async () => { throw new Error('denied') } })
    const result = await run({ program: 'const a=await tools.echo({text:"好"}); try {await tools.fail({});} catch(e) {return {a,typed:e instanceof ToolCallError,name:e.toolName,message:e.message};}', bindings })
    expect(result).toEqual({ logs: [], value: { a: { args: { text: '好' } }, typed: true, name: 'fail', message: 'denied' } })
  })
  it.each(['return NaN;', 'return -0;', 'return {a:undefined};', 'return [,,];', 'return 1n;', 'return new Date();', 'const a={};a.self=a;return a;'])('rejects lossy completion: %s', async (program) => {
    const { run } = await setup()
    expect((await run({ program, bindings: [] })).error?.kind).toBe('invalid-output')
  })
  it('rejects lossy tool arguments before invoking the Host', async () => {
    const { run } = await setup()
    let calls = 0
    const result = await run({ program: 'await tools.echo({v:undefined});', bindings: tools({ echo: async () => { calls++; return null } }) })
    expect(result.error?.kind).toBe('exception')
    expect(calls).toBe(0)
  })
  it('keeps JSON and typed errors stable after guest intrinsic replacement', async () => {
    const { run } = await setup()
    const result = await run({
      program: 'Object.prototype.toJSON=()=>"changed"; Set.prototype.has=()=>false; Array.prototype[Symbol.iterator]=function*(){}; const a=await tools.echo({text:"ok"}); Object={}; try {await tools.fail({});} catch(e) {return {a,typed:e instanceof ToolCallError,name:e.toolName};}',
      bindings: tools({ echo: async args => args as { text: string }, fail: async () => { throw new Error('denied') } }),
    })
    expect(result).toEqual({ logs: [], value: { a: { text: 'ok' }, typed: true, name: 'fail' } })
  })
  it('returns JSON keys named __proto__ and catches invalid Host output as typed rejection', async () => {
    const { run } = await setup()
    const result = await run({
      program: 'const v=await tools.echo(JSON.parse("{\\"__proto__\\":{\\"x\\":1}}")); try {await tools.bad({});} catch(e) {return {v,typed:e instanceof ToolCallError};}',
      bindings: tools({ echo: async args => args as { [key: string]: null }, bad: async () => NaN }),
    })
    const value: unknown = JSON.parse('{"__proto__":{"x":1}}')
    expect(result).toEqual({ logs: [], value: { v: value, typed: true } })
  })
  it('keeps the Host responsive while an infinite guest loop reaches its deadline', async () => {
    const { run } = await setup()
    let hostTimer = false
    const timer = setTimeout(() => { hostTimer = true }, 30)
    const result = await run({ program: 'while(true) {}', bindings: [], timeoutMs: 400 })
    clearTimeout(timer)
    expect(hostTimer).toBe(true)
    expect(result.error?.kind).toBe('timeout')
  })
  it('cancels an infinite loop and awaits Worker release', async () => {
    const { run } = await setup()
    const controller = new AbortController()
    const entered = Promise.withResolvers<undefined>()
    const running = run({ program: 'tools.started({}); while(true){}', bindings: tools({ started: async () => { entered.resolve(undefined); return null } }), signal: controller.signal })
    await entered.promise
    controller.abort()
    expect((await running).error?.kind).toBe('abort')
    expect((await run({ program: 'return 1;', bindings: [] })).value).toBe(1)
  })
  it('enforces QuickJS memory and stack allocation limits', async () => {
    const { run } = await setup({ memoryLimitBytes: 2_097_152, maxStackBytes: 32_768 })
    expect((await run({ program: 'return "x".repeat(10000000);', bindings: [] })).error?.kind).toBe('exception')
    expect((await run({ program: 'function recurse(){return recurse();} return recurse();', bindings: [] })).error?.kind).toBe('exception')
  })
  it('disposes active workers and ignores late Host completions', async () => {
    const { ctx, run } = await setup()
    const entered = Promise.withResolvers<undefined>()
    const reply = Promise.withResolvers<null>()
    const running = run({ program: 'await tools.wait({}); return 1;', bindings: tools({ wait: async () => { entered.resolve(undefined); return reply.promise } }) })
    await entered.promise
    await ctx.fiber.dispose()
    expect((await running).error?.kind).toBe('abort')
    reply.resolve(null)
    await new Promise(resolve => setImmediate(resolve))
  })
  it('bounds output, source size and pending calls', async () => {
    const { run } = await setup({ maxOutputBytes: 256, maxSourceBytes: 512, maxPendingCalls: 1 })
    expect((await run({ program: 'console.log("好".repeat(300));', bindings: [] })).error?.kind).toBe('output-limit')
    expect((await run({ program: ' '.repeat(513), bindings: [] })).error?.kind).toBe('protocol')
    expect((await run({ program: 'await Promise.all([tools.wait({}),tools.wait({})]);', bindings: tools({ wait: async () => new Promise(() => {}) }) })).error?.kind).toBe('exception')
  })
  it('accepts the console message boundary and refuses excess even when the guest catches it', async () => {
    const { run } = await setup({ maxLogMessages: 8 })
    expect(await run({ program: 'for(let i=0;i<8;i++) console.log(""); return 1;', bindings: [] })).toEqual({ logs: Array(8).fill(''), value: 1 })
    const result = await run({ program: 'for(let i=0;i<9;i++) try {console.log("");} catch {} return 1;', bindings: [] })
    expect(result.error?.kind).toBe('output-limit')
    expect(result.logs.length).toBeLessThanOrEqual(8)
  })
  it('bounds a synchronous console flood while Host cancellation remains responsive', async () => {
    const { run } = await setup({ maxLogMessages: 8 })
    const controller = new AbortController()
    const timer = Promise.withResolvers<undefined>()
    const result = await run({ program: 'tools.started({}); while(true) try {console.log("");} catch {}',
      bindings: tools({ started: async () => {
        setTimeout(() => { controller.abort(); timer.resolve(undefined) }, 0)
        return null
      } }), signal: controller.signal })
    await timer.promise
    expect(['abort', 'output-limit']).toContain(result.error?.kind)
    expect(result.logs.length).toBeLessThanOrEqual(8)
  })
  it('refuses unsupported sandbox authority, unresolved budgets and fake provider identities', async () => {
    const { runtime } = await setup()
    expect(isQuickJsPtcRuntime(runtime)).toBe(true)
    expect(isQuickJsPtcRuntime({ isolation: runtime.isolation })).toBe(false)
    expect(() => runtime.resolve({ program: '', bindings: [], timeoutMs: null })).toThrow('finite')
    expect(() => runtime.resolve({ program: '', bindings: [], sandboxPolicy: { mode: 'read-only', workspaceRoot: process.cwd() } })).toThrow('unsupported')
    await expect(runtime.run({ program: '', bindings: [], cwd: process.cwd(), timeoutMs: null })).rejects.toThrow('resolved')
    class Fake extends QuickJsPtcRuntime {}
    const ctx = new Context()
    await ctx.plugin(Fake, {})
    expect(isQuickJsPtcRuntime(ctx.ptcRuntime)).toBe(false)
    await ctx.fiber.dispose()
  })
})
