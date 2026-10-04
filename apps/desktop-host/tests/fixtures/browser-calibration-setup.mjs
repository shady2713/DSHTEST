/** Trusted test preconditions for one actual Session; this contribution exposes no tool or model entry. */
import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { SessionId } from '../../../../packages/core/session/lib/index.js'

export const name = 'web-test-calibration-setup'
export const inject = ['sessionController', 'workspaceRegistry', 'webTestRuntime', 'webTestCommands', 'webTestPolicy', 'agents']

/**
 * Adopt the matching actual Workspace and grant only the explicit calibration project to its existing Session.
 * @param ctx - actual Host context supplying the shipped services.
 * @param config - operator-owned Session, Workspace path, public source root, URLs, grant and evidence path.
 * @param report - optional test-only preparation phase observer.
 * @returns preparation evidence with durable project identity and bounded grant.
 */
export async function prepare(ctx, config, report = async () => {}) {
  await report('validating')
  if (typeof config.sessionId !== 'string' || !config.sessionId || ![config.cwd, config.sourceRoot, config.responsePath].every(isAbsolute)) {
    throw new Error('calibration setup: explicit Session and absolute paths required')
  }
  if (!Array.isArray(config.entryUrls) || config.entryUrls.length !== 2
    || config.entryUrls.some(url => new URL(url).origin !== 'http://127.0.0.1:18771')) throw new Error('calibration setup: exactly two public calibration URLs required')
  if (typeof config.commandId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(config.commandId)
    || !Number.isSafeInteger(config.actions) || config.actions < 1 || config.actions > 50) throw new Error('calibration setup: bounded grant and explicit command ID required')
  const sessionId = SessionId(config.sessionId)
  const before = ctx.agents.get(sessionId)
  if (before === undefined) throw new Error('calibration setup: the selected actual Agent must already exist')
  const workspace = ctx.workspaceRegistry.list().find(item => item.path === config.cwd)
  if (workspace === undefined) throw new Error('calibration setup: actual Workspace is unavailable')
  await report('adopting-workspace')
  const adopted = await ctx.sessionController.create({ sessionId, workspaceId: workspace.id })
  if (ctx.agents.get(sessionId) !== before || !workspace.sessionIds.includes(sessionId)) throw new Error('calibration setup: adoption changed Agent or failed Workspace attachment')
  await report('registering-public-project')
  const receipt = await ctx.webTestRuntime.registerProject({ commandId: config.commandId,
    codeRoots: [config.sourceRoot], entryUrls: config.entryUrls })
  await report('attaching-project')
  await ctx.webTestCommands.attachProject({ sessionId, projectId: receipt.resourceId })
  await report('declaring-and-granting')
  await ctx.webTestCommands.declareEnvironment({ sessionId, commandId: config.commandId + '-declaration',
    declaration: { codeRoots: [config.sourceRoot], entryUrl: config.entryUrls[0], isTestEnvironment: true,
      login: { state: 'required', accountLabel: 'public fixture role-a and role-b' }, supplementaryRequirements: ['One create submission and one approval; read-only verification before retry'] } })
  const grant = ctx.webTestPolicy.grantFlow({ sessionId, flowId: config.commandId, flowRevision: 1, thirdParty: false, actions: config.actions })
  return { status: 'prepared', sessionId, agentPreset: adopted.agentPreset, workspaceId: workspace.id, cwd: workspace.path,
    projectId: receipt.resourceId, declarationId: grant.declarationId, sourceRoot: config.sourceRoot,
    entryUrls: config.entryUrls, grant, humanConfirmationAcceptance: false }
}

/**
 * Publish the bounded preparation result once without creating a browser owner.
 * @param ctx - actual Host context.
 * @param config - trusted calibration preparation inputs.
 */
export function apply(ctx, config) {
  ctx.effect(() => {
    const pending = prepare(ctx, config, phase => writeFile(config.responsePath + '.phase', JSON.stringify({ phase }) + '\n'))
      .then(result => writeFile(config.responsePath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 }))
      .catch(async error => {
        ctx.logger.warn(`calibration setup: ${error.message}`)
        await writeFile(config.responsePath + '.failed', JSON.stringify({ status: 'failed',
          code: typeof error.code === 'string' ? error.code : 'setup-failed', reason: error.message }) + '\n', { flag: 'wx', mode: 0o600 })
      })
    return async () => { await pending }
  }, 'calibration-setup.prepare')
}
