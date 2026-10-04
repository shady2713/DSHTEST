/** Real packaged searches retain the policy's source scope and process backstop. */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import { WebTestContracts } from '@deepseek-ai/dsh-web-test-contracts'
import { SystemClock, WebTestPolicy, WebTestRuntimeScope } from '../src/index.ts'
import { declarationRequest, projectId, publishedScope } from './harness.ts'

const caps = { rawOutputMaxBytes: 1_000_000, graceMs: 100, stderrMaxBytes: 4096 }

/** Every filesystem path and process is owned by this test's context. */
async function start(actions = 20) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-policy-search-'))
  const codeRoot = join(root, 'code')
  const secondRoot = join(root, 'code-two')
  const outside = join(root, 'outside')
  const privateRoot = join(root, 'private')
  for (const path of [codeRoot, secondRoot, outside, privateRoot]) mkdirSync(path)
  writeFileSync(join(codeRoot, 'app.ts'), 'export const publicNeedle = 42\n')
  writeFileSync(join(secondRoot, 'api.ts'), 'export const secondNeedle = 42\n')
  writeFileSync(join(outside, 'outside.ts'), 'outsideNeedle\n')
  writeFileSync(join(privateRoot, 'private.ts'), 'privateNeedle\n')
  symlinkSync(outside, join(codeRoot, 'escape'), 'junction')
  symlinkSync(privateRoot, join(codeRoot, 'private-link'), 'junction')
  symlinkSync(join(outside, 'outside.ts'), join(codeRoot, 'linked.ts'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalSubprocessRuntime)
  const searchFiber = await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: false })
  await ctx.plugin(WebTestContracts)
  await ctx.plugin(SystemClock)
  const published = publishedScope(1, [codeRoot, secondRoot])
  await ctx.plugin({ name: 'search-scope', apply(inner: Context) {
    new WebTestRuntimeScope(inner, { readProject: id => id === projectId ? published : undefined })
  } })
  await ctx.plugin(WebTestPolicy, {
    protectedPaths: [{ path: privateRoot, role: 'temporary-material' }],
    confirmationRequiredFor: [],
  })
  const session = ctx.sessions.create(undefined, { meta: { cwd: codeRoot } })
  ctx.webTestPolicy.bindEntry(session.id, projectId)
  ctx.webTestPolicy.declareEnvironment(declarationRequest([codeRoot, secondRoot]))
  ctx.webTestPolicy.grantFlow({ sessionId: session.id, flowId: 'search', flowRevision: 1, thirdParty: false, actions })
  const search = ctx.get('fsSearch')
  if (search === undefined) throw new Error('missing search provider')
  let sequence = 0
  return {
    ctx, root, codeRoot, secondRoot, outside, privateRoot, session, search, searchFiber,
    call: (name: string, pattern: string, path: string) => ctx.tools.execute({
      name, arguments: { pattern, path }, callId: ToolCallId(`search-${++sequence}`), signal: new AbortController().signal,
    }),
    stop: async () => { await ctx.fiber.dispose(); rmSync(root, { recursive: true, force: true }) },
  }
}

describe('read-only search authority', () => {
  it('runs registered glob and grep against both confirmed roots without traversing links', async () => {
    const app = await start()
    try {
      const glob = await app.call('glob', '**/*.ts', app.codeRoot)
      expect(glob.isError).toBe(false)
      const text = JSON.stringify(glob.content)
      expect(text).toContain('app.ts')
      expect(text).not.toMatch(/outside\.ts|private\.ts|linked\.ts/u)
      const grep = await app.call('grep', 'Needle', app.codeRoot)
      expect(grep.isError).toBe(false)
      expect(JSON.stringify(grep.content)).toContain('publicNeedle')
      expect(JSON.stringify(grep.content)).not.toMatch(/privateNeedle|outsideNeedle/u)
      expect((await app.call('grep', 'secondNeedle', app.secondRoot)).isError).toBe(false)
      const direct = await app.search.search({ kind: 'glob', input: { pattern: '*.ts' } }, {
        session: app.session, signal: new AbortController().signal,
      }, caps)
      expect(direct.stdout).toContain('app.ts')
    } finally { await app.stop() }
  })

  it('refuses private, parent traversal, explicit symlink files and junction targets before spawning', async () => {
    const app = await start()
    try {
      const runtime = app.ctx.subprocess
      const original = runtime.spawn.bind(runtime)
      let spawns = 0
      runtime.spawn = (spec) => { spawns += 1; return original(spec) }
      for (const target of [app.privateRoot, join(app.codeRoot, '..', 'outside'), join(app.codeRoot, 'escape'), join(app.codeRoot, 'escape', 'outside.ts'), join(app.codeRoot, 'linked.ts')]) {
        for (const name of ['glob', 'grep']) expect((await app.call(name, 'Needle', target)).isError).toBe(true)
        await expect(app.search.search({ kind: 'grep', input: { pattern: 'Needle', path: target } }, {
          session: app.session, signal: new AbortController().signal,
        }, caps)).rejects.toThrow('could not start')
      }
      // Direct search calls reach the backstop; tool refusals never launch a process.
      expect(spawns).toBe(5)
    } finally { await app.stop() }
  })

  it('spends one action at execution and rejects copied or reused search specs and arbitrary processes', async () => {
    const app = await start(1)
    try {
      const runtime = app.ctx.subprocess
      const guarded = runtime.spawn.bind(runtime)
      let captured: SubprocessSpawnSpec | undefined
      runtime.spawn = (spec) => { captured = spec; return guarded(spec) }
      expect((await app.call('glob', '*.ts', app.codeRoot)).isError).toBe(false)
      if (captured === undefined) throw new Error('search never spawned')
      const spec = captured
      expect(() => guarded(spec)).toThrow('denied')
      expect(() => guarded({ ...spec })).toThrow('denied')
      expect((await app.call('grep', 'Needle', app.codeRoot)).isError).toBe(true)
      const sentinel = join(app.root, 'spawned')
      expect(() => guarded({ ...spec, argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'bad')`] })).toThrow('denied')
      expect(existsSync(sentinel)).toBe(false)
    } finally { await app.stop() }
  })

  it('removes ambient preprocessor configuration and loader environment from genuine searches', async () => {
    const app = await start()
    const previous = process.env.RIPGREP_CONFIG_PATH
    const config = join(app.root, 'rg.conf')
    writeFileSync(config, '--pre=does-not-exist\n')
    process.env.RIPGREP_CONFIG_PATH = config
    try {
      const runtime = app.ctx.subprocess
      const guarded = runtime.spawn.bind(runtime)
      let captured: SubprocessSpawnSpec | undefined
      runtime.spawn = (spec) => { captured = spec; return guarded(spec) }
      expect((await app.call('grep', 'publicNeedle', app.codeRoot)).isError).toBe(false)
      expect(captured?.env?.RIPGREP_CONFIG_PATH).toBeUndefined()
      expect(captured?.argv).toContain('--no-config')
      expect(captured?.argv).toContain('--no-follow')
      expect(Object.values(captured?.env ?? {}).filter(value => value !== undefined).sort()).toEqual(
        (process.platform === 'win32' ? [process.env.SystemRoot, 'C'] : ['C']).sort(),
      )
    } finally {
      if (previous === undefined) delete process.env.RIPGREP_CONFIG_PATH
      else process.env.RIPGREP_CONFIG_PATH = previous
      await app.stop()
    }
  })

  it.each(['caller', 'provider'] as const)('settles the real process when cancellation comes from %s', async (owner) => {
    const app = await start()
    try {
      writeFileSync(join(app.codeRoot, 'large.txt'), 'safe line\n'.repeat(5_000_000))
      const runtime = app.ctx.subprocess
      const guarded = runtime.spawn.bind(runtime)
      const started = Promise.withResolvers<SubprocessHandle>()
      runtime.spawn = (spec) => {
        const handle = guarded(spec)
        started.resolve(handle)
        return handle
      }
      const controller = new AbortController()
      const pending = app.search.search({ kind: 'grep', input: { pattern: 'missingNeedle' } }, {
        session: app.session, signal: controller.signal,
      }, caps)
      const rejected = expect(pending).rejects.toMatchObject({ code: 'SEARCH_ABORTED' })
      const handle = await started.promise
      if (owner === 'caller') controller.abort()
      else await app.searchFiber.dispose()
      await rejected
      await Promise.allSettled([handle.done])
      expect(await handle.waitForExit(AbortSignal.timeout(5000))).toBe(true)
      if (owner === 'provider') {
        expect(app.ctx.get('fsSearch')).toBeUndefined()
        expect(app.ctx.tools.get('glob')).toBeUndefined()
        await expect(app.search.search({ kind: 'glob', input: { pattern: '*' } }, {
          session: app.session, signal: new AbortController().signal,
        }, caps)).rejects.toMatchObject({ code: 'SEARCH_ABORTED' })
      }
    } finally { await app.stop() }
  })
})
