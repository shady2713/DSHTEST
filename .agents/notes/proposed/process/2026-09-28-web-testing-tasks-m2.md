# Agent Note: Development Tasks: M2 End-to-End Testing Workflow

Status: proposed

English | [中文](2026-09-28-web-testing-tasks-m2.zh.md)

## Problem

Analysis, confirmed cases, actual execution, evidence, and reports must form one usable test workflow.

## Proposal

Stage admission and current task status follow the collaboration guide and its TaskRegister; historical probe results do not complete these implementation cards. Task interfaces, change ownership, independent review, checks, and handoff formats follow the [Agent Development and Collaboration Guide](2026-09-28-web-testing-agent-guide.md). Change ownership must resolve to real paths through RepositoryMap and be registered when work is dispatched. A prerequisite is complete when its deliverables have been accepted by both the consumer and an independent reviewer; committing code or verbally declaring completion does not satisfy it, except for explicitly identified sub-item dependencies.

This stage contains 9 cards and targets one complete real business workflow; the final feature scope remains defined by all requirements. T07 depends only on the defined ReportRevision prerequisite contract, while T08 connects cleanup after an actual report. Thus data cleanup and reporting do not create a circular development dependency.

**M2-T01: Expand Complete Business Fixtures and Historical Materials**

**Objective:** Supply independently assessable F2/F3/F4 materials for the full analysis-to-report workflow.

**Prerequisites:** `M1-T06`, `M1-T07`.

**Reading:** Implementation plan F1–F6, AC05/AC07/AC09/AC22/AC50, DD04.

**Change ownership:** Official fixture and test-material directories; retain the M0 FixtureManifest.

**Work allocation:** The fixture subagent expands the public business system; an independent acceptance reviewer holds the answers. Independent static materials may be prepared early, but this card cannot finish until it receives actual M1 history.

**Steps:**

1. Expand the same-record create–approve/reject–view flow across two entry points and two roles. Provide normal, boundary, file, multiline, and injected-defect versions; add representative materials in different languages and with multiple source roots.
2. Add independently observable asynchronous backend entry points and read-only logs. Save each version's source code, runtime identity, initial data, and reset procedure.
3. Evolve a business-change version from actual M1 assets, retaining an unchanged control. Maintain answers independently; do not supply hidden defect lists to the product as requirements.

**Deliverables:** Expanded FixtureManifest, business state machine and independent Oracle, two traceable versions, and initial F3 materials for T02 through T09.

**Handoff:** T02–T09 use the same FixtureManifest version, with reset entry points for cross-language materials, both roles, and old records. Access to the Oracle is not transferred to the product Agent together with source materials.

**Normal acceptance:** Reviewers can independently locate the same business record, confirm state transitions and differences in the faulty version, and establish that historical assets truly came from the previous version.

**Failure controls:** Materials that splice together different records, fabricate history from new materials, or leak defect answers to the product are unacceptable.

**Stop conditions:** Complete the materials first if business rules are uncertain, independent observation is unavailable, or reset fails. Tool-generated cases cannot serve as acceptance answers.

**M2-T02: Read the Full Project, Capture Snapshots, and Derive Requirements**

**Objective:** Produce a sourced feature inventory and candidate requirements from all code supplied by the user.

**Prerequisites:** `M1-T03`, `M1-T04`, `M1-T05`, `M1-T06`, `M2-T01`.

**Reading:** DD04/DD06/DD09, AC05/AC07/AC15/AC44, G08.

**Change ownership:** web-test-analysis, source snapshot services, and Runtime version-commit interfaces.

**Work allocation:** The analysis subagent owns reading and derivation; the persistence owner supplies only frozen-snapshot interfaces. Read-only material inventories may be delegated, but multiple subagents must not write SourceSnapshotRevision concurrently.

**Steps:**

1. Build a multi-root material inventory and readability record, handling encodings, large files, links, and changes during scanning. Protect secret material; do not silently treat unreadable areas as having no functionality.
2. Save the version contents/summaries and references actually used. Distinguish Git baselines, uncommitted changes, runtime-version declarations, and observations; a source version does not automatically equal the deployed version.
3. Use configured models to derive modules, entry points, roles, business workflows, and candidate expectations. Separate code evidence, user rules, Skill knowledge, and page facts, turning conflicts into specific questions.
4. Reuse P06's independent validation method and explicitly classify business intent, general rules, and implementation inferences. Output criticalRuleReview; a clear implementation does not remove the need to confirm critical rules.

**Deliverables:** SourceSnapshotRevision, FeatureInventory/RequirementDraft, and source/gap indexes. T03 generates cases from these, with later history and reports reusing them.

**Handoff:** T03 receives candidate requirements with sources and criticalRuleReview. M4-T05 compares immutable snapshots; reports reference saved content rather than live files.

**Normal acceptance:** Materials in different languages enter analysis without templates, and conclusions resolve to saved source excerpts. Changes to original files after scanning do not redirect historical references to new content.

**Failure controls:** Explicitly surface implementation that conflicts with user rules, unreadable files, and changes during scanning. Do not treat implementation as the correct expectation.

**Stop conditions:** Pause conclusions for portions whose input consistency cannot be guaranteed; other evidenced modules may continue. Do not modify code on your own to make it parsable.

**M2-T03: Cases, Scope, Clarification, and Dynamic Coverage**

**Objective:** Turn derived requirements into versioned plans that can execute, solicit clarification, and support counting.

**Prerequisites:** `M2-T02`.

**Reading:** DD04/DD05/DD06, report specification, AC10/AC27/AC28/AC41/AC53.

**Change ownership:** The analysis planning module, Runtime plan commits, and Client confirmation cards.

**Work allocation:** The planning subagent owns case and coverage semantics; the Client owner integrates confirmation cards. The integrator merges Runtime contract changes. The acceptance reviewer checks counterexamples with unconfirmed critical rules.

**Steps:**

1. Generate scenarios, cases, steps, expected assertions, and applicable execution instances. Default scope is full testing, with specialized tests selected as needed. Expand roles/viewports according to applicability without meaningless Cartesian products.
2. Before testing, consolidate clarification of conflicting expectations, resolutions, and required information. Freeze answers into plan/case versions. When only generating cases, list preparation actions without changing business data.
3. Define start conditions, scope changes, and deduplication of new findings. New questions during a run block affected instances while retaining report entries; after user confirmation, create new cases and run supplemental tests. Changes to dynamic denominators remain traceable.
4. Group and confirm critical rules such as amounts, permissions, and states item by item. Scope approval and operation permission cannot replace rule confirmation. Required implementation-only business assertions remain in the denominator pending confirmation; they cannot be automatically deleted or marked passed.

**Deliverables:** PlanRevision/CaseRevision/ExecutionInstance, clarification and scope-change protocols, and completeness checks. T04 schedules from these; T08 uses them for statistics.

**Handoff:** T04 receives frozen plans and instance dependencies, T07 receives preparation requirements, and T08 receives denominator definitions. Confirmation changes create new versions and identify affected instances.

**Normal acceptance:** The same business workflow has verifiable expectations and dependencies. Natural-language input and option selections produce consistent plans, with explainable scope and instance counts.

**Failure controls:** Reject missing expectations, duplicate new findings, automatic removal of failed items by tools, and data preparation when only case generation was requested. Unverified items remain in their corresponding denominators.

**Stop conditions:** Ask about unclear critical expectations rather than inventing answers. Cases for partially unclear scope may be organized, but their business changes must not execute early.

**M2-T04: Real Actions and Minimal Durable Scheduling**

**Objective:** Perform real page operations according to confirmed cases and prevent duplicate business operations from the first action.

**Prerequisites:** `M2-T03`, `M1-T03`, `M1-T05`, `M1-T07`.

**Reading:** DD02/DD06/DD07/DD08, AC13/AC37/AC46, V05/V06.

**Change ownership:** Runtime execution scheduling, actual Browser Use actions, and Session fact integration.

**Work allocation:** The execution subagent owns durable scheduling and actual actions; the Browser owner implements bounded adapters. One owner edits action slots/the Runtime main loop, with independent checks of business counts.

**Steps:**

1. Allocate StepCursor, stepRevision, and actionSlotId. Save the action intent before dispatch, then revalidate environment authorization/target generation. Record send state and business results; advance only after successful commits.
2. Implement a minimal actual-action set including clicks, input, and CRUD. Step results and tool calls enter the correct Session. Business assertions wait for T05; successful execution does not directly mean a case passes.
3. Implement minimal interruption recovery: never redispatch completed slots; observe and verify dispatched actions with unknown outcomes first, retrying legitimately only when nonoccurrence is established. Retests are bounded and retain the original failure.

**Deliverables:** ActionRequest/Result, durable StepCursor, execution-state transitions, and real-action evidence. T05/T06 and M3 extend the same scheduler.

**Handoff:** T05 receives action facts and observations. T06/T07 use the same authorization and slot entry points. M3 extends the existing scheduler without adding a separate recovery loop.

**Normal acceptance:** One plan completes a real workflow, with every page action corresponding to business records and durable facts.

**Failure controls:** A crash after a business action but before result persistence, resent old slots, target rerendering, and late results must not duplicate operations. Ambiguous outcomes remain unknown.

**Stop conditions:** Block a step if it requires unauthorized operations or its source-code impact cannot be determined. Temporary in-memory scheduling cannot replace durable recording of the first action.

**M2-T05: Evidence, Assertions, and Visual Judgments**

**Objective:** Turn actual observations into reviewable judgments, including situations without design mockups, without overstating correctness.

**Prerequisites:** `M2-T04`.

**Reading:** DD02/DD09, report specification, AC08/AC29/AC38, G08.

**Change ownership:** Evidence attachment services, the analysis assertion module, and Runtime statistical projections.

**Work allocation:** The assertion subagent owns judgments and statistics. The attachment owner supplies retention-ticket/publication interfaces. An independent acceptance reviewer maintains normal/defective visual Oracles; the first screenshot cannot establish its own ground truth.

**Steps:**

1. Save originals through official attachment interfaces before publishing references. Distinguish original screenshot bytes from model-normalized images; associate run/instance/step/attempt and versions. Temporary URLs cannot stand in for assets.
2. Implement deterministic business checks and visually assisted judgments. Under fixed data/viewport and stable page state, check objective problems such as occlusion and overflow; aesthetic differences alone are not failures.
3. Compute successes, failures, blocked, skipped, and unverified items from committed assertions. One complete attempt for the same instance establishes a pass; do not splice multiple incomplete workflows into success.
4. Protect evidence publication through the P07 retention-ticket protocol. AssertionResult distinguishes observationComparison from the business verdict. Add counterexamples for clear implementation with incorrect rules, inapplicable general rules, and attachments shared with ordinary sessions.

**Deliverables:** EvidenceRef, AssertionResult, replayable evidence chains, and statistical rules. T08 reads them directly; M4 extends complex-page/recording support.

**Handoff:** T06/T07 reuse EvidenceRef; T08 reads committed AssertionResult. M3-T05 receives evidence-reference ownership. M4 extends media formats without changing judgment semantics.

**Normal acceptance:** Correct and defective versions can be distinguished, report statistics can be recomputed from raw facts, and original images remain readable after reopening.

**Failure controls:** Automatically treating the first screenshot as a correct baseline, judging styling before the page stabilizes, damaged attachments, insufficient evidence, and model-reported success cannot produce a definitive pass.

**Stop conditions:** Insufficient expectations or visual grounds produce questions pending confirmation/unverified results. Do not call repair tools or hide evidence gaps.

**M2-T06: Existing Backend Entry Points, Read-Only Verification, and External Services**

**Objective:** Support backend verification of complete business workflows while preserving read-only source and third-party action boundaries.

**Prerequisites:** `M2-T04`, `M2-T05`.

**Reading:** DD04/DD07, AC24/AC25/AC32, V08/V15.

**Change ownership:** Backend entry-point descriptions, controlled-command/read-only observation tools, and Runtime authorization checks.

**Work allocation:** The backend adapter subagent owns existing APIs/commands and read-only observation. The policy owner reviews concrete parameters and scope. External-send controls use isolated services and independent counts.

**Steps:**

1. Register parameters, working directories, effect scopes, and verifiable effects of existing APIs/commands. Use structured command arguments and inspect redirection/indirect script writes; do not expose arbitrary shell.
2. Integrate logs and read-only database evidence, waiting for actual terminal business states after asynchronous acceptance. Prefer actual read-only credentials and bounded queries rather than claiming read-only behavior from names alone.
3. Identify payments, SMS, email, and indirect triggers. Real services require separate authorization; confirmed absence may be skipped, unknown service state requires confirmation, and unknown send results must not be blindly resent.

**Deliverables:** BackendDescriptor, ReadOnlyObservation, external-action authorization, and reconciliation evidence for T07 data work and M4 time-dependent workflows.

**Handoff:** T07 uses existing execution entry points for preparation/cleanup. M4-T04 uses read-only terminal-state observation. Reports receive locatable backend facts rather than model summaries.

**Normal acceptance:** Valid existing entry points and read-only queries complete business verification. Authorized sending stays within the specific count/record scope.

**Failure controls:** Commands attempting source changes, database writes, unknown services, missing receipts, and expired authorization have distinct rejection/waiting results. Backend acceptance does not equal completion.

**Stop conditions:** Block an action if its command side effects or third-party state cannot be determined, preserving other executable instances. Do not start the service under test on your own.

**M2-T07: Test Data, Files, and Cleanup Ledger**

**Objective:** Make data preparation and postprocessing traceable while retaining materials needed for reproduction and retesting.

**Prerequisites:** `M2-T03`, `M2-T04`, `M2-T05`, `M2-T06`.

**Reading:** DD04/DD07/DD09, AC33/AC50, report specification.

**Change ownership:** Runtime DataLedger, controlled material generation, and cleanup-plan services.

**Work allocation:** The data subagent owns DataLedger, materials, and cleanup plans. The report owner supplies the frozen ReportRevision query contract without waiting for report UI. Shared-asset deletion remains with the attachment owner.

**Steps:**

1. Generate data-preparation steps from confirmed plans. Write generated files only to this application's staging area, recording actual format/encoding/newlines/content and validation without touching source directories.
2. Route all preparation actions through the same authorization, action slots, and fact commits. Record the sources of new/old data, creation runs, and retention reasons. Do not promise automatic rollback of old-data deletion.
3. Require a committed initial ReportRevision at the cleanup entry point. Protect failed-test reproduction/retest dependencies and clean only newly created successful-test data that meets the rules. Cleanup is recoverable, with results used in a new report revision.

**Deliverables:** DataLedger, GeneratedFixture, CleanupPlan/Result, and report-prerequisite validation interfaces. T08 triggers cleanup after integrating a real initial report.

**Handoff:** T08 first commits the actual report, calls cleanup, and then creates a new report revision. This card delivers real-service tests that reject “no initial report,” avoiding circular dependencies.

**Normal acceptance:** The real page uses generated files after preparation, with traceable data. Planned cleanup requires the initial-report gate and retains failure materials.

**Failure controls:** Case-generation-only requests, uncommitted reports, old data incorrectly included in cleanup, shared retest dependencies, and interrupted/reopened work cannot cause out-of-scope deletion or false cleanup completion.

**Stop conditions:** Retain data and report unclear cleanup authorization/ownership. This card may test the report prerequisite interface but cannot falsely claim that the product has generated a real report.

**M2-T08: Reports, Defect Packages, and Offline Export**

**Objective:** Let users and repair AI understand and reproduce problems from the materials while retaining every unverified item.

**Prerequisites:** `M2-T05`, `M2-T07`.

**Reading:** The full report specification, DD09, AC14/AC31/AC39, V12, G08.

**Change ownership:** Report projections/revision commits, Client report views, and HTML/Markdown/JSON exports.

**Work allocation:** The report subagent owns immutable projections and exports; the Client owner displays the same revision. An independent reproducer receives only an offline defect package to verify that it is sufficient for reproduction and has no host execution privileges.

**Steps:**

1. Fix ReportRevision and the input-fact scope. Output environment/version, requirement bases, coverage, steps, expected versus actual results, severity, evidence, and reasons for unverified items. Label code locations as factual or suspected; do not fabricate root causes.
2. Integrate initial report commit → Runtime cleanup → new report revision, keeping old reports immutable. A defect package includes minimal reproduction data, prerequisites, actual paths, and observations so repair AI does not need chat history.
3. Export a fixed revision and attachment manifest, checking checksums and missing items. Writes across drives/to network directories first create identifiable temporary artifacts; claim success only after complete publication. Report HTML must not obtain host scripting capabilities.
4. In all three formats, display expected-result bases, implementation diagnostics, business items pending confirmation, and all denominator categories. Do not rewrite old reports after recovery updates. New combinations show continued testing through RecoveryLink without splicing success across versions.

**Deliverables:** Report schema, samples in three formats, a single-defect package, and evidence for export integrity and the reporting/cleanup workflow. T09 calls these from session entry points.

**Handoff:** T09 receives all three formats and the cleanup workflow. M3-T05/M4-T05 accept report references and revision rules; published reports cannot be overwritten in place.

**Normal acceptance:** Offline reports suffice to reproduce fixture problems, statistics match source facts, and both the initial and post-cleanup report revisions are locatable.

**Failure controls:** Truthfully display missing attachments, interrupted exports, malicious report text, concurrent exports of old revisions, and cleanup failures. Do not overwrite old reports or perform automatic repairs.

**Stop conditions:** If reference integrity cannot be demonstrated, deliver an explicitly incomplete package/failure state rather than claiming complete export. Missing root-cause evidence does not prevent reporting facts.

**M2-T09: Minimal Complete Conversational Workflow and Stage Review**

**Objective:** Validate the modules as one real application rather than a collection of independent mock tests.

**Prerequisites:** `M1-T06`, `M2-T02`, `M2-T03`, `M2-T04`, `M2-T05`, `M2-T06`, `M2-T07`, `M2-T08`.

**Reading:** AC07/AC09/AC14/AC26–AC29/AC31, G03/G10/G15, M2 exit criteria.

**Change ownership:** Existing module integration, official composition tests, tool presenters, and Client cards.

**Work allocation:** The lead integration agent organizes end-to-end runs. An independent acceptance subagent checks the Oracle, source state, and external business ledger. Feature owners fix only their own defects and do not change expectations on their own.

**Steps:**

1. Onboard correct and defective versions through chat. Complete requirement clarification, case confirmation, preparation, a same-record business workflow, judgments, reports, and cleanup; save complete inputs and actual evidence.
2. Verify “generate cases only,” new questions discovered during execution, pause/resume, and status queries. Text commands and cards call the same service; reminders go only to the owning session.
3. Independently check source state, business changes, statistics, and assets. Add applicable behavior snapshots, tool presentation, typed locale, and engineering checks, recording M4 capabilities not yet covered.

**Deliverables:** M2 GateEvidence, minimal reproducible end-to-end steps, real reports, and engineering-check records, forming M3's recovery workload.

**Handoff:** M3-T01 receives real Run/Report/Session workloads and reproducible interruption points. List unfinished M4 capabilities separately; do not include them among this stage's passed items.

**Normal acceptance:** The real Loader, ctx.llm, storage, browser, and report chain work together; the correct control passes and injected defects are identified with evidence. Extend P06 holdout materials to review actual detection and manual burden. A working self-built fixture alone cannot prove effectiveness on unfamiliar projects.

**Failure controls:** Missing backends, incorrect expectations, verbal model success, old references, and missing attachments cannot be combined by the UI into an all-green result. Repair instructions cannot make the product modify source code under test.

**Stop conditions:** Do not approve M3 while the core flow still uses fake implementations, reports cannot be recomputed from facts, or stage controls fail. Passing this stage does not mean all 58 items are accepted.

**Stage Handoff Gate**

Correct, defective, and clarification-required versions all progress from the natural-language entry point to real reports. The first action already has persistence and basic recovery. Source protection, environment authorization, statistics, cleanup, and offline materials all have failure controls. Complex pages, full concurrency, and all historical cases remain for M3/M4; do not prematurely claim complete testing capability.

## Alternatives considered

**Recorded choice.** An in-memory scheduler substitute or a circular report/cleanup dependency would leave the workflow without reliable ownership and handoff.

## Acceptance criteria

Execute this proposal’s normal and failure controls and satisfy the [shared acceptance criteria](../testing/2026-09-28-web-testing-acceptance.md) and applicable task evidence requirements. Documentation migration does not establish a pass.

## Risks

Individual layer success can hide lost outcomes or misleading reports; the integrated workflow must consume actual preceding artifacts.
