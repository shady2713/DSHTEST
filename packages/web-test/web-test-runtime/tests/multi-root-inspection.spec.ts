/**
 * A project may declare several code roots, and every one of them gets its own
 * record of what this host found — including the ones this host cannot use.
 *
 * The last case is the security invariant of this stage as a test rather than a
 * sentence: the read that judges a declared target may not reach for anything
 * that installs, starts, or deploys the project under test, so the module's own
 * imports are read from its parse tree and held to a read-only list.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { ProjectId, ProjectMetadata, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'
import { inspectProjectMetadata } from '../src/index.ts'

const root = mkdtempSync(join(tmpdir(), 'dsh-webtest-multiroot-'))
const secondRoot = join(root, 'api')
mkdirSync(secondRoot)
const notADirectory = join(root, 'not-a-directory')
writeFileSync(notADirectory, 'a file\n', 'utf8')

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/**
 * Build a published record with the declarations one case needs.
 * @param codeRoots - the code roots this case declares.
 * @param entryUrls - the entry URLs this case declares.
 * @returns the record as the catalog head publishes it.
 */
function project(codeRoots: string[], entryUrls: string[] = []): ProjectMetadata {
  return {
    projectId: brandString<ProjectId>(`project-${'0'.repeat(32)}`),
    revision: brandNumber<Revision>(1),
    codeRoots,
    entryUrls,
  }
}

describe('one reachability record per declared code root', () => {
  it('reports every declared root, in the order it was declared', () => {
    const inspection = inspectProjectMetadata(project([root, secondRoot]))

    expect(inspection.codeRoots.map(check => check.declared)).toEqual([root, secondRoot])
    expect(inspection.codeRoots.map(check => check.state)).toEqual(['usable', 'usable'])
    expect(inspection.complete).toBe(true)
  })

  it('keeps the record of a root this host does not hold instead of dropping it', () => {
    const missing = join(root, 'no-such-tree')
    const inspection = inspectProjectMetadata(project([root, missing]))

    // The unreachable root stays in the record the caller reads, because a
    // dropped root is a root the user asked about and no longer hears about.
    expect(inspection.codeRoots).toHaveLength(2)
    expect(inspection.codeRoots[1]).toEqual({
      state: 'absent',
      declared: missing,
      detail: 'no directory exists at this path on this host',
    })
  })

  it('is not complete while one declared root among several is unusable', () => {
    const inspection = inspectProjectMetadata(project([root, notADirectory, secondRoot]))

    expect(inspection.codeRoots.map(check => check.state)).toEqual(['usable', 'unusable', 'usable'])
    expect(inspection.complete).toBe(false)
  })

  it('reports a root this host cannot look at as absent, keeping the record', () => {
    const inspection = inspectProjectMetadata(project([`${join(root, 'tree')}\0`]))

    expect(inspection.codeRoots).toHaveLength(1)
    expect(inspection.codeRoots[0]?.state).toBe('absent')
    expect(inspection.codeRoots[0]?.detail).toContain('this host cannot look at this path at all')
  })

  it('judges each root and each URL on its own account', () => {
    const inspection = inspectProjectMetadata(project([root, notADirectory], ['http://localhost:3000/']))

    expect(inspection.codeRoots.map(check => check.state)).toEqual(['usable', 'unusable'])
    expect(inspection.entryUrls.map(entry => entry.state)).toEqual(['usable'])
    expect(inspection.complete).toBe(false)
  })
})

describe('the probe path has no side effect on the project under test', () => {
  /** The parse tree of the module under inspection, read once per case. */
  function inspectionTree(): ts.SourceFile {
    const path = fileURLToPath(new URL('../src/inspection.ts', import.meta.url))
    return ts.createSourceFile('inspection.ts', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  }

  it('imports nothing that could install, start, or deploy what it inspects', () => {
    const source = inspectionTree()
    const imported = source.statements
      .filter(ts.isImportDeclaration)
      .map(statement => statement.moduleSpecifier.getText(source))

    // Reading a declared target is a `stat` and a URL parse. A module that
    // could run an installer, spawn a dev server, or deploy the project is not
    // a module this stage may import, whatever it is called.
    expect(imported).toEqual([
      "'node:fs'",
      "'node:url'",
      "'node:fs'",
      "'@deepseek-ai/dsh-web-test-contracts'",
    ])
    for (const specifier of imported) {
      expect(specifier).not.toMatch(/child_process|spawn|exec|install|deploy|serve|net|https?$/u)
    }
  })

  it('calls nothing that runs a process, opens a socket, or reaches the network', () => {
    // Read from the parse tree rather than from the file text: a module whose
    // own prose says it installs nothing must not be able to satisfy this by
    // writing the word in a comment.
    const dangerous = new Set([
      'spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'fork',
      'fetch', 'createServer', 'listen', 'connect', 'request',
    ])
    const called = new Set<string>()
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        called.add(node.expression.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(inspectionTree())

    expect([...called].filter(name => dangerous.has(name))).toEqual([])
  })
})
