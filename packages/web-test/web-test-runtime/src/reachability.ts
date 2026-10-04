/**
 * Bounded, credential-free HEAD observations of explicitly registered entry URLs.
 * Redirect responses are observations; no second address is requested.
 * @module @deepseek-ai/dsh-web-test-runtime/reachability
 */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { ProjectId, Revision } from '@deepseek-ai/dsh-web-test-contracts'

/** One registered address's HTTP observation; no headers or body are retained. */
export type EntryUrlObservation =
  | { readonly declared: string; readonly state: 'response'; readonly statusCode: number }
  | { readonly declared: string; readonly state: 'timeout' | 'unreachable' | 'cancelled' }
  | { readonly declared: string; readonly state: 'unusable'; readonly reason: 'invalid-url' | 'unsupported-protocol' | 'credentials' }

/** Latest saved observation, with the exact project revision it describes. */
export interface StoredEntryUrlProbe {
  /** Published project whose registered addresses were requested. */
  readonly projectId: ProjectId
  /** Metadata revision checked; readers must compare it with the current revision. */
  readonly revision: Revision
  /** UTC instant at which all requested observations settled. */
  readonly checkedAt: string
  /** Registered addresses in declaration order, including failures and cancellations. */
  readonly entryUrls: readonly EntryUrlObservation[]
}

/**
 * Request one address without ambient credentials, cookies, redirects, or response bodies.
 * Every HTTP status, including redirects and 4xx/5xx, is a reachable response.
 * @param declared - exact address from the published project record.
 * @param timeoutMs - complete request deadline, including DNS and connection setup.
 * @param signal - cancellation owned by the caller and Runtime lifecycle.
 * @returns an observation after the request has closed; network failures do not reject.
 */
export async function observeEntryUrl(declared: string, timeoutMs: number, signal: AbortSignal): Promise<EntryUrlObservation> {
  if (signal.aborted) return { declared, state: 'cancelled' }
  let url: URL
  try {
    url = new URL(declared)
  } catch (_error) {
    return { declared, state: 'unusable', reason: 'invalid-url' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { declared, state: 'unusable', reason: 'unsupported-protocol' }
  }
  if (url.username !== '' || url.password !== '') {
    return { declared, state: 'unusable', reason: 'credentials' }
  }
  return new Promise((resolve) => {
    let observation: EntryUrlObservation = { declared, state: 'unreachable' }
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'HEAD', agent: false, headers: { Connection: 'close' },
    })
    const cancel = (): void => {
      observation = { declared, state: 'cancelled' }
      clearTimeout(deadline)
      request.destroy()
    }
    const deadline = setTimeout(() => {
      observation = { declared, state: 'timeout' }
      signal.removeEventListener('abort', cancel)
      request.destroy()
    }, timeoutMs)
    signal.addEventListener('abort', cancel, { once: true })
    request.once('response', (response) => {
      // Node's client parser supplies statusCode for every HTTP response.
      observation = { declared, state: 'response', statusCode: response.statusCode as number }
      clearTimeout(deadline)
      signal.removeEventListener('abort', cancel)
      response.destroy()
      request.destroy()
    })
    request.once('error', (_error) => {
      // Transport diagnostics can contain target credentials or host details;
      // the durable observation retains only the failure category.
    })
    request.once('close', () => {
      clearTimeout(deadline)
      signal.removeEventListener('abort', cancel)
      resolve(observation)
    })
    request.end()
  })
}
