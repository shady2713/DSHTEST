/**
 * The plugin config's resolved shape: every field's default, the effect-kind
 * vocabulary, and the refusal to accept a protected directory the policy cannot
 * stand behind.
 */

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Config, resolveProtectedPaths, WEB_TEST_EFFECT_KINDS, WebTestPolicyError } from '../src/index.ts'

const created: string[] = []

/** The host's path separator, so a case works on either platform. */
const hostSep = process.platform === 'win32' ? String.fromCharCode(92) : '/'

/** Create a temporary directory the suite owns. */
function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-webtest-config-'))
  created.push(root)
  return root
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(created.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('plugin config', () => {
  it('defaults every deployment-varying field to its conservative reading', () => {
    expect(Config({})).toEqual({
      protectedPaths: [],
      confirmationRequiredFor: [],
      confirmationTtlMs: 60_000,
      authorizationValidityMs: 300_000,
      maxActionsPerFlow: 50,
    })
  })

  it('accepts every effect kind in the closed vocabulary and rejects a name outside it', () => {
    expect(Config({ confirmationRequiredFor: [...WEB_TEST_EFFECT_KINDS] }).confirmationRequiredFor)
      .toEqual([...WEB_TEST_EFFECT_KINDS])
    expect(Config['~standard'].validate({ confirmationRequiredFor: ['deploy-production'] })).toHaveProperty('issues')
  })

  it('rejects a non-positive validity, a non-positive action ceiling, and an unknown role', () => {
    expect(() => Config({ confirmationTtlMs: 0 })).toThrow()
    expect(() => Config({ authorizationValidityMs: 0 })).toThrow()
    expect(() => Config({ maxActionsPerFlow: 0 })).toThrow()
    expect(Config['~standard'].validate({ protectedPaths: [{ path: '/tmp', role: 'cache' }] })).toHaveProperty('issues')
  })
})

describe('protected path resolution', () => {
  it('freezes each declared directory to its canonical identity, keeping its role', () => {
    const root = tempDir()
    const upload = join(root, 'upload')
    const staging = join(root, 'tmp')
    mkdirSync(upload)
    mkdirSync(staging)
    const resolved = resolveProtectedPaths([
      { path: `${upload}${hostSep}`, role: 'upload' },
      { path: staging, role: 'temporary-material' },
    ])
    expect(resolved).toEqual([
      { real: upload, role: 'upload' },
      { real: staging, role: 'temporary-material' },
    ])
  })

  it('refuses a directory that does not exist rather than skipping it', () => {
    const root = tempDir()
    expect(() => resolveProtectedPaths([{ path: join(root, 'absent'), role: 'download' }]))
      .toThrow(/not an existing directory/u)
  })

  it('refuses a link rather than following a boundary it cannot enforce', () => {
    const root = tempDir()
    const real = join(root, 'real')
    mkdirSync(real)
    const link = join(root, 'link')
    symlinkSync(real, link, 'junction')
    let raised: WebTestPolicyError | undefined
    try {
      resolveProtectedPaths([{ path: link, role: 'upload' }])
    } catch (error: unknown) {
      raised = error instanceof WebTestPolicyError ? error : undefined
    }
    expect(raised?.code).toBe('web-test-policy/link-path')
  })

  it('refuses a link whose final component is the directory itself', () => {
    const root = tempDir()
    const real = join(root, 'real')
    mkdirSync(real)
    writeFileSync(join(root, 'anchor'), '', 'utf8')
    const link = join(real, 'inner')
    symlinkSync(join(root, 'anchor'), link)
    let raised: WebTestPolicyError | undefined
    try {
      resolveProtectedPaths([{ path: link, role: 'upload' }])
    } catch (error: unknown) {
      raised = error instanceof WebTestPolicyError ? error : undefined
    }
    expect(raised?.code).toBe('web-test-policy/link-path')
  })
})
