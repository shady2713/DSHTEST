---
description: "The Web testing pre-execution policy (ctx.webTestPolicy): the non-relaxable tool guard and the service-level backstop, read-only code-root protection with named upload/download/temporary material directories, per-entry environment declaration bound to the published project revision, and bounded concrete-flow authorization."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test-policy

English | [中文](README.zh.md)

## Summary

This package owns the one decision every Web testing path passes before it has an effect. It attaches at the tool registry's monotonic guard stage, so an official approval and this restriction both apply and neither relaxes the other, and it decorates the public capability services, so a direct `ctx.fs`, `ctx.web`, or `ctx.terminals` call is decided by the same ledger. It reads the tested code root and named material directories from a confirmed environment declaration, binds every authorization to the published project revision, and refuses an arbitrary shell, the terminal capability, a link, and any unadapted entry path.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The composition mounts the service over the tool registry, the contract boundary, the published-scope reader, and the clock, and states the deployment's choices as config.

The closed conversation metadata set includes `web_test_update_project`, which corrects the attached project's roots and URLs through the revision-checked Remote without granting permission. Capability calls made inside a metadata handler still pass the same service backstop.

`web_test_submit_report` is reserved for a composition's report validator to accept report text and record validation metadata. Its handler grants no permission, dispatches no test, and does not certify business acceptance; any capability call inside the handler still passes the service backstop. Similar tool names remain unrecognized.

```ts
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { WebTestPolicy } from '@deepseek-ai/dsh-web-test-policy'
declare const ctx: Context
declare const dataRoot: string
await ctx.plugin(WebTestPolicy, {
  protectedPaths: [
    { path: join(dataRoot, 'uploads'), role: 'upload' },
    { path: join(dataRoot, 'downloads'), role: 'download' },
    { path: join(dataRoot, 'staging'), role: 'temporary-material' },
  ],
  confirmationRequiredFor: ['read-source'],
  confirmationTtlMs: 120_000,
  authorizationValidityMs: 600_000,
  maxActionsPerFlow: 40,
})
```

A product that mounts nothing can still construct the decision with its own ledger:

```ts
import { EnvironmentLedger } from '@deepseek-ai/dsh-web-test-policy'
import type { DeclarationEvaluator, LedgerLimits, ProtectedPath, WebTestClock, WebTestScopeSource } from '@deepseek-ai/dsh-web-test-policy'
declare const protectedPaths: readonly ProtectedPath[]
declare const limits: LedgerLimits
declare const scopeSource: WebTestScopeSource
declare const contracts: DeclarationEvaluator
declare const clock: WebTestClock
const ledger = new EnvironmentLedger(protectedPaths, limits, scopeSource, contracts, () => clock.now())
```

### What is configurable and what is not

Every deployment-varying choice is a validated `Config` field: the protected directories and their roles, which effect kinds require a business confirmation, how long a confirmation stays answerable, how long one authorization stays valid, and how many actions one may cover. What a test session may do is not configurable. A declared code root is read-only, an arbitrary shell and the terminal capability are refused for every grant including a human-approved one, and an entry path with no adapter is refused.

### Declaration, authorization, and re-verification

`declareEnvironment` validates its request through the contract's own parser, so a Client, the Runtime, and this service reject the same illegal field with the same code. The declared code root must be the tree the project published, and no protected directory may lie inside it. The declaration's identity is derived from its content, and every grant carries that identity and the published project revision. A declaration whose content changed, or a scope whose revision moved, therefore makes every earlier grant inapplicable at once: the environment changed, so the session must verify again.

`grantFlow` grants one concrete flow the right to act, bounded by the flow's record identity, an action count, and a validity window. The budget belongs to the flow rather than to the request: re-issuing the same flow at the same revisions returns the record that stands — the actions it still has and the instant it still expires at — so a retry cannot mint a fresh ceiling or extend a window that has been running. A flow's identity moves with its plan revision, the published project revision, the declaration, and the third-party flag, so a re-issue under any of those is a different authorization and does get its own budget. A grant that reaches a third party is only ever matched against effects that reach a third party, so a test-environment grant never authorizes a search and a third-party grant never authorizes a read of the tested tree.

### Required business confirmation against waiting on a question

`requireConfirmation` asks only for an action the product would otherwise already permit; an action refused on its own merits is never turned into a question. Waiting grants nothing: the state is `pending` and the decision still denies. `answerConfirmation` re-checks the question, the intended action, and the current project revision, flow plan revision, and environment declaration before it accepts anything, so an answer that arrives after the window closed, or against context that has moved, is refused and the next attempt asks a new question. Independent work is unaffected while the dependent work stays blocked.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Two enforcement points, one decision

Every model-initiated call reaches `ToolRuntime.execute`, and this service attaches at the guard stage rather than the `tools/pre-execute` waterfall. A guard has no allow result, it runs after every pre-execute listener and after the approval question, and a call an approval service allowed still reaches it. That is what makes the refusal non-relaxable: neither a listener answering `allow` nor an approval answering `allowed-once` can turn it back into permission.

The guard is consulted per call rather than per registration, so a tool registered mid-session is decided on its next call with nothing having noticed the registration. A tool name this package has no adapter for is refused, which covers a hot-enabled tool, a tool from a package the deployment does not ship, and a malformed argument set the same way.

The reserved `run_code` transport is admitted only when the installed provider is an exact [QuickJS runtime](../../ptc-runtime/ptc-runtime-quickjs/README.md) instance. That provider exposes declared tool bindings and ECMAScript built-ins; it exposes no Node, file, network or process API. Nested tools still reach the same guard and service backstops. Node PTC and providers copying an isolation descriptor remain refused.

Direct calls to the public filesystem, web, process, attachment, terminal and controlled-browser services also pass the service backstop. Controlled browser tools check the calling Session's acknowledged target; `desktopBrowserControl.submit` spends the action once and checks the actual bound URL again. Role submissions first require the Runtime's opaque authority, then authorize the role's URL against its owning Session; both submission paths preserve the caller's cancellation signal.

Pure text prompt admission copies text without accessing attachment storage, so `attachments.admitPromptContent` permits text-only content. Content containing an image or file reference remains subject to the attachment refusal; the prompt entry does not grant upload, read or publication rights.

`glob` and `grep` consume the structured `fsSearch` service. The guard resolves their relative or omitted path against the Session workspace and checks without spending an action. At the subprocess backstop, only the packaged Provider's private, one-use spawn identity can select `list-source` for glob or `read-source` for grep; the ledger authorizes the canonical target under `fsSearch.search` and spends once. Explicit links, private targets and paths outside the confirmed roots are refused; `--no-follow` prevents traversal through nested junctions and symlinks. General shell, subprocess and terminal requests remain denied even when they copy search argv.

### Every method the backstop decides, and every method it leaves alone

The list covers the public Service Definitions, including alternate methods that reach stored material or persistent shells. "Effect-capable" means the call can read or change material, create a process, operate a terminal, or control a browser.

| Service | Method | Effect-capable | Decorated | Effect it is decided as |
| --- | --- | --- | --- | --- |
| `ctx.desktopBrowserControl` | `submit` | yes | yes | `fetch-web` using the Session's bound URL; missing ownership is refused. |
| `ctx.fs` | `readText`, `readBytes`, `readByteRange`, `streamText` | yes | yes | `read-source` |
| `ctx.fs` | `listDir` | yes | yes | `list-source` |
| `ctx.fs` | `writeText` | yes | yes | `write-source` |
| `ctx.fs` | `editText` | yes | yes | `edit-source` |
| `ctx.fs` | `watch` | no | no | A watcher reports that a path the caller already named changed. It returns no content and creates nothing. |
| `ctx.fs` | `resolve`, `processPath`, `processPathFromHostPath`, `fileUrl`, `contains` | no | no | Projections and a containment test. They name a target or compare two of them; the read and the write are decided where they happen. |
| `ctx.fs` | `stat`, `lstat` | no | no | Metadata about a path the caller already resolved, never content and never a name the caller does not have. The enumerator `listDir` and every content read are refused for a protected directory; the session log, the agent's instruction files, and a language server still stat their own storage. |
| `ctx.fs` | `sandboxMode` | no | no | A fact about the backend. |
| `ctx.shell` | `execute` | yes | yes | `spawn-process` |
| `ctx.shell` | `resolve` | no | no | Applies defaults to a request without running it. The spawn it describes is decided at `execute`. |
| `ctx.shell` | `sandboxMode` | no | no | A fact about the executor. |
| `ctx.subprocess` | `spawn` | yes | yes | `spawn-process`; one-use packaged search requests use `list-source` or `read-source` |
| `ctx.subprocess` | `spawnTerminal` | yes | yes | `use-terminal` |
| `ctx.subprocess` | `resolveExecutable`, `terminalEnvironment` | no | no | A lookup and a platform fact. Neither starts a process, and the spawn each one informs is decided at `spawn` or `spawnTerminal`. |
| `ctx.web` | `fetch`, `search` | yes | yes | `fetch-web`, `search-web` |
| `ctx.web` | `registerSearchProvider`, `registerFetchProvider` | no | no | Registry composition. A registered provider still cannot run without passing `search` or `fetch`. |
| `ctx.attachments` | `saveImage`, `saveImages`, `saveFile`, `saveFileStream`, `admitEncodedFile`, `admitPromptContent`, `stageEncodedFile`, `stageFile`, `stageFileStream`, `deleteFile` | yes | yes | `write-upload`; staged Host uploads carry exact private producer authority. |
| `ctx.attachments` | `readImage`, `readFileStream`, `readImageRequest`, `acquireFileReadLease` | yes | yes | `read-upload`; the actual Session-log export owner binds private read-only authority. |
| `ctx.attachments` | `commitFileReferences`, `releaseFileReferences`, `releaseFileStage` | yes | yes | Requires one exact private call from the actual Service-owning Host producer; public callers cannot mutate retention. |
| `ctx.attachments` | `imageHostPath`, `fileHostPath` | no | no | A projection: the path of a stored object, with no content behind the answer. Every `ctx.fs` read of that path is refused for a protected directory, and the model's own request path depends on the projection, so refusing it would break the product without closing a route. |
| `ctx.attachments` | `validateImage` | no | no | Decodes bytes the caller supplied and persists nothing. |
| `ctx.attachments` | `isAttachmentError` | no | no | A type guard. |
| `ctx.attachments` | `imageLimits` | no | no | A fact about the deployment's image policy. |
| `ctx.terminals` | `spawn`, `startSend`, `read`, `signal` | yes | yes | `use-terminal` |
| `ctx.terminals` | `kill` | no | no | It removes a session rather than exercising one, and `expectOwned` limits it to the caller's own. Refusing it would strand a PTY the policy has decided must not exist. |
| `ctx.terminals` | `registerBackend`, `listBackends` | no | no | Registry composition and a listing of registered types. No session is allocated. |
| `ctx.terminals` | `hasOwnerActivity`, `list` | no | no | Snapshots of the caller's own sessions: ids, names, types, pids, and status. No session content and no other owner's sessions. |

### What the backstop cannot cover

The backstop follows each provider through Cordis injection. Each injected provider finishes cleanup before its successor installs. Late providers are decorated, and replaced instances remain guarded until the policy unloads, so retained service references cannot bypass it. Two paths remain outside the decorated service:

- **A captured method reference.** A consumer that read `ctx.fs.readText` into a variable before the effect installed holds the unwrapped function, and nothing here reaches it. Deciding such a call needs a decision point inside the Service Definition.
- **A backend's exported functions.** `fs-local`, `subprocess-local`, and `attachment-local` export their own entry points; importing one directly is not a call on the service.

Closing either path requires a decision inside the owning Service Definition.

### A relative path is refused at the tool layer and judged at its resolved location at the service layer

The two enforcement points do not treat a relative path the same way, and the difference is worth stating rather than smoothing over.

A tool argument is read by a synchronous guard that cannot ask the backend for its working directory, so `read` with `file_path: "src/app.ts"` is `denied-unknown-target`: this package will not reason about a target it cannot canonically name. A `ctx.fs` call is different — it receives an `FsTarget` the backend has already resolved, and `processPath` turns that into an absolute path, so `ctx.fs.readText(await ctx.fs.resolve('src/app.ts'))` **ran** and returned the file. The service layer is therefore not blind to a relative path; it is coarser, because it decides at the location the path resolved to and cannot tell how the caller spelled it. That is harmless only while the backend's working directory is the declared code root: a relative path then resolves inside the root and is judged as an ordinary in-root read under a live grant, and a backend configured with any other working directory resolves it outside the root, where containment refuses it. A deployment that mounts a filesystem backend whose `cwd` is not the code root should expect relative-path reads through the service layer to be refused, which is the safe direction.

### Why the decision is synchronous

A `ToolGuard` is synchronous, so the decision cannot await a path resolution. Every target is therefore resolved with the synchronous `lstat`/`realpath` pair, and a target is usable only when it already exists, is not a link, and canonically resolves. Resolving through the filesystem is also what makes containment trustworthy without a platform branch, and refusing a link rather than following it closes the substitution where a link inside the code root points somewhere the root does not cover. A relative or absent path names no target this package can canonically resolve, so it is refused.

<a id="further-exploration"></a>
## Further Exploration

- [`.artifacts/web-testing/upgrade-v02/m1-t05-a/rejection-matrix.md`](../../../.artifacts/web-testing/upgrade-v02/m1-t05-a/rejection-matrix.md) — every enabled entry path, one admitted and one refused case where both exist, with the exact reason and what was observed of the effect behind it. Every method the backstop decorates has a row, and every newly decorated one is observed against a real local filesystem, attachment store, subprocess runtime, or terminal registry.
- [`.artifacts/web-testing/upgrade-v02/m1-t05-a/confirmation-ledger.md`](../../../.artifacts/web-testing/upgrade-v02/m1-t05-a/confirmation-ledger.md) — what a pending, expired, mismatched, skipped, or declined answer is worth.
- [`.artifacts/web-testing/upgrade-v02/m1-t05-a/entry-path-inventory.md`](../../../.artifacts/web-testing/upgrade-v02/m1-t05-a/entry-path-inventory.md) — the survey this package's enforcement points were chosen from.

<a id="dev-note"></a>
## Dev Note

No runtime invariant companion is published because the two enforcement points ask the same ledger, and the decision a caller acts on *is* that ledger's return value rather than a second observation that could diverge from it. Which services are present at mount time is the composition's fact, not a second source this package could compare against.

<a id="model-experience"></a>
## Model Experience

### Refused effects

#### What the model sees

A refused call becomes one tool-result error line. The closed reason and the subject the policy named are both in it, so the model can tell a read-only tree from a target outside the declared environment, a link, a lapsed authorization, and a missing confirmation without guessing. A refusal is not a retryable tool error and not a hint that a different tool will do: the same effect through a different entry path earns the same answer, so reaching for the `edit` tool after `write` was refused has not found a way around it.

##### Refusal text a denied call produces

```markdown
Error: web testing policy refused "write" (denied-protected-path): C:\repo\src\app.ts
```

#### Token effect

The policy adds no Session event type. Browser screenshots enter the ordinary `tool/result` as durable image references; the host-only `webTestScreenshots` projection reconstructs paired successful references after reopen or fork without restoring browser dispatch permission. Denied calls remain ordinary tool errors.

#### KV Cache effect

None. A refusal does not alter the model request prefix, so a cached prefix stays valid across a refused call.

### Admitted effects

#### What the model sees

Nothing. An admitted call runs the tool it always ran, and the model receives the tool's own result, so the policy is invisible on the admitted path.

#### Token effect

Only the tool's own result contributes tokens.

#### KV Cache effect

None. An admission does not alter the model request prefix either.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the contract is a poor fit or needs special operational care. They are current package constraints, not a general policy comparison or a task backlog.

- **Relative filesystem read/edit arguments are refused at the tool layer** — the abstract `FileSystem` does not expose the backend's working directory, so `src/app.ts` as a read/edit tool argument is `denied-unknown-target`. A relative path reaching `ctx.fs` is judged where its backend resolved it. Search resolves its own relative paths against the calling Session workspace; see [that section](#understand-the-implementation).
- User-supplied uploads and downloads remain refused. `createModelProbeImage` admits the fixed one-pixel probe. `captureBrowserScreenshot` accepts only the calling Agent's live Main-authorized target, captures its image itself and commits it through the installed attachment provider. The raw writer and admitted references remain in private WeakMaps; callers cannot supply image bytes. Reads require exact recorded metadata and, for model-initiated reads, the owning Session. Reopened successful screenshot history permits image reads, never renewed browser dispatch.
- **No browser action is dispatched and attachment coordination is not complete** — this package decides whether an effect may happen; it does not cause one.
- **The backstop cannot cover a method captured before decoration or a direct backend import.** Calls through the injected service remain covered when its provider is replaced.
- **The decision reads the published scope on every call** — that is what makes a scope change observed rather than cached, and it costs a synchronous read of the domain's in-memory state per decision.
- **One active environment declaration covers all code roots registered by a project** — a project cannot express different environment facts for individual roots, and confirming another declaration replaces the active one. A mixed environment must not be declared wholly as a test environment to obtain permission. This limitation remains until an executor requires and validates independently scoped environments; all registered code roots remain read-only.
