# Agent Note: Development Tasks: M3 Durable Tasks

Status: proposed

English | [中文](2026-09-28-web-testing-tasks-m3.zh.md)

## Problem

Long tasks need durable recovery, controlled retries, takeover, progress detection, and storage limits.

## Proposal

Stage admission and current task status follow the collaboration guide and its TaskRegister; historical probe results do not complete these implementation cards. Task interfaces, change ownership, independent review, checks, and handoff formats follow the [Agent Development and Collaboration Guide](2026-09-28-web-testing-agent-guide.md). Change ownership must resolve to real paths through RepositoryMap and be registered when work is dispatched. A prerequisite is complete when its deliverables have been accepted by both the consumer and an independent reviewer; committing code or verbally declaring completion does not satisfy it, except for explicitly identified sub-item dependencies.

This stage contains 7 cards, extending M2's basic recovery into the complete matrix. Durable state, model retries, and business resends are separate concerns: model requests can keep waiting for recovery, but business operations with unknown outcomes must not be blindly repeated. Every wait must be explainable, recoverable, and queryable.

**M3-T01: Complete Crash Recovery and Write Ownership**

**Objective:** Extend minimal recovery across every critical commit boundary so reopening neither loses facts nor duplicates business operations.

**Prerequisites:** `M2-T09`.

**Reading:** DD06–DD09, AC15/AC37, V04/V05, G07/G12.

**Change ownership:** Runtime locks, recovery coordination, structures selected by StorageDesignDecision, and the outbox. Implement segments/checkpoints only if M0 proved them necessary.

**Work allocation:** The recovery subagent exclusively owns locking, recovery, and fact-commit implementation. The integrator maintains the selected composition and verifies upstream-integrated Session recovery. An independent acceptance reviewer injects crashes and checks business effects externally.

**Steps:**

1. Based on the M0-validated structure, complete recovery for interruption points in creation, actions, facts, Heads, and notifications. Read strict schema and define handling for compatibility, corruption, and unpublished orphan records.
2. Verify the same control lock across path aliases, Windows login sessions, installation identities, and data generations. Takeover is allowed only after the original owner actually exits and the lock is acquired; update Host epoch/target permits together.
3. Reconcile unknown business outcomes using independent observations, retaining delayed-posting scenarios. Deduplicate stable notification IDs through UI and model consumption. Session replay does not mean browser resources have been recovered.
4. Revalidate failed-step recovery in the combination approved by M0. Do not rewrite saved tool results; preserve the distinction between not-started and unknown outcomes. State separate recovery boundaries for already closed inconsistent old turns and log-write failures; do not claim the baseline's integrated repair automatically fixes all history. Collect separate evidence for Session repair and Runtime action verification.
5. Integrate frozen-recovery/RecoveryLink and cross-run UNKNOWN verification under P08. The independent recovery coordinator competes with Runtime for the same lock; ordinary reopening does not automatically activate frozen runs.

**Deliverables:** Implemented RecoveryMatrix, evidence for every interruption point, and lock/notification-deduplication results. All subsequent control/retry work uses the same recovery service.

**Handoff:** T02/T03/T05 receive the same recovery entry point, UNKNOWN, and frozen states. M5-T02 consumes compatibility checks and evidence for restoring the original combination.

**Normal acceptance:** Reopening after interruption at different locations returns to explainable states without losing previously committed facts or reports. Resending old commands creates no new resources.

**Failure controls:** Temporary absence of records, corrupted heads, dual Hosts, old model callbacks, and duplicate notifications cannot trigger another business dispatch or false completion.

**Stop conditions:** Reproducible duplicate business operations/concurrent writes block downstream stability conclusions. Fix the protocol first; manually deleting the database and rerunning cannot establish a pass.

**M3-T02: Durable Model Retries, Fallback Routes, and Auxiliary Requests**

**Objective:** Recover from transient model failures across process restarts while preserving sole retry ownership and accurate usage.

**Prerequisites:** `M3-T01`, `M1-T04`.

**Reading:** DD08/DD10/DD11, AC16/AC17/AC18, V10, G05.

**Change ownership:** Agent retry-plugin consumers, Runtime auxiliary-request scheduling, routing, and Session events.

**Work allocation:** The model subagent owns RetryState and sole retry ownership. After Runtime interfaces freeze, work may proceed in separate files alongside T03; changes to the main scheduling file require an exclusive reservation.

**Steps:**

1. Distinguish main Agent requests from direct ctx.llm auxiliary requests, explicitly recording request/attempt identities and Session events for the latter. Keep only one retry owner on each path; do not layer an unlimited SDK loop underneath.
2. Classify authentication/configuration, rate-limit/transient-service, timeout/stream-interruption, and capability errors. Persist backoff, Retry-After, next attempt, and route. Do not terminate transient-failure recovery based on cumulative spending or a small attempt limit.
3. Do not use official Jobs/Schedule as RetryState authority. Runtime owns durable retryAt and startup scanning. If timed wakeups are needed, explicitly select the optional schedule bundle before configuring its rows. Treat delivery only as a signal that may duplicate or be missed, entering the same state and deduplication checks.
4. Recover waits across reopening, with cancellation generations suppressing late results. Fallback routes must be capability-compatible and record actual selections. M4-T07 completes the full lightweight decision-model protocol; this card first verifies the real main path and already available auxiliary paths.
5. Actually issue the next main-model request after tool dispatch fails within a turn. Check the baseline's integrated result completion and business UNKNOWN reconciliation. Recovery from invalid multiple-image inputs in the selected adapter retries only model input, never page operations already executed.

**Deliverables:** RetryState/AttemptRecord, error classification and fallback-route protocols, and actual-provider/controlled-fault evidence for reuse by M4 adapters and status projections.

**Handoff:** T04/T06 read durable attempts and waiting reasons. M4-T07 uses the same auxiliary-call path; adapters must not wrap it in another unlimited retry loop.

**Normal acceptance:** After more consecutive transient failures than a short retry limit, recovery can continue the original task. Reopening during a wait preserves counts and does not violate Retry-After by retrying early.

**Failure controls:** 401/capability mismatches cannot cause infinite busy retries. Late success after cancellation does not revive work, duplicate callbacks do not duplicate usage, and an auxiliary path without logs cannot pass acceptance.

**Stop conditions:** Missing actual-provider evidence is marked not run. No unknown business side effect may cause a business action to be resent under the label “model retry.”

**M3-T03: Pause, Exit, Takeover, and Resource Scheduling**

**Objective:** Distinguish user controls from process lifecycle and ensure control requests promptly block new actions.

**Prerequisites:** `M3-T01`, `M1-T07`.

**Reading:** DD02/DD03/DD07/DD08, AC36/AC48, V06, G04.

**Change ownership:** Runtime control gates, Agent/SessionResources scheduling, desktop lifecycle, and Client control presentation.

**Work allocation:** The lifecycle subagent owns control gates and official desktop activity adaptation. The integrator owns Main/Host protocols. Freeze native-input revocation contracts before handing them to M4.

**Steps:**

1. Implement business pause/resume/cancel and integrate official window hiding, tray, and standard exit confirmation without rebuilding desktop lifecycle. Use DD12's read-only PersistentActivitySnapshot to include all unfinished durable runs—including unloaded sessions, paused runs, backoff, environment waits, frozen runs, and pending recovery—in exit/update and session-activity decisions. Do not add another statistics API. In the first version, prevent archiving these sessions; canceling a turn through archiving must not equal canceling its run. User-paused runs remain paused after reopening, and Agent idleness cannot establish run completion.
2. Control requests first close the local dispatch gate and revoke permits, then save a small control record. The UI separately shows dispatch blocked, durable acknowledgment, and save failure; verify in-flight operations independently.
3. Official Agent/Inbox/Jobs idleness does not equal business completion. Exit-check timeouts or read failures remain unknown and produce explicit prompts, rather than silently treating the system as task-free. Explicit exit stops dispatch and saves state; closing an ordinary window preserves background work. Input requiring a visible desktop still obeys environment requirements.
4. Establish protocols for user takeover, visible-desktop requirements, lock-screen/focus changes, and resource release. Long waits release execution queues. Provide native-lease interfaces to M4-T01 without prematurely claiming native control has been verified.

**Deliverables:** ControlState transition table, evidence for PersistentActivitySnapshot consumption and integrity errors, cancellation call chains, and lifecycle evidence. M4 native/external browsers must use the same gate.

**Handoff:** T04/T05/T06 receive explainable control states. M4-T01/T02 integrate the same gate; M5-T02 reuses the all-run decision rather than writing separate installation filtering.

**Normal acceptance:** New dispatch can be blocked during long I/O/model hangs. Explicit exit preserves recoverable tasks, and reopening does not bypass user pause. Runs remain discoverable through the same snapshot when sessions are closed or unloaded; incomplete snapshots do not display “no tasks.”

**Failure controls:** Late results, repeated pauses, save failures, unloaded old handles, and preemption by manual operation cannot automatically resume dispatch. Archive requests for sessions with unfinished runs are rejected, preserving durable tasks and notifications. Cancellation must not claim to undo business operations that already occurred.

**Stop conditions:** Pause the dependent route and fix scheduling if stopping dispatch must wait for large attachments, queues deadlock, or hidden windows continue dangerous native input.

**M3-T04: Task-Level Stall Detection and Bounded Recovery**

**Objective:** Detect unproductive observation/replanning loops while preserving long tasks and legitimate waits.

**Prerequisites:** `M3-T01`, `M3-T02`, `M3-T03`.

**Reading:** DD08, AC57, V18, implementation-plan resource budget.

**Change ownership:** Runtime progress events, watchdog, and session-notification projections.

**Work allocation:** The scheduling subagent owns progress criteria and bounded recovery. An independent acceptance reviewer supplies legitimate-long-wait/actual-stall controls. Freeze policy thresholds before execution; code under test cannot change them automatically.

**Steps:**

1. Define verifiable progress and windows by analysis/planning/execution stage, distinguishing useful new facts and completed instances from rewritten text. Fix the policy revision before a run.
2. Exclude business timers, model backoff, user pause, and pending authorization. Apply bounded escalation or renewed observation to repeated observation/plan rewriting/ineffective recovery.
3. Persist recovery counts and their basis. Once exhausted, block the affected branch and send deduplicated reminders while independent items continue. Restarting cannot reset counts; explicit resumption is possible after the user resolves the condition.

**Deliverables:** ProgressPolicyRevision, StallRecord/RecoveryAttempt, and paired normal/stalled materials for M3-T06 queries and M4 time-dependent workflow extensions.

**Handoff:** T06 displays StallRecord and manual re-entry conditions. T07 verifies counts across reopening. M4-T04 must retain legitimate-wait exclusions when extending time-dependent business flows.

**Normal acceptance:** The fixed policy detects and stops actual unproductive loops without misclassifying legitimate long waits; other independent cases can still progress.

**Failure controls:** More tokens or repeated new plan revisions alone do not count as useful progress, and reopening does not reset counts. Do not terminate the entire long task using a spending limit or total attempt count.

**Stop conditions:** If progress cannot be distinguished from legitimate waiting, retain unverified status and fix the criteria instead of merely raising thresholds to hide false positives.

**M3-T05: Storage Warnings, Protective Waiting, and Asset Cleanup**

**Objective:** Protect tasks before evidence can no longer be saved and let users safely manage occupied disk space.

**Prerequisites:** `M3-T01`, `M3-T03`, `M2-T08`. Also requires the passed AssetLifecycleDecision from M0-T10 and reference-protection deliverables from M1-T03/M2-T05.

**Reading:** DD07/DD09, AC38/AC55, V12/V16, G08.

**Change ownership:** Runtime storage health, asset-reference/disposition services, and Client cleanup previews.

**Work allocation:** The attachment subagent owns reference admission and provider deletion; the Client owner integrates cleanup previews. The integrator centrally changes ordinary Session/fork consumers and shared schema.

**Steps:**

1. Monitor the actual evidence and control-record volumes and measure material growth. Configure warnings, reserved control space, and optional quotas; no cumulative quota is set by default. Insufficient space is not exhausted spending.
2. When required materials cannot be saved, stop dispatch and durably enter waiting; revalidate after space recovers. Use isolated volumes/controlled injection for fault tests, never intentionally fill the user's system drive.
3. Preview cleanup by run, record explicit confirmation and version, then recheck active/baseline/other historical shared references. Use official asset-lifecycle interfaces, retain minimal disposition records, and leave report content unchanged.
4. Complete deletion and reference lifecycle within the official attachment abstraction/provider ownership determined by P07. Cover ordinary chat/fork, snapshots, exports, active saves, and uncommitted tickets. Retain assets if reference completeness cannot be proven; do not wait until this stage to assume upstream cleanup interfaces exist.

**Deliverables:** StorageHealthPolicy, cleanup preview/confirmation protocols, AssetDisposition, and actual release evidence, traceable to missing references in reports.

**Handoff:** T06 displays real space and disposition data. T07 validates using an isolated fault volume. Report, baseline, and export consumers receive missing-item reasons instead of merely broken links.

**Normal acceptance:** Early warnings and protective waiting work, and execution can continue after space recovers. Delete only confirmed assets with no retention references; released amounts are verifiable.

**Failure controls:** New references after preview, interrupted cleanup, write failures, shared evidence, and incorrect cross-volume free-space calculations must not cause mistaken deletion or false success. Evidence must not be deleted to meet resource budgets.

**Stop conditions:** Stop cleanup and retain materials if ownership or reference revalidation cannot be proven. Background automatic history deletion cannot bypass user confirmation.

**M3-T06: Live Progress, Usage, and Reminders in the Owning Session**

**Objective:** Give users trustworthy runtime status at any time without adding model calls for queries.

**Prerequisites:** `M3-T02`, `M3-T03`, `M3-T04`, `M3-T05`.

**Reading:** DD05/DD08, AC34/AC58, V18, G15.

**Change ownership:** Committed-fact projections, Session metering consumers, Client status cards, and notification presenters.

**Work allocation:** The Client subagent owns projection display; Runtime/metering owners provide read-only facts. One owner edits notification-presenter files. Acceptance reviewers compare request counts before and after queries.

**Steps:**

1. Display the stage, current instance, dynamic denominators, useful progress, and active/waiting duration from durable facts, including sample time and statistical scope.
2. Reconcile main-model, auxiliary, retry, fallback-route, and missing-token usage by request/attempt identity. Show missing usage as unknown rather than zero, avoid duplicate accounting, and do not require exact monetary cost calculations.
3. Deliver reminders only to the owning desktop session, with deduplication and reconnection. Status queries use read-only Remote calls, without extra model calls to explain status.

**Deliverables:** LiveRunProjection, UsageSummary, and notification-deduplication/reconnection evidence for direct use in M5 runs.

**Handoff:** T07/M5 receive actual progress and metering observation entry points. Reconcile durable outbox, session, and UI using the same notification ID instead of independent counts at all three locations.

**Normal acceptance:** Queries match source request records and retain the same counts after reopening. Other sessions do not receive reminders for the wrong run.

**Failure controls:** Duplicate notifications, missing usage, process reconstruction, late failure results, and scope changes remain reconcilable. Model call counts do not increase after status queries.

**Stop conditions:** Keep acceptance incomplete and fix data sources if projections rely on model-generated numbers, dynamic denominators cannot be explained, or unknown values are treated as zero.

**M3-T07: Fault Matrix, Long Histories, and Stage Budget**

**Objective:** Validate recovery behavior as a whole and freeze resource values for the currently implemented combination.

**Prerequisites:** `M3-T01`, `M3-T02`, `M3-T03`, `M3-T04`, `M3-T05`, `M3-T06`.

**Reading:** F5, DD13, V04–V07/V16/V18, implementation-plan budget fields.

**Change ownership:** Official integration/fault tests, measurement scripts, and evidence records; do not create a parallel test framework.

**Work allocation:** An independent stability subagent executes the fault matrix and measurements. Feature owners fix defects; the lead agent freezes budgets. The acceptance reviewer checks sampling processes and the managed-process inventory.

**Steps:**

1. Complete F5 for models, persistence, attachments, notifications, dual Hosts, pause, stalls, and delayed posting. Inject each fault at critical boundaries and retain evidence that it actually occurred.
2. Use different history sizes and fixed repeated lifecycles to collect memory across all managed processes, handles/threads, disk growth, and local control latency. Measure legitimate waits separately from active workloads.
3. Propose values, workloads, and sampling rules from the measurements, then review and freeze the current ResourceBudgetRevision. Full 24-hour testing and newly added routes receive separate later acceptance.

**Deliverables:** F5 fault matrix, independent business checks, raw measurement series, the implemented combination's budget, and M3 GateEvidence.

**Handoff:** Every M4 route receives the current budget, failure semantics, and historical workload. New process combinations require additional measurements rather than directly inheriting old limits.

**Normal acceptance:** After faults, task state, business counts, materials, and notifications reconcile without harming legitimate waits. The budget includes decidable values for peaks, slopes, residual resources after release, and other applicable measures.

**Failure controls:** Checking only tool claims, failing to verify injected faults, missing samples, or raising thresholds after execution cannot pass. Accelerated simulations cannot be reported as actual 24-hour runs.

**Stop conditions:** Duplicate business operations, lost facts, incorrect stall detection, or budgets still lacking numerical values block stability-dependent work. Identify failed items and responsible cards.

**Stage Handoff Gate**

RecoveryMatrix, stall, space, and usage controls pass. Real business operations are not duplicated, and insufficient saving capability prevents new dispatch. Freeze numerical resource values for the current combination. Keep unfinished native/external routes explicit in stage checks; measure again after M4 adds them. This stage's budget cannot cover an unmeasured new combination.

## Alternatives considered

**Recorded choice.** Using Jobs as business authority or stopping after a fixed total retry count does not satisfy durable task requirements.

## Acceptance criteria

Execute this proposal’s normal and failure controls and satisfy the [shared acceptance criteria](../testing/2026-09-28-web-testing-acceptance.md) and applicable task evidence requirements. Documentation migration does not establish a pass.

## Risks

Unknown action outcomes, storage failure, and competing owners can cause duplicate effects unless recovery is verified under faults.
