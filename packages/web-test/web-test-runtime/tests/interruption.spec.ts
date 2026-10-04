/**
 * Entry publication interrupted between stages.
 *
 * The fault is real, not simulated: the suite holds the unit document against
 * deletion the instant the named stage commits, so the write that follows fails
 * the way a virus scanner, indexer, or backup agent holding the file makes it
 * fail. What the suite then checks is the whole point of the two commit
 * protocols: the durable bytes are a reservation and at most an unpublished child
 * record, and an update is either content the head does not name yet or content
 * the head does. No read sees a half-published project, the data root stays
 * openable, and a resend of the same command token finishes the one project or
 * the one change the interrupted attempt began.
 *
 * The suite is Windows-only twice over: the fault it injects is a real
 * `CreateFileW` handle denying delete sharing, which is what makes the backend's
 * atomic publish fail, and every case boots a Runtime, which refuses to open a
 * domain on a host that has no control-root kernel object to hold.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectId } from '@deepseek-ai/dsh-web-test-contracts'
import type { PreparedProjectUpdate } from '../src/index.ts'
import { WEB_TEST_UNIT } from '../src/spec.ts'
import { cleanup, registration, startRuntime, unitBytes } from './harness.ts'
import type { RuntimeHarness } from './harness.ts'
import { closeExclusive, openExclusive } from './exclusive-handle.ts'

afterEach(cleanup)

/** The stored head and project table as the json backend wrote them. */
interface StoredUnit {
  global: {
    headRevision: number
    entries: Record<string, { projectId: string; metadataRevision: number }>
    intents: Record<string, {
      commandId: string
      reservedProjectId: string
      phase: string
      acceptedRevision: number | null
    }>
    updates: Record<string, { commandId: string; projectId: string; targetRevision: number }>
    notifications: { sequence: number }[]
    notificationSequence: number
  }
  tables: { projects: Record<string, { projectId: string; revision: number; pending: { revision: number } | null }> }
}

/** The handle a latched fault took, and the latch that disarms it. */
interface Fault {
  handle: () => number
  disarm: () => void
}

/**
 * Block the unit document against the next publish, once, at the boundary named
 * by `table`.
 *
 * `domain/changed` fires synchronously after a durable write resolves, so the
 * handle is in place before the protocol's next stage runs. `table` is `''` for
 * the catalog head and `'projects'` for the child record, which is what lets the
 * suite choose which stage the following one is interrupted at. The guard is a
 * latch rather than the handle itself, so the resumed attempt — which must be
 * free to publish — does not re-arm the fault.
 * @param ctx - the Context the storage domain emits on.
 * @param unitPath - the unit document to hold.
 * @param table - the table whose write should be followed by the fault.
 * @returns the handle accessor and a latch the test clears once it has.
 */
function blockAfterTable(ctx: Context, unitPath: string, table: '' | 'projects'): Fault {
  let armed = true
  let handle = 0
  ctx.on('domain/changed', (change) => {
    if (!armed || change.domain !== WEB_TEST_UNIT || change.table !== table || change.operation !== 'put') return
    armed = false
    handle = openExclusive(unitPath)
  })
  return { handle: () => handle, disarm: () => { armed = false } }
}

async function readStored(harness: RuntimeHarness): Promise<StoredUnit> {
  return JSON.parse(((await unitBytes(harness)) as Buffer).toString('utf8')) as StoredUnit
}

describe.skipIf(process.platform !== 'win32')('interrupted entry publication', () => {
  it('leaves a reservation nothing can read, and a resend finishes that same project', async () => {
    const harness = await startRuntime()
    const fault = blockAfterTable(harness.ctx, harness.unitPath, '')
    try {
      await expect(harness.runtime.registerProject(registration('cmd-interrupted'))).rejects.toThrow()

      const stored = await readStored(harness)
      const intent = stored.global.intents['cmd-interrupted']
      // Exactly the reservation survived: a resource identity, a parameter
      // digest, and a phase that admits the entry point is not published.
      expect(intent).toMatchObject({ phase: 'reserved', acceptedRevision: null })
      expect(intent?.reservedProjectId).toMatch(/^project-[0-9a-f]{32}$/u)
      expect(stored.global.entries).toEqual({})
      expect(stored.global.notifications).toEqual([])
      expect(stored.tables.projects).toEqual({})

      const projectId = intent?.reservedProjectId as ProjectId
      // Nothing is visible: the head publishes no entry, so the read that
      // decides visibility reports nothing even though a reservation exists.
      expect(harness.runtime.readProject(projectId)).toBeUndefined()
      expect(harness.runtime.listProjects()).toEqual([])

      // Releasing the medium lets the same command resume. It reuses the reserved
      // identity rather than allocating a second one, because that identity is
      // derived from the command token.
      closeExclusive(fault.handle())
      const receipt = await harness.runtime.registerProject(registration('cmd-interrupted'))
      expect(receipt.resourceId).toBe(projectId)
      expect(receipt.outcome).toBe('accepted')
      expect(harness.runtime.readProject(projectId)).toMatchObject({ projectId, revision: 1 })
      expect(harness.runtime.pendingNotifications()).toHaveLength(1)

      // One project, one entry, one notification: the interrupted attempt left
      // material, not a second entity and not a duplicated effect.
      const resumed = await readStored(harness)
      expect(Object.keys(resumed.tables.projects)).toEqual([projectId])
      expect(Object.keys(resumed.global.entries)).toEqual([projectId])
      expect(resumed.global.intents['cmd-interrupted']?.phase).toBe('published')
      expect(resumed.global.notifications).toHaveLength(1)
    } finally {
      fault.disarm()
      closeExclusive(fault.handle())
      await harness.stop()
    }
  })

  it('leaves a built child record invisible when the entry point never publishes', async () => {
    const harness = await startRuntime()
    // Blocking on the child-record write instead of the head write interrupts
    // the protocol one stage later: the record is durable and the entry point is
    // not, which is the state a crash between stage two and stage three leaves.
    const fault = blockAfterTable(harness.ctx, harness.unitPath, 'projects')
    try {
      await expect(harness.runtime.registerProject(registration('cmd-half-built'))).rejects.toThrow()

      const stored = await readStored(harness)
      const projectId = stored.global.intents['cmd-half-built']?.reservedProjectId as ProjectId
      // The child record exists on disk, and the head still publishes nothing.
      expect(Object.keys(stored.tables.projects)).toEqual([projectId])
      expect(stored.global.entries).toEqual({})
      expect(stored.global.intents['cmd-half-built']?.phase).toBe('reserved')
      // Visibility is the head's entry, so a built record stays unreadable.
      expect(harness.runtime.readProject(projectId)).toBeUndefined()

      closeExclusive(fault.handle())
      const receipt = await harness.runtime.registerProject(registration('cmd-half-built'))
      // The resumed attempt reuses the record the interrupted one wrote, so the
      // project is published at the revision it was first built with rather than
      // at a second one.
      expect(receipt).toMatchObject({ resourceId: projectId, acceptedRevision: 1, outcome: 'accepted' })
      expect(harness.runtime.readProject(projectId)).toMatchObject({ projectId, revision: 1 })
      const resumed = await readStored(harness)
      expect(Object.keys(resumed.tables.projects)).toEqual([projectId])
      expect(resumed.global.notifications).toHaveLength(1)
    } finally {
      fault.disarm()
      closeExclusive(fault.handle())
      await harness.stop()
    }
  })

  it('survives a process restart between the reservation and the entry point', async () => {
    const first = await startRuntime()
    const fault = blockAfterTable(first.ctx, first.unitPath, '')
    try {
      await expect(first.runtime.registerProject(registration('cmd-crash'))).rejects.toThrow()
    } finally {
      fault.disarm()
      closeExclusive(fault.handle())
      // Dropping the whole context is what a process death looks like to the
      // medium: the domain closes, the lock is released, and the reservation
      // written before the fault is all that remains.
      await first.stop()
    }

    const second = await startRuntime({ controlRoot: first.controlRoot, dataRoot: first.dataRoot })
    const stored = await readStored(second)
    const projectId = stored.global.intents['cmd-crash']?.reservedProjectId as ProjectId
    expect(second.runtime.readProject(projectId)).toBeUndefined()

    const receipt = await second.runtime.registerProject(registration('cmd-crash'))
    expect(receipt.resourceId).toBe(projectId)
    expect(second.runtime.readProject(projectId)).toMatchObject({ projectId, revision: 1 })
    await second.stop()
  })

  it('refuses a head that publishes an entry whose record is gone', async () => {
    const harness = await startRuntime()
    const receipt = await harness.runtime.registerProject(registration('cmd-head-only'))
    const projectId = receipt.resourceId as ProjectId
    const stored = await readStored(harness)
    // An entry with no record behind it is a head that outran its own authority.
    // Serving a default here would be indistinguishable from a real project.
    stored.tables.projects = Object.fromEntries(
      Object.entries(stored.tables.projects).filter(([key]) => key !== projectId),
    )
    await writeFile(harness.unitPath, JSON.stringify(stored), 'utf8')
    await harness.stop()

    const reopened = await startRuntime({ controlRoot: harness.controlRoot, dataRoot: harness.dataRoot })
    expect(() => reopened.runtime.readProject(projectId)).toThrow(/the stored record is absent/u)
    expect(() => reopened.runtime.listProjects()).toThrow(/the stored record is absent/u)
    await reopened.stop()
  })
})

/** The metadata `registration()` gives a project, and the change an update publishes. */
const REGISTERED = { codeRoots: ['C:\\projects\\shop'], entryUrls: ['http://localhost:3000/checkout'] }
const UPDATED = { codeRoots: ['C:\\projects\\shop\\app'], entryUrls: ['http://localhost:3000/cart'] }

/**
 * One prepared update's submission, as the contract parser accepts it.
 * @param prepared - the read cut the commit addresses.
 * @param commandId - the command token that makes the commit replayable.
 * @returns the raw submission request.
 */
function submission(prepared: PreparedProjectUpdate, commandId: string): Record<string, unknown> {
  return { commandId, recordId: prepared.recordId, expectedRevision: prepared.expectedRevision }
}

describe.skipIf(process.platform !== 'win32')('interrupted update publication', () => {
  // The two boundaries an update can be cut at, and what a read must answer with
  // at each: the head still names the old revision when the publish never
  // landed, and the new one when it did and only the fold was lost.
  const boundaries = [
    {
      table: 'projects' as const,
      at: 'after the record staged the update',
      revision: 1,
      content: REGISTERED,
      // The head write never landed, so the creation's notification is the only
      // one and the update has no ledger row.
      notifications: 1,
      ledger: false,
    },
    {
      table: '' as const,
      at: 'after the head published the update',
      revision: 2,
      content: UPDATED,
      // The head write landed with its ledger row and its notification; only the
      // record write that folds the content in was lost.
      notifications: 2,
      ledger: true,
    },
  ]

  it.each(boundaries)(
    'keeps the project readable and replayable $at',
    async ({ table, revision, content, notifications, ledger }) => {
      const first = await startRuntime()
      const receipt = await first.runtime.registerProject(registration('cmd-update-fault'))
      const projectId = receipt.resourceId as ProjectId
      const prepared = first.runtime.prepareProjectUpdate(projectId)
      const fault = blockAfterTable(first.ctx, first.unitPath, table)
      try {
        await expect(first.runtime.commitProjectUpdate(
          submission(prepared, 'cmd-update-1'),
          prepared,
          UPDATED,
        )).rejects.toThrow()

        // The revision the head publishes is the one a read answers with, and it
        // answers: an update never leaves a published entry unreadable, whichever
        // of the two content copies the cut fell between.
        const served = { projectId, revision, ...content }
        expect(first.runtime.readProject(projectId)).toEqual(served)
        expect(first.runtime.listProjects()).toEqual([served])
        // A fresh read cut is still available, at the revision the head publishes.
        expect(first.runtime.prepareProjectUpdate(projectId).expectedRevision).toBe(revision)

        // The interrupted attempt left material, not a second effect: one record,
        // one entry, and the notification of the creation alone.
        const stored = await readStored(first)
        expect(Object.keys(stored.tables.projects)).toEqual([projectId])
        expect(Object.keys(stored.global.entries)).toEqual([projectId])
        expect(stored.global.notifications).toHaveLength(notifications)
        expect(Object.keys(stored.global.updates)).toEqual(ledger ? ['cmd-update-1'] : [])
      } finally {
        fault.disarm()
        closeExclusive(fault.handle())
        await first.stop()
      }

      // The data root survives: a writer that opens it again reads the same
      // published revision and can take its own read cut.
      const second = await startRuntime({ controlRoot: first.controlRoot, dataRoot: first.dataRoot })
      expect(second.runtime.readProject(projectId)).toEqual({ projectId, revision, ...content })
      expect(second.runtime.listProjects()).toEqual([{ projectId, revision, ...content }])
      const resumed = second.runtime.prepareProjectUpdate(projectId)
      expect(resumed.expectedRevision).toBe(revision)

      // The same command token finishes the one change the cut interrupted, to
      // the revision the head now names.
      const commit = await second.runtime.commitProjectUpdate(
        submission(resumed, 'cmd-update-1'),
        resumed,
        UPDATED,
      )
      expect(commit).toEqual({ recordId: prepared.recordId, acceptedRevision: 2 })
      expect(second.runtime.readProject(projectId)).toEqual({ projectId, revision: 2, ...UPDATED })
      expect(second.runtime.pendingNotifications().map(entry => entry.sequence)).toEqual([1, 2])

      // And it is still one project, one entry, one notification for the update.
      const after = await readStored(second)
      expect(Object.keys(after.tables.projects)).toEqual([projectId])
      expect(Object.keys(after.global.entries)).toEqual([projectId])
      expect(after.global.notifications).toHaveLength(2)
      expect(after.global.updates['cmd-update-1']).toMatchObject({ projectId, targetRevision: 2 })
      // The published content is folded into the record itself, so the next
      // update has the published revision to build on.
      expect(after.tables.projects[projectId]).toMatchObject({ revision: 2, pending: null })
      await second.stop()
    },
  )
})
