/**
 * The resolve step on its own: what a raw ask becomes, what a closed verb set
 * reports about this stage, and what a session's context is when it is attached
 * and when it is not.
 *
 * Nothing here touches a service. The Remote's refusals are decided by these
 * values, so the values are what this suite pins: a field an ask left out is
 * named, an ask that is not a command is refused, and the five mutating verbs
 * are reported as the same unavailable answer rather than as five different
 * guesses about what they would have done.
 */

import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import type { ProjectId, ProjectMetadata, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import type { MaterialCheck, ProjectInspection } from '@deepseek-ai/dsh-web-test-runtime'
import { describe, expect, it } from 'vitest'
import {
  commandAvailability,
  describeCommands,
  incompleteAsk,
  isCommandVerb,
  isMutatingCommandVerb,
  isStatusSubject,
  MUTATING_COMMANDS,
  requiredFields,
  resolveCommand,
  STATUS_SUBJECTS,
  unavailableAction,
  undeclaredEnvironment,
  WEB_TEST_COMMANDS,
} from '../src/index.ts'
import { attachedContext } from '../src/context.ts'
import { WebTestConversationError } from '../src/errors.ts'

const projectId = brandString<ProjectId>(`project-${'a'.repeat(32)}`)

/** The one code root a fixture project declares. */
const shopRoot = 'C:\\projects\\shop'

/** One usable finding, for a context built without a filesystem. */
const usable: MaterialCheck = { state: 'usable', declared: shopRoot, detail: 'an existing directory on this host' }

/**
 * Build the inspection a context carries, without reading a filesystem.
 * @param codeRoot - the code root the record declares.
 * @returns the inspection the entry would have read.
 */
function inspection(codeRoot: string): ProjectInspection {
  return {
    project: { projectId, revision: brandNumber<Revision>(1), codeRoots: [codeRoot], entryUrls: ['http://localhost:3000/'] },
    codeRoots: [{ ...usable, declared: codeRoot }],
    entryUrls: [{ ...usable, declared: 'http://localhost:3000/' }],
    complete: true,
  }
}

describe('the closed command set', () => {
  it('names six verbs and admits only those', () => {
    expect(WEB_TEST_COMMANDS).toEqual(['query', 'generate-case', 'start', 'pause', 'resume', 'cancel'])
    for (const verb of WEB_TEST_COMMANDS) expect(isCommandVerb(verb)).toBe(true)
    expect(isCommandVerb('restart')).toBe(false)
    expect(isCommandVerb(7)).toBe(false)
  })

  it('separates the five mutating verbs from the one that only reads', () => {
    expect(MUTATING_COMMANDS).toEqual(['generate-case', 'start', 'pause', 'resume', 'cancel'])
    for (const verb of MUTATING_COMMANDS) expect(isMutatingCommandVerb(verb)).toBe(true)
    expect(isMutatingCommandVerb('query')).toBe(false)
    expect(isMutatingCommandVerb(undefined)).toBe(false)
  })

  it('reads a status subject only from the closed set', () => {
    expect(STATUS_SUBJECTS).toEqual(['project', 'environment', 'commands', 'material'])
    for (const subject of STATUS_SUBJECTS) expect(isStatusSubject(subject)).toBe(true)
    expect(isStatusSubject('everything')).toBe(false)
    expect(isStatusSubject(null)).toBe(false)
  })

  it('declares the fields each verb needs', () => {
    expect(requiredFields('query').map(field => field.name)).toEqual(['subject'])
    expect(requiredFields('start').map(field => field.name)).toEqual(['target', 'expectedRevision'])
    expect(requiredFields('generate-case').map(field => field.name)).toEqual(['requirement', 'expectedRevision'])
    for (const verb of MUTATING_COMMANDS) expect(requiredFields(verb)).toHaveLength(2)
  })

  it('reports the query as available and each mutating verb as unavailable with a reason', () => {
    expect(commandAvailability('query')).toEqual({ verb: 'query', available: true, reason: null })
    for (const verb of MUTATING_COMMANDS) {
      const row = commandAvailability(verb)
      expect(row.available).toBe(false)
      expect(row.reason).toContain('this stage has no')
    }
  })

  it('describes the whole set from the same table both callers read', () => {
    const catalogue = describeCommands()
    expect(catalogue.commands.map(row => row.verb)).toEqual([...WEB_TEST_COMMANDS])
    expect(catalogue.statusSubjects).toEqual([...STATUS_SUBJECTS])
    expect(catalogue.commands).toEqual(WEB_TEST_COMMANDS.map(commandAvailability))
  })
})

describe('resolving a raw ask', () => {
  it('refuses a request that is not addressed to a session', () => {
    for (const sessionId of [undefined, '', '   ', 7]) {
      expect(() => resolveCommand({ sessionId, verb: 'query', subject: 'project' })).toThrow(WebTestConversationError)
    }
    expect(() => resolveCommand({ verb: 'query', subject: 'project' })).toThrow(
      /a web testing command must name the Session/,
    )
  })

  it('refuses a verb outside the closed set and names the set it belongs to', () => {
    expect(() => resolveCommand({ sessionId: 's1', verb: 'restart' })).toThrow(
      /is not one of the web testing commands query, generate-case, start, pause, resume, cancel/,
    )
  })

  it('resolves a status question to the subject it names', () => {
    expect(resolveCommand({ sessionId: 's1', verb: 'query', subject: 'material' })).toEqual({
      kind: 'resolved',
      sessionId: 's1',
      command: { verb: 'query', subject: 'material' },
    })
  })

  it('reports a status question whose subject is absent or outside the closed set as owing it', () => {
    for (const request of [
      { sessionId: 's1', verb: 'query' },
      { sessionId: 's1', verb: 'query', subject: 'everything' },
      { sessionId: 's1', verb: 'query', subject: 7 },
    ]) {
      expect(resolveCommand(request)).toEqual({
        kind: 'incomplete',
        sessionId: 's1',
        verb: 'query',
        missing: [requiredFields('query')[0]],
      })
    }
  })

  it('resolves a mutating ask to its target and the revision the answer was given against', () => {
    expect(resolveCommand({ sessionId: 's1', verb: 'start', target: '  checkout  ', expectedRevision: 3 })).toEqual({
      kind: 'resolved',
      sessionId: 's1',
      command: { verb: 'start', target: 'checkout', expectedRevision: 3 },
    })
  })

  it('names every field a vague ask left out, in the order the verb declares them', () => {
    const revisionField = requiredFields('start')[1]
    expect(resolveCommand({ sessionId: 's1', verb: 'start' })).toEqual({
      kind: 'incomplete',
      sessionId: 's1',
      verb: 'start',
      missing: requiredFields('start'),
    })
    expect(resolveCommand({ sessionId: 's1', verb: 'pause', target: 'run-7' })).toEqual({
      kind: 'incomplete',
      sessionId: 's1',
      verb: 'pause',
      missing: [revisionField],
    })
  })

  it('treats a blank field and a revision that is not a positive integer as absent', () => {
    const revisionField = requiredFields('cancel')[1]
    for (const expectedRevision of [undefined, 0, -1, 1.5, '2', null]) {
      const resolution = resolveCommand({ sessionId: 's1', verb: 'cancel', target: 'run-7', expectedRevision })
      expect(resolution).toMatchObject({ kind: 'incomplete', missing: [revisionField] })
    }
    expect(resolveCommand({ sessionId: 's1', verb: 'cancel', target: '   ', expectedRevision: 1 })).toMatchObject({
      kind: 'incomplete',
      missing: [requiredFields('cancel')[0]],
    })
  })

  it('resolves every mutating verb of the closed set from its own declared field', () => {
    for (const verb of MUTATING_COMMANDS) {
      const [target] = requiredFields(verb)
      const request = { sessionId: 's1', verb, [target?.name ?? '']: 'checkout', expectedRevision: 1 }
      expect(resolveCommand(request)).toEqual({
        kind: 'resolved',
        sessionId: 's1',
        command: { verb, target: 'checkout', expectedRevision: 1 },
      })
    }
  })
})

describe('the outcomes a caller reads', () => {
  it('answers a mutating verb this stage does not perform with the reason it does not', () => {
    for (const verb of MUTATING_COMMANDS) {
      const outcome = unavailableAction(verb)
      expect(outcome).toEqual({ kind: 'unavailable', verb, reason: commandAvailability(verb).reason })
    }
  })

  it('turns the fields an ask left out into the question to ask, naming the project', () => {
    const clarification = incompleteAsk('start', requiredFields('start'), projectId)

    expect(clarification.cause).toBe('incomplete-ask')
    expect(clarification.missing).toEqual(['target', 'expectedRevision'])
    expect(clarification.ask).toBe(
      `before "start" can act on project '${projectId}', name what to start and name the project revision the answer was given against`,
    )
  })

  it('turns a project with no confirmed environment into the question to ask', () => {
    const clarification = undeclaredEnvironment('resume', projectId)

    expect(clarification).toEqual({
      verb: 'resume',
      cause: 'undeclared-environment',
      missing: [],
      ask: `project '${projectId}' has no confirmed environment, so confirm the environment it is tested in before any command that changes anything`,
    })
  })
})

describe('the context a session acts on', () => {
  it('carries the published record and the entry’s own confirmation fact', () => {
    const project: ProjectMetadata = { projectId, revision: brandNumber<Revision>(2), codeRoots: [shopRoot], entryUrls: [] }

    expect(attachedContext({ projectId, declaredRevision: project.revision }, project, inspection(shopRoot))).toEqual({
      kind: 'attached',
      projectId,
      revision: 2,
      environmentConfirmed: true,
      material: inspection(shopRoot),
    })
    for (const declaredRevision of [null, brandNumber<Revision>(1)]) {
      expect(attachedContext({ projectId, declaredRevision }, project, inspection(shopRoot)).environmentConfirmed).toBe(false)
    }
  })
})
