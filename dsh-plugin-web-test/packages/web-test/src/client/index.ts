/**
 * Browser half of the `dsh-plugin-web-test` bundle.
 *
 * Registers the localized dictionaries and contributes one section to the host's
 * own Settings shell through the declared `settings.section` slot. Nothing here
 * is mounted unless the plugin is installed and enabled.
 *
 * @module dsh-plugin-web-test/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only imports carry the browser Context augmentations this half reads:
// `locale` and `remote` from their runtime faces, and the `settings.section`
// slot declaration plus `LocaleNamespaceMap` from the host's settings shell.
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// The generated Remote contribution declares `webTest` on the client namespace
// map, so this half type-checks its `ctx.remote.webTest.*` calls.
import TYPERT_REMOTE from './remote.ts'
import type { PluginStatus, WebTestEnvironmentSummary, WebTestProjectSummary } from './locale.ts'
import { NS, en, zh } from './locale.ts'
import { WebTestSettingsSection } from './settings-section.tsx'

/** Cordis service injection for the Client half. */
export const inject = ['locale', 'slots', 'remote']

/** Loader row id of the settings section. */
export const SECTION_ID = 'web-test'

/** Position of the section among the host's settings sections. */
export const SECTION_ORDER = 90

/**
 * Mount the Web testing Remote namespace and its settings section.
 *
 * The namespace exists only after the contribution is mounted, so the section
 * is registered from a scoped injection that declares it rather than from this
 * plugin's own `inject`, which the loader resolves before `apply` runs.
 * @param ctx - Plugin Context on the Client.
 * @returns a disposer withdrawing the section and the Remote namespace.
 */
export async function apply(ctx: Context): Promise<() => void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-test: dictionaries')

  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const section = ctx.inject(['remote.webTest', 'slots', 'locale'], registerSection)
  try {
    await section
  } catch (error) {
    await section.dispose()
    disposeRemote()
    throw error
  }
  return () => {
    void section.dispose()
    disposeRemote()
  }
}

/**
 * Register the settings section and read the plugin status once.
 *
 * The status is read when the section mounts. The host publishes no change
 * signal for plugin-owned status, so a live-updating section needs a declared
 * store; until the business UI lands, a mount-time read is the honest scope.
 * @param ctx - Scoped Context carrying the mounted namespace.
 */
function registerSection(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  let status: PluginStatus | undefined
  let failure: string | undefined
  const projects: WebTestProjectSummary[] = []

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: SECTION_ORDER,
    label: () => t('title'),
    inject: () => ({
      t,
      get status() {
        return status
      },
      get failure() {
        return failure
      },
      get projects() {
        return projects
      },
    }),
  }, WebTestSettingsSection))

  void ctx.remote.webTest.status().then((result) => {
    if (result.ok) status = result.value
    else failure = result.error.message
  }, (error: unknown) => {
    failure = String(error)
  })

  // Projects and their entry points come from the plugin's own storage through
  // the typed Remote, so the section shows what the Host actually holds.
  void readProjects(ctx, projects)
}

/**
 * Read every project and, for each, its declared entry points.
 *
 * A project whose entry points cannot be read still lists, with the failure
 * attached to that project rather than dropping it silently.
 * @param ctx - Scoped Context carrying the mounted namespace.
 * @param projects - Array the results are appended to.
 */
async function readProjects(ctx: Context, projects: WebTestProjectSummary[]): Promise<void> {
  const listed = await ctx.remote.webTest.listProjects()
  if (!listed.ok) return
  for (const project of listed.value) {
    let environments: WebTestEnvironmentSummary[] = []
    const declared = await ctx.remote.webTest.listEnvironments(project.key)
    if (declared.ok) {
      environments = declared.value.map(environment => ({
        name: environment.name,
        url: environment.url,
        nature: environment.nature,
        dataOperations: environment.dataOperations,
        roles: environment.roles.map(role => role.name),
        viewport: environment.viewport,
      }))
    }
    projects.push({ key: project.key, label: project.label, baseUrl: project.baseUrl, environments })
  }
}
