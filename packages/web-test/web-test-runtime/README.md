---
description: "The Web testing single domain writer (ctx.webTestRuntime): control-root identity and Windows exclusive lock, the reservation/publish creation protocol, strict project reads, and the commit-time notification outbox on the webtest storage domain."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test-runtime

English | [中文](README.zh.md)

## Summary

This package owns the persistence authority the Web testing product shares: a control root's stable identity and the Windows exclusive lock that admits exactly one writer, the three-stage protocol that turns a project registration into a published entry point, the staged-update protocol that changes an already published project without ever making it unreadable, strict reads of what the catalog head publishes, and the outbox each commit fills. It is the single writer of Web testing business state. It does not dispatch a browser action, coordinate attachments, or decide policy. Every later test action reads and writes through `ctx.webTestRuntime`.

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

The Host mounts the service with the control root the composition chose. The service claims the root's Windows named kernel object before it opens any authoritative domain, so a second writer on the same root is refused rather than degraded to an in-process guard.

Set `storageMode: generation-json` in the application profile to register a dedicated JSON backend beneath the locked generation's `dataRoot`; unrelated domains keep their existing backend. `storageMode: configured` uses the composition's existing domain route. Initialization failures release the lock after closing any backend created by this writer.

`windowsRenameDelaysMs` configures atomic publication retries for prototype activity and the Runtime-owned generation JSON backend. The default `[20, 40, 80, 160]` permits four retries after the first attempt; `[]` permits one attempt. Only Windows `EACCES`, `EBUSY`, and `EPERM` are retried. The already flushed and closed temp file is renamed again with identical bytes; business operations are never retried. An exhausted revocation write keeps the in-process admission gate stopped, preserves the previous durable cut and UNKNOWN records, and does not acknowledge durable revocation. A failed temp cleanup preserves the primary publication error. A separately configured storage backend retains its own policy.

`saveSessionProject` persists an official `SessionId` and its published project. `saveEnvironment` persists the complete user declaration at the current project revision, refusing missing roots, unregistered URLs and stale revisions. Their read methods restore facts only; reopening a session never restores authorization. The added `sessions` and `environments` tables are empty when reading an existing version-2 domain.

`probeEntryUrls(projectId, expectedRevision, signal?)` explicitly checks only that revision's registered URLs. It sends one credential-free HEAD request at a time, never follows redirects, and retains neither response headers nor bodies. Any HTTP response, including 4xx, 5xx, and redirects, is saved as `response` with its status code; failed, timed-out, invalid, and cancelled addresses remain in declaration order. The latest observation is durable in `entry_url_probes`, which is empty for older domains. `readEntryUrlProbe` reads that saved observation without network requests; its `revision` may be older than the current project. A project revision change before publication refuses the check instead of saving stale work. Runtime disposal cancels requests and waits for their saved cancellation before closing storage.

Set `entryUrlProbeTimeoutMs` to the complete per-address deadline, including DNS and connection setup; the validated range is 1–60,000 integer milliseconds and the default is 10,000. Cancellation skips requests for remaining registered addresses and saves `cancelled` findings. URLs containing a username or password are retained as `unusable` and never requested. Checking a URL never confirms its login or test-environment facts; those remain explicit user declarations.

```ts
import type { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import WebTestRuntime from '@deepseek-ai/dsh-web-test-runtime'
declare const ctx: Context
declare const dataRoot: string
// cordis.yml: the storage backend is rooted at the data generation the
// control root's pointer selects, and this service claims the root itself.
await ctx.plugin(Storage)
await ctx.plugin(storageJson, { root: dataRoot })
await ctx.plugin(storageDomain, { backend: 'json' })
await ctx.plugin(WebTestRuntime, { controlRoot: 'C:\\Users\\me\\.dsh-web-test' })

// Registering a project publishes one entry point and one notification.
const receipt = await ctx.webTestRuntime.registerProject({
  commandId: 'cmd-2f1c',
  codeRoots: ['C:\\projects\\shop', 'C:\\projects\\shop-api'],
  entryUrls: ['http://localhost:3000/checkout'],
})
```

Conversation metadata corrections pass the displayed project identity and saved Session association to `commitProjectUpdate`. The write queue rechecks that association before staging and publishing; a synchronous live-owner check also refuses cancellation or context loss. Withdrawing eligibility before the head commit can leave staged content, but published metadata remains unchanged.

### Cold activity and the M0 recovery prototype

`readPersistentActivity()` reads the existing generation pointer and `prototype-activity.json` without opening a domain, loading Sessions, creating files, or granting execution. Missing registration, invalid format, duplicate identities, unsafe paths, and failed reads produce `completenessErrors`; an incomplete snapshot cannot establish inactivity. Only `COMPLETED` run heads are terminal; pause, cancellation intent and unresolved operation identities remain visible with no loaded Sessions.

On a genuinely new control root, the Runtime atomically creates the final directory, claims its lock, and registers a complete empty format-3 cut before publishing the first generation pointer. The directory must still be empty. A missing pointer or cut on an existing root does not establish empty history, and interrupted roots are not automatically initialized. Existing cuts are preserved. The empty cut's protocol fingerprint is not a business composition identity; the first bounded run binds its explicit actual composition digest, and later registrations must match it.

A trusted `webTestPrototypeOwner` Service calls `issuePrototypeAuthority` with its actual owning Context, keeps the opaque object private, and supplies it to every Runtime prototype mutation. The authority is bound to that owner and its currently injected Runtime; missing, copied, stale or fabricated objects fail even after Agent initiator attribution is cleared. `initializePrototypeActivity(cut, authority)` remains an explicit import operation that refuses replacing an existing cut. The production `WebTestPrototypeControl` owner delegates registration, admission, UNKNOWN retention and revocation only when the caller supplies that Service's exact owning Context; it never returns authority. `registerPrototypeRun` appends an initial running or paused head without operations on the same queue as admission, preserving all existing heads. Format 3 stores original operation identities, pause/cancel intent, material references, executor status and composition digest. `admitPrototypeOperation` commits `ISSUED` before its caller performs business I/O and refuses repeated operation identity or the same normalized business intent across runs. Intent means the exact operation kind, target and parameter digest; the owner must supply canonical, unambiguous values. `markPrototypeOperationUnknown` retains uncertainty. `revokePrototypeDispatch` stops new admission before committing revocation; the coordinator also requires the old executor process to stop and release its lock.

`issueRecoveryAuthority` requires the actual `webTestRecovery` Service Context and issues a private opaque object. `RecoveryCoordinator.open(controlRoot, ownerContext, authority, writePolicy)` claims the same control-root lock; freeze, prepare, activate and close require authority on every call. Runtime writers and producer state are held in module-private WeakMaps, and coordinator state uses JavaScript private fields. Clearing Agent initiator attribution or capturing a public service reference cannot manufacture authority. Service methods require explicit caller authority or the producer's exact owning Context rather than automatically authorizing a public service call. Trusted Host extensions can register Services, so these checks do not claim process or operating-system isolation. `freeze` accepts revoked executor formats 1 and 3 and inventories every ordinary generation file, including referenced reports and attachments. `prepare(newPackageHash, checkPrototypeExecutorFormat, authority)` verifies a separate backup with its read-only executor-format checker and creates the corresponding recovery-only candidate beside the predecessor. Recovery candidates preserve all heads and references and record the predecessor digest with `recoveryOnly: true`. `activate` rechecks the original, backup, candidate, manifest and intent before atomically selecting the candidate. A missing checker, changed inventory or interrupted preparation leaves the original pointer intact; no predecessor is removed. `close` drains work before releasing ownership.

Activity formats are separate from Session generations and the `webtest` unit. Legacy formats 1 and 2 retain their original strict JSON validation and remain read-only for the Runtime. Fresh roots write executor format 3; its recovery candidate uses format 4. Older readers reject these new formats. Existing generations are never upgraded in place, and no executor upgrade from legacy data is provided; use a separate fresh control root for the current executor and preserve old roots for inspection or recovery. Recovery-only admission always rejects business dispatch. File writes flush the new file before rename; this prototype does not claim a directory flush or protection against loss of filesystem metadata after sudden power loss. Supported profile launch and installer handoff belong to the application consumer.

`WebTestPrototypeControl.pause(runId, callerOwnerCtx)` delegates to `pausePrototypeRun`, validating current private authority before synchronously closing an existing unfinished run's local dispatch gate. Only successful atomic publication returns the run, cut and head revisions in `PrototypePauseReceipt`; publication failure produces no durable acknowledgement and leaves the local gate closed for a persistence retry. Repeating a successful pause does not increment revisions. UNKNOWN status, original operations and material references remain unchanged; RUNNING becomes PAUSED. Admission checks the gate before queuing and during execution. An in-flight committed ISSUED operation remains ISSUED, and consumers must call `assertDispatchable` after every await and before business I/O. The Runtime hydrates admission facts by reading existing valid cuts and closes cold runs with ISSUED or UNKNOWN operations without changing their durable heads; missing or corrupt cuts retain incomplete query results and grant no execution permission. This bounded owner API has no resume, business cancellation, Remote user pause handler or complete M3 state machine; the trusted consumer still coordinates its run controller and upstream resources.

The trusted consumer calls `markCompleted(operationId, callerOwnerCtx)` only after observing a successful acknowledgement for the original operation. `markPrototypeOperationCompleted` commits only ISSUED → COMPLETED on the same queue; missing, already settled and UNKNOWN identities refuse settlement. It performs no business I/O and does not settle the whole run.

`markNotExecuted(operationId, receipt, callerOwnerCtx)` commits only ISSUED → NOT_EXECUTED in format 3 after the trusted consumer correlates a real browser wire denial with its current tool execution. The Runtime matches the receipt's operation, run, Session and original parameter digest and retains its call id, wire request id, diagnostic target, Host epoch, outcome and reason. Durable JSON validates all receipt fields and their operation association. A stored target is diagnostic evidence, never an executable browser handle. UNKNOWN remains unresolved; error text alone cannot establish non-execution. NOT_EXECUTED is terminal for the operation, retains duplicate-intent suppression, and does not mean successful run completion. Cold runs containing only COMPLETED or NOT_EXECUTED operations may dispatch fresh intents if their RUNNING head has no pause or cancel intent; a cold ISSUED or UNKNOWN operation closes admission. Format-3 recovery uses `checkPrototypeFormat3` and preserves every receipt in the verified backup and format-4 candidate.

### The control root and its lock

The control root is the one permanent directory. It holds the data-generation pointer, and the lock's object name is a SHA-256 digest of its *resolved* path. Three properties follow, and each is what a second launch depends on:

| Property | Why it matters |
|---|---|
| The digest's only input is the canonical control-root path | A different application build, profile, or installation shares the lock instead of running a second writer beside the first. |
| The path is resolved through `realpath` and case-folded | A junction or symlink alias of the root, or a differently-cased spelling, reaches the same directory and therefore the same object. |
| The name is in the `Global` namespace | A launch under a different Windows login session contends for the same object rather than opening a second write channel. |

The object is a named kernel semaphore with an initial and maximum count of 1, created with a discretionary access control list admitting exactly the creating user's token and Local System. A semaphore rather than a mutex because mutex ownership is thread-affine, and a Node writer's release point is not a fixed thread. The kernel destroys the object when its last handle closes, including on process death, so a crashed holder never blocks a successor. There is no timeout and no retry: a live but stalled holder keeps the root until it exits, because a takeover would let two writers interleave head writes.

### Creation is three stages

`registerProject` never writes an entry point before the resource it names exists and is durable:

| Stage | What commits | What a reader sees |
|---|---|---|
| 1. Reservation | One catalog-head write recording the command token, a digest of the normalized parameters, and the reserved project identity | Nothing; the head publishes no entry |
| 2. Child record | One `projects` write under the reserved identity, idempotent across retries | Nothing; visibility is the head's entry, not the record |
| 3. Publication | One head write publishing the entry, the receipt, and the notification together | The project |

An interruption after stage 1 or 2 leaves a reservation and possibly a durable child record that no read can see. A resend of the same command token resumes from the registered intent under the same identity, because that identity is derived from the token rather than allocated; a token reused with different parameters is refused with `command-token-reuse`.

### Commit order and the outbox

A caller reads the committed version, does its long work — attachments and other bulk I/O — outside the queue, then enters a short serial queue. Inside the queue the committer revalidates the record identity and the expected revision before writing anything, so a stale read is refused instead of overwriting a change the caller never saw.

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectId } from '@deepseek-ai/dsh-web-test-contracts'
import type {} from '@deepseek-ai/dsh-web-test-runtime'
declare const ctx: Context
declare const projectId: ProjectId
declare function saveLargeAttachmentOutsideTheQueue(): Promise<void>
const prepared = ctx.webTestRuntime.prepareProjectUpdate(projectId) // no I/O
await saveLargeAttachmentOutsideTheQueue()                          // long work
const commit = await ctx.webTestRuntime.commitProjectUpdate(        // revalidates, then commits
  { commandId: 'cmd-9a04', recordId: prepared.recordId, expectedRevision: prepared.expectedRevision },
  prepared,
  { codeRoots: ['C:\\projects\\shop'], entryUrls: ['http://localhost:3000/cart'] },
)
```

An update cannot be the creation protocol's "unreferenced material, written first". The project is already published, so overwriting its record would leave the head publishing a revision the record no longer holds, and every read of the data root would fail. The commit therefore stages the new content beside the published one:

| Stage | What commits | What a reader sees |
|---|---|---|
| 1. Staging | One `projects` write adding the next revision's content as the record's `pending` update; the published fields keep the revision the head names | The published revision, unchanged |
| 2. Publication | One head write publishing the entry, the receipt, the ledger row, and the notification together | The staged revision, served from `pending` |
| 3. Fold | One `projects` write moving the staged content into the record's own fields | The same revision, now folded |

A read answers with the revision the head's entry names, from whichever of the two copies carries it. So an interruption after stage 1 leaves content nothing references, and one after stage 2 leaves a staged update the head publishes and every read still serves: no interruption can make a published project unreadable or poison the data root, and the last write is the one whose loss costs nothing.

Both writes are replayable. The head's ledger row for the command token is written by the same head write as the entry it describes, so sending the same command again answers with the receipt the first attempt earned, finishes a fold that was lost, and never publishes a second record, entry, or notification. A token the ledger already holds for another project or another content is refused with `command-token-reuse`. The notification is appended by the publication write itself, which is what makes it impossible for the outbox to describe a commit that was not committed.

### Reading strictly

`readProject` returns a project only when the catalog head publishes an entry for it, and returns it at the revision that entry names. A stored record that fails its zod schema rejects the whole open with `invalid-record`; this domain deliberately does not declare `backup-and-skip`, because authoritative history that a later release cannot read is a failure to surface, not data to drop. A read that finds the head publishing an entry naming a revision the record holds neither in its own fields nor in its staged update is refused rather than served partially.

### Reading declared material

`inspectProjectMetadata` compares a published record's declarations with what this host holds, one fact at a time, and returns a `ProjectInspection` whose `complete` flag says nothing beyond those states:

| Declared fact | `usable` | `absent` | `unusable` |
|---|---|---|---|
| Code root | An existing directory | No such path on this host, or a path this host cannot stat at all | The path exists but is not a directory |
| Entry URL | An absolute `http`/`https` address | — | Anything else, including a relative or hostless spelling |

A usable entry URL is a statement about the address, not about the service. `inspectProjectMetadata` never reaches the network; the explicit `probeEntryUrls` operation records whether it answers. Login and test-environment facts come from the user declaration. A caller that reports readiness must name which facts it checked.

### Failures

| Code | Raised when |
|---|---|
| `web-test/control-root-locked` | Another writer owns the control root's kernel object. |
| `web-test/control-root-lock-unavailable` | The object could not be created or owned, including on a host with no such primitive. |
| `web-test/command-token-reuse` | A command token was reused with parameters, a project, or a content that differ from the ones it already committed. |
| `web-test/record-mismatch` | A submission addresses a record that is not the project the change was prepared for. |
| `web-test/stale-revision` | The caller's expected version no longer matches the committed version. |
| `web-test/record-unpublished` | The head publishes an entry the durable records do not support. |

Request field validation is not in this list: a malformed request is the contract package's `web-test/*` failure, raised before this service sees it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/index.ts` is the Service Definition and the whole commit protocol. `src/spec.ts` declares the `webtest` storage domain: the catalog head in the global slot and the child project records in one table, every field validated by zod at the durable boundary. `src/control-root.ts` owns the control root's canonical identity, the generation pointer, and the lock-name digest. `src/lock.ts` is the platform gate and the failure mapping; `src/win32-control-semaphore.ts` is the Koffi bindings and the DACL. `src/errors.ts` declares the failure codes.

Prototype methods verify opaque authority, the producer's lifetime and its current Runtime before resolving the private activity store. Runtime init registers that store before Cordis exposes the ACTIVE provider; verification and lookup are synchronous, and the store registration persists for that provider's lifetime. Both a Cordis traceable proxy and the actual Runtime Service instance resolve the same store. Retaining either reference after the producer or Runtime is disposed grants no mutation authority.

| File | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | Service Definition, the three-stage creation protocol, the staged-update protocol, the serial commit queue, strict reads, and the outbox. |
| [src/spec.ts](src/spec.ts) | The `webtest` domain declaration, its zod record schemas, and the project/record identity derivations. |
| [src/control-root.ts](src/control-root.ts) | Canonical control-root identity, the data-generation pointer, and the lock-name digest. |
| [src/lock.ts](src/lock.ts) | The single-writer claim: platform gate, contention mapping, idempotent release. |
| [src/win32-control-semaphore.ts](src/win32-control-semaphore.ts) | Koffi bindings, the two-principal DACL, and the zero-timeout acquisition. |
| [src/inspection.ts](src/inspection.ts) | The read that compares a published project's declared code root and entry URLs with what this host holds. |
| [src/errors.ts](src/errors.ts) | The failure codes a caller discriminates on. |
| — | No runtime invariant companion is published. The head and the project records are written on one serial chain inside one process, and the only cross-process relation — that one writer holds the root — is enforced by the kernel object and observed directly by the exclusion tests, so no second observation exists that could diverge from the first. |

The unit is one `single`-layout document, the layout StorageDesignDecision chose after measuring that segmentation reads 60–80× slower at n=10 000 and bounds memory only at sizes that do not constrain anything yet. Segments, manifests, and checkpoints are deliberately not declared.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Shared contracts](../web-test-contracts/README.md) — the branded identities, request records, receipts, and parsers this service consumes.
- [Storage domain](../../storage/storage-domain/README.md) — `defineDomain`, `domainTable`, the write chain, and the failure codes an invalid record raises.
- [JSON storage backend](../../storage/storage-json/README.md) — the `single`-layout unit document and its atomic publish this evidence reads.
- [Recovery design](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-design-recovery.md) — DD06, DD07, and DD09: the head, the sole writer, the commit order, and the creation protocol.
- [Persistence regression](tests/runtime.spec.ts) — reopen, idempotent creation, strict reads, and the outbox.
- [Interruption regression](tests/interruption.spec.ts) — every commit boundary where a write can fail, in both protocols, and the replay from each.

-----

<a id="model-experience"></a>
## Model Experience

None, as this single domain writer constructs no model context and reaches no model request; it persists records a caller supplies and returns them.

#### KV Cache effect

No direct effect. A consumer places these records in a request only if its own contract does.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The sub-item this package implements is not accepted, and the work that remains belongs to the cards named below. Read this list so a green test is not read as a delivered product.

- The write lock is Windows-only. A non-Windows host reports `control-root-lock-unavailable` and writes nothing, because a file lock would block the reader and search paths the data root needs and an in-memory flag would not exclude a second process. No POSIX face is implemented. The Linux lane still runs this package's lock-mapping, Koffi-decision, control-root identity, and pointer-validation suites, which is why `src/lock.ts`, `src/control-root.ts`, `src/spec.ts`, and `src/errors.ts` stay under the per-file coverage gate everywhere; only `src/win32-control-semaphore.ts` and `src/index.ts` are excluded there, the first because Koffi loads Win32 libraries and the second because the service refuses to open a domain at all without the kernel object.
- The catalog head holds its create ledger, its update ledger, and its undelivered notifications inline, and none is bounded. Receipts grow with the number of commands and notifications only shrink when a consumer acknowledges them. StorageDesignDecision rejected the paging framework this would need; the cap and its eviction semantics are deliberately not invented here, and a data root with many commands is the point at which that decision must be reopened.
- The data-generation pointer is read once, at init. A writer holds the control root for its whole life, so no second writer can repoint it, but an operator editing the pointer by hand is not detected.
- Browser action dispatch is not implemented, and no claim is made that attachment coordination is complete. `commitProjectUpdate` demonstrates the prepare-outside / revalidate-inside rule that attachment commits will use; it does not move an attachment.
- The unit format is version 2. Earlier version-2 units without session, environment or URL-observation tables remain readable with empty tables; opening them does not rewrite their bytes. Other unit versions are refused; this package does not migrate version 1.
- The shipped application composition uses `storageMode: generation-json`, a dedicated backend rooted at the selected data generation. `configured` remains available for compositions whose storage domain is already rooted there.
- The generated Client declarations for these service methods do not exist: this service is not a `@Remote` surface. `M1-T02-A`'s contract Remote remains the wire boundary for validation, and the command Remote in [`@deepseek-ai/dsh-web-test-conversation`](../web-test-conversation/README.md) is the one surface a card and a conversation address. A later card decides whether persistence joins a Remote of its own.
- A project registers one to sixteen code roots and a list of entry URLs. One environment declaration covers the complete registered root set; different environment facts cannot be assigned to individual roots within that project. Confirming another declaration replaces the active one, so a caller needing a differently declared tree registers a separate project. Every registered code root stays read-only under the current policy.
- The URL check records transport reachability only. It does not authenticate, follow redirects, render a page, or establish that a HEAD response matches the page's GET behavior. It permits explicitly registered loopback and private-network addresses; checking them does not grant browser or test execution permission.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Two implementation choices are load-bearing and easy to undo by accident. First, the three stages are three separate durable writes with no transaction between them; that is deliberate, and the head write is the only one that publishes anything. Anything that "saves a write" by writing the entry point alongside the child record reintroduces the half-built entity the protocol exists to prevent. Second, `SECURITY_ATTRIBUTES` is encoded from a per-process Koffi struct name because Koffi registers struct types globally and refuses a duplicate; the `nLength` field is the x64 layout (DWORD, 4 bytes of padding, pointer, BOOL), and a change to it silently produces a descriptor the kernel ignores. The Win32 failure paths are covered through an injected Koffi table rather than by provoking real failures, because a real one is neither reproducible nor observable; the success path and the kernel's real exclusion are covered natively.

</details>
