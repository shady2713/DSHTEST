/** Test-only operator driver through the actual Agent and ToolRuntime. It never creates or binds a Session. */
import { randomUUID } from 'node:crypto'
import { watch } from 'node:fs'
import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute } from 'node:path'
import { SessionId } from '../../../../packages/core/session/lib/index.js'
import { ToolCallId } from '../../../../packages/llm/llm/lib/types/brand.js'

export const name = 'web-test-calibration-tools'
export const inject = ['agents', 'tools']
const permittedTools = new Set(['web_browser_observe', 'web_browser_screenshot', 'web_browser_click', 'web_browser_type',
  'web_browser_double_click', 'web_browser_press_key', 'web_browser_navigate', 'web_browser_reload'])

/**
 * Execute only the eight browser tools for the configured, already bound actual Agent.
 * @param ctx - actual Host context.
 * @param config - explicit Session, origin and operator-owned request/response paths.
 */
export function apply(ctx, config) {
  if (![config.requestPath, config.responsePath].every(value => typeof value === 'string' && isAbsolute(value))
    || config.requestPath === config.responsePath) throw new Error('calibration tools: distinct absolute paths required')
  if (typeof config.sessionId !== 'string' || config.sessionId.length === 0) throw new Error('calibration tools: explicit Session required')
  const origin = new URL(config.origin)
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('calibration tools: HTTP(S) origin required')
  const sessionId = SessionId(config.sessionId)
  ctx.inject(['desktopBrowserControl'], host => {
    host.effect(() => {
      const cancellation = new AbortController()
      const seen = new Set()
      let tail = Promise.resolve()
      const respond = async result => {
        const response = config.responsePath + '.' + result.requestId
        const temporary = response + '.' + randomUUID()
        await writeFile(temporary, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
        try { await rename(temporary, response) }
        catch (error) { await unlink(temporary); throw error }
      }
      const execute = async () => {
        const request = JSON.parse(await readFile(config.requestPath, 'utf8'))
        if (request === null || typeof request !== 'object' || typeof request.requestId !== 'string'
          || !/^[A-Za-z0-9_-]{1,80}$/u.test(request.requestId)) throw new Error('calibration tools: invalid request ID')
        if (seen.has(request.requestId) || cancellation.signal.aborted) return
        try { await access(config.responsePath + '.' + request.requestId); return }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        seen.add(request.requestId)
        try {
          if (request.kind !== 'execute' || !permittedTools.has(request.name)
            || Object.keys(request).some(key => !['requestId', 'kind', 'name', 'arguments'].includes(key))) {
            throw new Error('only the eight browser tools are accepted')
          }
          if (request.arguments === null || typeof request.arguments !== 'object' || Array.isArray(request.arguments)
            || ['target', 'sessionId'].some(key => Object.hasOwn(request.arguments, key))) {
            throw new Error('browser arguments must not choose a target or Session')
          }
          const agent = host.agents.get(sessionId)
          const binding = host.desktopBrowserControl.binding(sessionId)
          if (agent === undefined || agent.session.id !== sessionId || binding === undefined
            || new URL(binding.url).origin !== origin.origin) throw new Error('an actual Agent and explicit origin-matching binding are required')
          const result = await host.tools.execute({ callId: ToolCallId('calibration:' + request.requestId),
            name: request.name, arguments: request.arguments, agent, signal: cancellation.signal })
          await respond({ requestId: request.requestId, status: 'executed', sessionId, target: binding.target,
            hostEpoch: binding.hostEpoch, name: request.name, arguments: request.arguments, result })
        } catch (error) {
          await respond({ requestId: request.requestId, status: 'rejected',
            error: error instanceof Error ? error.message : 'browser tool execution failed' })
        }
      }
      const schedule = () => {
        if (!cancellation.signal.aborted) tail = tail.then(execute).catch(error => { host.logger.warn(`calibration tools: ${error.message}`) })
      }
      const watcher = watch(dirname(config.requestPath), (_kind, filename) => {
        if (filename === basename(config.requestPath)) schedule()
      })
      schedule()
      return async () => {
        cancellation.abort()
        const closed = new Promise(resolve => watcher.once('close', resolve))
        watcher.close()
        await closed
        await tail
      }
    }, 'calibration-tools.file-channel')
  })
}
