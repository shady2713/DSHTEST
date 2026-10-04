/**
 * Per-task route state derived from the model-configuration authority.
 * This read issues no connection tests or persistence writes. A decision without
 * a stored failure classification remains generic; provider text is never parsed.
 */
import type { NotReadyReason, TaskRoute } from '@deepseek-ai/dsh-web-test-models'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { ROUTE_TASK_TYPES, type RouteState, type RouteTaskType, type TaskRouteState } from './types.ts'

/** The persisted route decision this surface reads without verification or writes. */
export interface RouteAuthority {
  /** Read readiness without issuing model probes or persistence writes. */
  selectRoute(taskType: RouteTaskType, options: { readonly reverify: boolean }): Promise<TaskRoute>
}

/** The not-ready reasons that need no further real request to explain themselves. */
type SelfExplainingReason = Exclude<NotReadyReason, 'connection-failed'>

/**
 * Report every task type's route state, in strip order.
 * @param authority - the model-configuration authority this surface reads.
 * @returns one row per task type; a task type with no usable route stays not
 * ready with the reason, never a guess at a substitute.
 */
export async function routeStates(authority: RouteAuthority): Promise<readonly TaskRouteState[]> {
  const entries: TaskRouteState[] = []
  for (const taskType of ROUTE_TASK_TYPES) {
    entries.push(await taskRouteState(authority, taskType))
  }
  return entries
}

/** Report one task type's route state. */
async function taskRouteState(authority: RouteAuthority, taskType: RouteTaskType): Promise<TaskRouteState> {
  const decision = await authority.selectRoute(taskType, { reverify: false })
  if (decision.kind === 'ready') {
    return {
      taskType,
      state: 'ready',
      detail: null,
      provider: decision.selection.route.provider,
      model: decision.selection.route.model,
    }
  }
  if (decision.reason !== 'connection-failed') {
    return {
      taskType,
      state: stateOfReason(decision.reason),
      detail: decision.detail,
      provider: null,
      model: null,
    }
  }
  return {
    taskType,
    state: 'transient',
    detail: 'connection verification requires an explicit test',
    provider: null,
    model: null,
  }
}

/** Map a not-ready reason that already names the action. */
function stateOfReason(reason: SelfExplainingReason): RouteState {
  switch (reason) {
    case 'no-provider-configured':
      return 'not-configured'
    case 'capability-absent':
      return 'capability-absent'
    case 'reverification-required':
      return 'reverify'
    /* v8 ignore next 2 -- NotReadyReason minus connection-failed is closed over the cases above; unreachable. */
    default:
      return assertNever(reason, 'web-test-presentation: unknown self-explaining not-ready reason')
  }
}
