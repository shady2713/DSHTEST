/**
 * Browser lifecycle for model and project configuration: mount the presentation
 * and shared Commands Remotes, then register the conversation dock and durable tool cards.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the generated Remote's namespace declaration for `ctx.remote`.
import type {} from '@deepseek-ai/dsh-web-test-presentation/remote'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { createModelConfigurationOperations } from './configuration-operations.ts'
import { createProjectPanelOperations } from './project-operations.ts'
import { ProjectToolCard } from './ProjectToolCard.tsx'
import { RouteDock } from './RouteDock.tsx'
import { en, NS, zh, type RouteStatusKey } from './locales.ts'
import type { RouteStateRead, RouteStatusInjected, RouteStatusSnapshot } from './slots.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'web-test-presentation': RouteStatusKey
  }
}

/** Services the strip needs: its own Remote namespace, the slot registry, and copy. */
export const inject = ['remote.webTestPresentation', 'remote.webTestCommands', 'remote.settings', 'remote.credentials', 'slots', 'locale']

/** A route-state source plus the re-check the strip's button drives. */
export interface RouteStatusSource extends HostObservable<RouteStatusSnapshot> {
  /** Read the route state again. */
  reload: () => void
}

/**
 * Create the strip's route-state source.
 *
 * The source subscribes only while a framework hook observes it, so unmounting
 * the dock releases the Remote read. A read that answers after a newer read
 * started is dropped, so a slow answer cannot overwrite a newer one.
 * @param read - the Remote read this strip performs.
 * @returns a stable snapshot source the renderer binds to a hook.
 */
export function createRouteStatusSource(read: RouteStateRead): RouteStatusSource {
  let snapshot: RouteStatusSnapshot = { phase: 'loading' }
  let subscriptions = 0
  let readEpoch = 0
  const listeners = new Set<() => void>()

  const publish = (next: RouteStatusSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const reload = (): void => {
    const current = ++readEpoch
    if (snapshot.phase !== 'loading') publish({ phase: 'loading' })
    void read().then((result) => {
      if (current !== readEpoch) return
      publish(result.ok
        ? { phase: 'loaded', entries: result.response.entries }
        : { phase: 'unavailable', detail: result.detail })
    })
  }

  return {
    reload,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      if (subscriptions === 0) reload()
      subscriptions++
      return () => {
        listeners.delete(listener)
        subscriptions--
        // A read still in flight would otherwise publish into a dead source.
        if (subscriptions === 0) readEpoch++
      }
    },
  }
}

/** Register the strip's dictionaries and its single dock entry. */
function registerStrip(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-test-presentation: dictionaries')
  const source = createRouteStatusSource(async () => {
    const result = await ctx.remote.webTestPresentation.routeState()
    return result.ok
      ? { ok: true, response: result.value }
      : { ok: false, detail: '' }
  })
  const actions: RouteStatusInjected = {
    hooks: { routeStatus: source },
    configure: createModelConfigurationOperations(ctx),
    projects: createProjectPanelOperations(ctx),
    refresh: () => { source.reload() },
  }
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'web-test-presentation',
    order: 20,
    locale: NS,
    inject: (): RouteStatusInjected => actions,
  }, RouteDock))
  for (const key of [
    'web_test_query', 'web_test_register_project', 'web_test_update_project', 'web_test_attach',
    'web_test_declare_environment', 'web_test_probe_entry_urls', 'web_test_action',
  ]) ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key, locale: NS,
  }, ProjectToolCard))
}

/**
 * Mount this package's Remote contribution and its dock entry.
 * @param ctx - Client runtime owning the Remote, slots, and dictionaries.
 * @param contribution - this package's generated Remote definitions.
 * @param commands - generated definitions of the shared conversation Commands Remote.
 * @returns disposer joining the strip registration and the Remote withdrawal.
 */
export async function mountWebTestPresentation(
  ctx: Context,
  contribution: TypertRemoteContribution,
  commands?: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  let disposeCommands: (() => Promise<void>) | undefined
  try {
    disposeCommands = commands === undefined ? undefined : await ctx.remote.$mount(commands)
  } catch (error) {
    await disposeRemote()
    throw error
  }
  const ui = ctx.inject(inject, registerStrip)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    await disposeCommands?.()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
    await disposeCommands?.()
  }
}
