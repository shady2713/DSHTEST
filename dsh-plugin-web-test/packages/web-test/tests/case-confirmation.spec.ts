/**
 * A run may only execute and report a case the operator approved.
 *
 * These tests pin the enforcement in the tool path rather than in a prompt, so
 * the guarantee does not depend on the model cooperating.
 *
 * @module dsh-plugin-web-test/tests/case-confirmation
 */

import { describe, expect, it } from 'vitest'
import { cleanupHomes, harness } from './support/harness.ts'
import { computeCoverage, buildReportBundle } from '../src/report.ts'
import { casePlan, run, seedOf } from './support/seed.ts'

describe('case confirmation', () => {
  it('refuses a result for a case nobody proposed', async () => {
    const { store, dispose } = await harness({ seed: seedOf({ runs: { 'run-1': run() } }) })
    try {
      expect(store.getCasePlan('run-1', 'ghost')).toBeUndefined()
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('refuses a result for a case that is still proposed', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({ runs: { 'run-1': run() }, case_plans: { 'run-1/home-title': casePlan() } }),
    })
    try {
      expect(store.getCasePlan('run-1', 'home-title')?.status).toBe('proposed')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('confirms a proposed case and refuses to rule on it twice', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({ runs: { 'run-1': run() }, case_plans: { 'run-1/home-title': casePlan() } }),
    })
    try {
      const ruled = await store.ruleOnCase('run-1', 'home-title', 'confirm', '用户已确认')
      expect(ruled.status).toBe('confirmed')
      expect(ruled.confirmedAtMs).toBeGreaterThan(0)
      await expect(store.ruleOnCase('run-1', 'home-title', 'confirm', ''))
        .rejects.toThrow(/is already confirmed/)
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('refuses to rule on a case the run never proposed', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({ runs: { 'run-1': run() }, case_plans: { 'run-1/home-title': casePlan() } }),
    })
    try {
      await expect(store.ruleOnCase('run-1', 'missing', 'confirm', ''))
        .rejects.toThrow(/proposed no case "missing"/)
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('keeps a rejected case rejected and out of the executable set', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({ runs: { 'run-1': run() }, case_plans: { 'run-1/home-title': casePlan() } }),
    })
    try {
      const ruled = await store.ruleOnCase('run-1', 'home-title', 'reject', '超出本次范围')
      expect(ruled.status).toBe('rejected')
      expect(ruled.notes).toBe('超出本次范围')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })
})

describe('report coverage', () => {
  it('names a confirmed case that produced no result as a gap', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run() },
        case_plans: { 'run-1/home-title': casePlan('run-1', 'home-title', { status: 'confirmed', confirmedAtMs: 1 }) },
      }),
    })
    try {
      const coverage = computeCoverage(store.listCasePlans('run-1'), [])
      expect(coverage).toEqual([{
        caseKey: 'home-title',
        title: '首页标题',
        status: 'confirmed',
        confirmedSteps: 2,
        reported: false,
      }])
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('does not treat a rejected case as a gap', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run() },
        case_plans: { 'run-1/home-title': casePlan('run-1', 'home-title', { status: 'rejected', confirmedAtMs: 1 }) },
      }),
    })
    try {
      const coverage = computeCoverage(store.listCasePlans('run-1'), [])
      expect(coverage[0]?.status).toBe('rejected')
      expect(coverage[0]?.confirmedSteps).toBe(0)
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('leaves a run undetermined when a confirmed case produced no result', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run() },
        case_plans: { 'run-1/home-title': casePlan('run-1', 'home-title', { status: 'confirmed', confirmedAtMs: 1 }) },
      }),
    })
    try {
      const bundle = buildReportBundle({
        runKey: 'run-1',
        results: [],
        plans: store.listCasePlans('run-1'),
      })
      expect(bundle.verdict).toBe('undetermined')
      expect(bundle.markdown).toContain('结论未定')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })
})
