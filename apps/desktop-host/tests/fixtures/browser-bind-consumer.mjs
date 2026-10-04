/**
 * Test-only trusted binding consumer loaded by the actual Desktop profile.
 * Each operator request has a unique identifier; its response is atomically
 * published once at responsePath + '.' + requestId. Model tools cannot write
 * this channel through the consumer or choose a target implicitly.
 */
import { randomUUID } from 'node:crypto'
import { watch } from 'node:fs'
import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute } from 'node:path'
import { SessionId } from '../../../../packages/core/session/lib/index.js'

export const name = 'web-test-calibration-binding'
export const inject = ['sessions', 'sessionController']

/** @param ctx - actual Host context. @param config - operator-owned local file channel. */
export function apply(ctx, config) {
  for (const key of ['requestPath', 'responsePath']) {
    if (typeof config[key] !== 'string' || !isAbsolute(config[key])) throw new Error('calibration binding: absolute file paths required')
  }
  if (config.requestPath === config.responsePath) throw new Error('calibration binding: request and response files must differ')
  const permittedOrigin = new URL(config.origin).origin
  if (!['http:', 'https:'].includes(new URL(config.origin).protocol)) throw new Error('calibration binding: HTTP(S) origin required')
  ctx.inject(['desktopBrowserControl'], (host) => {
    host.effect(() => {
      let stopping = false
      let lastRequestId
      let tail = Promise.resolve()
      const respond = async (result) => {
        const response = config.responsePath + '.' + result.requestId
        const temporary = response + '.' + randomUUID()
        await writeFile(temporary, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
        try { await rename(temporary, response) }
        catch (error) { await unlink(temporary); throw error }
      }
      const readRequest = async () => {
        const request = JSON.parse(await readFile(config.requestPath, 'utf8'))
        if (typeof request !== 'object' || request === null || typeof request.requestId !== 'string'
          || !/^[A-Za-z0-9_-]{1,80}$/u.test(request.requestId) || !['list', 'bind', 'unbind', 'create-session'].includes(request.kind)) {
          throw new Error('calibration binding: invalid operator request')
        }
        if (request.requestId === lastRequestId || stopping) return
        try { await access(config.responsePath + '.' + request.requestId); return }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        lastRequestId = request.requestId
        const control = host.desktopBrowserControl
        try {
          if (request.kind === 'list') {
            await respond({ requestId: request.requestId, status: 'ready', targets: control.targets(),
              ...(typeof request.sessionId === 'string' ? { binding: control.binding(SessionId(request.sessionId)) ?? null } : {}) })
            return
          }
          if (typeof request.sessionId !== 'string' || request.sessionId.length === 0) throw new Error('an explicit Session ID is required')
          const sessionId = SessionId(request.sessionId)
          if (request.kind === 'create-session') {
            if (host.sessions.get(sessionId) !== undefined) throw new Error('the selected Session already exists')
            if (request.cwd !== undefined && (typeof request.cwd !== 'string' || !isAbsolute(request.cwd))) throw new Error('an explicit workspace directory must be absolute')
            if (request.agentPreset !== undefined && (typeof request.agentPreset !== 'string' || request.agentPreset.length === 0)) throw new Error('an explicit preset must be a nonempty ID')
            const created = await host.sessionController.create({ sessionId,
              ...typeof request.cwd === 'string' ? { cwd: request.cwd } : {},
              ...typeof request.agentPreset === 'string' ? { agentPreset: request.agentPreset } : {} })
            await respond({ requestId: request.requestId, status: 'session-created', ...created })
            return
          }
          if (request.kind === 'unbind') {
            await control.unbind(sessionId)
            await respond({ requestId: request.requestId, status: 'unbound', sessionId })
            return
          }
          if (typeof request.target !== 'string') throw new Error('an explicit Main target is required')
          const target = control.targets().find(item => item.target === request.target)
          if (target === undefined || new URL(target.url).origin !== permittedOrigin) throw new Error('selected Main target is unavailable or outside calibration origin')
          const binding = await control.bind(sessionId, target.target)
          await respond({ requestId: request.requestId, status: 'bound', binding })
        } catch (error) {
          await respond({ requestId: request.requestId, status: 'rejected', error: error instanceof Error ? error.message : 'binding failed' })
        }
      }
      const schedule = () => {
        if (stopping) return
        tail = tail.then(readRequest).catch((error) => { host.logger.warn(`calibration binding: ${error.message}`) })
      }
      const watcher = watch(dirname(config.requestPath), (_kind, filename) => {
        if (filename === basename(config.requestPath)) schedule()
      })
      schedule()
      return async () => {
        stopping = true
        const closed = new Promise(resolve => watcher.once('close', resolve))
        watcher.close()
        await closed
        await tail
      }
    }, 'calibration-binding.file-channel')
  })
}
