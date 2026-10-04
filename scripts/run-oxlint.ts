/** Spawn Oxlint with repository-wide worker bounds after a Typert artifact precondition. */

import { spawnSync } from 'node:child_process'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const oxlintCli = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url))
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024 * 1024
const FIX_FLAGS = new Set(['--fix', '--fix-dangerously', '--fix-suggestions'])
const repoRoot = resolve(import.meta.dirname, '..')

/** Package export keys whose declared files the Typert generator owns. */
const TYPERT_EXPORT_KEYS = ['./typert', './remote'] as const

/** Declaration fields of a Typert export entry, each naming one generated file. */
const TYPERT_EXPORT_FIELDS = ['types', 'default'] as const

/** Command that regenerates every file the `./typert` and `./remote` exports declare. */
const TYPERT_GENERATION_COMMAND = 'pnpm run build:lib:host'

/** Option text that turns off type-aware analysis in an Oxlint config file. */
const TYPE_AWARE_DISABLED = /"typeAware"\s*:\s*false/u

/** One generated file a package export declares and the working tree does not contain. */
export interface MissingTypertArtifact {
  /** Name of the package declaring the export. */
  readonly packageName: string
  /** Export key declaring the files. */
  readonly exportKey: './typert' | './remote'
  /** Declaration field naming the file. */
  readonly field: 'types' | 'default'
  /** Repository-relative declared path with forward slashes. */
  readonly path: string
}

/** Absent declared Typert files, with the command that regenerates them. */
export interface TypertArtifactReport {
  /** Absent files ordered by manifest path, export key, then declaration field. */
  readonly missing: readonly MissingTypertArtifact[]
  /** Command that generates every listed file. */
  readonly generateCommand: string
}

/**
 * Read one export entry as a field-to-path table.
 * @param manifestExports - the package's whole `exports` value.
 * @param key - export key to read.
 * @returns the entry's declared fields, or `undefined` when the key is absent or not a conditions object.
 */
function exportFields(manifestExports: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof manifestExports !== 'object' || manifestExports === null || Array.isArray(manifestExports)) return undefined
  const entry = (manifestExports as Record<string, unknown>)[key]
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined
  return entry as Record<string, unknown>
}

/**
 * Find generated files that a `./typert` or `./remote` export declares and the
 * tree does not contain, so a missing artifact is reported as itself instead of
 * as downstream `error typed` diagnostics. Existence only: a stale artifact that
 * exists is not this check's business.
 * @param root - repository or fixture root holding `packages/<group>/<pkg>`.
 * @returns every absent `types` and `default` file with its package and declaring export, plus the generating command.
 */
export function findMissingTypertArtifacts(root: string): TypertArtifactReport {
  const missing: MissingTypertArtifact[] = []
  const manifests = globSync('packages/*/*/package.json', { cwd: root })
    .map(path => path.split(sep).join('/'))
    .sort()
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8')) as { name?: string; exports?: unknown }
    const packagePath = manifestPath.slice(0, -'/package.json'.length)
    for (const exportKey of TYPERT_EXPORT_KEYS) {
      const fields = exportFields(manifest.exports, exportKey)
      if (fields === undefined) continue
      for (const field of TYPERT_EXPORT_FIELDS) {
        const declared = fields[field]
        if (typeof declared !== 'string' || declared === '') continue
        const path = `${packagePath}/${declared.replace(/^\.\//u, '')}`
        if (existsSync(join(root, path))) continue
        missing.push({ packageName: manifest.name ?? packagePath, exportKey, field, path })
      }
    }
  }
  return { missing, generateCommand: TYPERT_GENERATION_COMMAND }
}

function isFixInvocation(args: readonly string[]): boolean {
  return args.some(arg => FIX_FLAGS.has(arg))
}

function hasOutputFormat(args: readonly string[]): boolean {
  return args.some(arg =>
    arg === '-f'
    || arg.startsWith('-f=')
    || arg === '--format'
    || arg.startsWith('--format='))
}

/** Complete Oxlint child-process arguments and environment. */
export interface OxlintInvocation {
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

/**
 * Apply the repository worker bound to both Oxlint backends.
 * @param args - Oxlint CLI arguments requested by the caller.
 * @param env - Environment inherited by the Oxlint process.
 * @returns the complete CLI arguments and child environment.
 */
export function resolveOxlintInvocation(args: readonly string[], env: NodeJS.ProcessEnv): OxlintInvocation {
  const resolvedArgs = [...args]
  if (env.CI === 'true' && !hasOutputFormat(args)) resolvedArgs.push('--format=default')
  const raw = env.DSH_OXLINT_THREADS
  if (raw === undefined || raw === '') return { args: resolvedArgs, env: { ...env } }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
    throw new Error(`run-oxlint: DSH_OXLINT_THREADS must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  if (args.some(arg => arg === '--threads' || arg.startsWith('--threads='))) {
    throw new Error('run-oxlint: use DSH_OXLINT_THREADS instead of passing --threads directly.')
  }
  return {
    args: [...resolvedArgs, `--threads=${raw}`],
    env: { ...env, GOMAXPROCS: raw },
  }
}

function completeFrom(result: { readonly signal: NodeJS.Signals | null; readonly status: number | null }): void {
  if (result.signal !== null) {
    process.kill(process.pid, result.signal)
    return
  }
  process.exitCode = result.status ?? 1
}

/**
 * Report every Typert artifact a package export declares and the tree lacks.
 * @param root - repository root whose declared artifacts are checked.
 * @returns true when all declared artifacts exist, and prints the absent ones otherwise.
 */
function typertArtifactsPresent(root: string): boolean {
  const { missing, generateCommand } = findMissingTypertArtifacts(root)
  if (missing.length === 0) return true
  console.error(`run-oxlint: ${missing.length} generated Typert file(s) declared in a package exports map are absent:`)
  for (const artifact of missing) {
    console.error(`  ${artifact.packageName} ${artifact.exportKey} ${artifact.field}: ${artifact.path}`)
  }
  console.error(`run-oxlint: run \`${generateCommand}\` to generate them, then re-run this command.`)
  return false
}

/**
 * Read the config file an invocation selects, accepting both CLI spellings.
 * @param args - Oxlint CLI arguments requested by the caller.
 * @returns the selected path, or `undefined` when the default config applies or `--config` carries no value.
 */
function configPathOf(args: readonly string[]): string | undefined {
  for (const [index, arg] of args.entries()) {
    if (arg === '--config') return args[index + 1]
    if (arg.startsWith('--config=')) return arg.slice('--config='.length)
  }
  return undefined
}

/**
 * Read a config file as text.
 * @param path - absolute config path.
 * @returns the file contents, or `undefined` when it cannot be read.
 */
function readConfigText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (_error) {
    // An unreadable or absent config leaves the analysis mode unproven, so the
    // caller falls back to the type-aware default, which is the stricter side.
    return undefined
  }
}

/**
 * Report whether this invocation lints with type-aware analysis, which is the
 * only analysis that consumes a generated declaration and turns its absence into
 * an `error typed` diagnostic. The default `.oxlintrc.json` is type-aware, so a
 * missing `--config` always requires the artifacts; `--config .oxlintrc.staged.json`
 * is the staged pre-commit profile, which turns `typeAware` off and ignores `lib/`,
 * so it must not require artifacts a fresh clone has never generated.
 *
 * The config is matched as text, not parsed: Oxlint configs are JSONC with comments
 * and trailing commas, which `JSON.parse` rejects, and Oxlint resolves `extends`
 * chains that this check does not. The scan therefore answers a narrower question
 * than Oxlint — "does this file itself state `"typeAware": false`" — which is the
 * whole discriminator between the two profiles the repository actually uses. Two
 * cases fall outside it: a single-quoted JSONC key (`'typeAware': false`) and a
 * config that inherits the setting from a parent through `extends` are both missed,
 * which runs the check anyway; and the literal inside a comment or string value
 * would skip it, which is the one direction that under-reports.
 * @param args - Oxlint CLI arguments requested by the caller.
 * @param root - directory the selected config path resolves against.
 * @returns true when the invocation analyzes types and so needs the generated artifacts to exist.
 */
export function requiresTypertArtifacts(args: readonly string[], root: string): boolean {
  const configPath = configPathOf(args)
  if (configPath === undefined) return true
  const text = readConfigText(join(root, configPath))
  return text === undefined || !TYPE_AWARE_DISABLED.test(text)
}

function main(): void {
  const args = process.argv.slice(2)
  if (requiresTypertArtifacts(args, repoRoot) && !typertArtifactsPresent(repoRoot)) {
    process.exitCode = 1
    return
  }
  const invocation = resolveOxlintInvocation(args, process.env)
  if (!isFixInvocation(invocation.args)) {
    const result = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
      env: invocation.env,
      stdio: 'inherit',
    })
    if (result.error !== undefined) throw result.error
    completeFrom(result)
    return
  }

  const first = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
    encoding: 'utf8',
    env: invocation.env,
    maxBuffer: MAX_CAPTURED_OUTPUT_BYTES,
  })
  if (first.error !== undefined) throw first.error
  if (first.signal !== null) {
    completeFrom(first)
    return
  }
  if (first.status === 0) {
    process.stdout.write(first.stdout)
    process.stderr.write(first.stderr)
    process.exitCode = 0
    return
  }

  // Overlapping JS-plugin fixes can expose one more fixable diagnostic after the first pass.
  const second = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
    env: invocation.env,
    stdio: 'inherit',
  })
  if (second.error !== undefined) throw second.error
  completeFrom(second)
}

const entrypoint = process.argv[1]
if (entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url)) main()
