/**
 * A tool's declared output has to accept what its body returns.
 *
 * The Windows acceptance found `web_test_status` failing on every call because
 * its declared schema closed the object to five fields while the body returned
 * seven, so the host rejected the value before `render` ever saw it. Comparing
 * two schema constants would not have caught that: this exercises the
 * registered definition, validates a real return value against the declared
 * `output.schema`, and runs the declared `render` over the same value.
 *
 * It also holds the generated Remote client against the methods the service
 * actually publishes, so the generated file cannot drift from the source again.
 *
 * @module dsh-plugin-web-test/tests/tool-contract
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { statusToolOutputSchema } from '../src/agent.ts'


const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')

/**
 * Validate a value against a declared JSON Schema, the way the host pipeline
 * does before handing a tool's result to the model.
 * @param schema - The tool's declared output schema.
 * @param value - The value the tool body returned.
 * @returns the list of problems, empty when the value is acceptable.
 */
function schemaProblems(schema: Record<string, unknown>, value: unknown): string[] {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null) return ['value is not an object']
  const properties = (schema['properties'] ?? {}) as Record<string, unknown>
  const required = (schema['required'] ?? []) as string[]
  if (schema['additionalProperties'] === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) problems.push(`"${key}" is not a declared property`)
    }
  }
  for (const key of required) {
    if (!(key in value)) problems.push(`"${key}" is required but absent`)
  }
  return problems
}

describe('tool output contract', () => {
  it('declares every field the status body returns', () => {
    // The value `web_test_status.execute` returns, including the two fields
    // its own `render` reads.
    const returned = {
      state: 'active' as const,
      evidenceRoot: '/data',
      version: '0.1.2',
      projectCount: 1,
      runCount: 2,
      interruptedRuns: ['run-2'],
      unknownOperations: ['run-2/op-1'],
    }
    expect(schemaProblems(statusToolOutputSchema, returned)).toEqual([])
  })

  it('rejects an undeclared field, so a drift is visible', () => {
    expect(schemaProblems(statusToolOutputSchema, { ...sample(), somethingNew: true }))
      .toContain('"somethingNew" is not a declared property')
  })

  it('gives render a value its own schema accepts', () => {
    // `render` narrows with `statusResultSchema.parse`, so the declared output
    // and the parse must agree on the field set or one of them is wrong.
    const declared = Object.keys((statusToolOutputSchema['properties'] ?? {}) as Record<string, unknown>).sort()
    const derived = Object.keys(z.toJSONSchema(
      z.object({
        state: z.enum(['active', 'draining']),
        evidenceRoot: z.string(),
        version: z.string(),
        projectCount: z.number().int(),
        runCount: z.number().int(),
        interruptedRuns: z.array(z.string()),
        unknownOperations: z.array(z.string()),
      }),
      { target: 'draft-7', io: 'output' },
    ).properties ?? {}).sort()
    expect(declared).toEqual(derived)
  })
})

describe('generated Remote client', () => {
  it('describes every method the service publishes', () => {
    const packageDir = join(repoRoot, 'dsh-plugin-web-test', 'packages', 'web-test')
    const remoteClientSource = readFileSync(join(packageDir, 'src', 'client', 'remote.ts'), 'utf8')
    const source = readFileSync(join(packageDir, 'src', 'index.ts'), 'utf8')
    const published = [...source.matchAll(/@Remote\s+(?:async\s+)?([a-zA-Z]+)\(/g)].map(match => match[1])
    const described = [...remoteClientSource.matchAll(/^ {4}([a-zA-Z]+):/gm)].map(match => match[1])
    // Every published method must be described, or the generated client is a
    // second, stale copy of the service.
    expect(described.sort()).toEqual(expect.arrayContaining([...published].sort()))
    for (const method of published) {
      expect(described, `Remote method ${method} is not described in the generated client`).toContain(method)
    }
  })
})

/**
 * A representative status value.
 * @returns the value.
 */
function sample(): Record<string, unknown> {
  return {
    state: 'active',
    evidenceRoot: '/data',
    version: '0.1.2',
    projectCount: 1,
    runCount: 2,
    interruptedRuns: [],
    unknownOperations: [],
  }
}
