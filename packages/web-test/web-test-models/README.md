---
description: "Web testing first-run model configuration and capability routing (ctx.webTestModels): real per-provider connection tests with classified failures, version-persisted task routes re-verified by a real request, and a recoverable wait for work a credential change interrupts"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test-models

English | [中文](README.zh.md)

## Summary

This package owns the one answer to "may this session run, and on what": which provider route each task type may use, and what a connection test actually proved. It tests every configured provider on its own protocol with a real request, classifies the outcome into a wrong key, an unavailable model, a modality mismatch, a request that has to change, an exhausted quota, or a transient failure, and binds each selection to a digest of the inputs its verification depended on. A credential change parks the work it interrupts in a recoverable wait that keeps its original route.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The composition mounts the service over the LLM runtime and the credentials service, and states the one deployment-varying choice: how long a stored selection stays verifiable.

```ts
import type { Context } from '@deepseek-ai/cordis'
import WebTestModels from '@deepseek-ai/dsh-web-test-models'
declare const ctx: Context
await ctx.plugin(WebTestModels, { verificationTtlMs: 600_000 })
// Official settings automatically persist selections and resolve provider apiKeyEnv references.
```

A caller asks for a route and gets either a selection or a closed reason:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ModelRoute, TaskRoute } from '@deepseek-ai/dsh-web-test-models'
declare const ctx: Context
declare function render(reason: Extract<TaskRoute, { kind: 'not-ready' }>['reason'], detail: string, rejected: Extract<TaskRoute, { kind: 'not-ready' }>['rejected']): void
declare function run(route: ModelRoute): Promise<void>
const decision = await ctx.webTestModels.selectRoute('analysis', { reverify: true })
if (decision.kind === 'not-ready') render(decision.reason, decision.detail, decision.rejected)
else await run(decision.selection.route)
```

### What is configurable and what is not

The verification window is configurable. Official settings persist `selections` and append-only `policies` under the models Loader entry. Provider credential references come from each directory entry's official `settingsNs` and `settingsPath`; missing persistence fails explicitly. Readiness, capability minima, and recoverable credential waits cannot be relaxed by configuration.

## Further Exploration

- [`.artifacts/web-testing/upgrade-v02/m1-t04-a/real-connection-evidence.md`](../../../.artifacts/web-testing/upgrade-v02/m1-t04-a/real-connection-evidence.md) — the executed real-provider rows, the route each one addressed, and the classification it produced.

<a id="understand-the-implementation"></a>
## Understand the implementation

### The classification order is the contract

One real request produces one classification, and the order decides it.

1. **Codes the harness raised.** A missing or malformed key, and an adapter that cannot resolve its own model, are facts that exist before any provider text does.
2. **A request the model cannot fit.** A context-window overflow is not `transient`, because repeating it overflows again; the request is what has to change. It is settled before the status steps because a body that also reports a fault still describes a request that has to be shortened.
3. **A `5xx`.** The provider is reporting its own server, so no reading of its body about a model, a modality, the key, or the account stands — `500 internal error: unknown model in cache shard 7` and `500 upstream returned 400 insufficient quota for shard 3` are both server faults, because a `5xx` is a fact about the process that produced the sentence, not about the route the request addressed.
4. **Explicit credential wording.** A body that says the reference itself is refused wins over any model, quota, or address named in the same sentence: `invalid api key: this key may not use model gpt-4o` is a credential, and so is `invalid api key supplied; see our models page`, where "models" sits in a help sentence. Most alternatives name the key and judge it (`invalid api key`, `api key is expired`); the rest state the outcome the reference got rather than a fault in it — unauthenticated (`unauthorized`, `unauthorised`, `authentication`, `not authorized`, `not authorised`) or refused outright (`permission denied`, and `access denied`, which is the same statement in the wording a gateway uses for a refused resource). All of them judge the caller, and none of them is the noun in `your api key has exceeded its rate limit`, which is a working key that hit a request-rate limit and is therefore `transient`. This step sits above exhaustion and above `404` because topping up a balance does not help when the key itself is refused, and because `404 unauthorized`, `404 "Access denied"`, and `404 "You are not authorized to perform this action."` are one statement read one way: the spelling cannot change the answer, and the same body at `400` is this too rather than a retry.
5. **Exhaustion.** An account-level fact outranks every fact about one model on that account: a `400` naming both a deprecated model and a spent quota is "pay", because no model on a spent account runs. A `QUOTA` or `ACCOUNT_QUOTA` code, a `404` whose body states a quota, and provider wordings the harness's own `isQuotaExceededError` does not read all land here. `402` joins this step rather than taking one of its own, because it is the status whose own name is the answer exactly as `415` is for a modality, and it had no step in the order at all — so a spent account arriving with it used to depend entirely on wording. `Your credit balance is too low. Please top up` and `Your usage limit was reached` are outside that matcher; `Billing hard limit has been reached` and `Your account balance is insufficient` put the verdict after the noun or behind a whole clause rather than next to it. "rate" is deliberately excluded, because a limit on requests per minute is answered by a later request rather than by billing.
6. **A `404`.** The request reached the provider's routing and the address is not there, which is a model answer whatever else the body echoes, because a request that reached it already authenticated. A quota statement is settled in step 5, so it survives this step.
7. **A `401`.** The provider refused the reference itself, whatever the body also names.
8. **A model answer.** The body naming the model, or a `4xx` that refuses a *named entitlement*: entitlement or permission wording followed, in the same clause, by what the entitlement is about. The refusal is read at **any** `4xx`, not at `403` alone: the body states the refusal, so `400 "not permitted to use model gpt-4o"` and `400 "not permitted to use this API"` are the same two sentences a `403` produces, and gating the reading on a number the provider chose sent a permanently refused request to an unbounded retry — `400` being the status providers use most often for this class of refusal. Both halves are still required, so a body with no refusal wording is not one however many digits it contains — `Forbidden: request id 12345`, `Access denied to resource 7f3a-22`, and `error 403 (region: eu-west-1)` all name no refusal. A named target is a **compound provider identifier** — letters, digits, `-` and `_` only, joined by at least one separator, every segment alphanumeric, carrying a digit — or the word `model` itself, and the target need not be the word: `You are not entitled to gpt-4o-vision-preview` names one, while `Insufficient permissions for this API. See our models page.` names none. The rule is the token's own construction rather than a list of hosts, so `gpt-4o-vision-preview`, `deepseek-v4-pro`, `gpt-5-turbo` and a quoted `"gpt-4o-mini"` all qualify, while a dotted address, a `host/path` documentation link, a bare port, and a quoted sentence do not: a `.` or a `/` is what introduces a host, a dotted version, or a path, and a bare number with no separator is a count or a port. The filler between the two halves may not cross a comma, a colon, or a bracket either, because each opens a list, a label, or an aside rather than continuing the clause. One shape stays ambiguous and is read as a model target: a two-segment `<word>-<blob>` id such as `org-9f2b` is indistinguishable from a two-segment model id such as `gpt-4o`, and excluding the prefix would exclude every real two-segment model id with it.
9. **A modality answer**, which carries the stronger claim when a provider states both facts in one sentence: `400 "This model does not support image input; your plan does not permit it"` is a capability answer, because the refusal wording beside it names nothing specific and would be read as the reference otherwise. Only `400`, `415`, and `422` can be one, so a `403` carrying modality wording stays the refusal of the caller.
10. **A `4xx` that refuses the caller without naming a target.** Refusal wording with no target in the same clause is a refusal of the reference — of the key, the account, or the API as a whole — at whichever `4xx` it arrives, so `400`, `422`, `429`, and `418` carrying `Your account is not permitted to use this API` are all `rejected-credential`, and a `429` that states a refusal is that refusal rather than the retry its status name suggests.
11. **A `403`.** Reached the provider, refused the caller, named no model, and stated no refusal this release can read.
12. **A `408`, `425`, or `429`.** The three statuses whose own names decline to have the request processed *now* rather than refusing it as it was sent, so a later identical request may well succeed. `409` is not among them: a conflict names a state the request disagrees with, not a wait.
13. **Any other `4xx`.** The provider refused the request as it was sent and this release read no cause in the body, so the verdict is `rejected-request`: that is the action — change what is sent — and a byte-identical retry cannot clear a refusal. This step also answers a request the addressed model cannot fit at a `400`, which is how `400 "prompt is too long: 210000 tokens > 200000 maximum"` stopped being a retry without a word list of its own. What it costs: `rejected-request` is also the verdict for a request the model cannot fit, so a `4xx` whose real remedy is a different model, a different reference, or billing is reported under the name of the request. `transient` was the alternative, and it claimed a later identical request may not repeat the failure — which no `4xx` supports.
14. **Everything else as `transient`**: a transport failure, a redirect, a success status on a contradictory failure object, and any body this release has never seen. The only honest claim about one of those is that a later identical request may not repeat it.

Three rules make the ambiguous statuses decidable. An explicit reading of the actor beats an incidental mention of it, which is what separates a key refusal that happens to name a model from a model entitlement. And a status narrows the field without deciding it, except where the status *is* the answer: `415` names the input type in its own name, `422` is a provider that parsed a payload and refused it, `400` is what a text-only route answers, and a `5xx` never judges the route, the key, or the account. The third is what a `4xx` is: the provider refusing the request as it was sent. Its body is therefore read wherever the provider writes it, and no `4xx` is `transient`, because the claim `transient` rests on — that a later identical request may not repeat the failure — cannot hold for a request that has already been refused.

### A capability is declared or it is not

Selection is capability-matched, and the requirement is settled before a request is spent. A task type names the modality it needs; a candidate is admitted only when the owning adapter declared that modality. An adapter that declared nothing is not a text-only route — it is a route whose capability is unknown, and unknown does not satisfy a requirement. A text-only route therefore never serves a vision task, and the task type reports `capability-absent` instead of being sent somewhere that cannot read an image.

`toolUpdate` is carried through from the adapter's own declaration. Cache-token reporting is not a provider trait this package asserts: it is read from the token usage the probe's real response reported, so a route whose provider reported no cache fields is recorded as having none, and no surface can promise a caching benefit across providers this package did not measure.

### A selection is bound to what it was verified against

A selection is ready because a real request answered on inputs that still hold. The persisted record carries the chosen provider and model, this release's schema version, the verification instant, and a SHA-256 digest over the provider directory entry, the adapter's resolved exact-model metadata, and the route's credential reference. A record whose live digest differs is re-verified by a new real request before it is served again; a caller that will not pay for a request is told `reverification-required` instead.

The recorded modality list is a fact the digest cannot carry, so it is compared against the live declaration rather than assumed. The digest covers what the adapter publishes *about* the model; the capability record carries the modality list beside it in the same file, and a hand-edited list therefore keeps a valid digest. A record whose list differs from what the adapter declares now — wider or narrower — is refused as `reverification-required` rather than read as `capability-absent`, because only a real request says which of the two is current and the live declaration may well carry the modality the record lacks. One stored record is also compared against the clock it is served on: an instant later than now satisfies any window, so a `verifiedAt` this host's clock reads as future is refused instead of being served as freshly verified.

A settings document is a file a user can hand-edit, so every field a consumer reads is checked rather than assumed: the schema version, the digest, the route and its credential reference, the capability record and each of its fields, the task type, and the verification instant. A record this release cannot read — a `capabilities.inputModalities` typed as the string `"image"`, a modality it does not route, a reference outside the credential grammar, a task type outside the closed union, or a `null` under a task type's key — is not a selection. It re-verifies by a real request when the caller allows one and is reported `reverification-required` when it does not; it is never served as written, and a record stored under a key its own task type contradicts is refused the same way. A refused value costs that one task type its decision and nothing else, so one hand edit cannot take out the whole survey. A requirement is met only by a *list* of modalities, so a string can never satisfy one.

### A credential change parks work; it does not drop it and does not reroute it

`credentials/reference-updated` moves every running ticket whose pinned route resolves keys through that reference into a recoverable wait. The ticket keeps its identity, its task type, its original route, and the reference that interrupted it; a second change does not restart the wait, and work pinned to a different reference keeps running. Resuming runs a real request against *that* route and either returns that same route or reports that the wait continues. Selection is never re-run during a resume, so no in-flight request can change models, and `WorkRegistry.resume` refuses a report addressed to any other route or carrying a refusal rather than an answer.

The wait survives the other operations too. Reporting a parked unit finished is refused: work interrupted mid-flight has not finished, and settling it would drop it out of the wait, so the ticket keeps its route, its park reason, and the reference that interrupted it until it resumes or is dropped by `forgetWork` — the one way a caller ends a parked unit it has decided not to resume, and no claim that the work finished. When a decision mixes a refusal with a capability the catalog stage already ruled out, the top line names both populations, so it never claims a route failed a connection test that never reached one.

A credential change invalidates stored verification and parks affected tickets without selecting another route. Configuration, planning, and resume require the credential generation observed before their probe to remain unchanged through the durable write and readiness publication. A change during either the post-probe model lookup or the write requires a new probe; an older pending write cannot clear that invalidation or restore readiness by overwriting a newer verified record. Parked tickets remain recoverable through `waitingWork` and `resumeWork` on their original routes.

### The credential reference is a name, never a value

A route carries the `CredentialRef` its provider profile resolves keys through, and that name is what makes a credential change attributable to the work it affects. This service never reads or stores a credential value and never places one in a request: the read half a surface uses is `CredentialInfo`, which has no value slot, and the probe's own request is built from a route and a task type, so a value reaches the provider only inside the adapter, from the credential provider that owns it.

Provider failures are classified using their original text privately. All returned failures, diagnostics, and exports contain only a closed reason and a valid HTTP status; free-form messages, codes, request ids, endpoint query strings, and Authorization text are discarded. No credential store is read for redaction.

### A policy is a rule set; a selection is a verified fact

`RouteSelection` answers "did this route answer". `RoutePolicyRevision` answers the other question — for this kind of task, which route, what fallback, what timeout, which validator, which escalation condition — and the two coexist. A rule set with no verification is unproven, and a verification with no rule set says nothing about the next task of the same kind, so neither replaces the other. Each carries its own schema version, side by side: a selection is `web-test-routes/1` and a policy is `web-test-route-policy/1`, and a record under either version this release does not know is read as unreadable rather than coerced.

A policy names the task kind, the capabilities a route must declare before this kind may be sent to it, the primary and fallback routes with the exact model version each one pins, the input-generation version, the request and whole-task deadlines, the validators a result must pass, and the conditions under which the run stops and hands over. Nothing in it was proven by a request, which is exactly what separates it from a selection.

**Immutability is the reason the fields are `readonly`.** A run is admitted under one revision and reads its `routeRevision` and result ownership from the record that admitted it, so a later revision cannot re-own work that is already in flight. Repairing a credential writes a new value under a reference; the reference is a name, so the recorded choice stays byte-identical. A model or capability change therefore *issues a new revision* rather than rewriting the current one — which is what makes "no silent hot-swap" checkable rather than aspirational.

**A route that cannot do the work is refused, never downgraded.** `satisfiesPolicy` returns the capabilities a candidate route is missing rather than a route to send it to instead, because a fallback chosen for being available rather than for being able to read the image is the failure `requiredCapabilities` exists to prevent. The same rule governs the stored read: `parseStoredPolicy` checks every field it hands out, refuses a record whose routes name no model, and returns `undefined` so the caller re-issues the policy from live configuration instead of running a run under rules it could not read.

**A timeout is a recoverable failure and a cancellation is a control result.** Both fire the same `AbortSignal`, so `classifyDeadline` tells them apart by elapsed time against the policy's own deadlines or by an explicit cancellation, never by the signal alone, and a timeout carries `recoverable: true` because the remedy is another request on the fallback route. `deadlineDecision` therefore sends an expired request to the declared fallback and escalates when there is none, and no timeout is ever reported as a cancellation. A validator rejection is likewise never reported as a model refusal: the model answered, and the answer failed a check this policy declares, so `validateAgainst` returns its own decision type rather than routing the result through the connection verdicts. A validator the policy did not declare is not silently run either — the run escalates rather than widening its own rules.

A persisted selection requires its first real verification after application startup, because a credential may have changed while the application was stopped. After that successful write, the configured verification window allows reuse within the running application; observed credential changes invalidate that reuse.

Reuse belongs to the complete selection record verified in this process. A status read spanning a credential change returns not ready; another route's successful save cannot validate that read's older record.

`selectRoute(taskType, { reverify: false })` and `survey` with the same option only report reusable persisted selections. Missing, unreadable, stale or unsuitable records return not ready without model probes or persistence writes. Callers must explicitly use `reverify: true` or `configureRoute` to verify and save a route.

`getPolicy(kind)` strictly reads the latest persisted revision; `issuePolicy` probes primary and fallback routes against every required capability before appending an immutable revision. `admitPolicy` re-verifies the primary, then returns a frozen `PolicyRecord` and a credential-wait ticket. `exact-value` never dispatches a model. Parsed lists and admitted routes are independent copies.

### Six task kinds, and the three task types they map onto

The kinds are finer than the modality-bearing task types this package routes, so each kind names the type whose requirement it satisfies rather than pretending to be one:

| taskKind | Task type | Default capability | Escalates to |
|---|---|---|---|
| `requirements` | `analysis` | text input | the user, when a source or rule conflicts |
| `candidate-selection` | `analysis` | text input | the session, by re-observing or waiting |
| `visual-inspection` | `vision` | image input | the session, by re-observing or waiting |
| `exact-value` | none | deterministic parsing | the user, when the semantics are undefined |
| `defect-explanation` | `analysis` | text input | the session, by refusing an ungrounded result |
| `skill-draft` | `analysis` | text input | the user, who confirms the diff |

`exact-value` names no task type and requires no capability, because its rule is deterministic parsing and comparison and "do not introduce model judgment where unnecessary" is the rule: dispatching it to a text model would add exactly the judgment it forbids. A kind this release does not route is refused by `requireForKind` and reported absent by `knownTaskKind` — never answered with the nearest kind, which is the same silent downgrade the capability check prevents.

<a id="model-experience"></a>
## Model Experience

### Admitted effects

#### What the model sees

Nothing. A route that is ready runs the request it always ran. Selection adds no Session event and no model input of its own; it changes which provider and model the loop addresses before the request is built, so a cached prefix stays valid across a selection that re-verified an unchanged route.

#### Token effect

Only the probe's own minimal request costs tokens, and only when a selection is verified rather than served from a stored record still inside `verificationTtlMs`.

#### KV Cache effect

None from the policy itself. The recorded `reportedCacheTokens` is an observation about the provider's response, not a change to any request this package makes.

### Refused effects

#### What the model sees

A task type with no usable route is never dispatched, so the model sees nothing rather than an error. The closed reason and the diagnostic go to the surface that asked, and each rejection carries the route it was about and why it was not chosen.

#### Token effect

None. A refused task type is never dispatched, so the probe that would have verified a candidate route never runs.

#### KV Cache effect

None. A refused task type issues no request, so it neither adds a prompt prefix to cache nor invalidates one.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when this package is a poor fit. They are current package constraints, not a task backlog.

- **Vision readiness requires image input.** The application supplies `probeImage` through official attachment admission. A missing image returns `rejected-modality` before any request; an actual image block and adapter declaration are both required.
- **An adapter that synthesizes metadata for an unlisted model makes `rejected-model` undetectable through that adapter.** The DeepSeek adapter resolves any model id and defaults its modalities to text, so `INVALID_MODEL_INFO` never fires for it and an unavailable model is only observable from the provider's own answer — which needs a usable key. Until then such a route is rejected as a connection failure. The classification itself is reachable through another adapter's `NO_ADAPTER` / `INVALID_MODEL_INFO`, or through a provider `404`; what is missing is a real provider producing one.
- **A context overflow outside the harness matcher's shapes is answered by the generic `4xx` reading.** `400 "prompt is too long: 210000 tokens > 200000 maximum"` used to be `transient`, so a caller could retry a request that fails identically. `isContextWindowExceededError` matches `maximum context length`, `too long for this model`, and `exceed(s|ed) … context`, but not a token-count comparison with the two counts in the body. It is now `rejected-request`, and it needs **no** word list of its own: the generic `4xx` reading already answers it, because a request that overflows has to be shortened. That is what separates it from the quota matcher above, which *is* a compensation for a gap in `isQuotaExceededError` — "pay" and "change what is sent" are different actions, and only the second one is what a generic `4xx` says.
- **The closed verdict set has no member that names a refusal on legal or policy grounds.** `451 "Unavailable For Legal Reasons"` with no readable wording is `rejected-request`, the least wrong member available: the action really is "do not send this request again as it is", but it is filed under the request rather than under the restriction behind it.
- **A transport fault answered with a `4xx` reads as a request refusal.** A gateway answering `400` with `upstream connect error or disconnect/reset before headers` or `Connection reset by peer` is `rejected-request`, not `transient`. The harness's own `TRANSPORT` code never carries a status on a real request — there was no response to read one from — so no signal separates that from a genuine `400`, and a word list for it would be guessing at provider wording with no observation behind it.
- **A route that names no model is refused locally, before any request is sent.** The catalog stage records `model: ''` for a provider whose adapter registers no model, and a provider whose `listModels` call fails contributes no models at all, so this row is ordinary rather than exceptional. Streaming either would address a real outbound request at a model that was never named, and the provider's own answer to that malformed request would then be recorded as a statement about the route. `probeRoute` therefore returns `rejected-request` with code `EMPTY_MODEL` and never calls `llm.stream`; the verdict is that member rather than `rejected-model` precisely because it describes the request instead of asserting that the provider does not serve a model here.
- **A `200` on a failure object is read as the body says.** `200 "internal error: insufficient quota"` is `exhausted`. A failure carrying a success status is a contradictory input, and the classifier reads the text; no expectation is made that a provider produces one.
- **A scheme refusal is read as a request refusal.** `400 "image_url must be one of the supported schemes"` is `rejected-request`, not `rejected-modality`, because the body states a fact about how the request carries the image — this scheme is not one the route will read — and not about whether the route can carry images at all; `MODALITY_WORDS` names an input type or a modality, and `image_url` is a field name. The cost is that the verdict names the action without naming the edit: the remedy is a changed request, such as an inline scheme, and the body does not say which.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published. The three things a companion would compare — the live provider directory, the live adapter declaration, and the stored selection — are each read by exactly one method, and the decision a caller acts on is that method's return value rather than a second observation that could diverge from it.

The registry is in-process by design. A parked ticket names work the user is still looking at, and it is a fact about the running session rather than a durable authorization; the durable record of *which route was verified* is the persisted selection, not this queue.
