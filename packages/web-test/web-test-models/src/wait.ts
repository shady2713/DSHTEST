/**
 * The recoverable wait: work a credential change interrupted, kept rather than
 * dropped, and resumed only on the route it was pinned to.
 *
 * The requirement has two halves and the implementation keeps them apart. A
 * replaced or removed credential must **not delete** the work — so a parked
 * ticket stays in the registry with its original route, its task type, and the
 * reference that interrupted it, and neither settling nor resuming it can move
 * it without a real request. And it must **not silently switch models** — so a
 * resume re-verifies the pinned route with a real request and either returns
 * that same route or reports that the wait continues. Nothing here re-runs
 * selection.
 *
 * The registry is in-process by design. A parked ticket names work the user is
 * still looking at, and it is a fact about the running session rather than a
 * durable authorization; the durable record of *which route was verified* is the
 * persisted selection, not this queue.
 *
 * @module @deepseek-ai/dsh-web-test-models/wait
 */

import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials/types'
import type {
  ConnectionReport, ModelRoute, ParkReason, WorkTicket,
} from './types.ts'
import type { ModelTaskType } from './task.ts'

/** One ticket's mutable state; the outward shape is rebuilt from it. */
interface TrackedWork {
  /** Opaque identity the caller resumes by. */
  workId: string
  /** The task type the work was admitted for. */
  taskType: ModelTaskType
  /** The route the work is pinned to for its whole life. */
  route: ModelRoute
  /** Current lifecycle state. */
  state: WorkTicket['state']
  /** Why the work is waiting, when it is. */
  parkReason: ParkReason | null
  /** When the work entered `waiting`, or null. */
  parkedAt: number | null
  /** The reference whose change interrupted the work, or null. */
  interruptedBy: CredentialRef | null
}

/** What admitting one unit of work states. */
export interface AdmitWork {
  /** Opaque identity the caller resumes by; one identity is one unit of work. */
  readonly workId: string
  /** The task type the work is for. */
  readonly taskType: ModelTaskType
  /** The route the work is pinned to. */
  readonly route: ModelRoute
}

/** The recoverable-wait registry, owned by one {@link WebTestModels} instance. */
export class WorkRegistry {
  private readonly works = new Map<string, TrackedWork>()

  /**
   * Admit one unit of work, pinned to the route it starts on.
   *
   * Re-admitting an identity that is already tracked returns the existing
   * ticket rather than re-pinning it, so a retried request cannot silently
   * change the route its own resume would return.
   * @param work - the work's identity, task type, and pinned route.
   * @returns the tracked ticket.
   */
  admit(work: AdmitWork): WorkTicket {
    const existing = this.works.get(work.workId)
    if (existing !== undefined) return snapshot(existing)
    const tracked: TrackedWork = {
      workId: work.workId,
      taskType: work.taskType,
      route: { ...work.route },
      state: 'running',
      parkReason: null,
      parkedAt: null,
      interruptedBy: null,
    }
    this.works.set(work.workId, tracked)
    return snapshot(tracked)
  }

  /**
   * Read one ticket, or `undefined` when the identity is not tracked.
   * @param workId - the identity the caller admitted.
   * @returns the ticket, or `undefined`.
   */
  read(workId: string): WorkTicket | undefined {
    const tracked = this.works.get(workId)
    return tracked === undefined ? undefined : snapshot(tracked)
  }

  /**
   * Mark one unit of work finished, keeping its record until it is acknowledged.
   *
   * A parked ticket is refused. Work interrupted by a credential change was cut
   * off mid-flight, so nothing has established that it finished, and settling it
   * would drop it out of the recoverable wait that has to survive until the work
   * resumes. A caller that wants a parked unit gone resumes it or forgets it
   * explicitly; neither is a report that it finished.
   *
   * A settled ticket is retained so a surface can still show that the work ran;
   * {@link forget} is what drops it, and a caller that never acknowledges keeps
   * a settled row rather than losing the fact.
   * @param workId - the identity the caller admitted.
   * @returns true when a running ticket moved to `settled`, false when it was
   * already settled, is parked, or is not tracked.
   */
  settle(workId: string): boolean {
    const tracked = this.works.get(workId)
    if (tracked === undefined) return false
    if (tracked.state !== 'running') return false
    tracked.state = 'settled'
    return true
  }

  /**
   * Drop one ticket entirely, whether it is running, parked, or settled.
   * @param workId - the identity to forget.
   * @returns true when a tracked ticket was dropped.
   */
  forget(workId: string): boolean {
    return this.works.delete(workId)
  }

  /**
   * Every ticket currently waiting, in admission order.
   * @returns the recoverable wait's contents.
   */
  waiting(): WorkTicket[] {
    return [...this.works.values()].filter(work => work.state === 'waiting').map(snapshot)
  }

  /**
   * Park every running ticket whose pinned route resolves keys through `ref`.
   *
   * A ticket is matched on the reference named in its pinned route, not on the
   * provider, because a provider may hold several references and only the one
   * this route resolves was written. Tickets already waiting keep their original
   * `parkedAt` and reason, so a second change does not restart the wait.
   * @param ref - the reference whose stored value changed.
   * @param configured - whether the reference still resolves to a value.
   * @param now - the instant the change was observed.
   * @returns the tickets this change parked.
   */
  parkForReference(ref: CredentialRef, configured: boolean, now: number): WorkTicket[] {
    const reason: ParkReason = configured ? 'credential-replaced' : 'credential-removed'
    const parked: WorkTicket[] = []
    for (const tracked of this.works.values()) {
      if (tracked.state !== 'running') continue
      if (tracked.route.credentialRef !== ref) continue
      tracked.state = 'waiting'
      tracked.parkReason = reason
      tracked.parkedAt = now
      tracked.interruptedBy = ref
      parked.push(snapshot(tracked))
    }
    return parked
  }

  /**
   * Move one parked ticket back to running after its pinned route was
   * re-verified.
   *
   * The route is read from the ticket and never reassigned here, which is what
   * makes "no silent model switch" a property of the code rather than a promise:
   * the only field this writes is the lifecycle, and the caller supplies the
   * report that earned the move from its own pinned route. The route is compared
   * by its three facts rather than by object identity, because a report rebuilt
   * from the same route is the same route — a reference comparison would refuse
   * a structurally equal report and strand the work in its wait.
   *
   * A report that refused is refused here too. The wait ends when the pinned
   * route answers, and a request the provider turned down did not answer, so the
   * work keeps waiting on the same route with the fact that interrupted it.
   * @param workId - the identity to resume.
   * @param report - the real request made against the ticket's pinned route.
   * @returns true when the report answered on that route and the ticket is now running.
   */
  resume(workId: string, report: ConnectionReport): boolean {
    const tracked = this.works.get(workId)
    if (tracked === undefined || tracked.state !== 'waiting') return false
    if (report.verdict.kind !== 'ready') return false
    if (!isSameRoute(report.route, tracked.route)) return false
    tracked.state = 'running'
    tracked.parkReason = null
    tracked.parkedAt = null
    tracked.interruptedBy = null
    return true
  }
}

/**
 * Whether two routes are the same route by their facts.
 *
 * A report that arrives from a caller may have been rebuilt rather than carried
 * by reference, so identity is not a fact a route has; the provider, the model,
 * and the reference keys are.
 * @param left - the route one side names.
 * @param right - the route the other side names.
 * @returns true when both name the same provider, model, and credential reference.
 */
function isSameRoute(left: ModelRoute, right: ModelRoute): boolean {
  return left.provider === right.provider
    && left.model === right.model
    && left.credentialRef === right.credentialRef
}

/**
 * Copy a tracked ticket into the immutable value callers see, so no caller can
 * mutate the registry's state through a returned object.
 * @param tracked - the registry's own record.
 * @returns the outward ticket.
 */
function snapshot(tracked: TrackedWork): WorkTicket {
  return {
    workId: tracked.workId,
    taskType: tracked.taskType,
    route: { ...tracked.route },
    state: tracked.state,
    parkReason: tracked.parkReason,
    parkedAt: tracked.parkedAt,
    interruptedBy: tracked.interruptedBy,
  }
}

/**
 * Resolve a reference name a route may be pinned to.
 *
 * A route's `credentialRef` decides which tickets a credential change parks, so
 * a name outside the grammar is read as "not pinned" rather than thrown on: a
 * provider library's own ambient discovery hands this function names it invented,
 * and refusing a session's request over such a name would be a worse failure
 * than never matching it.
 * @param ref - the reference name to judge.
 * @returns the branded reference, or `null` when the name cannot name one.
 */
export function pinnedReference(ref: string | null | undefined): CredentialRef | null {
  if (ref === null || ref === undefined) return null
  return isCredentialRefName(ref) ? credentialRef(ref) : null
}
