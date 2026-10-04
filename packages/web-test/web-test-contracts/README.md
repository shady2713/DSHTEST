---
description: "The shared Web testing type boundary: branded identities, request schemas, field-naming Remote errors, and the generated contract Remote that Runtime, policy, Client, and executors all consume."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test-contracts

English | [中文](README.zh.md)

## Summary

This package owns the single type boundary the Web testing product shares: the branded identities configuration, project metadata, storage, and policy exchange; the request and receipt records those domains send; the Remote failures that name the field a caller got wrong; and the Service Definition whose `@Remote` methods the Typert generator turns into the Client types. It is a declarations and validation package. It does not persist, does not connect a model, does not drive a browser, and grants no authorization — the Runtime, the model configuration, the policy service, and the executors consume what it validates.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

A consumer imports the contract once and calls the service over the generated Remote. Each method validates its request field by field and returns the branded record; a rejected request raises a `web-test/*` failure whose `details.field` names what to correct.

```ts
import type { Context } from '@deepseek-ai/cordis'
import { WebTestContracts } from '@deepseek-ai/dsh-web-test-contracts'
declare const ctx: Context
// The Host mounts the Service Definition; a Client reaches it as
// ctx.remote.webTestContracts.registerProject({ request }).
const contracts = new WebTestContracts(ctx)
const registration = contracts.registerProject({
  commandId: 'cmd-1',
  codeRoots: ['C:\\projects\\shop', 'C:\\projects\\shop-api'],
  entryUrls: ['http://localhost:3000/checkout', 'http://localhost:4000/cart'],
})
```

A project may declare several code roots and several already-started URLs. A declaration is made once over the whole registered set rather than one per root, so the login, the test-environment flag, and the requirements the user added are facts about that one environment.

### Remote methods

| Method | Validates | Returns |
|---|---|---|
| `registerProject` | command token, code roots, already-started entry URLs | `ValidatedProjectRegistration` |
| `submitRecord` | command token, record identity, the caller's last read revision | `ValidatedRecordSubmission` |
| `confirmEnvironmentDeclaration` | every code root the project registered, the entry URL, the test-environment flag, the login, and the added requirements | `EnvironmentDeclaration` |
| `confirmEnvironment` | project identity, command token, and its nested declaration | `ValidatedEnvironmentConfirmation` |
| `evaluatePolicy` | policy request plus the confirmed declaration | `PolicyDecision` |

`evaluatePolicy` reports only whether a declaration the user already confirmed covers a request. It is an input to the policy service, never an authorization it grants: a `true` here does not permit a source write, an out-of-scope action, or an expired authorization. A target is covered when **any** declared root covers it, and a root covers itself and the paths beneath it, not a sibling whose name merely starts with the root's characters — so `C:\projects\shop` does not cover `C:\projects\shop-evil`, and declaring a second root widens coverage to that root and nothing else.

### What one declaration carries

`EnvironmentDeclaration` holds the facts a user states and ordinary inference cannot stand in for:

| Field | What it records |
|---|---|
| `codeRoots` | every absolute code root the project registered, in the order declared |
| `entryUrl` | the absolute URL the user already started, or `null` |
| `isTestEnvironment` | whether this is a test environment rather than production |
| `login` | `not-required`, or `required` with the `accountLabel` naming the account holding it — a label, never a password, token, or key |
| `supplementaryRequirements` | requirements the user added on top of what the trees and URLs declare |

The roots are a set the user declared together, so they are confirmed together and a grant made against one declaration applies to all of them. A caller wanting different environments for different trees confirms them as separate declarations, which gives each its own identity. Changing the roots, the login, or the requirements makes a new declaration identity, which is what makes every grant made against the old one inapplicable.

### Identities and revisions

Every identity crossing a process, storage, or wire boundary is branded, so a project identity cannot be passed where a run identity is expected and a persisted revision cannot be confused with a resource's own counter. The brands are compile-time only — `brandString` and `brandNumber` return the value unchanged, so equality, logging, and JSON serialization keep primitive behavior.

| Identity | Format | Raised by |
|---|---|---|
| `ProjectId` | `project-` + 32 hex | `evaluatePolicy`, `confirmEnvironment` |
| `ProjectRevisionId` | `project-rev-` + 32 hex | storage, when a project revision is committed |
| `RunId` | `run-` + 32 hex | storage, when a run is created |
| `RunPlanRevisionId` | `plan-rev-` + 32 hex | storage, when a plan is committed |
| `CommandId` | `cmd-` + 1–64 word characters | every write command |
| `RecordId` | `record-` + 32 hex | `submitRecord` |
| `Revision` | positive safe integer | compared before a later write |

### Failures

| Code | Raised when | `details` |
|---|---|---|
| `web-test/invalid-field` | a field's value breaks a rule | `field`, `reason` |
| `web-test/missing-field` | a required field is absent | `field` |
| `web-test/unknown-field` | a field the schema does not define was sent | `field` |

`field` is a dotted path that names the exact element when one broke, for example `entryUrls[1]`, `codeRoots[0]`, or `declaration.isTestEnvironment`, so a caller corrects one field rather than guessing. A list that holds more roots than `MAX_CODE_ROOTS` allows is refused against `codeRoots[16]` — the first root that has no slot — rather than truncated, so a caller adding roots one at a time learns which one to drop.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/index.ts` is the Service Definition and the only place the Remote surface is declared; the generator derives the Client types and the runtime invocation descriptors from those `@Remote` methods, so a hand-written mirror DTO would be a second home. `src/records.ts` declares the wire records and the identity formats. `src/ids.ts` declares the branded identities and the revision number. `src/fields.ts` holds the field-level readers that brand an identity or raise the field-naming failure. `src/parse.ts` composes those readers into one parser per schema. `src/errors.ts` extends the protocol's merge-extensible `RemoteErrorDetailsMap`, so a consumer discriminates on `code` and reads `details.field` without a cast.

| File | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | Service Definition, the `@Remote` surface, and the declaration-scope evaluation. |
| [src/records.ts](src/records.ts) | Request, validated, receipt, and policy-decision records; identity formats and bounds. |
| [src/ids.ts](src/ids.ts) | Branded identities and the revision number. |
| [src/fields.ts](src/fields.ts) | Field-level readers that brand a value or name the field it refused. |
| [src/parse.ts](src/parse.ts) | One parser per request schema, composed from those readers. |
| [src/errors.ts](src/errors.ts) | The `web-test/*` failure codes and the field-naming rejections. |
| — | No runtime invariant companion is published; this package holds no mutable state and no event stream that could diverge, and its Remote regression proves the same validation the parsers do. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These owners define the contracts this package validates and the services that consume them.

- [Typert protocol](../../typert/protocol/README.md) — the Remote decorators, protocol maps, and one failure class every owner throws.
- [Typert generator](../../typert/generator/README.md) — how the Client declarations and invocation descriptors are emitted.
- [API Gateway reference](../../../docs/api-gateway.md) — how a generated Remote call reaches a Host method.
- [Application identity](../web-test/README.md) — the data root, profile, and Loader entry this application owns.
- [Remote regression](tests/remote.spec.ts) — the contract reached over the real Registry, Gateway, and Connection carrier.
- [Rejection regression](tests/rejection.spec.ts) — one illegal-input case per schema, each naming its field.
- [Multiple-roots regression](tests/multi-root.spec.ts) — several roots admitted, each bound naming its element, and coverage across all of them.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package declares types and validates wire requests; nothing it defines constructs model context or reaches a model request.

#### KV Cache effect

No direct effect; a consumer places these records in a request only if its own contract does.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The sub-item this package implements is not accepted, and the work that remains belongs to the cards named below. Read this list so a green test is not read as a delivered product.

- No Target or Broker API is declared, and no final-state schema for a case, assertion, report, or browser target is pre-built. The first consumer of each decides its shape; a schema with no consumer today is not a contract.
- Persistence is not implemented: `submitRecord` validates a submission and returns the parsed request, and the authoritative commit, the outbox, and the reopen path belong to the Runtime card.
- `evaluatePolicy` compares a request against a declaration the caller passes in. It reads no stored project, enforces no protected path, and issues no authorization; the policy service owns those and consumes this result.
- No cancellation, event subscription, or release contract is declared yet, because no current consumer needs one. A consumer that does must go through this package's owner rather than adding a parallel signature.
- Reachability is a recorded fact, not a probe. This package validates the declaration a user confirmed — including whether the environment needs a login — and nothing here contacts a declared URL. The host-side read that judges whether a declared target is usable lives in the Runtime, and it judges an address and a path without reaching the network. An unreachable target therefore keeps its record and is never reported as ready; a URL that does not answer is something the user states, not something the product discovers.
- The generated Client declarations are emitted by the repository build from the Service Definition. The generated artifacts are build output and are not committed; the [Remote regression](tests/remote.spec.ts) exercises the source-mode descriptors the Gateway derives from the same `@Remote` markers.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The wire request is a plain record and the service method takes `Record<string, unknown>`, because a Remote request arrives as untrusted JSON and the static parameter type would otherwise promise validation the wire does not perform. Each parser is the boundary that turns those values into branded records, so a new field must be added to the record, the reader, and the parser together — the single-home regression fails when a `@Remote` method is added without a matching record.

</details>
