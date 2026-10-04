/** Persisted content collection for retention, fork publication and file export. */
import { describe, expect, it } from 'vitest'
import { fileAttachmentRefsInSessionEvents } from '../src/file-attachments.ts'

const ref = { attachmentId: 'sha256:fixture', name: 'report.txt', bytes: 3 }
const content = [{ type: 'file', attachment: ref }]
const message = { content }

describe('file attachment references in stored Session events', () => {
  it('retains shared ordinary messages once and preserves a different stored filename', () => {
    const events = [
      { type: 'user/message', data: { content } },
      ...['system/message', 'developer/message', 'tool/result', 'team/message/queued'].map(type => ({ type, data: { message } })),
      { type: 'tool/ptc-dispatch', data: { content } },
      { type: 'user/message', data: { content: [{ type: 'file', attachment: { ...ref, name: 'other.txt' } }] } },
    ]
    expect(fileAttachmentRefsInSessionEvents(events)).toEqual([ref, { ...ref, name: 'other.txt' }])
  })
  it('includes queued, compacted and failed-attempt completed blocks without retaining unfinished chunks', () => {
    const stream = [null, { type: 'other' }, { type: 'chunk', chunk: null },
      { type: 'chunk', chunk: { type: 'block-start', block: { type: 'file', attachment: { ...ref, name: 'unfinished.txt' } } } },
      { type: 'chunk', chunk: { type: 'block-end', block: content[0] } }]
    for (const event of [
      { type: 'agent/inbox/spliced', data: { inserted: [null, message] } },
      { type: 'compaction/summary', data: { summary: content, rawOutput: content } },
      { type: 'assistant/message', data: { message, stream } },
      { type: 'assistant/attempt', data: { stream } },
    ]) expect(fileAttachmentRefsInSessionEvents([event])).toEqual([ref])
  })
  it('keeps unknown payloads opaque and tolerates unrelated content carriers', () => {
    expect(fileAttachmentRefsInSessionEvents([null, [], {}, { data: null },
      { type: 'extension/private', data: { content } },
      { type: 'agent/inbox/spliced', data: { inserted: {} } },
      { type: 'tool/result', data: { message: null } },
      { type: 'assistant/attempt', data: { stream: {} } },
      { type: 'user/message', data: { content: null } },
      { type: 'user/message', data: { content: [null, [], 'text', { type: 'text', text: 'no file' }] } },
    ])).toEqual([])
  })
  it('refuses declared invalid file metadata instead of omitting the reference', () => {
    for (const attachment of [null, [], {}, { ...ref, attachmentId: 1 }, { ...ref, attachmentId: '' },
      { ...ref, name: null }, { ...ref, name: '' }, { ...ref, bytes: '3' },
      { ...ref, bytes: 1.5 }, { ...ref, bytes: -1 }]) {
      expect(() => fileAttachmentRefsInSessionEvents([
        { type: 'user/message', data: { content: [{ type: 'file', attachment }] } },
      ])).toThrow('invalid declared file attachment reference')
    }
  })
  it('refuses contradictory immutable bytes across the same stored reference', () => {
    expect(() => fileAttachmentRefsInSessionEvents([
      { type: 'user/message', data: { content: [...content, { type: 'file', attachment: { ...ref, bytes: 4 } }] } },
    ])).toThrow('conflicting immutable file attachment reference')
  })
})
