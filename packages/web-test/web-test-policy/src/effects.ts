/**
 * The closed catalogue of effects an entry path can have, and the adapters that
 * reduce one entry path's call to exactly one of them.
 *
 * An effect is the only thing a decision is made about. An adapter that does not
 * recognise its call returns `null`, and `null` is a denial: a tool this package
 * has no adapter for is refused rather than waved through, which is what makes a
 * tool registered mid-session subject to the same policy on its next call
 * without anything having to notice the registration.
 *
 * The adapters read only the call's own arguments. They never resolve a path
 * through the filesystem, because a relative argument resolves against the
 * filesystem backend's configured working directory — a fact the abstract
 * `FileSystem` Service Definition does not expose and a synchronous tool guard
 * cannot ask for. A relative or absent path therefore yields `null` and is
 * refused by these adapters. Search has an actor-aware adapter in the policy
 * service that resolves its Session workspace and checks its canonical target.
 *
 * @module @deepseek-ai/dsh-web-test-policy/effects
 */

/** What one entry path would do, reduced to the facts a decision reads. */
export type WebTestEffect =
  /** Read a file's content under the tested code root. */
  | {
    /** Always `'read-source'` on this branch. */
    readonly kind: 'read-source'
    /** Absolute path the read would open. */
    readonly path: string
  }
  /** Enumerate names under the tested code root without reading content. */
  | {
    /** Always `'list-source'` on this branch. */
    readonly kind: 'list-source'
    /** Absolute path the listing would enumerate. */
    readonly path: string
  }
  /** Create or replace a file under the tested code root. */
  | {
    /** Always `'write-source'` on this branch. */
    readonly kind: 'write-source'
    /** Absolute path the write would create or replace. */
    readonly path: string
  }
  /** Change part of a file under the tested code root. */
  | {
    /** Always `'edit-source'` on this branch. */
    readonly kind: 'edit-source'
    /** Absolute path the edit would change. */
    readonly path: string
  }
  /** Retrieve one URL through the web capability. */
  | {
    /** Always `'fetch-web'` on this branch. */
    readonly kind: 'fetch-web'
    /** Absolute URL the fetch would retrieve. */
    readonly url: string
  }
  /** Send a query to a search provider. */
  | {
    /** Always `'search-web'` on this branch. */
    readonly kind: 'search-web'
    /** Search terms the request would send. */
    readonly queries: readonly string[]
  }
  /** Store material the user uploaded into the protected material directories. */
  | {
    /** Always `'write-upload'` on this branch; the target directory is the effect. */
    readonly kind: 'write-upload'
  }
  /** Read material the protected material directories hold. */
  | {
    /** Always `'read-upload'` on this branch; the source directory is the effect. */
    readonly kind: 'read-upload'
  }
  /** Derive a process. */
  | {
    /** Always `'spawn-process'` on this branch. */
    readonly kind: 'spawn-process'
    /** Command line the spawn would run. */
    readonly command: string
  }
  /** Use the persistent terminal capability in any of its operations. */
  | {
    /** Always `'use-terminal'` on this branch; every terminal operation carries it. */
    readonly kind: 'use-terminal'
  }

/** Every effect kind, as the closed set the configuration and adapters name. */
export const WEB_TEST_EFFECT_KINDS = [
  'read-source',
  'list-source',
  'write-source',
  'edit-source',
  'fetch-web',
  'search-web',
  'write-upload',
  'read-upload',
  'spawn-process',
  'use-terminal',
] as const

/**
 * Reduce one effect to the single string a decision reports as its subject, so a
 * denial names the field or path it was made against.
 * @param effect - the effect being decided.
 * @returns the subject the decision reports.
 */
export function effectSubject(effect: WebTestEffect): string {
  switch (effect.kind) {
    case 'read-source':
    case 'list-source':
    case 'write-source':
    case 'edit-source':
      return effect.path
    case 'fetch-web':
      return effect.url
    case 'search-web':
      return effect.queries.join(' | ')
    case 'spawn-process':
      return effect.command
    case 'write-upload':
    case 'read-upload':
    case 'use-terminal':
      return effect.kind
    /* v8 ignore start -- closed-union exhaustiveness guard */
    default:
      return assertNever(effect)
    /* v8 ignore stop */
  }
}

/**
 * Fail on a value the closed {@link WebTestEffect} union does not contain.
 * @param value - the value that reached the end of an exhaustive switch.
 * @returns never; it throws naming the closed union.
 */
/* v8 ignore start -- unreachable without a TypeScript contract violation */
function assertNever(value: never): never {
  throw new Error(`web testing policy: unrecognised effect ${JSON.stringify(value)}`)
}
/* v8 ignore stop */

/**
 * Read one absolute path argument. A relative or absent argument names no
 * target this package can canonically resolve, so it is refused rather than
 * resolved against a guessed working directory.
 * @param arguments_ - the call's frozen argument record.
 * @param field - the argument name holding the path.
 * @returns the absolute path, or `null` when the argument is absent or relative.
 */
function absolutePathArgument(arguments_: Readonly<Record<string, unknown>>, field: string): string | null {
  const value = arguments_[field]
  if (typeof value !== 'string' || value.length === 0) return null
  // `C:\…`, `C:/…`, `\\server\share`, and `/…` are the four absolute spellings
  // the harness accepts; everything else resolves against a working directory
  // this package cannot see.
  if (value.startsWith('/')) return value
  if (value.startsWith('\\\\')) return value
  if (/^[A-Za-z]:[/\\]/u.test(value)) return value
  return null
}

/**
 * Read one non-empty string argument.
 * @param arguments_ - the call's frozen argument record.
 * @param field - the argument name holding the string.
 * @returns the string, or `null` when the argument is absent or empty.
 */
function stringArgument(arguments_: Readonly<Record<string, unknown>>, field: string): string | null {
  const value = arguments_[field]
  if (typeof value !== 'string' || value.length === 0) return null
  return value
}

/**
 * Reduce `str_replace_editor`'s command argument to the effect it performs. The
 * one editor entry path in the base bundle is a switch over four commands, and
 * three of the four change the file, so the command is the effect rather than an
 * argument beside it. `view` returns a file's content, so it is a read and not an
 * enumeration: classifying it as a listing would have admitted a content read
 * under the confirmation policy a listing is not subject to.
 * @param arguments_ - the call's frozen argument record.
 * @returns the effect, or `null` for a command this package does not implement.
 */
function editorEffect(arguments_: Readonly<Record<string, unknown>>): WebTestEffect | null {
  const path = absolutePathArgument(arguments_, 'path')
  if (path === null) return null
  switch (stringArgument(arguments_, 'command')) {
    case 'view':
      return { kind: 'read-source', path }
    case 'create':
      return { kind: 'write-source', path }
    case 'str_replace':
    case 'insert':
      return { kind: 'edit-source', path }
    /* v8 ignore next 2 -- the tool's own enum rejects any other command first */
    default:
      return null
  }
}

/**
 * Reduce `web_search`'s query list to one effect. The whole call is decided as a
 * unit, so every query in it must be covered by the third-party authorization
 * the decision reads; none of them is treated as representative of the others.
 * @param arguments_ - the call's frozen argument record.
 * @returns the effect, or `null` when the argument is not a non-empty string list.
 */
function searchEffect(arguments_: Readonly<Record<string, unknown>>): WebTestEffect | null {
  const values: readonly unknown[] = arguments_['queries'] as readonly unknown[]
  if (!Array.isArray(values) || values.length === 0) return null
  const queries: string[] = []
  for (const query of values) {
    if (typeof query !== 'string' || query.length === 0) return null
    queries.push(query)
  }
  return { kind: 'search-web', queries }
}

/**
 * One tool name and the adapter that reduces its call to an effect.
 * @param effect - the adapter; `null` refuses the call.
 */
interface ToolAdapter {
  /** The adapter itself. */
  readonly effect: (arguments_: Readonly<Record<string, unknown>>) => WebTestEffect | null
}

/**
 * Build a single-path effect from the argument one tool names its target in.
 * @param kind - the effect kind the tool performs.
 * @param arguments_ - the call's frozen argument record.
 * @param field - the argument name holding the path.
 * @returns the effect, or `null` when the tool named no absolute path.
 */
function pathEffect(
  kind: 'read-source' | 'list-source' | 'write-source' | 'edit-source',
  arguments_: Readonly<Record<string, unknown>>,
  field: string,
): WebTestEffect | null {
  const path = absolutePathArgument(arguments_, field)
  return path === null ? null : { kind, path }
}

/** Effects the tool registry's own names are known to produce. */
const TOOL_ADAPTERS: ReadonlyMap<string, ToolAdapter> = new Map<string, ToolAdapter>([
  ['read', { effect: a => pathEffect('read-source', a, 'file_path') }],
  ['read_image', { effect: a => pathEffect('read-source', a, 'file_path') }],
  ['glob', { effect: a => pathEffect('list-source', a, 'path') }],
  ['grep', { effect: a => pathEffect('read-source', a, 'path') }],
  ['write', { effect: a => pathEffect('write-source', a, 'file_path') }],
  ['edit', { effect: a => pathEffect('edit-source', a, 'file_path') }],
  ['str_replace_editor', { effect: editorEffect }],
  ['web_fetch', {
    effect: (a) => {
      const url = stringArgument(a, 'url')
      return url === null ? null : { kind: 'fetch-web', url }
    },
  }],
  ['web_search', { effect: searchEffect }],
  ['bash', {
    effect: (a) => {
      const command = stringArgument(a, 'command')
      return command === null ? null : { kind: 'spawn-process', command }
    },
  }],
  ['pwsh', {
    effect: (a) => {
      const command = stringArgument(a, 'command')
      return command === null ? null : { kind: 'spawn-process', command }
    },
  }],
  ['terminal_open', { effect: () => ({ kind: 'use-terminal' }) }],
  ['terminal_send', { effect: () => ({ kind: 'use-terminal' }) }],
  ['terminal_read', { effect: () => ({ kind: 'use-terminal' }) }],
  ['terminal_signal', { effect: () => ({ kind: 'use-terminal' }) }],
  ['terminal_close', { effect: () => ({ kind: 'use-terminal' }) }],
  ['terminal_list', { effect: () => ({ kind: 'use-terminal' }) }],
])

/**
 * Reduce one model-initiated tool call to the effect it would have.
 * @param name - the tool name as registered in the registry.
 * @param arguments_ - the call's frozen, losslessly JSON-serialized arguments.
 * @returns the effect, or `null` when this package recognises no adapter for the
 * call — a hot-enabled tool, a tool from a package this deployment does not
 * ship, and a malformed argument set are all refused the same way.
 */
export function toolEffect(name: string, arguments_: Readonly<Record<string, unknown>>): WebTestEffect | null {
  return TOOL_ADAPTERS.get(name)?.effect(arguments_) ?? null
}

/**
 * Every tool name this package has an adapter for, so a caller can report which
 * entry paths the policy actually covers rather than assuming coverage.
 * @returns the adapter table's tool names, sorted.
 */
export function adaptedToolNames(): readonly string[] {
  return [...TOOL_ADAPTERS.keys()].sort()
}
