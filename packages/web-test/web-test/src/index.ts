/**
 * Web testing identity, entry metadata, and the launcher that owns this
 * application's data root. The launcher applies the launch environment before the
 * runtime resolves any path, registers the install, and passes the composition
 * layer to the harness profile boot; a shell still owns the desktop integration
 * that consumes the registered `userData` directory and update channel. A
 * capability declares itself available here rather than through its entry
 * declaration.
 *
 * @module @deepseek-ai/dsh-web-test
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { webTestEntryPoints } from './entry-points.ts'
import type { WebTestConfig, WebTestEntryPoint, WebTestIdentity } from './types.ts'

export type * from './types.ts'
export type { WebTestLocaleKey } from './locales.ts'
export { webTestEntryPoints } from './entry-points.ts'
export * from './application.ts'
export * from './launcher.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTest: WebTest
  }
}

/**
 * Application metadata; a declared entry stays unavailable until a mounted capability
 * records it, and this service never registers a control on its own.
 */
export class WebTest extends Service {
  /** This application's resolved configuration, defaulted so an empty config still loads. */
  readonly config: WebTestConfig

  static Config: z<WebTestConfig> = z.object({
    /** Application identity; distinct from the official product so both may be installed. */
    applicationId: z.string().default('dsh-web-test'),
    /** Intended data-root label; the launcher owns filesystem isolation. */
    dataRootName: z.string().default('web-test'),
    /** Intended profile label; the launcher selects the running profile. */
    profileName: z.string().default('web-test'),
  })

  private readonly entryPoints: WebTestEntryPoint[] = []
  private readonly provided = new Set<string>()

  constructor(ctx: Context, config: WebTestConfig = {
    applicationId: 'dsh-web-test', dataRootName: 'web-test', profileName: 'web-test',
  }) {
    super(ctx, 'webTest')
    this.config = config
    const { applicationId, dataRootName, profileName } = this.config
    for (const entry of webTestEntryPoints()) {
      this.entryPoints.push({ ...entry, profileName })
    }
    ctx.logger.info(
      `[web-test] loaded for application ${applicationId} (data root ${dataRootName}, profile ${profileName}) `
      + `with ${String(this.entryPoints.length)} entry point(s)`,
    )
  }

  /** Configured identity labels; reading them has no filesystem or installer effects. */
  get identity(): WebTestIdentity {
    const { applicationId, dataRootName, profileName } = this.config
    return { applicationId, dataRootName, profileName }
  }

  /**
   * List declared entries, including those without backing capabilities.
   * @returns entry metadata; listing an entry does not establish availability.
   */
  listEntryPoints(): readonly WebTestEntryPoint[] {
    return this.entryPoints
  }

  /**
   * Whether an entry point is currently provided, so the Client can show an action as
   * unavailable instead of offering a control with no backend behind it.
   * @param id - stable entry-point identity.
   * @returns true when this assembly provides it.
   */
  provides(id: string): boolean {
    return this.provided.has(id)
  }

  /**
   * Record that this assembly backs one declared entry point, so a Client reads the
   * capability as available for exactly the lifetime of the contribution that provides it.
   * @param id - stable entry-point identity; an undeclared id is a composition error.
   * @returns the effect disposer that withdraws the availability.
   */
  mount(id: string): () => Promise<void> {
    if (!this.entryPoints.some(entry => entry.id === id)) {
      throw new Error(`web-test: entry point ${JSON.stringify(id)} is not declared`)
    }
    return this.ctx.effect(() => {
      this.provided.add(id)
      return () => { this.provided.delete(id) }
    }, 'webTest.mount()')
  }
}

export default WebTest
