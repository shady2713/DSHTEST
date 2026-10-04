/** Controlled browser tool identities whose destination comes from the trusted Host carrier. */
export const WEB_TEST_BROWSER_TOOLS = [
  'web_browser_observe', 'web_browser_screenshot', 'web_browser_click', 'web_browser_type',
  'web_browser_double_click', 'web_browser_press_key', 'web_browser_navigate', 'web_browser_reload',
] as const

/**
 * Whether a tool uses the session-bound controlled browser carrier.
 * @param name - registered tool identity.
 * @returns true for one supported controlled operation.
 */
export function isControlledBrowserTool(name: string): boolean {
  return WEB_TEST_BROWSER_TOOLS.some(tool => tool === name)
}
