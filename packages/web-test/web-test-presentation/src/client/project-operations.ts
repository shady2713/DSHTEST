/** Project panel adapter; every operation addresses the conversation's sole Commands Remote. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {} from '@deepseek-ai/dsh-web-test-conversation/remote'
import type { ProjectPanelOperations } from './ProjectPanel.tsx'

/**
 * Bind project reads and explicit metadata/HEAD actions to the official Remote.
 * @param ctx - client plugin context injecting the Commands namespace.
 * @returns session-addressed operations; reading never checks URLs or submits business actions.
 */
export function createProjectPanelOperations(ctx: Context): ProjectPanelOperations {
  const remote = ctx.remote.webTestCommands
  return {
    async read(sessionId) {
      const result = await remote.queryStatus({ sessionId, verb: 'query', subject: 'project' })
      if (result.ok) return result.value
      if (result.error.code === 'web-test-conversation/no-project') return null
      throw new Error('project status unavailable')
    },
    async list() {
      const result = await remote.listProjects()
      if (!result.ok) throw new Error('project identities unavailable')
      return result.value
    },
    async register(sessionId, metadata) {
      const result = await remote.registerProject({ sessionId, registration: { ...metadata, commandId: `cmd-${randomUUID()}` } })
      return result.ok
    },
    async attach(sessionId, projectId) {
      return (await remote.attachProject({ sessionId, projectId })).ok
    },
    async update(sessionId, projectId, expectedRevision, metadata) {
      return (await remote.updateProject({ sessionId, projectId, expectedRevision, ...metadata, commandId: `cmd-${randomUUID()}` })).ok
    },
    async probe(sessionId, projectId, expectedRevision, signal) {
      return (await remote.probeEntryUrls({ sessionId, projectId, expectedRevision }, signal)).ok
    },
  }
}
