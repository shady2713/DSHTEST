# Agent Note: Development Tasks: M5 Acceptance and Release

Status: proposed

English | [中文](2026-09-28-web-testing-tasks-m5.zh.md)

## Problem

The final candidate needs native installation, complete independent acceptance, and actual long-duration evidence.

## Proposal

Formal final-candidate acceptance remains pending; the collaboration guide and its TaskRegister own task status. Task interfaces, change ownership, independent review, checks, and handoff formats follow the [Agent Development and Collaboration Guide](../process/2026-09-28-web-testing-agent-guide.md). Change ownership must resolve to real paths through RepositoryMap and be registered when work is dispatched. A prerequisite is complete when its deliverables have been accepted by both the consumer and an independent reviewer; committing code or verbally declaring completion does not satisfy it, except for explicitly identified sub-item dependencies.

This stage contains 6 cards. Independent acceptance subagents may collect evidence for T03 and T04 in parallel against the same frozen candidate, using isolated materials and data roots. Resource-acceptance devices must not also carry functional-acceptance or build workloads. Run sequentially if separate devices are unavailable. The 24 hours are actual acceptance duration, not an effort commitment or task-runtime limit. Engineering checks run throughout development; this stage checks the final combination rather than running checks for the first time.

**M5-T01: Candidate Build and Native Windows Installation Matrix**

**Objective:** Prove that actual installation artifacts provide promised capabilities; source startup cannot replace delivery validation.

**Prerequisites:** `M4-T10`.

**Reading:** DD12, AC02/AC03, V13, G02/G13, CheckPlan.

**Change ownership:** Official build/packaging, this application's profile, installation metadata, and artifact tests.

**Work allocation:** The release subagent runs official builds and installation. The integrator exclusively owns dependency locks, profiles, and artifacts. Verification of the same candidate may be delegated across Windows devices, saving each hash and environment separately.

**Steps:**

1. Freeze the candidate's actual SHA/workspace summary, dependency locks, profile, Electron/browser/SDK/model policy, and budget. Generate in the official Host→Client→Web/desktop order and use declared exports.
2. Follow the current official unsigned Windows x64 local-package route, saving installer checksums and BOM. Obtain actual build dependencies under the rules when needed; do not enable signing/automatic updates early.
3. Verify the exact combination of the selected baseline and all registered local changes, the independent product update URL, and durable-task preflight. Official production channels must not automatically overwrite this application through the release package.
4. On Windows 10 22H2/19045+ and representative Windows 11 x64 Home/Pro combinations, complete installation, startup, browser operation, and native input. Check multiple monitors/DPI/lock-screen recovery and exit.

**Deliverables:** ReleaseCandidateId, BOM, hashed local installation artifacts, native-environment matrix, and smoke evidence. T02–T05 use the same candidate.

**Handoff:** T02–T04 use only artifacts explicitly identified by ReleaseCandidateId. Provide a consistent mapping across installer, source state, patch manifest, and BOM.

**Normal acceptance:** A clean device can install according to the instructions and run actual business workflows. System scope, manifest, and reports agree; this application's configuration is isolated from the official product.

**Failure controls:** Missing generated artifacts, execution from old lib output, WSL presented as native Windows, silently raised installation requirements, and unavailable devices for key platforms cannot count as passes.

**Stop conditions:** Record not-run/failure when required system combinations are unavailable or artifact checks fail. Success on another system cannot establish an all-platform conclusion.

**M5-T02: Manual Updates, Preflight, and Migration Recovery**

**Objective:** Make upstream DSH upgrades and local installer updates safe and decidable against real history and task states.

**Prerequisites:** `M5-T01`, `M3-T01`. Also requires RecoveryUpdateDecision from `M0-T11` and freeze/linkage verification deliverables from `M3-T01`.

**Reading:** DD09/DD12, foundation and upstream upgrades, AC03, V14, G12/G16.

**Change ownership:** Installation preflight/stable coordination entry points, official durable-type change records, and migration/recovery tests.

**Work allocation:** The recovery-release subagent uses isolated data and actual old/new installers. An independent reviewer checks original tasks and UNKNOWN states. System installation changes stay within designated acceptance environments and do not touch the user's everyday data.

**Steps:**

1. Validate preflight with actual predecessor programs/data, including traceable V3 Session materials migrated through officially supported workflows to the selected V4 writer. Do not disguise new V4 records as old formats. Through the same PersistentActivitySnapshot, include all durable tasks in installation eligibility: running, paused, backoff, waiting, unloaded sessions, frozen, and recoverable after application exit. Do not forcibly cancel them.
2. Coordinate checks through switchover using the same control-root lock and installation intent so new tasks cannot enter the gap. Assign old-format reading/checking to explicit versions; do not let old programs misread new data.
3. Preserve the old program and recoverable original data. Inject concurrency after checks, installation/migration interruptions, and failures. Verify return to an explicitly usable combination; recovery is more than a Git checkout.
4. Execute a recovery update using actual old/new installers where an old scheduling defect prevents completion and the run includes UNKNOWN/paused states. After user selection, freeze and back up independently, permitting installation through validated recovery preflight. After installation, enter recovery-only first, then link a new run according to eligibility. Old unknown actions cannot be resent under a new runId. Missing revocation, unknown formats, and backup/migration failures preserve the old combination.

**Deliverables:** UpdatePreflight, PersistentActivitySnapshot preflight and read-failure controls, migration/recovery instructions, actual-history reads, and paired V14 evidence for reuse in the delivery manual.

**Handoff:** T03/T04 receive the validated installation candidate and recovery eligibility. T06 receives separate ordinary-update and recovery-update procedures plus failure-restoration methods.

**Normal acceptance:** Eligible manual updates preserve history and can continue legitimate tasks; failures have a validated path back to the original combination. Separately prove ordinary-update protection, installability of recovery updates, and whether business testing can continue. “Reject all updates whenever tasks exist” cannot pass.

**Failure controls:** Tasks still awaiting recovery after application exit, incomplete/stale snapshots, new tasks after checks, changed lock identities, and partially migrated states cannot bypass preflight. Do not automatically cancel user tasks.

**Stop conditions:** Do not overwrite installations or claim downgrade support if a recovery path cannot be preserved or data-format compatibility is unproven. Obtain separate explicit authorization for destructive operations.

**M5-T03: Formal Acceptance of 58 Product Items and Detailed Scenarios**

**Objective:** Collect evidence for every product commitment while distinguishing tool gaps from unverified aspects of projects under test.

**Prerequisites:** `M5-T01`, `M5-T02`, `M4-T09`.

**Reading:** AC01–AC58, V01–V18, report specification, frozen FixtureManifest, and independent Oracle.

**Change ownership:** Formal acceptance execution records and necessary tests under their existing ownership. Return discovered defects to their original feature owners.

**Work allocation:** An independent product-acceptance subagent executes AC/V. Feature owners only receive and fix defects. Work may run alongside T04, but business data, accounts, ports, and resource-acceptance machines must be isolated.

**Steps:**

1. Run normal/error controls item by item under the criteria, recording candidate hash, environment, materials, operations, independent expectations, actual results, and evidence. Cover every condition within each criterion.
2. Reproduce known defects and unverified items in reports. Check read-only source protection, environment and third-party authorization, dynamic coverage, version history, Skills, model routing, and native limitations.
3. Separate passed/failed/not-run/justifiably-inapplicable statuses. Reference T04 for V07's formal 24-hour results; do not declare it passed merely because this card finishes earlier. After defect rework, revalidate according to impact.
4. Complete P06's deferred human-reference comparison and check expanded independent holdout materials, the three classes of expected-result bases, and manual-burden records. “Matches implementation” does not equal a business pass; passing every fixed fixture cannot imply zero missed defects across all projects.

**Deliverables:** Actual AC01–AC58 acceptance table, V-scenario evidence index, and defect/retest records. Completing this card does not replace T04/T05.

**Handoff:** T05 consolidates this card and T04. Defects return to corresponding M1–M4 owners. An Agent not involved in implementing the defect verifies reproduction from its report.

**Normal acceptance:** Every passed item has independently reviewable evidence. Correct/error controls distinguish behavior, and another AI can understand and reproduce reports.

**Failure controls:** Automatic skipping for missing keys, product-capability gaps labeled as project problems, testing only some conditions, changing expectations to fit implementation, and unauthorized scope reduction cannot yield an overall pass.

**Stop conditions:** Required failures or missing evidence keep acceptance pending; identify ownership and re-entry conditions. Ordinary local fixes stay within authorized development scope and do not automatically publish.

**M5-T04: Actual 24-Hour Continuous Run and Resource Acceptance**

**Objective:** Use actual sustained workloads to validate task recovery and frozen resource values.

**Prerequisites:** `M5-T01`, `M5-T02`, `M4-T10`.

**Reading:** V07, AC15/AC16/AC37/AC51/AC55/AC58, ResourceBudgetRevision, F5.

**Change ownership:** Official continuous-run tests and sampling records, plus independent business observation.

**Work allocation:** An independent stability subagent monitors continuously while the lead agent maintains checkpoints and receives anomalies. Do not occupy every slot and block other independent reviews. Sampling and injection remain independent of the tool under test's own claims.

**Steps:**

1. Before the run, fix the candidate hash, reference machine, workload, concurrency, recording, materials, seeds, sampling, and thresholds. Do not start formal judgment without a numerical budget.
2. Run continuously for at least 24 actual hours, including planned rate limits, network loss, reopening, timed waits, and long histories. Record real time and applied faults; accelerated simulation cannot substitute.
3. Summarize peaks/slopes for all managed processes, handle release, disk growth rates, and control latency. Reconcile external business counts, reports, usage, and source state; list missing samples separately.

**Deliverables:** Complete time series, 24-hour evidence, per-budget results, recovery and business reconciliation for T05's final engineering gate.

**Handoff:** T05 receives the same candidate's complete 24-hour time series. On interruption or candidate changes, state the valid scope and rerun criteria; do not splice periods from different builds.

**Normal acceptance:** Every frozen metric meets its target, transient-failure recovery continues, legitimate waits are not misreported, and business operations are not duplicated nor facts lost.

**Failure controls:** Reporting only final memory, omitting standalone browser processes, deleting evidence to reduce disk usage, raising thresholds afterward, or shortening duration cannot pass.

**Stop conditions:** Protective waiting does not by itself establish test failure; record it and judge against criteria. Candidate implementation changes require an assessment of invalidated evidence. Do not combine 24-hour totals from different builds.

**M5-T05: Official Engineering Checks, Documentation, and Upgrade Rehearsal**

**Objective:** Prove that implementation follows actual DSH rules and can track upgrades, rather than merely conforming to this proposed design-document set.

**Prerequisites:** `M5-T03`, `M5-T04`.

**Reading:** G01–G16, actual rules/Skills at every applicable level, CheckPlan, compliance gates in foundation and upstream upgrades, and foundation and upstream upgrades.

**Change ownership:** Relevant implementations/tests/generated artifacts/official documents/compatibility records; each change follows official ownership.

**Work allocation:** The engineering-review subagent runs official gates. The integrator handles shared generation and the final combination. Upgrade rehearsal uses an independent workspace and does not automatically switch the frozen release foundation.

**Steps:**

1. Consolidate stage checks and run all checks required for the candidate, including type/lint/duplication/hygiene, coverage, invariants, real recorded snapshots/expectations/Web, builds, and applicable platform CI. Missing environments are marked not run; do not lower gates.
2. Check new-package READMEs, Model Experience/Known Limitations, JSDoc, typed locale, and official-document bilingual/pairing/directory/budget requirements. Check related SDKs for Session changes and complete durable-type detection and change records.
3. Rehearse an applicable upstream upgrade in an independent local candidate workspace, recording rule differences, reapplication of narrow changes, semantic conflicts, generation, and historical regression. Reverify the target version when executing. If no suitable new version exists, state the rehearsal scope rather than inventing an upgrade. The selected desktop baseline already includes telemetry and product-analytics; verify this application's pre-start disabling, collection destinations, queued events, and exporter state under DD12. Also check behavior changes in tool enablement, approval, scheduling, model caching, and failed-step fixes.
4. Necessary fixes produce a new candidate. Rerun affected product/resource evidence and update BOM, recording why unaffected evidence remains reusable. All final valid evidence must point to a consistent combination.
5. For every internal modification/public extension in IntegrationSurfaceRegister, check upgrade triggers, generation, and regression evidence. Record actual maintenance costs against M0 estimates. Give separate conclusions for compliance, product effectiveness, and upgrade compatibility.

**Deliverables:** G01–G16 applicability and actual outputs, official documentation, upgrade differences and regression evidence, and a final candidate-consistency checklist.

**Handoff:** T06 accepts only a handoff package with a consistent candidate and results for every applicable check. If necessary fixes create a new candidate, identify product/resource evidence requiring revalidation.

**Normal acceptance:** Required checks actually pass and failure controls can be rejected. Per-file coverage meets the actual baseline. Even without Git conflicts, semantic review records exist.

**Failure controls:** Reject command names without outputs, fabricated pairing records, silently rerecording in CI, deletion of failing tests, whole-repository averages used as per-file coverage, and fake platform passes without environments.

**Stop conditions:** Do not declare readiness for delivery if any applicable required engineering check was not run/failed or the final candidate differs from acceptance. Do not independently commit, push, or create a PR.

**M5-T06: Release Handoff and Personal-Use Instructions**

**Objective:** Deliver an installable, verifiable, maintainable local product and handoff materials with transparent limitations.

**Prerequisites:** `M5-T05`.

**Reading:** All stage GateEvidence, final AC/G/V results, BOM, capability matrix, and update/recovery instructions.

**Change ownership:** Official delivery documents and artifact/evidence manifests; do not introduce a new publication channel.

**Work allocation:** The lead agent owns the final delivery checklist and conclusion. A receiving Agent not involved in the main implementation follows the instructions to install, configure, and reproduce reports, independently checking files and evidence links.

**Steps:**

1. Assemble the final installer/hash, source baseline/necessary diff, dependency locks, configuration and model-routing instructions, materials, and actual check indexes. Exclude sensitive credentials from the package.
2. Document first-time configuration, project onboarding, test/production declarations, case clarification, manual takeover, handing reports to repair AI, historical regression, disk cleanup, and manual updates/recovery. State the actual prompts shown by unsigned local installation.
3. Check first-release boundaries against every confirmed requirement. Distinguish unverified aspects of projects under test from tool-delivery gaps; every limitation references the actual capability matrix and evidence. Deliver a template for future upgrade tasks.

**Deliverables:** ReleaseManifest, user manual, maintenance/upgrade handoff package, and final acceptance conclusion, with verifiable local delivery paths.

**Handoff:** Deliver a user-installable local package and maintainable source/evidence. Future Agents continue from foundation and upgrade records without depending on chat history or temporary subagent context.

**Normal acceptance:** Without chat history, a user/AI can install and configure, complete one full test, reproduce a report, and perform the specified update/recovery. Every artifact points to the same final candidate.

**Failure controls:** Missing required capabilities, incorrect system support, secret leakage, broken evidence links, or instructions that disagree with actual behavior prevent an overall completion claim.

**Stop conditions:** Completion requires all AC/G/V evidence and necessary materials. Without publication authorization, do not upload, deploy, automatically distribute, or send third-party messages.

**Stage Handoff Gate**

The same final candidate has actual evidence for every AC01–AC58, applicable G01–G16, and V01–V18, including native Windows installation, an actual 24-hour run, and historical upgrades/recovery. Unverified required product capabilities prevent delivery completion. Local-package delivery does not authorize publication.

## Alternatives considered

**Recorded choice.** Source launch cannot replace installation evidence; compressed time or results assembled from different candidates cannot replace the final 24-hour acceptance run.

## Acceptance criteria

Execute this proposal’s normal and failure controls and satisfy the [shared acceptance criteria](2026-09-28-web-testing-acceptance.md) and applicable task evidence requirements. Documentation migration does not establish a pass.

## Risks

Unavailable platforms or missing evidence prevent acceptance, and local delivery does not authorize publication.
