/**
 * One real request's failure lands in exactly one classification, and the
 * classification is the next action rather than the provider's own wording.
 */
import { describe, expect, it } from 'vitest'
import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import type { ProviderRequestId } from '@deepseek-ai/dsh-llm/brand'
import { brandString } from '@deepseek-ai/dsh-brand'
import { classifyFailure, describeVerdict } from '../src/classify.ts'

const failure = (over: Partial<LlmFailure> & Pick<LlmFailure, 'message' | 'code'>): LlmFailure => over

describe('classifyFailure', () => {
  it('reads a 401 as the credential even when the text also names a model', () => {
    const verdict = classifyFailure(failure({
      code: 'AUTH',
      status: 401,
      message: 'Authentication Fails, Your api key is invalid; model deepseek-chat not found',
    }))
    expect(verdict.kind).toBe('rejected-credential')
  })

  it('reads a 403 as the credential', () => {
    expect(classifyFailure(failure({ code: 'FORBIDDEN', status: 403, message: 'no' })).kind)
      .toBe('rejected-credential')
  })

  it('reads a 401 that names nothing as the credential', () => {
    // A bare `401` is the provider refusing the reference itself; no wording is
    // needed to reach that conclusion and a terse body must not become a
    // capability or an account answer.
    expect(classifyFailure(failure({ code: 'X', status: 401, message: 'nope' })).kind)
      .toBe('rejected-credential')
  })

  it('reads a 403 that names a model as that model, not as the key', () => {
    // The key authenticated and reached this refusal, so what it is not entitled
    // to is one model. Re-choosing a model is the action that helps; replacing
    // the key would not.
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'You have insufficient permissions for this model',
    })).kind).toBe('rejected-model')
  })

  it('reads a 403 that names no model as the credential', () => {
    expect(classifyFailure(failure({ code: 'FORBIDDEN', status: 403, message: 'this key may not use this API' })).kind)
      .toBe('rejected-credential')
  })

  it('reads a 403 whose body refuses the key itself as the credential, however it mentions a model', () => {
    // The key is the subject of the refusal, so replacing it is the action. A
    // model named inside that sentence is the object of the refusal, not its
    // subject, and "see our models page" is a link in a help sentence.
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'invalid api key: this key may not use model gpt-4o',
    })).kind).toBe('rejected-credential')
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'invalid api key supplied; see our models page',
    })).kind).toBe('rejected-credential')
  })

  it('reads a 403 that refuses one named model as that model, without the word "model"', () => {
    // An entitlement refusal names its target, and a target is a model id
    // whether or not the provider bothered to say the word.
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'You are not entitled to gpt-4o-vision-preview',
    })).kind).toBe('rejected-model')
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Your plan does not have access to deepseek-v4-pro',
    })).kind).toBe('rejected-model')
  })

  it('reads a 403 that refuses an API, not a model, as the credential', () => {
    // The entitlement wording alone is not a model answer: the refusal has to
    // name what the entitlement is about in the same clause, or it refused the
    // caller and the help sentence names no model.
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Insufficient permissions for this API. See our models page for what is available.',
    })).kind).toBe('rejected-credential')
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Insufficient permissions for this API',
    })).kind).toBe('rejected-credential')
  })

  it('reads a 403 whose body names neither an entitlement nor a model as the credential', () => {
    // A request id, a resource id, and a region name are tokens a model id is
    // also made of, so matching on "a token that is not a plain word" alone reads
    // a bare `403` as a model refusal. The entitlement half is what makes this
    // rule a model answer, and none of these bodies carries one.
    for (const message of [
      'Forbidden: request id 12345',
      'Access denied to resource 7f3a-22',
      'error 403 (region: eu-west-1)',
    ]) {
      expect(classifyFailure(failure({ code: 'FORBIDDEN', status: 403, message })).kind)
        .toBe('rejected-credential')
    }
  })

  it('reads a 403 that names its target past a sentence boundary as the credential', () => {
    // The two halves must be in one clause. A provider that refuses an account
    // and then points at a documentation page has refused the account, and the
    // model named in the next sentence is the object of the help link.
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Insufficient permissions. See our models page for what is available.',
    })).kind).toBe('rejected-credential')
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'not entitled to this account; the gpt-4o model is on another plan',
    })).kind).toBe('rejected-credential')
  })

  it('reads a 403 that names an address, a path, a port, or a quoted sentence as a refusal of the caller', () => {
    // Each of these is a token a provider model id is also built from, and none
    // of them is one. A `.` or a `/` is what introduces a host, a dotted version,
    // or a path; a bare number with no separator is a count or a port; and a
    // quoted sentence is not an id. The rule is the token's own construction, so
    // the documentation link inside a refusal names no model.
    for (const message of [
      'Request not permitted from IP address 10.0.0.1',
      'not permitted, see docs.example.com/limits for details',
      'Your account is not permitted to use the endpoint /v1/messages',
      'not permitted from port 8080',
      'not entitled to "Your request could not be processed"',
    ]) {
      expect(classifyFailure(failure({ code: 'FORBIDDEN', status: 403, message })).kind)
        .toBe('rejected-credential')
    }
  })

  it('reads a 403 that names a provider model id as that model, however the id is written', () => {
    // The rule is about the token, so every spelling of a real id still qualifies:
    // hyphen-joined, named beside the word "model", and quoted.
    for (const message of [
      'You are not entitled to gpt-4o-vision-preview',
      'not permitted to use deepseek-v4-pro',
      'Your plan does not permit this model, gpt-5-turbo',
      'not entitled to "gpt-4o-mini"',
      'not permitted to use the model claude-3',
    ]) {
      expect(classifyFailure(failure({ code: 'FORBIDDEN', status: 403, message })).kind)
        .toBe('rejected-model')
    }
  })

  it('reads a two-segment `<word>-<blob>` resource id as a model target, because no rule separates it from one', () => {
    // `org-9f2b` is one word, one separator, and one digit-led segment, exactly as
    // `gpt-4o` is, and nothing in either token says which it is. Excluding the
    // prefix would exclude every real two-segment model id with it, so this row
    // records the ambiguity the rule cannot remove rather than a preference.
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'not permitted for organization org-9f2b',
    })).kind).toBe('rejected-model')
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'not permitted to use gpt-4o',
    })).kind).toBe('rejected-model')
  })

  it('reads a plan that does not permit a named model as a refusal of that model', () => {
    // `does not permit` and its contraction are the same fact as the bare `not
    // permitted` this package already read, so a body naming the model it will
    // not serve is a model refusal at every inflected verb rather than only at the
    // one the vocabulary happened to carry.
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Your plan does not permit this model, gpt-5-turbo',
    })).kind).toBe('rejected-model')
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: "Your plan doesn't permit deepseek-v4-pro",
    })).kind).toBe('rejected-model')
    // The same verb with no named target is the caller being refused, not a model.
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: "Your plan doesn't permit this API",
    })).kind).toBe('rejected-credential')
  })

  it('reads "not authorized" as the reference at every status, so its two spellings agree', () => {
    // `unauthorized` and `not authorized` are one word, so they are one answer: a
    // judgement of the caller rather than of a named model. Reading one as a model
    // gave two spellings of the same sentence opposite verdicts at `404`, and sent
    // the `400` spelling to an unbounded retry of a request that fails identically
    // every time. Neither status may change it.
    for (const status of [400, 401, 403, 404]) {
      expect(classifyFailure(failure({ code: 'X', status, message: 'unauthorized' })).kind)
        .toBe('rejected-credential')
      expect(classifyFailure(failure({
        code: 'X',
        status,
        message: 'You are not authorized to perform this action.',
      })).kind).toBe('rejected-credential')
    }
  })

  it('reads the harness codes for a malformed or absent key as the credential', () => {
    expect(classifyFailure(failure({ code: 'MISSING_CREDENTIAL', message: 'no API key' })).kind)
      .toBe('rejected-credential')
    expect(classifyFailure(failure({ code: 'INVALID_CREDENTIAL', message: 'malformed' })).kind)
      .toBe('rejected-credential')
  })

  it('reads credential wording with no status as the credential', () => {
    expect(classifyFailure(failure({ code: 'X', message: 'invalid api key supplied' })).kind)
      .toBe('rejected-credential')
    expect(classifyFailure(failure({ code: 'X', message: 'Permission denied' })).kind)
      .toBe('rejected-credential')
  })

  it('reads a 404 as an unavailable model whatever its body says', () => {
    expect(classifyFailure(failure({ code: 'X', status: 404, message: '' })).kind)
      .toBe('rejected-model')
    // A gateway that hides a whole API path behind 404 still authenticated the
    // request, so an address this provider does not serve is the model answer.
    expect(classifyFailure(failure({ code: 'X', status: 404, message: 'no such endpoint' })).kind)
      .toBe('rejected-model')
    // A body that reads the key itself as refused is that reading wherever it
    // arrives: a key a provider will not accept is not fixed by another model,
    // and `CREDENTIAL_WORDS` already requires the key to be named and judged.
    expect(classifyFailure(failure({ code: 'X', status: 404, message: 'unauthorized' })).kind)
      .toBe('rejected-credential')
  })

  it('reads a 404 that states the account is spent as exhausted, not as a missing model', () => {
    // The account is spent whichever address the request reached, so "pay" is
    // the action; a 404 that quotes a quota is not a model answer.
    expect(classifyFailure(failure({
      code: 'X',
      status: 404,
      message: 'insufficient_quota for this endpoint',
    })).kind).toBe('exhausted')
  })

  it('reads the routing codes for an unserved model', () => {
    expect(classifyFailure(failure({ code: 'NO_ADAPTER', message: '' })).kind).toBe('rejected-model')
    expect(classifyFailure(failure({ code: 'INVALID_MODEL_INFO', message: '' })).kind).toBe('rejected-model')
  })

  it('reads model wording as an unavailable model', () => {
    expect(classifyFailure(failure({ code: 'X', status: 400, message: 'model_not_found' })).kind)
      .toBe('rejected-model')
    expect(classifyFailure(failure({ code: 'X', status: 400, message: 'That model is deprecated' })).kind)
      .toBe('rejected-model')
  })

  it('reads an availability refusal as transient, not as a model to re-choose', () => {
    // A provider reporting itself unavailable, and a provider saying this model
    // is unavailable for now, are both asking for a later request rather than a
    // different model. "not available" names availability, not a model's identity.
    expect(classifyFailure(failure({ code: 'X', status: 503, message: 'Service not available' })).kind)
      .toBe('transient')
    expect(classifyFailure(failure({
      code: 'X',
      status: 503,
      message: 'The model is not available at this time, please retry',
    })).kind).toBe('transient')
  })

  it('reads a model this route\'s region will not serve as that model, not as a retry', () => {
    // A region refusal is permanent for the route it arrives on, so re-choosing a
    // model is the action that clears it and "retry" is an instruction that never
    // succeeds. The wording is scoped to a region deliberately: a provider saying
    // a model is not available *at this time* is asking for a later request, which
    // is a different statement and stays `transient` at any status.
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'The engine (o1) is not available in your region.',
    })).kind).toBe('rejected-model')
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'deepseek-v4-pro is not available in this region',
    })).kind).toBe('rejected-model')
    expect(classifyFailure(failure({
      code: 'RATE_LIMIT',
      status: 429,
      message: 'The model is not available at this time, please retry',
    })).kind).toBe('transient')
  })

  it('reads a server fault as a server fault, whatever its body happens to name', () => {
    // A 5xx is the provider reporting itself. Its body can quote an internal
    // sentence that contains any word at all, and a word in that sentence is not
    // a judgement about the model the request addressed.
    expect(classifyFailure(failure({
      code: 'X',
      status: 500,
      message: 'internal error: unknown model in cache shard 7',
    })).kind).toBe('transient')
    expect(classifyFailure(failure({
      code: 'X',
      status: 502,
      message: 'bad gateway: model_not_found while reading the upstream table',
    })).kind).toBe('transient')
  })

  it('reads a 400 that names both a model and a spent quota as exhausted, because the account blocks every model', () => {
    // A deprecated model is a re-choose instruction, but nothing runs on a spent
    // account, so "pay" is the instruction that unblocks the most. Exhaustion is
    // an account-level fact and is settled before any fact about one model.
    const verdict = classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'model is deprecated; quota exhausted',
    }))
    expect(verdict.kind).toBe('exhausted')
  })

  it('reads explicit credential wording ahead of a spent account, because the key is the more actionable fact', () => {
    // Both halves are account-level, and topping up a balance does not help
    // when the key itself is refused, so the reading of the key wins.
    expect(classifyFailure(failure({
      code: 'FORBIDDEN',
      status: 403,
      message: 'your api key is invalid; quota exceeded',
    })).kind).toBe('rejected-credential')
  })

  it('does not read a bare key mention as a credential refusal, so a spent rate limit stays retryable', () => {
    // `CREDENTIAL_WORDS` requires the key to be named *and* judged, so a rate
    // limit stated against a working key is not stolen by the step above, and a
    // request-rate limit is not an account fact either.
    expect(classifyFailure(failure({
      code: 'RATE_LIMIT',
      status: 429,
      message: 'your api key has exceeded its rate limit',
    })).kind).toBe('transient')
  })

  it('reads a spent account the harness quota matcher does not name, rather than inviting a retry', () => {
    // `@deepseek-ai/dsh-llm`'s `isQuotaExceededError` reads `insufficient
    // quota|balance|credits` and `quota|usage limit reached|exceeded`, so these
    // two provider wordings reach `transient` without this package's own
    // matcher. Both are terminal account facts: nothing runs until it is paid.
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'Your credit balance is too low. Please top up',
    })).kind).toBe('exhausted')
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'Your usage limit was reached',
    })).kind).toBe('exhausted')
  })

  it('reads a spent account stated in the word order or the clause length the harness matcher does not name', () => {
    // `isQuotaExceededError` matches `insufficient (quota|balance|credits)` and
    // `quota|usage limit` directly followed by `reached|exceeded|exhausted`, so it
    // reaches neither of these: the first puts the shortage *after* the noun, the
    // second puts `reached` behind a whole clause rather than a word. Both are
    // terminal account facts, and "pay" is the instruction either way.
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'Billing hard limit has been reached. Please add funds to continue.',
    })).kind).toBe('exhausted')
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'Your account balance is insufficient to complete the request.',
    })).kind).toBe('exhausted')
  })

  it('reads a 402 as the account owing payment, whatever its body says', () => {
    // `402` is the status whose own name is the answer, exactly as `415` is for a
    // modality, and it had no step in the order at all — so a spent account
    // arriving with it depended entirely on wording this matcher does not read.
    expect(classifyFailure(failure({ code: 'X', status: 402, message: 'Payment required' })).kind)
      .toBe('exhausted')
    // Being an account-level step, it sits behind the reading of the reference: a
    // `402` that names the key as refused is still that.
    expect(classifyFailure(failure({ code: 'X', status: 402, message: 'invalid api key' })).kind)
      .toBe('rejected-credential')
  })

  it('does not read a request-rate limit as a spent account', () => {
    // "rate" is deliberately absent from this package's matcher: a limit on
    // requests per minute is answered by a later request, not by billing.
    expect(classifyFailure(failure({
      code: 'RATE_LIMIT',
      status: 429,
      message: 'rate limit reached, slow down',
    })).kind).toBe('transient')
  })

  it('reads a server fault as transient even when it quotes a spent account', () => {
    // A 5xx is the provider reporting its own process, so a quota phrase in that
    // internal sentence is not an account fact — the same reason a model name in
    // the same sentence is not a judgement about the route.
    expect(classifyFailure(failure({
      code: 'X',
      status: 500,
      message: 'upstream returned 400 insufficient quota for shard 3',
    })).kind).toBe('transient')
  })

  it('reads a request the addressed model cannot fit as a request refusal, not as retryable', () => {
    // A later identical request overflows again, so "retry" would be a false
    // instruction; the request is what has to change.
    expect(classifyFailure(failure({
      code: 'CONTEXT_WINDOW_EXCEEDED',
      status: 400,
      message: 'maximum context length is 8192 tokens',
    })).kind).toBe('rejected-request')
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'This model\'s maximum context length is 128000 tokens',
    })).kind).toBe('rejected-request')
    // A `400` overflow is answered by the generic `4xx` reading below whether or
    // not this step exists, so the step is load-bearing only where no `4xx` did:
    // an adapter that raises the code without a status, and a body carrying the
    // overflow with a status this release cannot read.
    expect(classifyFailure(failure({
      code: 'X',
      message: 'maximum context length is 8192 tokens',
    })).kind).toBe('rejected-request')
    expect(classifyFailure(failure({
      code: 'CONTEXT_WINDOW_EXCEEDED',
      message: '',
    })).kind).toBe('rejected-request')
  })

  it('keeps a 400 that names a model ahead of its modality and quota wording', () => {
    const verdict = classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'model_not_found: this model does not support image input',
    }))
    expect(verdict.kind).toBe('rejected-model')
  })

  it('reads an unsupported-input-type refusal as a modality mismatch at 400, 415, or 422', () => {
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'This model does not support image input',
    })).kind).toBe('rejected-modality')
    // 415 names the answer in the status itself, and the wording repeats it.
    expect(classifyFailure(failure({
      code: 'X',
      status: 415,
      message: 'unsupported media type: image/png is not an accepted input',
    })).kind).toBe('rejected-modality')
    // 422 is a provider validating a payload it parsed and refusing; the same
    // wording there is the same answer.
    expect(classifyFailure(failure({
      code: 'X',
      status: 422,
      message: 'unsupported media type',
    })).kind).toBe('rejected-modality')
    expect(classifyFailure(failure({
      code: 'X',
      status: 422,
      message: 'this route does not support image input',
    })).kind).toBe('rejected-modality')
  })

  it('does not read modality wording outside a 400, 415, or 422 as a modality mismatch', () => {
    // A 500 quoting the same sentence is a server fault, not a capability answer.
    expect(classifyFailure(failure({ code: 'X', status: 500, message: 'does not support image input' })).kind)
      .toBe('transient')
  })

  it('reads a 400 with no modality wording as a request refusal, not as a mismatch', () => {
    // The body names no input type, so this is not a capability answer. It is
    // also not a retry: a `400` is the provider refusing the request as it was
    // sent, and a byte-identical request is refused identically.
    expect(classifyFailure(failure({ code: 'X', status: 400, message: 'malformed request' })).kind)
      .toBe('rejected-request')
  })

  it('reads refusal wording at any 4xx, not only at 403', () => {
    // `ENTITLEMENT_WORDS` used to be reachable only through a `403`, so every
    // other status sent a body that plainly refuses the caller to `transient` —
    // an unbounded retry of a request that cannot succeed. A body that names a
    // model target in the same clause is that model; one that names no target
    // is the reference. `400` is the status providers use most often for this
    // class of refusal, and the two clauses below read the same at every 4xx.
    for (const status of [400, 422, 429, 418]) {
      expect(classifyFailure(failure({ code: 'X', status, message: 'not permitted to use model gpt-4o' })).kind)
        .toBe('rejected-model')
      expect(classifyFailure(failure({
        code: 'X',
        status,
        message: 'Your account is not permitted to use this API',
      })).kind).toBe('rejected-credential')
    }
    expect(classifyFailure(failure({ code: 'X', status: 400, message: 'Access denied to this resource' })).kind)
      .toBe('rejected-credential')
    expect(classifyFailure(failure({ code: 'X', status: 400, message: 'insufficient permissions' })).kind)
      .toBe('rejected-credential')
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'You are not entitled to gpt-4o-vision-preview',
    })).kind).toBe('rejected-model')
  })

  it('reads "Access denied" as the reference at every status, like "permission denied"', () => {
    // `permission denied` already judged the caller at every status, and
    // `access denied` is the same statement in the wording gateways use for a
    // refused resource. A refused resource is what a key is refused, so the
    // reading is the reference's whichever status carries it.
    for (const status of [400, 403, 404]) {
      expect(classifyFailure(failure({ code: 'X', status, message: 'Access denied' })).kind)
        .toBe('rejected-credential')
    }
    // It stays ahead of a named target for the reason `permission denied` does:
    // the caller is the subject of the sentence.
    expect(classifyFailure(failure({ code: 'X', status: 403, message: 'Access denied to resource 7f3a-22' })).kind)
      .toBe('rejected-credential')
  })

  it('reads a 4xx this release cannot read as a request refusal, because a retry cannot clear it', () => {
    // The claim `transient` rests on is that a later identical request may not
    // repeat the failure. A `4xx` cannot support that claim whatever this
    // release failed to read in the body: the provider refused the request as
    // it was sent. The verdict names the action — change the request — not a
    // cause, because a body with no readable refusal states no cause.
    for (const [status, message] of [
      [400, 'malformed request'],
      [400, 'the JSON body is not valid'],
      [400, 'invalid value for parameter top_p'],
      [400, 'content policy violation: this prompt was blocked'],
      [400, ''],
      [409, 'Conflict'],
      [413, 'Request Entity Too Large'],
      [416, 'Range Not Satisfiable'],
      [418, "I'm a teapot"],
      [422, 'unprocessable entity'],
      [422, 'field top_p must be <= 1'],
      [428, 'Precondition Required'],
    ] as const) {
      expect(classifyFailure(failure({ code: 'X', status, message })).kind)
        .toBe('rejected-request')
    }
  })

  it('reads a 408, 425, or 429 with no refusal wording as a retry, because the status name is the instruction', () => {
    // These three status names ask for a later attempt, so `transient` is the one
    // verdict they support: a request-rate limit is answered by a later request,
    // not by billing and not by a changed request. They are read behind the
    // refusal reading, so a `429` whose body states a refusal is that refusal.
    for (const status of [408, 425, 429]) {
      expect(classifyFailure(failure({ code: 'X', status, message: '' })).kind)
        .toBe('transient')
    }
    expect(classifyFailure(failure({ code: 'RATE_LIMIT', status: 429, message: 'rate limit reached, slow down' })).kind)
      .toBe('transient')
    expect(classifyFailure(failure({ code: 'RATE_LIMIT', status: 429, message: 'your api key has exceeded its rate limit' })).kind)
      .toBe('transient')
    // The body states a permanent refusal, so the status name does not overrule it.
    expect(classifyFailure(failure({ code: 'RATE_LIMIT', status: 429, message: 'not permitted to use this API' })).kind)
      .toBe('rejected-credential')
  })

  it('keeps a modality refusal ahead of the generic refusal fallback', () => {
    // A provider may state both facts in one sentence. Modality is read first
    // because `MODALITY_STATUS` already carries the stronger claim — this route
    // cannot carry the image — while the entitlement wording with no named
    // target is only a statement that the caller was refused.
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'This model does not support image input; your plan does not permit it',
    })).kind).toBe('rejected-modality')
    // A 415 whose body refuses the API rather than the media type is that
    // refusal: an explicit reading of the caller beats a status.
    expect(classifyFailure(failure({
      code: 'X',
      status: 415,
      message: 'Your account is not permitted to use this API',
    })).kind).toBe('rejected-credential')
  })

  it('reads a refusal of the image field as a request refusal, not as a capability answer', () => {
    // The body states a fact about how the request carries the image — this
    // scheme is not one the route will read — and not about whether the route
    // can carry images at all. `MODALITY_WORDS` names an input type or a
    // modality, and `image_url` is a field name, so this is not a capability
    // answer; the action is a changed request, which is `rejected-request`.
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'image_url must be one of the supported schemes',
    })).kind).toBe('rejected-request')
    expect(classifyFailure(failure({
      code: 'X',
      status: 422,
      message: 'image_url must be one of the supported schemes',
    })).kind).toBe('rejected-request')
  })

  it('reads a token-count overflow the harness matcher does not name as a request refusal', () => {
    // `isContextWindowExceededError` reads a maximum-context-length sentence and
    // not a comparison carrying both counts, so this body reached `transient`
    // and invited a retry that overflows again. It now needs no word list of its
    // own: the generic `4xx` reading already answers it, because a request that
    // overflows has to be shortened. That is what the quota matcher above is for
    // and this is not — "pay" and "shorten" are different actions, so a spent
    // account the shared matcher misses still needs a compensator.
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'prompt is too long: 210000 tokens > 200000 maximum',
    })).kind).toBe('rejected-request')
  })

  it('reads an exhausted quota as exhausted rather than retryable', () => {
    expect(classifyFailure(failure({ code: 'QUOTA', message: '' })).kind).toBe('exhausted')
    expect(classifyFailure(failure({ code: 'ACCOUNT_QUOTA', message: '' })).kind).toBe('exhausted')
    expect(classifyFailure(failure({ code: 'X', status: 402, message: 'Insufficient balance' })).kind)
      .toBe('exhausted')
  })

  it('reads quota wording that names a modality as exhausted, not as a mismatch', () => {
    // The account is spent whatever the request carried, so the action is "pay".
    expect(classifyFailure(failure({
      code: 'X',
      status: 400,
      message: 'insufficient quota for the image model',
    })).kind).toBe('exhausted')
  })

  it('reads a transport, rate limit, and unknown failure as transient', () => {
    expect(classifyFailure(failure({ code: 'TRANSPORT', message: 'transport failed' })).kind)
      .toBe('transient')
    expect(classifyFailure(failure({ code: 'RATE_LIMIT', status: 429, message: 'slow down' })).kind)
      .toBe('transient')
    expect(classifyFailure(failure({ code: 'SOMETHING_NEW', status: 503, message: 'unavailable' })).kind)
      .toBe('transient')
  })

  it('discards provider strings after classification', () => {
    const original = failure({ code: 'X', status: 500, message: 'boom', requestId: brandString<ProviderRequestId>('req-1') })
    const verdict = classifyFailure(original)
    expect(verdict.failure).not.toBe(original)
    expect(verdict.failure).toEqual({ code:'transient', status:500, message:'The provider request could not complete. Retry later.' })
  })
})

describe('describeVerdict', () => {
  it('names the classification and appends a status when the provider reported one', () => {
    expect(describeVerdict({ kind: 'transient', failure: { message: 'boom', code: 'X', status: 503 } }))
      .toBe('transient (HTTP 503): The provider request could not complete. Retry later.')
  })

  it('omits the status when the provider reported none', () => {
    expect(describeVerdict({ kind: 'transient', failure: { message: 'boom', code: 'X' } }))
      .toBe('transient: The provider request could not complete. Retry later.')
  })

  it('removes echoed secrets while preserving the credential classification', () => {
    // Provider echoes are discarded without reading the credential store.
    const verdict = classifyFailure(failure({
      code: 'AUTH',
      status: 401,
      message: 'Authentication Fails, Your api key: sk-review-synthetic-not-a-secret is invalid',
    }))
    expect(describeVerdict(verdict))
      .toBe('rejected-credential (HTTP 401): The provider refused the credential. Replace or repair it.')
  })
})

describe('safe failure fields', () => {
  it.each(['Invalid API key: synthetic-echo','request https://host/?api_key=synthetic-echo','Authorization: Bearer synthetic-echo'])('discards all response strings after classification: %s', (message) => {
    const result = classifyFailure({ code:'synthetic-echo', requestId:brandString<ProviderRequestId>('synthetic-echo'),message,status:401 })
    expect(result.kind).toBe('rejected-credential')
    expect(JSON.stringify(result)).not.toContain('synthetic-echo')
    expect(result.failure.status).toBe(401)
    expect(result.failure.requestId).toBeUndefined()
  })
  it.each([NaN,99,600,401.5])('does not export an invalid HTTP status %s', (status) => {
    expect(classifyFailure({ code:'X',message:'unavailable',status }).failure.status).toBeUndefined()
  })
})
