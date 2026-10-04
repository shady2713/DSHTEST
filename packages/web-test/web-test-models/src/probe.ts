/**
 * Exact-provider connection tests through the owning adapter. Vision probes
 * require a trusted image admitted by the official attachment service; a text
 * request never verifies image capability. No fallback runs during a probe.
 * @module @deepseek-ai/dsh-web-test-models/probe
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmConfigurableProvider, LlmFailure, LlmResolvedModelInfo, StreamChunk, TokenUsage,
} from '@deepseek-ai/dsh-llm/types'
import { classifyFailure, describeVerdict } from './classify.ts'
import { probeFingerprint, routeCapabilities } from './fingerprint.ts'
import type { ProbeFingerprint } from './identity.ts'
import type { ConnectionReport, ConnectionVerdict, ModelRoute, RouteCapabilities } from './types.ts'
import type { ModelTaskType } from './task.ts'

/**
 * The prompt the probe sends.
 *
 * It is a fixed, content-free instruction: the probe asks the route to answer
 * with one word so a `ready` verdict means the provider produced assistant
 * content, and the request stays small enough that a refusal is about
 * authentication, the model, or the modality rather than about payload size.
 */
export const PROBE_PROMPT = 'Reply with the single word: ready.'

/** Output cap the probe requests, so a verification cannot cost a full completion. */
export const PROBE_MAX_TOKENS = 16

/**
 * The LLM faces the probe needs, declared as the narrowest seam that still
 * answers both questions.
 *
 * `LlmRuntime` satisfies this structurally, so the real runtime is what runs in
 * production, while a suite can hand in one whose `stream` yields fixed chunks
 * without casting a partial object to a service.
 */
export interface ProbeRuntime {
  /**
   * Stream one model call as raw chunks.
   * @param options - the request, addressed at one exact provider and model.
   * @returns the response's chunk stream.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  /**
   * Read the owning adapter's declaration for one exact model.
   * @param provider - the route's provider key.
   * @param model - the exact model id.
   * @param signal - caller cancellation for the adapter's own lookup.
   * @returns the adapter's declared metadata.
   */
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
}

/** What one probe observed, before the capability record is attached. */
export interface ProbeObservation {
  /** What the provider answered. */
  readonly verdict: ConnectionVerdict
  /** The provider's own request id, for a diagnostic the user can quote. */
  readonly requestId: string | null
  /** The token usage the response reported, when it reported one. */
  readonly usage: TokenUsage | undefined
  /** Whether the response carried at least one model-produced block. */
  readonly producedContent: boolean
  /** Digest of the request that was made. */
  readonly fingerprint: ProbeFingerprint
}

/**
 * Read one streamed response's terminal outcome and whether it produced content.
 *
 * The loop stops at the terminal `finish` chunk, because a finish reason is the
 * only place a provider states why it stopped, and it does not drain the rest of
 * a response whose outcome is already known.
 * @param stream - the adapter's chunk stream for the probe request.
 * @returns the terminal failure, or `undefined` when the response completed normally.
 */
async function readOutcome(
  stream: AsyncIterable<StreamChunk>,
): Promise<{ failure: LlmFailure | null; usage: TokenUsage | undefined; producedContent: boolean }> {
  let usage: TokenUsage | undefined
  let producedContent = false
  for await (const chunk of stream) {
    if (chunk.type === 'block-start') producedContent = true
    else if (chunk.type === 'usage') usage = chunk.usage
    else if (chunk.type === 'finish') {
      const reason = chunk.reason
      if (reason.kind === 'error' || reason.kind === 'aborted') {
        return { failure: reason.failure, usage, producedContent }
      }
      return { failure: null, usage, producedContent }
    }
  }
  return { failure: null, usage, producedContent }
}

/**
 * Run one real connection test against one route.
 *
 * The request is addressed at the exact provider and model the caller named, on
 * that provider's own protocol: there is no cross-provider fallback, because a
 * fallback would report a connection the caller did not ask about. A terminal
 * failure is classified; a completed response that carried no model-produced
 * block is reported as a transient failure, since a provider that answers with
 * nothing has not demonstrated a usable route.
 *
 * **A route that names no model is refused here, before any request is made.**
 * An empty model id reaches this function from two ordinary places: the catalog
 * stage records `model: ''` for a provider whose adapter registers no model, and
 * a provider whose `listModels` call fails contributes no models at all. Sending
 * either would address a real outbound request at a model that was never named,
 * and the provider's own answer to that malformed request would then be recorded
 * as a statement about the route — a fabricated capability conclusion drawn from
 * a question this release should not have asked. The verdict is
 * `rejected-request` because that member describes the request rather than the
 * provider: `rejected-model` would assert the provider does not serve a model
 * here, which is exactly the claim no evidence supports.
 * @param llm - the live LLM runtime the request goes through.
 * @param route - the exact provider, model, and credential reference to address.
 * @param taskType - the task type whose capability requirement this test belongs to.
 * @param signal - caller cancellation for this request.
 * @param image - trusted application-owned image admitted by the attachment service; vision probes require it.
 * @returns what the request proved, or what this release refused to send.
 */
export async function probeRoute(
  llm: ProbeRuntime,
  route: ModelRoute,
  taskType: ModelTaskType,
  signal?: AbortSignal,
  image?: ImageAttachmentRef,
): Promise<ProbeObservation> {
  const fingerprint = probeFingerprint(route, taskType)
  if (route.model === '') {
    return {
      verdict: {
        kind: 'rejected-request',
        failure: {
          message: `the route for ${route.provider} names no model, so no connection test was sent to any provider`,
          code: 'EMPTY_MODEL',
        },
      },
      requestId: null,
      usage: undefined,
      producedContent: false,
      fingerprint,
    }
  }
  if (taskType === 'vision' && image === undefined) {
    return {
      verdict: { kind: 'rejected-modality', failure: { code: 'VISION_PROBE_REQUIRED', message: 'A real image-input probe is required before this route is ready.' } },
      requestId: null, usage: undefined, producedContent: false, fingerprint,
    }
  }
  const content: import('@deepseek-ai/dsh-llm/types').ContentBlock[] = [{ type: 'text', text: PROBE_PROMPT }]
  if (taskType === 'vision' && image !== undefined) content.push({ type: 'image', attachment: image })
  const options = {
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({ source: { kind: 'user' }, content })],
    maxTokens: PROBE_MAX_TOKENS,
    ...signal === undefined ? {} : { signal },
  }
  const { failure, usage, producedContent } = await readOutcome(llm.stream(options))
  if (failure !== null) {
    return { verdict: classifyFailure(failure), requestId: null, usage, producedContent, fingerprint }
  }
  // A response that completed without any model-produced block has not
  // demonstrated a usable route, so it is reported as a transient failure.
  const verdict: ConnectionVerdict = producedContent
    ? { kind: 'ready', detail: `the provider answered on ${route.provider}/${route.model}` }
    : {
      kind: 'transient',
      failure: { message: 'the provider completed the request without producing any content', code: 'EMPTY_RESPONSE' },
    }
  return { verdict, requestId: null, usage, producedContent, fingerprint }
}

/**
 * Read the owning adapter's declaration for one exact model.
 *
 * The declaration is what a capability requirement is settled against, so it is
 * read from the adapter rather than inferred from a provider name. A route whose
 * adapter cannot resolve the model contributes a rejection rather than a
 * selection.
 * @param llm - the live LLM runtime.
 * @param route - the exact route to resolve.
 * @param signal - caller cancellation for the adapter's own lookup.
 * @returns the adapter's declared metadata.
 * @throws when the adapter cannot resolve the exact model; the caller turns the
 * refusal into a `rejected-model` route rejection.
 */
export async function declaredModel(
  llm: ProbeRuntime,
  route: ModelRoute,
  signal?: AbortSignal,
): Promise<LlmResolvedModelInfo> {
  return llm.resolveModelInfo(route.provider, route.model, signal)
}

/**
 * Build the connection report a caller renders or persists.
 *
 * The capability record is attached only to a `ready` verdict: a route that
 * refused has not earned a capability claim, and recording one beside a refusal
 * is how an unverified capability becomes a ready one.
 * @param route - the route the request addressed.
 * @param taskType - the task type the test belonged to.
 * @param observation - what the request proved.
 * @param model - the adapter's declared metadata for the route.
 * @returns the report.
 */
export function connectionReport(
  route: ModelRoute,
  taskType: ModelTaskType,
  observation: ProbeObservation,
  model: LlmResolvedModelInfo,
): ConnectionReport {
  const capabilities: RouteCapabilities | null = observation.verdict.kind === 'ready'
    ? routeCapabilities(model, observation.usage)
    : null
  return {
    route,
    taskType,
    verdict: observation.verdict,
    capabilities,
    requestId: null,
  }
}

/**
 * The provider directory entry that configures one route, when the adapter or
 * configuration registered one.
 * @param entries - the live configurable-provider directory.
 * @param provider - the route's provider key.
 * @returns the entry, or `undefined` when no configuration declares the route.
 */
export function entryFor(
  entries: readonly LlmConfigurableProvider[],
  provider: string,
): LlmConfigurableProvider | undefined {
  return entries.find(entry => entry.provider === provider)
}

/**
 * A one-line diagnostic for a whole report, chosen by verdict so a surface
 * renders the classification rather than re-deriving it.
 * @param report - the report to describe.
 * @returns the diagnostic text.
 */
export function describeReport(report: ConnectionReport): string {
  if (report.verdict.kind === 'ready') return report.verdict.detail
  return describeVerdict(report.verdict)
}
