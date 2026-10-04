/** File retention must become durable before a Session log publishes its references. */
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId, FileReferenceOwnerId, type FileAttachmentRef, type FileReferenceOwner } from '@deepseek-ai/dsh-attachment'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, SessionSeq, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import { generationLogPath } from '../src/format.ts'

const ref: FileAttachmentRef = { attachmentId: AttachmentId('sha256:retention-test'), name: 'shared.txt', bytes: 3 }
const fixtures: { ctx: Context; root: string }[] = []

async function mount(commit?: (owner: FileReferenceOwner, refs: readonly FileAttachmentRef[]) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-retention-'))
  const ctx = new Context()
  fixtures.push({ ctx, root })
  if (commit !== undefined) ctx.provide('attachments', { commitFileReferences: commit } as never)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return { ctx, root }
}

function fileLog(): SessionEvent[] {
  return oneTurnLog().map((event): SessionEvent => event.type === 'user/message'
    ? { ...event, data: freezeMessage({ id: MessageId('file-retention-user'), role: 'user', source: { kind: 'user' }, content: [{ type: 'file', attachment: ref }] }) }
    : event)
}

function pathFor(root: string, header: SessionHeader): string {
  return generationLogPath(root, header.cwd, header.id, header.version, 'none')
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.ctx.fiber.dispose()
    const target = resolve(fixture.root)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('dsh-jsonl-retention-')) throw new Error('unexpected retention fixture directory')
    await rm(target, { recursive: true, force: true })
  }
})

describe('JSONL file reference publication', () => {
  it('withholds the first artifact until retention commits and keeps the owner after closing', async () => {
    let release = () => {}
    let entered = () => {}
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const called = new Promise<void>((resolve) => { entered = resolve })
    const commit = vi.fn(async () => { entered(); await waiting })
    const { ctx, root } = await mount(commit)
    const header = meta('retention-parent')
    const handle = await ctx.sessionPersistence.create(header)
    const append = handle.append(fileLog())
    await called
    await expect(stat(pathFor(root, header))).rejects.toMatchObject({ code: 'ENOENT' })
    release()
    await append
    await handle.close()
    expect(commit).toHaveBeenCalledExactlyOnceWith({ kind: 'session', id: FileReferenceOwnerId(header.id) }, [ref])
    expect((await stat(pathFor(root, header))).isFile()).toBe(true)
  })

  it('publishes a fork only after the inherited file is retained by its own Session id', async () => {
    const commit = vi.fn(async () => {})
    const { ctx } = await mount(commit)
    const parent = meta('retention-parent')
    const parentHandle = await ctx.sessionPersistence.create(parent)
    const events = fileLog()
    await parentHandle.append(events)
    await parentHandle.close()
    const child = { ...parent, id: SessionId('retention-child'), parentSession: parent.id, isSeeded: true }
    const childHandle = await ctx.sessionPersistence.create(child, { inheritedEventCount: SessionLogOffset(events.length) })
    await childHandle.append([...events, { type: 'session/end-seed', seq: SessionSeq(events.length), time: 7, data: { inherited: true } }])
    await childHandle.close()
    expect(commit.mock.calls).toEqual([
      [{ kind: 'session', id: FileReferenceOwnerId(parent.id) }, [ref]],
      [{ kind: 'session', id: FileReferenceOwnerId(child.id) }, [ref]],
    ])
  })

  it('leaves no artifact when retaining a declared file fails', async () => {
    const { ctx, root } = await mount(async () => { throw new Error('retention unavailable') })
    const header = meta('retention-failed')
    const handle = await ctx.sessionPersistence.create(header)
    await expect(handle.append(fileLog())).rejects.toThrow('retention unavailable')
    await handle.close()
    await expect(stat(pathFor(root, header))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects file publication without a provider while ordinary text remains supported', async () => {
    const { ctx, root } = await mount()
    const header = meta('retention-missing')
    const handle = await ctx.sessionPersistence.create(header)
    await expect(handle.append(fileLog())).rejects.toThrow('file references require an attachment provider')
    await handle.close()
    await expect(stat(pathFor(root, header))).rejects.toMatchObject({ code: 'ENOENT' })
    const text = await ctx.sessionPersistence.create(meta('retention-text'))
    await text.append(oneTurnLog())
    await text.close()
  })
})
