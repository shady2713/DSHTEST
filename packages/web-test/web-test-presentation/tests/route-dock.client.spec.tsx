// @vitest-environment jsdom
/**
 * The strip's presentation behaviour, driven by snapshots the Host half could
 * produce. These assertions are about what a user reads, not about class names.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { RouteStatus } from '../src/client/RouteDock.tsx'
import { zh } from '../src/client/locales.ts'
import type { TaskRouteState } from '../src/types.ts'

const t = makeTranslate(zh, commonZh)

afterEach(cleanup)

function row(over: Partial<TaskRouteState> = {}): TaskRouteState {
  return {
    taskType: 'analysis',
    state: 'ready',
    detail: null,
    provider: 'deepseek',
    model: 'deepseek-chat',
    ...over,
  }
}

describe('RouteStatus', () => {
  it('says it is checking rather than showing an empty route list', () => {
    render(<RouteStatus phase="loading" refresh={() => {}} t={t} />)
    expect(screen.getByText('正在检查路线…')).toBeTruthy()
  })

  it('names the provider and model a ready task type runs on', () => {
    render(<RouteStatus phase="loaded" entries={[row()]} refresh={() => {}} t={t} />)
    expect(screen.getByText('分析')).toBeTruthy()
    expect(screen.getByText('就绪')).toBeTruthy()
    expect(screen.getByText('deepseek/deepseek-chat')).toBeTruthy()
  })

  it('keeps a not-ready task type visible with the provider own explanation', () => {
    render(<RouteStatus
      phase="loaded"
      entries={[row({ taskType: 'vision', state: 'refused-modality', detail: 'no image input declared', provider: null, model: null })]}
      refresh={() => {}}
      t={t}
    />)
    expect(screen.getByText('视觉')).toBeTruthy()
    expect(screen.getByText('缺少所需模态')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('no image input declared')
  })

  it('separates a refused key from an unavailable model, because the fixes differ', () => {
    render(<RouteStatus
      phase="loaded"
      entries={[
        row({ taskType: 'analysis', state: 'bad-credential', detail: 'invalid api key' }),
        row({ taskType: 'auxiliary', state: 'refused-model', detail: 'model not served' }),
      ]}
      refresh={() => {}}
      t={t}
    />)
    expect(screen.getByText('密钥被拒绝')).toBeTruthy()
    expect(screen.getByText('模型不可用')).toBeTruthy()
  })

  it('reports an unreadable route state instead of claiming every task is fine', () => {
    render(<RouteStatus phase="unavailable" detail="gateway/internal" refresh={() => {}} t={t} />)
    expect(screen.getByText('无法读取路线状态')).toBeTruthy()
    expect(screen.getByText('gateway/internal')).toBeTruthy()
  })

  it('re-checks the route state on request', () => {
    const refresh = vi.fn()
    render(<RouteStatus phase="loaded" entries={[row()]} refresh={refresh} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('offers the re-check even when the route state could not be read', () => {
    const refresh = vi.fn()
    render(<RouteStatus phase="unavailable" detail="gateway/internal" refresh={refresh} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
