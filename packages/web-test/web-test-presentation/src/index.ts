/**
 * Conversation-local first-run model configuration Remote. Directory reads
 * contain provider addresses only; exact-route probes never accept secrets.
 * The Client writes secrets directly through the official credentials Remote.
 * @module @deepseek-ai/dsh-web-test-presentation
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the routing authority's service and domain types. Erased at
// runtime, so this entry never loads the authority's implementation.
import type {} from '@deepseek-ai/dsh-web-test-models'
import { routeStates, type RouteAuthority } from './route-state.ts'
import { ROUTE_TASK_TYPES } from './types.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelConfigurationResponse, ProviderConfiguration, RouteConfigurationOutcome } from './types.ts'
import type { RouteStateResponse } from './types.ts'

export type * from './types.ts'
export { routeStates, type RouteAuthority } from './route-state.ts'

/** Cordis service key and default wire namespace of this surface's Remote. */
export const WEB_TEST_PRESENTATION_NAMESPACE = 'webTestPresentation'

/**
 * The first-run model-configuration Remote.
 *
 * A browser half mounts this package's generated contribution and then reads
 * {@link routeState}; the authority's own service carries the routing decision.
 */
export class WebTestPresentation extends TypertRemoteService {
  static inject = ['webTestModels']

  /**
   * @param ctx - Host context carrying the model-configuration authority.
   */
  constructor(ctx: Context) {
    // The literal, not {@link WEB_TEST_PRESENTATION_NAMESPACE}: the Typert
    // analyzer reads the gateway service key from the syntax tree and rejects
    // anything but a string literal there. The two must name the same service.
    super(ctx, 'webTestPresentation')
  }

  /**
   * List official provider configuration addresses for the conversation form.
   * @returns provider and model identities with independent directory availability; secrets are never read.
   */
  @Remote('configuration')
  async configuration(): Promise<ModelConfigurationResponse> {
    const authority = this.ctx.webTestModels
    const providers: ProviderConfiguration[] = []
    for (const entry of authority.listProviders()) {
      const credentialRef = authority.references?.forProvider(entry.provider) ?? null
      let models: readonly { id: string }[] = []
      let catalogState: ProviderConfiguration['catalogState'] = 'ready'
      try { models = await authority.listModels(entry.provider) }
      catch (_error: unknown) {
        // A failed directory cannot withhold unrelated providers or expose adapter exceptions.
        catalogState = 'unavailable'
      }
      providers.push({
        provider: entry.provider, settingsNs: entry.settingsNs, settingsPath: [...entry.settingsPath],
        credentialRef, catalogState, models: models.map(model => model.id),
      })
    }
    return { providers }
  }

  /**
   * Verify and persist the user-chosen route without accepting a secret.
   * @param provider - existing provider identity.
   * @param model - exact model to test.
   * @param taskType - analysis, vision, or auxiliary task requirement.
   * @returns safe connection and persistence outcome.
   */
  @Remote('configureRoute')
  async configureRoute(provider: string, model: string, taskType: string): Promise<RouteConfigurationOutcome> {
    if (!provider || !model) throw new RemoteError('gateway/bad-request', 'invalid model route request', {})
    const task = ROUTE_TASK_TYPES.find(kind => kind === taskType)
    if (task === undefined) throw new RemoteError('gateway/bad-request', 'invalid task requirement', {})
    const outcome = await this.ctx.webTestModels.configureRoute(provider, model, task)
    return { ready: outcome.kind === 'ready', detail: outcome.kind === 'ready' ? null : outcome.detail }
  }

  /**
   * Report every task type's route state, in strip order.
   *
   * A task type with no usable route is reported not ready with the reason and
   * a safe closed diagnosis, never substituted with a route that was not
   * verified for it.
   * @returns one row per task type, carrying no credential value.
   */
  @Remote('routeState')
  async routeState(): Promise<RouteStateResponse> {
    return { entries: await routeStates(this.ctx.webTestModels satisfies RouteAuthority) }
  }
}

export default WebTestPresentation
