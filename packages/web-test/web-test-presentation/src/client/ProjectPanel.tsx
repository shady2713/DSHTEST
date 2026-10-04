/** Conversation-local project selection and explicit metadata correction. */
import { useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ProjectId, Revision } from '@deepseek-ai/dsh-web-test-contracts/ids'
import type { StatusReport, ProjectSummary } from '@deepseek-ai/dsh-web-test-conversation/types'
import { ProjectFacts } from './ProjectFacts.tsx'
import type { RouteStatusKey } from './locales.ts'
import css from './RouteDock.module.css'

/** Explicit metadata fields the user edits; empty arrays preserve absent material. */
type MetadataInput = { codeRoots: string[]; entryUrls: string[] }

/** Live session-addressed consumer of the generated Commands Remote. */
export interface ProjectPanelOperations {
  /** Read saved status only. @param sessionId - selected conversation. @returns null when unattached. */
  read(sessionId: SessionId): Promise<StatusReport | null>
  /** List selectable identities only. @returns identities and revisions without private metadata. */
  list(): Promise<ProjectSummary[]>
  /** Register explicit metadata. @param sessionId - selected conversation. @param metadata - user fields. @returns whether committed. */
  register(sessionId: SessionId, metadata: MetadataInput): Promise<boolean>
  /** Select one project. @param sessionId - selected conversation. @param projectId - explicit selection. @returns whether attached. */
  attach(sessionId: SessionId, projectId: ProjectId): Promise<boolean>
  /**
   * Correct the same project.
   * @param sessionId - selected conversation.
   * @param projectId - displayed project identity.
   * @param revision - displayed revision.
   * @param metadata - replacement fields.
   * @returns whether committed.
   */
  update(sessionId: SessionId, projectId: ProjectId, revision: Revision, metadata: MetadataInput): Promise<boolean>
  /**
   * Explicit HEAD observation.
   * @param sessionId - selected conversation.
   * @param projectId - displayed project identity.
   * @param revision - displayed revision.
   * @param signal - user cancellation.
   * @returns whether saved.
   */
  probe(sessionId: SessionId, projectId: ProjectId, revision: Revision, signal: AbortSignal): Promise<boolean>
}

/** One line per user-provided path or URL; blank lines do not create synthetic material. */
function lines(text: string): string[] { return text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean) }

/**
 * Render a project panel for one Session, retaining facts when a read or correction fails.
 * @param props - selected conversation lifecycle, shared Remote adapter and locale.
 * @returns project panel with explicit selection, correction, refresh and HEAD actions.
 */
export function ProjectPanel({ sessionId, running, operations, t }: {
  sessionId: SessionId
  running: boolean
  operations: ProjectPanelOperations
  t: (key: RouteStatusKey) => string
}) {
  const [status, setStatus] = useState<StatusReport | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selected, setSelected] = useState('')
  const [roots, setRoots] = useState('')
  const [urls, setUrls] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const epoch = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const read = async (): Promise<void> => {
    const current = ++epoch.current
    try {
      const [next, identities] = await Promise.all([operations.read(sessionId), operations.list()])
      if (current !== epoch.current) return
      setStatus(next); setProjects(identities); setFailed(false)
      setRoots(next?.project.codeRoots.join('\n') ?? '')
      setUrls(next?.project.entryUrls.join('\n') ?? '')
    } catch (_error: unknown) {
      // Remote details may contain unrelated project material; show only localized read failure.
      if (current === epoch.current) setFailed(true)
    } finally { if (current === epoch.current) setLoading(false) }
  }
  useEffect(() => {
    void read()
    return () => { epoch.current++; abort.current?.abort() }
  }, [sessionId, running, operations])
  const act = async (operation: () => Promise<boolean>): Promise<void> => {
    if (busy) return
    setBusy(true)
    const current = epoch.current
    try {
      const accepted = await operation()
      if (current !== epoch.current) return
      await read()
      if (!accepted) setFailed(true)
    } catch (_error: unknown) {
      if (current === epoch.current) setFailed(true)
    } finally { setBusy(false); abort.current = null }
  }
  const metadata = { codeRoots: lines(roots), entryUrls: lines(urls) }
  return <details className={css.configuration} open data-web-test-project>
    <summary>{t('project.title')}</summary>
    {loading ? <span className={css.spinner} role="progressbar" aria-label={t('project.loading')} /> : null}
    {failed ? <p role="alert">{t('project.failed')}</p> : null}
    {status === null ? loading ? null : <p>{t('project.ordinary')}</p> : <ProjectFacts data={status} t={t} />}
    <div className={css.form}>
      <label>{t('project.select')}<select value={selected} disabled={busy} onChange={(event) =>{  setSelected(event.target.value) }}>
        <option value="">{t('project.select-placeholder')}</option>
        {projects.map(project => <option key={project.projectId} value={project.projectId}>
          {project.projectId} · {project.revision}
        </option>)}
      </select></label>
      <button type="button" disabled={busy || selected === ''} onClick={() => {
        const project = projects.find(entry => entry.projectId === selected)
        if (project !== undefined) void act(() => operations.attach(sessionId, project.projectId))
      }}>{t('project.attach')}</button>
      <button type="button" disabled={busy} onClick={() => { void read() }}>{t('project.refresh')}</button>
    </div>
    <form className={css.form} onSubmit={(event) => {
      event.preventDefault()
      void act(() => status === null
        ? operations.register(sessionId, metadata)
        : operations.update(sessionId, status.project.projectId, status.project.revision, metadata))
    }}>
      <label>{t('project.roots')}<textarea value={roots} disabled={busy || loading} onChange={(event) =>{  setRoots(event.target.value) }} /></label>
      <label>{t('project.urls')}<textarea value={urls} disabled={busy || loading} onChange={(event) =>{  setUrls(event.target.value) }} /></label>
      <button type="submit" disabled={busy || loading}>{t(status === null ? 'project.register' : 'project.save')}</button>
      {status === null ? null : <button type="button" disabled={busy} onClick={() => {
        const controller = new AbortController(); abort.current = controller
        void act(() => operations.probe(sessionId, status.project.projectId, status.project.revision, controller.signal))
      }}>{t('project.probe')}</button>}
      {abort.current === null ? null : <button type="button" onClick={() => abort.current?.abort()}>{t('project.cancel-probe')}</button>}
      <p>{t('project.confirm-hint')}</p>
    </form>
  </details>
}
