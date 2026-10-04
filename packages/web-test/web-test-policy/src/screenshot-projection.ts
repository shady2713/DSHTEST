/** Session-owned screenshot references reconstructed from paired successful browser tool results. */
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

interface ScreenshotState {
  readonly pending: readonly string[]
  readonly images: readonly ImageAttachmentRef[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    webTestScreenshots: ScreenshotState
  }
}

const imageSchema = z.object({
  attachmentId: z.string().transform(AttachmentId),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  name: z.string().optional(),
  originalDimensions: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
}).strict().transform((value): ImageAttachmentRef => ({
  attachmentId: value.attachmentId, mediaType: value.mediaType, bytes: value.bytes, width: value.width, height: value.height,
  ...value.name === undefined ? {} : { name: value.name },
  ...value.originalDimensions === undefined ? {} : { originalDimensions: value.originalDimensions },
}))

/**
 * Compare every immutable and display field of an admitted image reference.
 * @param left - Reference recorded by the capture or Session projection.
 * @param right - Reference requested by a consumer.
 * @returns whether the two references identify identical metadata.
 */
export function sameScreenshotReference(left: ImageAttachmentRef, right: ImageAttachmentRef): boolean {
  return left.attachmentId === right.attachmentId && left.mediaType === right.mediaType && left.bytes === right.bytes
    && left.width === right.width && left.height === right.height && left.name === right.name
    && left.originalDimensions?.width === right.originalDimensions?.width
    && left.originalDimensions?.height === right.originalDimensions?.height
}

/** Host-only fold; reopening or forking reconstructs references without restoring browser dispatch permission. */
export const screenshotProjection: ProjectionDefinition<'webTestScreenshots'> = {
  key: 'webTestScreenshots',
  stateVersion: 1,
  stateSchema: z.object({ pending: z.array(z.string()), images: z.array(imageSchema) }).strict(),
  init: () => ({ pending: [], images: [] }),
  apply: (state, event) => {
    if (event.type === 'tool/call' && event.data.name === 'web_browser_screenshot') {
      return { ...state, pending: [...state.pending, event.data.callId] }
    }
    if (event.type !== 'tool/result' || !state.pending.includes(event.data.message.toolCallId)) return state
    const pending = state.pending.filter(callId => callId !== event.data.message.toolCallId)
    if (event.data.message.isError) return { ...state, pending }
    const captured = event.data.message.content.filter(part => part.type === 'image').map(part => part.attachment)
    const images = [...state.images]
    for (const image of captured) {
      if (!images.some(existing => sameScreenshotReference(existing, image))) images.push({ ...image })
    }
    return { pending, images }
  },
}
