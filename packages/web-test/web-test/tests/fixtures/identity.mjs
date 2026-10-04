/**
 * Keyless evidence for the application's own install: the Loader resolves the profile
 * this application registered inside its own data root, the shipped composition layer
 * closes every product egress over it, and the owned entry activates on that data root
 * and releases through the same owner. No model request, credential, or network is used.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { boot, composeEntries, loadOverlayPatches, loadProfileDirectory, PluginPackages } from '@deepseek-ai/dsh-app-boot'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import DeepSeekLlmApiExtensionRegistry from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import * as PluginInventory from '@deepseek-ai/dsh-plugin-package-inventory-deepseek'

const {
  assertWebTestDataRoot, registerWebTestApplication, releaseWebTestEntry, resolveWebTestApplication,
  WEB_TEST_ENTRY_ID,
} = await import(new URL('../../lib/index.js', import.meta.url).href)

/** The dsh installation whose dependencies supply this application's profile bundles. */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../../../../apps/cli/package.json', import.meta.url))

/** Every product egress the selected desktop baseline enables by default. */
const EGRESS_ROWS = [
  'session-telemetry-otel',
  'session-log-deepseek',
  'desktop-product-telemetry',
  'product-analytics',
]

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const cwd = process.cwd()
// The official product keeps the shared home; this application resolves a sibling root.
const officialHome = join(homedir(), '.dsh')
// The launcher already applied the launch environment, so the ambient home in this
// process is this application's own root; the official home is checked below instead.
const application = resolveWebTestApplication({ base: cwd })

assert.ok(application.home.startsWith(cwd), 'the data root belongs to this run')
assert.notEqual(application.home, officialHome)
assert.notEqual(application.profileDir, join(officialHome, 'profiles', 'desktop'))

const releaseInstall = registerWebTestApplication(application)
try {
  assert.ok(existsSync(application.userDataDir), 'the browser user-data directory is registered')
  const releaseIdentity = JSON.parse(readFileSync(application.releaseIdentityPath, 'utf8'))
  assert.equal(releaseIdentity.updateChannel, application.updateChannel)
  assert.equal(releaseIdentity.home, application.home)

  // 1. The Loader resolves the bundles this application's own profile selects.
  const profile = loadProfileDirectory('dsh', application.profileDir, INSTALL_ANCHOR)
  assert.deepEqual(profile.skippedBundles, [], 'every selected bundle loaded')
  const bundleLayers = profile.layers.map(layer => layer.patches)
  const bundleWarnings = []
  const withoutApplicationLayer = composeEntries(bundleLayers, message => bundleWarnings.push(message))
  // The desktop baseline enables both host and client egress by default, so the
  // application's disable is discriminating rather than a no-op.
  for (const id of ['desktop-product-telemetry', 'product-analytics']) {
    const baseline = withoutApplicationLayer.find(row => row.id === id)
    assert.ok(baseline, `${id} is declared by the selected bundles`)
    assert.notEqual(baseline.disabled, true, `${id} is not disabled without the application layer`)
  }

  // 2. The shipped composition layer mounts the owned entry and closes every egress row.
  const applicationLayer = loadOverlayPatches('dsh', application.compositionLayerPath)
  const warnings = []
  const composed = composeEntries([...bundleLayers, applicationLayer], message => warnings.push(message))
  // A patch row that does not land warns and is dropped, and the launch still succeeds:
  // this application's own rows are asserted by their effect, not by a clean exit.
  assert.deepEqual(
    warnings.filter(message => !bundleWarnings.includes(message)),
    [],
    'the application layer dropped no row',
  )
  for (const id of EGRESS_ROWS) {
    const row = composed.find(entry => entry.id === id)
    assert.ok(row, `${id} is present in the composition`)
    assert.equal(row.disabled, true, `${id} is disabled by the application layer`)
  }
  const entry = composed.find(row => row.id === WEB_TEST_ENTRY_ID)
  assert.ok(entry, 'the application entry is inserted, not updated')
  const layerBase = pathToFileURL(`${dirname(application.compositionLayerPath)}/`)
  assert.equal(new URL(entry.name, layerBase).href, application.entryUrl)

  // 3. The owned entry activates through the real Loader on the application's data root.
  // The root config carries the entry alone so this leg observes one tree; the egress
  // rows of the full application composition are checked above, where they are declared.
  const rootConfig = resolve('cordis.yml')
  writeFileSync(rootConfig, `- id: ${WEB_TEST_ENTRY_ID}\n  name: ${JSON.stringify(application.entryUrl)}\n`)
  const ctx = await boot('web-test-identity', rootConfig, [], async (host) => {
    await host.plugin(PluginPackages)
    await host.plugin(AgentRegistry)
    await host.plugin(DeepSeekLlmApiExtensionRegistry)
    await host.plugin(PluginInventory)
  })
  try {
    assert.ok(ctx.get('webTest'), 'the owned entry activates')
    // The runtime's own home resolver is the application's root, not the official one.
    assertWebTestDataRoot(application, ctx.dshHomePath())
    const extensions = ctx.get('deepseekLlmApiExtensions')
    const request = { body: { messages: [] }, signal: new AbortController().signal }
    const active = await extensions.prepare(request)
    assert.deepEqual(active.fields.dsh_plugin_packages, {
      version: 1, packages: [{ name: manifest.name, version: manifest.version }],
    })

    // 4. The same owner releases the entry; no registration is left behind.
    releaseWebTestEntry(ctx.loader)
    assert.equal(ctx.get('webTest'), undefined)
    assert.deepEqual((await extensions.prepare(request)).fields.dsh_plugin_packages, { version: 1, packages: [] })
  } finally {
    await ctx.fiber.dispose()
  }
  console.log(`WEB_TEST_IDENTITY_OK ${application.home}`)
} finally {
  releaseInstall()
}
