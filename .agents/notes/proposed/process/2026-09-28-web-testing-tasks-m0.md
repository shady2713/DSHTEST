# Agent Note: Development Tasks: M0 Baseline and Validation

Status: proposed

English | [中文](2026-09-28-web-testing-tasks-m0.zh.md)

## Problem

Baseline assumptions and independent fixtures must be examined before implementation depends on them.

## Proposal

Delivery state: M0 has historical probe results but has not passed. Local browser integration work is authorized to resume; waiting for an upstream automation implementation is no longer a prerequisite. Revalidate evidence affected by the selected baseline, and keep unexecuted or blocked components explicit; the collaboration guide owns current status. Task interfaces, change ownership, independent review, checks, and handoff formats follow the [Agent Development and Collaboration Guide](2026-09-28-web-testing-agent-guide.md). Change ownership must resolve to real paths through RepositoryMap and be registered when work is dispatched. A prerequisite is complete when its deliverables have been accepted by both the consumer and an independent reviewer; committing code or verbally declaring completion does not satisfy it, except for explicitly identified sub-item dependencies. [Limited development admission](2026-09-28-web-testing-tasks-m1.md#development-admission) owns permission to implement bounded sub-items before full acceptance.

This stage contains 11 cards. The P01–P08 timeboxes follow the implementation plan, initially totaling 72 effective engineering hours; preparation and summary work are recorded separately. M0-T08 may review available evidence now; final closeout still consumes M0-T09/T10/T11, and numbering does not indicate execution order. Timeboxes are neither delivery allowances nor spending limits. At expiry, issue a continue/adjust/defer decision without resetting the count.

**M0-T01: Pin the Actual Foundation, Rules, and Repository Map**

**Objective:** Give subsequent AI agents a reproducible entry into the actual project, check the selected baseline against the local checkout, and distinguish version decisions from runtime validation.

**Prerequisites:** No task prerequisites; read the development authorization scope and pinned foundation record.

**Reading:** Master guide, foundation and upstream upgrades, TD01/TD11, DD01/DD12, G01/G02/G14.

**Change ownership:** The existing CODE_ROOT and officially permitted development-record locations; preserve upstream documents and this application’s proposed notes.

**Work allocation:** The lead integration agent owns version pinning, rules, and CheckPlan. Read-only repository mapping checks may be delegated; the lead agent acquires the repository, applies foundation patches, and maintains shared manifests.

**Steps:**

1. Preserve all tracked and untracked work and reuse CODE_ROOT. Resolve dsh-v0.2.0-rc.2 to its full commit, verify the checkout, lockfile, and all retained differences, and refresh BaselineManifest under .artifacts/web-testing. Preserve original-baseline evidence separately. #4595 and #5214 are included upstream; retire duplicate backport hunks rather than applying them again. Register remaining application changes and their owners under the baseline policy. Do not independently switch to master or another tag.
2. Read rules for the root and target directories, referenced Skills, and README; check whether .harness/ exists without initializing it yourself. Distinguish official requirements, project additions, and community references; locate the authority behind any conflicting rules first.
3. Check native Windows, the toolchain, package manager, dependency locks, and official installation and verification workflows. Apply the [rc.2 impact review](2026-09-28-web-testing-upstream-baseline.md#rc2-incremental-upgrade) to CheckPlan; distinguish Desktop's installed plugin-management CLI from GUI startup and configuration inspection. Map actual directories, service entry points, generation order, and evidence ownership without pre-creating every eventual package.
4. Check actual bilingual requirements and exceptions under “Documentation Languages and Entry Points” in the foundation document. In RepositoryMap, register each document's purpose, factual ownership, in-repository location, and pairing requirements; distinguish maintained specifications from ignored local evidence. Verify the handoff at docs/developer/web-testing and the detailed proposed notes. Update English, Chinese, and consistency records together and run official checks. Preserve the upstream root README content and its application navigation link; do not replace it with the handoff entry. Verify the delivered directory contains the source, all specifications, and task instructions without depending on ignored local artifacts. Include and verify uncommitted documents when transferring to a new location. This local handoff does not require a commit; Git-only distribution needs separate commit authorization and subsequent clean-checkout verification. Task acceptance still requires actual evidence.

**Deliverables:** Initial BaselineManifest and RepositoryMap, RulesMap, and CheckPlan (actual commands, runtime environment, triggers, required credentials, and evidence locations). Also record uncommitted changes and this task's authorization boundaries for all subsequent tasks. Add an initial IntegrationSurfaceRegister listing public extensions and internal modifications, owners, alternatives, and generation/check/upgrade burden for each item.

**Handoff:** T02–T07 read the same BaselineManifest/RepositoryMap. The reviewer independently confirms the full SHA, rule scopes, and command executability before accepting them.

**Normal acceptance:** Another AI agent can use the records to locate actual source code, applicable rules, and startup/check entry points; the official tag can be checked against the local commit. Documentation mapping is explicit; the root README preserves upstream content and links to the application handoff. Maintained documents meet their applicable pairing and check requirements, and reading the specifications does not require an outside directory or ignored local artifacts.

**Failure controls:** Accurately report user changes in the directory, a missing candidate tag, toolchain mismatches, or missing rules; do not overwrite changes, guess versions, or declare readiness. Reject acceptance if a handoff README replaces the upstream entry point, applicable documents lack pairs, or translations change requirements.

**Stop conditions:** Pause affected steps and identify specific gaps if the actual repository cannot be obtained, conflicting rules affect changes, or new governance files are needed without authorization.

**M0-T02: Establish Minimal Fixtures and an Independent Oracle**

**Objective:** Prepare the minimal F1/F2/F5 materials required by P01–P08, avoiding destructive probes against real business environments.

**Prerequisites:** `M0-T01`.

**Reading:** The implementation plan's materials table, acceptance F1–F6, DD02/DD04/DD07.

**Change ownership:** Official test and fixture directories identified by RepositoryMap.

**Work allocation:** A fixture subagent builds and resets fixtures. An independent acceptance subagent holds the Oracle, defect answers, and holdout set without giving those answers to the later product execution Agent.

**Steps:**

1. Build a resettable local business fixture: role A creates a record, role B approves it, and A sees the result for that same record. Include clicks, multiline input, a file dialog, and two page states.
2. Provide a correct version and a version with an injected defect, with fixed seeds, initialization/reset entry points, business record IDs, and an independent event log. Define explicit boundaries for interruption injection.
3. Store acceptance answers separately from project code/rules supplied for product analysis; record the fixture version and safe data scope. Permission to develop fixtures does not authorize the product to modify the fixture source code under test.
4. For P06, register unfamiliar project candidates, a bounded business subset, independent answers, and how to obtain a human reference. For P07, add materials with attachments shared by Session/fork and reports. For P08, add paused/UNKNOWN samples whose old logic is stuck but whose records remain readable. Record specific missing materials; the original self-built fixture cannot replace evidence of effectiveness on unfamiliar projects.

**Deliverables:** Initial FixtureManifest, startup and reset instructions, independent Oracle, expected events, and minimal fault injection points. Supply them to M0-T03 through T07 and T09–T11; extend them later instead of rebuilding six separate applications.

**Handoff:** T03–T07 and T09–T11 receive the public FixtureManifest and reset entry point; answers go only to the corresponding acceptance reviewers. Notify active probes when material versions change.

**Normal acceptance:** External state can establish whether a creation/approval occurred without relying on the tool under test's success claim; resetting repeatedly produces the same initial state.

**Failure controls:** The independent Oracle rejects the faulty version, business counts expose duplicate submissions, and product analysis inputs exclude hidden defect answers.

**Stop conditions:** Fix the materials before probing if reset is unreliable, a fixture connects to a real third party, or expected results rely solely on the tool's own claims.

**M0-T03: P01 Desktop, Broker, and Controlled Clicks**

**Objective:** Connect controlled automation to the existing official embedded browser, demonstrate minimal actions through the desktop entry point, and compare carriers while keeping page capabilities separate from host capabilities.

**Prerequisites:** `M0-T01`, `M0-T02`.

**Reading:** P01, I01, DD01/DD02, V01, G01/G03/G06.

**Change ownership:** Minimal probe changes in the official profile/Loader, desktop Host protocol, and candidate browser ownership areas. This existing write scope permits controlled provider/Broker work without waiting for an upstream implementation.

**Work allocation:** The desktop subagent compares carriers and the Broker; isolation attack controls may be delegated. Request the integrator's lock for Host protocol and profile changes; do not write them concurrently with other probes.

**Steps:**

1. **R0 — Runtime identity and failure diagnosis.** The rc.1 audit recorded a cached Electron 44 runtime's `--version` attempt exiting with `0x80000003`; the current runtime remains pending revalidation. That historical result does not establish failure of webview, WebContentsView, or a debugger API. Record the executable and package/lockfile version, download/cache source, distribution and executable hashes, architecture, runtime dependencies, exit status, and available crash/startup logs. Check integrity against the selected distribution's metadata and preserve the failed sample. Diagnose runtime startup separately from application, renderer, guest attachment, and automation failures.
2. **R0 — Supported desktop entry.** Use the official preparation and desktop launch workflow with the pinned runtime, an application-owned data directory, and the fixture. Record actual version and startup logs, then confirm the application document and its visible browser guest load. Do not use `--no-sandbox`, disable web security, substitute a package/demo launcher, or treat a special headless `--version` result as desktop acceptance. Runtime failure blocks dependent GUI evidence; independent protocol implementation/tests may continue under [limited development admission](2026-09-28-web-testing-tasks-m1.md#development-admission).
3. **R1 — Existing carrier and composition.** Inventory the actual Loader/profile and trace existing webview lease, presentation, and release owners. The desktop already has a browsing carrier; its missing Browser Use provider and Host automation path are the work to add. Reuse those owners and register one minimal controlled provider, without rebuilding a complete browser product or rejecting a carrier for missing composition.
4. **R1 — Minimal control path.** Implement only fixture-required finite Host↔Main messages and provider operations under DD02. Update both protocol endpoints, validation/version handling, effects, and relevant tests together. Bind authenticated Host ownership, target identity, and epochs to the executor's operation allowlist; page content receives neither control credentials nor arbitrary IPC/CDP/evaluate access. Register actual source changes in IntegrationSurfaceRegister.
5. **R2 — One visible page and an independent result.** On the same leased page, obtain a fresh observation, enter the fixture's exact text through input events, click its business control, and read the independent Oracle. Correlate target/document identity, observation, action, visible state, and business record; one intended submission creates exactly one event. `Target.setAutoAttach` is not a prerequisite for this owned main-page probe. Diagnose debugger/subtarget failures at their actual layer before inferring a carrier limitation.
6. **R2 — Denial and lifecycle controls.** Exercise wrong target/owner, stale observation/document, closed target, old Host epoch, disconnect revocation, and cancellation. Attempt page/iframe/popup access to the control plane and protected fixture-path writes. The execution layer denies invalid dispatch; late callbacks cannot renew authority. Distinguish cancellation before dispatch from an already delivered action requiring business-result verification.
7. **R3 — Bounded carrier comparison.** Run the same necessary scenarios in an independently owned, unprivileged WebContentsView under the same provider/Broker rules. Compare role isolation, navigation/iframe/OOPIF and popup ownership, downloads, focus/input, viewport/screenshots, retention, and release/reconstruction. Do not reuse the privileged account view. Record supported, failed, and unverified items with causes; one failed auto-attach or other API check neither guarantees another carrier fixes it nor permits deleting a required matrix row. Select from evidence and maintenance work; do not build two complete products or promise a fixed 15–25 engineer-day schedule before comparison.

**Deliverables:** P01 ProbeResult with R0 runtime identity/diagnostics, R1 actual composition and messages, R2 correlated observation/input/Oracle and denial evidence, and R3 comparison results. Supply TargetHandle lifecycle evidence for M1-T07, plus BrowserCarrierDecision and an IntegrationSurfaceRegister comparison explaining capabilities, remaining gaps, and the measured basis for maintenance costs. Partial results do not close the full capability matrix.

**Handoff:** T05/T06/T09 consume the selected minimal integration. M1-T07 receives BrowserCarrierDecision and the TargetHandle lifecycle, not merely screenshots or source fragments.

**Normal acceptance:** The same visible desktop page supports a fresh observation, actual text input, and a click that produces one independently verifiable business event. Closing the target releases its connection; both carriers have the necessary comparison evidence. Differences between packaged and source execution paths and remaining full-matrix checks are explicit.

**Failure controls:** Pages, iframes, and popups cannot obtain host privileges. Old targets and incorrect generations cause no action, with denial evidenced at the actual execution layer.

**Stop conditions:** At timebox expiry, record remaining work and a continue/adjust/defer decision without resetting the count or declaring a pass. Do not approve a route requiring disabled sandbox/security, a global debugging port, arbitrary IPC, removal of read-only protection, or an unproven Loader entry. Runtime failures block dependent GUI acceptance; independent work under [limited development admission](2026-09-28-web-testing-tasks-m1.md#development-admission) may continue.

**M0-T04: P02 Storage Access Patterns and Recovery Probe**

**Objective:** Prioritize validation of the domain commit design with the highest concentration of custom work and determine whether segments and checkpoints are necessary.

**Prerequisites:** `M0-T01`, `M0-T02`.

**Reading:** P02, I02, DD06/DD07/DD09, V04/V05, G07/G08/G12.

**Change ownership:** Actual storage domain consumers and their tests; do not rewrite the underlying storage architecture.

**Work allocation:** The persistence subagent implements minimal commits and fault points; an independent reviewer reads external business counts. Work may proceed in separate directories alongside T03. The fixture owner updates the shared FixtureManifest.

**Steps:**

1. Through the actual storage domain combined with V4 Session, implement creation intents, child records, entry publication, action intents/facts, attachment references, and notification delivery. Measure the unique handle and commit boundaries rather than assuming cross-record transactions.
2. Inject faults during creation, after an action occurs but before its result is written, and after notification delivery but before acknowledgment. Resend commands and old slots, checking F2 external counts.
3. Compare loading, commit, read, and recovery time and memory for 1,000/10,000/100,000 representative records. Compare a valid simple layout with candidate segment/checkpoint designs.

**Deliverables:** P02 ProbeResult, access-pattern measurements, recovery boundary table, and evidence for simplifying or retaining structures, for M1-T03 and M3-T01. Also deliver StorageDesignDecision; prefer the smallest qualified structure with equivalent recovery semantics, and do not prebuild a segment/checkpoint framework without measured benefits.

**Handoff:** T05/T09–T11 consume repository and intent interfaces. M1-T03/M3-T01 receive StorageDesignDecision, sample records, and measurement scripts.

**Normal acceptance:** Committed facts remain readable, resending does not create extra resources, unknown actions enter verification, and scale measurements are reproducible.

**Failure controls:** Failed head commits, incomplete attachments, damaged records, and delayed posting at the target cannot produce false completion. Temporary absence of a business record alone cannot trigger an automatic resend.

**Stop conditions:** Defer if recovery semantics or usable performance remain unproven at timebox expiry. Do not conceal missing upstream support with direct SQL or a separate transaction layer.

**M0-T05: P03 Lifecycle, Concurrency, and Control Probe**

**Objective:** Verify that a single Agent resource queue can support real business concurrency and immediate suspension of dispatch together.

**Prerequisites:** Full-card acceptance requires `M0-T03`, `M0-T04`, and T07's accepted main-route/upstream-recovery sub-items; the lightweight sub-route may remain conditional. Queue ownership, dispatch-gate closure, persistence, and cancellation sub-items may proceed independently when their own fixtures and interfaces are available. They cannot establish real embedded-target concurrency or complete P03 before P01.

**Reading:** P03, DD02/DD07/DD08, V03/V06, G04/G07.

**Change ownership:** SessionResources consumers, Runtime commit and control entry points, and target lifecycle tests.

**Work allocation:** The runtime subagent owns independent queue/control probes and then combines them with T07's accepted main route/recovery implementation and T03's Broker. The desktop owner supports actual targets through that Broker. An independent reviewer checks concurrency timing and action counts rather than accepting Agent logs as self-proof; records identify sub-items still awaiting real targets.

**Steps:**

1. Organize two role targets within one valid SessionResources.run callback and execute operations with real temporal overlap. Do not nest run calls for the same Agent.
2. Add long business waits, large attachment saves, a nonresponding model, and Host reconstruction. Request a pause and separately measure local dispatch-gate closure and durable acknowledgment.
3. Release resources occupied by long waits and revoke old permits. Verify that late model results and old Host callbacks cannot continue operating; record ownership and cancellation propagation.
4. Create a step where some tools have completed but later preparation or dispatch fails. Check assistant call/result pairing, distinguish TOOL_OUTCOME_UNKNOWN from TOOL_NOT_STARTED, and retain completed results. Consume T07's real-request and recovery evidence, then verify scheduling, logs, and business counts; do not copy the Agent loop to implement a separate repair.

**Deliverables:** P03 ProbeResult, tool-result pairing versus business-state comparisons, execution-group and release protocols, control timing, and resource measurements for M1/M2 scheduling and M3 control extensions.

**Handoff:** T08 combines this card's message-pairing evidence with T07's. T09/T11 consume the control protocol. Deliver distinguishable samples for dispatched, not dispatched, and unknown states.

**Normal acceptance:** Both roles have isolated state and actual concurrency. Pausing blocks new dispatch without waiting for large attachment saves; reconstruction obtains a valid target again.

**Failure controls:** Nested queues, old-generation callbacks, responses after cancellation, and save failures cannot masquerade as normal continuation; verify in-flight actions separately. Missing tool results cannot automatically be treated as failures and redispatched, and uncalled tools cannot be reported as successful.

**Stop conditions:** Defer dependent work and provide a concrete adjustment proposal if the timebox expires, deadlock exists, or progress requires dropping the concurrency commitment.

**M0-T06: P04 Native Control and Standalone Browser Probe**

**Objective:** Separately establish the feasible boundaries of controlled native Windows operation and a managed standalone browser route.

**Prerequisites:** `M0-T02`, `M0-T03`.

**Reading:** P04, I03, DD02/DD03/DD12, V08/V09/V13.

**Change ownership:** The controlled Computer Use provider, the external route of the single Browser Use provider, and their tests.

**Work allocation:** Native control and external browser work may be split into two directory-scoped subtasks sharing a frozen observation protocol. Serialize native input on the same Windows desktop; the integrator merges shared provider registration.

**Steps:**

1. On native Windows, read the actual Cua SDK tool descriptions and establish a minimal allowlist. Operate file dialogs/input targets with known ownership, recording focus and leases.
2. Create managed Chrome/Edge profiles and complete a standalone browser observation/action flow. Explicitly distinguish full launch capabilities from CDP attachment.
3. Add editor focus theft, dangerous file-dialog actions, out-of-scope links, and closure/reconstruction. Report support, limitations, system combinations, and residual risks for each route separately.

**Deliverables:** P04 native and external-browser sub-results, with capability-matrix evidence links. Approve them independently for M4-T01/T02.

**Handoff:** T08 records the two sub-route results separately. M4-T01/T02 accept only their own passed sub-items; deferral of either does not change the identity of the other's evidence.

**Normal acceptance:** Actual input matches page state, profiles are isolated, and closure releases resources. CDP-only value filling cannot stand in for native testing.

**Failure controls:** Incorrect targets, stale focus, and unknown operations are blocked; denial cannot depend only on a model's verbal promise.

**Stop conditions:** Defer the affected route if the SDK lacks required protection, no native device is available, or the timebox expires. Do not equate same-account control with operating-system isolation.

**M0-T07: P05 Main-Model and Lightweight Decision-Model Auxiliary Calls**

**Objective:** Establish the actual DSH paths, recording, and recovery responsibilities for both request types, identifying lightweight decision-model capability mismatches early.

**Prerequisites:** `M0-T01`, `M0-T02`.

**Reading:** P05, I04, DD10/DD11/DD08, V10/V11/V17, G05.

**Change ownership:** Official LlmAdapter/ctx.llm consumers, Session events, and minimal typed-decision adapter probes.

**Work allocation:** The model subagent owns actual requests, capabilities, and regression of upstream-integrated #4595/#5214. The integrator alone maintains the selected-baseline composition and PatchManifest. Compare ordinary requests with and without the prototype before failure injection; T05 consumes accepted recovery evidence. Do not modify the Agent loop merely to reproduce the retired backport.

**Steps:**

1. Supply credentials through a secure configuration entry point. Make one real main-model call and perform selection/classification with at least one candidate lightweight model. Register ModelCapabilityDescriptor with the resolved adapter/dependency version and configured route; revalidate affected capabilities after rc.2's provider/catalog changes rather than treating a catalog entry or an rc.1 result as current runtime evidence. Prefer existing adapters and create a new one only for a proprietary protocol. Jev is merely an optional example; if unavailable, choose another qualified route. Verify only the actual provider's candidate-selection/classification capabilities, without requiring other providers' proprietary primitives.
2. Check actual V4 Session message construction, records, request IDs, results, usage, and finish reasons. Do not assume direct ctx.llm calls inherit the main Agent's automatic logging/retries.
3. Use a controlled local HTTP endpoint to return bounded 429 responses through the actual Loader, LlmAdapter, and Agent retry path; do not deliberately exhaust a paid provider's quota. Inject timeouts, cancellation during retry waits, reopening, and late responses; record request counts, wait termination, Session events, and recovery. The existing two-test local adapter result covers only the adapter and cannot pass this integration step. Identify the sole retry owner among the adapter, Agent plugin, and Runtime. Exercise the desktop's public [Remote cancel method](../../../../packages/api/session-controller/src/index.ts) separately from the [SDK transport's lack of wire cancellation](../../../../packages/sdk/client/src/client.ts); a missing SDK operation does not mean the desktop cannot cancel. Keep fixture-based HTTP evidence distinct from real-provider and keyless replay evidence.
4. Independently generate the partial-result/failed-dispatch scenario, send the next real model request, and verify pairing and preserved results on the selected baseline's integrated #4595 implementation. Record current build/diff identities and relevant checks; the previous baseline comparison remains historical evidence. Revalidate integrated #5214 with simultaneous image-mapping expiry and recovery. Resends apply only to model requests, never unknown business actions; do not add another repair loop.
5. Confirm that the main-route inputs/outputs and deterministic tools required by P06 work together. Separate lightweight integration capability from the benefit of enabling it by default. P05 proves only protocol usability; it cannot establish superiority over deterministic execution or add a lightweight call to every action by default.

**Deliverables:** Separate P05 main/lightweight ProbeResults, PatchManifest distinguishing upstream-integrated fixes from retained local changes, field differences, Session samples, and retry ownership for M1-T04/M3-T02/M4-T07. Record ordinary-request composition controls and real-provider evidence separately.

**Handoff:** T09 consumes only the passed main-route sub-item. M1-T04/M3-T02/M4-T07 receive connection, retry, and lightweight-contract evidence respectively. T08 checks the joint recovery gate across this card and T05.

**Normal acceptance:** Real requests are traceable to the provider; message pairing and actual subsequent requests work after a failed step. Valid decisions parse, cancellation and waiting are explainable, and credentials do not leak. Main-route acceptance must include all relevant checks for the official recovery fix.

**Failure controls:** Record unsupported capabilities, invalid results, incorrect credentials, and missing keys separately. Do not silently fall back to a generic chat request or turn an invalid decision into an action.

**Stop conditions:** A candidate lacking credentials may be replaced by another qualified candidate. If all lightweight candidates lack real evidence or the timebox expires, mark them unverified. Approve only the evidenced main route; keep the corresponding lightweight deliverables blocked.

**M0-T08: Close Out Route Decisions and Engineering Contracts**

**Objective:** Turn probes into decisions that constrain downstream work, preventing full development based on unverified assumptions.

**Prerequisites:** Review may begin now with available evidence and explicit missing items. Final M0 acceptance requires the results of `M0-T03`, `M0-T04`, `M0-T05`, `M0-T06`, `M0-T07`, `M0-T09`, `M0-T10`, and `M0-T11`; no report must be marked ready merely to start the review.

**Reading:** All ProbeResult records, the implementation plan, DD01–DD13, foundation and upstream upgrades.

**Change ownership:** RepositoryMap/CheckPlan/probe records and affected design documents; place retained probe code in its proper location.

**Work allocation:** The lead integration agent decides and pins the combination. An independent review subagent examines ProbeResult and failure evidence without editing the implementation under review. Return missing evidence to its owner; the summarizer cannot fill in a pass.

**Steps:**

1. Issue a GateDecision now from available evidence, including an explicit not-passed result when conditions remain unmet. Decide continue, adjust, or defer for each item and reference [limited development admission](2026-09-28-web-testing-tasks-m1.md#development-admission) for authorized implementation sub-items; do not duplicate its permission table here. Core desktop, domain recovery/control, main-model, and P06/P07/P08 requirements remain conditions of full M0 acceptance. Permission to develop does not establish an accepted dependency or waive remaining evidence.
2. Jointly assess T05/T07 evidence for continued sessions and no blind replay of unknown business actions. Verify upstream-integrated #4595/#5214, retained local changes, and relevant checks on the selected baseline. Old-baseline results and a successful ordinary model request do not replace failed-step revalidation. Record limited sub-item development permission separately from full admission.
3. Record actual packages, service signatures, generation, and lifecycle responsibilities in RepositoryMap. Identify genuinely necessary upstream changes and how upgrades will review them.
4. Simplify or confirm storage structures based on P02. Remove temporary probe bypasses; complete applicable tests and documentation for retained code. Link M1's current development-admission decisions and record deferred M4 branches without maintaining a competing start-permission list.
5. Check ProductEffectivenessResult, AssetLifecycleDecision, RecoveryUpdateDecision, and the integration-cost register. Decide retain/simplify/defer for every public contract or internal modification, recording estimated engineering hours, verification burden, and unknowns. Passing compliance checks cannot replace product detection capability or upgrade compatibility.

**Deliverables:** M0 GateDecision, actual baseline, revised RepositoryMap/CheckPlan, design differences, probe-code disposition, and initial resource measurements as inputs to all implementation tasks.

**Handoff:** Publish accepted inputs, missing evidence, and re-entry conditions, and link the single M1 development-admission owner for start permission. M1 may implement authorized bounded sub-items while unmet dependencies remain explicit; formal acceptance consumes accepted inputs only. Ask for a user decision only when product commitments would change, rather than seeking approval for every card.

**Normal acceptance:** Every acceptance decision has real normal/failure evidence. Each limited implementation permission retains its scope and unresolved dependencies in the admission owner; an interim not-passed GateDecision is a valid review result. A passed main route cannot conceal unverified lightweight decision-model/native branches.

**Failure controls:** Simulate reports containing only textual conclusions, probe timeouts, and contradictory results; restrictions must remain in force. Do not remove unsupported features from the matrix to declare a pass.

**Stop conditions:** If an adjustment changes product scope or protection levels, or bypasses official requirements, present concrete tradeoffs and wait for the user's decision. Engineering details may be revised within existing constraints.

**M0-T09: P06 Product Effectiveness on an Unfamiliar Project**

**Objective:** Prove early that, within a bounded scope, the product can identify functionality, distinguish incorrect from correct behavior, and reduce manual regression work.

**Prerequisites:** `M0-T02`, `M0-T03`, `M0-T04`, `M0-T05`, `M0-T07`; consume only P05's passed main route, without requiring the lightweight sub-route to pass.

**Reading:** Implementation plan P06, expected-result bases in reports, TD02/TD08, AC07/AC09/AC29/AC41.

**Change ownership:** The validated DSH probe profile, minimal analysis/controlled-execution consumers, and independent acceptance materials; do not build every M2 package in advance.

**Work allocation:** The product execution subagent reads only the public project and user rules. The independent acceptance subagent holds hidden answers and computes metrics. The lead agent preregisters the protocol and human reference so the same context does not both see answers and execute the test.

**Steps:**

1. Freeze ProductEffectivenessProtocol under the implementation plan, registering unfamiliar-project sources, bounded scope, correct/defective controls, hidden answers, human reference, run order, and the actual user-question mode. Do not expose acceptance logs to the Agent.
2. Through a real model and controlled actions, generate cases, confirm critical rules, execute, judge each item, and produce a minimal report. A timed question's timeout or pending result leaves intent unconfirmed; if timed mode is selected, cover late answers through M1-T05/T06's validity rules and perform supplemental testing only after valid confirmation. UNKNOWN, read-only boundaries, durable intents, and model records remain effective.
3. Run regression over the same scope and measure active user time. Using preregistered denominators, check identification, defects, false positives, incorrect business passes, unverified items, and manual burden; report the initial run and regression separately.

**Deliverables:** ProductEffectivenessProtocol/Result, independent Oracle comparisons, minimal workflow code and evidence, applicable scope, and failure attribution for M0-T08 and M2/M5.

**Handoff:** T08 reads Result. M2-T02/T09 and M4-T09 inherit valid samples, holdout boundaries, and the definition of human time. Materials with leaked answers cannot continue to count as unfamiliar-project validation.

**Normal acceptance:** The implementation plan's nondeferred criteria for the bounded sample are met; explicitly retain the deferred human comparison. An incorrect implementation cannot pass business validation merely by matching generated expectations, and user confirmation leads to actual supplemental testing.

**Failure controls:** Missing business intent, clear but incorrect implementation, normal pages, omitted entry points, and leaked hidden answers produce distinguishable results. Invalidate leaked samples and replace them with holdout samples.

**Stop conditions:** At the 16-engineering-hour timebox, or if independent answers are missing or nondeferred effectiveness criteria are unmet, adjust/defer. The human comparison remains deferred to M5 by user decision and cannot be reported as passed. Do not approve dependent full development or falsely claim zero missed defects.

**M0-T10: P07 Attachment References and Deletion Extension**

**Objective:** Convert the selected foundation's lack of built-in reference-aware cleanup into a verifiable extension route with explicit ownership.

**Prerequisites:** `M0-T01`, `M0-T02`, `M0-T04`.

**Reading:** DD09 attachment lifecycle, P07, AC55/G08/V16, actual AttachmentStore/provider and Session/fork reference paths.

**Change ownership:** Official attachment abstractions, actual providers, necessary reference consumers, and their tests. RepositoryMap must identify the extensions; business packages must not delete object files directly.

**Work allocation:** The attachment subagent owns official abstraction/provider extensions. Relevant owners or the integrator integrate Session/fork consumer changes sequentially. An independent reviewer verifies readability before/after deletion and released bytes.

**Steps:**

1. Inventory all reference owners for saves, publication, Session/fork, reports, snapshots, baselines, exports, and in-flight tickets. Retain unknown historical objects and record boundaries that cannot be inventoried.
2. Verify minimal retention tickets, reference commits, mutual exclusion for deletion admission, and the provider deletion protocol. Persistence failures or interruptions must not lose still-needed objects; added interfaces must follow official contract and generation requirements.
3. Use an ordinary session and two reports sharing an object to verify that deleting one does not break other consumers. Inject new-reference/export/deletion races and crashes, and independently measure physical reclamation. deleteFileVerbatim's returned logical bytes cannot replace reference coordination, deletion serialization, or open-reader controls.

**Deliverables:** AssetLifecycleDecision, actual interfaces and reference-owner table, failure controls, IntegrationSurfaceRegister costs, and staged handoffs for T08, M1-T03, M2-T05, and M3-T05.

**Handoff:** T08 accepts extension ownership. M1-T03 creates tickets, M2-T05 publishes evidence, and M3-T05 implements cleanup. List every reference owner and the retention policy for unknown history in the handoff.

**Normal acceptance:** The provider actually deletes at least one object no longer retained, while protecting shared/active objects; the original save/read contracts remain valid.

**Failure controls:** Checking only test-report references is insufficient. Ordinary chat/fork, new references, uncommitted saves, unknown history, and export readers must not cause mistaken deletion or false claims of released space.

**Stop conditions:** Defer after 8 engineering hours, if required owners cannot be inventoried, or if deletion requires constructing low-level paths. Do not approve dependent asset architecture without a valid extension route.

**M0-T11: P08 Recovery Updates and Preservation of Unknown Actions**

**Objective:** Prove that a fixed version can be entered safely when old tasks cannot progress, without turning updates into a route for duplicate business operations.

**Prerequisites:** `M0-T01`, `M0-T02`, `M0-T04`, `M0-T05`.

**Reading:** DD07/DD09/DD12, P08, AC03/G12/G16/V14, actual installation and migration entry points.

**Change ownership:** The independent recovery coordinator entry point, domain freeze/migration consumers, and their tests; preserve single-writer control-root ownership and the official installation mechanism.

**Work allocation:** The recovery subagent owns independent coordination and old-format checks. The integrator owns installation interfaces and lock identity. An independent acceptance reviewer injects interruptions without editing the lock protocol concurrently with the Runtime owner.

**Steps:**

1. Create a run whose old scheduler cannot continue but whose durable records remain readable, including user-paused and UNKNOWN states. Confirm that an independent coordinator can revoke permissions, stop old executors, acquire the lock, and back up data without waiting for business tasks to finish. Through DD12's read-only PersistentActivitySnapshot, read the control root, sample time, RunHeads, unsettled actions, and integrity errors; first prove that runs in unloaded sessions are not omitted.
2. Save FrozenRunManifest/RecoveryUpdateIntent and enter recovery-only after read-only old-format checks and candidate migration. Do not overwrite the original combination if the checker fails or the backup is inconsistent.
3. Verify that original states and unknown actions remain queryable in the new version and that a new runId cannot bypass verification. Record actual installation integration points, compatibility scope, and installation acceptance that has not yet run.

**Deliverables:** RecoveryUpdateDecision, PersistentActivitySnapshot probe evidence, freeze/recovery timing, compatibility decisions and failure controls, and integration costs for M0-T08, M3-T01, and M5-T02.

**Handoff:** T08 accepts feasibility. M3-T01 implements freezing/linkage, and M5-T02 revalidates using real old/new installers. Provide methods to check backup consistency and original paused/UNKNOWN states.

**Normal acceptance:** An unfinished old task can still obtain conditional recovery eligibility. The new version begins with read-only verification; old reports remain unchanged and paused/UNKNOWN states are not cleared.

**Failure controls:** An old executor without revoked permissions, no backup, unrecognized formats, update interruptions, and resending unknown actions under a new run must all prevent normal approval.

**Stop conditions:** Defer after 8 engineering hours or if upgrading requires forcibly canceling/settling unknown actions or concurrent writes to authoritative data. This probe does not replace M5's acceptance using real installers.

**Stage Handoff Gate**

The actual baseline and rules are locatable; all eight probes have sub-item conclusions and evidence, and M0-T08 closes out after T09–T11. Dependent full implementation and full-card M1 acceptance require core desktop/storage/control, main-model and failed-step recovery, product effectiveness, attachment lifecycle, and recovery-update routes to pass. Before that, bounded sub-items may proceed under [limited development admission](2026-09-28-web-testing-tasks-m1.md#development-admission); they do not establish full M0/M1 admission. Deferring native/external/lightweight sub-routes does not reduce final commitments. M0 cannot pass overall if any of P06/P07/P08 lacks evidence supporting continuation.

## Alternatives considered

**Recorded choice.** Building a complete framework before probes or accepting only self-built-fixture results would leave feasibility and product effectiveness unresolved.

## Acceptance criteria

Execute this proposal’s normal and failure controls and satisfy the [shared acceptance criteria](../testing/2026-09-28-web-testing-acceptance.md) and applicable task evidence requirements. Documentation migration does not establish a pass.

## Risks

Source acquisition and documentation placement complete only part of M0-T01; no probe or stage admission follows from them.
