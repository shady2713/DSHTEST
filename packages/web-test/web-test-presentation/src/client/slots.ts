/**
 * The dock entry's injected face. The target `conversation.input.dock` slot is
 * declared by ui-conversation and this package only contributes one entry to it,
 * so no SlotMap merge lives here.
 *
 * Live route state is process-local to the browser — a Remote read, not durable
 * session state — so it arrives through a registrant-private observable the
 * renderer binds to a hook, exactly as the renderer binds any private source.
 */

import type { ModelConfigurationOperations } from './ModelConfiguration.tsx'
import type { ProjectPanelOperations } from './ProjectPanel.tsx'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RouteStateResponse, TaskRouteState } from '../types.ts'

/**
 * What the strip renders.
 *
 * `loading` is the state before the first Remote read answers, so the strip never
 * shows an empty route list that reads as "nothing is wrong".
 */
export type RouteStatusSnapshot =
  | { readonly phase: 'loading' }
  | { readonly phase: 'loaded'; readonly entries: readonly TaskRouteState[] }
  | { readonly phase: 'unavailable'; readonly detail: string }

/** Registrant-private observable source bound by the slot renderer. */
export interface RouteStatusInjected {
  /** Configuration actions supplied by the official Remotes adapter. */
  readonly configure: ModelConfigurationOperations
  /** Project reads and explicit user actions through the same Commands Remote as tools. */
  readonly projects: ProjectPanelOperations
  readonly hooks: {
    /** The current route-state read; a framework hook binds this source. */
    readonly routeStatus: HostObservable<RouteStatusSnapshot>
  }
  /** Read the route state again, for a check the user asked for. */
  readonly refresh: () => void
}

/** The Remote read this surface performs, named so the mount stays the only caller. */
export type RouteStateRead = () => Promise<RouteStateReadResult>

/**
 * One read's settled outcome.
 *
 * A refused Remote call is a value here rather than a rejection, so the strip's
 * explanation is always a message the Host chose and never a stringified
 * throwable.
 */
export type RouteStateReadResult =
  | { readonly ok: true; readonly response: RouteStateResponse }
  | { readonly ok: false; readonly detail: string }
