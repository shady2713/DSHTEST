/**
 * The task types Web testing routes, and the capability each one requires.
 *
 * A task type is a requirement, not a preference. `analysis` and `auxiliary`
 * both need text, and `auxiliary` exists as a separate tag because a session
 * that has no lightweight decision model configured must be able to say so and
 * take a legal substitute rather than pretend a distinction it does not have.
 * `vision` needs the `image` modality, and no text-only route satisfies it.
 *
 * @module @deepseek-ai/dsh-web-test-models/task
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ModelModality } from '@deepseek-ai/dsh-llm/types'

/** Merge-extensible task types a Web testing session routes. */
export interface ModelTaskTypeMap {
  /** The session's own work: reading a page, deciding what to assert, reporting. */
  analysis: 'analysis'
  /** Work that must read an image the session has already admitted. */
  vision: 'vision'
  /** Subordinate calls a session makes to itself: summaries, titles, decisions. */
  auxiliary: 'auxiliary'
}

/** One tag naming a task type; a new task type extends the map. */
export type ModelTaskType = ModelTaskTypeMap[keyof ModelTaskTypeMap]

/**
 * The modality each task type requires. The record is keyed by the whole string
 * domain so a tag this release does not know reads as absent rather than as a
 * type error at a wire boundary.
 */
const REQUIRED_MODALITY: Readonly<Record<string, ModelModality>> = {
  analysis: 'text',
  vision: 'image',
  auxiliary: 'text',
}

/**
 * Read the modality one task type requires.
 *
 * A tag this release does not know is a configuration error rather than a
 * default, so an added task type must state its requirement before it can be
 * routed: falling back to `text` would let an image task reach a text-only route.
 * @param taskType - the task type being routed; a value read from a wire or a stored
 * record may be a tag this release does not know, and is refused here rather than defaulted.
 * @returns the modality a route must declare.
 * @throws {Error} when the task type has no declared requirement.
 */
export function requiredModality(taskType: ModelTaskType | (string & Branded<'unknown-task'>)): ModelModality {
  const modality = REQUIRED_MODALITY[taskType]
  if (modality === undefined) {
    throw new Error(`web-test/models: task type ${JSON.stringify(taskType)} declares no modality requirement`)
  }
  return modality
}

/** Every task type this release routes, in the order a surface lists them. */
export const MODEL_TASK_TYPES: readonly ModelTaskType[] = ['analysis', 'vision', 'auxiliary']

/**
 * Whether one task type may fall back to a route that was verified for another.
 *
 * `auxiliary` may run on the `analysis` route and vice versa, because both need
 * text and a session must not be left without any route at all. `vision` may
 * not: substituting a text route for image work is the guess this package exists
 * to avoid.
 * @param from - the task type a verified route was selected for.
 * @param to - the task type that wants to use it.
 * @returns true when the substitution is legal.
 */
export function maySubstitute(from: ModelTaskType, to: ModelTaskType): boolean {
  if (requiredModality(from) !== requiredModality(to)) return false
  return to === 'vision' ? from === 'vision' : true
}
