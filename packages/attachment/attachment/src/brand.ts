/** Attachment identifier brand. @module @deepseek-ai/dsh-attachment/brand */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque content-addressed identifier for one immutable attachment object. */
export type AttachmentId = Branded<'AttachmentId'>

/**
 * Brand a validated storage identifier.
 * @param value - backend-produced opaque identifier.
 * @returns the branded identifier.
 */
export function AttachmentId(value: string): AttachmentId {
  return value as AttachmentId
}

/** Opaque deterministic identity for one request-image transformation. */
export type ImageVariantId = Branded<'ImageVariantId'>

/**
 * Brand a validated request-image transformation identifier.
 * @param value - attachment-provider-produced opaque identifier.
 * @returns the branded identifier.
 */
export function ImageVariantId(value: string): ImageVariantId {
  return value as ImageVariantId
}

/** Producer-owned durable file-reference identity. */
export type FileReferenceOwnerId = Branded<'FileReferenceOwnerId'>

/**
 * Brand a producer identity.
 * @param value - stable producer identity.
 * @returns the branded owner identity.
 */
export function FileReferenceOwnerId(value: string): FileReferenceOwnerId {
  return value as FileReferenceOwnerId
}

/** Provider-issued durable staging receipt. */
export type FileStageTicket = Branded<'FileStageTicket'>

/**
 * Brand a stored staging receipt.
 * @param value - provider-issued receipt identity.
 * @returns the branded ticket.
 */
export function FileStageTicket(value: string): FileStageTicket {
  return value as FileStageTicket
}
