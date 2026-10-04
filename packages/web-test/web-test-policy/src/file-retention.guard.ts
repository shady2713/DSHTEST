/** Decide file-retention effects at the attachment service entry. */

import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { consumeFilePublisherCall } from '@deepseek-ai/dsh-attachment/file-publisher'
import type { WebTestEffect } from './effects.ts'
import { decorateMethod } from './backstop.ts'
import { WebTestPolicyError } from './errors.ts'

/**
 * Guard staged writes, producer mutations, leases, and deletion on one provider.
 * @param attachments - actual mounted attachment provider.
 * @param refuse - deployment policy decision and refusal.
 * @returns exact effect disposers for every installed guard.
 */
export function guardFileRetention(
  attachments: AttachmentStore,
  refuse: (entry: string, effect: WebTestEffect) => void,
): (() => void)[] {
  const publisherOnly = (entry: string): never => {
    throw new WebTestPolicyError('web-test-policy/denied', `web testing policy refused "${entry}": file retention requires its owning Host producer`)
  }
  return [
    decorateMethod(attachments, 'stageEncodedFile', original => async function (this: AttachmentStore, input) {
      refuse('attachments.stageEncodedFile', { kind: 'write-upload' })
      return original.call(this, input)
    }),
    decorateMethod(attachments, 'stageFile', original => async function (this: AttachmentStore, input) {
      if (!consumeFilePublisherCall(this, 'stageFile', [input])) refuse('attachments.stageFile', { kind: 'write-upload' })
      return original.call(this, input)
    }),
    decorateMethod(attachments, 'stageFileStream', original => async function (this: AttachmentStore, input) {
      if (!consumeFilePublisherCall(this, 'stageFileStream', [input])) refuse('attachments.stageFileStream', { kind: 'write-upload' })
      return original.call(this, input)
    }),
    decorateMethod(attachments, 'commitFileReferences', original => async function (this: AttachmentStore, owner, refs) {
      if (!consumeFilePublisherCall(this, 'commitFileReferences', [owner, refs])) publisherOnly('attachments.commitFileReferences')
      return original.call(this, owner, refs)
    }),
    decorateMethod(attachments, 'releaseFileReferences', original => async function (this: AttachmentStore, owner) {
      if (!consumeFilePublisherCall(this, 'releaseFileReferences', [owner])) publisherOnly('attachments.releaseFileReferences')
      return original.call(this, owner)
    }),
    decorateMethod(attachments, 'releaseFileStage', original => async function (this: AttachmentStore, ticket) {
      if (!consumeFilePublisherCall(this, 'releaseFileStage', [ticket])) publisherOnly('attachments.releaseFileStage')
      return original.call(this, ticket)
    }),
    decorateMethod(attachments, 'acquireFileReadLease', original => async function (this: AttachmentStore, refs, signal) {
      if (!consumeFilePublisherCall(this, 'acquireFileReadLease', [refs, signal])) {
        refuse('attachments.acquireFileReadLease', { kind: 'read-upload' })
      }
      return original.call(this, refs, signal)
    }),
    decorateMethod(attachments, 'readFileStream', original => function (this: AttachmentStore, ref, signal) {
      if (!consumeFilePublisherCall(this, 'readFileStream', [ref, signal])) {
        refuse('attachments.readFileStream', { kind: 'read-upload' })
      }
      return original.call(this, ref, signal)
    }),
    decorateMethod(attachments, 'deleteFile', original => async function (this: AttachmentStore, ref) {
      refuse('attachments.deleteFile', { kind: 'write-upload' })
      return original.call(this, ref)
    }),
  ]
}
