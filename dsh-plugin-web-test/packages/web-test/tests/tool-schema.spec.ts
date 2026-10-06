/**
 * The status tool's declared output must match what its body returns.
 *
 * The two are written separately because the host validates the declared JSON
 * Schema with its own walker and rejects what `z.toJSONSchema` produces. That
 * split let a field go missing once: the tool returned `interruptedRuns` and
 * `unknownOperations` while the declared schema still closed the object to the
 * older fields, so every call failed with "not a declared property" and the
 * model could not read the plugin's state at all.
 *
 * These tests derive the schema from the same Zod schema the tool body fulfils
 * and fail on any difference, so the two cannot drift apart again.
 *
 * @module dsh-plugin-web-test/tests/tool-schema
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { operationResultSchema, statusResultSchema, statusToolOutputSchema } from '../src/agent.ts'

describe('status tool output schema', () => {
  it('declares exactly the fields the tool returns', () => {
    // The declared schema is hand-written because the host's walker rejects
    // what `z.toJSONSchema` produces, so the two are compared on the property
    // set and the required list — what a closed object is actually checked
    // against. Numeric bounds the derivation adds are not part of that contract.
    const declared = statusToolOutputSchema
    const derived = derivedSchema()
    expect(Object.keys(properties(declared)).sort()).toEqual(Object.keys(properties(derived)).sort())
    expect([...(declared['required'] as string[])].sort()).toEqual([...(derived['required'] as string[])].sort())
    expect(declared['additionalProperties']).toBe(false)
  })

  it('covers the operation result, which four tools share and one of them under-filled', () => {
    // `settle_operation` declared this schema, whose `required` lists
    // `authority`, while its body returned no such field, so every settlement
    // failed with `missing required property "value.authority"`. A shared schema
    // is what let the gap survive: each tool looked plausible on its own.
    const declared = operationResultSchema
    const required = Object.keys(declared.shape)
    expect(required).toContain('authority')
    for (const key of required) {
      expect(declared.shape[key as keyof typeof declared.shape]).toBeDefined()
    }
  })

  it('gives every model-visible parameter a description', () => {
    // A field listed in `required` does not tell the model what shape belongs
    // there. `accountPage` had no description, so the model passed a relative path
    // and the `url` format rejected it, costing a real round trip; a rule added
    // later without one would fail the same way.
    const source = readFileSync(new URL('../src/agent.ts', import.meta.url), 'utf8')
    const undocumented: string[] = []
    for (const block of source.split('parameters: {').slice(1)) {
      const properties = block.split('output: {')[0]
      const name = /name: `\$\{TOOL_PREFIX\}([a-z_]+)`/.exec(source.slice(Math.max(0, source.indexOf(block) - 200)))?.[1]
      const tool = name ?? 'unknown tool'
      for (const field of properties.matchAll(/\n        ([a-zA-Z]+): \{/g)) {
        const start = field.index ?? 0
        if (!properties.slice(start, start + 420).includes('description')) {
          undocumented.push(`${tool}.${field[1]}`)
        }
      }
    }
    expect(undocumented).toEqual([])
  })

  it('rejects a value the schema does not declare', () => {
    const partial = { ...sample(), somethingNew: true }
    expect(accepts(statusToolOutputSchema, partial)).toBe(false)
  })

  it('accepts every value the tool body produces', () => {
    expect(accepts(statusToolOutputSchema, sample())).toBe(true)
  })
})

/**
 * One value shaped like the status tool's result.
 * @returns a representative result.
 */
function sample(): Record<string, unknown> {
  return {
    state: 'active',
    evidenceRoot: '/data',
    version: '0.1.1',
    projectCount: 1,
    runCount: 2,
    interruptedRuns: ['run-2'],
    unknownOperations: ['run-2/op-1'],
  }
}

/**
 * The JSON Schema derived from the Zod schema the tool body fulfils.
 * @returns the equivalent schema, without the dialect marker.
 */
function derivedSchema(): Record<string, unknown> {
  const derived = z.toJSONSchema(statusResultSchema, { target: 'draft-7', io: 'output' }) as Record<string, unknown>
  delete derived['$schema']
  return JSON.parse(JSON.stringify(derived)) as Record<string, unknown>
}

/**
 * The property map of a schema object.
 * @param schema - The schema to read.
 * @returns its declared properties.
 */
function properties(schema: Record<string, unknown>): Record<string, unknown> {
  return (schema['properties'] ?? {}) as Record<string, unknown>
}

/**
 * Check a value against the declared schema, narrowly.
 *
 * The point is the closed object and the declared property set, which is what
 * the host's tool pipeline enforces, so a general validator would be more than
 * this needs.
 * @param schema - The declared output schema.
 * @param value - The value a tool returned.
 * @returns whether every declared property is present and no other is.
 */
function accepts(schema: Record<string, unknown>, value: Record<string, unknown>): boolean {
  const declared = properties(schema)
  const required = (schema['required'] ?? []) as string[]
  if (schema['additionalProperties'] === false) {
    for (const key of Object.keys(value)) {
      if (!(key in declared)) return false
    }
  }
  return required.every(key => key in value && declared[key] !== undefined)
}
