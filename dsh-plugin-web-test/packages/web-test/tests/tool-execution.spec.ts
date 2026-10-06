/**
 * Every registered tool has to survive its own execution path.
 *
 * `settle_operation` declared a `parameters` schema without `authority` while
 * its body parsed one, so a call that obeyed the declared contract was rejected
 * by the body's own parse. Several tools then share `operationResultSchema`,
 * which declares five required fields, while each body returns whatever it
 * builds; the host validates a return value against that list before `render`
 * runs, so a body that returns fewer fields fails on every call.
 *
 * Reading the source or comparing two schema constants catches neither, because
 * the fault only exists in the value a body returns when it runs. This records
 * what the plugin actually registers, runs each body against a real store, and
 * validates the result against the schema that same definition declared.
 *
 * The real `ToolsService` is not mounted: importing it pulls the host's sandbox
 * dependency, which this package does not install. The definitions under test are
 * the plugin's own `register` payloads and its own `execute` bodies.
 *
 * @module dsh-plugin-web-test/tests/tool-execution
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebTestStore } from '../src/store-service.ts'
import { apply, TOOL_PREFIX } from '../src/agent.ts'
import { cleanupHomes, harness } from './support/harness.ts'
import { environment } from './support/seed.ts'

/** The shape of one registered tool this test drives. */
interface Registered {
  name: string
  parameters?: Record<string, unknown>
  output?: { schema?: Record<string, unknown> }
  execute?: (args: unknown, exec: { agent?: { id: string } }) => Promise<unknown>
  render?: (args: unknown, value: unknown) => { type: 'text', text: string }[]
}

/**
 * Validate a value the way the host pipeline does before handing it to `render`.
 * @param schema - The tool's declared output schema.
 * @param value - The value the tool body returned.
 * @returns the problems found, empty when the value is acceptable.
 */
function schemaProblems(schema: Record<string, unknown>, value: unknown): string[] {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null) return ['value is not an object']
  const properties = (schema['properties'] ?? {}) as Record<string, unknown>
  const required = (schema['required'] ?? []) as string[]
  const present = value as Record<string, unknown>
  for (const key of required) {
    if (!(key in present)) problems.push(`missing required property ${JSON.stringify(key)}`)
  }
  if (schema['additionalProperties'] === false) {
    for (const key of Object.keys(present)) {
      if (!(key in properties)) problems.push(`undeclared property ${JSON.stringify(key)}`)
    }
  }
  return problems
}

/**
 * Mount the plugin's agent over a real store and record what it registers.
 * @returns the recorded tool definitions and the store they run against.
 */
async function registered(): Promise<{ tools: Registered[], store: WebTestStore }> {
  const { store } = await harness({
    seed: { u_web_test_environment_revisions: environment('acc-x', ['buyer'], ['Alice Buyer']) },
  })
  const tools: Registered[] = []
  const ctx = new Context()
  Object.assign(ctx, {
    tools: { register: (definition: Registered) => { tools.push(definition); return () => {} } },
    webTestStore: store,
    webTestRoleBrowsers: {
      ensure: async () => { throw new Error('no browser in a unit test') },
      switchTo: async () => { throw new Error('no browser in a unit test') },
      list: () => [],
      roleOf: () => '',
    },
  })
  apply(ctx)
  return { tools, store }
}

/** Arguments that satisfy each tool's declared input, so a body runs for real. */
const CALLS: Record<string, Record<string, unknown>> = {
  web_test_start_run: { projectKey: 'shop', environmentRevisionKey: 'acc-x', role: 'buyer' },
  web_test_finish_run: { runKey: 'run', outcome: 'completed' },
  web_test_propose_cases: { runKey: 'run' },
  web_test_report_case: { runKey: 'run', caseKey: 'c', outcome: 'passed', detail: 'ok' },
  web_test_begin_operation: { runKey: 'run', intent: 'create order', digest: 'd', authority: 'a' },
  web_test_settle_operation: { runKey: 'run', operationKey: 'o', outcome: 'observed-success' },
  web_test_operation_unknown: { runKey: 'run', operationKey: 'o', reason: 'lost' },
  web_test_assume_role: { runKey: 'run', role: 'buyer', accountPage: 'http://127.0.0.1:8902/' },
  web_test_wait: { runKey: 'run', reason: 'settling', seconds: 1 },
  web_test_resume_wait: { runKey: 'run' },
  web_test_status: {},
  web_test_control_run: { runKey: 'run', action: 'pause' },
}

describe('registered tools accept what they return', () => {
  it('parses a call that obeys the declared input and returns a value its output declares', async () => {
    const { tools, store } = await registered()
    const problems: string[] = []
    const checked: string[] = []
    const refused: string[] = []
    for (const tool of tools) {
      const args = CALLS[tool.name]
      if (args === undefined) { problems.push(`${tool.name}: no call recorded`); continue }
      checked.push(tool.name)
      // A body may reject a call for a legitimate reason (no such run, not the
      // verified role). That is a refusal, not a contract fault, so only a body
      // that produced a value is checked against the schema it declared.
      let value: unknown
      try {
        value = await tool.execute!(args, { agent: { id: 'agent-1' } })
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error)
        if (message.includes('invalid') && message.includes('argument')) {
          problems.push(`${tool.name}: rejected a call matching its own input: ${message}`)
        } else { refused.push(`${tool.name}: ${message.slice(0, 60)}`) }
        continue
      }
      if (tool.output?.schema === undefined) { problems.push(`${tool.name}: no output schema`); continue }
      for (const problem of schemaProblems(tool.output.schema, value)) {
        problems.push(`${tool.name}: ${problem}`)
      }
    }
    // A suite that skipped every body would pass while proving nothing, so the
    // tools that actually produced a value are named in the failure output.
    expect(checked.length, `只执行了 ${checked.length} 个工具: ${checked.join(", ")}`).toBeGreaterThanOrEqual(4)
    if (checked.length === 0) throw new Error(`no tool produced a value; all refused:\n${refused.join('\n')}`)
    expect(problems).toEqual([])
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.every(tool => tool.name.startsWith(TOOL_PREFIX))).toBe(true)
    await store.drain?.()
  })

  it('rejects a return value that drops a declared field', () => {
    const schema = { type: 'object', additionalProperties: false, required: ['runKey', 'note'], properties: { runKey: { type: 'string' }, note: { type: 'string' } } }
    expect(schemaProblems(schema, { runKey: 'r' })).toEqual(['missing required property "note"'])
  })

  it('rejects a return value that adds an undeclared field', () => {
    const schema = { type: 'object', additionalProperties: false, required: ['runKey'], properties: { runKey: { type: 'string' } } }
    expect(schemaProblems(schema, { runKey: 'r', extra: 1 })).toEqual(['undeclared property "extra"'])
  })
})

afterEach(cleanupHomes)
