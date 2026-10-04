# Agent Note: Product requirements

Status: proposed

English | [中文](2026-09-28-web-testing-requirements.zh.md)

## Problem

A developer needs a complete version test that checks business behavior and visible interaction, while keeping the tested source read-only.

## Proposal

Design state: current product scope, R01–R58. Local probes and a restricted prototype exist; the final product remains unaccepted. The [collaboration guide](../process/2026-09-28-web-testing-agent-guide.md) owns current delivery status. The [architecture](../architecture/2026-09-28-web-testing-architecture.md) and three detailed designs govern implementation; [acceptance criteria and traceability](../testing/2026-09-28-web-testing-acceptance.md) govern product passing criteria. The [foundation and upstream upgrades](../process/2026-09-28-web-testing-upstream-baseline.md) document is the sole source for the foundation version and upstream rules.

The product serves individual developers. After developing a version and starting the project, the user supplies the complete code and the tested URL. The application understands the project, organizes tests, simulates human operation through the browser and necessary computer control, accumulates test assets, and generates reports. It also retains DSH conversations for analysis, discussion, and skill maintenance.

The core goal is comprehensive, traceable project testing. Optimize speed and cost through model routing, deterministic execution, and historical asset reuse, never by reducing selected test scope or weakening judgment criteria.

The following product boundaries are confirmed.

| ID | Confirmed requirement | Meaning |
|---|---|---|
| R01 | Single-user desktop application | For individuals; no team, organization, or collaborative-permission management system. |
| R02 | Windows 10 22H2 (build 19045) or later, x64 | C02 confirms Windows 10 22H2/19045 as the minimum and support for Windows 11 x64. Earlier Win10 and ARM64 are outside the first release. Test PC web pages, with mobile expansion later. Validate actual systems, native dependencies, and runtime behavior against first-release targets. |
| R03 | Use the DSH foundation and official desktop path | Reuse official desktop source, UI, and engineering infrastructure directly, adding test capabilities through plugins and necessary adapters. Follow official extension mechanisms and upgrade only after validation against a pinned version. C03 confirms the officially supported unsigned local installation path with manual updates for personal use in the first release; formal signing and automatic updates come later, without weaker engineering checks. Ordinary updates protect tasks; also offer explicitly selected, compatibility-validated recovery updates. Frozen old runs are neither completed nor canceled, and unknown actions remain pending reconciliation. |
| R04 | All application-owned code follows DSH engineering rules | Develop desktop, plugins, frontend, scripts, tests, and documentation under the official rules of the selected version; manage the foundation version and applicable rules together. |
| R05 | User supplies all project code | Include frontend, backend, and other relevant project code; do not limit onboarding to frontend repositories, languages, or frameworks, or require advance technology-stack selection. |
| R06 | User starts the tested project | Accept an already accessible URL. Automatic deployment, project startup, and dependency installation are outside the currently confirmed main flow. |
| R07 | Infer requirements automatically from code | Users need not write requirements first; code produces candidate expectations. Distinguish confirmed business rules, applicable generic rules, and implementation-only inferences. Confirm critical amounts, permissions, and state transitions together even when implementation is clear; implementation consistency cannot replace business correctness. Allow supplementation through conversations, test requirements, and skills. |
| R08 | No design mockups | Discover visual anomalies primarily from actual pages; historical screenshots may support later comparisons. |
| R09 | Concentrated testing of all features | Test comprehensively after completing a version, including every input control, line breaks, CRUD, page interaction, and styling issues. Do not limit capability to simple forms. |
| R10 | Support selecting and entering test requirements | Users mainly express scope and requirements in natural language, assisted by conversation options, cards, and shortcuts; no complete configuration form is required first. |
| R11 | Performance/load and specialized security tests are optional | Do not include them in every full test by default. Selection requires corresponding targets and execution parameters. |
| R12 | Test only; do not modify tested-project code | Ordinary conversations, tests, model routes, skills, dynamically enabled tools, and retries must not modify tested source, configuration, or dependencies. Official tool-enablement guidance and manual approval cannot lift this boundary. The user confirms application-layer controlled operations under the current Windows account: no arbitrary terminal, code editor, or unrestricted desktop control; block and explain actions with unknown effects. The user accepts that this is not OS-level isolation. Analysis and recommendations are allowed. |
| R13 | Test-environment business data may be created, updated, and deleted | Within the environment and data scope confirmed under R54, operate on new and existing data through business entry points. If the user confirms all test data, this may cover all business records. It does not extend to production or unknown environments or authorize source changes. |
| R14 | Generate reports without automatic repairs | Save issues and evidence for the user; do not repair code, commit changes, or create repair PRs automatically. |
| R15 | Preserve test history | Support new-version testing, regression testing, and retesting historical issues. |
| R16 | Sustain long-running tasks | Recoverable model API failures require automatic retries; one failure must not terminate the task or require repeated user requests to continue. |
| R17 | No model-call cost budget | Set no application-level model spending cap and do not pause at an accumulated-cost threshold. Still avoid ineffective loops and meaningless calls. This does not authorize real business actions such as payments. |
| R18 | Route models by task | Match capabilities to requirement reasoning, vision, deterministic steps, and local structured decisions. Support replaceable lightweight decision models; Jev is only a candidate example, with no brand, provider, or proprietary-primitive dependency. Connect and accept at least one real lightweight route, avoiding dependence on large multimodal models for every action. Prefer deterministic execution with precondition checks for stable regression steps. A lightweight route becomes the default for its tasks only after passing quality and total-benefit gates; lack of benefit does not stop an already qualified route from working. |
| R19 | User-configurable skills | Add knowledge, testing methods, business workflows, and similar material, refined through conversation. |
| R20 | Retain the native DSH conversation experience | Native DSH conversations are the main UI, with Codex and ZCode as interaction references. Conversations may be project-linked or independent. Conversational file operations remain subject to R12. |
| R21 | Proactively propose skill-improvement drafts | Suggest improvements after testing; save and activate them only after user confirmation, never modify effective rules independently. |
| R22 | Support multiple login methods | Include username/password, verification codes, SMS, and QR codes. Design automation and manual takeover under the subsequent rules. |
| R23 | Allow a dedicated testing computer | Prioritize complete, reliable execution. Support parallel everyday use where operations need not occupy the desktop; not every computer-control step must run in the background. |
| R24 | Support additional runtime evidence | Design for user-supplied backend logs and read-only database verification. Configure actual paths, connections, and accessible scope per project; source availability alone does not imply access to the runtime environment. |
| R25 | Confirm external business actions before execution | Confirm real payments, SMS, email, and similar actions with the user. Skip the corresponding external flow when no real service exists. Report the reason; a skip is not a pass. |
| R26 | Natural language drives the entire test process | Users start tests, define scope, add requirements, and control tasks through conversation. Show plans, progress, browsers, reports, and skill changes in cards or sidebars; do not turn the testing workspace into a traditional task-form flow detached from conversation. |
| R27 | Generate cases before executing tests | Before actual case execution, analyze all project code, requirements, existing skills, and history to generate cases. Ask about unclear business expectations at this stage and apply answers to cases. |
| R28 | Skip newly ambiguous business checks during execution | Do not guess correct expectations. Skip the related case or affected checks, continue independent cases, and list them in the final report. After confirmation, update the case version and run the corresponding tests. External-action confirmation and login takeover retain their existing rules. |
| R29 | Execute all features case by case | Full testing must execute cases for all features as a person would; report every unverified part. Case generation, code reading, or API success cannot replace real page execution. Do not claim all features are verified while gaps remain. |
| R30 | Confirm case updates before testing a new version | Read current code and compare it with the user-selected or project-adopted regression baseline. Propose new, changed, deleted, and affected cases. Ask about changes to business behavior and expectations and update cases before execution. Implementation changes alone do not prove business correctness. |
| R31 | Reports serve users and coding assistants | Clearly identify the issue, reproduction, expected/actual differences, evidence, and relevant code, so users can understand and coding assistants can repair it. This application continues to test and report only, without changing tested code. |
| R32 | Cover backend features without page entry points | Inventory scheduled tasks, message handlers, callbacks, and similar features. Trigger through existing APIs or project management commands, then verify through pages, logs, and read-only data. Features with page entry points still require page operation; source-read-only and real third-party confirmation rules remain. |
| R33 | Retain issue data and clean up other newly created test data | Preserve data needed for defect reproduction and related records. Automatically clean up other data created in this run after testing and report persistence. Account separately for modifications/deletions of existing data; automatic restoration is not promised. Include cleanup results and failure reasons in the report. |
| R34 | Reminders only in the corresponding desktop conversation | Present takeover and confirmation requests in their owning conversation, referencing Codex and ZCode interactions. No Windows notifications, mobile pushes, SMS, email, or other reminder channels are planned now. |
| R35 | Embedded browser primary, standalone browser supplementary | When the embedded environment is limited, control standalone Chrome/Edge for those flows. Include results in the same report and identify the actual environment. |
| R36 | Continue background testing after window closure | Closing the window does not exit or cancel testing; the application keeps running. Explicit application exit saves progress and exits. Exit/update checks include all persistent runs, including waiting, paused, and recovery-pending tasks in unloaded sessions. Desktop operations retain their foreground requirements. |
| R37 | Verify and automatically resume after reopening | After a crash or restart, reopening checks the environment, login, and submitted actions before resuming unfinished tasks. User-paused tasks remain paused; canceled tasks do not resume automatically. Old runs frozen by recovery updates are reconciled and linked to continued tests only through recovery, never directly auto-dispatched. |
| R38 | Record and retain necessary evidence by default | Record steps, key screenshots, failure evidence, and related logs by default; full video recording is optional. Retain reports and necessary evidence by default, with user-managed cleanup. |
| R39 | In-app reports and multi-format exports | View in the application; export HTML for people, Markdown/JSON and evidence packages for coding assistants, all from the same run records. |
| R40 | Distinguish application-window and tested-page dimensions | Reference Codex/ZCode for application sizing and zoom. Ask for the tested frontend viewport before testing, save it to project test configuration, and subsequently execute the confirmed configuration. |
| R41 | Check case completeness before testing | Map feature entry points, roles, and business states identified in code and pages to cases. Add missing cases or explain gaps; executing every generated case alone cannot establish full coverage. |
| R42 | Complete business-flow tests for projects with multiple entry points | Associate multiple code directories, URLs, and roles with one project. Trace the same business transaction through admin and user interfaces, verify state, data, and role-visible results, and form flow-level conclusions. |
| R43 | Verify concurrency and multi-role interaction where business requires | Cover applicable cases such as co-editing and post-approval state synchronization. These are business-correctness checks, not a substitute for optional performance/load tests. |
| R44 | Identify version changes during testing | Record and reconcile detected source or deployment changes and isolate affected results; do not combine different versions into one version's verification conclusion. |
| R45 | Selectable, traceable regression baselines | Users may specify comparison versions in natural language. Code, case expectations, and visual references each have version associations. Incomplete tests or defective screenshots do not automatically replace the baseline. |
| R46 | Retain the first failure and allow bounded retesting | Save failure evidence before bounded retesting with satisfied preconditions, recording conditions and results of each attempt. Later success cannot erase earlier failure. Handle these separately from model API retries. |
| R47 | Users can correct or dispose of test conclusions | Allow natural-language false-positive markings, confirmation that behavior is expected, or deferred fixes, recording reasons and applicable versions. Expectation changes enter case versions; skill changes still require draft confirmation. Preserve history. |
| R48 | Prevent interference between tasks | Independent runs sharing an environment and business data queue by default. One task controls system mouse/keyboard at a time; ordinary conversation and code analysis may continue. |
| R49 | Fault-recovery tests included in full testing by default | Generate applicable cases from project features, simulate disconnection, request delays, or failures in controlled test browsers, and verify messaging, input/business-data retention, and recovery behavior. Record simulated conditions and actual verified scope. |
| R50 | Automatically prepare test data/files and verify content | List required data states before testing and prepare them through allowed business entry points. Generate applicable normal, boundary, and invalid files and verify actual import/export contents. Unavailable prerequisites remain coverage gaps. |
| R51 | Support business flows over time | Cases specify triggers, wait durations, and final observation points. Persist waiting progress, verify when due, and continue independent tests meanwhile. Distinguish early triggering through existing entry points from real scheduled triggering. |
| R52 | Regression includes applicable old-data compatibility checks | Verify historical business records, old attachments, and applicable existing logins/caches with source-version traceability. If only the new version and new data exist, explicitly report missing compatibility-test conditions. |
| R53 | Continuously complete feature and case inventories during execution | Record evidence for newly discovered entry points/states. Where expectations are clear, add cases and record plan changes before execution. Skip and consolidate new business questions under R28. |
| R54 | Confirm environment type and data-operation scope before testing | Persist user declarations for each entry point's environment type, account/tenant, and data scope. By default, make no business changes or impactful fault simulations in production/unknown environments. Where needed, first confirm specific flows, record scope, and side effects; reassess exceeded scope or relevant environment changes. |
| R55 | Monitor local-asset space and support user cleanup | Show occupancy/free space and warn early. Start per-run cleanup through conversation and confirm effects. On insufficient space, preserve tasks and stop steps whose necessary evidence cannot be saved; never delete history automatically. Storage caps are optional; no hard quota by default. |
| R56 | Conversational initial model setup and credential management | Reuse official model editors and credential services. Guide provider, model, and route setup through conversation and setup cards, checking connectivity and required capabilities. Manage credentials through dedicated inputs, with replacement/deletion. Missing lightweight configuration does not block other capable routes; identify missing required capabilities. |
| R57 | Detect lack of substantive progress across a task | Detect repeated observation, replanning, or recovery without progress, excluding normal waiting. First try bounded recovery and advance independent items; if blocked, wait durably and notify the owning conversation. Do not spin or falsely claim completion. |
| R58 | Show progress, duration, and model usage during execution | Show current phase, substantive progress, waiting reasons, duration, calls, and known token usage in the owning conversation. Label missing usage honestly; distinguish changing scope from settled results. Introduce no cost-based stop condition. |

These requirements use a unified conversation entry point for testing and knowledge maintenance. The behavior below refines requirements; detailed designs specify controls.

Confirmed testing flow: complete required model setup → user identifies the project, entry URLs, and test goals and confirms environment type → analyze code, pages, roles, skills, and historical baselines → generate individual and cross-entry flow cases and check completeness → confirm business questions, expectation changes, and necessary action authorization → write answers into cases → execute while recording progress, space, and usage → skip newly ambiguous business items and continue independent tests → generate a report → user confirms pending questions → update cases and run supplemental tests.

Full-test case preparation also covers applicable fault recovery, data/files, flows over time, and historical data. Complete and verify prerequisites before execution; record discoveries and case additions under R53 during execution. Preserve traceable scope, plan versions, and evidence at every phase.

Distinguish listing preparation steps from executing preparation that changes business data. The latter follows R27 and occurs after the relevant cases and business questions are resolved. A request to generate cases only does not authorize early creation or cleanup of business data.

**Environment, initial configuration, and sustained operation: R54–R58**

R54 records test/production/unknown status and the source of the user's declaration for each entry point. Localhost, a domain name, or successful login cannot independently prove environment type. Recheck changes to relevant entry points, accounts/tenants, backend destinations, or deployment environments; a version-only change may reuse the declaration after confirming unchanged environment ownership. Save allowed data-operation scope before testing and do not repeatedly ask after reopening within the same declaration. In production/unknown environments, include preparation, modifications, deletions, cleanup, and business-impacting fault simulation in specifically authorized flows; full testing does not grant blanket access. Authorization may cover explicit case groups and record scopes, without mechanical confirmation for every click. Real external services still require R25; these permissions are not interchangeable. Unknown or insufficiently authorized portions remain in scope as gaps, never automatically removed from full testing.

R55 occupancy includes application state, source/skill snapshots, evidence, recordings, managed browser profiles, and temporary export materials, distinguishing application assets from tested-project data. Conversation can open run-occupancy cards, preview cleanup effects, and confirm execution. Shared evidence, active-task assets, and assets referenced by the current regression baseline cannot be deleted directly. Users may set storage caps; none applies by default, but free-space warnings and save-capability checks still apply. Insufficient space causes recoverable waiting; verify before resuming after space returns. Do not silently disable case-required video or reduce evidence. A complete migration package for computer replacement/reinstallation is outside the first-release commitment; existing upgrade-backup requirements remain.

R56 does not require purchasing or configuring every provider first. First-run users may configure a project first or reuse existing models for ordinary conversations. Before testing, ensure the selected tasks' required capabilities are available; one multi-capability model may serve several tasks. Setup cards explain that connection checks make a small number of real requests and distinguish credential, network, model-name, and unsupported-capability errors. Dedicated controls store credential references, not secrets in chat, skills, prompts, or reports. Show the impact before deleting an active credential and retain affected tasks awaiting configuration. Use permitted alternatives when no lightweight route is configured. Product acceptance requires at least one real lightweight route and replacement mechanism, not Jev- or TypeSafe-specific acceptance.

R57 observes substantive progress by phase: analysis produces supported new findings, execution advances valid steps or settles assertions, questions are resolved, and so on. More tokens, refreshed timestamps, or repeated rewrites of the same plan do not count. Business-time waiting, API backoff, user pause, takeover, environment waits, and space waits are distinct; do not impose one wall-clock timeout on all. If bounded recovery fails, retain the stall reason and release conditions, notify only the owning conversation with deduplication, and continue independently executable items. This mechanism imposes no total-call cap for the task and never converts stalling into a pass.

R58 queries recorded facts without extra model calls for status display. Distinguish current active duration, cumulative active duration, and wall-clock span; show pause and each wait category separately. Include retries and fallback-route requests in usage, never treating unknown usage as zero. Explain coverage-denominator changes; discovering new cases must not preserve a false fixed completion percentage. Exact billing estimates are not required in the first release, and no cost-threshold stop is introduced.

**Projects with multiple entry points and cross-client flows**

Organize a project as a complete business system, linking multiple code directories, frontend entry points, and backend services within the same test environment. Save entry names, URLs, corresponding modules/versions, applicable roles, account references, and dependencies. Users still start the project. Complete missing URLs, accounts, runtime evidence, and similar information before testing the specific project, without requiring a complete configuration form first.

Cross-entry cases follow the same business transaction and related data across clients. Example: user submits an application → admin finds and approves that application → user checks the latest state → other roles verify applicable data visibility. Record each step's entry point, role, action, business identifier, expected state, and actual evidence. Creating unrelated records on each page does not establish an end-to-end flow.

Manage role sessions by project, identity, and case needs. Switching roles must not unexpectedly overwrite their login states. For asynchronous processing, observe transitions against explicit business expectations and record waits and final results. Generate normal, rejection, withdrawal, repeated-action, and other branches from actual project flows and confirmed rules; do not invent business requirements.

Retain both flow-level and step-level results. On interruption, identify verified steps, failure/blocking locations, and unverified later portions. One failed flow does not prove every participating module defective. Cleanup must account for cross-client dependencies and retain records needed to reproduce the entire issue. Completeness checks cover cross-client flows, not merely individual cases per entry point.

R48 queues independent runs that could interfere. R43 coordinates concurrent actions by multiple roles/sessions deliberately within one case. Express these separately; run queuing must not remove business-concurrency scenarios.

Knowledge-maintenance flow: create a project-linked or independent conversation → analyze code, discuss business, or inspect test evidence → user requests knowledge capture or application suggests it → generate or revise a skill draft → show specific changes → user confirms → save a version available to subsequent tests.

Refine natural-language behavior under the confirmed clarification rules: “test this project” generates cases first and executes after necessary business answers are applied; “give me test cases first” only produces cases; “continue the last regression” associates an existing run and first checks current version and environment. Do not add repeated confirmation for each already-clear case. External actions such as payments and skill activation retain established confirmation rules.

Support the following conversational interactions. They must change real task state, not merely produce textual replies.

| Example user expression | Product behavior |
|---|---|
| “Fully test this project; its URL is…” | Parse scope, reuse project information, and show the plan and execution progress. |
| “Only regress the order module; focus on line breaks and duplicate submissions.” | Form explicit scope/checks and retain historical-case associations. |
| “How far has testing progressed?” | Read and reply with current progress without interrupting execution. |
| “Also check refreshing the page after deletion.” | Update the plan at an appropriate step boundary and record the change. |
| “Pause this test”; “continue the last task.” | Control the corresponding run lifecycle; clarify only task ownership if the target is ambiguous. |
| “Open the action history for this issue.” | Show the corresponding evidence, steps, and browser records. |
| “Add this lesson to the form-testing skill.” | Generate a specific change draft and save it after user confirmation. |

Conversation is the control entry point; structured plans, execution state, and evidence provide verifiable results. Project navigation, an embedded browser, file selection, result cards, and necessary settings screens may exist, but must not become a mandatory sequential wizard for every test. Separate task execution from the current chat page's display state so viewing reports, changing conversations, or asking about progress does not change execution state.

R34 governs reminders. Mark the owning conversation as needing user attention and explain the reason, affected step, and required action. Allow natural-language responses or takeover of the corresponding page. Associate reminders with actual pending items so users can find them after switching conversations. Save progress while waiting and continue independent cases; silence is not consent. New ordinary business ambiguity during execution still follows R28: skip and consolidate it into the report instead of asking repeatedly mid-run merely because reminders exist. Card and conversation-marker styling belongs to later interaction design; this does not claim present implementation or reproduction of reference products' specific mechanisms.

Reading code yields supported requirement inferences. Source describes existing implementation but cannot alone prove original business intent or reliably discover wholly unimplemented requirements with no other clues. Preserve that limitation rather than equating implementation with correct expectations.

Before testing, generate a business-grouped critical-rule list covering at least applicable amounts/billing, role permissions, state transitions, deletion/cascades, and real external actions. Each rule shows current implementation, candidate expectation, source, and affected cases; do not ask only about rules the model considers ambiguous. Reuse version-applicable prior confirmations. Confirming test scope or permitting operations does not confirm every business rule; rule confirmation binds specific content and versions.

Reports show verification scopes for confirmed business rules, applicable generic rules, and implementation-only inferences side by side. Code consistency may be a diagnostic match, but cannot count as a business-expectation pass or enter its verification numerator. Required business expectations without authority remain pending confirmation and coverage gaps; new answers enter new case versions and actual supplemental testing. The [report specification](2026-09-28-web-testing-test-case-report-spec.md) governs judgments.

Browser operations, input checks, visual checks, and business-flow verification target running pages and business outcomes. Users need not declare the project language beforehand. The application identifies directories, files, APIs, and call relationships. Language-specific parsers may improve precision but cannot become mandatory configuration before testing. Record concrete analysis gaps for code that cannot be reliably parsed or understood, continue supported page/business verification, and clarify necessary business questions through the established flow. Do not fabricate locations or silently remove features because a parser is missing.

For each requirement, record entry points, related code, page evidence, business prerequisites, expected behavior, authority sources, and unresolved questions. Distinguish explicit user rules from code inference and record conflicts rather than silently overwriting either. Use roles, constraints, and data relationships in inputs to generate applicable scenarios.

Link coverage as feature → scenario → case → action/assertion → evidence → result. Including all features in testing is the product goal; coverage metrics must state denominators and known scope. Completion of an identified list does not establish that every feature was discovered or no defects exist.

The same case requires actual execution instances for the user's selected roles, viewports, data, and runtime conditions. One condition cannot substitute for the others. The [report specification](2026-09-28-web-testing-test-case-report-spec.md) defines instance statistics and scope changes. Understanding business behavior from code supports case generation and location, but does not establish measured statement or branch coverage of the tested project.

Cases become saved test assets before execution. Each includes stable ID, version, feature/requirement authority, account role, prerequisites, exact data, step-by-step human actions, expectations and judgment grounds, dependent cases, and required evidence. Preserve both raw and escaped spaces, line breaks, and special characters. Record sources, scope, and confirmation time for user business answers, beyond chat history alone. Changes incorporated into skills still require a separate confirmed draft.

For new versions, first compare current code with the user-selected or current regression baseline snapshot, then propose case changes using dependencies. Default to the most recent confirmed applicable baseline, not simply the last incomplete run. Classify additions, business-expectation changes, flow/locator changes, feature removal, and indirect effects. Show exact old expectations, proposed new expectations, code evidence, and affected scope when seeking confirmation; do not merely ask to update all cases. Git is not required. Without comparable historical snapshots, state that reliable historical differences are unavailable and organize current cases as a first test.

Associate versions separately with each code module and runtime entry point in a flow. On detected source/deployment changes during testing, first record time and affected modules. Reconcile subsequent steps with uncertain version ownership before counting them; they cannot continue as results for the old version. Continue through linked new runs or explicit version segments, preserving originals and never automatically reassigning previous evidence to the new version.

A source snapshot proves only the version of local material, not that the URL runs the same code. State the basis of correspondence and distinguish verified, user-declared, and unverifiable mappings. Without runtime version signals, do not promise detection of every deployment change. Retain actual page observations, while marking uncertainty in code locations and version conclusions.

Product-failure retesting follows R46. Preserve the original state first, then retry within bounds only when prerequisites can be rebuilt and operations remain authorized. Real payments, SMS, and email retain their original confirmation scope. Reports preserve each failure/success, observation counts, and differences. Under R47, false-positive markings, business-expectation confirmations, or deferred fixes add dispositions rather than overwrite execution evidence. Deferral does not change a failure fact.

After confirmed updates, save new case versions while preserving old versions and results. On new business questions during execution, record completed steps/observations and skip remaining steps dependent on unknown expectations. Partial success cannot pass the entire case. After the answer, create linked supplemental-test records, reestablish prerequisites, and execute affected cases; changing report status alone is insufficient. Link supplemental results to the original run without replacing original records.

A full run aims to execute and judge cases for every feature. Tasks in automatic recovery, waiting for necessary user action, or waiting for business time remain pending progress and may issue interim reports. Where ordinary business questions have been skipped under R28, prerequisites are definitively missing, or execution capability is unsupported, and no items remain awaiting further progress in this run, issue a report stating that execution has ended with incomplete coverage. Do not claim all features verified. Temporary model API errors continue through recovery; they cannot justify skipping all remaining cases and ending the run. Result classification and report design are specified below through the linked specification.

The following generic checks are built in. Generate applicable cases from actual features and confirmed rules; do not mechanically apply them to unrelated controls.

| Check category | Checks |
|---|---|
| Input controls | Empty values, whitespace-only, leading/trailing spaces, length boundaries, overlong text, Chinese/English, special characters, clearing, and paste. |
| Multiline input | Single/repeated line breaks, leading/trailing breaks, multiline paste, reopening after save, and detail/list presentation. |
| Keyboard and focus | Tab, Enter, Shift+Enter, Esc, focus order/loss, and unintended submission, with expectations based on control semantics. |
| Create and edit | Validation messages, save, cancel, duplicate submission, results after refresh, and related state updates. |
| Queries and lists | Search, filtering, sorting, pagination, empty results, clearing conditions, and combined operations. |
| Deletion | Confirmation, cancellation, relationship handling, and subsequent query/access. |
| Cross-feature and cross-entry flows | Data, state, and presentation consistency for the same transaction across entry points, roles, pages, APIs, and backend steps; flow-level and step-level results. |
| Role and data isolation | Available features and visible data by role; complete account details and preparation methods before project testing. |
| Business concurrency | State conflicts from co-editing, repeated operations, or multi-role interactions under business rules; distinct from load testing. |
| Page visuals | Overlap, obstruction, overflow, truncation, misalignment, long content breaking layout, modal/dropdown layers, and different PC window sizes. |
| Error feedback and responsiveness | Page errors, feedback after API failure, unresponsiveness, and obvious stalls; not automatically performance/load testing. |
| Active fault and recovery | Applicable offline, timeout, and failed-request scenarios under R49 by default, observing messages, data, and action results during faults and after recovery. |
| File and data preparation | Required records/attachments under R50, import results, export contents, and applicable boundary/invalid input. |
| Flows over time | Applicable expiry and scheduled-processing flows under R51, separately recording waiting and final business results. |
| Historical-data compatibility | New-version checks using traceable historical data, attachments, and applicable sessions/caches under R52. |

Generic checks must work out of the box; user skills supplement or adjust them, rather than requiring users to write every input's testing method. Selected mandatory rules become test items; giving the model a paragraph does not mean they were executed.

Human-like operation must match case purpose. Keyboard tests execute the relevant keys and focus operations; direct value assignment cannot substitute. API success does not cover required browser interactions. Preserve predefined empty values, line breaks, lengths, and special characters; execution models must not replace them with easier-to-submit data.

Backend features without page entry points use existing triggers under R32. Cases record trigger methods, parameters, expected state changes, observation channels, and service dependencies. Missing entry points/prerequisites remain unverified; reading code cannot pass them. Existing commands must not modify tested source, configuration, or dependencies. Users still start projects, and databases remain read-only for verification. Correlate asynchronous task identifiers, logs, and final outcomes; request acceptance or successful command exit does not prove business success. Manual triggering verifies processing logic; automatic scheduled triggering needs separate evidence.

Without design mockups, judge visual issues through layout rules, screenshot understanding, and historical comparison. Initial screenshots are observations, not automatically correct standards. Comparisons account for window dimensions, data, loading, fonts, and dynamic content; visual differences are not necessarily defects. Present provable anomalies separately from styling questions requiring user judgment.

**Fault recovery, data/time scenarios, and cases added during execution**

R49 fault checks are default full-functional-test scope. Each case first defines affected pages/requests, injection timing, duration/end conditions, recovery method, and expected results, then executes in a controlled test browser. Limit simulation to its test target without disconnecting the application's model calls or other cases. Executors verify injection took effect and removal on completion/recovery. If conditions cannot be reliably created or removed, record execution problems and affected items. Simulated browser error responses verify page handling under that condition, not real backend failure/recovery. Ambiguous submission outcomes still require state reconciliation before recovery retries to prevent duplicates.

R50 preparation is a traceable test step recording target state, preparation entry point, actual records, and dependencies. Record existing data's source; cleanup follows R33. Prepare files using actual supported types, structures, and business rules in application-owned locations. Verify applicable fields, counts, exact values, line breaks, encoding, or presentation; a success message or file existence cannot pass content verification. Preparation failure does not verify the corresponding business behavior, and preparation cannot replace required page interaction.

R51 time-based cases record trigger time, relevant timezone, expected due time or permitted window, observation channels, and actual observation time. Clarify unspecified business deadlines before testing. Persist waits and schedule independent cases; waiting itself needs no continuous model calls. On reopening, check whether due time passed or the observation window was missed before deciding what can be verified. Final state cannot establish an unrecorded exact trigger time. Items not yet due show waiting for business time, permit interim reports, and cannot cause early completion of the run. Record real scheduled triggers separately from early processing through existing entry points, retaining source/configuration read-only boundaries.

R52 selects traceable historical records, attachments, sessions, and caches according to actual features. Mark unverifiable source versions unknown. Historical materials require corresponding expectations and evidence; new-version data cannot masquerade as older outputs. Verify compatibility on the version already started by the user. Automatic old-version deployment, upgrades, and migrations are outside the confirmed execution flow. Report gaps where historical materials or required conditions cannot be obtained/rebuilt.

R33 removes unnecessary data created in a run, so successful-case data cannot be assumed available for future compatibility tests. Prefer existing or user-supplied historical materials. Retained reports/evidence do not imply corresponding database records still exist. Long-term tool retention of successful business baseline data would require a separate cleanup-rule change; R52 does not expand retention automatically.

R53 requires comparing newly discovered entry points, role states, or dynamic features with the original inventory during execution. Where expectations are clear and within scope/authorization, first create cases and a plan revision, then execute. Record discovery time, evidence, and coverage-count changes; do not backfill cases to imply advance design or prior execution. Handle new business questions under R28. Additions do not overwrite executed cases/rule versions, confirmed expectations, or effective skills. If deployment changes are discovered, also apply R44.

Long-running tasks follow the behavior below; DD07–DD08 define states and recovery. Official background execution, Jobs, or scheduled messages alone cannot replace persistent test state.

| Scenario | Behavior |
|---|---|
| Temporary timeout, rate limit, or service error | Record failure and retry automatically with backoff; show recovery and reason. |
| Business-time waits such as expiry or scheduled tasks | Save trigger and expected verification times, show waiting, and continue independent cases. Resume verification when due; on reopening, check for missed observation windows. |
| Primary model remains unavailable | Switch to a configured, capability-appropriate fallback and record the actual route. |
| One case finds a defect | Save failure and continue unaffected cases. |
| Browser error or page change | Reobserve state and restore prerequisites; do not continue input using stale control information. |
| Login expires | Attempt automatic recovery; wait for takeover when QR/code entry requires a person, preserving progress. |
| Invalid credentials or an issue requiring manual resolution | Notify the owning conversation and save the recoverable task; repeated permanent-error calls are not progress. |
| User closes the window | Retain background tasks and required browser resources and continue testing; destroying the chat window cannot cancel tasks. Foreground computer operations retain their conditions. |
| User explicitly exits the application | Save progress and in-flight action state, stop execution, and exit. |
| Application reopened after crash, exit, or computer restart | Check environment, login, prerequisites, and submitted operations before automatic continuation. User-paused/canceled tasks do not resume automatically. Recovery granularity follows DD07–DD08 and does not include startup at Windows boot. |
| Computer control and ordinary conversation used together | Switching conversations does not terminate tests; one executor occupies system mouse/keyboard and the UI shows occupancy. |
| No usable real external service | Skip corresponding external steps under R25 and continue independently verifiable portions. |

Separate model-request retries from business-action retries. For example, after a timeout following submission, verify the outcome before repeating it and creating duplicates. Manage case data dependencies so deletion tests do not destroy subsequent prerequisites.

Manage test data under R33. For data created this run, record owning run, entity IDs, linked cases, creation grounds, and dependencies. Exclude defect-reproduction and related records from cleanup. Temporarily retain data needed by pending-confirmation/supplemental cases and explain why. Names or timestamps alone cannot establish ownership. Check cascades before deletion; retain and report records with uncertain ownership/effects. Persist results and evidence before cleanup, then save retained-item lists and cleanup outcomes as report supplements. Cleanup uses allowed business entry points, never direct database writes, source/configuration/dependency modifications, or bypasses of real third-party confirmation. For records already removed by deletion flows, preserve necessary preparation/action records; not every defect can be reproduced simply by retaining an existing record.

Sustained execution does not mean operation without power or automatic completion of every SMS/QR authentication. Task states include pending, running, recovering, waiting for user, waiting for business time, paused, frozen awaiting recovery, ended, and canceled. Ended also carries a complete-verification or incomplete-coverage conclusion, not an implicit product pass. Case results separately record passed, failed, blocked, skipped, not executed, and needs confirmation. DD07–DD08 govern transitions alongside R28, R36, R37, and R51. Express execution completion separately from product quality.

Skills and conversation follow these rules.

- Distinguish global and project-linked skills, using DSH format/discovery. Application-owned save locations do not write into tested repositories.
- Ordinary conversations may reference project code, reports, screenshots, and issues; unlinked conversations do not import other projects' materials by default.
- Before changes, show the target skill, scope, changes, reasons, and related evidence. Support accept, accept after editing, reject, and save draft.
- Preserve modification history and rollback. Active runs pin their rule versions; new changes apply to subsequent runs by default.
- Automatic suggestions cannot turn observed faulty implementation into correct expectations or weaken assertions to obtain passes.
- Manage skill workflow knowledge separately from credentials. Storage, referencing, and UI use follow DD03, DD05, and DD11.

R20 retains DSH conversation, session, and knowledge interactions; actual tools remain constrained by R12. Tested-project AGENTS, existing scripts, skills, and page content may supply project knowledge but cannot override source-read-only, external-business confirmation, or result rules. Enforce read-only boundaries in actual file, command, and desktop execution paths; prompts or post-operation diffs alone are not enforcement.

C01 specifies controlled operations under the current Windows account. Permit test browsers, relevant windows such as file dialogs, and validated existing commands. Block/report actions whose source safety cannot be established; do not open arbitrary terminals or desktop control to finish tests. The guarantee covers execution restrictions across all supported tool entry points, not isolation equivalent to separate accounts or OS boundaries. See [DD03](../architecture/2026-09-28-web-testing-design-execution.md) and AC12/G06 for implementation and acceptance.

Candidate model responsibilities follow. Routing changes execution method, not selected test scope or acceptance criteria.

| Work | Candidate approach |
|---|---|
| Code search, diffs, and exact length/amount calculations | Deterministic programs. |
| Requirement inference, complex planning, cross-module analysis | Text models with strong reasoning. |
| Explicit steps whose page state matches | Direct executor action and verification. |
| Action/target selection on the current page | Qualified lightweight structured-decision models; Jev is only a candidate. |
| Business text that must be generated | Small text models; generate ahead and reuse where appropriate. |
| Screenshot understanding, visual anomalies, complex location | Vision models. |
| Difficult failure explanations, report narratives, skill drafts | Text reasoning models with actual evidence. |

Lightweight adapters preserve structured state and bounded action choices, with executor validation. Escalate to a more suitable path on low confidence, incomplete candidates, or repeated lack of progress. Confidence cannot replace assertions. Send only current-task information, avoiding complete source, history, or unrelated page content at every step.

Lightweight outputs are decisions awaiting validation, not direct browser authority. They share controlled execution entry points with vision/text models. Implement integration, logs, retries, and resource lifecycle under DD10–DD11; sample-executor capabilities are not automatically this tool's capabilities.

**Desktop, browser, and display boundaries**

Use official DSH desktop, Host, Client, sessions, tray, and standard exit UI. Add test-specific capabilities through plugins, services, and necessary controlled-execution adapters. The [foundation and upstream upgrades](../process/2026-09-28-web-testing-upstream-baseline.md) document governs versions, rules, and modification registers. Do not use a floating main branch or hot-replace the foundation of active runs.

The embedded browser is the daily primary path. Control standalone Chrome/Edge for flows restricted by embedding, and use controlled Windows execution for necessary native interactions. P01 compares official webview and WebContentsView under equivalent scenarios before selecting a carrier. Do not assume lower maintenance cost or build two complete hosts before choosing.

Standalone browsers supplement application execution and still record steps, evidence, and reports. Hand control to users only for genuinely necessary conditions such as verification/QR codes. Do not assume external login transfers automatically to the embedded browser. Continue related business in the same external session where appropriate and identify the environment. Embedded Chromium, Chrome, and Edge conclusions belong to actual execution environments; changing User-Agent does not constitute another browser's acceptance.

DD02's capability matrix records input/keys, tabs/windows, cross-origin iframes, Shadow DOM, rich text/Canvas/dragging, uploads/downloads, permission prompts, printing, and input methods individually. Do not replace every popup with current-page navigation, count path uploads as native-dialog verification, or treat pasted Chinese as input-method candidate testing. First-release commitments unsupported by the current carrier remain unimplemented capabilities, never silently removed.

Isolate multi-role sessions by project, identity, and case, supporting clean and retained-login states. Recheck prerequisites after browser reconstruction. Before takeover, stop new dispatch and handle in-flight actions; after return, observe again rather than reuse old elements/coordinates. Foreground input/native actions require correct focus, window, and desktop conditions; universal background execution is not promised.

Isolate tested pages from application UI. Pages, frames, and popups must not gain DSH file, model-credential, or desktop IPC permissions. Preserve real web restrictions; do not disable cross-origin protections or ignore all certificate errors to obtain passes.

Official desktop capabilities and applicable layouts govern application size, layout, and UI zoom, retaining window adjustments. Narrow windows may collapse sidebars or switch conversation/browser views; fixed reference sizes must not make controls inaccessible. Handle high DPI and movement between differently scaled displays. Record and convert Windows physical pixels, logical window size, UI zoom, web CSS viewport, and browser zoom separately.

During first project setup or changed requirements, ask at the case stage for viewport width/height and required browser zoom, DPR/display conditions, then save them. Suggest candidates from responsive breakpoints and reuse unchanged confirmations. Application-window or screen dimensions do not automatically define the web-test viewport. Sidebar collapse, resizing, or UI zoom cannot silently change conditions; preview scaling cannot replace real execution at the requested viewport. Record specific gaps when the environment cannot satisfy targets.

Engineering acceptance follows official root and nearest-directory rules at the foundation document's version. Select type, static, behavior, snapshot, build, and documentation checks for the changes; full coverage and platform matrices follow applicable official CI requirements. Never disable rules, fabricate results, or count unexecuted checks as passed to claim compliance. The repository and planning documents are in place; application implementation, runtime checks, and integration validation remain uncompleted.

Tool-delivery acceptance and individual tested-project conclusions are separate. Reporting unverified items is required for truthful results. If a first-release commitment cannot run because the tool lacks capability, that capability remains undelivered; an unverified report alone cannot pass acceptance. [Acceptance criteria](../testing/2026-09-28-web-testing-acceptance.md) map all 58 requirements to behaviors, success/failure scenarios, and evidence; final-candidate acceptance remains pending. Referenced DSH code-coverage requirements apply to developing this tool, not measured line/branch coverage of users' projects.

The [test-case and report specification](2026-09-28-web-testing-test-case-report-spec.md) governs report formats, coverage statistics, defect details, coding-assistant handoff, and pending questions. Implementations may refine layout without removing specified fields or evidence.

In-app conversation summarizes and opens an expandable report. Export offline HTML for users, Markdown and structured JSON for coding assistants, and accompanying evidence. Reports include every case result, defect, coverage gap, and pending question, not just Bugs. Supplemental results cannot overwrite historical reports. Record steps, key screenshots, failure evidence, and related logs by default, with optional full video; retain reports and necessary evidence by default for user-managed cleanup. DD02, DD06, and DD09 define evidence collection.

Before testing a specific project, supply or confirm code/runtime-entry mapping, account roles, environment/data scope, necessary runtime evidence, critical business expectations, viewport, and existing regression baseline. These are project parameters, not renegotiation of the confirmed product scope.

This file defines product requirements. See [development milestones and validation plan](../process/2026-09-28-web-testing-milestones.md) for implementation order and gates, and the [agent development and collaboration guide](../process/2026-09-28-web-testing-agent-guide.md) for responsibilities, file ownership, and handoff.

## Alternatives considered

**Recorded choice.** Treating code as the business oracle or automatically repairing tested code conflicts with confirmed case expectations and the report-only scope.

## Acceptance criteria

Execute this proposal’s normal and failure controls and satisfy the [shared acceptance criteria](../testing/2026-09-28-web-testing-acceptance.md) and applicable task evidence requirements. Documentation migration does not establish a pass.

## Risks

Unknown business expectations and unavailable environments can leave parts unverified; the report must preserve those gaps.
