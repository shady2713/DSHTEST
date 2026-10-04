import { Worker } from 'node:worker_threads'
import { describe, expect, it, onTestFinished } from 'vitest'
import QuickJsPtcRuntime from '../src/index.ts'
import { decodeJson, parseHostReply, parseWorkerInput, parseWorkerMessage } from '../src/protocol.ts'

function worker(input: unknown): Worker {
  const source = `import {register} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}; register(); await import(${JSON.stringify(new URL('../src/worker.ts', import.meta.url).href)});`
  const owned = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), {
    workerData: input, execArgv: ['--disable-warning=ExperimentalWarning'], env: { TSX_DISABLE_CACHE: '1' }, stderr: true,
  })
  onTestFinished(async () => { await owned.terminate() })
  return owned
}
function nextMessage(owned: Worker) {
  return new Promise<ReturnType<typeof parseWorkerMessage>>((resolve, reject) => {
    owned.once('message', (payload: unknown) => {
      try { resolve(parseWorkerMessage(payload)) }
      catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
    })
    owned.once('error', reject)
  })
}

describe('QuickJS Worker messages', () => {
  it.each([null, [], {}, { kind: 'other' }, { kind: 'log' }, { kind: 'log', text: 1 },
    { kind: 'call', id: 1, global: 'tools', member: 'read' },
    { kind: 'call', id: 0, global: 'tools', member: 'read', json: '{}' },
    { kind: 'done', error: {} }, { kind: 'done', error: { kind: 'other', message: 'bad' } },
    { kind: 'done', error: { kind: 'abort', message: 'bad' }, json: 'null' },
  ])('refuses malformed Worker observation %j', (payload) => {
    expect(() => parseWorkerMessage(payload)).toThrow()
  })
  it('accepts genuine log, call, value and failure observations', () => {
    for (const payload of [{ kind: 'log', text: 'ready' }, { kind: 'call', id: 1, global: 'tools', member: 'read', json: '{}' },
      { kind: 'done' }, { kind: 'done', json: 'null' }, { kind: 'done', error: { kind: 'protocol', message: 'bad' } }]) {
      expect(parseWorkerMessage(payload)).toEqual(payload)
    }
  })
  it.each([null, {}, { id: -1, json: '{}' }, { id: 1 }, { id: 1, json: '{}' , error: 'bad' },
    { id: 1, error: {} }, { id: '1', error: 'bad' }])('refuses malformed Host completion %j', (payload) => {
    expect(() => parseHostReply(payload)).toThrow()
  })
  it('accepts exactly one value or rejection in a Host completion', () => {
    expect(parseHostReply({ id: 1, json: '{}' })).toEqual({ id: 1, json: '{}' })
    expect(parseHostReply({ id: 2, error: 'denied' })).toEqual({ id: 2, error: 'denied' })
  })
  it('requires complete startup limits and typed binding metadata', () => {
    const valid = { program: '', deadline: Date.now() + 1000, config: QuickJsPtcRuntime.Config({}), bindings: [{ global: 'tools', members: ['read'] }] }
    expect(parseWorkerInput(valid)).toEqual(valid)
    for (const value of [null, {}, { ...valid, deadline: NaN }, { ...valid, config: {} },
      { ...valid, config: { ...valid.config, maxStackBytes: 0 } }, { ...valid, bindings: [{ global: 'tools', members: [1] }] },
      { ...valid, bindings: [{ global: 'tools', members: [], errorClass: { name: 'X' } }] }]) {
      expect(() => parseWorkerInput(value)).toThrow()
    }
  })
  it('refuses malformed JSON and numeric overflow at the actual JSON channel', () => {
    expect(() => decodeJson('{')).toThrow()
    expect(() => decodeJson('1e999')).toThrow('lossless')
    expect(() => decodeJson('-0')).toThrow('lossless')
    expect(decodeJson('{"__proto__":{"x":1}}')).toEqual(JSON.parse('{"__proto__":{"x":1}}'))
  })
  it('reports malformed actual Worker startup data as a protocol completion', async () => {
    const owned = worker({})
    expect(await nextMessage(owned)).toMatchObject({ kind: 'done', error: { kind: 'protocol' } })
    await owned.terminate()
  })
  it('refuses a malformed actual Host reply and releases pending guest handles', async () => {
    const owned = worker({ program: 'return await tools.read({});', deadline: Date.now() + 5000,
      config: QuickJsPtcRuntime.Config({}), bindings: [{ global: 'tools', members: ['read'] }] })
    let stderr = ''
    owned.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
    expect(await nextMessage(owned)).toMatchObject({ kind: 'call', id: 1 })
    const completion = nextMessage(owned)
    owned.postMessage({ id: 'invalid', json: '{}' })
    expect(await completion).toMatchObject({ kind: 'done', error: { kind: 'protocol' } })
    await owned.terminate()
    expect(stderr).not.toContain('ExperimentalWarning')
  })
})
