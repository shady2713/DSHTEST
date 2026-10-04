/**
 * The read that compares a published project's declarations with what this host
 * holds: every state each declared fact can reach, and the `complete` flag that
 * says nothing beyond those states.
 *
 * The suite runs against real directories under the system temporary directory
 * and against a real file, because the whole point of the read is what the
 * filesystem answers, and against declaration strings no network is involved.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { ProjectId, ProjectMetadata, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import { afterAll, describe, expect, it } from 'vitest'
import { inspectProjectMetadata } from '../src/index.ts'

const root = mkdtempSync(join(tmpdir(), 'dsh-webtest-inspection-'))
const notADirectory = join(root, 'code')
writeFileSync(notADirectory, 'not a directory\n', 'utf8')

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/**
 * Build a published record with the declarations one case needs.
 * @param codeRoot - the code root this case declares.
 * @param entryUrls - the entry URLs this case declares.
 * @returns the record as the catalog head publishes it.
 */
function project(codeRoot: string, entryUrls: string[] = []): ProjectMetadata {
  return {
    projectId: brandString<ProjectId>(`project-${'0'.repeat(32)}`),
    revision: brandNumber<Revision>(1),
    codeRoots: [codeRoot],
    entryUrls,
  }
}

describe('declared material against this host', () => {
  it('reports an existing directory and absolute http addresses as usable', () => {
    const record = project(root, ['http://localhost:3000/checkout', 'https://shop.example/'])
    const inspection = inspectProjectMetadata(record)

    expect(inspection.project).toBe(record)
    expect(inspection.codeRoots[0]?.state).toBe('usable')
    expect(inspection.entryUrls.map(entry => entry.state)).toEqual(['usable', 'usable'])
    expect(inspection.complete).toBe(true)
  })

  it('reports a declared path this host does not hold as absent', () => {
    const inspection = inspectProjectMetadata(project(join(root, 'no-such-tree')))

    expect(inspection.codeRoots[0]).toEqual({
      state: 'absent',
      declared: join(root, 'no-such-tree'),
      detail: 'no directory exists at this path on this host',
    })
    expect(inspection.complete).toBe(false)
  })

  it('reports a declared path that exists but is not a directory as unusable', () => {
    const inspection = inspectProjectMetadata(project(notADirectory))

    expect(inspection.codeRoots[0]?.state).toBe('unusable')
    expect(inspection.codeRoots[0]?.detail).toBe('this path exists but is not a directory')
  })

  it('reports a path this host cannot look at as absent rather than raising', () => {
    const inspection = inspectProjectMetadata(project(`${join(root, 'tree')}\0`))

    expect(inspection.codeRoots[0]?.state).toBe('absent')
    expect(inspection.codeRoots[0]?.detail).toContain('this host cannot look at this path at all')
  })

  it('reports a relative, hostless, or non-http declaration as unusable', () => {
    const inspection = inspectProjectMetadata(project(root, ['/checkout', 'http://', 'ftp://files.example/app']))

    expect(inspection.entryUrls.map(entry => entry.state)).toEqual(['unusable', 'unusable', 'unusable'])
    expect(inspection.entryUrls[0]?.detail).toBe('this is not an absolute URL')
    expect(inspection.entryUrls[1]?.detail).toBe('this is not an absolute URL')
    expect(inspection.entryUrls[2]?.detail).toBe('this is a ftp: URL, not an http or https address')
    expect(inspection.complete).toBe(false)
  })

  it('is complete on the account of a project that declared no entry URL', () => {
    const inspection = inspectProjectMetadata(project(root))

    expect(inspection.entryUrls).toEqual([])
    expect(inspection.complete).toBe(true)
  })

  it('never claims that a usable entry URL answers', () => {
    const inspection = inspectProjectMetadata(project(root, ['http://localhost:1/never-listening']))

    expect(inspection.entryUrls[0]?.detail).toBe(
      'an absolute http or https address; its reachability is not read here',
    )
  })
})
