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
import { casePlan, environment, run, seedOf } from './support/seed.ts'

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

describe('operator decision backlog', () => {
  it('distinguishes an operator pause from a restart that interrupted a run', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: {
          'run-paused': run('run-paused', 'session-a', { status: 'paused' }),
          'run-parked': run('run-parked', 'session-a', { status: 'resuming' }),
        },
      }),
    })
    try {
      const status = store.status()
      const byKey = new Map(status?.needsDecision.runs.map(entry => [entry.runKey, entry]))
      expect(byKey.get('run-paused')?.reason).toContain('the operator paused this run')
      expect(byKey.get('run-paused')?.reason).not.toContain('reopened its store')
      expect(byKey.get('run-parked')?.reason).toContain('reopened its store')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('parks a run that was executing when the process stopped and lists it', async () => {
    // Seeding a `running` run and opening the store models a host restart: the
    // run was executing when the process went away, so it is parked rather than
    // resumed, and it has to be visible until somebody decides.
    const { store, dispose } = await harness({ seed: seedOf({ runs: { 'run-1': run() } }) })
    try {
      expect(store.getRun('run-1')?.status).toBe('resuming')
      const backlog = store.status()?.needsDecision.runs ?? []
      expect(backlog.map(entry => entry.runKey)).toEqual(['run-1'])
      expect(store.status()?.reconciliation.blockedRuns).toEqual(['run-1'])
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('leaves a terminal run out of the backlog', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({ runs: { 'run-1': run('run-1', 'session-a', { status: 'completed' }) } }),
    })
    try {
      expect(store.status()?.needsDecision.runs).toEqual([])
    } finally {
      await dispose()
      cleanupHomes()
    }
  })
})

describe('operation repeat guard', () => {
  const operation = (operationKey: string, digest: string, extra: Record<string, unknown> = {}) => ({
    schemaVersion: 3,
    kind: 'operation',
    key: `run-1/${operationKey}`,
    runKey: 'run-1',
    operationKey,
    intent: '下单',
    role: 'admin',
    requestDigest: digest,
    dispatch: { kind: 'dispatching' },
    label: '下单',
    updatedAtMs: 1,
    ...extra,
  })

  it('refuses the same operation key while its outcome is unresolved', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run() },
        'environment_revisions': { 'shop-test': environment() },
        operations: { 'run-1/op-1': operation('op-1', 'd1', { dispatch: { kind: 'unknown', reason: 'interrupted' } }) },
      }),
    })
    try {
      await store.controlRun('run-1', 'resume')
      await expect(store.beginOperation('run-1', 'op-1', '下单', 'd1', 'admin'))
        .rejects.toThrow(/its outcome is unresolved/)
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('refuses the same request under a new operation key', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run() },
        'environment_revisions': { 'shop-test': environment() },
        operations: { 'run-1/op-1': operation('op-1', 'digest-abc', { dispatch: { kind: 'unknown', reason: 'interrupted' } }) },
      }),
    })
    try {
      await store.controlRun('run-1', 'resume')
      // The operation key is the run's own label, so renaming it must not be a
      // way to submit a change whose outcome was never observed.
      await expect(store.beginOperation('run-1', 'op-1-retry', '下单', 'digest-abc', 'admin'))
        .rejects.toThrow(/already dispatched this exact request as operation "op-1"/)
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('refuses a repeat of a request that already settled, too', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run() },
        'environment_revisions': { 'shop-test': environment() },
        operations: { 'run-1/op-1': operation('op-1', 'digest-abc', { dispatch: { kind: 'settled', outcome: 'observed-success' } }) },
      }),
    })
    try {
      await store.controlRun('run-1', 'resume')
      await expect(store.beginOperation('run-1', 'op-2', '下单', 'digest-abc', 'admin'))
        .rejects.toThrow(/already dispatched this exact request/)
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('accepts a genuinely different request', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run() },
        'environment_revisions': { 'shop-test': environment() },
        operations: { 'run-1/op-1': operation('op-1', 'digest-abc', { dispatch: { kind: 'settled', outcome: 'observed-success' } }) },
      }),
    })
    try {
      await store.controlRun('run-1', 'resume')
      const begun = await store.beginOperation('run-1', 'op-2', '下单', 'digest-other', 'admin')
      expect(begun.dispatch.kind).toBe('dispatching')
      expect(begun.requestDigest).toBe('digest-other')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })

  it('scopes the guard to the run that dispatched the request', async () => {
    const { store, dispose } = await harness({
      seed: seedOf({
        runs: { 'run-1': run('run-1'), 'run-2': run('run-2') },
        'environment_revisions': { 'shop-test': environment() },
        operations: { 'run-1/op-1': operation('op-1', 'digest-abc', { dispatch: { kind: 'settled', outcome: 'observed-success' } }) },
      }),
    })
    try {
      await store.controlRun('run-1', 'resume')
      await store.controlRun('run-2', 'resume')
      const begun = await store.beginOperation('run-2', 'op-1', '下单', 'digest-abc', 'admin')
      expect(begun.dispatch.kind).toBe('dispatching')
    } finally {
      await dispose()
      cleanupHomes()
    }
  })
})
