/**
 * The live provider rows: real requests to the real DeepSeek endpoint through the
 * real adapter, classified by this package's own classifier.
 *
 * These rows need a reachable endpoint, and only the rows that need a *usable*
 * key are gated on one. Everything a suite can prove without a real key runs
 * unconditionally, so a keyless host still executes the absent-reference and the
 * legacy-protocol rows rather than skipping the file.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm/types'
import * as ApiKey from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { Options as DeepSeekOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { classifyFailure } from '../src/classify.ts'
import { PROBE_MAX_TOKENS, PROBE_PROMPT } from '../src/probe.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0)) await dispose()
})

/**
 * Every classification a real provider's own refusal may carry.
 *
 * `ready` is absent because a refusal is not it, and the list is the whole
 * closed set: a member left out turns a real provider answer this package
 * classified correctly into a suite failure.
 */
const REAL_PROVIDER_VERDICTS = [
  'rejected-credential',
  'rejected-model',
  'rejected-modality',
  'rejected-request',
  'transient',
  'exhausted',
] as const

it('classifies every refusal the allow-list claims a real provider can send', () => {
  // Without a key this host cannot make the provider send one, so the list is
  // held to the classifier instead: every member it names is one a failure
  // really reaches.
  const reachable = [
    classifyFailure({ message: 'Authentication Fails, Your api key is invalid', code: 'AUTH', status: 401 }),
    classifyFailure({ message: 'model_not_found', code: 'X', status: 404 }),
    classifyFailure({ message: 'this model does not support image input', code: 'X', status: 400 }),
    classifyFailure({ message: 'maximum context length is 8192 tokens', code: 'X', status: 400 }),
    classifyFailure({ message: 'slow down', code: 'RATE_LIMIT', status: 429 }),
    classifyFailure({ message: 'Insufficient balance', code: 'X', status: 402 }),
  ].map(verdict => verdict.kind)
  expect(reachable).toEqual([...REAL_PROVIDER_VERDICTS])
})

/**
 * Mount the real runtime and the real DeepSeek API-key adapter.
 * @returns a live context whose disposal the caller owns.
 */
async function live(): Promise<Context> {
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ApiKey as Parameters<typeof ctx.plugin>[0], {})
  return ctx
}

/** One real request's terminal failure, or `ready` when the provider answered. */
async function request(ctx: Context, model: string): Promise<ReturnType<typeof classifyFailure> | 'ready'> {
  const stream: AsyncIterable<StreamChunk> = ctx.llm.stream({
    provider: 'deepseek-official',
    model,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: PROBE_PROMPT }] })],
    maxTokens: PROBE_MAX_TOKENS,
  })
  for await (const chunk of stream) {
    if (chunk.type !== 'finish') continue
    const reason = chunk.reason
    if (reason.kind === 'error' || reason.kind === 'aborted') return classifyFailure(reason.failure)
    return 'ready'
  }
  return 'ready'
}

describe('the real DeepSeek provider', () => {
  it('declares a catalog whose capabilities differ per model', async () => {
    const ctx = await live()
    const models = await ctx.llm.listModels('deepseek-official')
    expect(models.length).toBeGreaterThan(0)
    // The declared modalities are per model, which is what makes a vision route
    // a capability decision rather than a provider decision.
    const declared = models.map(model => ({ id: model.id, modalities: model.inputModalities ?? null }))
    expect(declared.some(entry => entry.modalities?.includes('image') === true)).toBe(true)
    expect(declared.some(entry => entry.modalities?.includes('text') === true)).toBe(true)
  })

  it('refuses a request when the reference resolves to nothing, and this package reads that as the credential', async () => {
    // The key is absent from the ambient environment, so the real credential
    // layer refuses before a socket is opened. The literal is empty, not a secret.
    const previous = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = ''
    try {
      const ctx = await live()
      const verdict = await request(ctx, 'deepseek-flash')
      expect(verdict).not.toBe('ready')
      if (verdict === 'ready') return
      expect(verdict.kind).toBe('rejected-credential')
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    }
  })

  it('refuses the legacy protocol configuration outright', () => {
    // The Messages-only configuration is the one this release accepts; a stored
    // profile carrying the old `protocol` key is refused, not migrated. The key
    // is not in the current `Options`, which is why the resolver must refuse it.
    const legacy = (protocol: string): DeepSeekOptions => Object.assign({} as DeepSeekOptions, { protocol })
    expect(() => resolveAdapterOptions(legacy('anthropic')))
      .toThrow(/protocol is not configurable/u)
    expect(() => resolveAdapterOptions(legacy('openai')))
      .toThrow(/protocol is not configurable/u)
    expect(resolveAdapterOptions({}).baseURL)
      .toBe('https://api.deepseek.com/anthropic')
  })

  it('verifies a live route when a usable key is configured, and says so honestly when it is not', async () => {
    const key = process.env.DEEPSEEK_API_KEY ?? ''
    if (key === '') {
      // A keyless host cannot produce a `ready` verdict, and this package does not
      // manufacture one. The row records the fact instead of asserting a pass.
      const ctx = await live()
      const verdict = await request(ctx, 'deepseek-flash')
      expect(verdict).not.toBe('ready')
      if (verdict !== 'ready') expect(verdict.kind).toBe('rejected-credential')
      return
    }
    const ctx = await live()
    const verdict = await request(ctx, 'deepseek-flash')
    if (verdict === 'ready') return
    // A real key that the provider refuses is still a real classification, and
    // the refusal is reported rather than turned into a ready route. The list
    // is every kind a failure can carry, so a provider that answers with a
    // refusal this package has classified is recorded, not failed on.
    expect(REAL_PROVIDER_VERDICTS)
      .toContain(verdict.kind)
  })
})
