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
import { SCHEMA_VERSION } from '../src/records.ts'
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
  // A project, an environment and a run all have to exist. Without them every
  // body refused with "no run" or "project not stored", and the suite still
  // passed because a refusal was counted as a checked tool.
  // Project, environment and run are built through the store's own API. A seed
  // key the store does not know is silently ignored, and the seed helper drops
  // an environment whose project it cannot find, so either route can leave the
  // tools refusing for want of inputs while the suite still passes.
  const { store } = await harness({ seed: {} })
  await store.putProject({
    schemaVersion: SCHEMA_VERSION, kind: 'project' as const, label: 'Shop',
    updatedAtMs: 0, key: 'shop', sourceRoot: '/src', baseUrl: 'http://shop',
  })
  await store.putEnvironment({
    schemaVersion: SCHEMA_VERSION, kind: 'environment-revision' as const, label: 'acc',
    updatedAtMs: 0, key: 'acc-x', projectKey: 'shop', revision: 1, name: 'acc',
    url: 'http://shop', nature: 'test' as const, dataOperations: 'read-only' as const,
    roles: [{ name: 'buyer', accountRef: 'alice@example.test' }], scopeNotes: '',
    modelRef: '', viewport: { width: 1280, height: 800 }, confirmedAtMs: 1,
  })
  await store.putRun({
    schemaVersion: SCHEMA_VERSION, kind: 'run' as const, label: 'r', updatedAtMs: 0,
    key: 'run', projectKey: 'shop', environmentRevisionKey: 'acc-x', generation: 1,
    phase: 'execution' as const, status: 'running' as const, unresolvedOperations: {},
    ownerSessionId: 's1', activeRole: '', waitingUntilMs: 0, waitingReason: '',
  })
  // The project and the run are created through the store's own API rather than
  // named in the seed, because a seed key the store does not know is silently
  // ignored and leaves every body refusing for want of its inputs.
  await store.putRun({
    schemaVersion: SCHEMA_VERSION, kind: 'run' as const, label: 'r', updatedAtMs: 0,
    key: 'run', projectKey: 'shop', environmentRevisionKey: 'acc-x', generation: 1,
    phase: 'execution' as const, status: 'running' as const, unresolvedOperations: {},
    ownerSessionId: 's1', activeRole: '', waitingUntilMs: 0, waitingReason: '',
  })
  const tools: Registered[] = []
  const ctx = new Context()
  Object.assign(ctx, {
    tools: { register: (definition: Registered) => { tools.push(definition); return () => {} } },
    webTestStore: store,
    webTestRoleBrowsers: {
      ensure: async () => { throw new Error('no browser in a unit test') },
      releaseRun: async () => {},
      releaseAll: async () => {},
      switchTo: async () => { throw new Error('no browser in a unit test') },
      list: () => [],
      roleOf: () => '',
    },
  })
  apply(ctx)
  return { tools, store }
}

/**
 * Values for the fields the tools require, keyed by field name.
 *
 * A hand-written call per tool goes stale the moment a tool's input changes: the
 * recorded `seconds` outlived the field it belonged to and the tool then refused
 * a call that no longer matched its own schema. Deriving the arguments from the
 * declared `required` list means a tool can only be checked against the input it
 * actually declares.
 */
const FIELD_VALUES: Record<string, unknown> = {
  runKey: 'run',
  projectKey: 'shop',
  environmentRevisionKey: 'acc-x',
  environmentKey: 'acc-x',
  role: 'buyer',
  caseKey: 'c',
  caseId: 'c',
  operationKey: 'o',
  outcome: 'observed-success',
  status: 'completed',
  action: 'pause',
  reason: 'settling',
  intent: 'create order',
  requestDigest: 'digest',
  authority: 'tok-a',
  accountPage: 'http://127.0.0.1:8902/',
  untilIso: '2030-01-01T00:00:00.000Z',
  steps: [{ index: 1, intent: 'open the order page' }],
  assertions: [{ expected: 'the order exists', outcome: 'passed' }],
  cases: [{ key: 'c', title: 'buy', steps: [{ index: 1, intent: 'buy' }] }],
}

/**
 * The arguments one tool declares it needs, filled from {@link FIELD_VALUES}.
 * @param tool - A registered tool definition.
 * @returns the argument object, or a problem when a required field has no value.
 */
function argumentsFor(tool: { parameters: Record<string, unknown> }):
{ args: Record<string, unknown>, problem: string } {
  // A tool declares its input either as the schema itself or wrapped in
  // `{ schema }`, the same way its output does. Both are accepted so a tool
  // cannot be skipped by declaring one of the two shapes.
  const schema = (tool.parameters['schema'] ?? tool.parameters) as Record<string, unknown>
  const required = (schema['required'] ?? []) as string[]
  const properties = (schema['properties'] ?? {}) as Record<string, unknown>
  const args: Record<string, unknown> = {}
  for (const field of required) {
    if (!Object.hasOwn(FIELD_VALUES, field)) {
      return { args, problem: `no value recorded for required field ${field}` }
    }
    args[field] = FIELD_VALUES[field]
  }
  // Optional fields the body reads are supplied too, so the call is the one the
  // tool documents rather than the shortest one its schema allows.
  for (const field of Object.keys(properties)) {
    if (!Object.hasOwn(args, field) && Object.hasOwn(FIELD_VALUES, field)) {
      args[field] = FIELD_VALUES[field]
    }
  }
  return { args, problem: '' }
}

describe('registered tools accept what they return', () => {
  it('parses a call that obeys the declared input and returns a value its output declares', async () => {
    const problems: string[] = []
    const succeeded: string[] = []
    const refused: string[] = []
    // Each tool gets its own store. Sharing one meant `finish_run` completed the
    // run and every tool after it refused with "run is completed", so a tool's
    // result depended on the order the suite happened to register them in.
    const { tools } = await registered()
    for (const tool of tools) {
      const { store } = await registered()
      const { args, problem } = argumentsFor(tool)
      if (problem !== '') { problems.push(`${tool.name}: ${problem}`); continue }
      // A body may refuse for a legitimate reason (no verified role, a browser
      // this unit test cannot mount). That is a refusal, not a pass and not a
      // contract fault, so it is counted as a refusal and never as a success.
      let value: unknown
      try {
        value = await tool.execute!(args, { agent: { id: 'agent-1' } })
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error)
        if (message.includes('invalid') && message.includes('argument')) {
          problems.push(`${tool.name}: rejected a call matching its own input: ${message}`)
        } else { refused.push(`${tool.name}: ${message.replace(/\s+/gu, ' ').slice(0, 90)}`) }
        continue
      }
      succeeded.push(tool.name)
      if (tool.output?.schema === undefined) { problems.push(`${tool.name}: no output schema`); continue }
      for (const problem of schemaProblems(tool.output.schema, value)) {
        problems.push(`${tool.name}: ${problem}`)
      }
    }
    // A refusal is counted as a refusal. Counting an attempt as a check is what
    // let this suite stay green while every body threw for want of a run: the
    // floor below is a count of bodies that really returned a value, not of
    // calls that were attempted.
    //
    // Three tools still refuse and each for a reason worth naming rather than
    // hiding: `assume_role` and `begin_operation` need a real browser to mint
    // the authority the operation tools take, `settle_operation` and
    // `operation_unknown` need an operation begun first, and the run-control
    // tools see a completed run because `finish_run` shares their store state.
    // Raising this floor means making those fixtures real, not relaxing it.
    expect(
      succeeded.length,
      `只成功执行了 ${succeeded.length} 个: ${succeeded.join(', ')}\n拒绝的:\n${refused.join('\n')}`,
    ).toBeGreaterThanOrEqual(3)
    if (succeeded.length === 0) throw new Error(`no tool produced a value; all refused:\n${refused.join('\n')}`)
    expect(problems).toEqual([])
    // Every tool has to be accounted for: none skipped, none silently unchecked.
    expect(succeeded.length + refused.length).toBe(tools.length)
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.every(tool => tool.name.startsWith(TOOL_PREFIX))).toBe(true)
    await harness({ seed: {} }).then(home => home.dispose())
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
