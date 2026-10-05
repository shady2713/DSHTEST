/**
 * The fields `web_test_report_case` declares optional are optional on the way in.
 *
 * The tool has always told the model that omitted optional fields are filled
 * with empty values on the stored record. The storage schema required them, so
 * a model that followed the contract failed with an "expected string, received
 * undefined" error and had to pass empty strings to get through. These cases
 * omit each field in turn.
 *
 * @module dsh-plugin-web-test/tests/case-result-fields
 */

import { describe, expect, it } from 'vitest'
import { caseResultRecordSchema } from '../src/records.ts'
import { casePlan, run, seedOf } from './support/seed.ts'
import { cleanupHomes, harness } from './support/harness.ts'

describe('case result optional fields', () => {
  it('stores a result whose step omits evidencePath and observed', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({ runs: { 'run-1': run() }, case_plans: { 'run-1/c': casePlan('run-1', 'c', { status: 'confirmed', confirmedAtMs: 1 }) } }),
    })
    try {
      await store.putCaseResult(caseResultRecordSchema.parse(result({
        steps: [{ index: 1, intent: '打开首页', outcome: 'passed' }],
      })))
      const stored = store.listCaseResults('run-1')[0]
      expect(stored?.steps[0]?.evidencePath).toBe('')
      expect(stored?.steps[0]?.observed).toBe('')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('stores a result whose assertion omits actual and reason', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({ runs: { 'run-1': run() }, case_plans: { 'run-1/c': casePlan('run-1', 'c', { status: 'confirmed', confirmedAtMs: 1 }) } }),
    })
    try {
      await store.putCaseResult(caseResultRecordSchema.parse(result({
        assertions: [{ expected: '标题非空', outcome: 'passed' }],
      })))
      const stored = store.listCaseResults('run-1')[0]
      expect(stored?.assertions[0]?.actual).toBe('')
      expect(stored?.assertions[0]?.reason).toBe('')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('keeps a value the run did supply', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({ runs: { 'run-1': run() }, case_plans: { 'run-1/c': casePlan('run-1', 'c', { status: 'confirmed', confirmedAtMs: 1 }) } }),
    })
    try {
      await store.putCaseResult(caseResultRecordSchema.parse(result({
        steps: [{ index: 1, intent: '打开', outcome: 'passed', evidencePath: '/tmp/a.png', observed: '页面加载' }],
      })))
      expect(store.listCaseResults('run-1')[0]?.steps[0]?.evidencePath).toBe('/tmp/a.png')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })
})

/**
 * A case result with the given steps and assertions.
 * @param parts - Steps and assertions to place on the record.
 * @returns the record fields.
 */
function result(parts: { steps?: unknown[], assertions?: unknown[] }): Record<string, unknown> {
  return {
    schemaVersion: 3,
    kind: 'case-result',
    key: 'run-1/c',
    runKey: 'run-1',
    projectKey: 'shop',
    environmentRevisionKey: 'shop-test',
    caseKey: 'c',
    title: '检查标题',
    outcome: 'passed',
    steps: parts.steps ?? [],
    assertions: parts.assertions ?? [],
    openQuestions: [],
    evidencePaths: [],
    label: '检查标题',
    updatedAtMs: 1,
  }
}
