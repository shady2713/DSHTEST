/** Conversation dock model status and a write-only first-run configuration form. */

import {
  IconCheckCircleOutlineRegular, IconRefreshOutlineRegular, IconWarningTriangleOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the `conversation.input.dock` slot key and its owner share into
// this program, plus the props shares the dock entry declares.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RouteState, TaskRouteState } from '../types.ts'
import type { RouteStatusInjected, RouteStatusSnapshot } from './slots.ts'
import type { RouteStatusKey } from './locales.ts'
import css from './RouteDock.module.css'
import { ModelConfiguration } from './ModelConfiguration.tsx'
import { ProjectPanel } from './ProjectPanel.tsx'

/** Copy key per reported state; a total record, so a new state cannot render untranslated. */
const STATE_LABELS = {
  'ready': 'state.ready',
  'not-configured': 'state.not-configured',
  'bad-credential': 'state.bad-credential',
  'refused-model': 'state.refused-model',
  'refused-modality': 'state.refused-modality',
  'refused-request': 'state.refused-request',
  'exhausted': 'state.exhausted',
  'transient': 'state.transient',
  'reverify': 'state.reverify',
  'capability-absent': 'state.capability-absent',
} as const satisfies Record<RouteState, RouteStatusKey>

/** Copy key per reported task type. */
const TASK_LABELS = {
  'analysis': 'task.analysis',
  'vision': 'task.vision',
  'auxiliary': 'task.auxiliary',
} as const satisfies Record<TaskRouteState['taskType'], RouteStatusKey>

/** Props of the presentational strip; the dock adapter supplies the rest. */
export type RouteStatusProps = RouteStatusSnapshot & {
  /** Re-read the route state. */
  refresh: () => void
  /** Translate one key of this namespace. */
  t: (key: RouteStatusKey) => string
}

/** One task type's row: what it needs, whether it can run, and where it would run. */
function RouteRow({ entry, t }: { entry: TaskRouteState; t: RouteStatusProps['t'] }) {
  const ready = entry.state === 'ready'
  const route = entry.provider === null || entry.model === null
    ? null
    : `${entry.provider}/${entry.model}`
  return (
    <li className={css.row} data-route-state={entry.state}>
      <span className={css.task}>{t(TASK_LABELS[entry.taskType])}</span>
      <span className={css.state}>
        {ready
          ? <IconCheckCircleOutlineRegular size={12} />
          : <IconWarningTriangleOutlineRegular size={12} />}
        {t(STATE_LABELS[entry.state])}
      </span>
      {route === null ? null : <span className={css.route}>{route}</span>}
      {entry.detail === null ? null : <span className={css.detail} role="alert">{entry.detail}</span>}
    </li>
  )
}

/**
 * Render the route-state strip for one snapshot.
 * @param props - the snapshot, the re-check callback, and the locale seat.
 * @returns the strip, or nothing while the first read is still in flight.
 */
export function RouteStatus({ refresh, t, ...snapshot }: RouteStatusProps) {
  if (snapshot.phase === 'loading') {
    return (
      <div className={css.dock} data-web-test-presentation>
        <div className={css.bar}>
          <span className={css.title}>{t('title')}</span>
          <span className={css.loading}>{t('loading')}</span>
        </div>
      </div>
    )
  }
  if (snapshot.phase === 'unavailable') {
    return (
      <div className={css.dock} data-web-test-presentation>
        <div className={css.bar}>
          <span className={css.title}>{t('title')}</span>
          <span className={css.detail} role="alert">{t('unavailable')}</span>
          <span className={css.detail}>{snapshot.detail}</span>
          <button type="button" className={css.refresh} onClick={refresh} aria-label={t('action.refresh')}>
            <IconRefreshOutlineRegular size={14} />
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className={css.dock} data-web-test-presentation>
      <div className={css.bar}>
        <span className={css.title}>{t('title')}</span>
        <ul className={css.rows}>
          {snapshot.entries.map(entry => <RouteRow key={entry.taskType} entry={entry} t={t} />)}
        </ul>
        <button type="button" className={css.refresh} onClick={refresh} aria-label={t('action.refresh')}>
          <IconRefreshOutlineRegular size={14} />
        </button>
      </div>
    </div>
  )
}

/** Full props of the dock entry: InputZone owner share + injected hooks + the locale seat. */
export type RouteDockProps =
  & import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'>
  & InjectFace<RouteStatusInjected>
  & PropsLocale<'web-test-presentation'>

/**
 * Dock adapter: binds the injected source to the presentational strip.
 *
 * The framework's selector hook takes a selector, so the whole snapshot is
 * selected with an identity function; the strip receives the three snapshot
 * variants as its own props.
 */
export function RouteDock({ useRouteStatus, refresh, configure, projects, session, t }: RouteDockProps) {
  return <>
    <RouteStatus {...useRouteStatus(next => next)} refresh={refresh} t={t} />
    <div className={css.panels}>
      <ModelConfiguration operations={configure} refresh={refresh} t={t} />
      <ProjectPanel key={session.sessionId} sessionId={session.sessionId} running={session.running} operations={projects} t={t} />
    </div>
  </>
}
