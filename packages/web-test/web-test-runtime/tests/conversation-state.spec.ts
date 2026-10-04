/** Durable session selection and user declarations; reopening never saves permission. */
import { afterEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { SessionId } from '@deepseek-ai/dsh-session'
import { brandNumber } from '@deepseek-ai/dsh-brand'
import type { EnvironmentDeclaration, ProjectId, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import { cleanup, registration, startRuntime, unitBytes } from './harness.ts'

afterEach(cleanup)

const declaration: EnvironmentDeclaration = {
  codeRoots: ['C:\\projects\\shop'],
  entryUrl: 'http://localhost:3000/checkout',
  isTestEnvironment: true,
  login: { state: 'required', accountLabel: 'test-account' },
  supplementaryRequirements: ['Preserve the submitted amount'],
}

describe.skipIf(process.platform !== 'win32')('durable conversation metadata', () => {
  it('refuses a saved association that names another session without changing stored bytes', async () => {
    const first = await startRuntime()
    try {
      const receipt = await first.runtime.registerProject(registration('cmd-session-record-mismatch'))
      await first.runtime.saveSessionProject(SessionId('session-owner'), receipt.resourceId as ProjectId)
    } finally {
      await first.stop()
    }
    const raw = JSON.parse((await unitBytes(first))!.toString()) as {
      tables: { sessions: Record<string, { sessionId: string; projectId: string }> }
    }
    raw.tables.sessions['session-owner']!.sessionId = 'session-other'
    await writeFile(first.unitPath, JSON.stringify(raw))
    const corrupted = await unitBytes(first)
    const reopened = await startRuntime({ controlRoot: first.controlRoot })
    try {
      expect(() => reopened.runtime.readSessionProject(SessionId('session-owner')))
        .toThrow(expect.objectContaining({ code: 'web-test/record-mismatch' }))
      expect(reopened.runtime.readSessionProject(SessionId('session-other'))).toBeUndefined()
      expect(await unitBytes(reopened)).toEqual(corrupted)
    } finally {
      await reopened.stop()
    }
  })

  it('reopens the selected project and user facts while another session stays unassociated', async () => {
    const first = await startRuntime()
    const receipt = await first.runtime.registerProject(registration('cmd-conversation-create'))
    const projectId = receipt.resourceId as ProjectId
    const project = first.runtime.readProject(projectId)!
    await first.runtime.saveSessionProject(SessionId('session-owner'), projectId)
    await first.runtime.saveEnvironment(projectId, declaration, project.revision)
    const bytes = await unitBytes(first)
    await first.stop()
    const reopened = await startRuntime({ controlRoot: first.controlRoot })
    try {
      expect(reopened.runtime.readSessionProject(SessionId('session-owner'))).toBe(projectId)
      expect(reopened.runtime.readSessionProject(SessionId('session-other'))).toBeUndefined()
      expect(reopened.runtime.readEnvironment(projectId)).toEqual({ revision: 1, declaration })
      expect(await unitBytes(reopened)).toEqual(bytes)
    } finally {
      await reopened.stop()
    }
  })

  it('refuses a changed revision or undeclared scope before writing any user facts', async () => {
    const harness = await startRuntime()
    try {
      const receipt = await harness.runtime.registerProject(registration('cmd-conversation-scope'))
      const projectId = receipt.resourceId as ProjectId
      const project = harness.runtime.readProject(projectId)!
      const before = await unitBytes(harness)
      await expect(harness.runtime.saveEnvironment(projectId, declaration, brandNumber<Revision>(2)))
        .rejects.toMatchObject({ code: 'web-test/stale-revision' })
      await expect(harness.runtime.saveEnvironment(projectId, { ...declaration, codeRoots: ['C:\\private'] }, project.revision))
        .rejects.toMatchObject({ code: 'web-test/record-mismatch' })
      await expect(harness.runtime.saveEnvironment(projectId, { ...declaration, entryUrl: 'https://unrelated.test' }, project.revision))
        .rejects.toMatchObject({ code: 'web-test/record-mismatch' })
      expect(harness.runtime.readEnvironment(projectId)).toBeUndefined()
      expect(await unitBytes(harness)).toEqual(before)
    } finally {
      await harness.stop()
    }
  })

  it('keeps saved requirements independent of the caller and of returned copies', async () => {
    const harness = await startRuntime()
    try {
      const receipt = await harness.runtime.registerProject(registration('cmd-conversation-owned'))
      const projectId = receipt.resourceId as ProjectId
      const project = harness.runtime.readProject(projectId)!
      const input = structuredClone(declaration)
      await harness.runtime.saveEnvironment(projectId, input, project.revision)
      input.supplementaryRequirements.length = 0
      const read = harness.runtime.readEnvironment(projectId)!
      read.declaration.codeRoots.length = 0
      read.declaration.supplementaryRequirements.push('Caller mutation')
      expect(harness.runtime.readEnvironment(projectId)).toEqual({ revision: project.revision, declaration })
    } finally {
      await harness.stop()
    }
  })
})
