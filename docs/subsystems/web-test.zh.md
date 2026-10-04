# Web 测试

[English](web-test.md) | 中文

## 概述

通过 Web 测试服务配置模型路线、登记项目根及 URL，并保存已确认的环境事实。状态查询报告这些事实，不会启动测试；显式 URL 检查独立记录传输观察，不代替环境确认。应用启动器拥有 profile 和数据根；身份标签不会改变它们。

## 目录

- [类型](#types)
- [Cordis API](#cordis-surface)
- [开发备注](#dev-note)

<a id="types"></a>
## 类型

[契约包](../../packages/web-test/web-test-contracts/README.zh.md)拥有项目身份及已验证的请求；[Runtime](../../packages/web-test/web-test-runtime/README.zh.md)拥有持久项目及环境记录。[策略](../../packages/web-test/web-test-policy/README.zh.md)、[模型配置](../../packages/web-test/web-test-models/README.zh.md)和[对话命令](../../packages/web-test/web-test-conversation/README.zh.md)分别拥有各自的决策与请求。[桌面浏览器控制](../../packages/client/ui-sidebar-browser/README.zh.md)拥有明确的 Session 绑定和受限 guest 命令。以下应用元数据来自 [`src/types.ts`](../../packages/web-test/web-test/src/types.ts)；入口声明与可用性仍分别判断。

```ts type-equiv
/** Opaque identity for one entry point, so an unavailable action is never guessed by string. */
type WebTestEntryPointId = Branded<'WebTestEntryPointId'>
```

```ts type-equiv
/** Application identity labels; the launcher and installer own their enforcement. */
interface WebTestIdentity {
  /** Application identity used for its own artifacts and update channel. */
  readonly applicationId: string
  /** Intended data-root name; this field does not change `DSH_HOME`. */
  readonly dataRootName: string
  /** Intended profile label; the launcher selects the running profile. */
  readonly profileName: string
}
```

```ts type-equiv
/** Configuration for {@link WebTest}; every field has a default. */
interface WebTestConfig {
  /** Application identity; distinct from the official product so both may be installed. */
  applicationId: string
  /** Intended data-root name; this field does not change `DSH_HOME`. */
  dataRootName: string
  /** Intended profile label; the launcher selects the running profile. */
  profileName: string
}
```

```ts type-equiv
/** An intended entry declaration; no Client control is registered by this type. */
interface WebTestEntryPoint {
  /** Stable identity callers use to ask whether the point is available. */
  readonly id: WebTestEntryPointId
  /** Key of this application's dictionary; a Client consumer renders it through `t`. */
  readonly titleKey: WebTestLocaleKey
  /** Profile this entry point belongs to. */
  readonly profileName: string
}
```

[应用启动器](../../packages/web-test/web-test/src/launcher.ts)向受支持的 profile 启动流程提供以下请求。

```ts type-equiv
/** Everything a harness profile boot needs, resolved by this launcher. */
interface WebTestLaunchRequest {
  /** Profile to boot: this application's own, which the boot finds under the applied data root. */
  readonly profile: string
  /** Command-line overlays applied after user patches. */
  readonly patchFiles: readonly string[]
  /** Application composition applied after bundles and before user patches. */
  readonly applicationPatchFiles: readonly string[]
  /** Inner arguments for the booted tree, handed through verbatim. */
  readonly args: readonly string[]
  /** Environment every runtime path resolves under. */
  readonly environment: Readonly<NodeJS.ProcessEnv>
}
```

[Runtime](../../packages/web-test/web-test-runtime/README.zh.md)在不加载 Session 时报告持久活动。

```ts type-equiv
/** Cold observations are incomplete on any read or consistency failure. */
interface PersistentActivitySnapshot {
  /** Resolved root identity; null when the existing root cannot be resolved. */
  readonly controlRootIdentity: string | null
  /** Wall-clock timestamp of this read. */
  readonly sampledAt: number
  /** Selected generation; null when its pointer cannot be validated. */
  readonly generation: number | null
  /** Committed cut revision; null when no valid cut is available. */
  readonly headRevision: number | null
  /** Durable run heads, independent of loaded Sessions. */
  readonly runHeads: readonly PrototypeRunHead[]
  /** Issued or UNKNOWN operation identities, retained across recovery. */
  readonly unsettledOperationIds: readonly PrototypeOperationId[]
  /** Failures preventing this snapshot from proving inactivity. */
  readonly completenessErrors: readonly string[]
}
```

[恢复原型](../../packages/web-test/web-test-runtime/README.zh.md)在改变当前选定代次前验证这些切面和文件清单。

```ts type-equiv
/** Original durable prototype batch identity. */
type PrototypeRunId = Branded<'WebTestPrototypeRunId'>
```

```ts type-equiv
/** Original durable prototype operation identity, retained across batches. */
type PrototypeOperationId = Branded<'WebTestPrototypeOperationId'>
```

```ts type-equiv
/** One validated prototype business intent. */
type PrototypeBusinessIntent = z.infer<typeof prototypeIntentSchema>
```

```ts type-equiv
/** One validated prototype operation. */
type PrototypeOperation = z.infer<typeof prototypeOperationSchema>
```

```ts type-equiv
/** Trusted receipt correlated with the original tool call and wire reply. */
type PrototypeNotExecutedReceipt = z.infer<typeof prototypeNotExecutedReceiptSchema>
```

```ts type-equiv
/** One validated prototype run head. */
type PrototypeRunHead = z.infer<typeof prototypeRunSchema>
```

```ts type-equiv
/** Receipt derived only from the committed pause cut; UNKNOWN remains UNKNOWN. */
interface PrototypePauseReceipt {
  readonly runId: PrototypeRunId
  readonly cutRevision: number
  readonly headRevision: number
  readonly status: PrototypeRunHead['status']
  readonly pauseRequested: true
}
```

```ts type-equiv
/** One complete committed activity cut, never an in-flight scheduler projection. */
type PrototypeActivityCut = z.infer<typeof prototypeActivitySchema>
```

```ts type-equiv
/** A frozen cut binds every generation file to the original composition. */
interface FrozenRunManifest {
  /** Canonical control-root identity shared with the writer lock. */
  readonly controlRootIdentity: string
  /** Kernel object name shared with the ordinary Runtime. */
  readonly lockName: string
  /** Generation whose last committed cut was frozen. */
  readonly generation: number
  /** SHA-256 of the exact committed activity file. */
  readonly activityHash: string
  /** SHA-256 of the complete sorted generation inventory. */
  readonly backupHash: string
  /** Original immutable generation-file inventory. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly sha256: string }>
  /** Original run heads, including all unresolved operations and references. */
  readonly cut: PrototypeActivityCut
}
```

```ts type-equiv
/** A prepared update names the backup, candidate, and old/new compositions. */
interface RecoveryUpdateIntent {
  /** Same immutable manifest used for checking and candidate construction. */
  readonly frozen: FrozenRunManifest
  /** Original combination digest. */
  readonly oldPackageHash: string
  /** Candidate combination digest. */
  readonly newPackageHash: string
  /** Sibling backup directory, relative to the control root. */
  readonly backupDirectory: string
  /** Candidate directory, relative to the control root. */
  readonly candidateDirectory: string
  /** Monotonic generation assigned to the candidate. */
  readonly candidateGeneration: number
  /** Complete candidate inventory digest checked before pointer publication. */
  readonly candidateHash: string
}
```

只有拥有该职责的 Host Service 能签发这些进程内权限；复制对象不能取得许可。

```ts type-equiv
/** Opaque trusted prototype producer authority; never returned by a Service. */
type PrototypeAuthority = { readonly [prototypeAuthorityBrand]: true }
```

```ts type-equiv
/** Opaque trusted recovery owner authority; never returned by a Service. */
type RecoveryAuthority = { readonly [recoveryAuthorityBrand]: true }
```

共享对话 Remote 以预期修订核对当前项目资料修正；状态读取不获得执行许可。

```ts type-equiv
/** User correction of the attached project's metadata, retaining its identity. */
type ConversationProjectUpdateRequest = {
  /** Live conversation whose own project is revised. */
  readonly sessionId: SessionId
  /** Project identity displayed when the user prepared the correction. */
  readonly projectId: ProjectId
  /** Idempotency token starting cmd-; reuse only for the same correction. */
  readonly commandId: string
  /** Revision displayed when the correction was prepared. */
  readonly expectedRevision: Revision
  /** Explicit replacement code roots. */
  readonly codeRoots: readonly string[]
  /** Explicit replacement already-started entry URLs. */
  readonly entryUrls: readonly string[]
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdesktopbrowsercontrol--desktopbrowsercontrol-abstract-seam"></a>

### `ctx.desktopBrowserControl` — `DesktopBrowserControl` (abstract seam)

Trusted Host consumers choose targets; model-facing tools can submit only for their own Session.

```ts cordis-catalog
/**
 * List the current Main-controlled guests.
 * @returns the latest complete Main publication; disconnected targets are absent.
 */
abstract targets(): readonly DesktopBrowserControlledTarget[]

/**
 * Verify a live Session's workspace membership, reserve an exclusive target, and await Main acknowledgement.
 * @param sessionId - existing Session selected by a trusted consumer.
 * @param target - current Main-owned target selected by that consumer.
 * @returns the acknowledged binding; rejects missing Sessions, mismatched workspaces, or lost publications.
 */
abstract bind(sessionId: SessionId, target: DesktopBrowserTargetId): Promise<DesktopBrowserBinding>

/**
 * Withdraw one Session's acknowledged ownership.
 * @param sessionId - owning Session.
 * @returns after Main acknowledges withdrawal, or rejects a lost connection.
 */
abstract unbind(sessionId: SessionId): Promise<void>

/**
 * Read one Session's acknowledged ownership.
 * @param sessionId - owning Session.
 * @returns current acknowledged ownership and URL, or undefined when unavailable.
 */
abstract binding(sessionId: SessionId): DesktopBrowserBinding | undefined

/**
 * Submit an allowlisted command for an acknowledged Session binding.
 * @param sessionId - owning Session; the caller cannot select an alternative target.
 * @param body - allowlisted command using that Session's binding.
 * @param signal - optional cancellation before input dispatch; delivered actions retain their actual outcome.
 * @returns correlated Main result; a missing binding is confirmed non-execution, and no result permits automatic retry.
 */
abstract submit(sessionId: SessionId, body: DesktopBrowserCommandBody, signal?: AbortSignal): Promise<DesktopBrowserCommandResult>

/**
 * Atomically authorize the exact role targets created by the trusted runtime.
 * @param owner - live activation, project, batch, Session and Host identity.
 * @param targets - Main-created targets whose role metadata matches this owner.
 * @param authority - private authority bound to the real Runtime provider.
 * @returns acknowledged role grants; single bindings remain mutually exclusive.
 */
bindGroup(owner: DesktopBrowserExecutionOwner, targets: readonly DesktopBrowserControlledTarget[], authority: DesktopBrowserExecutionAuthority): Promise<readonly DesktopBrowserRoleBinding[]>

/**
 * Revoke the group locally before waiting for Main withdrawal.
 * @param group - trusted execution group identity.
 * @param authority - private authority bound to the real Runtime provider.
 * @returns after its Main authorization is withdrawn.
 */
releaseGroup(group: DesktopBrowserGroupId, authority: DesktopBrowserExecutionAuthority): Promise<void>

/**
 * Execute on the exact acknowledged role, without selecting another target.
 * @param binding - role grant from bindGroup.
 * @param body - allowlisted operation for that role.
 * @param signal - cancellation closes admission before input dispatch.
 * @param authority - private authority bound to the real Runtime provider.
 * @returns correlated outcome; delivered actions cannot be canceled retroactively.
 */
submitRole(binding: DesktopBrowserRoleBinding, body: DesktopBrowserCommandBody, signal: AbortSignal, authority: DesktopBrowserExecutionAuthority): Promise<DesktopBrowserCommandResult>
```

Types: [DesktopBrowserControlledTarget](sidebar-right.zh.md) · [DesktopBrowserExecutionAuthority](sidebar-right.zh.md) · [DesktopBrowserExecutionOwner](sidebar-right.zh.md) · [DesktopBrowserGroupId](sidebar-right.zh.md) · [DesktopBrowserRoleBinding](sidebar-right.zh.md) · [DesktopBrowserTargetId](sidebar-right.zh.md) · [SessionId](core.zh.md)

Source: [`packages/client/ui-sidebar-browser/src/control.ts`](../../packages/client/ui-sidebar-browser/src/control.ts)

<a id="ctxwebtest--webtest"></a>

### `ctx.webTest` — `WebTest`

Application metadata; a declared entry stays unavailable until a mounted capability records it, and this service never registers a control on its own.

```ts cordis-catalog
/**
 * List declared entries, including those without backing capabilities.
 * @returns entry metadata; listing an entry does not establish availability.
 */
listEntryPoints(): readonly WebTestEntryPoint[]

/**
 * Whether an entry point is currently provided, so the Client can show an action as
 * unavailable instead of offering a control with no backend behind it.
 * @param id - stable entry-point identity.
 * @returns true when this assembly provides it.
 */
provides(id: string): boolean

/**
 * Record that this assembly backs one declared entry point, so a Client reads the
 * capability as available for exactly the lifetime of the contribution that provides it.
 * @param id - stable entry-point identity; an undeclared id is a composition error.
 * @returns the effect disposer that withdraws the availability.
 */
mount(id: string): () => Promise<void>
```

Source: [`packages/web-test/web-test/src/index.ts`](../../packages/web-test/web-test/src/index.ts)

<a id="ctxwebtestclock--webtestclock-abstract-seam"></a>

### `ctx.webTestClock` — `WebTestClock` (abstract seam)

The instant one policy decision reads.

```ts cordis-catalog
/**
 * The current instant.
 * @returns epoch milliseconds.
 */
abstract now(): number
```

Source: [`packages/web-test/web-test-policy/src/clock.ts`](../../packages/web-test/web-test-policy/src/clock.ts)

<a id="ctxwebtestcommands--webtestcommands"></a>

### `ctx.webTestCommands` — `WebTestCommands`

The web testing command Remote. One instance per application; it reads the entry's association for the Session each ask names and the runtime's published record for the project that association holds.

```ts cordis-catalog
/**
 * The closed command set, with each verb's availability in this stage and the
 * subjects a status query may name. It needs no Session, so a card renders the
 * set before one is selected.
 * @returns the catalogue, from the same table both callers read.
 */
@Remote describeCommands(): CommandCatalogue

/**
 * List identities the user may explicitly select without exposing project material.
 * @returns published identities and revisions only.
 */
@Remote listProjects(): ProjectSummary[]

/**
 * Attach an explicitly selected project to a live conversation.
 * @param request - selected Session and project.
 * @returns the selected project's metadata.
 */
@Remote async attachProject(request: AttachProjectRequest): Promise<ProjectMetadata>

/**
 * Register user metadata through the authoritative runtime and attach its project.
 * @param request - live Session and explicit registration fields.
 * @returns the published metadata, including unusable or absent material.
 */
@Remote async registerProject(request: ConversationRegistrationRequest): Promise<ProjectMetadata>

/**
 * Atomically correct the attached project's roots and URLs without creating another project.
 * Older declarations, observations and permissions retain their earlier revision.
 * This performs no URL request and grants no environment confirmation.
 * @param request - live conversation, displayed project identity and revision, and replacement metadata.
 * @param signal - optional caller cancellation; checked before staging and publication.
 * @returns the committed metadata with the same identity and its new revision.
 * @throws {WebTestConversationError} when the conversation changed its selected project.
 */
@Remote async updateProject(request: ConversationProjectUpdateRequest, signal?: AbortSignal): Promise<ProjectMetadata>

/**
 * Explicitly check and save reachable HTTP responses for this conversation's registered URLs.
 * Registration and status queries never perform this request. This grants no test permission.
 * @param request - live conversation and displayed project identity and revision; no URL may be supplied.
 * @param signal - optional caller cancellation; remaining URLs are saved as cancelled.
 * @returns the saved observation, with HTTP status and its checked revision.
 * @throws {WebTestConversationError} when the conversation changes its selected project while checking.
 */
@Remote async probeEntryUrls(request: ConversationEntryUrlProbeRequest, signal?: AbortSignal): Promise<StoredEntryUrlProbe>

/**
 * Confirm explicit environment facts through the policy for this Session's project.
 * @param request - live Session and user declaration; no other project can be named.
 * @returns current status after the policy accepted the declaration.
 */
@Remote async declareEnvironment(request: ConversationDeclarationRequest): Promise<StatusReport>

/**
 * Answer one status question about the Session's own project.
 *
 * This method reads. It publishes nothing, commits nothing, and returns no run
 * identity or receipt, so there is no value in its answer a caller could hand
 * to {@link submitAction}: the two requests do not share a type.
 * @param request - the Session asking and the subject it reads.
 * @returns the project's published record, the facts this host finds, and the
 * command set.
 * @throws {WebTestConversationError} `unknown-command` when the request is not
 * a web testing command, `verb-mismatch` when it names a mutating verb, and
 * `incomplete-query` when the subject is absent or outside the closed set.
 */
@Remote queryStatus(request: StatusQueryRequest): StatusReport

/**
 * Decide one mutating ask.
 *
 * The order of the refusals is the point: a Session attached to no project is
 * refused before anything is read about a project, an ask that named too little
 * is answered with the specific fields it owes, and an answer given against a
 * project revision that has since moved is refused as stale rather than
 * performed. Only then is a verb this stage does not implement answered
 * `unavailable`, with the domain that would have to exist.
 * @param request - the Session asking, the mutating verb, its target, and the
 * project revision the answer was given against.
 * @returns the clarification, the staleness refusal, or the unavailability, and
 * never a report that an action was performed.
 * @throws {WebTestConversationError} `unknown-command` when the request is not
 * a web testing command, `verb-mismatch` when it names the query verb, and
 * `no-project` when the Session it names is attached to no project.
 */
@Remote submitAction(request: ActionRequest): ActionOutcome
```

Source: [`packages/web-test/web-test-conversation/src/commands.ts`](../../packages/web-test/web-test-conversation/src/commands.ts)

<a id="ctxwebtestcontracts--webtestcontracts"></a>

### `ctx.webTestContracts` — `WebTestContracts`

The Web testing contract boundary (`ctx.webTestContracts`): one Service Definition whose Remote methods validate a caller request and hand back the branded record, plus the declaration-scope evaluation that needs no stored state.

```ts cordis-catalog
/**
 * Validate a project registration request before any project is created.
 * @param request - command token, code roots, and already-started entry URLs.
 * @returns the validated registration with a branded command token.
 * @throws a `web-test/*` failure naming the offending field.
 */
@Remote registerProject(request: RegisterProjectRequest): ValidatedProjectRegistration

/**
 * Validate a domain record submission before the authoritative committer
 * writes it.
 * @param request - command token, record identity, and the caller's last read revision.
 * @returns the validated submission with branded identities and revision.
 * @throws a `web-test/*` failure naming the offending field.
 */
@Remote submitRecord(request: SubmitRecordRequest): ValidatedRecordSubmission

/**
 * Validate one environment declaration the user confirmed; an ordinary URL,
 * domain, or model inference does not stand in for this call. The declaration
 * covers every code root the project registered, and carries the login and the
 * requirements the user added on top of them.
 * @param declaration - code roots, entry URL, test-environment flag, login, and added requirements.
 * @returns the normalized declaration.
 * @throws a `web-test/*` failure naming the offending field.
 */
@Remote confirmEnvironmentDeclaration(declaration: EnvironmentDeclaration): EnvironmentDeclaration

/**
 * Validate an environment confirmation request and its nested declaration.
 * @param request - project identity, command token, and the declaration.
 * @returns the validated confirmation with branded identities.
 * @throws a `web-test/*` failure naming the offending field.
 */
@Remote confirmEnvironment(request: ConfirmEnvironmentRequest): ValidatedEnvironmentConfirmation

/**
 * Validate a policy request and report whether a confirmed declaration covers
 * it. A refusal names the field or path it was made against; the result is an
 * input to the policy service, not an authorization it grants.
 * @param request - project identity, subject, and optional target path.
 * @param declaration - environment the user confirmed for that project.
 * @returns the evaluation and its closed reason.
 * @throws a `web-test/*` failure naming the offending field.
 */
@Remote evaluatePolicy( request: EvaluatePolicyRequest, declaration: EnvironmentDeclaration, ): PolicyDecision
```

Source: [`packages/web-test/web-test-contracts/src/index.ts`](../../packages/web-test/web-test-contracts/src/index.ts)

<a id="ctxwebtestconversation--webtestconversation"></a>

### `ctx.webTestConversation` — `WebTestConversation`

The conversation entry. One instance per application; the gates it owns are per agent and live exactly as long as the agents do.

```ts cordis-catalog
/**
 * Attach one session to the project it is about to test, and open the tools
 * that attachment permits.
 *
 * The project must already be published: a name with no published entry is
 * refused rather than attached to, so a conversation is never associated with
 * a project that does not exist.
 *
 * Attaching the project a session already has refreshes that attachment
 * instead of moving it, and leaves the live binding alone: the ledger's
 * disposer withdraws a binding by project value, so retiring the lease this
 * call is standing on would withdraw the binding itself. Attaching another
 * project withdraws the previous binding before the new one is taken, so a
 * session holds exactly one lease and no stale authorization survives the
 * move. Either way the confirmation is dropped, and the tools reopen only once
 * the environment is confirmed again.
 * @param sessionId - the session whose conversation is being attached.
 * @param projectId - the project that conversation is about to test.
 * @returns the published metadata the attachment is made against.
 * @throws {WebTestConversationError} `unpublished-project` when the head
 * publishes no entry for the project.
 */
attach(sessionId: string, projectId: ProjectId): ProjectMetadata

/**
 * Record the environment one attached session confirmed, and open the tools
 * that confirmation permits.
 *
 * The declaration is the policy's own: this entry passes the request to
 * `WebTestPolicy.declareEnvironment`, which validates every field with the
 * contract parser and resolves the code root canonically. The project the
 * request names must be the one the session is attached to, because the policy
 * declares per project and would otherwise let a conversation confirm an
 * environment belonging to a project it is not testing.
 * @param sessionId - the session whose conversation confirmed the environment.
 * @param request - the confirmation request; `projectId` is filled in from the
 * attachment when the caller names none.
 * @returns the declared environment as the policy resolved it.
 * @throws {WebTestConversationError} `unassociated-session` when the session
 * has no project, `project-mismatch` when the request names another one, and
 * any `web-test-policy/*` or `web-test/*` failure the policy raises.
 */
declareEnvironment(sessionId: string, request: Record<string, unknown>): DeclaredEnvironment

/**
 * Read what one session's conversation may act on right now.
 *
 * This is the context the command Remote resolves every ask against, and the
 * only source it has: a session with no project of its own reads as
 * `ordinary` and reaches no project, because this method looks up one Session
 * id and has no second lookup to fall back to. The project record is read live
 * rather than remembered from the attachment, so its revision is the one an
 * action is compared against and a project that moved since the user answered
 * is visible here.
 * @param sessionId - the session whose context is being read.
 * @returns the attached context, or `ordinary` for a session attached to nothing.
 * @throws {WebTestConversationError} `unpublished-project` when the project this
 * session is attached to has no published entry, which is the same fact
 * {@link attach} refuses to establish.
 */
context(sessionId: string): ConversationContext
```

Source: [`packages/web-test/web-test-conversation/src/index.ts`](../../packages/web-test/web-test-conversation/src/index.ts)

<a id="ctxwebtestmodels--webtestmodels"></a>

### `ctx.webTestModels` — `WebTestModels`

The Web testing model-configuration authority.

It mounts over the LLM runtime and the credentials service, owns the durable selection record, and holds the recoverable wait. It never stores a credential: the only credential fact it reads is whether a reference still resolves.

```ts cordis-catalog
/**
 * Read the latest persisted revision of a model task policy.
 * @param kind - task kind; exact-value never dispatches a model.
 * @returns a detached policy revision, absent when none was configured.
 */
async getPolicy(kind: PolicyTaskKind): Promise<RoutePolicyRevision | undefined>

/**
 * Verify primary and fallback routes, then append a new policy revision.
 * @param input - validated policy inputs from the configuration caller.
 * @param signal - caller cancellation for capability probes.
 * @returns the independently owned persisted revision.
 */
async issuePolicy(input: RoutePolicyRevision, signal?: AbortSignal): Promise<RoutePolicyRevision>

/**
 * Admit work under its persisted revision and exact verified primary route.
 * @param kind - model task kind; deterministic work is refused here.
 * @param workId - caller-owned identity of this work.
 * @param signal - caller cancellation for the probe.
 * @returns immutable result ownership and a recoverable work ticket.
 */
async admitPolicy( kind: PolicyTaskKind, workId: PolicyWorkId, signal?: AbortSignal, ): Promise<{ record: PolicyRecord; ticket: WorkTicket }>

/**
 * Read one credential reference's state, for a surface that must not read a value.
 * @param ref - the reference to describe.
 * @returns the reference's state, or `undefined` when the provider refused the read.
 */
async describeCredential(ref: CredentialRef): Promise<CredentialInfo | undefined>

/**
 * Record that a reference no longer resolves, moving the work pinned to it into
 * the wait that names a removal rather than a replacement.
 * @param ref - the reference that stopped resolving.
 */
noteCredentialAbsent(ref: CredentialRef): void

/**
 * Admit one unit of work, pinned to the route it starts on.
 *
 * Each admission takes the next unit ordinal, so two units of work on one
 * route are two tickets: settling one must not report the other finished, and
 * a credential change must park each of them on its own identity.
 * @param taskType - the task type the work is for.
 * @param route - the exact route the work runs on.
 * @returns the tracked ticket, whose identity resumes the work.
 */
beginWork(taskType: ModelTaskType, route: ModelRoute): WorkTicket

/**
 * Report one unit of work finished.
 *
 * A parked ticket is refused: work interrupted by a credential change was cut
 * off mid-flight, so this is not a report anyone can support, and accepting it
 * would drop that work out of the recoverable wait. The caller resumes the
 * ticket, or forgets it, instead.
 * @param ticket - the ticket the caller was given.
 * @returns true when a running ticket was tracked and is now settled.
 */
completeWork(ticket: WorkTicket): boolean

/**
 * Drop one ticket, whether it is running, parked, or settled.
 *
 * This is the half of a parked unit's end that is not a report that it
 * finished: {@link completeWork} is refused for a parked ticket, so a caller
 * that has decided the work is abandoned rather than resumed drops the ticket
 * here. The registry keeps nothing about it afterwards.
 * @param workId - the identity the caller was given.
 * @returns true when a tracked ticket was dropped.
 */
forgetWork(workId: string): boolean

/**
 * The recoverable wait's current contents.
 * @returns every ticket parked on a credential change.
 */
waitingWork(): WorkTicket[]

/**
 * Re-verify a parked ticket's **own pinned route** with a real request and,
 * if it answers, let the work continue there.
 *
 * This is the whole of "no silent model switch": the route is read from the
 * ticket, one real request is addressed at exactly that provider and model, and
 * the outcome is either that same route or a continued wait. Selection is not
 * re-run, so a route the user removed cannot be quietly replaced by another.
 * @param workId - the identity the caller admitted.
 * @param signal - caller cancellation for the verification request.
 * @returns the re-verified selection, or the wait continuing with the reason;
 * credential changes before readiness publication keep the ticket waiting.
 * @throws {Error} when no tracked ticket carries that identity.
 */
async resumeWork(workId: string, signal?: AbortSignal): Promise<ResumeOutcome>

/**
 * Read the live provider directory a first run would configure.
 * @returns every route the running composition declares.
 */
listProviders(): LlmConfigurableProvider[]

/**
 * List advisory model identities for one configured provider.
 * @param provider - provider identity.
 * @returns adapter-declared model identities.
 */
async listModels(provider: string): Promise<readonly { id: string }[]>

/**
 * Run one real connection test against one route, on that provider's own
 * protocol, and classify what it answered.
 * @param route - the exact provider, model, and credential reference to address.
 * @param taskType - the task type whose requirement the test belongs to.
 * @param signal - caller cancellation for the request.
 * @returns the report a surface renders.
 */
async testConnection( route: ModelRoute, taskType: ModelTaskType, signal?: AbortSignal, ): Promise<ConnectionReport>

/**
 * Verify and persist the exact route chosen in the conversation card.
 * @param provider - configured provider identity.
 * @param model - exact model identity.
 * @param taskType - task requirement being configured.
 * @param signal - caller cancellation for the real probe.
 * @returns a verified persisted selection, or safe refusal; credential changes
 * during verification or persistence require a new probe.
 */
async configureRoute(provider: string, model: string, taskType: ModelTaskType, signal?: AbortSignal): Promise<TaskRoute>

/**
 * Decide the route one task type may run on.
 *
 * A stored selection is served without a request only while its version, its
 * fingerprint, the adapter's live declaration of the modalities it carries, and
 * its verification window all still hold. With `reverify: false`, any other
 * state is reported without a probe or persistence write. With `reverify: true`,
 * the planner runs real requests, and a task type with no route is reported not ready with the reason
 * — never guessed around.
 * @param taskType - the task type to route.
 * @param options - whether a real re-verification request is acceptable.
 * @param signal - caller cancellation for the probe requests.
 * @returns the ready selection, or the not-ready record naming why.
 */
async selectRoute( taskType: ModelTaskType, options: { readonly reverify: boolean }, signal?: AbortSignal, ): Promise<TaskRoute>

/**
 * Read every task type's route decision. A read with `reverify: false`
 * issues no model probes or persistence writes.
 * @param options - whether real re-verification requests are acceptable.
 * @param signal - caller cancellation shared by the probe requests.
 * @returns the per-task decisions plus the provider directory behind them.
 */
async survey(options: { readonly reverify: boolean }, signal?: AbortSignal): Promise<ProviderSurvey>
```

Types: [CredentialInfo](credentials.zh.md) · [CredentialRef](credentials.zh.md) · [LlmConfigurableProvider](llm-streaming.zh.md)

Source: [`packages/web-test/web-test-models/src/index.ts`](../../packages/web-test/web-test-models/src/index.ts)

<a id="ctxwebtestpolicy--webtestpolicy"></a>

### `ctx.webTestPolicy` — `WebTestPolicy`

The pre-execution policy. One ledger answers for every entry path; the two enforcement points are effects of this service's context, so disposing the plugin removes the guard and restores every decorated service method.

```ts cordis-catalog
/**
 * Store the application's fixed one-pixel capability probe through the installed
 * attachment provider. No caller-supplied image or file is admitted.
 * @returns the durable reference providers may project into a model request.
 * @throws {WebTestPolicyError} when no attachment provider is installed.
 */
async createModelProbeImage(): Promise<ImageAttachmentRef>

/**
 * Capture only the calling Agent's Main-authorized page and persist its verified image.
 * @param sessionId - The calling Agent's own Session identity.
 * @param signal - Cancellation for the original capture; a failed or late capture is not retried.
 * @returns the durable image reference and the exact target and Host epoch that supplied it.
 * @throws {WebTestPolicyError} when identity, binding, provider or Main acceptance is absent.
 */
async captureBrowserScreenshot(sessionId: SessionId, signal: AbortSignal): Promise<{ image: ImageAttachmentRef target: DesktopBrowserTargetId hostEpoch: number }>

/**
 * Bind one session to the project its entry opened. A decision with no such
 * binding, and no single declared project to fall back to, is refused, so a
 * call that cannot name its project has no declaration to be covered by.
 * @param sessionId - the session whose entry is running.
 * @param projectId - the project that entry is testing.
 * @returns the disposer that withdraws the binding.
 */
bindEntry(sessionId: string, projectId: ProjectId): () => void

/**
 * Record one confirmed environment declaration. The request is validated by
 * the contract's own parser, so a Client, the Runtime, and this service reject
 * the same illegal field with the same code and the same field name.
 * @param request - project identity, command token, and the declaration.
 * @returns the declared environment as the policy resolved it.
 * @throws a `web-test/*` failure naming the offending field, or a
 * `web-test-policy/*` failure naming what the declaration could not stand behind.
 */
declareEnvironment(request: Record<string, unknown>): DeclaredEnvironment

/**
 * Grant one concrete flow the right to act, bounded by record, count, and
 * validity. A count above the configured ceiling is refused rather than
 * silently reduced, so a caller that asked for more than the product allows is
 * told rather than quietly given something else.
 * @param request - the flow, its plan revision, the third-party flag, and the action count.
 * @returns the granted authorization as the caller is told.
 * @throws {WebTestPolicyError} `grant-exceeds-limit` when the requested count
 * is above the configured ceiling, `no-declaration` when the session's project
 * has no confirmed environment.
 */
grantFlow(request: FlowGrantRequest): FlowGrantReceipt

/**
 * Decide one effect without spending anything, for a caller that only reports.
 * @param query - the entry, its session, and the effect it would have.
 * @returns the decision.
 */
evaluate(query: PolicyQuery): PolicyDecision

/**
 * Open or re-check the business confirmation one dependent action needs.
 * @param request - the dependent action, its session, and the flow it belongs to.
 * @returns whether a confirmation was required, and how the question stands.
 */
requireConfirmation(request: ConfirmationRequest): ConfirmationOutcome

/**
 * Apply one human answer to the question it names, re-checking the question,
 * the intended action, and the current project, environment, and plan
 * revisions before accepting it.
 * @param answer - the question identity and the context the human was shown.
 * @returns the state the question reached, and whether it must be asked again.
 * @throws {WebTestPolicyError} `unknown-question` when the identity names no question.
 */
answerConfirmation(answer: ConfirmationAnswer): { readonly state: ConfirmationState; readonly reclarify: boolean }

/**
 * Record that the caller chose not to confirm, or that the dependent work was
 * cancelled. Neither grants anything; both close the question so the next
 * attempt asks a new one.
 * @param questionId - the question to close.
 * @param state - `skipped` for a declined confirmation, `cancelled` for abandoned work.
 * @returns the state the question reached.
 * @throws {WebTestPolicyError} `unknown-question` when the identity names no question.
 */
closeConfirmation(questionId: string, state: 'skipped' | 'cancelled'): ConfirmationState
```

Types: [DesktopBrowserTargetId](sidebar-right.zh.md) · [ImageAttachmentRef](attachment.zh.md) · [SessionId](core.zh.md)

Source: [`packages/web-test/web-test-policy/src/index.ts`](../../packages/web-test/web-test-policy/src/index.ts)

<a id="ctxwebtestprototypeowner--webtestprototypecontrol"></a>

### `ctx.webTestPrototypeOwner` — `WebTestPrototypeControl`

Production owner for bounded run registration and dispatch admission; no authority is returned.

```ts cordis-catalog
/**
 * Register a bounded batch before external operations begin.
 * @param run - Initial running or paused head without operations.
 * @param actualCompositionHash - Actual business composition digest.
 * @param callerOwnerCtx - This Service's exact trusted owning Context.
 * @returns after the Runtime durably registers the head.
 */
registerRun(run: PrototypeRunHead, actualCompositionHash: string, callerOwnerCtx: Context): Promise<void>

/**
 * Commit a single operation before its consumer dispatches business I/O.
 * @param runId - Registered running batch.
 * @param operationId - Original operation identity.
 * @param intent - Canonical business operation description.
 * @param callerOwnerCtx - This Service's exact trusted owning Context.
 * @returns the committed ISSUED operation.
 */
admit( runId: PrototypeRunId, operationId: PrototypeOperationId, intent: PrototypeBusinessIntent, callerOwnerCtx: Context, ): Promise<PrototypeOperation>

/**
 * Retain uncertainty for an admitted operation without dispatching again.
 * @param operationId - Original admitted operation.
 * @param callerOwnerCtx - This Service's exact trusted owning Context.
 * @returns after UNKNOWN is committed.
 */
markUnknown(operationId: PrototypeOperationId, callerOwnerCtx: Context): Promise<void>

/**
 * Persist success after the trusted consumer observes the original operation's successful acknowledgement.
 * @param operationId - Original ISSUED operation; missing and UNKNOWN identities refuse settlement.
 * @param callerOwnerCtx - This Service's exact trusted owning Context.
 * @returns after completion is committed, without completing the whole run or sending business I/O.
 */
markCompleted(operationId: PrototypeOperationId, callerOwnerCtx: Context): Promise<void>

/**
 * Persist a correlated browser denial for the original issued operation.
 * @param operationId - Original ISSUED operation; UNKNOWN identities refuse settlement.
 * @param receipt - Real wire denial correlated by the trusted consumer with its current tool execution.
 * @param callerOwnerCtx - This Service's exact trusted owning Context.
 * @returns after NOT_EXECUTED and the receipt commit; the original intent remains unavailable for dispatch.
 */
markNotExecuted( operationId: PrototypeOperationId, receipt: PrototypeNotExecutedReceipt, callerOwnerCtx: Context, ): Promise<void>

/**
 * Close the run gate before returning its durable pause promise.
 * @param runId - Existing unfinished batch; UNKNOWN operations remain unsettled.
 * @param callerOwnerCtx - This Service's exact trusted owning Context.
 * @returns the real committed pause receipt; local closure survives publication failure.
 */
pause(runId: PrototypeRunId, callerOwnerCtx: Context): Promise<PrototypePauseReceipt>

/**
 * Check local and durable admission after awaits and immediately before dispatch.
 * @param runId - Registered run to check without writing or sending business I/O.
 * @param callerOwnerCtx - This Service's exact trusted owning Context.
 * @returns after validation; closed or unknown runs throw.
 */
assertDispatchable(runId: PrototypeRunId, callerOwnerCtx: Context): void

/**
 * Stop new admissions and durably revoke this prototype executor.
 * @param callerOwnerCtx - This Service's exact trusted owning Context.
 * @returns after admitted writes drain and revocation is committed.
 */
revoke(callerOwnerCtx: Context): Promise<void>
```

Source: [`packages/web-test/web-test-runtime/src/prototype-control.ts`](../../packages/web-test/web-test-runtime/src/prototype-control.ts)

<a id="ctxwebtestrecovery--webtestrecovery"></a>

### `ctx.webTestRecovery` — `WebTestRecovery`

A Loader-mounted coordinator; the recovery profile contains no business dispatch services.

```ts cordis-catalog
/**
 * Read the existing run heads without loading Sessions or modifying records.
 * @returns the cold snapshot, including completeness errors.
 */
inspect(): Promise<PersistentActivitySnapshot>

/**
 * Verify dispatch revocation and capture the last committed generation inventory.
 * @param authority - opaque authority issued to the trusted recovery Host owner.
 * @returns manifest retaining pause, cancellation, UNKNOWN, reports, and attachments.
 */
freeze(authority: RecoveryAuthority): Promise<FrozenRunManifest>

/**
 * Check the frozen executor format and build an independent recovery-only candidate.
 * @param newPackageHash - exact target combination SHA-256 digest.
 * @param authority - opaque authority issued to the trusted recovery Host owner.
 * @returns intent binding source, backup, candidate, and combination identities.
 */
prepare(newPackageHash: string, authority: RecoveryAuthority): Promise<RecoveryUpdateIntent>

/**
 * Recheck all materials before publishing the candidate generation pointer.
 * @param intent - exact prepared intent; predecessors remain available.
 * @param authority - opaque authority issued to the trusted recovery Host owner.
 * @returns after the candidate becomes selected in recovery-only mode.
 */
activate(intent: RecoveryUpdateIntent, authority: RecoveryAuthority): Promise<void>
```

Source: [`packages/web-test/web-test/src/recovery-entry.ts`](../../packages/web-test/web-test/src/recovery-entry.ts)

<a id="ctxwebtestruntime--webtestruntime"></a>

### `ctx.webTestRuntime` — `WebTestRuntime`

The Web testing persistence authority. Opens the `webtest` domain behind the control-root write lock, publishes every change through the catalog head, and serves strict reads of the published projects.

```ts cordis-catalog
/**
 * The control root this writer claimed and the generation it resolved. Read
 * only after init; a caller uses it to route the storage backend at the same
 * data root the lock identity describes.
 * @returns the claimed control identity.
 */
identity(): ControlIdentity

/**
 * Read cold durable prototype activity, without loading Sessions or writing.
 * @returns committed heads and explicit completeness errors.
 */
readPersistentActivity(): Promise<PersistentActivitySnapshot>

/**
 * Explicitly register the bounded M0 prototype domain, including an empty cut.
 * @param cut - format-3 initial committed heads; an existing cut is never overwritten.
 * @param authority - private authority held by the actual prototype producer.
 * @returns after the initial cut is committed under this Runtime's lock.
 */
initializePrototypeActivity(cut: PrototypeActivityCut, authority: PrototypeAuthority): Promise<void>

/**
 * Register a bounded run on the same durable queue as operation admission.
 * @param run - Initial running or paused head, with revision one and no operations.
 * @param actualCompositionHash - Business composition digest bound by the first registration.
 * @param authority - Private authority held by the actual prototype producer.
 * @returns after registration is committed without replacing any existing head.
 */
registerPrototypeRun(run: PrototypeRunHead, actualCompositionHash: string, authority: PrototypeAuthority): Promise<void>

/**
 * Commit a single prototype dispatch admission before any external operation.
 * @param runId - original registered running batch.
 * @param operationId - original operation identity.
 * @param intent - normalized business intent, independent of run/command identity.
 * @param authority - private authority held by the actual prototype producer.
 * @returns the ISSUED record; repeated intent, pause and recovery-only reject.
 */
admitPrototypeOperation( runId: PrototypeRunId, operationId: PrototypeOperationId, intent: PrototypeBusinessIntent, authority: PrototypeAuthority, ): Promise<PrototypeOperation>

/**
 * Preserve an original operation's uncertain outcome without settling it.
 * @param operationId - original admitted operation identity.
 * @param authority - private authority held by the actual prototype producer.
 * @returns after the UNKNOWN cut is committed.
 */
markPrototypeOperationUnknown(operationId: PrototypeOperationId, authority: PrototypeAuthority): Promise<void>

/**
 * Commit success only after the trusted consumer observes the original operation's successful acknowledgement.
 * @param operationId - Original ISSUED identity; UNKNOWN cannot be promoted to success.
 * @param authority - Private authority held by the current trusted prototype producer.
 * @returns after completion is durable; this method performs no business I/O or whole-run settlement.
 */
markPrototypeOperationCompleted(operationId: PrototypeOperationId, authority: PrototypeAuthority): Promise<void>

/**
 * Commit confirmed browser non-execution for its original issued operation.
 * @param operationId - Original ISSUED identity; UNKNOWN cannot settle.
 * @param receipt - Trusted producer's current tool-call and verified wire denial association.
 * @param authority - Private authority held by the current trusted prototype producer.
 * @returns after NOT_EXECUTED and the full receipt are committed; repeated intent stays forbidden.
 */
markPrototypeOperationNotExecuted( operationId: PrototypeOperationId, receipt: PrototypeNotExecutedReceipt, authority: PrototypeAuthority, ): Promise<void>

/**
 * Close this run's gate synchronously and durably preserve its pause request.
 * @param runId - Registered unfinished batch; UNKNOWN identity and references remain unchanged.
 * @param authority - Private authority held by the current trusted prototype producer.
 * @returns after atomic publication, with the committed cut and head revisions.
 */
pausePrototypeRun(runId: PrototypeRunId, authority: PrototypeAuthority): Promise<PrototypePauseReceipt>

/**
 * Check the current run gate after every await and immediately before business I/O.
 * @param runId - Registered run whose durable head grants ordinary admission.
 * @param authority - Private authority held by the current trusted prototype producer.
 * @returns after validation; no admission, resume or business operation is performed.
 */
assertPrototypeRunDispatchable(runId: PrototypeRunId, authority: PrototypeAuthority): void

/**
 * Disable new prototype admissions and persist revocation before shutdown.
 * @param authority - private authority held by the actual prototype producer.
 * @returns after prior admissions drain and the committed executor is revoked.
 */
revokePrototypeDispatch(authority: PrototypeAuthority): Promise<void>

/**
 * Register one project, or return the receipt the same command already earned.
 *
 * The first call commits a reservation, builds the child record, and publishes
 * the entry; a resend with the same token and the same parameters returns that
 * first receipt without writing anything, and a resend with different
 * parameters is refused. An attempt interrupted after the reservation resumes
 * from it under the same resource identity.
 * @param request - raw registration request; the contract parser validates every field.
 * @returns the receipt for the committed, published project.
 * @throws {WebTestRuntimeError} `command-token-reuse` when the token registered other parameters.
 */
async registerProject(request: Record<string, unknown>): Promise<CommandReceipt>

/**
 * Read one project's committed version for a change made outside the queue.
 *
 * This performs no I/O: it reads the domain's in-memory state, which is the
 * same state every commit published. The value it returns is what
 * {@link commitProjectUpdate} revalidates.
 * @param projectId - the project the caller intends to change.
 * @returns the read cut a commit will be accepted against.
 * @throws {WebTestRuntimeError} `record-unpublished` when the project has no published entry.
 */
prepareProjectUpdate(projectId: ProjectId): PreparedProjectUpdate

/**
 * Commit one prepared project change.
 *
 * The submission is validated by the contract parser, then the serial queue
 * rechecks the expected revision against committed state before writing. A
 * stale read is refused rather than applied, so long I/O outside the queue
 * cannot silently overwrite a change the caller never saw. The commit is three
 * writes — stage the content on the record, publish the entry with one head
 * write, fold the content in — and a resend of the same command token answers
 * from the head's ledger, so an interrupted commit is completed by sending the
 * same command again rather than by a fresh read cut.
 * @param request - raw submission request; the contract parser validates every field.
 * @param prepared - the read cut from {@link prepareProjectUpdate}.
 * @param metadata - the code root and entry URLs the project should carry.
 * @param condition - optional conversation association and synchronous live-owner check,
 * checked inside the write queue and before publication.
 * @returns the committed record identity and the revision the committer accepted.
 * @throws {WebTestRuntimeError} `record-mismatch` when the submission addresses
 * another record, `stale-revision` when the prepared cut no longer holds, or
 * `command-token-reuse` when the token already published another change.
 */
async commitProjectUpdate( request: Record<string, unknown>, prepared: PreparedProjectUpdate, metadata: ProjectMetadataUpdate, condition?: { readonly sessionId: SessionId; readonly projectId: ProjectId; readonly assertCurrent: () => void }, ): Promise<RecordCommit>

/**
 * Read one published project.
 *
 * Visibility is the catalog head's entry, not the record's existence: a
 * reserved or half-built project has a durable record and is still absent
 * here, so no consumer can pick up an entity whose creation never completed.
 * @param projectId - the project to read.
 * @returns the project's committed metadata, or `undefined` when no entry is published.
 * @throws {WebTestRuntimeError} `record-unpublished` when the head publishes an entry the records do not support.
 */
readProject(projectId: ProjectId): ProjectMetadata | undefined

/**
 * List every published project.
 * @returns the committed metadata of each published project.
 * @throws {WebTestRuntimeError} `record-unpublished` when the head publishes an entry the records do not support.
 */
listProjects(): ProjectMetadata[]

/**
 * Save the project explicitly selected by one session, after verifying it is published.
 * @param sessionId - the official session identity.
 * @param projectId - the published project selected by the user.
 * @returns resolution after the association is durable; no authorization is saved.
 */
async saveSessionProject(sessionId: SessionId, projectId: ProjectId): Promise<void>

/**
 * Read a saved session selection without restoring a declaration or permission.
 * @param sessionId - the official session identity to read.
 * @returns the published project identity, or undefined for an unassociated session.
 * @throws {WebTestRuntimeError} when the saved record names a different session or unpublished project.
 */
readSessionProject(sessionId: SessionId): ProjectId | undefined

/**
 * Save user-stated environment facts against the currently published project revision.
 * @param projectId - the project the user described.
 * @param declaration - declared roots, URL, login, and supplementary requirements.
 * @param revision - published revision the declaration describes.
 * @returns resolution after durability; confirmation and authorization remain process-local.
 * @throws {WebTestRuntimeError} when the revision or declared roots and URL do not match the project.
 */
async saveEnvironment(projectId: ProjectId, declaration: EnvironmentDeclaration, revision: Revision): Promise<void>

/**
 * Read saved user facts, including stale facts for display, without treating them as permission.
 * @param projectId - the published project to read.
 * @returns an owned copy of the declaration and its revision, or undefined if none was saved.
 */
readEnvironment(projectId: ProjectId): StoredEnvironment | undefined

/**
 * Explicitly observe all URLs registered at one published revision, then save once.
 * No target may be supplied by the caller; redirects and credentials are never followed.
 * Cancellation saves cancelled findings for the remaining targets. Disposal waits for
 * requests and the durable write to settle before closing storage.
 * @param projectId - published project to observe.
 * @param expectedRevision - revision whose registered targets the caller selected.
 * @param signal - optional caller cancellation, including a model tool's signal.
 * @returns the durable observation; HTTP errors remain responses with their status.
 * @throws {WebTestRuntimeError} if the revision changes before observation or publication.
 */
async probeEntryUrls(projectId: ProjectId, expectedRevision: Revision, signal?: AbortSignal): Promise<StoredEntryUrlProbe>

/**
 * Read the latest saved URL observation, including an older revision for display.
 * This never requests a URL or restores environment confirmation.
 * @param projectId - published project whose observation is read.
 * @returns an owned saved value, or undefined when URLs have never been checked.
 * @throws {WebTestRuntimeError} when saved identity or registered addresses disagree.
 */
readEntryUrlProbe(projectId: ProjectId): StoredEntryUrlProbe | undefined

/**
 * The notifications committed after the last acknowledgement, in sequence order.
 *
 * They are read from the same head write that published the entry they
 * describe, so a notification never exists for a commit that did not land and
 * never goes missing for one that did.
 * @returns the undelivered notifications.
 */
pendingNotifications(): readonly CatalogNotification[]

/**
 * Drop every notification up to and including `sequence`.
 *
 * Acknowledgement is a head write, not a table delete, so a consumer that
 * acknowledges and crashes cannot leave a notification it already handled
 * queued for redelivery, nor drop one it never saw.
 * @param sequence - the highest notification sequence the consumer has handled.
 * @returns resolution after the acknowledging head write.
 */
async acknowledgeNotifications(sequence: number): Promise<void>
```

Types: [SessionId](core.zh.md)

Source: [`packages/web-test/web-test-runtime/src/index.ts`](../../packages/web-test/web-test-runtime/src/index.ts)

<a id="ctxwebtestscopesource--webtestscopesource-abstract-seam"></a>

### `ctx.webTestScopeSource` — `WebTestScopeSource` (abstract seam)

The Service Definition every scope source implements.

```ts cordis-catalog
/**
 * Read one project's published scope.
 * @param projectId - the project to read.
 * @returns the published metadata, or `undefined` when the head publishes no entry.
 */
abstract readProject(projectId: ProjectId): ProjectMetadata | undefined
```

Source: [`packages/web-test/web-test-policy/src/scope-source.ts`](../../packages/web-test/web-test-policy/src/scope-source.ts)

<a id="web-test-events"></a>

### `web-test/*` events

<a id="web-testproject-published--parallel"></a>

#### `web-test/project-published` — parallel

A project revision has become durable and visible through the catalog head.

```ts cordis-catalog
/**
 * A project revision has become durable and visible through the catalog head.
 * @param projectId - published project identity.
 * @param revision - its committed metadata revision.
 * @mode parallel
 */
'web-test/project-published'(projectId: ProjectId, revision: Revision): void
```

Source: [`packages/web-test/web-test-runtime/src/index.ts`](../../packages/web-test/web-test-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->

<a id="dev-note"></a>
## 开发备注

无。
