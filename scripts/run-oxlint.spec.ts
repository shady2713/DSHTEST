/** Oxlint worker bounds and the Typert artifact precondition that precedes every spawn. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findMissingTypertArtifacts, requiresTypertArtifacts, resolveOxlintInvocation } from './run-oxlint.ts'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-typert-artifacts-'))
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function packageAt(group: string, name: string, exports: object): string {
  const dir = join(root, 'packages', group, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@test/${name}`, type: 'module', exports }))
  return dir
}

function generate(dir: string, path: string): void {
  const file = join(dir, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '// generated\n')
}

describe('Oxlint invocation', () => {
  it('preserves the ordinary default invocation', () => {
    expect(resolveOxlintInvocation(['.'], { PATH: '/bin' })).toEqual({
      args: ['.'],
      env: { PATH: '/bin' },
    })
  })

  it('bounds both worker pools from one setting', () => {
    expect(resolveOxlintInvocation(['.', '--fix'], { DSH_OXLINT_THREADS: '4', GOMAXPROCS: '12' })).toEqual({
      args: ['.', '--fix', '--threads=4'],
      env: { DSH_OXLINT_THREADS: '4', GOMAXPROCS: '4' },
    })
  })

  it('uses location-preserving diagnostics in CI', () => {
    expect(resolveOxlintInvocation(['.'], { CI: 'true', DSH_OXLINT_THREADS: '4' })).toEqual({
      args: ['.', '--format=default', '--threads=4'],
      env: { CI: 'true', DSH_OXLINT_THREADS: '4', GOMAXPROCS: '4' },
    })
  })

  it('preserves an explicitly selected CI formatter', () => {
    expect(resolveOxlintInvocation(['.', '--format', 'github'], { CI: 'true' }).args)
      .toEqual(['.', '--format', 'github'])
  })

  it.each(['0', '-1', '1.5', 'auto'])('rejects invalid worker bound %s', (value) => {
    expect(() => resolveOxlintInvocation(['.'], { DSH_OXLINT_THREADS: value }))
      .toThrow('DSH_OXLINT_THREADS must be a positive integer')
  })

  it('rejects a competing direct worker bound', () => {
    expect(() => resolveOxlintInvocation(['.', '--threads=2'], { DSH_OXLINT_THREADS: '4' }))
      .toThrow('use DSH_OXLINT_THREADS instead')
  })
})

describe('Typert artifact readiness', () => {
  const typert = { types: './lib/typert.host.d.ts', default: './lib/typert.host.js' }
  const remote = { types: './lib/typert.remote-client.d.ts', default: './lib/typert.remote-client.js' }

  it('accepts a package whose declared Typert artifacts exist', () => {
    const dir = packageAt('test', 'plugin', { '.': './lib/index.js', './typert': typert })
    generate(dir, 'lib/typert.host.d.ts')
    generate(dir, 'lib/typert.host.js')

    const report = findMissingTypertArtifacts(root)
    expect(report.missing).toEqual([])
    expect(report.generateCommand).toContain('build:lib:host')
  })

  it('accepts a package whose declared Remote artifacts exist', () => {
    const dir = packageAt('test', 'plugin', { '.': './lib/index.js', './remote': remote })
    generate(dir, 'lib/typert.remote-client.d.ts')
    generate(dir, 'lib/typert.remote-client.js')

    expect(findMissingTypertArtifacts(root).missing).toEqual([])
  })

  it('reports an absent types file', () => {
    const dir = packageAt('test', 'plugin', { './typert': typert })
    generate(dir, 'lib/typert.host.js')

    expect(findMissingTypertArtifacts(root).missing).toEqual([{
      packageName: '@test/plugin',
      exportKey: './typert',
      field: 'types',
      path: 'packages/test/plugin/lib/typert.host.d.ts',
    }])
  })

  it('reports an absent default file', () => {
    const dir = packageAt('test', 'plugin', { './typert': typert })
    generate(dir, 'lib/typert.host.d.ts')

    expect(findMissingTypertArtifacts(root).missing).toEqual([{
      packageName: '@test/plugin',
      exportKey: './typert',
      field: 'default',
      path: 'packages/test/plugin/lib/typert.host.js',
    }])
  })

  it('ignores a package that declares no Typert export', () => {
    packageAt('test', 'plugin', { '.': './lib/index.js', './client': { types: './lib/client.d.ts' } })

    expect(findMissingTypertArtifacts(root).missing).toEqual([])
  })

  it('reports every absent artifact across packages', () => {
    packageAt('test', 'alpha', { './typert': typert })
    const beta = packageAt('test', 'beta', { './remote': remote })
    generate(beta, 'lib/typert.remote-client.d.ts')

    expect(findMissingTypertArtifacts(root).missing).toEqual([
      {
        packageName: '@test/alpha',
        exportKey: './typert',
        field: 'types',
        path: 'packages/test/alpha/lib/typert.host.d.ts',
      },
      {
        packageName: '@test/alpha',
        exportKey: './typert',
        field: 'default',
        path: 'packages/test/alpha/lib/typert.host.js',
      },
      {
        packageName: '@test/beta',
        exportKey: './remote',
        field: 'default',
        path: 'packages/test/beta/lib/typert.remote-client.js',
      },
    ])
  })
})

describe('Typert artifact precondition scope', () => {
  function writeConfig(name: string, contents: string): void {
    writeFileSync(join(root, name), contents)
  }

  it('requires the artifacts for a bare type-aware invocation', () => {
    expect(requiresTypertArtifacts(['.'], root)).toBe(true)
  })

  it('skips the artifacts for the staged profile', () => {
    writeConfig('.oxlintrc.staged.json', '{\n  "options": {\n    "typeAware": false\n  }\n}\n')

    expect(requiresTypertArtifacts(['--config', '.oxlintrc.staged.json', '--fix'], root)).toBe(false)
  })

  it('skips the artifacts for the staged profile in equals form', () => {
    writeConfig('.oxlintrc.staged.json', '{\n  "options": {\n    "typeAware":false\n  }\n}\n')

    expect(requiresTypertArtifacts(['--config=.oxlintrc.staged.json', '--fix'], root)).toBe(false)
  })

  it('requires the artifacts for a selected type-aware config', () => {
    writeConfig('.oxlintrc.full.json', '{\n  "options": {\n    "typeAware": true\n  }\n}\n')

    expect(requiresTypertArtifacts(['--config', '.oxlintrc.full.json', '.'], root)).toBe(true)
  })

  it('requires the artifacts when the selected config cannot be read', () => {
    expect(requiresTypertArtifacts(['--config', '.oxlintrc.absent.json', '.'], root)).toBe(true)
    expect(requiresTypertArtifacts(['--config'], root)).toBe(true)
  })
})
