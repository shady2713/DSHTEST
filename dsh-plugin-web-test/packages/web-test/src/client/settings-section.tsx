/**
 * Web testing settings section.
 *
 * Rendered inside the host's own Settings shell through the declared
 * `settings.section` slot, so the plugin adds a section without editing the
 * host's settings UI. All data arrives through the injected face; the component
 * never reaches for a Context or a service.
 */

import type { WebTestEnvironmentSummary, WebTestSettingsData } from './locale.ts'

/** Localized nature of one declared entry point. */
function natureLabel(t: WebTestSettingsSectionProps['t'], nature: WebTestEnvironmentSummary['nature']): string {
  if (nature === 'test') return t('natureTest')
  if (nature === 'production') return t('natureProduction')
  return t('natureUnknown')
}

/** Localized data-operation scope of one declared entry point. */
function scopeLabel(t: WebTestSettingsSectionProps['t'], scope: WebTestEnvironmentSummary['dataOperations']): string {
  return scope === 'read-only' ? t('dataReadOnly') : t('dataBusinessWrites')
}

/**
 * Props the slot renderer supplies to this component.
 *
 * The renderer flattens the registration's `inject` face into the component's
 * props, so the status arrives as sibling props rather than as one object.
 */
export interface WebTestSettingsSectionProps extends WebTestSettingsData {
  /** Localized `t` function supplied by the registering entry's inject face. */
  readonly t: (key: string, params?: Record<string, string | number>) => string
}

/** One label/value row of the status list. */
function Row(props: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '2px 0' }}>
      <span style={{ opacity: 0.7 }}>{props.label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{props.value}</span>
    </div>
  )
}

/**
 * The Web testing settings section.
 * @param props - Slot props: the localized `t` function and the injected data.
 * @returns the section body.
 */
export function WebTestSettingsSection(props: WebTestSettingsSectionProps): JSX.Element {
  const { t, status, failure, projects } = props
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, opacity: 0.75 }}>{t('description')}</p>
      {failure !== undefined
        ? <p role="alert">{t('unavailable', { reason: failure })}</p>
        : status === undefined
          ? <p style={{ opacity: 0.7 }}>{t('loading')}</p>
          : (
            <div>
              <Row label={t('state')} value={status.state === 'draining' ? t('stateDraining') : t('stateActive')} />
              <Row label={t('version')} value={status.version} />
              <Row label={t('schemaVersion')} value={String(status.schemaVersion)} />
              <Row label={t('dshVersion')} value={status.dshVersion} />
              <Row label={t('projects')} value={String(status.recordCounts.project)} />
              <Row label={t('runs')} value={String(status.recordCounts.run)} />
              <Row label={t('dataRoot')} value={status.dataRoot} />
            </div>
          )}
      <div>
        <h3 style={{ margin: '4px 0 6px', fontSize: 14 }}>{t('projectsHeading')}</h3>
        {projects.length === 0
          ? <p style={{ opacity: 0.7 }}>{t('noProjects')}</p>
          : projects.map(project => (
            <div key={project.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0' }}>
              <strong>{project.label}</strong>
              <span style={{ opacity: 0.7 }}>{project.baseUrl}</span>
              {project.environments.length === 0
                ? <span style={{ opacity: 0.7 }}>{t('noEnvironments')}</span>
                : (
                  <>
                    <div style={{ opacity: 0.7, fontSize: 12 }}>{t('environmentsHeading')}</div>
                    {project.environments.map(environment => (
                      <div
                        key={`${project.key}/${environment.name}`}
                        style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 12 }}
                      >
                        <span>{environment.name} — {natureLabel(t, environment.nature)}</span>
                        <span style={{ opacity: 0.7 }}>{environment.url}</span>
                        <Row label={t('dataOperations')} value={scopeLabel(t, environment.dataOperations)} />
                        <Row
                          label={t('viewport')}
                          value={`${environment.viewport.width}×${environment.viewport.height}`}
                        />
                        <Row
                          label={t('roles')}
                          value={environment.roles.length === 0 ? t('noRoles') : environment.roles.join('、')}
                        />
                      </div>
                    ))}
                  </>
                )}
            </div>
          ))}
        <p style={{ opacity: 0.7, fontSize: 12 }}>{t('readOnlyNotice')}</p>
      </div>
    </section>
  )
}
