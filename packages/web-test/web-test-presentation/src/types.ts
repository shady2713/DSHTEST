/** Secret-free configuration and route-state wire values. @module @deepseek-ai/dsh-web-test-presentation/types */

/** Task types this surface reports, in the order the strip lists them. */
export const ROUTE_TASK_TYPES = ['analysis', 'vision', 'auxiliary'] as const

/** One task type tag this surface reports. */
export type RouteTaskType = (typeof ROUTE_TASK_TYPES)[number]

/**
 * Closed per-task-type readiness.
 *
 * `bad-credential`, `refused-model`, `refused-modality`, `refused-request`, and
 * `transient` are separate because the next action differs for each: replace a
 * key, re-choose a model, configure the missing capability, change the request,
 * or retry. `exhausted` is separate for the same reason — it needs billing, not
 * a retry.
 */
export type RouteState =
  /** A real request answered on the route this task type runs on. */
  | 'ready'
  /** No provider is configured, so there is nothing to test. */
  | 'not-configured'
  /** The reference resolved to a value the provider refused. */
  | 'bad-credential'
  /** The provider does not serve the addressed model on this route. */
  | 'refused-model'
  /** The route accepted the request but cannot carry the needed modality. */
  | 'refused-modality'
  /**
   * The request has to change before it can succeed: it does not fit the
   * addressed model, as when it exceeds its context window, or the provider
   * refused it as sent without naming a model, a reference, an account, or a
   * modality in the body.
   */
  | 'refused-request'
  /** The account's quota, balance, or credit is spent. */
  | 'exhausted'
  /**
   * A failure a later identical request may not repeat: a transport fault, a
   * `5xx`, or a status whose own name asks for a later attempt.
   */
  | 'transient'
  /** A previous selection exists but its provider, catalog, credential, or recorded capabilities moved under it. */
  | 'reverify'
  /** No configured route declares the modality this task type needs. */
  | 'capability-absent'

/** One task type's reported route state. */
export interface TaskRouteState {
  /** The task type this row is for. */
  readonly taskType: RouteTaskType
  /** What the route decision established. */
  readonly state: RouteState
  /** Safe diagnostic, absent when the verified route is ready. */
  readonly detail: string | null
  /** The provider this task type runs on, absent while no route is chosen. */
  readonly provider: string | null
  /** The exact model this task type runs on, absent while no route is chosen. */
  readonly model: string | null
}

/** Every task type's reported state, in strip order. */
export interface RouteStateResponse {
  /** One row per task type, in the order the strip lists them. */
  readonly entries: readonly TaskRouteState[]
}

/** Public provider configuration address; no credential value is returned. */
export interface ProviderConfiguration {
  /** Runtime provider identity. */
  provider: string
  /** Official settings entry id. */
  settingsNs: string
  /** Profile field path in that entry. */
  settingsPath: string[]
  /** Exact credential reference name, absent for non-key authentication. */
  credentialRef: string | null
  /** Whether this provider's advisory model directory could be read. */
  catalogState: 'ready' | 'unavailable'
  /** Models declared by the adapter. */
  models: string[]
}

/** First-run configuration directory. */
export interface ModelConfigurationResponse {
  /** Existing configurable provider profiles. */
  providers: ProviderConfiguration[]
}

/** Safe probe outcome for a user-chosen route. */
export interface RouteConfigurationOutcome {
  /** True only after a real request and successful durable write. */
  ready: boolean
  /** Safe closed diagnostic, absent after success. */
  detail: string | null
}
