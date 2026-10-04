/** Conversation-local configuration; secret drafts only reach the credentials Remote. */
import { useEffect, useState } from 'react'
import type { ProviderConfiguration, RouteTaskType } from '../types.ts'
import type { RouteStatusKey } from './locales.ts'
import css from './RouteDock.module.css'

/** Operations bound by the plugin, through official configuration Remotes. */
export interface ModelConfigurationOperations {
  /** Read existing provider profiles. @returns safe configuration addresses. */
  load(): Promise<ProviderConfiguration[]>
  /**
   * Persist non-secret model fields and a write-only key, then run an exact-route probe.
   * @param provider - official provider configuration address.
   * @param model - user-selected exact model.
   * @param taskType - capability requirement being verified.
   * @param key - write-only key draft; empty preserves the stored value.
   * @returns whether the route was verified and persisted.
   */
  save(provider: ProviderConfiguration, model: string, taskType: RouteTaskType, key: string): Promise<boolean>
  /** Remove a key through the official credentials API. @param ref - reference name. @returns successful removal. */
  remove(ref: string): Promise<boolean>
}

/**
 * Render the first-run form above the conversation composer.
 * @param props - bound configuration operations, refresh, and typed locale.
 * @returns write-only form with explicit save/probe and removal states.
 */
export function ModelConfiguration({ operations, refresh, t }: {
  operations: ModelConfigurationOperations
  refresh: () => void
  t: (key: RouteStatusKey) => string
}) {
  const [providers, setProviders] = useState<ProviderConfiguration[]>([])
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [taskType, setTaskType] = useState<RouteTaskType>('analysis')
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<RouteStatusKey>('config.loading')
  useEffect(() => {
    let active = true
    void operations.load().then((rows) => {
      if (!active) return
      setProviders(rows)
      const initial = rows.find(row => row.catalogState === 'ready' && row.models.length > 0) ?? rows[0]
      setProviderId(initial?.provider ?? '')
      setModel(initial?.models[0] ?? '')
      setStatus(rows.length === 0 ? 'config.no-provider' : 'config.hint')
    }).catch((_error: unknown) => { if (active) setStatus('config.failed') })
    return () => { active = false }
  }, [operations])
  const provider = providers.find(row => row.provider === providerId)
  const submit = async (): Promise<void> => {
    if (provider === undefined || busy || model.trim() === '') return
    const secret = keyDraft.trim()
    setKeyDraft('')
    setBusy(true)
    setStatus('config.testing')
    try {
      const ready = await operations.save(provider, model.trim(), taskType, secret)
      setStatus(ready ? 'config.saved' : 'config.failed')
      refresh()
    } catch (_error: unknown) {
      // Wire exceptions may echo the secret; only locale-owned failure text is rendered.
      setStatus('config.failed')
    } finally { setBusy(false) }
  }
  const remove = async (): Promise<void> => {
    /* v8 ignore next -- the native removal button is disabled under precisely these conditions */
    if (provider?.credentialRef === null || provider === undefined || busy) return
    setKeyDraft('')
    setBusy(true)
    try {
      setStatus(await operations.remove(provider.credentialRef) ? 'config.removed' : 'config.failed')
      refresh()
    } catch (_error: unknown) { setStatus('config.failed') }
    finally { setBusy(false) }
  }
  return <details className={css.configuration} open>
    <summary>{t('config.title')}</summary>
    <form className={css.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <label>{t('config.provider')}<select disabled={busy} value={providerId} onChange={(event) => {
        setProviderId(event.target.value)
        setKeyDraft('')
        setModel(providers.find(row => row.provider === event.target.value)?.models[0] ?? '')
      }}>{providers.map(row => <option key={row.provider} value={row.provider}>{row.provider}</option>)}</select></label>
      <label>{t('config.model')}<input disabled={busy} required value={model} onChange={(event) => { setModel(event.target.value) }} /></label>
      <label>{t('config.task')}<select disabled={busy} value={taskType} onChange={(event) => {
        const value = event.target.value
        if (value === 'analysis' || value === 'vision' || value === 'auxiliary') setTaskType(value)
      }}><option value="analysis">{t('task.analysis')}</option><option value="vision">{t('task.vision')}</option><option value="auxiliary">{t('task.auxiliary')}</option></select></label>
      <label>{t('config.key')}<input type="password" autoComplete="new-password" spellCheck={false} disabled={busy || provider?.credentialRef == null} value={keyDraft} onChange={(event) => { setKeyDraft(event.target.value) }} /></label>
      <button type="submit" disabled={busy || provider === undefined || model.trim() === ''}>{t('config.save')}</button>
      <button type="button" disabled={busy || provider?.credentialRef == null} onClick={() => { void remove() }}>{t('config.remove')}</button>
      {provider?.catalogState === 'unavailable' && <p>{t('config.catalog-unavailable')}</p>}
      <p role="status" aria-live="polite">{t(status)}</p>
    </form>
  </details>
}
