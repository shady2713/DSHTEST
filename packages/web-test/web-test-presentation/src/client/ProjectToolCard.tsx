/** Replay-stable web testing cards; all facts come from logged content, never a live lookup. */
import z from 'zod'
import type { ToolCallPhaseProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ProjectFacts, ProjectObservation, projectFactsSchema } from './ProjectFacts.tsx'
import css from './RouteDock.module.css'

const projectSchema = projectFactsSchema.shape.project
const outcomeSchema = z.object({
  kind: z.enum(['pending', 'declined', 'stale', 'clarification', 'unavailable']),
  clarification: z.object({ missing: z.array(z.enum(['target', 'requirement', 'expectedRevision'])) }).optional(),
})
const projectListSchema = z.array(projectSchema.pick({ projectId: true, revision: true }))

/**
 * Render persisted project command output through typed locale and validated facts.
 * @param props - official tool phase and immutable block, with namespace locale.
 * @returns project card without Remote reads, authorization, or executable actions.
 */
export function ProjectToolCard(props: ToolCallPhaseProps & PropsLocale<'web-test-presentation'>) {
  if (props.phase !== 'result') return <div className={css.configuration} data-web-test-card>
    <span>{props.t('project.card-title')}</span><p>{props.t('project.card-pending')}</p>
  </div>
  const text = props.block.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
  let value: unknown
  try { value = JSON.parse(text) } catch (_error: unknown) {
    // Error results and interrupted JSON remain failures; never substitute current project state.
    value = null
  }
  const facts = projectFactsSchema.safeParse(value)
  const project = projectSchema.safeParse(value)
  const outcome = outcomeSchema.safeParse(value)
  const projects = projectListSchema.safeParse(value)
  const probe = projectFactsSchema.shape.entryUrlProbe.unwrap().safeParse(value)
  return <div className={css.configuration} data-web-test-card>
    <span>{props.t('project.card-title')}</span>
    {props.block.isError ? <p role="alert">{props.t('project.failed')}</p>
      : facts.success ? <ProjectFacts data={facts.data} t={props.t} />
        : project.success ? <div className={css.facts}>
          <p>{project.data.projectId} · {props.t('project.revision')} {project.data.revision}</p>
          <div>{props.t('project.roots')}<ul>{project.data.codeRoots.map(root => <li key={root}>{root}</li>)}</ul></div>
          <div>{props.t('project.urls')}<ul>{project.data.entryUrls.map(url => <li key={url}>{url}</li>)}</ul></div>
          <p>{props.t('project.confirm-hint')}</p>
        </div>
          : outcome.success ? <><p>{props.t(`project.outcome.${outcome.data.kind}`)}</p>
            <ul>{outcome.data.clarification?.missing.map(field => <li key={field}>{props.t(`project.missing.${field}`)}</li>)}</ul></>
            : projects.success ? <ul>{projects.data.map(entry => <li key={entry.projectId}>{entry.projectId} · {entry.revision}</li>)}</ul>
              : probe.success ? <><ProjectObservation probe={probe.data} t={props.t} /><p>{props.t('project.head-hint')}</p></>
                : <p>{props.t('project.failed')}</p>}
  </div>
}
