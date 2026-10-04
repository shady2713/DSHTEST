/** Host companion for the Sidebar Browser Client plugin. */
export { DESKTOP_BROWSER_AUTOMATION_VERSION } from './types.ts'
export { DesktopBrowserControl, readBrowserExecutionOwner, readBrowserExecutionRole, readBrowserRoleBinding,
  readBrowserGroupBindingRequest, sameBrowserExecutionOwner, bindDesktopBrowserExecutionAuthority,
  hasDesktopBrowserExecutionAuthority } from './control.ts'
export type {
  DesktopBrowserGroupId,
  DesktopBrowserExecutionAuthority,
  DesktopBrowserActivationId,
  DesktopBrowserProjectId,
  DesktopBrowserRunId,
  DesktopBrowserRoleId,
  DesktopBrowserRoleGrantId,
  DesktopBrowserExecutionOwner,
  DesktopBrowserExecutionRole,
  DesktopBrowserRoleBinding,
  DesktopBrowserGroupBindingRequest,
  DesktopBrowserBinding,
  DesktopBrowserBindingRequest,
  DesktopBrowserBindingResult,
  DesktopBrowserControlledTarget,
  DesktopBrowserControlState,
  DesktopBrowserWorkspaceKey,
} from './types.ts'
export type {
  DesktopBrowserAutomationBridge,
  DesktopBrowserBridge,
  DesktopBrowserCommand,
  DesktopBrowserCommandBody,
  DesktopBrowserCommandResult,
  DesktopBrowserUnknownReason,
  DesktopBrowserDenialReason,
  DesktopBrowserLeaseId,
  DesktopBrowserObservedElement,
  DesktopBrowserObservation,
  DesktopBrowserObservationGeneration,
  DesktopBrowserOpenRequest,
  DesktopBrowserReservation,
  DesktopBrowserTargetId,
} from './types.ts'

/** Mount the browser-only plugin through the Client loader. */
export function apply(): void {}
