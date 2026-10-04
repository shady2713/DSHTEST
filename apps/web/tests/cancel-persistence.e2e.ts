// Durable evidence for the Stop gesture on the shared Web path, without an
// Electron GUI: a real chromium drives a real Host over the real `/api` uplink.
// Scenario 1 correlates the `POST /api/session/cancel` request the browser sent
// with the `turn/end` the session log then holds, naming the same session and
// the same turn and ending in the `user` cancel cause. Scenario 2 points the
// real DeepSeek adapter at a local endpoint that answers every Messages request
// with 429 plus `Retry-After`, stops a retry that is already parked in its wait,
// and then samples the route's request count past the retry time the loop had
// committed to. The bundle the profile and the desktop host share is the same
// code; neither scenario observes a desktop window.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page, Response as PlaywrightResponse } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { parseSessionHeader, parseSessionLog, type ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// The llm/retry payload is merged into SessionEventMap by the retry package; without
// this import the event data resolves to error in a program that never loads it.
import type {} from '../../../packages/llm/llm-retry/src/types.ts'
import { createZstdFrameDecoder, scanZstdFrames } from '../../../packages/session/session-persistence-jsonl/src/zstd.ts'
import { parseGenerationLogFilename } from '../../../packages/session/session-persistence-jsonl/src/format.ts'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT, connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const EVIDENCE_DIR = join(REPO_ROOT, '.artifacts/web-testing/m0-t07/cancel-persistence')
const MODE = webSnapshotMode()
const PROMPT = 'Describe the cancellation path in one sentence, then stop.'
/** The local endpoint's `Retry-After`; the shipped normal policy honours it up to its 10 s cap. */
const RETRY_AFTER_MS = 5_000
/** Offsets past the scheduled retry time at which the route's request count is sampled. */
const COUNT_OFFSETS_MS = [1_000, 3_000, 6_000, 10_000]

/** One decoded persisted Session artifact: the header facts and the migrated events. */
interface PersistedLog {
  path: string
  header: { id: string; createdAt: number }
  events: SessionEvent[]
}

/** Read one Zstandard-framed session artifact through the shipped readers. */
async function readPersistedLog(path: string): Promise<PersistedLog> {
  const raw = await readFile(path)
  const decoder = createZstdFrameDecoder()
  const parts: Buffer[] = []
  try {
    for (const frame of decoder.decode(raw, scanZstdFrames(raw).frames)) parts.push(Buffer.from(frame))
  } finally {
    decoder.close()
  }
  const text = Buffer.concat(parts).toString('utf8')
  return { path, header: parseSessionHeader(text), events: parseSessionLog(text) }
}

/** Every session artifact the scaffold's temp persistence root holds, in either encoding. */
async function findSessionLogs(root: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...await findSessionLogs(path))
    else if (parseGenerationLogFilename(entry.name, 'zstd') !== undefined
      || parseGenerationLogFilename(entry.name, 'none') !== undefined) found.push(path)
  }
  return found
}

/** The one `turn/end` the log holds; the scenarios abort a single turn each. */
function onlyTurnEnd(events: readonly SessionEvent[]): SessionEvent<'turn/end'> {
  const ends = events.filter(event => event.type === 'turn/end')
  expect(ends).toHaveLength(1)
  return ends[0]!
}

describe('web e2e: cancelled turn durability', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let overrideDir: string | undefined

  afterEach(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch((error: unknown) => failures.push(error))
    if (overrideDir !== undefined) {
      await rm(overrideDir, { recursive: true, force: true })
        .catch((error: unknown) => failures.push(error))
    }
    overrideDir = undefined
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'cancel-persistence teardown failed')
  })

  /**
   * Read the cancel request the browser sent and its reply. Registered with
   * `waitForResponse` before the gesture, so both halves describe that one Stop.
   * @param pending - response promise registered before the Stop gesture.
   * @returns the request's `rpcId`, the session it named, and its reply.
   */
  async function readCancelExchange(pending: Promise<PlaywrightResponse>): Promise<{
    rpcId: string
    sessionId: string
  }> {
    const response = await pending
    expect(response.ok()).toBe(true)
    const request = response.request().postDataJSON() as {
      type: string
      rpcId: string
      method: string
      payload: { args: { request: { sessionId: string } } }
    }
    expect(request.type).toBe('client-request')
    expect(request.method).toBe('session/cancel')
    const reply = await response.json() as {
      type: string
      rpcId: string
      result: { ok: boolean; value?: { accepted: boolean } }
    }
    expect(reply.type).toBe('server-response')
    expect(reply.rpcId).toBe(request.rpcId)
    expect(reply.result).toEqual({ ok: true, value: { accepted: true } })
    return { rpcId: request.rpcId, sessionId: request.payload.args.request.sessionId }
  }

  /** Persist one run's measured numbers next to the conclusion that cites them. */
  async function writeEvidence(name: string, value: object): Promise<void> {
    await mkdir(EVIDENCE_DIR, { recursive: true })
    await writeFile(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  it.skipIf(MODE === 'record')('records one aborted/user turn end for the session its cancel request named', async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'dsh-web-cancel-persistence-'))
    const readyFile = join(overrideDir, '.hang-ready')
    const overridePath = join(overrideDir, 'replay.override.json')
    // The parked replay stream holds the turn open, so Stop is reachable while
    // the agent owns the turn — the state a user interrupts a real model call in.
    const script: ReplayEntry[] = [{ kind: 'hang', readyFile }]
    await writeFile(overridePath, JSON.stringify(script))

    scaffold = await launchWebScaffold({
      replayFixture: FIXTURE,
      replayOverride: overridePath,
      compareReplaySession: false,
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cancel-persistence'))

    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    await expect.poll(() => existsSync(readyFile), { timeout: 15_000 }).toBe(true)

    const attached = scaffold.ctx.sessions.list()
    expect(attached).toHaveLength(1)
    const sessionId = attached[0]!.id

    const pending = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/session/cancel'
      && response.request().method() === 'POST')
    // Read before the click: the durable end can only follow the request, so
    // the log's own timestamp is checked against an instant the gesture precedes.
    const cancelIssuedAt = Date.now()
    await page.getByRole('button', { name: 'Stop generating' }).click()
    const exchange = await readCancelExchange(pending)
    const cancelRepliedAt = Date.now()
    expect(exchange.sessionId).toBe(sessionId)
    expect(await settled).toBe(sessionId)

    const logs = await findSessionLogs(scaffold.persistenceRoot)
    expect(logs).toHaveLength(1)
    const log = await readPersistedLog(logs[0]!)
    expect(log.header.id).toBe(sessionId)
    const types: Record<string, number> = {}
    for (const event of log.events) types[event.type] = (types[event.type] ?? 0) + 1

    const starts = log.events.filter(event => event.type === 'turn/start')
    expect(starts).toHaveLength(1)
    const start = starts[0]!
    const end = onlyTurnEnd(log.events)
    // Same turn: the end names the turn the start opened, and closes it later in
    // the log. `user` is the cause only a user gesture produces.
    expect(start.data.turn).toBe(1)
    expect(end.data.turn).toBe(1)
    expect(end.seq).toBeGreaterThan(start.seq)
    expect(end.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    expect(end.time).toBeGreaterThanOrEqual(cancelIssuedAt)
    // The aborted turn is the one this scenario opened: the prompt is its only
    // user input.
    expect(log.events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])).toEqual([PROMPT])
    // The only output the interrupted turn committed is the parked replay
    // stream's prefix: nothing beyond the chunk it had already streamed.
    expect(log.events.flatMap(event => event.type === 'assistant/message'
      ? event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])).toEqual(['partial'])

    // Written before the remaining assertions so a failing run still leaves the
    // numbers its conclusion would have cited.
    await writeEvidence('transport-evidence.json', {
      sessionId,
      cancel: {
        rpcId: exchange.rpcId,
        issuedAtEpochMs: cancelIssuedAt,
        repliedAtEpochMs: cancelRepliedAt,
        roundTripMs: cancelRepliedAt - cancelIssuedAt,
      },
      persisted: {
        artifact: log.path,
        eventCount: log.events.length,
        types,
        turnStartSeq: start.seq,
        turnStartTimeEpochMs: start.time,
        turnEndSeq: end.seq,
        turnEndTimeEpochMs: end.time,
        turnEndReason: end.data.reason,
        turnEndAfterCancelMs: end.time - cancelIssuedAt,
      },
    })
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('stops requesting a 429 route once its parked retry is cancelled', async () => {
    const server = await startMockLlmServer({
      sequence: ['rate_limit'],
      repeatLast: true,
      retryAfterMs: RETRY_AFTER_MS,
    })
    onTestFinished(() => server.close())
    const overlayDir = await mkdtemp(join(tmpdir(), 'dsh-web-cancel-429-'))
    overrideDir = overlayDir
    const key = credentialRef('DSH_CANCEL_429_KEY')
    const overlay = join(overlayDir, 'cancel-429.yml')
    await writeFile(overlay, JSON.stringify([
      { id: 'llm-deepseek', config: { baseURL: server.baseURL, apiKeyEnv: key } },
      { id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    ]))
    // The shipped normal retry policy stays in place: leaving the defaults is
    // what makes the endpoint's `Retry-After` the delay the loop honours.
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true, extraOverlayPath: overlay })
    await scaffold.ctx.credentials.set(key, 'cancel-429-local-key')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cancel-429'))

    const retries: SessionEvent<'llm/retry'>[] = []
    const offRetry = scaffold.ctx.on('session/event', (_session, event: SessionEvent) => {
      if (event.type === 'llm/retry') retries.push(event)
    })

    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill('Answer with one word, then stop.')
    await input.press('Enter')
    // The first attempt is answered 429 and its retry is scheduled, so the loop
    // now owns a wait it is committed to.
    await expect.poll(() => server.requests.length, { timeout: 30_000 }).toBe(1)
    await expect.poll(() => retries.length, { timeout: 15_000 }).toBe(1)
    const retry = retries[0]!
    // The shipped normal policy is what this scenario relies on: its record is
    // the one carrying the bounded `maxRetries` budget.
    if (retry.type !== 'llm/retry' || retry.data.mode !== 'normal') {
      throw new Error('parked 429 retry is not a normal-mode llm/retry record')
    }
    const scheduled = retry.data
    expect(scheduled.failure.code).toBe('RATE_LIMIT')
    expect(scheduled.failure.status).toBe(429)
    expect(scheduled.failure.providerRetryAfterMs).toBe(RETRY_AFTER_MS)
    expect(scheduled.delayMs).toBe(RETRY_AFTER_MS)
    const scheduledAt = retry.time
    const retryDueAt = scheduledAt + RETRY_AFTER_MS
    expect(server.requests.map(request => request.attempt)).toEqual([1])

    const pending = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/session/cancel'
      && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Stop generating' }).click()
    const exchange = await readCancelExchange(pending)
    const cancelRepliedAt = Date.now()
    const attached = scaffold.ctx.sessions.list()
    expect(attached).toHaveLength(1)
    expect(exchange.sessionId).toBe(attached[0]!.id)
    // The Stop has to land inside the wait, or nothing was interrupted and the
    // countdowns below would prove nothing about cancellation.
    expect(cancelRepliedAt - scheduledAt).toBeLessThan(RETRY_AFTER_MS)
    expect(cancelRepliedAt).toBeLessThan(retryDueAt)
    expect(server.requests.length).toBe(1)
    expect(await settled).toBe(attached[0]!.id)
    offRetry()

    // Past the retry time the loop had already committed to: the route must not
    // be asked again, and the gap grows with each sample.
    const samples: { offsetMs: number; atMs: number; requests: number }[] = []
    for (const offsetMs of COUNT_OFFSETS_MS) {
      const remaining = scheduledAt + offsetMs - Date.now()
      if (remaining > 0) await delay(remaining)
      samples.push({ offsetMs, atMs: Date.now() - scheduledAt, requests: server.requests.length })
    }
    expect(samples.map(sample => sample.requests)).toEqual(COUNT_OFFSETS_MS.map(() => 1))

    const logs = await findSessionLogs(scaffold.persistenceRoot)
    expect(logs).toHaveLength(1)
    const log = await readPersistedLog(logs[0]!)
    expect(log.header.id).toBe(attached[0]!.id)
    const end = onlyTurnEnd(log.events)
    expect(end.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    // A retry was scheduled and never started: the wait the loop committed to
    // was interrupted rather than allowed to expire.
    expect(log.events.filter(event => event.type === 'llm/retry')).toHaveLength(1)
    expect(log.events.filter(event => event.type === 'llm/retry-started')).toHaveLength(0)
    expect(log.events.filter(event => event.type === 'assistant/message')).toHaveLength(0)
    const types: Record<string, number> = {}
    for (const event of log.events) types[event.type] = (types[event.type] ?? 0) + 1
    expect(tripwire.pageErrors).toEqual([])

    await writeEvidence('rate-limit-evidence.json', {
      sessionId: attached[0]!.id,
      cancel: { rpcId: exchange.rpcId, repliedAtEpochMs: cancelRepliedAt },
      retry: {
        retry: scheduled.retry,
        maxRetries: scheduled.maxRetries,
        delayMs: scheduled.delayMs,
        failure: scheduled.failure,
        scheduledAtEpochMs: scheduledAt,
        dueAtEpochMs: retryDueAt,
        cancelledAfterMs: cancelRepliedAt - scheduledAt,
      },
      requestCountdown: samples,
      persisted: {
        artifact: log.path,
        eventCount: log.events.length,
        types,
        turnEndSeq: end.seq,
        turnEndReason: end.data.reason,
      },
    })
  }, 120_000)
})
