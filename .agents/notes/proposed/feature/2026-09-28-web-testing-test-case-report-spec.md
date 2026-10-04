# Agent Note: Test-case and report specification

Status: proposed

English | [中文](2026-09-28-web-testing-test-case-report-spec.zh.md)

## Problem

Test results need explicit expected behavior, execution evidence, and reproducible defect information that both the user and a coding agent can understand.

## Proposal

Design state: current product specification, not yet implemented or accepted; this is not an actual test report. Related documents: [product requirements](2026-09-28-web-testing-requirements.md), [architecture](../architecture/2026-09-28-web-testing-architecture.md), and [acceptance criteria and traceability](../testing/2026-09-28-web-testing-acceptance.md). TD03 and DD06–DD09 define technical ownership of domain records, Session logs, original attachments, and export references. Do not create separate model logging or attachment storage for reports.

This specification governs case preparation, execution, conclusions, and handoff. Confirm necessary business expectations before testing. For new ordinary business questions during execution, skip affected portions, then create new case versions and actually retest after confirmation. Cases with page entry points require real page operation; backend triggers, data preparation, report generation, and source analysis cannot replace it. Product requirements govern platform, source-read-only, environment-authorization, and data-cleanup boundaries.

**Expectation authority and conclusion boundaries**

Each assertion stores expectationAuthority, source version, and applicability using the three categories below. Operation permission, scope confirmation, and model confidence cannot automatically elevate authority.

| Authority | Conclusions it supports | Conclusions it does not support |
|---|---|---|
| confirmed-business | Explicit user confirmation, still-applicable confirmed cases, or an accepted skill explicitly carrying the rule; verifies that business expectation. | Confirming one rule does not confirm other code inferences; accepting an entire skill does not confirm rules it never states. |
| applicable-generic | Versioned generic test rules with recorded applicability to the control/scenario, such as obstructed content preventing operation; verifies that generic requirement. | Generic rules cannot determine project intent such as discount thresholds or approval permissions; actual conflicts require confirmation. |
| implementation-only | Existing code/pages only; may record observationComparison as matched/mismatched/unknown and display consistency, inconsistency, or inability to compare with the current implementation. | A match does not mean business correctness; such diagnostics cannot be passed required business assertions or evidence of complete verification. |

On first testing and relevant changes, criticalRuleReview groups applicable amount, permission, state, deletion, and external-action rules by business flow. Save each source, user answer, and case revision without requiring users to rewrite complete requirements. Resolve unconfirmed critical rules before dependent business mutations. Ordinary unclear expectations remain pending confirmation, while independent checks with sufficient authority follow existing scheduling rules. Clear implementation alone does not exempt a rule from review.

Keep each required business assertion's verdict separate from diagnostic comparisons. Its implementation-only business verdict is needs-confirmation; an observation match does not change it. Count pure implementation diagnostics separately, outside required business/generic pass numerators. Required business assertions remain in the denominator. Report data must allow recomputation of authority categories, missing authority, and exclusion reasons. Count confirmed business and applicable generic rules separately. Claim complete verification only when all applicable required assertions satisfy the existing completion rules.

**Case preparation, execution, and supplemental testing**

1. Analyze all code directories, client pages, roles, user test requirements, skills, and historical assets of the current complete project. Build feature inventories and individual/cross-entry flow cases, then check feature-to-case mappings. Include applicable fault recovery, file contents, flows over time, and historical-data compatibility. List prerequisites and preparation steps first. Initial testing requires cases first; preparation cannot justify early changes to tested business data.
2. When a user-selected or project-adopted historical baseline exists, compare code and feature dependencies and show added, changed, removed, and indirectly affected cases. Code changes are implementation evidence, not proof of alignment with new business requirements.
3. Before testing, consolidate explicit questions and review criticalRuleReview. Check critical rules even when code is unambiguous, showing old expectations, new suggestions, related code, and affected cases. Write natural-language answers into new case versions before preparing business data under saved preparation steps and existing authorization. Do not re-ask unchanged confirmed rules; case-generation-only requests do not execute preparation.
4. Cases with page entry points execute real browser and necessary computer operations. Backend cases without them use existing APIs or management commands and verify their own expectations. Skip checks affected by newly discovered business questions, continue independent cases, and avoid frequent interruptions for ordinary business ambiguity at this stage.
5. Generate reports that distinguish defects, tool-execution issues, environment issues, and expectations pending confirmation. Confirmation for real payments, SMS, and email, and necessary login takeover, retain their confirmed rules.
6. Apply user answers to case versions. Associate the current tested version/environment, rebuild prerequisites, and actually run supplemental tests. Save those records while preserving original reports and case versions. Status edits cannot turn unverified items into passes.

When execution discovers features omitted from the original inventory, record discovery evidence first. For scenarios with clear expectations within current scope and authorization, add cases and save plan changes before execution. Continue skipping and consolidating new business questions under established rules. Preserve versions of original cases and executed records; new cases cannot retroactively relabel earlier execution.

Cases store at least the following fields.

| Field | Content requirements |
|---|---|
| Identity and version | Stable project-local case ID, case version, and creation/change grounds. |
| Execution instance | Applicable combinations of this run's environment, role or cross-role flow, browser, viewport, data group, and fault conditions; each instance has an independent ID, with retests linked to it. |
| Feature and requirement | Feature ID, page entry, requirement description, code/user-confirmation source; distinguish inference from confirmed rules. Each assertion records its authority category and applicability; critical-rule confirmation binds messages and versions. |
| Owning business flow | Flow ID, participating entry points/roles, business-record correlation, normal and applicable exception branches. |
| Applicability | Version range, roles, business states, browser, and project-confirmed viewport; browser zoom, DPR, and native-action display conditions where relevant. |
| Preconditions | Required accounts, data, related records, environment services, and preceding cases. |
| Test data | Exact values, generation method, and this instance; retain raw and escaped whitespace, line breaks, and boundary values. |
| Data/file preparation | Required states, preparation entry points, actual records/dependencies, original attachment references, content expectations, preparation results, and missing conditions. |
| Fault conditions and recovery | Affected page/request, injection method/timing, end conditions, proof of application/removal, and business assertions during faults and after recovery. |
| Business time | Trigger time, relevant timezone, expected time/permitted window, planned/actual observations; distinguish real scheduled triggers from early processing. |
| Historical-material sources | Source versions and applicability of old business records, attachments, sessions, or caches; explicitly record unknown sources and unavailable materials. |
| Additions during execution | Discovery time/evidence for entry points or states, added cases/plan versions, scope changes, and associated questions. |
| Actions and expectations | Actual interaction/backend trigger per step, observation points, expected outcomes, and judgment grounds; identify steps requiring keyboard/desktop operation. |
| Cross-entry steps | Entry point, role/session, same-business-record identifier, before/after state, and evidence per step; do not omit role switching or asynchronous waiting. |
| Evidence requirements | Key screenshots, execution records, and applicable requests, logs, and read-only database verification. |
| Post-processing | Retain defect-reproduction and related data and remove other data created this run under confirmed policy; record effects on other cases and never modify tested source. |
| Open items | Questions, affected steps, user answers, and the case version receiving them. |

**Report presentation**

Provide in-app reports and these exports, generated from the same structured records to avoid inconsistent conclusions.

| Form | Audience | Purpose |
|---|---|---|
| Conversation summary and in-app report | User | Summarize results/gaps first; expand features, cases, issues, and evidence, and supply business expectations or request retests directly through conversation. |
| Offline HTML | User and other readers | Browse complete reports and bundled screenshots without application login or still-valid remote links. |
| Markdown | User and coding assistant | Overall summary, individual issues, and explicit reproduction steps; each issue can be handed off independently. |
| JSON | Programs and coding assistants | Versioned structure, stable IDs, case results, evidence index, historical links, and sources for search/comparison. |

Export a package containing these files and necessary evidence. The layout below is illustrative; no actual report package has been generated.

```text
report-<run-id>/
  report.html
  report.md
  results.json
  issues/
    BUG-001.md
  questions/
    Q-001.md
  evidence/
    ...截图、可用轨迹、相关日志片段与测试数据...
```

Reports use relative evidence references that still open after copying the package. Coding-assistant materials use project-relative paths, source-snapshot IDs, and locations rather than only test-machine absolute paths. Copying an issue's Markdown includes repair context and evidence references; images/traces may be exported in an issue package. The application only generates materials; it does not launch another coding assistant, send messages, or edit code independently.

**Overall report content**

| Section | Questions it must answer |
|---|---|
| Run conclusion | What verification finished, which issues were found, and which gaps remain? More than “testing complete” or one pass rate is required. |
| Run and environment | Project, entry points, source snapshot, runtime version, time, Windows/browser/viewport, and roles. Save each entry's environment declaration, data scope, and authorization references; distinguish declarations from technical verification. Record screen conditions separately for native actions. |
| Rules and configuration | Which case, requirement-confirmation, skill, foundation, and model-configuration versions did the run use? Mark unknowable actual model versions unknown. |
| Scope and feature inventory | Which features were identified from which code, routes, pages, and user input? Which scenarios/cases cover each? Which optional specialized tests did the user explicitly leave unselected? |
| All case results | Which version and planned instances were used, how far each instance progressed, assertion outcomes, and evidence locations? Passed items remain traceable. |
| Complete business-flow results | Which cross-entry flows completed? Which role, entry point, and record were used per step? Where did failure/blocking occur and which later steps remain unverified? |
| Defect list | Severity, impact, module, reproduction/evidence, code location, and historical status. |
| Unverified list | Which features/assertions remain unverified, why, related affected cases, and how to unblock/retest? |
| Business questions awaiting confirmation | Specific questions, observed facts, candidate expectations, affected cases, and handling after confirmation. |
| Execution anomalies | Causes/recovery for model, scheduling, browser, environment, space, or stalled-task issues. Completing session tool results only restores protocol continuity; distinguish unstarted actions from unknown outcomes. Count separately from product defects; tool stalling cannot fail tested business behavior. |
| Runtime statistics | Current/cumulative active duration, wall-clock span, wait categories, calls/retries, known tokens, and request counts with unknown usage. Share the conversation metrics' source without double counting or fabricated bills. |
| Fault-recovery verification | Conditions actively simulated, whether effective and removed, page/business recovery outcomes, and real service faults still unverified. |
| Data/file verification | Preparation success, actual import/export content checks, and evidence-file locations. |
| Flows over time | Cases still waiting or verified when due, trigger/observation times, missed windows, and the limits of conclusions. |
| Old-data compatibility | Historical materials and source versions, verified behavior, and conditions that could not be rebuilt. |
| Scope changes during execution | Features found after the original plan, cases added and when, pending confirmations, and denominator changes. |
| Test-data handling | Data created this run, retained items/reasons, cleaned items, and cleanup failures. Record changes/deletions of existing data separately and explain effects on reproduction/regression. |
| History and supplemental tests | New, recurrent, not reproduced in this verification, and still-unverified issues relative to earlier runs. Explain cases replaced due to changed expectations separately; this is not a Bug fix. |
| Baseline and version changes | Comparison baseline and code-module/runtime-entry versions; changes during testing and affected results requiring re-verification. |
| User dispositions and corrections | Reasons, time, applicable versions, and case changes for false-positive markings, expected-behavior confirmations, and deferred fixes; preserve original observations/evidence. |
| Skill drafts | Suggested knowledge, exact diffs, grounds, and confirmation state, distinct from effective rules. |

Unselected load/security tests are outside this run's scope, not included in skip counts. In-scope flows without external services are skipped/unverified, never passed. No detected issue does not mean an issue-free product; conclusions always refer to explicit scope/evidence.

When users explicitly remove items during execution, save a new plan version and show original scope, current scope, and removed items separately. Preserve existing observations/results. Never automatically remove failed, blocked, or pending-confirmation instances to reach 100% coverage. Out-of-scope and in-scope skipped items use different categories, and report conclusions identify the plan version.

Record source/runtime correspondence as verified, user-declared, or unverifiable, with grounds. Source hashes alone cannot prove a URL's deployed version. Where unverifiable, retain page evidence but state uncertainty in code locations/version ownership; do not claim reliable detection of every deployment change.

Applicable fault-recovery checks are default full-test scope. Planned disconnections, delays, and failures are test conditions; correct handling is the assertion. Ineffective or unreleased simulation is an execution issue. Retain evidence before/during/after faults and actual impact scope. Browser-simulated service errors cannot prove real backend failure/recovery.

Record preparation and file-content checks separately. Successful record/attachment preparation does not pass the business case, and successful upload/download cannot replace content checks. Historical materials record sources/applicable versions; new records cannot substitute for missing old-data compatibility verification.

Time-based cases remain waiting until the observation window and actual verification. Interim reports identify remaining items and expected verification time, without treating normal waiting as product failure or declaring the whole run complete early. If reopening misses a required observation, record retrospectively available logs/final states and still-missing timing evidence; do not assume scheduled execution occurred on time.

Cleanup follows persistence of test results, reports, and evidence; link outcomes to the original run as supplementary records. Retained data links to defects or supplemental cases and includes necessary dependencies. Cleaning other new data must not cascade away reproduction conditions. Cleanup failures record target, method, error, current state, and next-run effects without overwriting case results. Creation/update/deletion records do not imply complete backups or automatic undo of all business changes.

The pre-cleanup ReportRevision explicitly says cleanup is pending. Success, failure, or policy-based termination produces a new revision with outcomes; old reports remain readable. Distinguish assertion completion, cleanup completion, and run termination. Export pins one ReportRevision and evidence list, without mixing updates made during export; announce success only after files/references are checked.

Cross-drive/network-directory exports follow the same completeness rules: temporary materials or incomplete copies cannot appear as complete reports or overwrite existing complete versions. Describe export state separately from missing materials. [Detailed design DD09](../architecture/2026-09-28-web-testing-design-recovery.md) defines temporary directories, completion manifests, and publication protocols.

Unverified portions caused by insufficient R54 authorization, space waits, or stalling remain in current scope/gaps; do not shrink denominators automatically or change historical expectations. Recheck environment/authorization before business-data cleanup as well. Production cannot inherit automatic cleanup permission from test environments.

Present R55 local-asset deletion separately from business cleanup. After users confirm historical-evidence deletion, retain minimal disposition records and original-result ownership. Old reports show user-deleted materials and affected reproduction/retest conditions, never claiming evidence remains readable. Already exported offline packages are not remotely rewritten; later exports list materials actually missing then. Per-run cleanup must not accidentally delete materials referenced by active tasks, current baselines, or other retained reports.

**Execution termination and result classification**

Store whether a task is running, instance progress, and verification conclusions separately. Results below apply first to specific instances; case templates/features aggregate all planned instances. One pass cannot represent every condition.

| Result | Condition | Coverage meaning |
|---|---|---|
| Passed | Required steps executed, with evidence satisfying every applicable required assertion. | Verification of this case is complete. |
| Failed | Evidence disproves at least one explicit expectation. | Preserve verified portions and failure evidence; remaining unexecuted assertions are separate gaps, not assumed checked. |
| Needs confirmation | Business expectations needed for judgment are absent, and affected items were skipped under the rules. | Corresponding assertions are unverified; ask explicit questions in the report. |
| Blocked | Missing prerequisites, dependency failure, unavailable login, or unreliable executor operation prevents a product conclusion. | Unverified; save attempted steps and reasons. |
| Skipped | Still in this run's scope with a definite reason for nonexecution, such as confirmed absence of a real external service. User-removed items are counted separately. | Unverified; preserve reasons/sources and original-plan gaps. |
| Not executed | Not yet attempted, or not run due to cancellation or similar causes. | Unverified; never hide or count as passed. |

Retries are multiple Attempts for one instance, not new case/instance denominators. A failed instance may contain unverified later assertions; passed plus failed counts do not necessarily equal complete coverage. If only one of two planned viewports ran, the other remains a gap; assertions from one instance cannot cover another.

Bounded retesting preserves the first failure and every later attempt. Later success cannot delete earlier failures or mark them as never occurring. Explain results under the same/different conditions separately; failure followed by success alone does not prove a cause. Deferring a fix does not change failure records. False-positive markings or new business confirmations add dispositions and rule-version links without overwriting evidence.

Instance summaries identify the Attempt supporting their representative conclusion while retaining prior-failure markers and differences. A complete-flow pass requires one complete execution with satisfied prerequisites and consistent versions. Successful steps from separately interrupted attempts cannot be stitched into an end-to-end pass. Supplemental assertion evidence cannot automatically pass the whole flow.

After a recovery update, RecoveryLink associates new runs with frozen ones. Reports retain each application combination, case version, observation, and UNKNOWN-action reconciliation record. Do not mark old runs normally completed or join cross-version steps to claim one completed flow.

Cross-entry flows must prove continuity through linked data for the same transaction. Separate case passes at individual clients cannot substitute for actual full-flow execution. On interruption, retain passed, failed/blocked, and unverified subsequent steps without declaring every participating module defective. Retention/cleanup account for dependencies across clients.

Summaries separately show counts/completion for features, case templates, instances, and required assertions. The assertion denominator is all required assertions of applicable current-plan instances. Assertions judged with actual evidence enter the verification numerator; unexecuted, pending-confirmation, and unsupported assertions do not. Complete verification can include failures and must remain distinct from pass rate. A template is fully verified only after required assertions in all planned instances are complete; features also require completeness-check results. Every ratio shows numerator, denominator, and plan version. Code-reading volume, click counts, model DONE, or confidence cannot replace coverage.

Summaries also count each authority category, required business expectations awaiting confirmation, and matched implementation diagnostics. A faulty implementation matching its own inference still leaves business correctness unresolved; execution models, report-summary models, and the UI cannot rewrite it as a business pass.

When adding features/cases during execution, summaries retain initial scope/change history and show the actual current denominator. New unexecuted/pending-confirmation items remain counted. Waiting for business time is a task/step execution state; its incomplete assertions remain unverified and do not create a new independent case.

Claim full verification for this run only after actual actions and judgments complete required cases/assertions for all features; verification may still find defects. Tasks recovering automatically or waiting for required user action/business time remain pending progress and may issue interim reports. If ordinary questions have been skipped, prerequisites are definitively missing, or capability is unsupported, and nothing remains awaiting further progress this run, issue an execution-ended/incomplete-coverage report with supplemental-test items. Persistent temporary API failures follow recovery policy rather than justify rapid skipping of every remaining item.

Execution-ended status also requires a definite cleanup outcome or reason it cannot continue. Normal waiting, automatically recoverable cleanup failures, and outstanding necessary confirmations remain pending work. Report generation does not automatically end a run. Canceled tasks retain cancellation state and uncleaned-item records.

These classifications truthfully describe tested-project verification; they do not replace this tool's delivery standards. A promised first-release operation/verification capability blocked by missing implementation is also a tool-capability gap. A complete report does not pass that capability's delivery acceptance.

**Handoff content for each defect**

| Field | Requirements |
|---|---|
| ID and title | Stable issue ID; title includes page/feature, trigger, and anomalous result. |
| Type and impact | Functional, data, visual, or other product issue; severity, affected roles/flows. Automation failures are not automatically product Bugs. |
| Version and environment | Run, source/runtime versions and correspondence, Windows version/architecture, browser, tested viewport, zoom, role, and necessary conditions. |
| Associated case | Case ID/version, requirement authority, failed assertion, and failed step. |
| Cross-client location | Where applicable: flow ID, entry point, role, related business record, state before/after the anomaly, and affected later steps. |
| Preconditions | Account roles, business state, and data relationships; anonymized materials preserve reproducible data structure. |
| Exact test data | Original text or attachment reference, explicit spaces, line breaks, lengths, and similar details; do not paraphrase boundary data. |
| Reproduction steps | Numbered from a clear entry point, specifying click locations, input, keys, and observations; “execution failed” is insufficient. |
| Expected result | Specific behavior and authority: user confirmation, skill, generic rule, or code inference. Unsettled expectations become pending questions. |
| Actual result | Observable outcome, time, actual values, error messages, and failure location. |
| Evidence | Screenshots, step records, DOM/layout observations, and available request/response, console, backend-log, and read-only-data results, linked individually to steps/assertions. |
| Frequency | Actual attempt/occurrence counts and conditions. Without retesting, state one observation and no retest, not reliable reproduction. |
| Related code | Project-relative paths, snapshot line numbers, symbols/functions, related requests, and call relationships sufficient to explain relevance. |
| Cause analysis | Separate proven facts, suspected causes, and unexcluded factors. State unknown causes; never invent files, lines, or conclusions. |
| Post-fix acceptance | Steps/assertions to rerun and related regression scenarios. Repair directions may be suggested, but unverified advice is not an established solution. |
| Historical links | Initial discovery, historical similar issues, associated runs, and supplemental results; link one issue to multiple cases without double counting. |

Visual defects additionally retain original/annotated screenshots, viewport/zoom, scroll position, triggering data, obstructed/overflowing elements, and observable dimensions. Without designs, use clearly explainable anomalies; aesthetic preferences or ambiguous visual differences await confirmation. Keep originals; annotations do not replace original evidence.

Exported coding-assistant materials are self-contained: the repair AI need not read the whole chat history to learn business expectations. Do not export project access tokens, passwords, verification codes, or complete session Cookies as reproduction material. Describe access through role/credential references and retain nonsensitive reproduction conditions.

Escape page text, logs, and source excerpts as data, never active HTML/scripts. Distinguish original evidence from redacted exports and explain reproduction limits from redaction/missing materials. Self-containment cannot justify credential export, and modified evidence cannot be labeled untreated originals. Historical locations reference saved historical material; later source edits must not redirect old issues to new content.

Backend cases/issues also record existing entry points, API methods/parameters, or commands, arguments, and necessary working directories, using references/redaction for secrets. Evidence includes trigger time, response/output, task identifiers, related logs, available read-only data, and final business state. Accepted responses or successful command exits cannot replace asynchronous outcome checks. Record manual processing triggers separately from automatic scheduling. Report gaps when triggering or final observation is unavailable.

**Illustrative defect structure, not an actual finding**

```text
问题：BUG-001｜客户详情：多行备注保存后显示为一行
关联用例：TC-CUSTOMER-017，版本 3
定位：客户管理 → 编辑客户 → 备注；客户详情 → 备注展示
前置条件：有编辑权限的测试账号；一条允许编辑的测试客户
测试数据：第一行\n第二行（包含一个真实换行）

复现步骤：
1. 打开测试客户，进入编辑页面。
2. 在备注输入“第一行”，按 Enter，再输入“第二行”。
3. 保存并打开该客户的详情页。
4. 刷新详情页，观察备注分行情况。

预期：保存、查看和刷新后，备注均保持两行。
依据：用户已确认的“备注保留换行”业务规则。
实际：详情页将两行显示在同一行；编辑页面重新打开仍有换行。
证据：输入后、保存后和刷新后的截图；相关操作记录。
相关代码：真实报告填写已核对的项目文件、符号及源码快照位置。
原因状态：尚未证实；需核对接口返回值与详情页文本呈现方式。
出现频率：实际报告填写观察与复试次数。
修复验收：本例通过；补测连续换行、首尾换行、长文本及编辑回显。
```

This example explains the user-visible failure and post-fix criteria while explicitly leaving the cause unproven. Actual reports must not assert backend loss of line breaks or a wrong CSS property without inspecting the API, database, or code.

**Structure and handling of pending questions**

Each question has an independent ID, specific business question, code/page facts, affected features/cases, skipped steps, candidate expectations, and user answer. Options only assist expression; allow natural-language additions and never replace answers with default selections.

For example: should deleting a customer preserve historical orders and show the customer as deleted, or prohibit deletion while orders exist? Attach current observations and affected cases. After an answer, show assertion/scope changes, save a new case version, and arrange actual supplemental testing. Update preparation and verification steps affected by different rule branches as well.

Ordinary case updates are already requested by the user. If also proposing to capture an answer in a skill, separately show and confirm its draft. Historical runs retain their contemporary rule versions; today's business rules cannot relabel earlier results.

**Evidence collection and persistence ownership**

The confirmed default records steps, key screenshots, failure evidence, and related logs; full video is optional. Reports and necessary evidence remain by default for user-managed cleanup. Each case stores time, input, and assertion outcomes; link relevant network, console, backend-log, and read-only-data evidence to steps. DD02, DD06, and DD09 define complete browser-trace collection; this does not automatically enable full video or historical-evidence deletion.

Persist cases, case versions, runs, attempts, step observations, assertions, issues, pending questions, and evidence independently, linked to DSH sessions/logs. Sessions provide communication/control, not the only results database. Showing reports or switching conversations must not change active tests.

Active runs pin confirmed rules and bind every execution to an explicit case version. Adding discovered scenarios under confirmed rules creates new plan revisions while preserving originals and executed cases. New business confirmations create case versions used by linked later supplemental tests. Model routing may change analysis/action selection but cannot rewrite assertions or coverage gaps. Foundation upgrades must preserve old report/evidence associations; DD06, DD09, and DD12 define storage formats/migration.

Formal verification of this specification belongs to AC07, AC15, AC27–AC31, AC33, AC38–AC53 in [acceptance criteria and traceability](../testing/2026-09-28-web-testing-acceptance.md) and related DD13 scenarios; no second acceptance list is maintained. Historical probe examples do not establish final-candidate acceptance.

## Alternatives considered

**Recorded choice.** Implementation-only comparisons and a first screenshot used as its own visual oracle cannot establish business correctness.

## Acceptance criteria

Execute this proposal’s normal and failure controls and satisfy the [shared acceptance criteria](../testing/2026-09-28-web-testing-acceptance.md) and applicable task evidence requirements. Documentation migration does not establish a pass.

## Risks

An apparently precise report can still mislead if its oracle, coverage denominator, or unverified results are missing.
