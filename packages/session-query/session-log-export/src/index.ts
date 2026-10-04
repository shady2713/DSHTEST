/** Session-log download command and Host-owned streaming route. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import Schema from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-attachment'
import { bindFileReader, type FileReader } from '@deepseek-ai/dsh-attachment/file-publisher'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  flushLiveSessionLog,
  readSessionLogText,
  sessionLogExportDeps,
  sessionLogZipFilename,
  streamSessionLogZip,
  type SessionLogCompressionLevel,
  type SessionLogExportReady,
} from './archive.ts'
import { SESSION_LOG_EXPORT_PATH } from './routes.ts'

export {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  flushLiveSessionLog,
  readSessionLogText,
  serializeSessionLog,
  SESSION_LOG_FILENAME,
  sessionLogExportDeps,
  sessionLogZipEntries,
  sessionLogZipFilename,
  streamSessionLogZip,
} from './archive.ts'
export type {
  SessionLogCompressionLevel,
  SessionLogExportDeps,
  SessionLogExportReady,
  SessionLogZipEntry,
} from './archive.ts'

export const name = 'session-log-download'
export const inject = ['commands', 'connection', 'attachments']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of authenticated Session archive downloads. */
    sessionLogExports: SessionLogExports
  }
}

export { SESSION_LOG_EXPORT_PATH } from './routes.ts'

/** Session-log archive policy. */
export interface Config {
  /** DEFLATE level for each ZIP entry. @default 6 */
  readonly compressionLevel?: SessionLogCompressionLevel
}

/** Validate Session-log archive configuration. */
export const Config: Schema<Config> = Schema.object({
  compressionLevel: Schema.number().step(1).min(0).max(9)
    .default(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL) as Schema<SessionLogCompressionLevel>,
})

interface SessionLogConnection {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD')[]
      readonly requestBody: 'buffered'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

const REQUESTED: CommandResult = {
  kind: 'success',
  text: 'Session log download requested.',
}

/**
 * Register the Web-only `/export` command and authenticated ZIP download route.
 * @param ctx - Host context carrying the human-command registry.
 * @param config - resolved compression policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  new SessionLogExports(ctx, config)
}

/** Owns the download route and drains its protected file readers before teardown. */
export class SessionLogExports extends Service {
  /**
   * @param ctx - Host context carrying the command and authenticated Fetch registries.
   * @param config - resolved archive compression policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'sessionLogExports')
    const active = new Map<AbortController, Promise<void>>()
    const releaseFailures: Error[] = []
    let closing = false
    let draining: Promise<void> | undefined
    const drain = async (): Promise<void> => {
      closing = true
      for (const controller of active.keys()) controller.abort(new Error('session log exporter is closing'))
      await Promise.allSettled([...active.values()])
      if (releaseFailures.length > 0) throw new AggregateError(releaseFailures, 'Session log export read protection cleanup failed.')
    }
    const reader = bindFileReader(ctx, () => draining ??= drain())
    ctx.effect(() => ctx.commands.register({
      definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-session-log-export'),
      name: 'export',
      description: 'Download this Session log as a ZIP archive',
      handler: invocation => Promise.resolve(invocation.rawInput.trim() === ''
        ? REQUESTED
        : { kind: 'error', text: 'The Web /export command does not accept a path.' }),
    }), 'session-log-download: command')
    ctx.effect(() => connectionOf(ctx).fetch.register({
      path: SESSION_LOG_EXPORT_PATH,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (closing) return new Response('session log exporter is closing', { status: 503 })
        const controller = new AbortController()
        let finish: (cleanupError?: Error) => void = () => {}
        const completed = new Promise<void>((resolve) => {
          finish = (cleanupError) => {
            if (cleanupError !== undefined) releaseFailures.push(cleanupError)
            active.delete(controller)
            resolve()
          }
        })
        active.set(controller, completed)
        let streaming = false
        try {
          const response = await sessionLogExportResponse(
            ctx,
            new Request(request, { signal: AbortSignal.any([request.signal, controller.signal]) }),
            config.compressionLevel ?? DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
            reader,
            finish,
          )
          streaming = response.headers.get('content-type') === 'application/zip'
          if (request.method === 'GET') return response
          await response.body?.cancel()
          return new Response(null, { status: response.status, headers: response.headers })
        } finally {
          if (!streaming) finish()
        }
      },
    }), 'session-log-download: route')
  }
}

function connectionOf(ctx: Context): SessionLogConnection {
  return Reflect.get(ctx, 'connection') as SessionLogConnection
}

async function sessionLogExportResponse(
  ctx: Context,
  request: Request,
  compressionLevel: SessionLogCompressionLevel,
  fileReader: FileReader,
  onFinished: (cleanupError?: Error) => void,
): Promise<Response> {
  const url = new URL(request.url)
  const query = Object.fromEntries(url.searchParams)
  const sessionIdValue = query['sessionId']
  const descendantsValue = query['includeDescendants']
  if (sessionIdValue === undefined || sessionIdValue.length === 0
    || (descendantsValue !== undefined && descendantsValue !== 'true' && descendantsValue !== 'false')) {
    return new Response('missing or invalid sessionId query parameter', { status: 400 })
  }
  const sessionId = brandString<SessionId>(sessionIdValue)
  const deps = sessionLogExportDeps(ctx)
  if (deps.sessionQuery === undefined
    || deps.sessionPersistence === undefined
    || deps.attachments === undefined) {
    return new Response(
      'session log export is unavailable: missing session-query, session-persistence, or attachments service',
      { status: 500 },
    )
  }
  const ready: SessionLogExportReady = {
    sessionQuery: deps.sessionQuery,
    sessionPersistence: deps.sessionPersistence,
    attachments: deps.attachments,
    sessions: deps.sessions,
    fileReader,
  }
  let rootContent: string | undefined
  try {
    await flushLiveSessionLog(deps, sessionId, request.signal)
    rootContent = await readSessionLogText(deps.sessionPersistence, sessionId, request.signal)
    request.signal.throwIfAborted()
  } catch {
    request.signal.throwIfAborted()
    // Root preparation failure (flush, open, or read): answer 500 without
    // echoing the error, which may carry absolute host paths into the
    // browser error bar.
    return new Response('session log export failed to read the stored log', { status: 500 })
  }
  if (rootContent === undefined) {
    return new Response('session not found', { status: 404 })
  }
  const response = new Response(
    streamSessionLogZip(
      ready,
      rootContent,
      sessionId,
      descendantsValue === 'true',
      compressionLevel,
      request.signal,
      onFinished,
    ),
    {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${sessionLogZipFilename(sessionId)}"`,
      },
    },
  )
  return response
}
