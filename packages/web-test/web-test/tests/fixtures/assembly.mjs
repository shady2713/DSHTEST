/** Plain-Node built composition; no model, credentials, or network are used. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { boot, PluginPackages } from '@deepseek-ai/dsh-app-boot'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import DeepSeekLlmApiExtensionRegistry from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import * as PluginInventory from '@deepseek-ai/dsh-plugin-package-inventory-deepseek'

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
// Loader persists entry disposal. Give it a copy inside the smoke-owned temporary cwd.
const configPath = resolve('cordis.yml')
const pluginUrl = new URL('../../lib/index.js', import.meta.url).href
writeFileSync(configPath, readFileSync(process.argv[2], 'utf8').replace(
  'name: ../../lib/index.js', `name: ${JSON.stringify(pluginUrl)}`,
))
const ctx = await boot('web-test-assembly', configPath, undefined, async host => {
  await host.plugin(PluginPackages)
  await host.plugin(AgentRegistry)
  await host.plugin(DeepSeekLlmApiExtensionRegistry)
  await host.plugin(PluginInventory)
})
try {
  const service = ctx.get('webTest')
  assert.ok(service, 'the configured plugin must activate')
  assert.equal(service.identity.applicationId, 'dsh-web-test')
  assert.ok(service.listEntryPoints().some(entry => entry.id === 'web-test.browser-automation'))
  assert.ok(service.listEntryPoints().every(entry => !service.provides(entry.id)))
  const extensions = ctx.get('deepseekLlmApiExtensions')
  const request = { body: { messages: [] }, signal: new AbortController().signal }
  const prepared = await extensions.prepare(request)
  assert.deepEqual(prepared.fields.dsh_plugin_packages, {
    version: 1, packages: [{ name: manifest.name, version: manifest.version }],
  })
  const entry = [...ctx.loader.entries()].find(value => value.options.id === 'web-test')
  await entry.fiber.dispose()
  assert.equal(ctx.get('webTest'), undefined)
  const after = await extensions.prepare(request)
  assert.deepEqual(after.fields.dsh_plugin_packages, { version: 1, packages: [] })
  console.log('WEB_TEST_ASSEMBLY_OK')
} finally {
  await ctx.fiber.dispose()
}
