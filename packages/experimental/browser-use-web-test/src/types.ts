/** Profile-owned opt-in for the Main-controlled Desktop browser tools. */

/** Browser tools are unavailable unless explicitly enabled beside the Desktop Host service. */
export interface WebTestBrowserAutomationConfig {
  /** Enable tools backed by acknowledged Session bindings on ctx.desktopBrowserControl. Defaults to false. */
  controlled?: boolean
}
