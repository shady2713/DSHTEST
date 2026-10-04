/**
 * Shared bootstrap for the connection and routing suites: the real LLM runtime,
 * the real DeepSeek Messages adapter, and the real local credential store, all
 * over one HTTP endpoint the suite owns.
 *
 * The only thing a suite varies is the endpoint's answers and which model the
 * adapter's catalog names, because those are exactly the two facts a connection
 * test is about. Nothing here substitutes the routing, the classification, the
 * fingerprint, or the wait.
 */

import { once } from 'node:events'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import * as ApiKey from '@deepseek-ai/dsh-llm-deepseek-api-key'
import WebTestModels, { memorySelectionStore } from '../src/index.ts'
import type { RouteSelection, SelectionStore, StoredSelections } from '../src/index.ts'

/** What one suite states about the endpoint it wants to talk to. */
export interface HarnessOptions {
  /** Base URL the DeepSeek adapter is pointed at. */
  readonly baseURL: string
  /** Literal stored under `DEEPSEEK_API_KEY` through the real credential service. */
  readonly key: string
  /** Model the adapter's catalog names; the default is the image-capable route. */
  readonly catalog?: string
  /**
   * Whether the DeepSeek adapter is mounted. A composition that has configured no
   * provider yet is a real state — the first run before Settings writes an entry —
   * and it is the only way the empty provider directory can be read.
   */
  readonly mountAdapter?: boolean
}

/**
 * The one catalog entry a suite mounts: the requested model, declaring the image
 * modality unless the suite asked for the text-only route.
 * @param id - the model id the adapter's catalog names.
 * @returns the catalog entry.
 */
function catalogModel(id: string | undefined): { id: string; name: string; inputModalities: ('text' | 'image')[] } {
  const modelId = id ?? 'deepseek-flash'
  return { id: modelId, name: modelId, inputModalities: modelId === 'deepseek-v4-pro' ? ['text'] : ['text', 'image'] }
}

/** A running composition plus the seam a suite needs to drive it. */
export interface WorkTestModels {
  /** The service under test. */
  readonly service: InstanceType<typeof WebTestModels>
  /**
   * The live LLM runtime, so a suite can make the *real* adapter refuse its own
   * catalog or model lookup. Nothing here replaces the runtime; the behaviour
   * under test is how this service reads a refusal, not whether a stand-in fails.
   */
  readonly llm: InstanceType<typeof LlmRuntime>
  /** The real credential provider, so a suite can write and unset a reference. */
  readonly credentials: CredentialProvider
  /** The selection store, so a suite can seed a record written by an earlier run. */
  readonly store: SeedableSelectionStore
  /** Resolve after an event the service registered has run. */
  settled(): Promise<void>
  /** Dispose the composition and remove the credential store's directory. */
  dispose(): Promise<void>
}

/** A selection store a suite can seed, standing in for a record an earlier run persisted. */
export interface SeedableSelectionStore extends SelectionStore {
  /**
   * Write one task type's selection as if a previous run had verified it.
   * @param taskType - the task type to seed.
   * @param selection - the record the earlier run wrote.
   * @returns true when the record was committed.
   */
  seed(taskType: RouteSelection['taskType'], selection: RouteSelection): boolean
  /**
   * Replace the stored records with what a hand-edited settings document holds,
   * keyed by the task type the service reads each one under.
   *
   * `seed` cannot produce such a record — it rewrites the stored `taskType` to
   * the key it was handed — and a durable store is a file a user can edit, so
   * this is the only seam that can place one.
   * @param byTask - the document's records, as the file holds them.
   * @returns true when the document was read.
   */
  putDocument(byTask: object): boolean
}

/** A store whose records a suite writes directly. */
export class SeedableStore implements SeedableSelectionStore {
  private revision = 0

  private byTask: Partial<Record<RouteSelection['taskType'], RouteSelection>> = {}

  /**
   * @returns the stored selections with the revision they were read at.
   */
  read(): Promise<StoredSelections> {
    return Promise.resolve({ revision: this.revision, byTask: { ...this.byTask } })
  }

  /**
   * @param selection - the selection a real request earned.
   * @returns true, because this store commits synchronously.
   */
  put(selection: RouteSelection): Promise<boolean> {
    this.byTask = { ...this.byTask, [selection.taskType]: selection }
    this.revision += 1
    return Promise.resolve(true)
  }

  /**
   * @param taskType - the task type to seed.
   * @param selection - the record the earlier run wrote.
   * @returns true when the record was committed.
   */
  seed(taskType: RouteSelection['taskType'], selection: RouteSelection): boolean {
    void this.put({ ...selection, taskType })
    return true
  }

  /**
   * @param byTask - the document's records, as the file holds them.
   * @returns true when the document was read.
   */
  putDocument(byTask: object): boolean {
    // The document is not trusted, and that is the point: a settings-backed store
    // hands back what the file holds, and the service decides which of it this
    // release may serve from. Narrowing it here would hide the very case the
    // reader exists for.
    this.byTask = byTask
    this.revision += 1
    return true
  }
}

/**
 * Mount the real runtime, the real adapter, the real credential store, and the
 * service under test, then store the requested key through the credential
 * service so the adapter resolves it the way a first run would.
 * @param options - the endpoint, the key to store, and the model to declare.
 * @returns the running composition and the seams a suite drives.
 */
export async function start(options: HarnessOptions): Promise<WorkTestModels> {
  // The credential store is pointed at a throwaway home: a suite that writes a
  // key must never touch the operator's real `.credentials.yaml`.
  const dataDir = mkdtempSync(join(tmpdir(), 'web-test-models-'))
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LocalCredentials, { path: join(dataDir, '.credentials.yaml'), dshHome: dataDir, watch: false })
    if (options.mountAdapter !== false) {
      await ctx.plugin(ApiKey as Parameters<typeof ctx.plugin>[0], {
        baseURL: options.baseURL,
        // The adapter's catalog is configuration, so a suite narrows it the way a
        // deployment would: a text-only catalog must leave a vision task with no
        // candidate at all.
        models: [catalogModel(options.catalog)],
      })
    }
    await ctx.plugin(WebTestModels, { verificationTtlMs: 600_000 })
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    rmSync(dataDir, { recursive: true, force: true })
    throw error
  }
  const store = new SeedableStore()
  ctx.webTestModels.selections = store
  // The composition states where a provider's stored profile names its reference.
  ctx.webTestModels.references = { forProvider: () => credentialRef('DEEPSEEK_API_KEY') }
  const credentials = ctx.credentials
  if (options.key.length > 0) await credentials.set(credentialRef('DEEPSEEK_API_KEY'), options.key)
  return {
    service: ctx.webTestModels,
    llm: ctx.llm,
    credentials,
    store,
    // Cordis dispatches synchronously for a sync listener; yielding once lets an
    // async listener finish before the suite reads the wait.
    settled: () => Promise.resolve().then(() => undefined).then(() => undefined),
    dispose: async () => {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

/** A store whose records live only for the process, for a suite that needs no seeding. */
export function inMemoryStore(): SelectionStore {
  return memorySelectionStore()
}

/** A real Messages endpoint over a real socket, plus the controls a suite drives it with. */
export interface TestEndpoint {
  /** Base URL the DeepSeek adapter is pointed at. */
  readonly baseURL: string
  /**
   * Answer every later request with one HTTP status. Anything but 200 is the
   * provider's own refusal body, which is how a suite reaches a live 401.
   * @param next - the status the endpoint answers with.
   */
  status(next: number): void
  /**
   * Every request the endpoint has seen, in arrival order.
   * @returns the path each request addressed, so a suite can prove which route ran.
   */
  requests(): readonly string[]
  /** Close the socket and resolve once it has closed. */
  close(): Promise<void>
}

/**
 * Start the one real socket a suite talks to: a Messages endpoint that answers a
 * completed SSE stream, or a refusal body when the suite sets a failing status.
 * @returns the endpoint and the controls that change what it answers.
 */
export async function messagesEndpoint(): Promise<TestEndpoint> {
  const seen: string[] = []
  let status = 200
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    seen.push(String(request.url))
    response.writeHead(status, { 'content-type': 'text/event-stream' })
    if (status !== 200) {
      response.end(JSON.stringify({ error: { message: 'Authentication Fails, Your api key is invalid', type: 'auth' } }))
      return
    }
    response.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_1', model: 'deepseek-flash', usage: { input_tokens: 12, output_tokens: 1 } } })}\n\n`)
    response.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`)
    response.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ready' } })}\n\n`)
    response.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`)
    response.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5, cache_read_input_tokens: 7 } })}\n\n`)
    response.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
    response.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the test endpoint did not bind a port')
  return {
    baseURL: `http://127.0.0.1:${String(address.port)}/anthropic`,
    status: (next: number) => {
      status = next
    },
    requests: () => [...seen],
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}
