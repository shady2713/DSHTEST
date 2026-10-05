/**
 * Report derivation: the verdict rules and the three exported forms.
 *
 * A report is the only thing a reader sees, so these tests pin what it is
 * allowed to claim.
 *
 * @module dsh-plugin-web-test/tests/report
 */

import { describe, expect, it } from 'vitest'
import { buildReport, buildReportBundle } from '../src/report.ts'
import type { CaseResultRecord, OperationRecord, RunRecord } from '../src/types.ts'

/** A recorded case result with the given outcome and open questions. */
function result(
  caseKey: string,
  outcome: CaseResultRecord['outcome'],
  openQuestions: string[] = [],
): CaseResultRecord {
  return {
    schemaVersion: 3,
    kind: 'case-result',
    key: `run-1/${caseKey}`,
    label: `shop ${caseKey}`,
    updatedAtMs: 1,
    runKey: 'run-1',
    projectKey: 'shop',
    environmentRevisionKey: 'shop-test',
    caseKey,
    outcome,
    steps: [{ index: 1, intent: 'open the page', observed: 'the page opened', outcome, evidencePath: '' }],
    assertions: [{ expected: 'the title matches', actual: 'the title is Home', outcome, reason: '' }],
    evidencePaths: [],
    openQuestions,
  }
}

/** A run record in a chosen status. */
function run(status: RunRecord['status']): RunRecord {
  return {
    schemaVersion: 3,
    kind: 'run',
    key: 'run-1',
    label: 'run-1',
    updatedAtMs: 1,
    projectKey: 'shop',
    environmentRevisionKey: 'shop-test',
    phase: 'execution',
    status,
    unresolvedOperations: {},
    ownerSessionId: 'session-a',
    activeRole: '',
    waitingUntilMs: 0,
    waitingReason: '',
  }
}

/** An operation in a chosen dispatch state. */
function operation(dispatch: OperationRecord['dispatch']): OperationRecord {
  return {
    schemaVersion: 3,
    kind: 'operation',
    key: 'run-1/op-1',
    label: 'create order #7',
    updatedAtMs: 1,
    runKey: 'run-1',
    operationKey: 'op-1',
    intent: 'create order #7',
    role: 'admin',
    generation: 2,
    requestDigest: 'sha256:aa',
    dispatch,
  }
}

describe('run verdict', () => {
  it('never claims a pass for a run with nothing recorded', () => {
    const report = buildReportBundle({ runKey: 'run-1', results: [] })
    expect(report.verdict).toBe('empty')
    expect(report.markdown).toContain('没有记录任何用例结果，因此不能判定通过')
  })

  it('passes a run whose every recorded case passed and settled everything', () => {
    const report = buildReportBundle({ runKey: 'run-1', results: [result('home-title', 'passed')] })
    expect(report.verdict).toBe('passed')
    expect(report.markdown).toContain('全部已记录用例通过')
  })

  it('leaves the run undetermined when a passed case still carries a question', () => {
    const report = buildReportBundle({
      runKey: 'run-1',
      results: [result('home-title', 'passed', ['登录后是否应保留购物车？'])],
    })
    expect(report.verdict).toBe('undetermined')
    expect(report.markdown).toContain('存在 1 项待确认，结论未定')
    // The per-case outcome stays visible, so both facts reach the reader.
    expect(report.markdown).toContain('通过（1 项待确认）')
    expect(report.markdown).toContain('登录后是否应保留购物车？')
  })

  it('fails a run that recorded a failing case', () => {
    const report = buildReportBundle({
      runKey: 'run-1',
      results: [result('checkout', 'failed'), result('home-title', 'passed')],
    })
    expect(report.verdict).toBe('failed')
    expect(report.markdown).toContain('存在失败用例')
  })

  it('leaves blocked, incomplete and skipped cases undetermined rather than passed', () => {
    for (const outcome of ['blocked', 'incomplete', 'skipped'] as const) {
      const report = buildReportBundle({ runKey: 'run-1', results: [result('checkout', outcome)] })
      expect(report.verdict, outcome).toBe('undetermined')
    }
  })
})

describe('unresolved operations in the report', () => {
  it('states the run status so a stopped run is not read as a finished one', () => {
    const report = buildReportBundle({ runKey: 'run-1', results: [result('a', 'passed')], run: run('cancelled') })
    expect(report.markdown).toContain('运行状态：`cancelled`')
    expect(report.json.runStatus).toBe('cancelled')
  })

  it('carries an unknown operation into all three forms, with its reason', () => {
    const bundle = buildReportBundle({
      runKey: 'run-1',
      results: [result('a', 'passed')],
      operations: [operation({ kind: 'unknown', reason: 'the connection dropped after the click' })],
    })
    expect(bundle.markdown).toContain('结果未确认的操作')
    expect(bundle.markdown).toContain('the connection dropped after the click')
    // The role and generation travel with the line, so a report says which
    // attempt of the operation this is rather than only that it is unresolved.
    expect(bundle.markdown).toContain('角色 admin 第 2 代')
    expect(bundle.html).toContain('角色 admin 第 2 代')
    expect(bundle.html).toContain('the connection dropped after the click')
    expect(bundle.json.unresolvedOperations).toEqual([
      {
        operationKey: 'op-1',
        intent: 'create order #7',
        role: 'admin',
        generation: 2,
        dispatch: 'unknown',
        reason: 'the connection dropped after the click',
      },
    ])
  })

  it('lists an operation that is still in flight, because it has no outcome either', () => {
    const bundle = buildReportBundle({
      runKey: 'run-1',
      results: [],
      operations: [operation({ kind: 'dispatching' })],
    })
    expect(bundle.json.unresolvedOperations.map(item => item.dispatch)).toEqual(['dispatching'])
  })

  it('leaves a settled operation out, because its outcome is established', () => {
    const bundle = buildReportBundle({
      runKey: 'run-1',
      results: [],
      operations: [operation({ kind: 'settled', outcome: 'observed-success' })],
    })
    expect(bundle.json.unresolvedOperations).toEqual([])
    expect(bundle.markdown).not.toContain('结果未确认的操作')
  })
})

describe('exported forms', () => {
  it('renders a standalone HTML document', () => {
    const bundle = buildReportBundle({ runKey: 'run-1', results: [result('home-title', 'passed')] })
    expect(bundle.html.startsWith('<!doctype html>')).toBe(true)
    expect(bundle.html).toContain('</html>')
    expect(bundle.html).toContain('home-title')
  })

  it('escapes a case\'s own words, so a page under test cannot inject markup into the report', () => {
    const hostile = result('xss', 'failed', ['<script>alert(1)</script>'])
    const bundle = buildReportBundle({ runKey: 'run-1', results: [hostile] })
    expect(bundle.html).not.toContain('<script>alert(1)</script>')
    expect(bundle.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('keeps the three forms describing the same run', () => {
    const bundle = buildReportBundle({ runKey: 'run-1', results: [result('a', 'passed'), result('b', 'failed')] })
    expect(bundle.json.runKey).toBe(bundle.runKey)
    expect(bundle.json.verdict).toBe(bundle.verdict)
    expect(bundle.json.cases).toHaveLength(2)
    expect(bundle.markdown).toContain('失败 1')
    expect(bundle.html).toContain('失败 1')
  })

  it('still offers the single-form Markdown entry point', () => {
    expect(buildReport('run-1', [result('a', 'passed')])).toContain('# Web 测试报告')
  })
})
