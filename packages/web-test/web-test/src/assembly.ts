/** Host-owned readiness for the Web testing project and model configuration entry. */
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web-test-policy'
import type {} from '@deepseek-ai/dsh-web-test-models'
import type {} from '@deepseek-ai/dsh-web-test-conversation/commands'
import type {} from './index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTestAssembly: WebTestAssembly
  }
}

/** Application owner of the fixed model image and provided project commands. */
export class WebTestAssembly extends Service {
  static inject = ['webTest', 'webTestPolicy', 'webTestModels', 'webTestCommands', 'attachments']

  /** @param ctx - the application profile that owns these capabilities. */
  constructor(ctx: Context) {
    super(ctx, 'webTestAssembly')
  }

  /** Admit the fixed capability image before publishing project-entry readiness. */
  protected async [Service.init](): Promise<void> {
    const image = await this.ctx.webTestPolicy.createModelProbeImage()
    this.ctx.webTestModels.probeImage = image
    this.ctx.effect(() => () => {
      if (this.ctx.webTestModels.probeImage === image) this.ctx.webTestModels.probeImage = undefined
    }, 'webTestAssembly.modelProbe')
    this.ctx.webTest.mount('web-test.projects')
  }
}

export default WebTestAssembly
