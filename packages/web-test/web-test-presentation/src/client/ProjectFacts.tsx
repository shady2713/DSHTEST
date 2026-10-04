/** Shared project facts for the live panel and durable conversation tool results. */
import z from 'zod'
import type { RouteStatusKey } from './locales.ts'
import css from './RouteDock.module.css'

/** Parse only persisted display fields; malformed tool content never becomes a live project read. */
export const projectFactsSchema = z.object({
  project: z.object({
    projectId: z.string(), revision: z.number().int().positive(), codeRoots: z.array(z.string()), entryUrls: z.array(z.string()),
  }),
  environmentConfirmed: z.boolean(),
  environmentDeclarationRevision: z.number().int().positive().nullable(),
  environmentDeclaration: z.object({
    codeRoots: z.array(z.string()), entryUrl: z.string().nullable(), isTestEnvironment: z.boolean(),
    login: z.discriminatedUnion('state', [z.object({ state: z.literal('not-required') }), z.object({ state: z.literal('required'), accountLabel: z.string() })]),
    supplementaryRequirements: z.array(z.string()),
  }).nullable(),
  entryUrlProbe: z.object({
    revision: z.number().int().positive(), checkedAt: z.string(),
    entryUrls: z.array(z.discriminatedUnion('state', [
      z.object({ state: z.literal('response'), declared: z.string(), statusCode: z.number().int() }),
      z.object({ state: z.enum(['timeout', 'unreachable', 'cancelled']), declared: z.string() }),
      z.object({ state: z.literal('unusable'), declared: z.string(), reason: z.string() }),
    ])).readonly(),
  }).nullable(),
  material: z.object({
    codeRoots: z.array(z.object({ declared: z.string(), state: z.enum(['usable', 'absent', 'unusable']) })).readonly(),
    entryUrls: z.array(z.object({ declared: z.string(), state: z.enum(['usable', 'absent', 'unusable']) })).readonly(),
  }).optional(),
})

/** Displayed fields shared by Remote status and persisted tool-result metadata. */
export type ProjectFactsData = z.infer<typeof projectFactsSchema>

/**
 * Render immutable URL observations with their checked revision.
 * @param props - saved observations, optional current revision and typed locale.
 * @returns HEAD facts without interpreting login or environment readiness.
 */
export function ProjectObservation({ probe, currentRevision, t }: {
  probe: NonNullable<ProjectFactsData['entryUrlProbe']>
  currentRevision?: number
  t: (key: RouteStatusKey) => string
}) {
  return <div>{t('project.observation')}: <span>{t('project.revision')} {probe.revision} · {probe.checkedAt}</span>
    {currentRevision !== undefined && probe.revision !== currentRevision ? <span> · {t('project.stale')}</span> : null}
    <ul>{probe.entryUrls.map((entry, index) => <li key={index}>
      {entry.declared} · {entry.state === 'response' ? `${t('project.http')} ${entry.statusCode}` : t(`project.probe.${entry.state}`)}
    </li>)}</ul>
  </div>
}

/**
 * Render user declarations separately from saved HEAD observations and current confirmation.
 * @param props - immutable facts and typed locale.
 * @returns project facts with revision labels; no state reads or commands.
 */
export function ProjectFacts({ data, t }: { data: ProjectFactsData; t: (key: RouteStatusKey) => string }) {
  const { project, environmentDeclaration: declaration, entryUrlProbe: probe } = data
  return <div className={css.facts}>
    <p>{project.projectId} · {t('project.revision')} {project.revision}</p>
    <div>{t('project.roots')}<ul>{project.codeRoots.map((root) => {
      const state = data.material?.codeRoots.find(entry => entry.declared === root)?.state
      return <li key={root}>{root}{state === undefined ? null : <> · {t(`project.material.${state}`)}</>}</li>
    })}</ul></div>
    <div>{t('project.urls')}<ul>{project.entryUrls.map((url) => {
      const state = data.material?.entryUrls.find(entry => entry.declared === url)?.state
      return <li key={url}>{url}{state === undefined ? null : <> · {t(`project.material.${state}`)}</>}</li>
    })}</ul></div>
    <p>{t(data.environmentConfirmed ? 'project.confirmed' : 'project.unconfirmed')}</p>
    <div>{t('project.declaration')}: {declaration === null ? t('project.undeclared') : <>
      <span>{t('project.revision')} {data.environmentDeclarationRevision}</span>
      {data.environmentDeclarationRevision !== project.revision ? <span> · {t('project.stale')}</span> : null}
      <p>{t(declaration.isTestEnvironment ? 'project.test-environment' : 'project.other-environment')}</p>
      <p>{t('project.login')}: {declaration.login.state === 'required' ? declaration.login.accountLabel : t('project.login-not-required')}</p>
      <ul>{declaration.codeRoots.map(root => <li key={root}>{root}</li>)}</ul>
      {declaration.entryUrl === null ? null : <p>{declaration.entryUrl}</p>}
      <ul>{declaration.supplementaryRequirements.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul>
    </>}</div>
    {probe === null ? <p>{t('project.observation')}: {t('project.unchecked')}</p> : <ProjectObservation probe={probe} currentRevision={project.revision} t={t} />}
    <p>{t('project.head-hint')}</p>
  </div>
}
