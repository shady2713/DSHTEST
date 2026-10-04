/**
 * The cross-entry rejection matrix, the direct-service-call refusals, and
 * hot-enable — all observed through the real tool registry, the real local
 * filesystem, the real local attachment store, the real local subprocess
 * runtime, and the real terminal registry, with the observed decisions written
 * to `.artifacts/web-testing/upgrade-v02/m1-t05-a/rejection-matrix.md`.
 *
 * Two bootstraps feed the one matrix. The stand-in harness covers the tool
 * guard, the web and shell capabilities, and the filesystem. The real-capability
 * harness covers every method the backstop newly decorates, over services that
 * have something real to give up: a stored upload holding known bytes, a
 * published PTY session, and a source file no write may replace.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { WebTestPolicyError } from '../src/index.ts'
import {
  flowId, flowRevision, matrixPreamble, refusalOf, sessionId, sourceBytes, startPolicy, startRealCapabilities,
  uploadBytes, type BodyObservation, type MatrixRow, type PolicyHarness, type RealCapabilities,
} from './harness.ts'

/** One matrix case: the entry, the call, and what the suite expects to observe. */
interface Case {
  /** The entry path's label, which is also the row's entry column. */
  readonly why: string
  /** Which of the two enforcement points decided it. */
  readonly point: MatrixRow['point']
  /** Whether this row is the admitted or the refused half of its entry. */
  readonly case: MatrixRow['case']
  /** The reason a refused case must return. */
  readonly reason: string
  /** What the body column may report for this row's provider. */
  readonly body: 'countered' | 'not-countered'
  /** The tool call, for a tool-guard row. */
  readonly tool?: { readonly name: string; readonly arguments: Record<string, unknown> }
  /** The service call, for a backstop row. */
  readonly service?: (ctx: Context, target: FsTarget) => Promise<unknown>
  /** The arguments the row reports, when the call carried none worth restating. */
  readonly reported?: Record<string, unknown>
}

let harness: PolicyHarness | undefined
let real: RealCapabilities | undefined
let sourceTarget: FsTarget
let outsideTarget: FsTarget
let directoryTarget: FsTarget
const rows: MatrixRow[] = []
const protectedImage: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 68,
  width: 1,
  height: 1,
}

/** The booted stand-in harness; the suite's own `beforeAll` guarantees it exists. */
function policy(): PolicyHarness {
  /* v8 ignore next -- every test in this file runs after the suite's beforeAll */
  if (harness === undefined) throw new Error('the policy harness is not booted')
  return harness
}

/** The booted real-capability harness; the suite's own `beforeAll` guarantees it exists. */
function capabilities(): RealCapabilities {
  /* v8 ignore next -- every test in this file runs after the suite's beforeAll */
  if (real === undefined) throw new Error('the real-capability harness is not booted')
  return real
}

/**
 * Render one admitted value the way the observed column reports it: the value
 * itself, so an admitted row states what the call returned rather than that it
 * "reached the provider".
 * @param value - what the admitted call returned.
 * @returns the text the row carries.
 */
function describeValue(value: unknown): string {
  if (value instanceof Uint8Array) return JSON.stringify(Buffer.from(value).toString('utf8'))
  if (typeof value === 'string') return JSON.stringify(value)
  return JSON.stringify(value) ?? 'undefined'
}

/**
 * Run every case against one booted context and record what was observed.
 * @param cases - the cases to run, in report order.
 * @param ctx - the context the service calls go through.
 * @param target - the resolved source target the service calls default to.
 */
async function observe(cases: readonly Case[], ctx: Context, target: FsTarget): Promise<void> {
  for (const entry of cases) {
    const before = new Map(policy().providerCalls)
    if (entry.tool !== undefined) {
      const observed = await policy().callTool(entry.tool.name, entry.tool.arguments)
      const parsed = refusalOf(observed)
      rows.push({
        entry: entry.why,
        point: entry.point,
        case: entry.case,
        arguments: entry.tool.arguments,
        providerBodyRan: entry.body === 'countered' ? counterOutcome(before) : 'not-countered',
        observed,
        reason: parsed.reason,
        subject: parsed.subject,
      })
      continue
    }
    const service = entry.service
    /* v8 ignore next -- every case declares either a tool or a service call */
    if (service === undefined) throw new Error(`matrix case '${entry.why}' declares no call`)
    let observed = ''
    try {
      observed = `ADMITTED: the call returned ${describeValue(await service(ctx, target))}`
    } catch (error: unknown) {
      observed = error instanceof WebTestPolicyError
        ? error.message
        : `unexpected failure: ${String(error)}`
    }
    const parsed = refusalOf(observed)
    rows.push({
      entry: entry.why,
      point: entry.point,
      case: entry.case,
      arguments: entry.reported ?? {},
      providerBodyRan: entry.body === 'countered' ? counterOutcome(before) : 'not-countered',
      observed,
      reason: parsed.reason,
      subject: parsed.subject,
    })
  }
}

/**
 * Whether any stand-in provider body ran since the counters were read.
 * @param before - the counters as they stood before the case ran.
 * @returns what the body column reports for a counted row.
 */
function counterOutcome(before: ReadonlyMap<string, number>): BodyObservation {
  const ran = [...policy().providerCalls.entries()].some(([key, count]) => count !== (before.get(key) ?? 0))
  return ran ? 'entered' : 'not-entered'
}

/** Assert that every recorded row matched the case it came from. */
function expectRowsMatch(cases: readonly Case[]): void {
  for (const entry of cases) {
    const row = rows.find(candidate => candidate.entry === entry.why)
    expect(row, entry.why).toBeDefined()
    if (entry.case === 'allowed') {
      expect(row?.observed, entry.why).not.toContain('web testing policy refused')
    } else {
      expect(row?.reason, entry.why).toBe(entry.reason)
    }
  }
}

/**
 * Render one refusal or effect as the observed text of a real-service row, and
 * record the row.
 * @param why - the entry path's label.
 * @param arguments_ - the arguments the row reports.
 * @param effect - what the suite observed besides the refusal.
 * @param call - the refused call, which must throw.
 */
async function observeRefusal(
  why: string,
  arguments_: Record<string, unknown>,
  effect: string,
  call: () => unknown,
): Promise<void> {
  let observed = ''
  try {
    const value = await call()
    observed = `the call returned ${describeValue(value)}`
  } catch (error: unknown) {
    observed = error instanceof WebTestPolicyError ? error.message : `unexpected failure: ${String(error)}`
  }
  const parsed = refusalOf(observed)
  rows.push({
    entry: why,
    point: 'service-backstop',
    case: 'denied',
    arguments: arguments_,
    providerBodyRan: 'not-countered',
    observed: `${observed} | ${effect}`,
    reason: parsed.reason,
    subject: parsed.subject,
  })
}

describe('cross-entry rejection matrix', () => {
  beforeAll(async () => {
    harness = await startPolicy()
    sourceTarget = await harness.ctx.fs.resolve(harness.sourceFile)
    outsideTarget = await harness.ctx.fs.resolve(harness.outsideFile)
    directoryTarget = await harness.ctx.fs.resolve(harness.codeRoot)
    harness.admit({ actions: 50 })
  })

  afterAll(async () => {
    if (harness === undefined) return
    await harness.stop()
  })

  it('decides every model-initiated entry path at the tool guard', async () => {
    const cases: Case[] = [
      {
        why: 'read (inside the declared code root)',
        point: 'tool-guard',
        case: 'allowed',
        reason: '',
        body: 'not-countered',
        tool: { name: 'read', arguments: { file_path: policy().sourceFile } },
      },
      {
        why: 'read (outside the declared code root)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'not-countered',
        tool: { name: 'read', arguments: { file_path: policy().outsideFile } },
      },
      {
        why: 'read (a directory link inside the code root pointing outside it)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'not-countered',
        tool: { name: 'read', arguments: { file_path: join(policy().escapingLink, 'secret.ts') } },
      },
      {
        why: 'read (a file link inside the code root pointing outside it)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-unknown-target',
        body: 'not-countered',
        tool: { name: 'read', arguments: { file_path: policy().linkedFile } },
      },
      {
        why: 'read (a relative path the guard cannot canonically resolve)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-unknown-target',
        body: 'not-countered',
        tool: { name: 'read', arguments: { file_path: 'src/app.ts' } },
      },
      {
        why: 'read (aimed at the protected upload material directory)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'not-countered',
        tool: { name: 'read', arguments: { file_path: policy().uploadFile } },
      },
      {
        why: 'write (into the read-only code root)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'not-countered',
        tool: { name: 'write', arguments: { file_path: policy().sourceFile, content: 'x' } },
      },
      {
        why: 'edit (the tool-fs edit path against the read-only code root)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'not-countered',
        tool: {
          name: 'edit',
          arguments: { file_path: policy().sourceFile, old_string: 'answer', new_string: '43' },
        },
      },
      {
        why: 'str_replace (the duplicated editor copy against the read-only code root)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'not-countered',
        tool: {
          name: 'str_replace_editor',
          arguments: { command: 'str_replace', path: policy().sourceFile, old_str: 'answer', new_str: '43' },
        },
      },
      {
        why: 'str_replace_editor view (the duplicated editor copy reading a file)',
        point: 'tool-guard',
        case: 'allowed',
        reason: '',
        body: 'not-countered',
        tool: { name: 'str_replace_editor', arguments: { command: 'view', path: policy().sourceFile } },
      },
      {
        why: 'str_replace_editor view (the duplicated editor copy reading protected material)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'not-countered',
        tool: { name: 'str_replace_editor', arguments: { command: 'view', path: policy().uploadFile } },
      },
      {
        why: 'grep (enumerating under the code root)',
        point: 'tool-guard',
        case: 'allowed',
        reason: '',
        body: 'not-countered',
        tool: { name: 'grep', arguments: { path: policy().codeRoot, pattern: 'answer' } },
      },
      {
        why: 'bash (an arbitrary shell command)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'not-countered',
        tool: { name: 'bash', arguments: { command: 'rm -rf /' } },
      },
      {
        why: 'pwsh (an arbitrary shell command)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'not-countered',
        tool: { name: 'pwsh', arguments: { command: 'Remove-Item -Recurse C:\\' } },
      },
      {
        why: 'terminal_open (the terminal capability)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'not-countered',
        tool: { name: 'terminal_open', arguments: { type: 'bash' } },
      },
      {
        why: 'web_fetch (the declared entry origin under a live grant)',
        point: 'tool-guard',
        case: 'allowed',
        reason: '',
        body: 'not-countered',
        tool: { name: 'web_fetch', arguments: { url: 'http://localhost:3000/checkout' } },
      },
      {
        why: 'web_fetch (outside the declared entry origin, no third-party grant)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'not-countered',
        tool: { name: 'web_fetch', arguments: { url: 'https://example.com/collect' } },
      },
      {
        why: 'web_search (a third-party search with no third-party grant)',
        point: 'tool-guard',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'not-countered',
        tool: { name: 'web_search', arguments: { queries: ['dsh web test policy'] } },
      },
    ]
    await observe(cases, policy().ctx, sourceTarget)
    expectRowsMatch(cases)
    expect(rows.find(row => row.entry === 'read (inside the declared code root)')?.observed).toBe('ran:read')
  })

  it('refuses a direct capability call that never reached the tool registry', async () => {
    const { standIns } = policy()
    const cases: Case[] = [
      {
        why: 'ctx.fs.readText (inside the code root under a live grant)',
        point: 'service-backstop',
        case: 'allowed',
        reason: '',
        body: 'not-countered',
        reported: { target: '<codeRoot>/src/app.ts' },
        service: async (ctx, target) => await ctx.fs.readText(target),
      },
      {
        why: 'ctx.fs.readText (outside the code root)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'not-countered',
        reported: { target: '<outside>/secret.ts' },
        service: async ctx => await ctx.fs.readText(outsideTarget),
      },
      {
        why: 'ctx.fs.streamText (inside the code root under a live grant)',
        point: 'service-backstop',
        case: 'allowed',
        reason: '',
        body: 'not-countered',
        reported: { target: '<codeRoot>/src/app.ts' },
        service: async (ctx, target) => {
          const chunks: string[] = []
          for await (const chunk of await ctx.fs.streamText(target)) chunks.push(chunk)
          return chunks.join('')
        },
      },
      {
        why: 'ctx.fs.listDir (inside the code root under a live grant)',
        point: 'service-backstop',
        case: 'allowed',
        reason: '',
        body: 'not-countered',
        reported: { target: '<codeRoot>' },
        service: async (ctx, _target) => (await ctx.fs.listDir(directoryTarget)).map(entry => entry.name),
      },
      {
        why: 'ctx.fs.readBytes (inside the code root under a live grant)',
        point: 'service-backstop',
        case: 'allowed',
        reason: '',
        body: 'not-countered',
        reported: { target: '<codeRoot>/src/app.ts' },
        service: async (ctx, target) => await ctx.fs.readBytes(target, undefined, 1024),
      },
      {
        why: 'ctx.fs.readByteRange (inside the code root under a live grant)',
        point: 'service-backstop',
        case: 'allowed',
        reason: '',
        body: 'not-countered',
        reported: { target: '<codeRoot>/src/app.ts' },
        service: async (ctx, target) => await ctx.fs.readByteRange(target, { offset: 0, length: 4 }),
      },
      {
        why: 'ctx.fs.writeText (the path fs-local publishes a write through)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'not-countered',
        reported: { target: '<codeRoot>/src/app.ts', content: 'overwritten' },
        service: async (ctx, target) => await ctx.fs.writeText(target, 'overwritten'),
      },
      {
        why: 'ctx.fs.editText (the path fs-local publishes a rename through)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'not-countered',
        reported: { target: '<codeRoot>/src/app.ts' },
        service: async (ctx, target) => await ctx.fs.editText(target, { oldString: 'answer', newString: '43', replaceAll: false }),
      },
      {
        why: 'ctx.web.fetch (outside the declared entry origin)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'countered',
        reported: { url: 'https://example.com/collect' },
        service: async ctx => await ctx.web.fetch({ url: 'https://example.com/collect' }),
      },
      {
        why: 'ctx.web.fetch (the declared entry origin under a live grant)',
        point: 'service-backstop',
        case: 'allowed',
        reason: '',
        body: 'countered',
        reported: { url: 'http://localhost:3000/checkout' },
        service: async ctx => await ctx.web.fetch({ url: 'http://localhost:3000/checkout' }),
      },
      {
        why: 'ctx.web.search (with no third-party grant)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'countered',
        reported: { query: 'collect' },
        service: async ctx => await ctx.web.search({ query: 'collect' }),
      },
      {
        why: 'ctx.subprocess.spawn (a process spawn with no tool in front of it)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'countered',
        reported: { argv: ['cmd.exe', '/c', 'echo', 'x'] },
        service: async () => standIns.subprocessRuntime.spawn({ argv: ['cmd.exe', '/c', 'echo', 'x'] }),
      },
      {
        why: 'ctx.shell.execute (the backstop bash-local and pwsh-local lack)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'countered',
        reported: { command: 'rm -rf /' },
        service: async () => standIns.shell.execute({ command: 'rm -rf /' }),
      },
      {
        why: 'ctx.attachments.saveImages (an upload write into protected material)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'countered',
        service: async () => standIns.attachments.saveImages(),
      },
      {
        why: 'ctx.attachments.saveFile (a file upload into protected material)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'countered',
        service: async () => standIns.attachments.saveFile(),
      },
      {
        why: 'ctx.attachments.saveFileStream (a streamed file upload into protected material)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'countered',
        service: async () => standIns.attachments.saveFileStream(),
      },
      {
        why: 'ctx.attachments.saveImage (an image upload into protected material)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'countered',
        service: async () => standIns.attachments.saveImage(),
      },
      {
        why: 'ctx.attachments.readImage (a read of protected material)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-protected-path',
        body: 'countered',
        service: async () => standIns.attachments.readImage(protectedImage),
      },
      {
        why: 'ctx.terminals.spawn (the persistent terminal capability)',
        point: 'service-backstop',
        case: 'denied',
        reason: 'denied-outside-scope',
        body: 'countered',
        reported: { type: 'bash' },
        service: async () => standIns.terminals.spawn({}, { type: 'bash' }),
      },
    ]
    await observe(cases, policy().ctx, sourceTarget)
    expectRowsMatch(cases)
    const refusedReached = rows.filter(row => row.point === 'service-backstop' && row.case === 'denied'
      && row.providerBodyRan === 'entered')
    expect(refusedReached).toEqual([])
    // The admitted `ctx.fs` rows are the real local filesystem, so the value
    // each one returned is the observation; the stand-in body column does not
    // speak for them.
    expect(rows.find(row => row.entry === 'ctx.fs.readText (inside the code root under a live grant)')?.observed)
      .toBe(`ADMITTED: the call returned ${JSON.stringify(sourceBytes)}`)
    expect(rows.find(row => row.entry === 'ctx.fs.readBytes (inside the code root under a live grant)')?.observed)
      .toBe(`ADMITTED: the call returned ${JSON.stringify(sourceBytes)}`)
  })

  it('stops admitting an effect once the grant exhausts its action count', async () => {
    const other = await startPolicy()
    try {
      other.admit({ actions: 1 })
      const first = await other.callTool('read', { file_path: other.sourceFile })
      expect(first).toBe('ran:read')
      const second = await other.callTool('read', { file_path: other.sourceFile })
      expect(second).toContain('denied-expired-authorization')
      rows.push({
        entry: 'read (after the grant exhausts its action count)',
        point: 'tool-guard',
        case: 'denied',
        arguments: { file_path: other.sourceFile },
        providerBodyRan: 'not-countered',
        observed: second,
        reason: 'denied-expired-authorization',
        subject: other.sourceFile,
      })
    } finally {
      await other.stop()
    }
  })

  it('still refuses a tool registered after the policy was mounted', async () => {
    const other = await startPolicy({ deferTool: 'write' })
    try {
      other.admit()
      await other.registerTool('write', 'hot-enabled writer ran')
      const refused = await other.callTool('write', { file_path: other.sourceFile, content: 'x' })
      expect(refused).toContain('web testing policy refused "write" (denied-protected-path)')
      rows.push({
        entry: 'write (hot-enabled after the policy was mounted)',
        point: 'tool-guard',
        case: 'denied',
        arguments: { file_path: other.sourceFile, content: 'x' },
        providerBodyRan: 'not-countered',
        observed: refused,
        reason: 'denied-protected-path',
        subject: other.sourceFile,
      })
    } finally {
      await other.stop()
    }
  })

  it('boots and still decides at the guard when a capability service is not mounted at all', async () => {
    const other = await startPolicy({
      omitServices: ['web', 'shell', 'subprocess', 'attachments', 'terminals'],
      withoutFileSystem: true,
    })
    try {
      other.admit()
      const read = await other.callTool('read', { file_path: other.sourceFile })
      expect(read).toBe('ran:read')
      const shell = await other.callTool('bash', { command: 'rm -rf /' })
      expect(shell).toContain('web testing policy refused "bash" (denied-outside-scope)')
      // Nothing was installed on the stand-ins, so a direct call reaches the
      // provider unmediated: a capability this deployment does not mount has no
      // entry path to gate, and the tool guard above is what still refuses it.
      await expect(other.standIns.shell.execute({ command: 'rm -rf /' }))
        .rejects.toThrow('unreachable: the policy let shell.execute reach its provider body')
      expect(other.ctx.reflect.get('web')).toBeUndefined()
    } finally {
      await other.stop()
    }
  })

  it('refuses a hot-enabled tool name it has no adapter for', async () => {
    const other = await startPolicy()
    try {
      other.admit()
      await other.registerTool('deploy_production', 'deployed')
      const refused = await other.callTool('deploy_production', { target: 'prod' })
      expect(refused).toContain('web testing policy refused "deploy_production" (denied-unknown-target)')
      rows.push({
        entry: 'deploy_production (hot-enabled, no adapter)',
        point: 'tool-guard',
        case: 'denied',
        arguments: { target: 'prod' },
        providerBodyRan: 'not-countered',
        observed: refused,
        reason: 'denied-unknown-target',
        subject: 'deploy_production',
      })
    } finally {
      await other.stop()
    }
  })

  it('restores every decorated service method and removes the guard when the plugin is disposed', async () => {
    const other = await startPolicy()
    try {
      const { standIns } = other
      other.admit()
      await expect(standIns.shell.execute({ command: 'x' }))
        .rejects.toThrow('web testing policy refused "shell.execute"')
      const decoratedEntries: [string, object][] = [
        ['ctx.fs', other.ctx.fs],
        ['ctx.shell', standIns.shell],
        ['ctx.subprocess', standIns.subprocessRuntime],
        ['ctx.web', standIns.web],
        ['ctx.attachments', standIns.attachments],
        ['ctx.terminals', standIns.terminals],
      ]
      const decorated: ReadonlyMap<string, object> = new Map(decoratedEntries)
      for (const [service, instance] of decorated) {
        const methods = DECORATED_BY_SERVICE.get(service) ?? []
        expect(methods.length, service).toBeGreaterThan(0)
        expect(methods.every(method => Object.hasOwn(instance, method)), service).toBe(true)
      }
      await other.disposePolicy()
      // A method the service inherited returns to the prototype, so the own
      // property the wrapper added is gone. A method the service owned is
      // reinstated, and what runs again is the body: each stand-in's own body
      // fails loudly, so reaching it is what says the wrapper is gone.
      for (const method of DECORATED_BY_SERVICE.get('ctx.fs') ?? []) {
        expect(Object.hasOwn(other.ctx.fs, method), `ctx.fs.${method}`).toBe(false)
      }
      const reached = 'unreachable: the policy let'
      await expect(standIns.shell.execute({ command: 'x' })).rejects.toThrow(reached)
      // `subprocess.spawn` publishes its handle synchronously, so its stand-in
      // body throws rather than rejecting, and the web stand-in's body succeeds
      // where the other stand-ins fail loudly.
      expect(() => standIns.subprocessRuntime.spawn({ argv: ['x'] })).toThrow(reached)
      await expect(standIns.web.fetch({ url: 'http://localhost:3000/checkout' }))
        .resolves.toMatchObject({ statusCode: 200 })
      await expect(standIns.attachments.readImage(protectedImage)).rejects.toThrow(reached)
      await expect(standIns.terminals.spawn({}, { type: 'bash' })).rejects.toThrow(reached)
      const unguarded = await other.callTool('bash', { command: 'x' })
      expect(unguarded).toBe('ran:bash')
    } finally {
      await other.stop()
    }
  })

  it('refuses to stand in for a third-party authorization with a test-environment one', async () => {
    const other = await startPolicy()
    try {
      other.policy.bindEntry(sessionId, other.published.current.projectId)
      other.policy.declareEnvironment({
        projectId: other.published.current.projectId,
        commandId: 'cmd-declare-third-party',
        declaration: {
          codeRoots: [other.codeRoot],
          entryUrl: 'http://localhost:3000/checkout',
          isTestEnvironment: true,
          login: { state: 'not-required' },
          supplementaryRequirements: [],
        },
      })
      const receipt = other.policy.grantFlow({
        sessionId, flowId, flowRevision, thirdParty: true, actions: 5,
      })
      expect(receipt.thirdParty).toBe(true)
      const search = await other.callTool('web_search', { queries: ['dsh web test policy'] })
      expect(search).toBe('ran:web_search')
      const sourceRead = await other.callTool('read', { file_path: other.sourceFile })
      expect(sourceRead).toContain('denied-expired-authorization')
    } finally {
      await other.stop()
    }
  })
})

/**
 * Every method the backstop decorates, per service, so restoration is asserted
 * as a set and the matrix is checked for one row per decorated method.
 */
const DECORATED_BY_SERVICE: ReadonlyMap<string, readonly string[]> = new Map([
  ['ctx.fs', [
    'readText', 'readBytes', 'readByteRange', 'streamText', 'listDir', 'writeText', 'editText',
  ]],
  ['ctx.shell', ['execute']],
  ['ctx.subprocess', ['spawn', 'spawnTerminal']],
  ['ctx.web', ['fetch', 'search']],
  ['ctx.attachments', [
    'saveImage', 'saveImages', 'admitEncodedFile', 'admitPromptContent', 'saveFile', 'saveFileStream',
    'readImage', 'readFileStream', 'readImageRequest',
  ]],
  ['ctx.terminals', ['spawn', 'startSend', 'read', 'signal']],
])

describe('service backstop over the real capability services', () => {
  beforeAll(async () => {
    real = await startRealCapabilities()
  })

  afterAll(async () => {
    if (real === undefined) return
    await real.stop()
  })

  it('refuses the verbatim byte stream of a real stored upload the same store hands back undecorated', async () => {
    const services = capabilities()
    // The control. The real store really holds these bytes, and the very same
    // reference reads them back through the prototype method the backstop
    // replaced, so the refusal below withholds something real.
    expect(await services.readStoredUpload()).toBe(uploadBytes)
    await observeRefusal(
      'ctx.attachments.readFileStream (the verbatim byte stream of a real stored upload)',
      { ref: '<storeRoot>/objects/<sha256 of the stored upload>' },
      'no chunk was produced; the undecorated read of the same reference returned the stored bytes',
      () => services.store.readFileStream(services.upload),
    )
    expect(rows.find(row => row.entry.startsWith('ctx.attachments.readFileStream'))?.reason).toBe('denied-protected-path')
  })

  it('refuses the request-image projection of a stored image', async () => {
    const services = capabilities()
    await observeRefusal(
      'ctx.attachments.readImageRequest (the model-request projection of stored material)',
      { ref: '<storeRoot>/objects/<sha256 of the stored image>', target: { width: 512, height: 512, maxBytes: 262144 } },
      'the provider was never asked for a request version',
      async () => await services.store.readImageRequest(services.imageRef, { width: 512, height: 512, maxBytes: 262144 }),
    )
    expect(rows.find(row => row.entry.startsWith('ctx.attachments.readImageRequest'))?.reason).toBe('denied-protected-path')
  })

  it('refuses both remaining upload writes and leaves the store exactly as it was', async () => {
    const services = capabilities()
    const before = services.storedObjectCount()
    expect(before).toBeGreaterThan(0)
    const encoded = Buffer.from(uploadBytes, 'utf8').toString('base64')
    await observeRefusal(
      'ctx.attachments.admitEncodedFile (a base64 file upload into protected material)',
      { data: '<canonical base64 of the upload>', name: 'report.txt' },
      `the store still holds ${String(before)} objects`,
      async () => await services.store.admitEncodedFile({ data: encoded, name: 'report.txt' }),
    )
    await observeRefusal(
      'ctx.attachments.admitPromptContent (a Host prompt carrying an uploaded image)',
      { content: [{ type: 'text', text: 'check the checkout page' }, { type: 'image', mediaType: 'image/png', data: '<png>' }] },
      `the store still holds ${String(services.storedObjectCount())} objects`,
      async () => await services.store.admitPromptContent([
        { type: 'text', text: 'check the checkout page' },
        { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
      ]),
    )
    expect(services.storedObjectCount()).toBe(before)
  })

  it('admits ordered pure text prompts without storing attachments while file and image parts remain refused', async () => {
    const services = capabilities()
    const before = services.storedObjectCount()
    const content = [
      { type: 'text' as const, text: '中文第一行\nSecond line' },
      { type: 'text' as const, text: 'Continue the same prompt.' },
    ]
    expect(await services.store.admitPromptContent(content)).toEqual(content)
    expect(await services.store.admitPromptContent([])).toEqual([])
    await expect(services.store.admitPromptContent([
      ...content, { type: 'file', attachment: services.upload },
    ])).rejects.toThrow(WebTestPolicyError)
    await expect(services.store.admitPromptContent([
      ...content, { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
    ])).rejects.toThrow(WebTestPolicyError)
    expect(services.storedObjectCount()).toBe(before)
  })

  it('commits and reads the same material when the policy is not mounted, so the refusals above withhold real bytes', async () => {
    const control = await startRealCapabilities()
    try {
      const committed = control.storedObjectCount()
      const payload = { data: Buffer.from('a second upload\n', 'utf8').toString('base64'), name: 'second.txt' }
      // One harness, one call, two answers: the refusal is the policy's and the
      // commit is the store's, so the count the refused cases protect is real.
      await expect(control.store.admitEncodedFile(payload)).rejects.toThrow(WebTestPolicyError)
      expect(control.storedObjectCount()).toBe(committed)
      await control.disposePolicy()
      const admitted = await control.store.admitEncodedFile(payload)
      expect(admitted.bytes).toBeGreaterThan(0)
      expect(control.storedObjectCount()).toBe(committed + 1)
      expect(await control.readStoredUpload()).toBe(uploadBytes)
    } finally {
      await control.stop()
    }
  })

  it('refuses the terminal primitive the subprocess service exposes directly', async () => {
    const services = capabilities()
    const spec = { argv: [] as readonly string[], cwd: services.codeRoot, rows: 24, cols: 80, terminalType: 'dumb', graceMs: 1000 }
    await observeRefusal(
      'ctx.subprocess.spawnTerminal (the persistent shell the subprocess service allocates)',
      { argv: [], cwd: '<codeRoot>', terminalType: 'dumb' },
      'the provider was never asked to allocate a terminal',
      async () => await services.ctx.subprocess.spawnTerminal(spec),
    )
    // The control, on a harness of its own so the policy this suite is attacking
    // stays mounted: with the decoration removed the same call reaches the real
    // provider and fails inside it on its own validation, which is what a
    // refusal from the policy is distinguishable from.
    const control = await startRealCapabilities()
    try {
      await control.disposePolicy()
      await expect(control.ctx.subprocess.spawnTerminal(spec))
        .rejects.toThrow('subprocess-local: terminal argv must contain a program')
    } finally {
      await control.stop()
    }
  })

  it('refuses every terminal operation, including the ones on a session that already exists', async () => {
    const services = capabilities()
    const log = services.backendLog()
    expect(log).toContain('spawn:')
    await observeRefusal(
      'ctx.terminals.spawn (a new persistent terminal)',
      { type: 'probe', name: 'second' },
      `the backend log still holds ${String(services.backendLog().split('\n').length - 2)} lines`,
      async () => await services.ctx.terminals.spawn(services.owner, { type: 'probe', name: 'second' }),
    )
    await observeRefusal(
      'ctx.terminals.startSend (writing into a live persistent terminal)',
      { sessionId: services.session, text: 'cat /etc/passwd', submit: true },
      'no send line was appended to the backend log',
      () => services.ctx.terminals.startSend(services.owner, services.session, { text: 'cat /etc/passwd', submit: true }),
    )
    await observeRefusal(
      'ctx.terminals.read (reading a live terminal\'s scrollback)',
      { sessionId: services.session },
      'no read line was appended to the backend log',
      () => services.ctx.terminals.read(services.owner, services.session),
    )
    await observeRefusal(
      'ctx.terminals.signal (delivering a signal to a terminal\'s foreground group)',
      { sessionId: services.session, signal: 'SIGINT' },
      'no signal line was appended to the backend log',
      async () => await services.ctx.terminals.signal(services.owner, services.session, 'SIGINT'),
    )
    expect(services.backendLog()).toBe(log)
    const reasons = new Map([
      ['ctx.terminals.spawn (a new persistent terminal)', 'denied-outside-scope'],
      ['ctx.terminals.startSend (writing into a live persistent terminal)', 'denied-outside-scope'],
      ['ctx.terminals.read (reading a live terminal\'s scrollback)', 'denied-outside-scope'],
      ['ctx.terminals.signal (delivering a signal to a terminal\'s foreground group)', 'denied-outside-scope'],
    ])
    for (const [entry, reason] of reasons) {
      expect(rows.find(row => row.entry === entry)?.reason, entry).toBe(reason)
    }
  })

  it('refuses a read and a write of the real filesystem, leaving the file as it was', async () => {
    const services = capabilities()
    const target = await services.ctx.fs.resolve(services.sourceFile)
    const storedPath = services.store.fileHostPath(services.upload)
    await observeRefusal(
      'ctx.fs.writeText (into the read-only code root, real local filesystem)',
      { target: '<codeRoot>/src/app.ts', content: 'overwritten' },
      'the file still holds its original content',
      async () => await services.ctx.fs.writeText(target, 'overwritten'),
    )
    await observeRefusal(
      'ctx.fs.readText (aimed at a protected object through the host path the store projects)',
      { target: storedPath },
      'the protected object was not read; the same bytes are refused by attachments.readFileStream',
      async () => await services.ctx.fs.readText(await services.ctx.fs.resolve(storedPath)),
    )
    expect(readFileSync(services.sourceFile, 'utf8')).toBe(sourceBytes)
    // The control for the host-path projection: it resolves to a real file whose
    // bytes are the protected upload, and every `ctx.fs` read of that file is
    // refused, which is why the projection itself is left undecorated.
    expect(readFileSync(storedPath, 'utf8')).toBe(uploadBytes)
    const reasons = new Map([
      ['ctx.fs.writeText (into the read-only code root, real local filesystem)', 'denied-protected-path'],
      ['ctx.fs.readText (aimed at a protected object through the host path the store projects)', 'denied-protected-path'],
    ])
    for (const [entry, reason] of reasons) {
      expect(rows.find(row => row.entry === entry)?.reason, entry).toBe(reason)
    }
  })

  it('reports one row per decorated method, and the row count is the number of rows', () => {
    const observed = new Set(rows
      .filter(row => row.point === 'service-backstop')
      .map(row => row.entry.replace(/\s.*$/u, '')))
    for (const [service, methods] of DECORATED_BY_SERVICE) {
      for (const method of methods) {
        expect(observed.has(`${service}.${method}`), `no matrix row for the decorated method ${service}.${method}`)
          .toBe(true)
      }
    }
    expect(matrixPreamble(rows)).toContain(`This run observed ${String(rows.length)} rows`)
  })
})

// Registered after both describes, so the file every case above contributed to
// is written once the last row exists.
afterAll(() => {
  if (harness === undefined) return
  harness.writeEvidence('rejection-matrix.md', renderEvidence(harness.root))
})

/**
 * Render the observed rows as the Markdown document the evidence file carries.
 *
 * The temporary tree's root is replaced with `<root>` in every field, because a
 * report that has to carry a random temporary directory in each of fifty rows is
 * a report nobody reads.
 * @param root - the temporary tree's root path.
 * @returns the Markdown document.
 */
function renderEvidence(root: string): string {
  const shorten = (text: string): string => text.split(root).join('<root>')
  return [
    '# M1-T05-A cross-entry rejection matrix',
    '',
    shorten(matrixPreamble(rows)),
    '',
    '| Entry path | Point | Case | Arguments | Provider body ran | Observed | Reason | Subject |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(row => `| \`${row.entry}\` | ${row.point} | ${row.case} | \`${shorten(JSON.stringify(row.arguments))}\` | ${row.providerBodyRan} | ${shorten(row.observed).replace(/\|/gu, '\\|')} | ${row.reason} | \`${shorten(row.subject).replace(/\|/gu, '\\|')}\` |`),
    '',
  ].join('\n')
}
