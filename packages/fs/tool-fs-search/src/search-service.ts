/** Structured, read-only search requests and the packaged ripgrep provider. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { buildGlobCommand, parseGlobArgs, type GlobInput } from './glob.ts'
import { buildGrepCommand, parseGrepArgs, type GrepInput } from './grep.ts'
import { runRipgrep, type RipgrepRun } from './search-core.ts'

/** A search selects files or searches their contents; callers supply no process options. */
export type ReadonlySearchRequest =
  | { readonly kind: 'glob'; readonly input: GlobInput }
  | { readonly kind: 'grep'; readonly input: GrepInput }

/** The session owns the workspace and project identity; cancellation belongs to this call. */
export interface SearchExecution {
  /** Calling session, absent for a direct plugin invocation. */
  readonly session?: Session
  /** Cancellation and the caller's timeout. */
  readonly signal: AbortSignal
}

/** Resolved process capture and termination limits. */
export interface SearchProcessCaps {
  /** Maximum complete stdout bytes. */
  readonly rawOutputMaxBytes: number
  /** Termination escalation interval in milliseconds. */
  readonly graceMs: number
  /** Retained stderr bytes. */
  readonly stderrMaxBytes: number
}

/** Facts attached only to arguments constructed by the live packaged provider. */
export interface SearchInvocation {
  /** Whether the operation reads contents or lists paths. */
  readonly kind: ReadonlySearchRequest['kind']
  /** Explicit project actor, or null for an unbound direct invocation. */
  readonly sessionId: Session['id'] | null
  /** Requested path, relative to the session workspace when not absolute. */
  readonly path: string
}

const argumentsOwners = new WeakMap<readonly string[], SearchInvocation>()

/** Resolve input validation and the default search target before execution. */
function resolveSearch(request: ReadonlySearchRequest): { argv: string[]; path: string } {
  switch (request.kind) {
    case 'glob': {
      const input = parseGlobArgs(request.input)
      return { argv: buildGlobCommand(input), path: input.path ?? '.' }
    }
    case 'grep': {
      const input = parseGrepArgs(request.input)
      return { argv: buildGrepCommand(input), path: input.path ?? '.' }
    }
    /* v8 ignore start -- closed request union is exhausted above */
    default: {
      const unreachable: never = request
      throw new Error(`unsupported read-only search: ${JSON.stringify(unreachable)}`)
    }
    /* v8 ignore stop */
  }
}

/**
 * Consume provider-owned arguments once. This operation cannot register arguments.
 * @param argv - Arguments about to be used by the process runner.
 * @returns Their owner, absent for arbitrary or previously consumed arguments.
 * @internal
 */
export function consumeSearchArguments(argv: readonly string[]): SearchInvocation | undefined {
  const owner = argumentsOwners.get(argv)
  argumentsOwners.delete(argv)
  return owner
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fsSearch: ReadonlySearch
  }
}

/** Service Definition for structured file discovery and content search. */
export abstract class ReadonlySearch extends Service {
  /**
   * Execute one read-only search with fixed process options.
   * @param request - Validated glob or grep input.
   * @param execution - Session identity, workspace, and cancellation.
   * @param caps - Resolved capture and termination limits.
   * @returns Complete raw search output and its workspace.
   */
  abstract search(request: ReadonlySearchRequest, execution: SearchExecution, caps: SearchProcessCaps): Promise<RipgrepRun>
}

/** Provider that constructs fixed argv for the packaged ripgrep binary. */
export class PackagedReadonlySearch extends ReadonlySearch {
  static inject = ['subprocess']

  private readonly lifetime = new AbortController()

  private readonly running = new Set<Promise<RipgrepRun>>()

  /** @param ctx - Context providing the managed subprocess runtime. */
  constructor(ctx: Context) {
    super(ctx, 'fsSearch')
    ctx.effect(() => async () => {
      this.lifetime.abort()
      await Promise.allSettled(this.running)
    }, 'fsSearch.owner')
  }

  /** @inheritdoc */
  async search(request: ReadonlySearchRequest, execution: SearchExecution, caps: SearchProcessCaps): Promise<RipgrepRun> {
    const { argv, path } = resolveSearch(request)
    argumentsOwners.set(argv, Object.freeze({
      kind: request.kind,
      sessionId: execution.session?.id ?? null,
      path,
    }))
    const running = runRipgrep(this.ctx, {
      signal: AbortSignal.any([execution.signal, this.lifetime.signal]),
      ...execution.session === undefined ? {} : { agent: { session: execution.session } },
    }, request.kind, argv, caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
    this.running.add(running)
    try {
      return await running
    } finally {
      this.running.delete(running)
    }
  }
}
