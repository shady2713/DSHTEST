/** Type-only Electron bridge declarations shared by the desktop shell and browser provider. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Browser storage account: a canonical workspace CWD or an ungrouped Session. */
export type DesktopBrowserWorkspaceKey = Branded<'DesktopBrowserWorkspaceKey'>

/** Main-owned guest identity and current URL, never supplied by a model tool. */
export interface DesktopBrowserControlledTarget {
  readonly target: DesktopBrowserTargetId
  readonly hostEpoch: number
  readonly workspace: DesktopBrowserWorkspaceKey
  readonly url: string
  readonly executionRole?: DesktopBrowserExecutionRole
}

/** Identity of one trusted runtime browser execution group. */
export type DesktopBrowserGroupId = Branded<'DesktopBrowserGroupId'>
/** Identity of the live activation that owns a browser execution group. */
export type DesktopBrowserActivationId = Branded<'DesktopBrowserActivationId'>
/** Project associated with a trusted browser execution group. */
export type DesktopBrowserProjectId = Branded<'DesktopBrowserProjectId'>
/** Runtime batch associated with a trusted browser execution group. */
export type DesktopBrowserRunId = Branded<'DesktopBrowserRunId'>
/** Role with an isolated login store inside one execution group. */
export type DesktopBrowserRoleId = Branded<'DesktopBrowserRoleId'>
/** Revocable Main-acknowledged authorization of one role target. */
export type DesktopBrowserRoleGrantId = Branded<'DesktopBrowserRoleGrantId'>

/** Opaque process-local authority; a copied literal does not grant execution-group access. */
export interface DesktopBrowserExecutionAuthority {
  readonly kind: 'trusted-desktop-execution-authority'
}

/** Trusted runtime identity; neither a page nor a model creates this owner. */
export interface DesktopBrowserExecutionOwner {
  readonly group: DesktopBrowserGroupId
  readonly activation: DesktopBrowserActivationId
  readonly project: DesktopBrowserProjectId
  readonly run: DesktopBrowserRunId
  readonly sessionId: SessionId
  readonly hostEpoch: number
  readonly workspace: DesktopBrowserWorkspaceKey
}

/** Main-issued role storage identity, separate from ordinary sidebar workspaces. */
export interface DesktopBrowserExecutionRole {
  readonly owner: DesktopBrowserExecutionOwner
  readonly role: DesktopBrowserRoleId
}

/** One target's acknowledged permission within an execution group. */
export interface DesktopBrowserRoleBinding extends DesktopBrowserControlledTarget {
  readonly executionRole: DesktopBrowserExecutionRole
  readonly grant: DesktopBrowserRoleGrantId
}

/** Private, atomic authorization or withdrawal of all targets in one group. */
export interface DesktopBrowserGroupBindingRequest {
  readonly version: typeof DESKTOP_BROWSER_AUTOMATION_VERSION
  readonly requestId: number
  readonly revision: number
  readonly kind: 'bind-group' | 'release-group'
  readonly owner: DesktopBrowserExecutionOwner
  readonly roles: readonly DesktopBrowserRoleBinding[]
}

/** Complete Main-owned target publication for one connected Host. */
export interface DesktopBrowserControlState {
  readonly version: typeof DESKTOP_BROWSER_AUTOMATION_VERSION
  readonly hostEpoch: number
  readonly revision: number
  readonly targets: readonly DesktopBrowserControlledTarget[]
}

/** One Main-acknowledged Session authorization, withdrawn with its target or Host. */
export interface DesktopBrowserBinding extends DesktopBrowserControlledTarget {
  readonly sessionId: SessionId
}

/** Private Host request to change one Session authorization. */
export interface DesktopBrowserBindingRequest {
  readonly version: typeof DESKTOP_BROWSER_AUTOMATION_VERSION
  readonly requestId: number
  readonly hostEpoch: number
  readonly revision: number
  readonly kind: 'bind' | 'unbind'
  readonly sessionId: SessionId
  readonly target: DesktopBrowserTargetId
  readonly workspace: DesktopBrowserWorkspaceKey
}

/** Main acknowledgement; no binding is published before a correlated acceptance. */
export interface DesktopBrowserBindingResult {
  readonly version: typeof DESKTOP_BROWSER_AUTOMATION_VERSION
  readonly requestId: number
  readonly hostEpoch: number
  readonly ok: boolean
}

/** Main-issued identity of one guest reservation. */
export type DesktopBrowserLeaseId = Branded<'DesktopBrowserLeaseId'>

/** A guest's approved, process-local storage partition. */
export interface DesktopBrowserReservation {
  readonly lease: DesktopBrowserLeaseId
  readonly partition: string
}

/** Main-approved request to open an HTTP(S) page from an existing guest. */
export interface DesktopBrowserOpenRequest {
  readonly lease: DesktopBrowserLeaseId
  readonly url: string
}

/** Origin-scoped operations; no Electron objects or arbitrary IPC cross this interface. */
export interface DesktopBrowserBridge {
  /** @param workspace - resolved storage account. @returns one approved guest reservation. */
  acquire(workspace: string): Promise<DesktopBrowserReservation>
  /** @param lease - the caller's reservation. @returns after its guest has been destroyed. */
  release(lease: DesktopBrowserLeaseId): Promise<void>
  /** @param lease - originating guest. @param listener - approved URL consumer. @returns unsubscribe callback. */
  onOpenRequested(lease: DesktopBrowserLeaseId, listener: (url: string) => void): () => void
}

/**
 * Main-issued identity of the guest one automation command addresses. A command
 * naming a target the connected Host does not own is refused, so a target from a
 * previous window, lease, or Host generation cannot act.
 */
export type DesktopBrowserTargetId = Branded<'DesktopBrowserTargetId'>

/** Protocol revision of the Host↔Main automation channel. */
export const DESKTOP_BROWSER_AUTOMATION_VERSION = 3

/**
 * Generation of one observed page. Every observation the Main emits carries a
 * fresh generation, and a command computed against an older one is refused rather
 * than applied to whatever now occupies those coordinates.
 */
export type DesktopBrowserObservationGeneration = number

/** One addressable element of an observation, in page coordinates. */
export interface DesktopBrowserObservedElement {
  /** Opaque handle the Host returns in a later command; meaningless outside its target and generation. */
  readonly ref: string
  /** Stable role token for the element kind, for example `button` or `textbox`. */
  readonly role: string
  /** Accessible name, empty when the page exposes none. */
  readonly name: string
  /** CSS pixels relative to the document, used to reject an action outside the viewport. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One page state the Main reports back, tagged with the generation that produced it. */
export interface DesktopBrowserObservation {
  /** Epoch of the Host that requested it; a result for a different epoch is refused. */
  readonly hostEpoch: number
  readonly target: DesktopBrowserTargetId
  readonly generation: DesktopBrowserObservationGeneration
  readonly url: string
  readonly title: string
  readonly elements: readonly DesktopBrowserObservedElement[]
}

/**
 * The complete set of operations a test target may receive. This union is the
 * allowlist: there is no script evaluation, no DevTools command, and no way to
 * reach a second target, so a model driving it cannot obtain host control or an
 * arbitrary CDP channel.
 */
export type DesktopBrowserCommandBody =
  | { readonly kind: 'observe' }
  | { readonly kind: 'screenshot'; readonly format: 'png' }
  | { readonly kind: 'click'; readonly ref: string; readonly generation: DesktopBrowserObservationGeneration }
  | { readonly kind: 'type'; readonly ref: string; readonly generation: DesktopBrowserObservationGeneration; readonly text: string }
  | { readonly kind: 'double-click'; readonly ref: string; readonly generation: DesktopBrowserObservationGeneration }
  | {
    readonly kind: 'press-key'
    readonly ref: string
    readonly generation: DesktopBrowserObservationGeneration
    readonly key: 'Enter' | 'Escape' | 'Tab' | 'Backspace' | 'Delete' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
  }
  /** Only query or fragment changes within the currently observed origin and pathname are admitted. */
  | { readonly kind: 'navigate'; readonly url: string; readonly generation: DesktopBrowserObservationGeneration }
  | { readonly kind: 'reload'; readonly generation: DesktopBrowserObservationGeneration }

/** Reasons the channel can confirm that the requested operation was not executed. */
export type DesktopBrowserDenialReason =
  | 'unknown-operation'
  | 'wrong-target'
  | 'stale-observation'
  | 'epoch-mismatch'
  | 'revoked'
  | 'action-failed'
  | 'navigation-denied'
  | 'session-not-authorized'

/** Reasons an attempted dispatch has no trustworthy completion result; none authorizes a retry. */
export type DesktopBrowserUnknownReason =
  | 'connection-lost'
  | 'epoch-changed'
  | 'channel-closed'
  | 'invalid-reply'
  | 'execution-failed'

/** One authenticated request from the connected Host to one owned target. */
export interface DesktopBrowserCommand {
  readonly version: typeof DESKTOP_BROWSER_AUTOMATION_VERSION
  /** Correlates the reply; the Host never treats an uncorrelated message as an answer. */
  readonly requestId: number
  /** Generation of the connected Host. The Main refuses a command from a Host it no longer serves. */
  readonly hostEpoch: number
  readonly target: DesktopBrowserTargetId
  /** Session explicitly authorized by a trusted Host consumer for this target. */
  readonly sessionId: SessionId
  readonly role?: DesktopBrowserRoleBinding
  readonly body: DesktopBrowserCommandBody
}

/** Correlated outcome. Unknown execution may have changed the page and must not be retried automatically. */
export type DesktopBrowserCommandResult =
  | {
    readonly version: typeof DESKTOP_BROWSER_AUTOMATION_VERSION
    readonly requestId: number
    readonly ok: true
    readonly observation?: DesktopBrowserObservation
    readonly screenshot?: Uint8Array
  }
  | {
    readonly version: typeof DESKTOP_BROWSER_AUTOMATION_VERSION
    readonly requestId: number
    readonly ok: false
    readonly outcome: 'not-executed'
    readonly reason: DesktopBrowserDenialReason
  }
  | {
    readonly version: typeof DESKTOP_BROWSER_AUTOMATION_VERSION
    readonly requestId: number
    readonly ok: false
    readonly outcome: 'unknown'
    readonly reason: DesktopBrowserUnknownReason
  }

/** The controlled channel the Main offers the connected Host; it never reaches a page. */
export interface DesktopBrowserAutomationBridge {
  /** @param epoch - connected Host generation; unanswered older dispatches settle as unknown. */
  connectHost(epoch: number): void
  /** @param command - one request to address. @returns its correlated outcome. */
  submit(command: DesktopBrowserCommand, signal?: AbortSignal): Promise<DesktopBrowserCommandResult>
  /** @param epoch - disconnected Host generation; pending outcomes become unknown and later submissions are refused. */
  disconnectHost(epoch: number): void
}
