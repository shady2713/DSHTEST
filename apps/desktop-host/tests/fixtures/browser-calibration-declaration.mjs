/** Trusted calibration declaration through the shipped conversation consumer and its policy. */
import { writeFile } from 'node:fs/promises'
export const name = 'web-test-calibration-declaration'
export const inject = ['webTestCommands', 'webTestPolicy']

/** @param ctx - actual Host context. @param config - explicit calibration environment and Session. */
export function apply(ctx, config) {
  ctx.effect(() => {
    const pending = (async () => {
      await ctx.webTestCommands.declareEnvironment({ sessionId: config.sessionId, commandId: config.commandId + '-declaration',
        declaration: { codeRoots: [config.sourceRoot], entryUrl: config.entryUrls[0], isTestEnvironment: true,
          login: { state: 'required', accountLabel: 'public fixture role-a and role-b' }, supplementaryRequirements: ['One create submission and one approval; read-only verification before retry'] } })
      const grant = ctx.webTestPolicy.grantFlow({ sessionId: config.sessionId, flowId: config.commandId, flowRevision: 1, thirdParty: false, actions: config.actions })
      await writeFile(config.responsePath, JSON.stringify({ status: 'declared', grant, humanConfirmationAcceptance: false }, null, 2) + '\n')
    })().catch(async error => { await writeFile(config.responsePath + '.failed', JSON.stringify({ code: error.code ?? 'declaration-failed', reason: error.message }) + '\n') })
    return async () => { await pending }
  }, 'calibration-declaration.prepare')
}
