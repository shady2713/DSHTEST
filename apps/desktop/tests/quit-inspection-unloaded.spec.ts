/**
 * Generic profiles without webTestRuntime inspect the loaded agent and job rosters. These cases
 * retain that behavior; desktop-host's persistent-activity tests cover cold prototype runs when
 * the Web testing Runtime is installed.
 */

import { Context } from '@deepseek-ai/cordis'
import { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { JobStatus, JobView } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionActivity } from '@deepseek-ai/dsh-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installDesktopQuitInspection } from '../../desktop-host/src/quit-inspection.ts'
import { hasDesktopActiveTasks } from '../../desktop-host/src/update-tasks.ts'

/** In-process agent state; only a session loaded during this run appears in `agents.list()`. */
type LoadedAgent = { id: SessionId; status: 'idle' | 'running'; inbox: { nextTurn: object[]; nextStep: object[] } }

/** Durable session state a cold process can read from disk without having loaded the session. */
interface PersistedSession {
  readonly id: SessionId
  status: 'idle' | 'running'
  readonly inbox: { nextTurn: object[]; nextStep: object[] }
  /** Job statuses this session owns, served under its id in the process-global registry. */
  jobs: JobStatus[]
  activity: SessionActivity[]
}

/** Every persisted session, loaded or not; loading adds an agent, never a second copy of the state. */
const sessions = new Map<SessionId, PersistedSession>()
/** The roster `agents.list()` serves: the sessions this process loaded. */
const roster: LoadedAgent[] = []
/** Job statuses per owner; `undefined` is the process-global roster that owns no session. */
const jobOwners = new Map<SessionId | undefined, JobStatus[]>()
/** Owners the job registry was asked about, in call order. */
const askedJobOwners: (SessionId | undefined)[] = []
/** Sessions a `workspace/session-activity` provider was asked about, in call order. */
const askedSessions: SessionId[] = []

/**
 * A registry that answers any owner it is asked about, including a session this process never
 * loaded. The fixture therefore proves that the inspector stops asking, not that data is withheld.
 */
class OwnerKeyedJobRegistry extends JobRegistry {
  readonly events = { subscribe: () => () => {} }
  start(): never { throw new Error('unsupported') }
  list(caller?: SessionId): JobView[] {
    askedJobOwners.push(caller)
    return (jobOwners.get(caller) ?? []).map((status, index) => ({
      id: JobId(`bash-${index + 1}`),
      kind: 'bash',
      label: 'sleep 60',
      ...caller === undefined ? {} : { owner: caller },
      status,
      startedAt: 0,
      output: { total: 0, earliest: 0 },
    }))
  }
  get(): never { throw new Error('unsupported') }
  read(): never { throw new Error('unsupported') }
  readAt(): never { throw new Error('unsupported') }
  kill(): never { throw new Error('unsupported') }
  wait(): never { throw new Error('unsupported') }
  remove(): never { throw new Error('unsupported') }
  attachController(): () => void { return () => {} }
}

let ctx: Context
let registry: OwnerKeyedJobRegistry
let inspect: ReturnType<typeof installDesktopQuitInspection>

/**
 * Load a persisted session into this process, as opening a session from the previous run does.
 * @param session - Persisted record to expose through `agents.list()`.
 */
function load(session: PersistedSession): void {
  roster.push(toLoadedAgent(session))
}

/**
 * Persist one session without loading it, as a cold start leaves the previous run's session.
 * @param id - Session identity.
 * @returns The durable record, absent from `agents.list()`.
 */
function persist(id: string): PersistedSession {
  const session: PersistedSession = {
    id: SessionId(id), status: 'idle', inbox: { nextTurn: [], nextStep: [] }, jobs: [], activity: [],
  }
  sessions.set(session.id, session)
  jobOwners.set(session.id, session.jobs)
  return session
}

/**
 * The loaded-roster view of a persisted session.
 * @param session - Persisted record.
 * @returns The in-memory agent state the roster would expose after loading.
 */
function toLoadedAgent(session: PersistedSession): LoadedAgent {
  return { id: session.id, status: session.status, inbox: session.inbox }
}

/**
 * The roster and job registry the shared update-restart rule reads.
 * @returns The same two services the inspector resolves, for a direct rule comparison.
 */
function sharedRuleInput(): { agents: ReturnType<Context['agents']['list']>; jobs: Context['jobs'] } {
  const agents = ctx.get('agents')
  if (agents === undefined) throw new Error('test host: agents service is unavailable')
  return { agents: agents.list(), jobs: registry }
}

beforeEach(() => {
  sessions.clear()
  roster.length = 0
  jobOwners.clear()
  askedJobOwners.length = 0
  askedSessions.length = 0
  ctx = new Context()
  // An empty roster is the cold-start face both surfaces read.
  ctx.provide('agents', { list: () => roster } as never)
  registry = new OwnerKeyedJobRegistry(ctx)
  // A provider more generous than the shipped ones: it answers for an unloaded session too, so an
  // unobserved reminder can only mean the inspector never asked.
  ctx.on('workspace/session-activity', async ({ sessionId }, next) => {
    askedSessions.push(sessionId)
    return [...sessions.get(sessionId)?.activity ?? [], ...await next()]
  })
  inspect = installDesktopQuitInspection(ctx)
})

afterEach(async () => { await ctx.fiber.dispose() })

describe('Desktop quit inspection over sessions this process never loaded', () => {
  it('reports a stuck run, a queued event, an owned job, and a saved reminder of one unloaded session as no work', async () => {
    const cold = persist('cold')
    cold.status = 'running'
    cold.inbox.nextTurn.push({ queued: true })
    cold.jobs.push('running')
    cold.activity.push({ kind: 'schedule', items: [{ id: 'reminder-1', label: 'stand-up' }] })

    expect(await inspect()).toEqual({ activeTasks: false, scheduledTasks: false })
    // The global roster is the only job list either surface reads, and no session is asked about.
    expect(askedJobOwners).toEqual([undefined])
    expect(askedSessions).toEqual([])
    // The record is readable all the same: nothing asked for it.
    expect(jobOwners.get(cold.id)).toEqual(['running'])
    expect(sessions.get(cold.id)?.activity).toEqual([{ kind: 'schedule', items: [{ id: 'reminder-1', label: 'stand-up' }] }])
  })

  it.each([
    ['a stuck run', (session: PersistedSession) => { session.status = 'running' }],
    ['a queued turn', (session: PersistedSession) => { session.inbox.nextTurn.push({ queued: true }) }],
    ['a queued step', (session: PersistedSession) => { session.inbox.nextStep.push({ queued: true }) }],
    ['a job the session owns', (session: PersistedSession) => { session.jobs.push('stopping') }],
    ['a saved reminder', (session: PersistedSession) => { session.activity.push({ kind: 'schedule', items: [{ id: 'reminder-1' }] }) }],
  ] as const)('counts %s of an unloaded session as no work on either surface', async (_shape, apply) => {
    const session = persist('cold')
    apply(session)

    const inspection = await inspect()
    const shared = hasDesktopActiveTasks(sharedRuleInput().agents, sharedRuleInput().jobs)
    expect({
      activeTasks: inspection.activeTasks,
      sharedRule: shared,
      scheduledTasks: inspection.scheduledTasks,
    }).toEqual({ activeTasks: false, sharedRule: false, scheduledTasks: false })
  })

  it('agrees with the shared update-restart rule about a job that owns no session', async () => {
    jobOwners.set(undefined, ['running'])
    persist('cold')

    const inspection = await inspect()
    const shared = hasDesktopActiveTasks(sharedRuleInput().agents, sharedRuleInput().jobs)
    // The registry is process-global, so an unowned job is the one persistent item still visible.
    expect(inspection).toEqual({ activeTasks: true, scheduledTasks: false })
    expect(shared).toBe(true)
  })

  it('reports the same session as active work only after this process loads it', async () => {
    const session = persist('cold')
    session.status = 'running'
    session.jobs.push('running')
    session.activity.push({ kind: 'schedule', items: [{ id: 'reminder-1' }] })
    expect(await inspect()).toEqual({ activeTasks: false, scheduledTasks: false })

    load(session)
    const inspection = await inspect()
    const shared = hasDesktopActiveTasks(sharedRuleInput().agents, sharedRuleInput().jobs)
    // Loading is the only difference: the durable records are byte-identical in both runs.
    expect(inspection).toEqual({ activeTasks: true, scheduledTasks: true })
    expect(shared).toBe(true)
    expect(askedSessions).toEqual([SessionId('cold')])
  })
})
