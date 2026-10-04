/** Verbatim file references declared by persisted Session event content. @module @deepseek-ai/dsh-session-persistence/file-attachments */

import { AttachmentId, type FileAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** Whether a parsed JSON value has named fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Collect declared file blocks; malformed references refuse retention and export. */
function collectContent(content: unknown, files: Map<string, FileAttachmentRef>): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'file') continue
    const ref = block.attachment
    if (!isRecord(ref) || typeof ref.attachmentId !== 'string' || ref.attachmentId === ''
      || typeof ref.name !== 'string' || ref.name === '' || typeof ref.bytes !== 'number'
      || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) {
      throw new Error('session-persistence: invalid declared file attachment reference')
    }
    const key = `${ref.attachmentId}\u0000${ref.name}`
    const previous = files.get(key)
    if (previous !== undefined && previous.bytes !== ref.bytes) {
      throw new Error('session-persistence: conflicting immutable file attachment reference')
    }
    files.set(key, { attachmentId: AttachmentId(ref.attachmentId), name: ref.name, bytes: ref.bytes })
  }
}

/** Collect one message's declared content without traversing unrelated fields. */
function collectMessage(message: unknown, files: Map<string, FileAttachmentRef>): void {
  if (isRecord(message)) collectContent(message.content, files)
}

/** Collect completed Assistant blocks, including retained failed attempts. */
function collectStream(stream: unknown, files: Map<string, FileAttachmentRef>): void {
  if (!Array.isArray(stream)) return
  for (const record of stream) {
    if (!isRecord(record) || record.type !== 'chunk' || !isRecord(record.chunk)
      || record.chunk.type !== 'block-end') continue
    collectContent([record.chunk.block], files)
  }
}

/**
 * Read distinct file references from declared first-party Session content fields.
 * Unknown event types and unrelated JSON fields remain opaque; their contents
 * do not establish that historical storage has no other reference owners.
 * @param events - parsed persisted event envelopes, or validated events about to be stored.
 * @returns references deduplicated by attachment identity and stored filename.
 * @throws {Error} when a declared file block is malformed or contradicts immutable byte metadata.
 */
export function fileAttachmentRefsInSessionEvents(events: Iterable<unknown>): readonly FileAttachmentRef[] {
  const files = new Map<string, FileAttachmentRef>()
  for (const event of events) {
    if (!isRecord(event) || !isRecord(event.data)) continue
    const data = event.data
    switch (event.type) {
      case 'user/message': case 'tool/ptc-dispatch':
        collectContent(data.content, files)
        break
      case 'system/message': case 'developer/message': case 'tool/result': case 'team/message/queued':
        collectMessage(data.message, files)
        break
      case 'agent/inbox/spliced':
        if (Array.isArray(data.inserted)) {
          for (const message of data.inserted) collectMessage(message, files)
        }
        break
      case 'compaction/summary':
        collectContent(data.summary, files)
        collectContent(data.rawOutput, files)
        break
      case 'assistant/message':
        collectMessage(data.message, files)
        collectStream(data.stream, files)
        break
      case 'assistant/attempt':
        collectStream(data.stream, files)
        break
      // Extension events require their own retention owner; arbitrary payloads are not message content.
      default: break
    }
  }
  return [...files.values()]
}
