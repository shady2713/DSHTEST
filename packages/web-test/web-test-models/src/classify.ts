/**
 * Turn one real request's failure into the one classification a caller acts on.
 *
 * The classifier reads the harness's own `LlmFailure` — a stable `code`, an
 * optional HTTP `status`, and the provider's own text — and never a credential
 * value. What it returns is the *next action*, so the discriminator is always
 * who is at fault: the key, the addressed model, the account's money, the
 * request, the route's declared capabilities, or the provider's own server.
 *
 * Two rules settle the cases no single token can. **An explicit reading of the
 * actor beats an incidental mention of it**: a body that says the reference is
 * refused is a credential refusal even when it also names a model, and a body that
 * only links a help page about models names no model at all. That reading also
 * beats a spent account, because topping up a balance does not help when the key
 * itself is refused. **A status narrows the field, it does not decide it**,
 * except where the status *is* the answer — `415` names the input type in its
 * own name, `402` names the payment the account owes, and a `5xx` is the provider
 * reporting itself, so nothing a `5xx` body says about the model, the key, or the
 * account the request carried is a fact about any of them.
 *
 * A third rule is what a `4xx` is. It is the provider refusing the request as it
 * was sent, so its body is read wherever the provider writes it — a refusal
 * wording is not a `403` fact, and `400` is the status providers use most often
 * for one. And because a byte-identical request is refused identically, no `4xx`
 * is `transient`: the only `4xx` that support a later attempt are the three whose
 * own names decline to have the request processed *now*.
 *
 * The order in {@link classifyFailure} is the contract; each step below states
 * what it settles and what a later step may no longer overturn.
 *
 * @module @deepseek-ai/dsh-web-test-models/classify
 */

import {
  ACCOUNT_QUOTA_EXCEEDED_CODE,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  INVALID_CREDENTIAL_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  QUOTA_EXCEEDED_CODE,
} from '@deepseek-ai/dsh-llm'
import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import type { ConnectionVerdict } from './types.ts'

/** Canonical code the credential-bearing providers raise for an absent key. */
export const MISSING_CREDENTIAL_CODE = 'MISSING_CREDENTIAL'

/** Canonical code the routing layer raises when no adapter serves the address. */
export const NO_ADAPTER_CODE = 'NO_ADAPTER'

/** Canonical code a route raises when the adapter cannot resolve the exact model. */
export const INVALID_MODEL_INFO_CODE = 'INVALID_MODEL_INFO'

/** Codes the harness raises about the reference itself, before any provider text exists. */
const CREDENTIAL_CODES: ReadonlySet<string> = new Set([MISSING_CREDENTIAL_CODE, INVALID_CREDENTIAL_CODE])

/** Codes naming the addressed model itself as the thing the provider will not serve. */
const MODEL_CODES: ReadonlySet<string> = new Set([NO_ADAPTER_CODE, INVALID_MODEL_INFO_CODE])

/** Codes that state the account, or the request, rather than the route. */
const ACCOUNT_CODES: ReadonlySet<string> = new Set([QUOTA_EXCEEDED_CODE, ACCOUNT_QUOTA_EXCEEDED_CODE])

/** Wording providers use when the route cannot carry the modality the request carried. */
const MODALITY_WORDS = /\b(?:image|vision|multimodal|multi-modal|input[_ -]?type|unsupported[_ -]?media|does not support)\b/iu

/**
 * Wording providers use when the addressed model is not served on this route.
 *
 * The unavailability alternative is scoped to a region deliberately. A provider
 * that says a model is not available *at this time* is asking for a later request,
 * so that wording stays `transient`; a region refusal is permanent for the route it
 * arrives on, and re-choosing a model is the only action that clears it. The two
 * wordings are not the same statement, so the bare `not available` form is not here.
 */
const MODEL_WORDS = new RegExp(
  String.raw`\b(?:model[_ -]?not[_ -]?found|unknown model|invalid model|does not exist`
  + String.raw`|model_not_found|no such model|model is deprecated|deprecated model`
  + String.raw`|model has been retired|not available in (?:your|this|the) region)\b`,
  'iu',
)

/**
 * Wording that says the reference itself is what the provider refused.
 *
 * Two kinds of alternative are here, and both are a judgement of the caller rather
 * than of anything the request addressed. Most name the key and judge it
 * (`invalid api key`, `api key is expired`). The rest state the outcome the
 * reference got rather than a fault in it: unauthenticated (`unauthorized`,
 * `unauthorised`, `authentication`, `not authorized`, `not authorised`) or refused
 * outright (`permission denied`, `access denied` — the same statement in the
 * wording a gateway uses for a refused resource, and a refused resource is what a
 * reference is refused). A bare mention of a key — the noun in "your api key has
 * exceeded its rate limit" — is none of these, so it is not here.
 */
const CREDENTIAL_WORDS = new RegExp(
  String.raw`\b(?:unauthorized|unauthorised|not authorized|not authorised|authentication`
  + String.raw`|invalid[_ -]?api[_ -]?key|incorrect api key|malformed api key|revoked api key|expired api key`
  + String.raw`|api[_ -]?key (?:is |was |has been )?(?:invalid|incorrect|malformed|revoked|expired|missing)`
  + String.raw`|permission denied|access denied)\b`,
  'iu',
)

/**
 * Wording a provider uses when a working key is refused one thing rather than the API.
 *
 * Every alternative here names a *thing the caller may not have*, so each one only
 * becomes a model answer through the conjunction with {@link MODEL_TARGET}. The
 * `permit` family carries both the bare form and the `does not` / `doesn't`
 * inflections because a provider writes either for the same fact, and a missing
 * inflection would report a refusal of a named model as a refusal of the
 * reference. The `use` family is kept rather than narrowed for the same reason:
 * `may not use`, `cannot use` and their contractions are the wording a gateway
 * writes when it refuses one API, and dropping them would refuse live wordings to
 * gain symmetry. `not authorized` is deliberately *not* here: it is the same word as
 * `unauthorized`, which judges the caller rather than a thing, so it belongs to
 * {@link CREDENTIAL_WORDS} and reads the same at every status.
 *
 * One alternative names a *key* rather than a model — "your api key does not have
 * access to model gpt-4o" — and reads as that model here. A key-scoped allowlist
 * refusal is between "use another key" and "use another model", and the token
 * does not say which; it is read the same way as the account-scoped refusal above,
 * which is the same ambiguity recorded for `org-9f2b` in {@link MODEL_TARGET}.
 */
const ENTITLEMENT_WORDS = new RegExp(
  String.raw`\b(?:insufficient permissions?|no permission|not permitted|permission to use`
  + String.raw`|not entitled|not allowed|does not permit|doesn't permit`
  + String.raw`|may not use|must not use|cannot use|can't use|is not available to`
  + String.raw`|no access to|has no access to|does not have access to|doesn't have access to)\b`,
  'iu',
)

/**
 * A compound provider identifier: `-` or `_` joined alphanumeric segments carrying
 * a digit, with no other character allowed anywhere in the token.
 */
const MODEL_ID = String.raw`(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+`

/**
 * A model named the way a provider names one: the word itself, or a **compound
 * provider identifier**.
 *
 * A compound identifier is a token built only from letters, digits, `-` and `_`,
 * joined by at least one `-` or `_`, every one of its segments alphanumeric, and
 * carrying at least one digit. Whether a provider wraps it in quotes is irrelevant,
 * so a quoted identifier qualifies by the same token and a quoted sentence does not
 * qualify at all. The rule is stated on the token's own construction rather than on
 * any list of hosts: a `.` or a `/` is what introduces a dotted address, a dotted
 * version, or a path, so a token carrying one is an address, a version, or a path,
 * and a bare number with no separator is a count or a port rather than a name.
 * `gpt-4o-vision-preview`, `deepseek-v4-pro` and `gpt-5-turbo` all qualify, and so
 * does the word `model` itself, which a provider reaches for instead of naming the
 * id.
 *
 * A two-segment `<word>-<blob>` id such as `org-9f2b` is **not** separable from a
 * two-segment model id such as `gpt-4o`: both are one word, one separator, and one
 * digit-led segment, and nothing in the token says which it is. It is therefore
 * read as a model target, and the ambiguity is recorded here rather than resolved
 * by a prefix list that would only be right for the hosts someone happened to meet.
 */
const MODEL_TARGET = new RegExp(String.raw`\bmodels?\b|${MODEL_ID}`, 'iu')

/**
 * An entitlement refusal that names what the entitlement is about.
 *
 * Both halves are required and they must be in the same clause: the refusal
 * wording is what makes a refusal of an entitlement a model answer rather than a
 * key refusal, and the target is what keeps "Access denied. See our models page"
 * from reading as a model entitlement. The target need not be the word "model" —
 * a provider that refuses one id without saying so is still refusing that model.
 *
 * The filler between the two halves may not cross a comma, a colon, a bracket, or
 * a parenthesis, because each of those opens a list, a label, or an aside rather
 * than continuing the clause. Without that, "not permitted, see docs.example.com"
 * reads as one clause whose target is the documentation link.
 *
 * The target is spliced in as a grouped alternative. `MODEL_TARGET` is a top-level
 * alternation, and an ungrouped splice would make the later branches alternatives of
 * the *whole* pattern: a `403` whose only numeric token is a request id would then
 * be a model refusal with no refusal wording in the body at all, and the same
 * would hold of any other `4xx` that carried one.
 */
const MODEL_ENTITLEMENT = new RegExp(
  String.raw`\b(?:${ENTITLEMENT_WORDS.source})[^.;!?\n,:\[\]{}()]{0,80}?(?:${MODEL_TARGET.source})`,
  'iu',
)

/**
 * Wording for a spent account that {@link isQuotaExceededError} does not read.
 *
 * The harness's own matcher settles `insufficient quota|balance|credits` and a
 * `quota` or `usage limit` directly followed by `reached|exceeded|exhausted`. Two
 * families of terminal wording fall outside it, and both name the same fact in the
 * other word order or behind a longer phrase: a provider that puts the shortage
 * *after* the noun (`balance is insufficient`), and one that puts `reached` behind
 * a whole clause (`billing hard limit has been reached`) rather than directly after
 * the noun. Without these the account reads as retryable. The filler is thirty
 * characters because a provider states the clause between the noun and the verdict
 * in a sentence rather than a word. "rate" is deliberately absent: a limit on
 * requests per minute is answered by a later request, not by billing.
 */
const SPENT_ACCOUNT_WORDS = new RegExp(
  String.raw`\b(?:balance|credit|credits|billing)\b[^.;!?\n]{0,30}?\b(?:too\s+low|not\s+enough`
  + String.raw`|insufficient|exhausted|depleted|exceeded|reached|ran\s+out)\b`
  + String.raw`|\b(?:usage|quota)\b[^.;!?\n]{0,30}?\b(?:is\s+|was\s+|were\s+|has\s+been\s+)?`
  + String.raw`(?:reached|exceeded|exhausted|hit)\b`,
  'iu',
)

/** HTTP statuses a provider answers an unsupported input type with. */
const MODALITY_STATUS: ReadonlySet<number> = new Set([400, 415, 422])

/** The status whose own name is the answer that this account has to be paid. */
const PAYMENT_REQUIRED_STATUS = 402

/**
 * HTTP statuses whose own name asks the caller to make the request again later.
 *
 * Each of these three declines to have the request processed *now* rather than
 * refusing it as it was sent, so a later identical request may well succeed and
 * `transient` is the one verdict they support. `409` is deliberately not here:
 * "conflict" names a state the request disagrees with, not a wait, and reading it
 * as a later attempt would make an identical retry the instruction for a request
 * the provider has already refused.
 */
const LATER_ATTEMPT_STATUS: ReadonlySet<number> = new Set([408, 425, 429])

/**
 * Whether the provider answered by refusing the request as it was sent.
 *
 * Every `4xx` is such an answer, so a body arriving on one of these statuses is a
 * refusal rather than an unknown outcome, and that is also why none of them is
 * `transient`: the claim `transient` rests on is that a later identical request may
 * not repeat the failure, and a request the provider has already refused is refused
 * the same way again.
 * @param failure - the real request's failure facts.
 * @returns true when the status is a client error.
 */
function isClientError(failure: LlmFailure): boolean {
  return failure.status !== undefined && failure.status >= 400 && failure.status < 500
}

/**
 * Whether the status itself asks for the request to be made again later.
 * @param failure - the real request's failure facts.
 * @returns true when the status is one whose own name is that instruction.
 */
function isLaterAttempt(failure: LlmFailure): boolean {
  return failure.status !== undefined && LATER_ATTEMPT_STATUS.has(failure.status)
}

/**
 * Whether the provider is reporting its own server rather than judging the route.
 *
 * A `5xx` is a fact about the provider's process. Its body is whatever internal
 * sentence the failure path produced, and a word in that sentence is not a
 * judgement about the model, the modality, the key, or the account the request
 * carried.
 * @param failure - the real request's failure facts.
 * @returns true when the status is a server fault.
 */
function isServerFault(failure: LlmFailure): boolean {
  return failure.status !== undefined && failure.status >= 500
}

/**
 * Whether a failure states that the account's money is spent.
 *
 * A quota is an account-level fact, so it is read ahead of everything about one
 * model: no request on a spent account succeeds whatever it carries, whichever
 * address it addressed or which model it named. It is read *behind* an explicit
 * reading of the key, because topping up a balance does not help when the key
 * itself is refused, and the key is the instruction the operator can act on.
 * @param failure - the real request's failure facts.
 * @returns true when the code or the text says the quota, balance, or credit is spent.
 */
function isExhaustedFailure(failure: LlmFailure): boolean {
  return ACCOUNT_CODES.has(failure.code)
    || isQuotaExceededError(failure.message)
    || SPENT_ACCOUNT_WORDS.test(failure.message)
}

/**
 * Whether the request is one the addressed model cannot accept at all.
 *
 * A context overflow is settled here rather than with the transient failures
 * because a later identical request overflows again: "retry" would be a false
 * instruction, and the request is the thing that has to change.
 * @param failure - the real request's failure facts.
 * @returns true when the code or the text says the request exceeds the context window.
 */
function isContextOverflow(failure: LlmFailure): boolean {
  return failure.code === CONTEXT_WINDOW_EXCEEDED_CODE || isContextWindowExceededError(failure.message)
}

/**
 * Whether the text says the reference itself is what the provider refused.
 * @param failure - the real request's failure facts.
 * @returns true when the text explicitly reads the key as invalid or unauthenticated.
 */
function isCredentialWording(failure: LlmFailure): boolean {
  return CREDENTIAL_WORDS.test(failure.message)
}

/**
 * Whether a `4xx` refuses one model to a reference that otherwise worked.
 *
 * The refusal wording used to be read only at `403`, so the same two clauses read
 * one way there and reached `transient` at every other status, which made the
 * reading depend on a number the provider chose rather than on the sentence it
 * wrote. `400` is the status providers use most often for this class of refusal,
 * so the gap was the common case rather than an edge. The wording states the
 * refusal, so it is read wherever the provider states it.
 * @param failure - the real request's failure facts.
 * @returns true when a client error refuses an entitlement and names its target.
 */
function isModelEntitlement(failure: LlmFailure): boolean {
  return isClientError(failure) && MODEL_ENTITLEMENT.test(failure.message)
}

/**
 * Whether a `4xx` refuses the caller without naming what it refuses.
 *
 * Entitlement wording with no target in the same clause is a refusal of the
 * reference: a provider writes it when the key, the account, or the API as a whole
 * is the thing that may not be used. It is read behind {@link isModelEntitlement},
 * so a named target is that model, and ahead of the generic `4xx` reading below, so
 * that a body which does state a refusal is never reported as one this release
 * could not read.
 * @param failure - the real request's failure facts.
 * @returns true when a client error carries refusal wording naming no target.
 */
function isUntargetedRefusal(failure: LlmFailure): boolean {
  return isClientError(failure) && ENTITLEMENT_WORDS.test(failure.message)
}

/**
 * Whether a failure is the route refusing the modality the request carried.
 *
 * A text-only route answers an image request with the same status a malformed
 * request gets, so the wording is what separates them. `415` is the status whose
 * own name is the answer, `422` is a provider that parsed the payload and refused
 * it, and `400` is the status a text-only route uses for a request it cannot
 * accept. A status outside that set is not a capability answer however its body
 * reads, so a `403` carrying modality wording stays the refusal of the caller.
 *
 * It is read ahead of the untargeted refusal below because a provider may state
 * both facts in one sentence, and of those two the stronger claim is the one this
 * route cannot carry the image — the refusal wording beside it names nothing
 * specific, and would be read as the reference otherwise.
 * @param failure - the real request's failure facts.
 * @returns true when the status is one of those three and the text names an input type.
 */
function isModalityFailure(failure: LlmFailure): boolean {
  if (failure.status === undefined || !MODALITY_STATUS.has(failure.status)) return false
  return MODALITY_WORDS.test(failure.message)
}

/**
 * Classify one real request's failure.
 *
 * The order is the contract, and each step only overrules the ones above it for
 * a stated reason:
 *
 * 1. **Codes the harness raised.** A missing or malformed key and an adapter
 *    that cannot resolve its own model are facts about the route that exist
 *    before any provider text does, so a body cannot re-argue them.
 * 2. **A request the model cannot fit.** A context overflow is not retryable,
 *    so it is a refusal of the request rather than a transient failure. It is
 *    settled ahead of the status steps because a body that also reports a fault
 *    still describes a request that has to be shortened.
 * 3. **A `5xx`.** The provider is reporting its own server, so no reading of its
 *    body about a model, a modality, the key, or the account stands: a `5xx`
 *    quoting "insufficient quota" reports a fault in the sentence the failure
 *    path produced, not a fact about the balance.
 * 4. **Explicit credential wording.** Says the reference is the thing refused,
 *    which wins over any model, quota, or address named in the same sentence. It is
 *    read before exhaustion because both are account-level facts and the reference
 *    is the more actionable one: a balance can be topped up, a refused key cannot.
 *    It is read before a `404` for the same reason, so `404 unauthorized`,
 *    `404 "Access denied"`, and `404 "You are not authorized to perform this
 *    action."` are the same answer whatever status the provider reported them
 *    under.
 * 5. **Exhaustion.** An account-level fact outranks every fact about one model
 *    on that account: a `400` naming both a deprecated model and a spent quota is
 *    "pay", because no model on a spent account runs. The deliberate cost is
 *    that a model this provider no longer serves is reported as an account fact
 *    whenever the body also mentions a quota. It outranks the `404` below, so a
 *    gateway that answers a spent account with `404` is still read as "pay".
 *    `402` joins this step rather than getting one of its own because it is the
 *    status whose own name is the answer, exactly as `415` is for a modality, and
 *    a spent account stated in wording this matcher does not read still reads as
 *    "pay" there.
 * 6. **A `404`.** The request reached the provider's routing and the address is
 *    not there, which is a model answer whatever else the body echoes.
 * 7. **A `401`.** The provider refused the reference itself.
 * 8. **A model answer.** The routing codes already spoke in step 1; this is the
 *    body naming the model, and a `4xx` that refuses a named entitlement. The
 *    refusal is read at any `4xx` rather than at `403` alone: the body states the
 *    refusal, and a `400` carrying it is the same sentence a `403` carries, so
 *    gating the reading on a status the provider chose sent a permanently
 *    refused request to an unbounded retry. It is read here, ahead of modality,
 *    because a body that names the model is naming the thing being refused.
 * 9. **A modality answer**, which carries the stronger claim of the two when a
 *    provider states both facts in one sentence: this route cannot carry the
 *    image, where the refusal wording beside it names nothing specific.
 * 10. **A `4xx` that refuses the caller without naming a target.** Refusal
 *    wording with no target in the same clause is a refusal of the reference — of
 *    the key, the account, or the API as a whole — at whichever `4xx` it arrives.
 * 11. **A `403`.** Reached the provider, refused the caller, named no model and
 *    stated no refusal this release can read.
 * 12. **A `408`, `425`, or `429`.** The three statuses whose own names decline to
 *     have the request processed *now* rather than refusing it as it was sent, so
 *     a later identical request may well succeed. `409` is not among them: a
 *     conflict names a state the request disagrees with, not a wait.
 * 13. **Any other `4xx`.** The provider refused the request as it was sent, and
 *     this release read no cause in the body. The verdict is `rejected-request`
 *     because that is the action — change what is sent — and a byte-identical
 *     retry cannot clear a refusal. What it costs: that verdict is also the one
 *     for a request the addressed model cannot fit, so a `4xx` whose real remedy
 *     is a different model, a different reference, or billing is reported under
 *     the name of the request. `transient` was the alternative and it was worse —
 *     it claimed a later identical request may not repeat the failure, which a
 *     `4xx` cannot support.
 * 14. **Everything else as `transient`**: a transport failure, a success status on
 *     a contradictory failure object, a redirect, and any body this release has
 *     never seen. The only honest claim about one of those is that a later
 *     identical request may not repeat it.
 * @param failure - the failure the provider or transport produced.
 * @returns the classification a caller acts on.
 */
function classifyRawFailure(failure: LlmFailure): Exclude<ConnectionVerdict, { kind: 'ready' }> {
  if (CREDENTIAL_CODES.has(failure.code)) return { kind: 'rejected-credential', failure }
  if (MODEL_CODES.has(failure.code)) return { kind: 'rejected-model', failure }
  if (isContextOverflow(failure)) return { kind: 'rejected-request', failure }
  if (isServerFault(failure)) return { kind: 'transient', failure }
  if (isCredentialWording(failure)) return { kind: 'rejected-credential', failure }
  if (isExhaustedFailure(failure) || failure.status === PAYMENT_REQUIRED_STATUS) {
    return { kind: 'exhausted', failure }
  }
  if (failure.status === 404) return { kind: 'rejected-model', failure }
  if (failure.status === 401) return { kind: 'rejected-credential', failure }
  if (MODEL_WORDS.test(failure.message) || isModelEntitlement(failure)) return { kind: 'rejected-model', failure }
  if (isModalityFailure(failure)) return { kind: 'rejected-modality', failure }
  if (isUntargetedRefusal(failure)) return { kind: 'rejected-credential', failure }
  if (failure.status === 403) return { kind: 'rejected-credential', failure }
  if (isLaterAttempt(failure)) return { kind: 'transient', failure }
  if (isClientError(failure)) return { kind: 'rejected-request', failure }
  return { kind: 'transient', failure }
}

/**
 * Classify provider text privately and retain only a closed reason and numeric HTTP status.
 * @param failure - untrusted provider failure, which may echo credentials in any string field.
 * @returns detached safe failure fields; provider text, code, and request id are discarded.
 */
export function classifyFailure(failure: LlmFailure): Exclude<ConnectionVerdict, { kind: 'ready' }> {
  const kind = classifyRawFailure(failure).kind
  return { kind, failure: safeFailure(kind, failure.status) }
}

/** Safe text for each actionable failure; no provider response is copied. */
const SAFE_FAILURES = {
  'rejected-credential': 'The provider refused the credential. Replace or repair it.',
  'rejected-model': 'The provider does not serve the selected model.',
  'rejected-modality': 'The selected route cannot accept the required input modality.',
  'rejected-request': 'The provider refused the request. Change its input.',
  'exhausted': 'The provider account requires additional quota or credit.',
  'transient': 'The provider request could not complete. Retry later.',
} as const

/** Construct the only failure fields allowed in diagnostics or exports. */
function safeFailure(kind: keyof typeof SAFE_FAILURES, status: number | undefined): LlmFailure {
  return {
    code: kind,
    message: SAFE_FAILURES[kind],
    ...status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {},
  }
}

/**
 * Describe a verdict with safe closed text and a valid HTTP status.
 * @param verdict - failure classification, possibly supplied by another caller.
 * @returns secret-free diagnostic, without provider text or request identifiers.
 */
export function describeVerdict(verdict: Exclude<ConnectionVerdict, { kind: 'ready' }>): string {
  const failure = safeFailure(verdict.kind, verdict.failure.status)
  const status = failure.status === undefined ? '' : ` (HTTP ${String(failure.status)})`
  return `${verdict.kind}${status}: ${failure.message}`
}
