// @vitest-environment jsdom
/** Actual project forms and durable tool cards use the same session-addressed command consumer. */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ProjectId, Revision } from '@deepseek-ai/dsh-web-test-contracts/ids'
import type { StatusReport } from '@deepseek-ai/dsh-web-test-conversation/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ProjectPanel, type ProjectPanelOperations } from '../src/client/ProjectPanel.tsx'
import { ProjectToolCard } from '../src/client/ProjectToolCard.tsx'
import { createProjectPanelOperations } from '../src/client/project-operations.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const sessionId = SessionId('project-panel-session')
const project = { projectId: brandString<ProjectId>('project-11111111111111111111111111111111'), revision: brandNumber<Revision>(2), codeRoots: ['C:/synthetic/project'], entryUrls: ['http://localhost:3100/current'] }
const report: StatusReport = {
  project, environmentConfirmed: false, environmentDeclarationRevision: brandNumber<Revision>(1),
  environmentDeclaration: { codeRoots: project.codeRoots, entryUrl: 'http://localhost:3100/old', isTestEnvironment: true, login: { state: 'required', accountLabel: 'synthetic-account' }, supplementaryRequirements: ['Read only'] },
  entryUrlProbe: { projectId: project.projectId, revision: brandNumber<Revision>(1), checkedAt: '2026-10-01T00:00:00Z', entryUrls: [{ declared: 'http://localhost:3100/old', state: 'response', statusCode: 404 }] },
  material: { project, codeRoots: [], entryUrls: [], complete: false }, commands: [],
}
const t = makeTranslate(zh)

function operations(overrides: Partial<ProjectPanelOperations> = {}) {
  return {
    read: vi.fn(async () => report), list: vi.fn(async () => [{ projectId: project.projectId, revision: project.revision }]),
    register: vi.fn(async () => true), attach: vi.fn(async () => true), update: vi.fn(async () => true), probe: vi.fn(async () => true),
    ...overrides,
  }
}

it('shows declaration and HEAD revision separately, and reads saved facts without probing or granting confirmation', async () => {
  const api = operations()
  const view = render(<ProjectPanel sessionId={sessionId} running={false} operations={api} t={t} />)
  expect(view.queryByText('此会话尚未关联测试项目')).toBeNull()
  await waitFor(() =>{  expect(view.getByText('当前版本尚未确认环境')).toBeTruthy() })
  expect(view.getAllByText(/属于旧版本，需要重新确认或检查/u)).toHaveLength(2)
  expect(view.getByText(/synthetic-account/u)).toBeTruthy()
  expect(view.getByText(/HTTP 状态 404/u)).toBeTruthy()
  expect(api.probe).not.toHaveBeenCalled()
  expect(api.update).not.toHaveBeenCalled()
})

it('saves explicit URL correction for the displayed revision and keeps committed data after refresh', async () => {
  let saved = report
  const update = vi.fn<ProjectPanelOperations['update']>(async (_sessionId, projectId, revision, metadata) => {
    expect(projectId).toBe(project.projectId)
    expect(revision).toBe(2)
    saved = { ...report, project: { ...project, revision: brandNumber<Revision>(3), ...metadata } }
    return true
  })
  const api = operations({ read: async () => saved, update })
  const view = render(<ProjectPanel sessionId={sessionId} running={false} operations={api} t={t} />)
  await waitFor(() =>{  expect(view.getByRole('textbox', { name: '已启动入口 URL（每行一个）' }).getAttribute('disabled')).toBeNull() })
  fireEvent.change(view.getByRole('textbox', { name: '已启动入口 URL（每行一个）' }), { target: { value: 'http://localhost:3200/corrected' } })
  fireEvent.click(view.getByRole('button', { name: '保存当前项目修正' }))
  await waitFor(() =>{  expect(update).toHaveBeenCalledWith(sessionId, project.projectId, project.revision, { codeRoots: project.codeRoots, entryUrls: ['http://localhost:3200/corrected'] }) })
  await waitFor(() =>{  expect(view.getByText(/版本 3/u)).toBeTruthy() })
  expect((view.getByRole('textbox', { name: '已启动入口 URL（每行一个）' }) as HTMLTextAreaElement).value).toBe('http://localhost:3200/corrected')
})

it('retains current facts when a correction fails and exposes explicit probe cancellation', async () => {
  const api = operations({
    update: async () => false,
    probe: async (_id, _projectId, _revision, signal) => await new Promise((resolve) => {
      signal.addEventListener('abort', () => { resolve(true) }, { once: true })
    }),
  })
  const view = render(<ProjectPanel sessionId={sessionId} running={false} operations={api} t={t} />)
  await waitFor(() =>{  expect(view.getByText(/HTTP 状态 404/u)).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: '保存当前项目修正' }))
  await waitFor(() =>{  expect(view.getByRole('alert')).toBeTruthy() })
  expect(view.getByText(/HTTP 状态 404/u)).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '显式检查入口 URL' }))
  fireEvent.click(view.getByRole('button', { name: '取消 URL 检查' }))
  await waitFor(() =>{  expect(view.queryByRole('button', { name: '取消 URL 检查' })).toBeNull() })
})

it('clears project facts when another ordinary Session is selected instead of borrowing the previous project', async () => {
  const api = operations({ read: async id => id === sessionId ? report : null })
  const view = render(<ProjectPanel key={sessionId} sessionId={sessionId} running={false} operations={api} t={t} />)
  await waitFor(() =>{  expect(view.getByText(/synthetic-account/u)).toBeTruthy() })
  const ordinary = SessionId('ordinary-session')
  view.rerender(<ProjectPanel key={ordinary} sessionId={ordinary} running={false} operations={api} t={t} />)
  await waitFor(() =>{  expect(view.getByText('此会话尚未关联测试项目')).toBeTruthy() })
  expect(view.queryByText(/synthetic-account/u)).toBeNull()
  expect(view.queryByText(project.entryUrls[0]!)).toBeNull()
})

it('calls only the generated Commands namespace with the selected Session and explicit revision', async () => {
  const ctx = new Context()
  class Remote extends Service { constructor() { super(ctx, 'remote') } }
  new Remote()
  const queryStatus = vi.fn(async () => ({ ok: true, value: report }))
  const updateProject = vi.fn(async () => ({ ok: true, value: project }))
  const probeEntryUrls = vi.fn(async () => ({ ok: true, value: report.entryUrlProbe }))
  ctx.provide('remote.webTestCommands', { queryStatus, updateProject, probeEntryUrls })
  const api = createProjectPanelOperations(ctx)
  expect(await api.read(sessionId)).toBe(report)
  expect(queryStatus).toHaveBeenCalledWith({ sessionId, verb: 'query', subject: 'project' })
  expect(probeEntryUrls).not.toHaveBeenCalled()
  await api.update(sessionId, project.projectId, project.revision, { codeRoots: project.codeRoots, entryUrls: project.entryUrls })
  expect(updateProject).toHaveBeenCalledWith(expect.objectContaining({
    sessionId, projectId: project.projectId, expectedRevision: project.revision, codeRoots: project.codeRoots, entryUrls: project.entryUrls,
  }))
  await ctx.fiber.dispose()
})

it('renders a durable project card from logged facts without querying the live Remote', () => {
  type CardProps = Parameters<typeof ProjectToolCard>[0]
  const props: CardProps = {
    phase: 'result', block: { kind: 'tool-result', seq: 3, time: 3000, callId: 'project-call', call: { name: 'web_test_query', argsRaw: '{"subject":"project"}' }, callTime: 2000, content: [{ type: 'text', text: JSON.stringify(report) }], isError: false, subCalls: [] },
    t,
  }
  const view = render(<ProjectToolCard {...props} />)
  expect(view.getByText(/synthetic-account/u)).toBeTruthy()
  expect(view.getByText(/HTTP 状态 404/u)).toBeTruthy()
  expect(view.getAllByText(/属于旧版本，需要重新确认或检查/u)).toHaveLength(2)
})
