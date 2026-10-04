/** Built provider entry mounted by the real Loader; no model, credentials, or network. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import BrowserUseRegistry from '@deepseek-ai/dsh-browser-use'
import WebTest from '@deepseek-ai/dsh-web-test'
import { DesktopBrowserControl } from '@deepseek-ai/dsh-client-ui-sidebar-browser'

// Loader persists entry disposal. Give it a copy inside the smoke-owned temporary cwd.
const configPath = resolve('cordis.yml')
const entryUrl = new URL('../../lib/index.js', import.meta.url).href
writeFileSync(configPath, readFileSync(process.argv[2], 'utf8').replace(
  'name: ../../lib/index.js', `name: ${JSON.stringify(entryUrl)}`,
))
class FixtureControl extends DesktopBrowserControl {
  targets() { return [] }
  async bind() { throw new Error('fixture has no live guest') }
  async unbind() {}
  binding() { return undefined }
  async submit() { throw new Error('unbound command must never be dispatched') }
}
const ctx = await boot('web-test-browser-automation', configPath, undefined, async host => {
  await mountAgentLoopTestDependencies(host)
  await host.plugin(BrowserUseRegistry)
  await host.plugin(WebTest)
  await host.plugin(FixtureControl)
})
try {
  const tools = ctx.get('tools')
  const browserUse = ctx.get('browserUse')
  const webTest = ctx.get('webTest')
  const names = tools.schemas().map(tool => tool.name).sort()
  assert.deepEqual(names, [
    'web_browser_click', 'web_browser_double_click', 'web_browser_navigate', 'web_browser_observe',
    'web_browser_press_key', 'web_browser_reload', 'web_browser_screenshot', 'web_browser_type',
  ], 'the built entry must expose exactly the eight channel operations')
  assert.equal(browserUse.providerName, 'web-test-browser', 'the exclusive slot must be held')
  assert.equal(webTest.provides('web-test.browser-automation'), true, 'the capability must read available')

  // A call with no owning Session must not reach the channel at all.
  const executed = await tools.execute({
    name: 'web_browser_observe',
    arguments: {},
    callId: 'web-test-loader-1',
    signal: new AbortController().signal,
  })
  assert.equal(executed.isError, true, 'a Session without an Agent must not reach the channel')

  const entry = [...ctx.loader.entries()].find(value => value.options.id === 'web-test-browser-automation')
  await entry.fiber.dispose()
  assert.deepEqual(tools.schemas(), [], 'disposal must unregister the tools')
  assert.equal(browserUse.providerName, undefined, 'disposal must release the exclusive slot')
  assert.equal(webTest.provides('web-test.browser-automation'), false, 'disposal must withdraw availability')
  console.log('WEB_TEST_BROWSER_PROVIDER_OK')
} finally {
  await ctx.fiber.dispose()
}
