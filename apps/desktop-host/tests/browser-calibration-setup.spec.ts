/** Trusted preconditions use explicit Workspace adoption and retain the selected Agent. */
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import { prepare } from './fixtures/browser-calibration-setup.mjs'

const cwd = resolve('operator-workspace')
const sourceRoot = resolve('public-source')
const responsePath = resolve('calibration-setup.json')

it('adopts the real Workspace before registering and granting the bounded public calibration project', async () => {
  const ctx = new Context()
  const calls: string[] = []
  const selected = { session: { id: 'selected' } }
  const workspace = { id: 'workspace-id', path: cwd, sessionIds: [] as string[] }
  ctx.provide('agents', { get: () => selected } as never)
  ctx.provide('workspaceRegistry', { list: () => [workspace] } as never)
  ctx.provide('sessionController', { create: async (request: object) => {
    expect(request).toEqual({ sessionId: 'selected', workspaceId: workspace.id })
    workspace.sessionIds.push('selected'); calls.push('adopt'); return { sessionId: 'selected', agentPreset: 'standard' }
  } } as never)
  ctx.provide('webTestRuntime', { registerProject: async (request: object) => {
    expect(request).toMatchObject({ codeRoots: [sourceRoot] }); calls.push('register'); return { resourceId: 'project' }
  } } as never)
  ctx.provide('webTestCommands', { attachProject: async (request: object) => {
    expect(request).toEqual({ sessionId: 'selected', projectId: 'project' }); calls.push('attach')
  }, declareEnvironment: async (request: object) => {
    expect(request).toMatchObject({ sessionId: 'selected', declaration: { codeRoots: [sourceRoot] } })
    calls.push('declare')
  } } as never)
  ctx.provide('webTestPolicy', {
    grantFlow: (request: object) => { calls.push('grant'); expect(request).toMatchObject({ sessionId: 'selected', actions: 30, thirdParty: false }); return { ...request, declarationId: 'decl' } },
  } as never)
  expect(await prepare(ctx, { sessionId: 'selected', cwd: workspace.path, sourceRoot, responsePath,
    entryUrls: ['http://127.0.0.1:18771/app/list?role=role-a', 'http://127.0.0.1:18771/app/list?role=role-b'], commandId: 'calibration', actions: 30 }))
    .toMatchObject({ status: 'prepared', projectId: 'project', humanConfirmationAcceptance: false })
  expect(calls).toEqual(['adopt', 'register', 'attach', 'declare', 'grant'])
  await ctx.fiber.dispose()
})

it('rejects an unavailable actual Agent before creating a Session or publishing a project', async () => {
  const ctx = new Context()
  ctx.provide('agents', { get: () => undefined } as never)
  await expect(prepare(ctx, { sessionId: 'absent', cwd, sourceRoot, responsePath,
    entryUrls: ['http://127.0.0.1:18771/app/list?role=role-a', 'http://127.0.0.1:18771/app/list?role=role-b'], commandId: 'calibration', actions: 30 }))
    .rejects.toThrow('actual Agent must already exist')
  await ctx.fiber.dispose()
})
