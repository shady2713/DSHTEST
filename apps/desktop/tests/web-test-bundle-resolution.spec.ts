/**
 * The Web testing composition layer is named by a module the Desktop main bundle
 * inlines, so its resolved paths are only correct if the package survives being
 * inlined. `typecheck` and the source-level tests cannot see this: the workspace
 * `paths` mapping makes every source run load the package as itself, and only the
 * built bundle moves the module's own location. These tests bundle the real
 * source the way the main bundle does, place each bundle where a bundle of it
 * actually runs, and read the resolved layer and entry back from the built file.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Rolldown } from 'tsdown'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Absolute root of the Web testing package's own install in this checkout. */
const PACKAGE_ROOT = fileURLToPath(new URL('../../../packages/web-test/web-test', import.meta.url))
/** Composition layer the packaged application must be handed, inside that install. */
const LAYER = join(PACKAGE_ROOT, 'web-test.cordis.patch.yml')
/** Built entry the layer mounts, inside that install. */
const ENTRY = join(PACKAGE_ROOT, 'lib', 'index.js')
/** Desktop application root, whose `package.json` a bundle inside `lib/` names instead. */
const DESKTOP_ROOT = fileURLToPath(new URL('..', import.meta.url))
/** Directory the Desktop main bundle is written to, whose imports resolve through `node_modules`. */
const DESKTOP_LIB = join(DESKTOP_ROOT, 'lib')

/** Bundle the real source the way the main bundle does, and return the built file's text. */
async function bundleApplicationSource(): Promise<string> {
  const bundle = await Rolldown.rolldown({
    input: join(PACKAGE_ROOT, 'src', 'application.ts'),
    platform: 'node',
    // The main bundle leaves bare specifiers to the runtime and inlines what it
    // can resolve, so leaving them external measures this package's own
    // resolution rather than another workspace package's build output.
    external: id => !id.startsWith('.') && !isAbsolute(id),
    logLevel: 'silent',
  })
  try {
    const { output } = await bundle.generate({ format: 'esm' })
    const entry = output.find(chunk => chunk.type === 'chunk')
    if (entry === undefined) throw new Error('web-test bundle: the bundle produced no entry chunk')
    return entry.code
  } finally {
    await bundle.close()
  }
}

/** What the bundled module resolved, read back from a process that loaded the built file. */
interface ResolvedInstall {
  /** `file:` URL of the built entry. */
  readonly entryUrl: string
  /** Absolute path of the composition layer. */
  readonly compositionLayerPath: string
  /** Version read from the manifest it resolved. */
  readonly version: string
}

/** Write a runner beside the built module that reports what the module resolved. */
function runner(directory: string): string {
  const path = join(directory, 'runner.mjs')
  writeFileSync(path, [
    'const { resolveWebTestApplication } = await import(\'./web-test-application.js\')',
    'const application = resolveWebTestApplication({ base: process.cwd() })',
    'process.stdout.write(JSON.stringify({',
    '  entryUrl: application.entryUrl,',
    '  compositionLayerPath: application.compositionLayerPath,',
    '  version: application.version,',
    '}))',
    '',
  ].join('\n'))
  return path
}

let builtCode = ''

/** Every path and directory this spec created, removed after the run. */
const created: string[] = []

/**
 * Place the built module in `directory` and run it in its own process, so the
 * paths it reports come from a loaded bundle rather than from a source module.
 * @param directory - where the built module is written; it sets its `import.meta.url`.
 * @returns the paths the bundled module resolved for its own install.
 */
function resolveFromBundleIn(directory: string): ResolvedInstall {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'web-test-application.js'), builtCode)
  const path = runner(directory)
  created.push(path, join(directory, 'web-test-application.js'))
  return JSON.parse(execFileSync(process.execPath, [path], { encoding: 'utf8' })) as ResolvedInstall
}

beforeAll(async () => {
  builtCode = await bundleApplicationSource()
})

afterAll(() => {
  for (const path of created.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('the web-test module inlined into the Desktop main bundle', () => {
  it('resolves this package\'s own layer and entry, not the importing application\'s', () => {
    // The main bundle writes its entry straight into `lib/`, so a copy of it
    // there puts this module exactly where the defect put it: two directories
    // below the Desktop application, whose `package.json` declares another
    // package and whose `lib/` holds no `index.js` of this application's.
    const resolved = resolveFromBundleIn(DESKTOP_LIB)

    expect(resolved.compositionLayerPath).toBe(LAYER)
    expect(resolved.entryUrl).toBe(pathToFileURL(ENTRY).href)
    expect(resolved.version).toBe(
      (JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version: string }).version,
    )
    // Both paths the inlined derivation produced, one of which is the reported
    // `dsh: failed to read overlay ...\apps\desktop\web-test.cordis.patch.yml`.
    expect(resolved.compositionLayerPath).not.toBe(join(DESKTOP_ROOT, 'web-test.cordis.patch.yml'))
    expect(resolved.entryUrl).not.toBe(pathToFileURL(join(DESKTOP_LIB, 'index.js')).href)
  })

  it('resolves this package\'s own install from a bundle nested deeper than the main bundle writes', () => {
    const directory = mkdtempSync(join(DESKTOP_LIB, 'web-test-bundle-'))
    created.push(directory)
    // A directory holding no manifest names no install at all rather than a
    // neighbour's, which is the other way the module's own location fails.
    const resolved = resolveFromBundleIn(directory)

    expect(resolved.compositionLayerPath).toBe(LAYER)
  })

  it('refuses to resolve when neither the module\'s own directory nor its importer names this package', () => {
    const root = mkdtempSync(join(tmpdir(), 'web-test-undeclared-'))
    created.push(root)
    // The bundle's other workspace import is declared here; this package is not.
    // That is the shape of an application that inlined the module without
    // declaring it.
    const brand = join(root, 'node_modules', '@deepseek-ai', 'dsh-brand')
    mkdirSync(brand, { recursive: true })
    writeFileSync(join(brand, 'package.json'), `${JSON.stringify({ name: '@deepseek-ai/dsh-brand', version: '0.0.0', type: 'module', main: 'index.js' })}\n`)
    writeFileSync(join(brand, 'index.js'), `export { brandString } from ${JSON.stringify(import.meta.resolve('@deepseek-ai/dsh-brand'))}\n`)
    const directory = join(root, 'app')
    mkdirSync(directory)
    writeFileSync(join(directory, 'web-test-application.js'), builtCode)
    const path = runner(directory)

    // The shipped layer cannot be read, so resolution is refused with the
    // declaration it needs, never answered with a path that names no such file.
    let reported = ''
    try {
      execFileSync(process.execPath, [path], { encoding: 'utf8', stdio: 'pipe' })
    } catch (error) {
      const child = error as { stderr?: string; message?: string }
      reported = child.stderr ?? child.message ?? ''
    }
    expect(reported).toMatch(/@deepseek-ai\/dsh-web-test is installed neither beside .*web-test-application\.js/u)
    expect(reported).toMatch(/must declare @deepseek-ai\/dsh-web-test in its own dependencies/u)
  })
})
