import { createHash } from 'node:crypto'
import { readFile, writeFile, symlink } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { assertPrototypeAuthority, checkPrototypeFormat3, issuePrototypeAuthority, issueRecoveryAuthority, PrototypeActivityStore, RecoveryCoordinator, resolveControlWritePolicy } from '../src/recovery.ts'
import type { AtomicRenamePolicy } from '@deepseek-ai/dsh-atomic-write'
import type { PrototypeAuthority, RecoveryAuthority } from '../src/recovery.ts'
import { containedOrdinaryDirectory, readPersistentActivity, validatePrototypeActivity } from '../src/persistent-activity.ts'
import { prototypeActivitySchema } from '../src/recovery-spec.ts'
import type { PrototypeOperationId, PrototypeRunId } from '../src/recovery-spec.ts'
import { cleanup, newControlRoot, startRuntime } from './harness.ts'
import type { StartOptions } from './harness.ts'
import { guardedPlugin } from '@deepseek-ai/dsh-cordis-host-runner/src/guard.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    readdir: vi.fn(actual.readdir),
    readFile: vi.fn(actual.readFile),
    cp: vi.fn(actual.cp),
    mkdir: vi.fn(actual.mkdir),
  }
})

const oldHash = '1'.repeat(64)
const newHash = '2'.repeat(64)
const businessIntent = { kind: 'create-request', target: 'public-request-1', parametersHash: '3'.repeat(64) }
const runId = brandString<PrototypeRunId>('old-run')
const operationId = brandString<PrototypeOperationId>('original-operation')
const recoveryDisposers: Array<() => Promise<void>> = []

async function startFixture(options: StartOptions = {}) {
  const runtime = await startRuntime(options)
  let authority: PrototypeAuthority | undefined
  const owner = await runtime.ctx.plugin(class PrototypeOwner extends Service {
    constructor(ctx: Context) {
      super(ctx, 'webTestPrototypeOwner')
      authority = issuePrototypeAuthority(this.ctx)
    }
  })
  if (!authority) throw new Error('prototype authority was not issued')
  return {
    ...runtime, authority,
    stop: async () => { await owner.dispose(); await runtime.stop() },
  }
}

async function recoveryOwner(): Promise<{ root: Context; ctx: Context; authority: RecoveryAuthority }> {
  const root = new Context()
  let owner: Context | undefined
  let authority: RecoveryAuthority | undefined
  const fiber = await root.plugin(class RecoveryOwner extends Service {
    constructor(ctx: Context) {
      super(ctx, 'webTestRecovery')
      owner = this.ctx
      authority = issueRecoveryAuthority(this.ctx)
    }
  })
  recoveryDisposers.push(async () => { await fiber.dispose() })
  if (!owner || !authority) throw new Error('recovery owner was not mounted')
  return { root, ctx: owner, authority }
}

async function openCoordinator(controlRoot: string, policy: AtomicRenamePolicy = resolveControlWritePolicy([])) {
  const owner = await recoveryOwner()
  const coordinator = await RecoveryCoordinator.open(controlRoot, owner.ctx, owner.authority, policy)
  return {
    freeze: () => coordinator.freeze(owner.authority),
    prepare: (hash: string, checker: Parameters<RecoveryCoordinator['prepare']>[1]) => coordinator.prepare(hash, checker, owner.authority),
    activate: (intent: Parameters<RecoveryCoordinator['activate']>[0]) => coordinator.activate(intent, owner.authority),
    close: () => coordinator.close(owner.authority),
    assertDispatchAllowed: () => coordinator.assertDispatchAllowed(),
  }
}

function initialCut() {
  return prototypeActivitySchema.parse({
    format: 3, compositionHash: oldHash, revision: 1, executor: 'active',
    runs: [
      { runId: 'paused-run', sessionId: 'cold-paused-session', headRevision: 1, status: 'PAUSED', pauseRequested: true, cancelRequested: false, operations: [], attachments: ['attachment.txt'], reports: ['report.txt'] },
      { runId, sessionId: 'cold-unknown-session', headRevision: 1, status: 'RUNNING', pauseRequested: false, cancelRequested: false, operations: [], attachments: [], reports: [] },
      { runId: 'new-run', sessionId: 'cold-new-session', headRevision: 1, status: 'RUNNING', pauseRequested: false, cancelRequested: false, operations: [], attachments: [], reports: [] },
    ],
  })
}

async function revokedFixture() {
  const runtime = await startFixture({ storageMode: 'generation-json' })
  await runtime.runtime.initializePrototypeActivity(initialCut(), runtime.authority)
  await writeFile(join(runtime.dataRoot, 'attachment.txt'), 'public attachment\n')
  await writeFile(join(runtime.dataRoot, 'report.txt'), 'public unchanged report\n')
  await runtime.runtime.admitPrototypeOperation(runId, operationId, businessIntent, runtime.authority)
  await runtime.runtime.markPrototypeOperationUnknown(operationId, runtime.authority)
  await runtime.runtime.revokePrototypeDispatch(runtime.authority)
  await runtime.stop()
  return runtime
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  await Promise.all(recoveryDisposers.splice(0).map(dispose => dispose()))
  await cleanup()
})

describe('cold read without side effects', () => {
  it('reports a missing root as incomplete and never creates it', async () => {
    const parent = await newControlRoot()
    const path = join(parent, 'absent')
    const result = await readPersistentActivity(path)
    expect(result.completenessErrors).toHaveLength(1)
    await expect(readFile(join(path, 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform !== 'win32')('refuses an unregistered domain rather than declaring zero activity', async () => {
    const runtime = await startFixture()
    try {
      const result = await runtime.runtime.readPersistentActivity()
      expect(result.completenessErrors).toHaveLength(1)
      expect(result.generation).toBe(1)
    }
    finally { await runtime.stop() }
  })

  it.skipIf(process.platform !== 'win32')('reads both cold batches and UNKNOWN with original bytes unchanged', async () => {
    const fixture = await revokedFixture()
    const before = await readFile(join(fixture.dataRoot, 'prototype-activity.json'))
    const result = await readPersistentActivity(fixture.controlRoot)
    expect(result.completenessErrors).toEqual([])
    expect(result.runHeads.map(run => run.status)).toEqual(['PAUSED', 'UNKNOWN', 'RUNNING'])
    expect(result.unsettledOperationIds).toEqual([operationId])
    expect(result.headRevision).toBe(4)
    expect(await readFile(join(fixture.dataRoot, 'prototype-activity.json'))).toEqual(before)
  })

  it.skipIf(process.platform !== 'win32')('rejects unknown formats and escaping pointers as incomplete', async () => {
    const fixture = await revokedFixture()
    await writeFile(join(fixture.dataRoot, 'prototype-activity.json'), '{"format":99}\n')
    expect((await readPersistentActivity(fixture.controlRoot)).completenessErrors).toHaveLength(1)
    await writeFile(join(fixture.controlRoot, 'current.json'), '{"generation":1,"directory":"../outside"}\n')
    expect((await readPersistentActivity(fixture.controlRoot)).completenessErrors).toHaveLength(1)
  })

  it.each(['run', 'operation', 'intent', 'terminal'] as const)('rejects inconsistent %s identities before writing', (kind) => {
    const cut = initialCut()
    const first = cut.runs[0]
    const second = cut.runs[1]
    if (!first || !second) throw new Error('fixture run absent')
    if (kind === 'run') second.runId = first.runId
    else {
      first.operations.push({ operationId, businessIntent, status: 'UNKNOWN' })
      second.operations.push({
        operationId: kind === 'operation' ? operationId : brandString<PrototypeOperationId>('other-id'),
        businessIntent: kind === 'intent' ? businessIntent : { ...businessIntent, target: 'other-target' },
        status: 'ISSUED',
      })
      if (kind === 'terminal') first.status = 'COMPLETED'
    }
    expect(() => validatePrototypeActivity(cut)).toThrow()
  })
})

describe.skipIf(process.platform !== 'win32')('supported Runtime prototype and exclusive recovery ownership', () => {
  it('admits once and a new run/token cannot reissue the same UNKNOWN intent', async () => {
    const fixture = await startFixture()
    let externalCounter = 0
    try {
      await fixture.runtime.initializePrototypeActivity(initialCut(), fixture.authority)
      await fixture.runtime.admitPrototypeOperation(runId, operationId, businessIntent, fixture.authority)
      externalCounter += 1
      await fixture.runtime.markPrototypeOperationUnknown(operationId, fixture.authority)
      await expect(fixture.runtime.admitPrototypeOperation(brandString<PrototypeRunId>('new-run'), brandString<PrototypeOperationId>('new-command-operation'), businessIntent, fixture.authority)).rejects.toThrow('already has an operation')
      await expect(fixture.runtime.admitPrototypeOperation(brandString<PrototypeRunId>('paused-run'), brandString<PrototypeOperationId>('paused-operation'), { ...businessIntent, target: 'other-target' }, fixture.authority)).rejects.toThrow('not dispatchable')
      expect(externalCounter).toBe(1)
      await fixture.runtime.revokePrototypeDispatch(fixture.authority)
      await expect(fixture.runtime.admitPrototypeOperation(runId, operationId, businessIntent, fixture.authority)).rejects.toThrow('stopped')
    }
    finally { await fixture.stop() }
  })

  it('refuses a live ordinary writer and later refuses a non-revoked cold cut', async () => {
    const fixture = await startFixture()
    await fixture.runtime.initializePrototypeActivity(initialCut(), fixture.authority)
    await expect(openCoordinator(fixture.controlRoot)).rejects.toMatchObject({ code: 'web-test/control-root-locked' })
    await fixture.stop()
    const coordinator = await openCoordinator(fixture.controlRoot)
    try { await expect(coordinator.freeze()).rejects.toThrow('revoked') }
    finally { await coordinator.close() }
  })

  it('preserves predecessor, reports, pause and UNKNOWN while selecting read-only format 4', async () => {
    const fixture = await revokedFixture()
    const original = await readFile(join(fixture.dataRoot, 'prototype-activity.json'))
    const coordinator = await openCoordinator(fixture.controlRoot)
    try {
      const frozen = await coordinator.freeze()
      expect(frozen.cut.runs[0]?.pauseRequested).toBe(true)
      const intent = await coordinator.prepare(newHash, checkPrototypeFormat3)
      expect(await readFile(join(fixture.controlRoot, 'current.json'), 'utf8')).toContain('data/1')
      await coordinator.activate(intent)
      const snapshot = await readPersistentActivity(fixture.controlRoot)
      expect(snapshot.generation).toBe(2)
      expect(snapshot.runHeads).toEqual(frozen.cut.runs)
      expect(snapshot.unsettledOperationIds).toEqual([operationId])
      expect(await readFile(join(fixture.dataRoot, 'prototype-activity.json'))).toEqual(original)
      expect(await readFile(join(fixture.controlRoot, intent.candidateDirectory, 'report.txt'), 'utf8')).toBe('public unchanged report\n')
      expect(() => coordinator.assertDispatchAllowed()).toThrow('recovery-only')
    }
    finally { await coordinator.close() }
    const reopened = await startFixture({ controlRoot: fixture.controlRoot, storageMode: 'generation-json' })
    try {
      await expect(reopened.runtime.admitPrototypeOperation(brandString<PrototypeRunId>('new-run'), brandString<PrototypeOperationId>('new-id'), businessIntent, reopened.authority)).rejects.toThrow('recovery-only')
      const before = await readFile(join(reopened.dataRoot, 'prototype-activity.json'))
      await expect(reopened.runtime.registerPrototypeRun({
        runId: brandString<PrototypeRunId>('new-recovery-run'), sessionId: SessionId('new-recovery-session'),
        headRevision: 1, status: 'RUNNING', pauseRequested: false, cancelRequested: false,
        operations: [], attachments: [], reports: [],
      }, newHash, reopened.authority)).rejects.toThrow('recovery-only')
      expect(await readFile(join(reopened.dataRoot, 'prototype-activity.json'))).toEqual(before)
    }
    finally { await reopened.stop() }
  })

  it.each(['absent', 'throw', 'write', 'different'] as const)('checker %s never changes the original pointer', async (mode) => {
    const fixture = await revokedFixture()
    const pointer = await readFile(join(fixture.controlRoot, 'current.json'))
    const coordinator = await openCoordinator(fixture.controlRoot)
    try {
      await coordinator.freeze()
      const checker = mode === 'absent' ? undefined : async (backup: string) => {
        if (mode === 'throw') throw new Error('checker unavailable')
        const cut = await checkPrototypeFormat3(backup)
        if (mode === 'write') await writeFile(join(backup, 'report.txt'), 'corrupted')
        if (mode === 'different') cut.revision += 1
        return cut
      }
      await expect(coordinator.prepare(newHash, checker)).rejects.toThrow()
      expect(await readFile(join(fixture.controlRoot, 'current.json'))).toEqual(pointer)
    }
    finally { await coordinator.close() }
  })

  it.each(['backup', 'candidate', 'intent', 'manifest', 'source'] as const)('changed %s refuses pointer publication', async (target) => {
    const fixture = await revokedFixture()
    const pointer = await readFile(join(fixture.controlRoot, 'current.json'))
    const coordinator = await openCoordinator(fixture.controlRoot)
    try {
      await coordinator.freeze()
      const intent = await coordinator.prepare(newHash, checkPrototypeFormat3)
      const recoveryRoot = join(fixture.controlRoot, intent.backupDirectory, '..')
      const path = target === 'backup' ? join(fixture.controlRoot, intent.backupDirectory, 'report.txt')
        : target === 'candidate' ? join(fixture.controlRoot, intent.candidateDirectory, 'report.txt')
          : target === 'source' ? join(fixture.dataRoot, 'report.txt')
            : join(recoveryRoot, target === 'intent' ? 'intent.json' : 'frozen.json')
      await writeFile(path, JSON.stringify({ changed: true }))
      await expect(coordinator.activate(intent)).rejects.toThrow()
      expect(await readFile(join(fixture.controlRoot, 'current.json'))).toEqual(pointer)
    }
    finally { await coordinator.close() }
  })

  it('interrupted preparation leaves the pointer and predecessor intact', async () => {
    const fixture = await revokedFixture()
    const pointer = await readFile(join(fixture.controlRoot, 'current.json'))
    const coordinator = await openCoordinator(fixture.controlRoot)
    await coordinator.freeze()
    const abandonedIntent = await coordinator.prepare(newHash, checkPrototypeFormat3)
    await coordinator.close()
    expect(await readFile(join(fixture.controlRoot, 'current.json'))).toEqual(pointer)
    const successor = await openCoordinator(fixture.controlRoot)
    try {
      await expect(successor.activate(abandonedIntent)).rejects.toThrow('identity mismatch')
      const manifest = await successor.freeze()
      expect(manifest.activityHash).toBe(createHash('sha256').update(await readFile(join(fixture.dataRoot, 'prototype-activity.json'))).digest('hex'))
    }
    finally { await successor.close() }
  })

  it('refuses a missing backup before publishing the candidate pointer', async () => {
    const fixture = await revokedFixture()
    const pointer = await readFile(join(fixture.controlRoot, 'current.json'))
    const cut = await readFile(join(fixture.dataRoot, 'prototype-activity.json'))
    const coordinator = await openCoordinator(fixture.controlRoot)
    try {
      await coordinator.freeze()
      const intent = await coordinator.prepare(newHash, checkPrototypeFormat3)
      const backup = join(fixture.controlRoot, intent.backupDirectory)
      const retained = backup + '-retained'
      for (const path of [backup, retained]) {
        const inside = relative(fixture.controlRoot, path)
        expect(isAbsolute(inside) || inside.startsWith('..') || inside === '').toBe(false)
      }
      await fs.rename(backup, retained)
      await expect(coordinator.activate(intent)).rejects.toThrow()
      expect(await readFile(join(fixture.controlRoot, 'current.json'))).toEqual(pointer)
      expect(await readFile(join(fixture.dataRoot, 'prototype-activity.json'))).toEqual(cut)
      expect(await readFile(join(retained, 'prototype-activity.json'))).toEqual(cut)
    }
    finally { await coordinator.close() }
  })

  it('keeps the original generation when Windows refuses pointer replacement', async () => {
    const fixture = await revokedFixture()
    const pointerPath = join(fixture.controlRoot, 'current.json')
    const pointer = await readFile(pointerPath)
    const cut = await readFile(join(fixture.dataRoot, 'prototype-activity.json'))
    const coordinator = await openCoordinator(fixture.controlRoot)
    const { openExclusive, closeExclusive } = await import('./exclusive-handle.ts')
    try {
      await coordinator.freeze()
      const intent = await coordinator.prepare(newHash, checkPrototypeFormat3)
      const held = openExclusive(pointerPath)
      try {
        await expect(coordinator.activate(intent)).rejects.toThrow()
        expect(await readFile(pointerPath)).toEqual(pointer)
        expect((await readPersistentActivity(fixture.controlRoot)).generation).toBe(1)
        expect(await readFile(join(fixture.dataRoot, 'prototype-activity.json'))).toEqual(cut)
      }
      finally { closeExclusive(held) }
      await coordinator.activate(intent)
      expect((await readPersistentActivity(fixture.controlRoot)).generation).toBe(2)
    }
    finally { await coordinator.close() }
  })

  it('publishes the identical prepared pointer temp after a native delete-denying handle is released', async () => {
    const fixture = await revokedFixture()
    const pointerPath = join(fixture.controlRoot, 'current.json')
    const before = await readFile(pointerPath)
    const waiting = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    const base = resolveControlWritePolicy([20, 40, 80, 160])
    let activating = false
    let completeTemp: Buffer | undefined
    const policy: AtomicRenamePolicy = { windowsRenameDelaysMs: base.windowsRenameDelaysMs, wait: async (delay) => {
      if (activating) {
        const names = (await fs.readdir(fixture.controlRoot)).filter(name => name.startsWith('current.json.') && name.endsWith('.tmp'))
        expect(names).toHaveLength(1)
        const name = names[0]
        if (!name) throw new Error('current pointer publication temp missing')
        const bytes = await readFile(join(fixture.controlRoot, name))
        if (completeTemp) expect(bytes).toEqual(completeTemp)
        completeTemp = bytes
        waiting.resolve(undefined)
        await proceed.promise
      }
      await base.wait(delay)
    } }
    const coordinator = await openCoordinator(fixture.controlRoot, policy)
    const { openExclusive, closeExclusive } = await import('./exclusive-handle.ts')
    let held: number | undefined
    try {
      await coordinator.freeze()
      const intent = await coordinator.prepare(newHash, checkPrototypeFormat3)
      held = openExclusive(pointerPath)
      activating = true
      const publication = coordinator.activate(intent)
      try {
        await waiting.promise
        expect(await readFile(pointerPath)).toEqual(before)
        expect(() => coordinator.assertDispatchAllowed()).toThrow('recovery-only refuses business dispatch')
        closeExclusive(held)
        held = undefined
        proceed.resolve(undefined)
        await publication
        expect(await readFile(pointerPath)).toEqual(completeTemp)
        expect((await readPersistentActivity(fixture.controlRoot)).unsettledOperationIds).toEqual([operationId])
        expect((await readPersistentActivity(fixture.controlRoot)).generation).toBe(2)
      } finally {
        if (held !== undefined) closeExclusive(held)
        held = undefined
        proceed.resolve(undefined)
        await publication
      }
    } finally { await coordinator.close() }
  })

  it('never inventories a generation directory symlink', async () => {
    const fixture = await revokedFixture()
    const outside = await newControlRoot()
    await symlink(outside, join(fixture.dataRoot, 'outside-link'), 'junction')
    const coordinator = await openCoordinator(fixture.controlRoot)
    try {
      await expect(coordinator.freeze()).rejects.toThrow('symlink or junction')
    }
    finally { await coordinator.close() }
  })

  it('refuses missing material instead of publishing a partial manifest', async () => {
    const fixture = await startFixture()
    await fixture.runtime.initializePrototypeActivity(initialCut(), fixture.authority)
    await fixture.runtime.revokePrototypeDispatch(fixture.authority)
    await fixture.stop()
    const coordinator = await openCoordinator(fixture.controlRoot)
    try { await expect(coordinator.freeze()).rejects.toThrow('material reference') }
    finally { await coordinator.close() }
  })

  it('rejects repeated registration, missing operation and completed-operation uncertainty', async () => {
    const fixture = await startFixture()
    const cut = initialCut()
    const run = cut.runs[1]
    if (!run) throw new Error('fixture run absent')
    run.operations.push({ operationId, businessIntent, status: 'COMPLETED' })
    try {
      await fixture.runtime.initializePrototypeActivity(cut, fixture.authority)
      await expect(fixture.runtime.initializePrototypeActivity(cut, fixture.authority)).rejects.toThrow('already registered')
      await expect(fixture.runtime.markPrototypeOperationUnknown(
        brandString<PrototypeOperationId>('absent'), fixture.authority,
      )).rejects.toThrow('absent')
      await expect(fixture.runtime.markPrototypeOperationUnknown(operationId, fixture.authority)).rejects.toThrow('absent')
      await Promise.all([
        fixture.runtime.revokePrototypeDispatch(fixture.authority),
        fixture.runtime.revokePrototypeDispatch(fixture.authority),
      ])
      await fixture.runtime.revokePrototypeDispatch(fixture.authority)
      expect((await fixture.runtime.readPersistentActivity()).headRevision).toBe(2)
    }
    finally { await fixture.stop() }
  })

  it('refuses format-2 initialization and uncertainty recording by a restarted executor', async () => {
    const fixture = await revokedFixture()
    const coordinator = await openCoordinator(fixture.controlRoot)
    await coordinator.freeze()
    const intent = await coordinator.prepare(newHash, checkPrototypeFormat3)
    await coordinator.activate(intent)
    await coordinator.close()
    const reopened = await startFixture({ controlRoot: fixture.controlRoot })
    try {
      const candidate = await fs.readFile(join(fixture.controlRoot, intent.candidateDirectory, 'prototype-activity.json'), 'utf8')
      await expect(reopened.runtime.initializePrototypeActivity(prototypeActivitySchema.parse(JSON.parse(candidate)), reopened.authority)).rejects.toThrow('format 3')
      await expect(reopened.runtime.markPrototypeOperationUnknown(operationId, reopened.authority)).rejects.toThrow('not active')
      await reopened.runtime.revokePrototypeDispatch(reopened.authority)
    }
    finally { await reopened.stop() }
  })

  it('reuses a frozen cut, closes idempotently and refuses use after close', async () => {
    const fixture = await revokedFixture()
    const coordinator = await openCoordinator(fixture.controlRoot)
    const first = await coordinator.freeze()
    expect(await coordinator.freeze()).toEqual(first)
    await Promise.all([coordinator.close(), coordinator.close()])
    await coordinator.close()
    await expect(coordinator.freeze()).rejects.toThrow('closed')
  })

  it('refuses preparation before freeze, invalid package identity and duplicate preparation', async () => {
    const fixture = await revokedFixture()
    const coordinator = await openCoordinator(fixture.controlRoot)
    try {
      await expect(coordinator.prepare(newHash, checkPrototypeFormat3)).rejects.toThrow('freeze')
      await coordinator.freeze()
      await expect(coordinator.prepare('invalid', checkPrototypeFormat3)).rejects.toThrow('digest')
      await coordinator.prepare(newHash, checkPrototypeFormat3)
      await expect(coordinator.prepare(newHash, checkPrototypeFormat3)).rejects.toThrow('already prepared')
    }
    finally { await coordinator.close() }
  })

  it('rejects source changes between freeze and preparation', async () => {
    const fixture = await revokedFixture()
    const coordinator = await openCoordinator(fixture.controlRoot)
    try {
      await coordinator.freeze()
      await writeFile(join(fixture.dataRoot, 'report.txt'), 'changed after freeze')
      await expect(coordinator.prepare(newHash, checkPrototypeFormat3)).rejects.toThrow('source changed')
    }
    finally { await coordinator.close() }
  })

  it('rejects an externally repointed generation before activation', async () => {
    const fixture = await revokedFixture()
    const coordinator = await openCoordinator(fixture.controlRoot)
    try {
      await coordinator.freeze()
      const intent = await coordinator.prepare(newHash, checkPrototypeFormat3)
      await writeFile(join(fixture.controlRoot, 'current.json'), JSON.stringify({ generation: 2, directory: intent.candidateDirectory }))
      await expect(coordinator.activate(intent)).rejects.toThrow('original generation changed')
    }
    finally { await coordinator.close() }
  })

  it('rejects pointer, directory and activity symlinks without reading external files', async () => {
    const fixture = await revokedFixture()
    const outside = await newControlRoot()
    await writeFile(join(outside, 'pointer.json'), '{}')
    await fs.unlink(join(fixture.controlRoot, 'current.json'))
    await symlink(join(outside, 'pointer.json'), join(fixture.controlRoot, 'current.json'), 'file')
    expect((await readPersistentActivity(fixture.controlRoot)).completenessErrors[0]).toContain('pointer is not')
    await symlink(outside, join(fixture.controlRoot, 'external'), 'junction')
    await expect(containedOrdinaryDirectory(fixture.canonicalRoot, 'external')).rejects.toThrow('ordinary directory')
    await fs.unlink(join(fixture.dataRoot, 'prototype-activity.json'))
    await symlink(join(outside, 'pointer.json'), join(fixture.dataRoot, 'prototype-activity.json'), 'file')
    await expect(checkPrototypeFormat3(fixture.dataRoot)).rejects.toThrow('ordinary file')
  })

  it('does not follow a preexisting recovery directory junction', async () => {
    const fixture = await revokedFixture()
    const outside = await newControlRoot()
    await symlink(outside, join(fixture.controlRoot, 'recovery'), 'junction')
    const coordinator = await openCoordinator(fixture.controlRoot)
    try { await expect(coordinator.freeze()).rejects.toThrow('ordinary directory') }
    finally { await coordinator.close() }
  })

  it('preserves old bytes after an actual Windows rename sharing failure', async () => {
    const fixture = await startFixture()
    const { openExclusive, closeExclusive } = await import('./exclusive-handle.ts')
    try {
      await fixture.runtime.initializePrototypeActivity(initialCut(), fixture.authority)
      const path = join(fixture.dataRoot, 'prototype-activity.json')
      const before = await readFile(path)
      const held = openExclusive(path)
      try {
        await expect(fixture.runtime.admitPrototypeOperation(runId, operationId, businessIntent, fixture.authority)).rejects.toThrow()
        expect(await readFile(path)).toEqual(before)
      }
      finally { closeExclusive(held) }
      const admission = await fixture.runtime.admitPrototypeOperation(runId, operationId, businessIntent, fixture.authority)
      expect(admission.status).toBe('ISSUED')
    }
    finally { await fixture.stop() }
  })

  it('propagates inaccessible initial registration instead of treating it as absent', async () => {
    const fixture = await startFixture()
    vi.mocked(fs.lstat).mockRejectedValueOnce(Object.assign(new Error('access denied'), { code: 'EACCES' }))
    try { await expect(fixture.runtime.initializePrototypeActivity(initialCut(), fixture.authority)).rejects.toThrow('access denied') }
    finally { await fixture.stop() }
  })

  it('inventories nested ordinary material and refuses a changed backup root', async () => {
    const fixture = await revokedFixture()
    await fs.mkdir(join(fixture.dataRoot, 'nested'))
    await writeFile(join(fixture.dataRoot, 'nested', 'report.txt'), 'nested report')
    const coordinator = await openCoordinator(fixture.controlRoot)
    try {
      const manifest = await coordinator.freeze()
      expect(manifest.files.map(file => file.path)).toContain('nested/report.txt')
      const intent = await coordinator.prepare(newHash, checkPrototypeFormat3)
      const backup = join(fixture.controlRoot, intent.backupDirectory)
      await fs.rename(backup, `${backup}-original`)
      await symlink(`${backup}-original`, backup, 'junction')
      await expect(coordinator.activate(intent)).rejects.toThrow('inventory directory')
    }
    finally { await coordinator.close() }
  })

  it('releases ownership if the pointer becomes unreadable during acquisition', async () => {
    const fixture = await revokedFixture()
    const original = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).readFile
    let pointerReads = 0
    vi.mocked(fs.readFile).mockImplementation(async (path, options) => {
      if (typeof path === 'string' && path.endsWith('current.json') && ++pointerReads === 2) throw new Error('pointer interrupted')
      return original(path, options)
    })
    await expect(openCoordinator(fixture.controlRoot)).rejects.toThrow('pointer interrupted')
    vi.mocked(fs.readFile).mockReset()
    const successor = await openCoordinator(fixture.controlRoot)
    await successor.close()
  })

  it('refuses a disappeared committed cut during inventory', async () => {
    const fixture = await startFixture()
    const cut = initialCut()
    for (const run of cut.runs) { run.attachments = []; run.reports = [] }
    await fixture.runtime.initializePrototypeActivity(cut, fixture.authority)
    await fixture.runtime.revokePrototypeDispatch(fixture.authority)
    await fixture.stop()
    const coordinator = await openCoordinator(fixture.controlRoot)
    try {
      vi.mocked(fs.readdir).mockResolvedValueOnce([])
      await expect(coordinator.freeze()).rejects.toThrow('absent from inventory')
    }
    finally { await coordinator.close() }
  })

  it('refuses a non-file generation entry', async () => {
    const fixture = await revokedFixture()
    const entry = join(fixture.dataRoot, 'special-entry')
    await writeFile(entry, 'placeholder')
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const special = await actual.lstat(entry)
    Object.defineProperty(special, 'isFile', { value: () => false })
    vi.mocked(fs.lstat).mockImplementation(async (path, options) =>
      String(path).toLowerCase() === entry.toLowerCase() ? special : actual.lstat(path, options))
    const coordinator = await openCoordinator(fixture.controlRoot)
    try { await expect(coordinator.freeze()).rejects.toThrow('non-file entry') }
    finally { await coordinator.close() }
  })

  it('propagates inability to create the recovery journal directory', async () => {
    const fixture = await revokedFixture()
    const coordinator = await openCoordinator(fixture.controlRoot)
    try {
      vi.mocked(fs.mkdir).mockRejectedValueOnce(Object.assign(new Error('journal access denied'), { code: 'EACCES' }))
      await expect(coordinator.freeze()).rejects.toThrow('journal access denied')
    }
    finally { await coordinator.close() }
  })

  it('rejects a corrupted copy before invoking the old-format checker', async () => {
    const fixture = await revokedFixture()
    const coordinator = await openCoordinator(fixture.controlRoot)
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    try {
      await coordinator.freeze()
      vi.mocked(fs.cp).mockImplementationOnce(async (source, destination, options) => {
        await actual.cp(source, destination, options)
        await writeFile(join(String(destination), 'report.txt'), 'corrupted copy')
      })
      const checker = vi.fn(checkPrototypeFormat3)
      await expect(coordinator.prepare(newHash, checker)).rejects.toThrow('backup is inconsistent')
      expect(checker).not.toHaveBeenCalled()
    }
    finally { await coordinator.close() }
  })

  it('rejects a candidate modified after the last inventory read', async () => {
    const fixture = await revokedFixture()
    const coordinator = await openCoordinator(fixture.controlRoot)
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    try {
      await coordinator.freeze()
      const intent = await coordinator.prepare(newHash, checkPrototypeFormat3)
      const candidateFile = join(fixture.controlRoot, intent.candidateDirectory, 'prototype-activity.json')
      let candidateReads = 0
      vi.mocked(fs.readFile).mockImplementation(async (path, options) => {
        const bytes = await actual.readFile(path, options)
        if (typeof path === 'string' && path.toLowerCase() === candidateFile.toLowerCase() && ++candidateReads === 2) {
          const cut = prototypeActivitySchema.parse(JSON.parse(String(bytes)))
          cut.compositionHash = '4'.repeat(64)
          return JSON.stringify(cut)
        }
        return bytes
      })
      await expect(coordinator.activate(intent)).rejects.toThrow('candidate state mismatch')
    }
    finally { await coordinator.close() }
  })

  it('refuses recovery authority from an unrelated Context before filesystem reads', async () => {
    const root = await newControlRoot()
    await expect(RecoveryCoordinator.open(root, new Context(), Object.freeze({}) as RecoveryAuthority, resolveControlWritePolicy([]))).rejects.toThrow('private owner authority')
  })

  it('rejects model initiated Runtime mutations and captured recovery coordinator calls', async () => {
    const fixture = await startFixture()
    const agentFiber = await fixture.ctx.plugin(AgentRegistry)
    const initiator = { id: SessionId('prototype-model') } as Agent
    try {
      expect(() => fixture.ctx.agents.withInitiator(initiator, () => fixture.runtime.initializePrototypeActivity(initialCut(), fixture.authority))).toThrow('trusted Host Service owner')
      await fixture.runtime.initializePrototypeActivity(initialCut(), fixture.authority)
      await writeFile(join(fixture.dataRoot, 'attachment.txt'), 'public attachment')
      await writeFile(join(fixture.dataRoot, 'report.txt'), 'public report')
      for (const mutate of [
        () => fixture.runtime.admitPrototypeOperation(runId, operationId, businessIntent, fixture.authority),
        () => fixture.runtime.markPrototypeOperationUnknown(operationId, fixture.authority),
        () => fixture.runtime.markPrototypeOperationCompleted(operationId, fixture.authority),
        () => fixture.runtime.pausePrototypeRun(runId, fixture.authority),
        () => fixture.runtime.revokePrototypeDispatch(fixture.authority),
      ]) {
        expect(() => fixture.ctx.agents.withInitiator<Promise<unknown>>(initiator, mutate)).toThrow('trusted Host Service owner')
      }
      expect(() => {
        fixture.ctx.agents.withInitiator(initiator, () => {
          fixture.runtime.assertPrototypeRunDispatchable(runId, fixture.authority)
        })
      }).toThrow('trusted Host Service owner')
      const original: unknown = Reflect.get(fixture.runtime, Symbol.for('cordis.original'))
      if (typeof original !== 'object' || original === null) throw new Error('Runtime original is absent')
      const context: unknown = Reflect.get(original, 'ctx')
      if (!Context.is(context)) throw new Error('Runtime owner context is absent')
      const store = new PrototypeActivityStore(context, fixture.dataRoot, resolveControlWritePolicy([]))
      await expect(fixture.ctx.agents.withInitiator(initiator, () => store.close())).rejects.toThrow('trusted Host owner')
      await store.close()
      await fixture.runtime.revokePrototypeDispatch(fixture.authority)
    }
    finally { await agentFiber.dispose(); await fixture.stop() }
    const owner = await recoveryOwner()
    const registryFiber = await owner.root.plugin(AgentRegistry)
    try {
      await expect(owner.root.agents.withInitiator(initiator, () => RecoveryCoordinator.open(fixture.controlRoot, owner.ctx, owner.authority, resolveControlWritePolicy([])))).rejects.toThrow('trusted Host Service owner')
      const coordinator = await RecoveryCoordinator.open(fixture.controlRoot, owner.ctx, owner.authority, resolveControlWritePolicy([]))
      try {
        expect(() => owner.root.agents.withInitiator(initiator, () => coordinator.freeze(owner.authority))).toThrow('trusted Host Service owner')
        await coordinator.freeze(owner.authority)
        expect(() => owner.root.agents.withInitiator(initiator, () => coordinator.prepare(newHash, checkPrototypeFormat3, owner.authority))).toThrow('trusted Host Service owner')
        const intent = await coordinator.prepare(newHash, checkPrototypeFormat3, owner.authority)
        expect(() => owner.root.agents.withInitiator(initiator, () => coordinator.activate(intent, owner.authority))).toThrow('trusted Host Service owner')
        await expect(owner.root.agents.withInitiator(initiator, () => coordinator.close(owner.authority))).rejects.toThrow('trusted Host owner')
      }
      finally { await coordinator.close(owner.authority) }
    }
    finally { await registryFiber.dispose() }
  })

  it('rejects fabricated authority through the actual dynamic Host facade after attribution is cleared', async () => {
    const fixture = await startFixture()
    await fixture.runtime.initializePrototypeActivity(initialCut(), fixture.authority)
    const agentFiber = await fixture.ctx.plugin(AgentRegistry)
    const errors: Error[] = []
    let refusals = 0
    const checks: Promise<void>[] = []
    try {
      const model = await fixture.ctx.plugin(guardedPlugin({
        name: 'model-prototype-authority-forgery',
        inject: ['agents', 'webTestRuntime'],
        apply(modelContext: Context) {
          const fake = Object.freeze({}) as PrototypeAuthority
          const mutations = [
            () => modelContext.webTestRuntime.initializePrototypeActivity(initialCut(), fake),
            () => modelContext.webTestRuntime.admitPrototypeOperation(runId, operationId, businessIntent, fake),
            () => modelContext.webTestRuntime.markPrototypeOperationUnknown(operationId, fake),
            () => modelContext.webTestRuntime.markPrototypeOperationCompleted(operationId, fake),
            () => modelContext.webTestRuntime.pausePrototypeRun(runId, fake),
            () => modelContext.webTestRuntime.revokePrototypeDispatch(fake),
          ]
          for (const mutate of mutations) {
            const check = expect(fixture.ctx.agents.withoutInitiator(async () => { await mutate() })).rejects.toThrow('private producer authority')
            checks.push(Promise.resolve(check).then(() => { refusals += 1 }))
          }
          expect(() => {
            fixture.ctx.agents.withoutInitiator(() => {
              modelContext.webTestRuntime.assertPrototypeRunDispatchable(runId, fake)
            })
          }).toThrow('private producer authority')
          refusals += 1
          expect(() => issuePrototypeAuthority(modelContext)).toThrow('sandbox ctx')
          expect(() => issueRecoveryAuthority(modelContext)).toThrow('sandbox ctx')
          expect(Reflect.get(modelContext.webTestRuntime, 'prototypeActivity')).toBeUndefined()
        },
      }, (error) => { errors.push(error) }))
      await Promise.all(checks)
      expect(refusals).toBe(7)
      expect(errors).toHaveLength(2)
      await model.dispose()
      expect((await fixture.runtime.readPersistentActivity()).headRevision).toBe(1)
    }
    finally { await agentFiber.dispose(); await fixture.stop() }
  })

  it('refuses forged recovery authority even with a genuine coordinator and cleared initiator', async () => {
    const fixture = await revokedFixture()
    const owner = await recoveryOwner()
    const registry = await owner.root.plugin(AgentRegistry)
    const coordinator = await RecoveryCoordinator.open(fixture.controlRoot, owner.ctx, owner.authority, resolveControlWritePolicy([]))
    const fake = Object.freeze({}) as RecoveryAuthority
    try {
      expect(() => owner.root.agents.withoutInitiator(() => coordinator.freeze(fake))).toThrow('private owner authority')
      await coordinator.freeze(owner.authority)
      expect(() => owner.root.agents.withoutInitiator(() => coordinator.prepare(newHash, checkPrototypeFormat3, fake))).toThrow('private owner authority')
      const intent = await coordinator.prepare(newHash, checkPrototypeFormat3, owner.authority)
      expect(() => owner.root.agents.withoutInitiator(() => coordinator.activate(intent, fake))).toThrow('private owner authority')
      await expect(owner.root.agents.withoutInitiator(() => coordinator.close(fake))).rejects.toThrow('private owner authority')
      await expect(openCoordinator(fixture.controlRoot)).rejects.toMatchObject({ code: 'web-test/control-root-locked' })
      expect(Reflect.get(coordinator, 'ctx')).toBeUndefined()
      expect(Reflect.get(coordinator, 'lock')).toBeUndefined()
      expect(Reflect.get(coordinator, 'intent')).toBeUndefined()
      expect((await readPersistentActivity(fixture.controlRoot)).generation).toBe(1)
    }
    finally { await coordinator.close(owner.authority); await registry.dispose() }
  })

  it('refuses issuing prototype authority without an owning provider or owning Service', async () => {
    expect(() => issuePrototypeAuthority(new Context())).toThrow('trusted Host Service owner')
    const root = new Context()
    const fiber = await root.plugin(class ProducerWithoutProvider extends Service {
      constructor(ctx: Context) {
        super(ctx, 'webTestPrototypeOwner')
        expect(() => issuePrototypeAuthority(this.ctx)).toThrow('requires its Runtime provider')
      }
    })
    await fiber.dispose()
  })

  it('rejects a producer authority after its bound Runtime provider disappears', async () => {
    const fixture = await startRuntime()
    let authority: PrototypeAuthority | undefined
    const owner = await fixture.ctx.plugin(class DurableProducer extends Service {
      constructor(ctx: Context) {
        super(ctx, 'webTestPrototypeOwner')
        authority = issuePrototypeAuthority(this.ctx)
      }
    })
    if (!authority) throw new Error('prototype authority was not issued')
    const issuedAuthority = authority
    const original: unknown = Reflect.get(fixture.runtime, Symbol.for('cordis.original'))
    if (typeof original !== 'object' || original === null) throw new Error('Runtime original is absent')
    await fixture.stop()
    try {
      expect(() => { assertPrototypeAuthority(original, issuedAuthority) }).toThrow('no longer current')
    }
    finally { await owner.dispose() }
  })
})
