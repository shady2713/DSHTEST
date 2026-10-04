/**
 * The web-test composition layer closes the desktop product rows in a real
 * Loader tree, and it — not the profile-context name — is what closes them.
 *
 * The distinction is the whole point. `packages/bundle/web-app/cordis.patch.yml`
 * enables `desktop-product-telemetry`, `product-analytics`, and
 * `ui-sidebar-browser` only when `ctx.get('profileContext')?.name` is `desktop`,
 * so a Host that booted with the name `web-test` would disable all three, the
 * Browser sidebar included, and mount no `web-test` entry at all. The disabled
 * telemetry rows alone therefore do not tell which mechanism closed them; the
 * mounted entry does. The Host keeps the name, and this composition shows the
 * layer changing the rows under that name.
 */
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { expect, it } from 'vitest'

/** Bundle layer whose gated rows this composition selects, read as the shipped file. */
const WEB_APP_PATCH = fileURLToPath(new URL('../../../packages/bundle/web-app/cordis.patch.yml', import.meta.url))

/** Layer the web-test package ships and the Host passes as its own patch file. */
const WEB_TEST_LAYER = fileURLToPath(
  new URL('../../../packages/web-test/web-test/web-test.cordis.patch.yml', import.meta.url),
)

/** Rows whose enablement the desktop profile-context name decides. */
const GATED_ROWS = ['desktop-product-telemetry', 'product-analytics', 'ui-sidebar-browser'] as const

/** The two of them that carry product egress the web-test layer closes. */
const PRODUCT_ROWS = ['desktop-product-telemetry', 'product-analytics'] as const

/** Stand-in plugin name: this composition reads row enablement, not plugin behaviour. */
const NOOP_PLUGIN = 'cordis:webTestCompositionRow'

/** A profile context carrying only the name the web-app bundle gates on. */
function profileContext(name: string): ProfileContext {
  return {
    name,
    dir: '/profile',
    patchPath: '/profile/cordis.patch.yml',
    installAnchor: '/profile/package.json',
    cwd: '/workspace',
    home: '/home',
    startedBundles: [],
    applicationPatches: [], overlays: [],
    telemetryDisabledEnv: undefined,
  }
}

/** Parse a shipped layer and point every inserted row at the stand-in plugin. */
function layers(file: string, ids?: readonly string[]): ReturnType<typeof loadOverlayPatches> {
  return loadOverlayPatches('web-test-composition', file).flatMap(patch => [{
    ...patch,
    ...(patch.insert === undefined ? {} : {
      insert: patch.insert
        .filter(row => ids === undefined || ids.includes(row.id ?? ''))
        .map(row => ({ ...row, name: NOOP_PLUGIN })),
    }),
  }]).filter(patch => patch.insert === undefined || patch.insert.length > 0)
}

/** A booted composition and the diagnostics its patch layers produced. */
interface Composed {
  readonly ctx: Context
  /** Patches whose target row no layer declared, which the Loader only warns about. */
  readonly skipped: string[]
}

/** Boot a Loader tree holding the gated rows, with the layer applied or not. */
async function compose(name: string, applyLayer: boolean): Promise<Composed> {
  const ctx = new Context()
  ctx.provide('profileContext', profileContext(name))
  ctx.provide('dshHomePath', dshHomePath)
  await ctx.plugin(Loader)
  ctx.loader.builtins.webTestCompositionRow = class extends Service {}
  // The same ordered composition a profile boot hands the Loader: the bundle
  // layer's inserts first, then the layers applied after it.
  const patches = applyLayer
    ? [...layers(WEB_APP_PATCH, GATED_ROWS), ...layers(WEB_TEST_LAYER)]
    : layers(WEB_APP_PATCH, GATED_ROWS)
  const skipped: string[] = []
  const rows = applyEntryPatches([], patches, (message) => { skipped.push(message) })
  await ctx.loader.root.update(rows.map(row => ({ ...row, name: NOOP_PLUGIN })))
  await ctx.loader.await()
  return { ctx, skipped }
}

/** Whether the booted tree holds a row, and whether that row is disabled. */
function rowState(ctx: Context, id: string): { present: boolean; disabled: boolean } {
  // The Entry's own accessor evaluates the bundle's `!!js` gate against the
  // profile context this composition provided, which is the state the Host reads.
  const row = [...ctx.loader.entries()].find(entry => entry.id === id)
  return { present: row !== undefined, disabled: row?.disabled === true }
}

it('closes the desktop product rows through the layer while the profile name stays desktop', async () => {
  const withoutLayer = await compose('desktop', false)
  try {
    // The web-app bundle enables every one of these on the desktop profile, so
    // both product telemetry rows are live before the layer applies.
    for (const id of GATED_ROWS) expect(rowState(withoutLayer.ctx, id)).toEqual({ present: true, disabled: false })
  } finally {
    await withoutLayer.ctx.fiber.dispose()
  }

  const withLayer = await compose('desktop', true)
  try {
    // The two product telemetry rows are the layer's to close, and the name is
    // unchanged: this pass is the layer's work, not the profile's name.
    for (const id of PRODUCT_ROWS) expect(rowState(withLayer.ctx, id)).toEqual({ present: true, disabled: true })
    // The Browser sidebar is not a product egress, so the layer leaves it
    // enabled under the unchanged name; a renamed profile would lose it.
    expect(rowState(withLayer.ctx, 'ui-sidebar-browser')).toEqual({ present: true, disabled: false })
    // The layer mounts this application's own entry, which the Host refuses to
    // report ready without.
    expect(rowState(withLayer.ctx, 'web-test').present).toBe(true)
  } finally {
    await withLayer.ctx.fiber.dispose()
  }
})

it('disables the same rows by name alone, which is the false pass the Host avoids', async () => {
  // A Host that booted with the name `web-test` would see the two telemetry rows
  // disabled and report success — for the wrong reason: the layer never applied,
  // so nothing closed the egress deliberately. The Browser sidebar is disabled
  // with them, and no `web-test` entry mounts, which is the tell.
  const renamed = await compose('web-test', false)
  try {
    for (const id of GATED_ROWS) expect(rowState(renamed.ctx, id)).toEqual({ present: true, disabled: true })
    expect(rowState(renamed.ctx, 'web-test').present).toBe(false)
  } finally {
    await renamed.ctx.fiber.dispose()
  }
})

it('disables the two base-bundle Session-log rows the web-app layer does not carry', () => {
  // These rows live in the base bundle, which no web-app composition can insert,
  // so the shipped layer is read directly for them rather than composed.
  const layer = loadOverlayPatches('web-test-composition', WEB_TEST_LAYER)
  for (const id of ['session-telemetry-otel', 'session-log-deepseek']) {
    const patch = layer.find(candidate => candidate.id === id)
    expect({ id, disabled: patch?.disabled }).toEqual({ id, disabled: true })
  }
})
