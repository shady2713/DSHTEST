/** Read the Web testing Runtime's cold activity for Desktop quit and update admission. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web-test-runtime'

/**
 * Count persistent work without loading Sessions or changing durable records.
 * @param ctx - Host context whose optional Web testing Runtime owns the control root.
 * @returns whether a registered run or unsettled operation prevents ordinary update admission.
 * @throws when the mounted Runtime cannot provide a complete cold snapshot.
 */
export async function hasDesktopPersistentActivity(ctx: Context): Promise<boolean> {
  const runtime = ctx.get('webTestRuntime')
  if (runtime === undefined) return false
  const snapshot = await runtime.readPersistentActivity()
  if (snapshot.completenessErrors.length > 0 || snapshot.controlRootIdentity === null
    || snapshot.generation === null || snapshot.headRevision === null) {
    throw new Error('desktop activity: persistent task inspection is incomplete')
  }
  return snapshot.unsettledOperationIds.length > 0
    || snapshot.runHeads.some(run => run.status !== 'COMPLETED')
}
