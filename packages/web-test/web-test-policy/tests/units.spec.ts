/**
 * The pure helpers the decision is built from: the effect catalogue and its
 * adapters, path and origin canonicalization, and the host clock.
 */

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  adaptedToolNames, comparablePath, effectSubject, isInside, originOf, resolvePath, sessionIdOf, SystemClock, toolEffect,
  WEB_TEST_EFFECT_KINDS, type WebTestEffect,
} from '../src/index.ts'

const created: string[] = []

/** Create a temporary tree the suite owns. */
function tree(): { readonly root: string; readonly file: string; readonly link: string; readonly absent: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-webtest-units-'))
  created.push(root)
  const nested = join(root, 'nested')
  mkdirSync(nested, { recursive: true })
  const file = join(nested, 'a.ts')
  writeFileSync(file, 'x', 'utf8')
  const link = join(nested, 'link')
  symlinkSync(file, link)
  return { root, file, link, absent: join(nested, 'absent.ts') }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(created.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('effect subjects', () => {
  it('names the field or path each kind is decided against', () => {
    const subjects: readonly [WebTestEffect, string][] = [
      [{ kind: 'read-source', path: 'p' }, 'p'],
      [{ kind: 'list-source', path: 'p' }, 'p'],
      [{ kind: 'write-source', path: 'p' }, 'p'],
      [{ kind: 'edit-source', path: 'p' }, 'p'],
      [{ kind: 'fetch-web', url: 'u' }, 'u'],
      [{ kind: 'search-web', queries: ['a', 'b'] }, 'a | b'],
      [{ kind: 'spawn-process', command: 'c' }, 'c'],
      [{ kind: 'write-upload' }, 'write-upload'],
      [{ kind: 'read-upload' }, 'read-upload'],
      [{ kind: 'use-terminal' }, 'use-terminal'],
    ]
    for (const [effect, subject] of subjects) expect(effectSubject(effect), effect.kind).toBe(subject)
  })

  it('declares every kind the closed vocabulary names', () => {
    expect([...WEB_TEST_EFFECT_KINDS].sort()).toEqual([
      'edit-source', 'fetch-web', 'list-source', 'read-source', 'read-upload',
      'search-web', 'spawn-process', 'use-terminal', 'write-source', 'write-upload',
    ])
  })
})

describe('tool call adapters', () => {
  it('admits only an absolute path in either accepted spelling', () => {
    expect(toolEffect('read', { file_path: 'C:/repo/a.ts' })).toEqual({ kind: 'read-source', path: 'C:/repo/a.ts' })
    expect(toolEffect('read', { file_path: '\\\\server\\share\\a.ts' })).toEqual({
      kind: 'read-source', path: '\\\\server\\share\\a.ts',
    })
    expect(toolEffect('read', { file_path: '/repo/a.ts' })).toEqual({ kind: 'read-source', path: '/repo/a.ts' })
    expect(toolEffect('read', { file_path: 'repo/a.ts' })).toBeNull()
    expect(toolEffect('read', { file_path: '' })).toBeNull()
    expect(toolEffect('read', {})).toBeNull()
    expect(toolEffect('read', { file_path: 7 })).toBeNull()
  })

  it('names the argument each filesystem tool carries its target in', () => {
    expect(toolEffect('read_image', { file_path: 'C:/repo/a.png' })).toEqual({
      kind: 'read-source', path: 'C:/repo/a.png',
    })
    expect(toolEffect('glob', { path: 'C:/repo' })).toEqual({ kind: 'list-source', path: 'C:/repo' })
    expect(toolEffect('grep', { path: 'C:/repo' })).toEqual({ kind: 'read-source', path: 'C:/repo' })
    expect(toolEffect('glob', { pattern: '*' })).toBeNull()
    expect(toolEffect('write', { file_path: 'C:/repo/a.ts', content: 'x' })).toEqual({
      kind: 'write-source', path: 'C:/repo/a.ts',
    })
    expect(toolEffect('edit', { file_path: 'C:/repo/a.ts' })).toEqual({
      kind: 'edit-source', path: 'C:/repo/a.ts',
    })
  })

  it('reduces the one editor entry path by its command, not by an argument beside it', () => {
    const path = 'C:/repo/a.ts'
    expect(toolEffect('str_replace_editor', { command: 'view', path })).toEqual({ kind: 'read-source', path })
    expect(toolEffect('str_replace_editor', { command: 'create', path })).toEqual({ kind: 'write-source', path })
    expect(toolEffect('str_replace_editor', { command: 'str_replace', path })).toEqual({ kind: 'edit-source', path })
    expect(toolEffect('str_replace_editor', { command: 'insert', path })).toEqual({ kind: 'edit-source', path })
    expect(toolEffect('str_replace_editor', { command: 'delete', path })).toBeNull()
    expect(toolEffect('str_replace_editor', { path })).toBeNull()
    expect(toolEffect('str_replace_editor', { command: 'view', path: 'a.ts' })).toBeNull()
  })

  it('decides a search as one call, so every query in it is covered or none is', () => {
    expect(toolEffect('web_search', { queries: ['a', 'b'] })).toEqual({ kind: 'search-web', queries: ['a', 'b'] })
    expect(toolEffect('web_search', { queries: [] })).toBeNull()
    expect(toolEffect('web_search', { queries: 'a' })).toBeNull()
    expect(toolEffect('web_search', { queries: ['a', ''] })).toBeNull()
    expect(toolEffect('web_search', { queries: ['a', 7] })).toBeNull()
    expect(toolEffect('web_search', {})).toBeNull()
  })

  it('admits one URL and one command, and refuses a call carrying neither', () => {
    expect(toolEffect('web_fetch', { url: 'https://x.test/' })).toEqual({ kind: 'fetch-web', url: 'https://x.test/' })
    expect(toolEffect('web_fetch', {})).toBeNull()
    expect(toolEffect('web_fetch', { url: '' })).toBeNull()
    expect(toolEffect('bash', { command: 'ls' })).toEqual({ kind: 'spawn-process', command: 'ls' })
    expect(toolEffect('bash', {})).toBeNull()
    expect(toolEffect('pwsh', { command: 'ls' })).toEqual({ kind: 'spawn-process', command: 'ls' })
    expect(toolEffect('pwsh', { command: 7 })).toBeNull()
  })

  it('refuses every terminal operation, whatever it is called', () => {
    for (const name of ['terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list']) {
      expect(toolEffect(name, {}), name).toEqual({ kind: 'use-terminal' })
    }
  })

  it('refuses a name it has no adapter for, and reports which names it does cover', () => {
    expect(toolEffect('deploy_production', { target: 'prod' })).toBeNull()
    expect(toolEffect('run_code', {})).toBeNull()
    expect(adaptedToolNames()).toEqual([
      'bash', 'edit', 'glob', 'grep', 'pwsh', 'read', 'read_image', 'str_replace_editor',
      'terminal_close', 'terminal_list', 'terminal_open', 'terminal_read', 'terminal_send',
      'terminal_signal', 'web_fetch', 'web_search', 'write',
    ])
  })
})

describe('path canonicalization', () => {
  it('reduces a path to one spelling for comparison', () => {
    expect(comparablePath('C:/repo/shop/')).toBe('C:/repo/shop')
    expect(comparablePath('C:\\repo\\shop')).toBe('C:/repo/shop')
    expect(comparablePath('C:/repo/shop///')).toBe('C:/repo/shop')
    expect(comparablePath('/')).toBe('/')
  })

  it('covers a root and what is beneath it, never a sibling sharing its characters', () => {
    expect(isInside('C:/repo/shop', 'C:/repo/shop')).toBe(true)
    expect(isInside('C:/repo/shop', 'C:/repo/shop/src/cart.ts')).toBe(true)
    expect(isInside('C:/repo/shop', 'C:/repo/shop-evil/src/cart.ts')).toBe(false)
    expect(isInside('C:/repo/shop', 'C:/repo')).toBe(false)
    expect(isInside('/', '/anything/at/all')).toBe(true)
  })

  it('resolves an existing path to the identity the filesystem reports', () => {
    const { file, absent, link } = tree()
    expect(resolvePath(file)).toEqual({ ok: true, real: file })
    expect(resolvePath(absent)).toEqual({ ok: false, rejection: 'unresolved' })
    expect(resolvePath(link)).toEqual({ ok: false, rejection: 'link' })
  })
})

describe('origin reduction', () => {
  it('reduces an absolute HTTP(S) URL to the origin a same-site check compares', () => {
    expect(originOf('https://shop.test/checkout?a=1')).toBe('https://shop.test')
    expect(originOf('http://localhost:3000/checkout')).toBe('http://localhost:3000')
    expect(originOf('https://shop.test:443/x')).toBe('https://shop.test')
    expect(originOf('http://shop.test:80/x')).toBe('http://shop.test')
    expect(originOf('https://SHOP.test:8443/x')).toBe('https://shop.test:8443')
  })

  it('refuses a URL it cannot compare, rather than treating it as same-site', () => {
    expect(originOf('ftp://shop.test/x')).toBeNull()
    expect(originOf('/checkout')).toBeNull()
    expect(originOf('not a url')).toBeNull()
  })
})

describe('session attribution', () => {
  it('reads the session a call belongs to, and reports none for a call with no agent', () => {
    expect(sessionIdOf({})).toBeNull()
    expect(sessionIdOf({ agent: { session: { id: 'session-1' } } })).toBe('session-1')
  })
})

describe('host clock', () => {
  it('reads the host instant', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemClock)
    const before = Date.now()
    const now = ctx.webTestClock.now()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(ctx.webTestClock.now()).toBeGreaterThanOrEqual(now)
    await ctx.fiber.dispose()
  })
})
