# Agent Note: Development Tasks: M4 Complete Capabilities

Status: proposed

English | [中文](2026-09-28-web-testing-tasks-m4.zh.md)

## Problem

Additional execution routes and regression capabilities must complete the same product policy and evidence model.

## Proposal

Stage admission and current task status follow the collaboration guide and its TaskRegister; historical probe results do not complete these implementation cards. Task interfaces, change ownership, independent review, checks, and handoff formats follow the [Agent Development and Collaboration Guide](2026-09-28-web-testing-agent-guide.md). Change ownership must resolve to real paths through RepositoryMap and be registered when work is dispatched. A prerequisite is complete when its deliverables have been accepted by both the consumer and an independent reviewer; committing code or verbally declaring completion does not satisfy it, except for explicitly identified sub-item dependencies.

This stage contains 10 cards and depends on M3's stable scheduling. Native control, standalone browsers, and lightweight decision models each require actual passing evidence for their corresponding M0 sub-routes; M0's limited approval does not exempt them. Final delivery for this stage does not reduce features, and every route continues using unified authorization, persistence, control, evidence, and reports.

**M4-T01: Controlled Native Provider and Desktop Leases**

**Objective:** Implement file dialogs, real keyboard input, and necessary system interactions while preserving the confirmed protection level for the current account.

**Prerequisites:** `M3-T07`, `M0-T06`.

**Reading:** All of DD03, passing evidence for the P04 native sub-item, AC12/AC23, V08/V09/V13.

**Change ownership:** The sole Computer Use provider in web-test-computer, DesktopLease, and their tests.

**Work allocation:** The native-control subagent exclusively owns the Computer Use provider and lease adaptation. Schedule only one action executor per Windows input desktop; background read-only browser work may proceed independently.

**Steps:**

1. Check the actual Cua SDK discovery directory and schema, mapping only permitted window discovery, snapshots, input, and necessary clipboard operations. Do not assemble the upstream full native provider alongside it or guess tool names.
2. Integrate the same control generation and DesktopLease. Before input, revalidate window/process/focus and a fresh snapshot. Serialize native input across the desktop; do not silently increase foreground requirements.
3. Implement selection/cancel/controlled save without exposing file-dialog deletion, program launch, UAC, or changes to the application's own settings. Lock screen, sleep, RDP disconnection, and user takeover enter environment waiting. Recover from unload/SDK crashes according to durable state.

**Deliverables:** Native capability table, leases and actual input events, and focus/path denial evidence. T03 validates these on complex fixtures.

**Handoff:** T03 consumes actual native input and focus-denial behavior. T10/M5 receive SDK/system combinations, environment-waiting evidence, and user-takeover evidence.

**Normal acceptance:** Real IME/file dialogs act on owned targets, user occupancy is visible, and only one controller exists. Standalone browser work capable of running in the background continues.

**Failure controls:** Reject editor focus theft, links targeting source code, stale windows, and dangerous additional dialog operations. Crashes must not repeat delivered actions.

**Stop conditions:** Defer if the M0 native route is not approved or protection cannot be enforced at execution. Describe residual global-input race risks accurately under C01 without claiming operating-system guarantees.

**M4-T02: Managed Standalone Chrome/Edge Route**

**Objective:** Implement a managed alternative within the same Browser Use protocol when the embedded browser is limited.

**Prerequisites:** `M3-T07`, `M0-T06`.

**Reading:** DD02 capability matrix, DD12, P04 external-route evidence, AC35, V01/V03.

**Change ownership:** External-target implementation in web-test-browser, process/profile ownership, and Client target display.

**Work allocation:** The browser subagent exclusively owns the external provider implementation. Work may proceed alongside T01, but the integrator merges shared observation-schema/control-gate changes sequentially. Keep personal browsers separate from acceptance profiles.

**Steps:**

1. Use a verified combination of Playwright and actual Chrome/Edge to create isolated contexts/dedicated profiles. Record launch mode, versions, and update detection; do not take over everyday browser profiles by default.
2. Produce the same domain protocol for observation and actions and integrate authorization, control gates, recovery, evidence, and lifecycle. If CDP attachment is offered, enumerate its capabilities separately; it does not equal full managed launch.
3. Before switching routes, verify login, target, and workflow, then continue from a recoverable boundary. Do not move active pages or share Cookies without justification; record the actual execution environment.

**Deliverables:** External BrowserTarget implementation, version combinations, and closure/reconstruction evidence, with facts for corresponding DD02 rows. T03 compares both routes.

**Handoff:** T03 consumes a consistent contract across both routes. T10/M5 receive actual browser versions, capability differences, and resource inventories.

**Normal acceptance:** The same business workflow completes in dedicated profiles without identity contamination. After exit, releasable resources and retained history are clearly distinguished.

**Failure controls:** Unsupported attachment capabilities, old targets, version changes, Host disconnection, and page requests for the host control plane trigger explicit rejection/revalidation. Do not disable isolation to solve problems.

**Stop conditions:** Block the affected scenario without automatically marking success if the M0 external route is unapproved, personal profiles are mixed in, or necessary capabilities remain unclear.

**M4-T03: Complex Interaction, Identity, Complete Workflows, and Concurrency**

**Objective:** Turn the DD02 capability matrix into real executable fixtures and cover the interaction complexity required for full testing.

**Prerequisites:** `M4-T01`, `M4-T02`.

**Reading:** The full DD02 matrix, AC09/AC22/AC38/AC40/AC42/AC43/AC50/AC52, V02/V03.

**Change ownership:** Existing browser/computer executors, execution-group scheduling, F1/F2, and evidence capture.

**Work allocation:** The interaction integration subagent organizes the capability matrix. Independent page materials and read-only evidence reviews may be delegated. Native tests run serially; execution-group and shared-provider repairs return to their original owners.

**Steps:**

1. Cover cross-origin iframe/OOPIF/popup, Shadow DOM/Canvas, scrolling/dragging, Enter/newline/paste/Chinese IME, uploads/downloads, and content item by item. Direct assignment cannot substitute for required actual events.
2. Complete applicable password, CAPTCHA/SMS-code/QR-code login and manual takeover. Use the same business ID across entry points for create–process–recheck, verifying actual overlap and conflict rules in collaborative editing/approval.
3. Fix actual viewport/DPR/DPI. Add network/console capture, default key screenshots, and optional recording, explicitly stating whether native dialogs appear in recordings and any redaction limitations. Distinguish importing old state from creating clean contexts.

**Deliverables:** Complex-capability implementations, per-row matrix fixtures and evidence, role-concurrency timing, and content-verification records. Keep gaps visible for unsupported rows.

**Handoff:** T08 receives validated complex actions. T09 freezes matrix fixtures; T10 reviews both routes. Each gap must identify a specific scenario and whether an alternative has been validated.

**Normal acceptance:** Complete business workflows stay on the same record; applicable concurrency has real temporal overlap. Enabling recording yields actual material, and incorrect download content is detected.

**Failure controls:** Treating closed structures as DOM, invalid login, verification codes in exports, splicing unrelated records into a workflow, and preview scaling presented as test dimensions cannot pass. DevTools connection preemption is recoverable.

**Stop conditions:** If one route lacks a required capability and no alternative has been verified, that capability remains incomplete. Merely reporting it as unverified cannot close product acceptance.

**M4-T04: Time-Dependent Business Flows and Default Fault Recovery**

**Objective:** Support business verification after real waits and include applicable network anomalies in full testing.

**Prerequisites:** `M3-T07`, `M2-T06`, `M2-T07`.

**Reading:** DD08, AC49/AC51, F3/F5, DD02 fault rows.

**Change ownership:** Runtime time windows, controlled fault leases, backend observation, and F3 materials.

**Work allocation:** The time/fault subagent owns windows and leases. When working alongside T01/T02, edit only registered Runtime extension files; the integrator handles target-control interface changes.

**Steps:**

1. Persist planned observation windows, time zones, actual clocks, and associated business IDs. Release resources while waiting and advance independent instances, then actually observe successful/failed terminal states when due.
2. Implement network disconnection, latency, and request failures scoped to targets/contexts. Verify the effects of caches/Service Workers on injection and its removal, without affecting the Host control connection.
3. Prepare controls for inside/outside windows, sleep/reopening, missed observations, and ineffective injection. Faults and preparation obey the same environment validation; do not stop user services or change system networking on your own.

**Deliverables:** TimedObservation/FaultLease, real-time evidence of activation/removal, and expanded F3 materials. T10/M5 include them in the complete combination.

**Handoff:** T08 reuses controlled injection. T09 saves the actual-time Oracle. T10/M5 receive sleep/reopening and missed-window evidence; simulated time cannot replace actual observation.

**Normal acceptance:** Applicable anomalies enter the full plan automatically, with corresponding actual failures and recovery. Independent tasks run during waits and actual observations occur in the window.

**Failure controls:** Early triggering, missed windows, configured but ineffective simulation, failed removal, and HTTP acceptance cannot stand in for final business success.

**Stop conditions:** Real-time materials whose window has not arrived are marked waiting/not run. If simulation requires unauthorized service changes, retain the gap instead of fabricating a backend fault.

**M4-T05: Versions, Regression Baselines, and User Dispositions**

**Objective:** Make new versions and historical regression traceable without letting user corrections rewrite established facts.

**Prerequisites:** `M3-T07`, `M2-T02`, `M2-T03`, `M2-T08`.

**Reading:** DD04/DD09, report specification, AC15/AC30/AC44/AC45/AC47/AC52.

**Change ownership:** Analysis change-impact logic, Runtime baselines/dispositions, and Client history/retest cards.

**Work allocation:** The regression subagent owns snapshot comparisons, baselines, and recipes. The Client owner supplies history cards. Work may run in separate directories alongside Skills logic; shared Revision types are merged sequentially.

**Steps:**

1. Compare complete source snapshots and business expectations, displaying old/new case differences. Confirm business-behavior changes before testing; locator-only changes should not trigger repeated questions about the same rule. Record runtime-version signals separately from source versions.
2. Allow confirmed history to be selected as a baseline, binding case, visual, and rule versions. Verify compatibility with real old data/attachments/session caches; list gaps when historical materials are missing.
3. Implement versioned dispositions for false positives, expected behavior, and deferred fixes. New rules create new cases and actual retests, preserving original failures, attempts, and reports. Unfinished runs cannot replace correct baselines.
4. Create constrained ExecutionRecipeRevision for confirmed stable steps. In each round, observe again and validate prerequisites before actual execution; target ambiguity/version changes exit the recipe. Unknown actions, old coordinates, and historical pass results must not be replayed. Hand the recipe to M4-T07 as the deterministic control.

**Deliverables:** ChangeImpact, BaselineRevision, Disposition/RetestLink, and actual evidence for before/after versions, with traceable historical exports and reports.

**Handoff:** T07 must receive actual recipes, fixed cases, and reset procedures before the three-group comparison. T09/M5 receive the version chain linking original failures and user dispositions.

**Normal acceptance:** New versions prompt confirmation for actual business changes while reusing unchanged rules. User dispositions have reasons and timestamps; both old and new results remain readable.

**Failure controls:** Reject source hashes presented as deployment proof, newly generated data presented as old data, deferral presented as a fix, and deletion of old evidence. Isolate affected evidence when versions change during a run.

**Stop conditions:** Without reliable version signals, explicitly use user-declared/unknown status and do not promise detection of every hot update. Cases with unclear impact await confirmation.

**M4-T06: User Skills and Draft Confirmation Workflow**

**Objective:** Let users add testing knowledge through chat while keeping active-run rules stable.

**Prerequisites:** `M3-T07`, `M1-T06`, `M2-T02`, `M2-T03`.

**Reading:** DD04/DD05/DD09, AC19/AC20/AC21, V08/V12.

**Change ownership:** User Skill configuration/snapshot/draft services and Client diff cards; do not replace DSH development rules.

**Work allocation:** The Skills subagent owns discovery, snapshots, and draft confirmation without editing official development Skills. Relevant owners merge Client/configuration entry points; an independent acceptance reviewer attempts script/dependency boundary violations.

**Steps:**

1. Integrate global/project Skills and record scope, conflicts, sources, and versions. Freeze the local rule dependencies and content actually referenced, not merely their paths.
2. Generate concrete diff drafts from ordinary chat or testing experience. A usable new version exists only after user acceptance; rejection/no response has no effect. Save associations between drafts and confirmations.
3. Active runs continue with their original rule snapshots; new tasks may use the new version. Skill scripts, PTC, and MCP do not expand tool permissions, and knowledge templates cannot stand in for actual execution capabilities.

**Deliverables:** SkillRevision/DependencyManifest, Draft/Acceptance, and loading evidence; cases can reference the exact effective rules.

**Handoff:** T09/M5 receive versions before/after confirmation and dependency snapshots. Active Runs retain old references; new cases consume the new version. Do not silently replan active tasks.

**Normal acceptance:** After accepting a draft, new cases reflect the rule while old runs still read frozen materials. Sessions unrelated to a project do not automatically inherit another project's Skill content.

**Failure controls:** Editing original files/dependencies during execution, invalid content, unauthorized scripts, unanswered drafts, and replayed old confirmations cannot silently change active rules.

**Stop conditions:** Ask a specific question if dependencies cannot be frozen or conflicts affect expectations. Do not automatically override user rules or upstream engineering requirements.

**M4-T07: Complete Lightweight Decision-Model Adaptation, Calibration, and Performance Comparison**

**Objective:** Deliver an auditable route for decisions among bounded candidates and measure its benefits at equivalent testing quality.

**Prerequisites:** `M3-T07`, `M0-T07`, `M4-T05`; the M0 lightweight-route sub-item has passed, and T05's stable regression recipe and matching case materials have been received.

**Reading:** All of DD10/DD11, passing evidence for P05's lightweight decision-model sub-item, AC18, V10/V11, G05.

**Change ownership:** Reusable DSH adapters or provider adapters added as needed, route-candidate construction/calibration, and corresponding Session tests.

**Work allocation:** The model subagent implements adaptation/calibration. An independent evaluation subagent manages the holdout set and runs A/B/C; the T05 owner supplies the control recipe. All three groups reuse fixed workloads but reset separately to avoid cache and data contamination.

**Steps:**

1. Integrate unified DecisionRequest/DecisionResult through ctx.llm, implementing candidate selection/classification with at least one real lightweight model. Prefer existing adapters. Validate only the capabilities and proprietary protocol of the adapter actually selected, following official provider evidence. Do not require other providers' primitives or fabricate modality, confidence, or scores.
2. Candidates contain complete actions, targets, parameters, and observation generations, with revalidation before execution. Integrate M3's sole auxiliary retry path, cancellation, usage, and real Session records, retaining requested/actual model.
3. Establish separate calibration and holdout validation sets. Until threshold evidence exists, use a stronger model or deterministic path for verification. Recalibrate when models/languages/candidate generation change; drifting aliases must not use cross-request caching.
4. Preregister three groups under DD11: A general model, B deterministic execution plus ambiguity handling, and C lightweight participation. Fix cases/assertions/data and reset each group independently. Measure total duration, known input/output tokens and unknown usage, incorrect actions, detection/false positives, unverified items, and human time. Include candidate-generation cost, actual provider cache usage, stronger-model review, and recovery costs. Do not assume toolUpdate caching benefits when unsupported. Freeze primary benefit metrics and tolerances before judging results; do not switch metrics after seeing outcomes.

**Deliverables:** The final adapter combination (reuse preferred; new adapters only for gaps), CalibrationRevision, routing/cache rules, actual-provider evidence, and paired performance reports, with no predetermined speedup factor. RouteBenefitDecision separately records connected capability, qualified quality, and demonstrated benefit. Enable the lightweight route by default only for task categories meeting both quality and benefit criteria; without proven benefit, retain the capability and use the better qualified control.

**Handoff:** T09/T10 receive actual lightweight capability and RouteBenefitDecision. Default routing enables only qualified categories. Lack of benefit does not remove the implemented capability or justify falsely labeling a failed route as a speedup.

**Normal acceptance:** At least one real lightweight route is calibrated and usable, with verifiable Chinese and boundary cases; the general route also works. Contract comparisons for adapter/configuration changes do not alter scheduling, executors, or report structure. A second provider that has not actually been called cannot be described as tested.

**Failure controls:** Invalid candidates/labels/scores, unsupported capabilities, stale observations, authentication/rate-limit/transient failures, cancellation, and missing usage reach correct outcomes. Add provider-specific error controls according to the actual protocol; confidence cannot relax authorization. Include samples with more lightweight calls but slower total rounds, increased errors, and no meaningful benefit, verifying that they do not become default routes.

**Stop conditions:** Without any real lightweight-route evidence, this card awaits external conditions; another qualified candidate may be selected. Do not claim compliance using direct browser-to-SDK connections, arbitrary thresholds, or removed assertions. Do not make the route dependent on a Jev account.

**M4-T08: Optional Performance, Load, and Security Testing**

**Objective:** Deliver real optional testing capabilities that do not execute unless selected by the user.

**Prerequisites:** `M4-T03`, `M4-T04`, `M2-T06`.

**Reading:** AC11, R11, F6, DD04/DD07, environment and third-party authorization rules.

**Change ownership:** Specialized cases/execution adapters, controlled observation, and F6 fixtures; retain unified action and report protocols.

**Work allocation:** The specialized-testing subagent owns controlled performance/security adapters. An independent reviewer checks actual load and known problems. Use target environments separate from other action acceptance; all side effects still use the same permission entry point.

**Steps:**

1. Provide natural-language/option-based configuration of targets, scope, load parameters, and expected thresholds, explicitly describing requests and data side effects. Operate only on environments lawfully controlled by the user and with confirmed scope.
2. Build bounded controlled performance/concurrent-load tests and security controls such as access-control tests. Use verified actual tool entry points; advisory prose cannot count as execution results.
3. Record measured rates, latency, errors, and resources, verifying that injection achieved configured levels. Without business thresholds, report measurements only rather than independently declaring quality compliance.

**Deliverables:** SpecializedPlan, F6 normal/known-problem materials, actual measurements, and sample reports. T09 incorporates them into final materials.

**Handoff:** T09 receives F6, scope, and metric definitions. T10/M5 check that unselected tests do not run, cancellation stops new requests, and unknown thresholds produce factual reporting only.

**Normal acceptance:** After user selection, tests run and find known problems; scope and rates are verifiable, and cancellation stops new requests.

**Failure controls:** Reject execution without selection, invalid parameters, insufficient production scope, and claimed passes despite load failing to reach the configured level. Specialized testing does not remove source protection.

**Stop conditions:** Apply no load or offensive requests without specific specialized-testing/environment authorization. Mark missing tool evidence as not run without reducing the first release's optional-capability commitments.

**M4-T09: Complete F1–F6 Materials and Independent Answers**

**Objective:** Freeze all materials before formal acceptance so tests can reject incorrect implementations.

**Prerequisites:** `M4-T03`, `M4-T04`, `M4-T05`, `M4-T06`, `M4-T07`, `M4-T08`.

**Reading:** Full acceptance criteria, implementation-plan materials table, DD13, and feature handoff packages.

**Change ownership:** Official test materials, version manifests, and independent acceptance bases.

**Work allocation:** An independent acceptance-materials subagent freezes the materials; fixture owners fill gaps. A product execution Agent that has read hidden answers cannot then serve as unfamiliar-project acceptance.

**Steps:**

1. Map all six material classes to the 58 AC items, 18 V scenarios, and capability matrix. Verify availability of source code, data, history, roles, native environments, and fault injection.
2. Freeze seeds, initialization/reset procedures, normal/error controls, and independent Oracles. Retain validation samples outside calibration; tuning data cannot be the entire acceptance basis.
3. Clearly document F4's real old records/attachments and change chains, F5's actual fault evidence, and F6's authorization scope. Check whether secrets or identifiable data have entered deliverable materials.
4. Add unfamiliar-project holdout materials not used for tuning, continuing P06's independent answers, feature denominators, and human reference. Verify that internally consistent but incorrect implementations do not receive business passes; samples with leaked answers cannot count toward acceptance.

**Deliverables:** Final FixtureManifest, AC/V→fixture/Oracle index, and reset/usage instructions for direct M5 consumption.

**Handoff:** T10/M5 receive Manifest and AC/V indexes. Return invalid, leaked, or nonresettable materials to their source cards; do not change Oracles to manufacture a pass.

**Normal acceptance:** An acceptance AI without chat history can establish the environment and retrieve by ID both normal controls and controls capable of rejecting incorrect implementations.

**Failure controls:** Return cases with missing fixtures, fake history, leaked answers, self-reports as the only check, or Oracle changes that accommodate current defects.

**Stop conditions:** Keep any required acceptance lacking materials incomplete and identify its construction owner. Difficult-to-prepare scenarios cannot be relabeled inapplicable.

**M4-T10: Capability Consistency, Complete Budget, and Stage Gate**

**Objective:** Gather all routes and resource standards before release acceptance, eliminating differences otherwise discovered only at runtime.

**Prerequisites:** `M4-T09`.

**Reading:** DD02 capability matrix, implementation-plan ResourceBudgetRevision, all M4 cards, and V01–V18.

**Change ownership:** Dual-route integration tests, capability records, and final resource budgets; do not copy another support-status table.

**Work allocation:** The lead integration agent checks consistency; an independent resource reviewer measures every combination. Maintain capability facts only in DD02 and notify all consumers of changes there.

**Steps:**

1. Check every matrix row against the actual profile, recording versions, conditions, supported/limited/unsupported states, evidence, and alternatives. Embedded and external routes produce the same domain semantics, with explicit differences.
2. Measure resources for native control, standalone browsers, recording, and combined concurrency. Freeze all-combination values and reference environments, including memory peaks/slopes, handle release, disk, and control latency.
3. Check that every promised capability has a valid route and residual limitations agree with reports. Update verified design details; do not portray missing implementation as an untestable user-project problem.

**Deliverables:** M4 GateEvidence, the actual DD02 matrix, complete ResourceBudgetRevision, and release-input manifest.

**Handoff:** M5-T01 receives frozen candidate inputs, every route, and numerical budgets. Any implementation/model-policy/dependency change must identify affected evidence.

**Normal acceptance:** Required capabilities have validated routes and transparent limitations; numerical budgets exist before M5 starts, and failure semantics agree across routes.

**Failure controls:** Do not approve one successful route presented as all routes, claims of complete recording when native dialogs were not captured, missing budgets, or threshold changes used to manufacture a pass.

**Stop conditions:** Do not enter complete-delivery judgment if any first-release required capability is unverified, lightweight decision models are only stubs, or new routes lack measurements. Explicitly return to the responsible task for correction.

**Stage Handoff Gate**

F1–F6 are frozen. The full DD02 matrix has actual statuses and valid routes for required capabilities. Lightweight and general routes are independently verifiable, and complex business workflows and historical regression are complete. Freeze numerical budgets for every new combination before M5. Required capabilities dependent on external conditions cannot be deferred to “later” in exchange for a stage pass.

## Alternatives considered

**Recorded choice.** Separate authorization or recovery for native and lightweight routes would bypass shared guarantees; competing native input on one desktop is not safe parallelism.

## Acceptance criteria

Execute this proposal’s normal and failure controls and satisfy the [shared acceptance criteria](../testing/2026-09-28-web-testing-acceptance.md) and applicable task evidence requirements. Documentation migration does not establish a pass.

## Risks

A connected lightweight model can be slower or less accurate, and route capability differences must remain visible in acceptance.
