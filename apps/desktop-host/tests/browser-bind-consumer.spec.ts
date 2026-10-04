/** Operator file requests bind actual Sessions without model-owned target selection. */
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { DesktopBrowserControl } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import type { DesktopBrowserBinding, DesktopBrowserCommandBody, DesktopBrowserCommandResult,
  DesktopBrowserTargetId, DesktopBrowserWorkspaceKey } from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import * as Consumer from './fixtures/browser-bind-consumer.mjs'

const OWNER = SessionId('operator-selected-session')
const TARGET = 'main-user-guest' as DesktopBrowserTargetId
const ORIGIN = 'http://127.0.0.1:18771'
let ctx: Context
let root: string
let requestPath: string
let responsePath: string
let bound: SessionId[]
let creations: object[]
class FixtureControl extends DesktopBrowserControl {
  private bindingValue: DesktopBrowserBinding | undefined
  targets() { return [{ target: TARGET, hostEpoch: 7, workspace: 'session:operator-selected-session' as DesktopBrowserWorkspaceKey, url: ORIGIN + '/test' }] }
  async bind(sessionId: SessionId, target: DesktopBrowserTargetId) {
    if (this.ctx.get('sessions')?.get(sessionId) === undefined || target !== TARGET) throw new Error('missing actual Session or Main target')
    bound.push(sessionId)
    return this.bindingValue = { ...this.targets()[0]!, sessionId }
  }
  async unbind(sessionId: SessionId) { if (this.bindingValue?.sessionId === sessionId) this.bindingValue = undefined }
  binding(sessionId: SessionId) { return this.bindingValue?.sessionId === sessionId ? this.bindingValue : undefined }
  async submit(_sessionId: SessionId, _body: DesktopBrowserCommandBody): Promise<DesktopBrowserCommandResult> { throw new Error('binding consumer cannot submit commands') }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'desktop-binding-consumer-'))
  requestPath = join(root, 'request.json')
  responsePath = join(root, 'response.json')
  await writeFile(requestPath, JSON.stringify({ requestId: 'initial', kind: 'list' }))
  ctx = new Context()
  await ctx.plugin(SessionStore)
  ctx.sessions.create(OWNER)
  creations = []
  ctx.provide('sessionController', { create: async (request: { sessionId: SessionId }) => {
    creations.push(request)
    ctx.sessions.create(request.sessionId)
    return { sessionId: request.sessionId, agentPreset: 'configured-default' }
  } } as never)
  bound = []
  await ctx.plugin(FixtureControl)
  await ctx.plugin(Consumer, { requestPath, responsePath, origin: ORIGIN })
})
afterEach(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true }) })

async function request(value: object): Promise<Record<string, unknown>> {
  const expected = value as { requestId: string }
  const staged = join(root, 'next-request.json')
  await writeFile(staged, JSON.stringify(value))
  await rename(staged, requestPath)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      const response = JSON.parse(await readFile(responsePath + '.' + expected.requestId, 'utf8')) as Record<string, unknown>
      if (response.requestId === expected.requestId) return response
    } catch (_error) { /* The first response may not be published yet. */ }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('operator binding response did not arrive')
}

it('lists targets without binding and accepts only an explicitly selected existing Session and Main target', { timeout: 10000 }, async () => {
  const listed = await request({ requestId: 'list', kind: 'list' })
  expect(listed.status).toBe('ready')
  expect(bound).toEqual([])
  const result = await request({ requestId: 'bind', kind: 'bind', sessionId: OWNER, target: TARGET })
  expect(result, String(result.error)).toMatchObject({ status: 'bound', binding: { sessionId: OWNER, target: TARGET } })
  expect(bound).toEqual([OWNER])
  const unbound = await request({ requestId: 'unbind', kind: 'unbind', sessionId: OWNER })
  expect(unbound.status, String(unbound.error)).toBe('unbound')
  expect(ctx.desktopBrowserControl.binding(OWNER)).toBeUndefined()
})

it('rejects missing Sessions and alternative target identities without implicit creation', { timeout: 10000 }, async () => {
  expect(await request({ requestId: 'missing', kind: 'bind', sessionId: 'missing-session', target: TARGET })).toMatchObject({ status: 'rejected' })
  expect(await request({ requestId: 'foreign', kind: 'bind', sessionId: OWNER, target: 'another-guest' })).toMatchObject({ status: 'rejected' })
  expect(bound).toEqual([])
  expect(ctx.sessions.get(SessionId('missing-session'))).toBeUndefined()
  expect(creations).toEqual([])
})

it('uses the formal Session controller only for explicit creation and preserves the operator preset request', async () => {
  const created = await request({ requestId: 'create', kind: 'create-session', sessionId: 'new-operator-session', cwd: 'C:/selected/workspace', agentPreset: 'operator-preset' })
  expect(created).toMatchObject({ status: 'session-created', sessionId: 'new-operator-session', agentPreset: 'configured-default' })
  expect(creations).toEqual([{ sessionId: 'new-operator-session', cwd: 'C:/selected/workspace', agentPreset: 'operator-preset' }])
  expect(bound).toEqual([])
  expect(await request({ requestId: 'existing', kind: 'create-session', sessionId: OWNER })).toMatchObject({ status: 'rejected' })
  expect(creations).toHaveLength(1)
})
