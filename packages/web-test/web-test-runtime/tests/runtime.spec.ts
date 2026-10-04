/**
 * The Runtime's persistence authority: create, close, reopen, and read back the
 * same entity; idempotent creation; strict reads; and the outbox the commit
 * protocol publishes with each entry.
 *
 * Every assertion is made against the real `webtest.json` document the json
 * backend published, so "durable" means bytes on disk and "not written again"
 * means the file's digest did not move.
 *
 * The suite is Windows-only because the service under it is: every case boots a
 * Runtime, and a Runtime refuses to open any domain on a host that has no
 * control-root kernel object to hold. Faking that claim here would assert a
 * fiction the product deliberately refuses to tell, so the suite skips instead.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ProjectId } from '@deepseek-ai/dsh-web-test-contracts'
import { cleanup, registration, startRuntime, unitBytes } from './harness.ts'

afterEach(cleanup)

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const asProjectId = (value: string): ProjectId => brandString<ProjectId>(value)

describe.skipIf(process.platform !== 'win32')('create, close, and reopen', () => {
  it('reads back the same entity, and reopening writes nothing', async () => {
    const first = await startRuntime()
    const receipt = await first.runtime.registerProject(registration('cmd-create-1'))
    expect(receipt.outcome).toBe('accepted')
    const created = first.runtime.readProject(receipt.resourceId as ProjectId)
    expect(created).toEqual({
      projectId: receipt.resourceId,
      revision: 1,
      codeRoots: ['C:\\projects\\shop'],
      entryUrls: ['http://localhost:3000/checkout'],
    })

    const bytes = await unitBytes(first)
    expect(bytes).toBeDefined()
    const beforeReopen = sha256(bytes as Buffer)
    const lockName = first.runtime.identity().lockName
    await first.stop()

    const second = await startRuntime({ controlRoot: first.controlRoot, dataRoot: first.dataRoot })
    const reopened = second.runtime.readProject(receipt.resourceId as ProjectId)
    expect(reopened).toEqual(created)
    expect(second.runtime.listProjects()).toEqual([created])
    // The lock identity is the control root's, so a reopen claims the same
    // object a previous holder released rather than a fresh one.
    expect(second.runtime.identity().lockName).toBe(lockName)
    // Opening is a read: the document is byte-identical to what the first
    // writer left, so nothing was republished on the way in.
    expect(sha256((await unitBytes(second)) as Buffer)).toBe(beforeReopen)
    await second.stop()
  })

  it('reserves an identity derived from the command token, not a fresh one', async () => {
    const harness = await startRuntime()
    const receipt = await harness.runtime.registerProject(registration('cmd-stable-id'))
    expect(receipt.resourceId).toMatch(/^project-[0-9a-f]{32}$/u)
    const again = await harness.runtime.registerProject(registration('cmd-stable-id'))
    expect(again.resourceId).toBe(receipt.resourceId)
    await harness.stop()
  })
})

describe.skipIf(process.platform !== 'win32')('idempotent creation and redelivery', () => {
  it('returns the original receipt and writes nothing on a resend', async () => {
    const harness = await startRuntime()
    const first = await harness.runtime.registerProject(registration('cmd-redeliver'))
    const afterCreate = sha256((await unitBytes(harness)) as Buffer)

    const resent = await harness.runtime.registerProject(registration('cmd-redeliver'))
    expect(resent).toEqual(first)
    // Identical bytes are the strongest form of "no duplicated business
    // effect": the resend did not advance the head, re-put the record, or
    // append a second notification.
    expect(sha256((await unitBytes(harness)) as Buffer)).toBe(afterCreate)
    expect(harness.runtime.pendingNotifications()).toHaveLength(1)
    expect(harness.runtime.listProjects()).toHaveLength(1)
    await harness.stop()
  })

  it('refuses a command token reused with different parameters', async () => {
    const harness = await startRuntime()
    await harness.runtime.registerProject(registration('cmd-reused'))
    await expect(harness.runtime.registerProject(
      registration('cmd-reused', { codeRoots: ['C:\\projects\\other'] }),
    )).rejects.toMatchObject({ code: 'web-test/command-token-reuse' })
    expect(harness.runtime.listProjects()).toHaveLength(1)
    await harness.stop()
  })

  it('rejects a malformed request through the contract before any write', async () => {
    const harness = await startRuntime()
    await expect(harness.runtime.registerProject(registration('not-a-command-token'))).rejects.toMatchObject({
      code: 'web-test/invalid-field',
    })
    expect(await unitBytes(harness)).toBeUndefined()
    await harness.stop()
  })
})

describe.skipIf(process.platform !== 'win32')('strict reading', () => {
  it('does not publish a project that no entry names', async () => {
    const harness = await startRuntime()
    expect(harness.runtime.readProject(asProjectId(`project-${'0'.repeat(32)}`))).toBeUndefined()
    expect(harness.runtime.listProjects()).toEqual([])
    await harness.stop()
  })

  it('refuses a head that publishes an entry the records do not support', async () => {
    const harness = await startRuntime()
    const receipt = await harness.runtime.registerProject(registration('cmd-strict'))
    const bytes = (await unitBytes(harness)) as Buffer
    const stored = JSON.parse(bytes.toString('utf8')) as { global: { entries: Record<string, { metadataRevision: number }> } }
    stored.global.entries[receipt.resourceId] = { ...stored.global.entries[receipt.resourceId], metadataRevision: 99 }
    await writeFile(harness.unitPath, JSON.stringify(stored), 'utf8')
    await harness.stop()

    const reopened = await startRuntime({ controlRoot: harness.controlRoot, dataRoot: harness.dataRoot })
    expect(() => reopened.runtime.readProject(receipt.resourceId as ProjectId)).toThrow(
      /publishes project .* at revision 99/u,
    )
    await reopened.stop()
  })

  it('refuses to open a unit whose stored record does not match its schema', async () => {
    const harness = await startRuntime()
    await harness.runtime.registerProject(registration('cmd-corrupt'))
    const bytes = (await unitBytes(harness)) as Buffer
    const stored = JSON.parse(bytes.toString('utf8')) as { tables: { projects: Record<string, { codeRoots: number[] }> } }
    for (const record of Object.values(stored.tables.projects)) record.codeRoots = [42]
    await writeFile(harness.unitPath, JSON.stringify(stored), 'utf8')
    await harness.stop()

    await expect(startRuntime({ controlRoot: harness.controlRoot, dataRoot: harness.dataRoot }))
      .rejects.toMatchObject({ code: 'invalid-record' })
  })

  it('refuses to open a unit whose staged update is not the next revision', async () => {
    const harness = await startRuntime()
    await harness.runtime.registerProject(registration('cmd-staged'))
    const bytes = (await unitBytes(harness)) as Buffer
    const stored = JSON.parse(bytes.toString('utf8')) as {
      tables: { projects: Record<string, { pending: { revision: number; codeRoots: string[]; entryUrls: string[] } | null }> }
    }
    // A staged update whose revision is not the one past the record's own cannot
    // be published by any head write, so no read could be told apart from one
    // serving real content. The root rejects rather than reading it.
    for (const record of Object.values(stored.tables.projects)) {
      record.pending = { revision: 7, codeRoots: ['C:\\projects\\shop'], entryUrls: [] }
    }
    await writeFile(harness.unitPath, JSON.stringify(stored), 'utf8')
    await harness.stop()

    await expect(startRuntime({ controlRoot: harness.controlRoot, dataRoot: harness.dataRoot }))
      .rejects.toMatchObject({ code: 'invalid-record' })
  })
})

describe.skipIf(process.platform !== 'win32')('the outbox', () => {
  it('publishes one notification with the entry and drains it on acknowledgement', async () => {
    const harness = await startRuntime()
    const receipt = await harness.runtime.registerProject(registration('cmd-outbox'))
    const [notification] = harness.runtime.pendingNotifications()
    expect(notification).toMatchObject({
      sequence: 1,
      kind: 'project-published',
      projectId: receipt.resourceId,
      metadataRevision: 1,
    })
    const projectId = receipt.resourceId as ProjectId
    const headBefore = harness.runtime.identity().generation

    await harness.runtime.acknowledgeNotifications(notification?.sequence as number)
    expect(harness.runtime.pendingNotifications()).toEqual([])
    // The project stays published: acknowledgement drains the queue, it does not
    // unpublish the entity the notification described.
    expect(harness.runtime.readProject(projectId)?.projectId).toBe(projectId)
    expect(harness.runtime.identity().generation).toBe(headBefore)

    // Acknowledging again changes nothing, so a repeated drain costs no write.
    const drained = sha256((await unitBytes(harness)) as Buffer)
    await harness.runtime.acknowledgeNotifications(notification?.sequence as number)
    expect(sha256((await unitBytes(harness)) as Buffer)).toBe(drained)
    await harness.stop()
  })

  it('revalidates the expected version before committing a prepared change', async () => {
    const harness = await startRuntime()
    const receipt = await harness.runtime.registerProject(registration('cmd-update'))
    const projectId = receipt.resourceId as ProjectId
    const prepared = harness.runtime.prepareProjectUpdate(projectId)
    expect(prepared.expectedRevision).toBe(1)

    const stale = harness.runtime.prepareProjectUpdate(projectId)
    const commit = await harness.runtime.commitProjectUpdate(
      { commandId: 'cmd-update-1', recordId: prepared.recordId, expectedRevision: prepared.expectedRevision },
      prepared,
      { codeRoots: ['C:\\projects\\shop\\app'], entryUrls: ['http://localhost:3000/cart'] },
    )
    expect(commit).toEqual({ recordId: prepared.recordId, acceptedRevision: 2 })
    expect(harness.runtime.readProject(projectId)).toEqual({
      projectId,
      revision: 2,
      codeRoots: ['C:\\projects\\shop\\app'],
      entryUrls: ['http://localhost:3000/cart'],
    })
    expect(harness.runtime.pendingNotifications().map(entry => entry.sequence)).toEqual([1, 2])

    // The second read went stale while the first commit ran, so the queue
    // refuses it instead of overwriting a change the caller never saw.
    await expect(harness.runtime.commitProjectUpdate(
      { commandId: 'cmd-update-2', recordId: stale.recordId, expectedRevision: stale.expectedRevision },
      stale,
      { codeRoots: ['C:\\projects\\shop\\web'], entryUrls: [] },
    )).rejects.toMatchObject({ code: 'web-test/stale-revision' })
    expect(harness.runtime.readProject(projectId)?.codeRoots).toEqual(['C:\\projects\\shop\\app'])
    await harness.stop()
  })

  it('refuses a submission that addresses another project record', async () => {
    const harness = await startRuntime()
    const receipt = await harness.runtime.registerProject(registration('cmd-mismatch'))
    const prepared = harness.runtime.prepareProjectUpdate(receipt.resourceId as ProjectId)
    await expect(harness.runtime.commitProjectUpdate(
      { commandId: 'cmd-mismatch-1', recordId: `record-${'a'.repeat(32)}`, expectedRevision: 1 },
      prepared,
      { codeRoots: ['C:\\projects\\shop'], entryUrls: [] },
    )).rejects.toMatchObject({ code: 'web-test/record-mismatch' })
    await harness.stop()
  })

  it('refuses a submission whose expected revision is not the prepared cut', async () => {
    const harness = await startRuntime()
    const receipt = await harness.runtime.registerProject(registration('cmd-cut'))
    const projectId = receipt.resourceId as ProjectId
    const prepared = harness.runtime.prepareProjectUpdate(projectId)
    // The submission and the cut disagree about what the caller read, so there
    // is no single revision to revalidate and nothing is written.
    await expect(harness.runtime.commitProjectUpdate(
      { commandId: 'cmd-cut-1', recordId: prepared.recordId, expectedRevision: 7 },
      prepared,
      { codeRoots: ['C:\\projects\\shop\\web'], entryUrls: [] },
    )).rejects.toMatchObject({ code: 'web-test/stale-revision' })
    expect(harness.runtime.readProject(projectId)).toMatchObject({ revision: 1, codeRoots: ['C:\\projects\\shop'] })
    await harness.stop()
  })
})

describe.skipIf(process.platform !== 'win32')('replayed updates', () => {
  it('returns the receipt the first attempt earned, and writes nothing', async () => {
    const harness = await startRuntime()
    const receipt = await harness.runtime.registerProject(registration('cmd-replay'))
    const projectId = receipt.resourceId as ProjectId
    const prepared = harness.runtime.prepareProjectUpdate(projectId)
    const request = { commandId: 'cmd-replay-1', recordId: prepared.recordId, expectedRevision: prepared.expectedRevision }
    const metadata = { codeRoots: ['C:\\projects\\shop\\app'], entryUrls: ['http://localhost:3000/cart'] }
    const first = await harness.runtime.commitProjectUpdate(request, prepared, metadata)
    expect(first).toEqual({ recordId: prepared.recordId, acceptedRevision: 2 })
    const afterCommit = sha256((await unitBytes(harness)) as Buffer)

    // The resend answers from the head's ledger: the fold already landed, so
    // there is nothing left to write and no second entry or notification.
    const resent = await harness.runtime.commitProjectUpdate(request, prepared, metadata)
    expect(resent).toEqual(first)
    expect(sha256((await unitBytes(harness)) as Buffer)).toBe(afterCommit)
    expect(harness.runtime.pendingNotifications()).toHaveLength(2)
    expect(harness.runtime.listProjects()).toHaveLength(1)
    expect(harness.runtime.readProject(projectId)).toEqual({ projectId, revision: 2, ...metadata })
    await harness.stop()
  })

  it('refuses a token that already published another project or another content', async () => {
    const harness = await startRuntime()
    const firstProject = (await harness.runtime.registerProject(registration('cmd-replay-2'))).resourceId as ProjectId
    const secondProject = (await harness.runtime.registerProject(registration('cmd-replay-3'))).resourceId as ProjectId
    const prepared = harness.runtime.prepareProjectUpdate(firstProject)
    const metadata = { codeRoots: ['C:\\projects\\shop\\app'], entryUrls: [] }
    await harness.runtime.commitProjectUpdate(
      { commandId: 'cmd-replay-shared', recordId: prepared.recordId, expectedRevision: 1 },
      prepared,
      metadata,
    )

    // The same token, a different project: the receipt it earned named the first.
    const otherPrepared = harness.runtime.prepareProjectUpdate(secondProject)
    await expect(harness.runtime.commitProjectUpdate(
      { commandId: 'cmd-replay-shared', recordId: otherPrepared.recordId, expectedRevision: 1 },
      otherPrepared,
      metadata,
    )).rejects.toMatchObject({ code: 'web-test/command-token-reuse' })

    // The same project, different content: the token already published a change,
    // so answering with the first receipt would report content the caller never sent.
    const reread = harness.runtime.prepareProjectUpdate(firstProject)
    await expect(harness.runtime.commitProjectUpdate(
      { commandId: 'cmd-replay-shared', recordId: reread.recordId, expectedRevision: 2 },
      reread,
      { codeRoots: ['C:\\projects\\shop\\web'], entryUrls: [] },
    )).rejects.toMatchObject({ code: 'web-test/command-token-reuse' })
    expect(harness.runtime.readProject(firstProject)).toEqual({ projectId: firstProject, revision: 2, ...metadata })
    await harness.stop()
  })
})
