/**
 * The probe's own edges: a response that carries no usage, one that streams no
 * block at all, and the diagnostic a report renders.
 */
import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm/types'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { describeReport, entryFor, probeRoute } from '../src/probe.ts'
import type { ProbeRuntime } from '../src/probe.ts'
import type { ConnectionReport, ModelRoute } from '../src/types.ts'

const route: ModelRoute = {
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  credentialRef: credentialRef('DEEPSEEK_API_KEY'),
}

/** A runtime whose `stream` yields exactly the chunks a suite hands it. */
function runtimeOf(chunks: readonly StreamChunk[]): ProbeRuntime {
  return {
    stream: () => (async function* stream() { yield* chunks })(),
    resolveModelInfo: () => Promise.reject(new Error('this suite declares no model')),
  }
}

describe('probeRoute', () => {
  it('requires an actual image input before reporting a vision route ready', async () => {
    const image: ImageAttachmentRef = { attachmentId:AttachmentId('sha256:fixture'),mediaType:'image/png',bytes:1,width:1,height:1 }
    let content: unknown
    const llm: ProbeRuntime = {
      stream: (options) => { content = options.messages[0]?.content; return (async function* () { yield { type:'block-start',index:0,blockType:'text' } as const })() },
      resolveModelInfo: async () => { throw new Error('unused') },
    }
    expect((await probeRoute(llm,route,'vision')).verdict.kind).toBe('rejected-modality')
    expect(content).toBeUndefined()
    expect((await probeRoute(llm,route,'vision',undefined,image)).verdict.kind).toBe('ready')
    expect(content).toEqual(expect.arrayContaining([{ type:'image',attachment:image }]))
  })
  it('reports a transient failure for a response that carried no model-produced block', async () => {
    const observed = await probeRoute(runtimeOf([
      { type: 'usage', usage: { inputTokens: 4, outputTokens: 0 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]), route, 'analysis')
    expect(observed.verdict.kind).toBe('transient')
    if (observed.verdict.kind === 'ready') return
    expect(observed.verdict.failure.code).toBe('EMPTY_RESPONSE')
  })

  it('reports ready for a response that streamed a block, and carries the observed usage', async () => {
    const observed = await probeRoute(runtimeOf([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'usage', usage: { inputTokens: 4, outputTokens: 1, cacheReadTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]), route, 'analysis')
    expect(observed.verdict.kind).toBe('ready')
    expect(observed.usage?.cacheReadTokens).toBe(2)
    expect(observed.producedContent).toBe(true)
    expect(observed.requestId).toBeNull()
  })

  it('reports ready for a stream that ended without a finish chunk', async () => {
    // The adapter owns completion; a stream that simply ends is not a failure.
    const observed = await probeRoute(runtimeOf([
      { type: 'block-start', index: 0, blockType: 'text' },
    ]), route, 'analysis')
    expect(observed.verdict.kind).toBe('ready')
  })

  it('classifies an aborted finish and keeps the request id the provider issued', async () => {
    const observed = await probeRoute(runtimeOf([
      {
        type: 'finish',
        reason: { kind: 'aborted', failure: { message: 'cancelled', code: 'ABORTED' } },
      },
    ]), route, 'analysis')
    expect(observed.verdict.kind).toBe('transient')
  })

  it('records a different request id per address, so a re-run is told from a first run', async () => {
    const first = await probeRoute(runtimeOf([{ type: 'finish', reason: { kind: 'stop' } }]), route, 'analysis')
    const second = await probeRoute(runtimeOf([{ type: 'finish', reason: { kind: 'stop' } }]), route, 'vision')
    expect(first.fingerprint).not.toBe(second.fingerprint)
  })

  it('forwards a caller signal onto the request it makes', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const llm: ProbeRuntime = {
      stream: (options) => {
        seen = options.signal
        return (async function* stream() {
          const done: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }
          yield done
        })()
      },
      resolveModelInfo: () => Promise.reject(new Error('unused in this suite')),
    }
    await probeRoute(llm, route, 'analysis', controller.signal)
    expect(seen).toBe(controller.signal)
  })

  it('never calls the runtime for a route that names no model, and says it asked no provider', async () => {
    // The catalog stage records `model: ''` for a provider whose adapter
    // declares no model, and `listModels` failing writes `[]` for the same
    // provider. A re-test of either row used to address a real provider request
    // at an empty model id, and the provider's own refusal then read as a
    // statement about that model. Nothing was asked, so nothing is reported.
    let calls = 0
    const llm: ProbeRuntime = {
      stream: () => {
        calls += 1
        return (async function* stream() {
          const done: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }
          yield done
        })()
      },
      resolveModelInfo: () => Promise.reject(new Error('unused in this suite')),
    }
    const observed = await probeRoute(llm, { ...route, model: '' }, 'analysis')
    expect(calls).toBe(0)
    // `rejected-request` is the classification for input this release refuses
    // to send, and it is chosen over `rejected-model` precisely because it does
    // not assert anything about the provider's catalog.
    expect(observed.verdict.kind).toBe('rejected-request')
    expect(observed.producedContent).toBe(false)
    expect(observed.requestId).toBeNull()
    expect(observed.usage).toBeUndefined()
  })
})

describe('connectionReport', () => {
  it('attaches a capability record only to a ready verdict', () => {
    const base = {
      route,
      taskType: 'analysis',
      requestId: null,
    } as const
    const ready: ConnectionReport = {
      ...base,
      verdict: { kind: 'ready', detail: 'answered' },
      capabilities: { inputModalities: ['text'], toolUpdate: undefined, reportedCacheTokens: false },
    }
    expect(ready.capabilities).not.toBeNull()
    const refused: ConnectionReport = {
      ...base,
      verdict: { kind: 'rejected-credential', failure: { message: 'no', code: 'AUTH', status: 401 } },
      capabilities: null,
    }
    expect(refused.capabilities).toBeNull()
  })
})

describe('describeReport', () => {
  it('renders a ready verdict as its own detail and a refusal as the classification', () => {
    expect(describeReport({
      route,
      taskType: 'analysis',
      verdict: { kind: 'ready', detail: 'the provider answered' },
      capabilities: null,
      requestId: null,
    })).toBe('the provider answered')
    expect(describeReport({
      route,
      taskType: 'analysis',
      verdict: { kind: 'rejected-model', failure: { message: 'gone', code: 'X' } },
      capabilities: null,
      requestId: null,
    })).toBe('rejected-model: The provider does not serve the selected model.')
  })
})

describe('entryFor', () => {
  it('finds the entry that configures a route, and reports none for an unregistered one', () => {
    const entries = [{ provider: 'alpha', displayName: 'A', settingsNs: 'ns', settingsPath: [] }]
    expect(entryFor(entries, 'alpha')?.provider).toBe('alpha')
    expect(entryFor(entries, 'beta')).toBeUndefined()
  })
})
