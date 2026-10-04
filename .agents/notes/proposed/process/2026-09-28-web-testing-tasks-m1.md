# Agent Note: Development Tasks: M1 Foundation Assembly

Status: proposed

English | [中文](2026-09-28-web-testing-tasks-m1.zh.md)

## Problem

The official desktop needs the minimum shared application foundation before test execution is added.

## Proposal

Delivery state: an identity/entry prototype exists at packages/web-test/web-test; M0 and complete M1 admission remain unaccepted. The user has withdrawn the instruction to wait for an upstream embedded carrier. The development-admission table below permits foundation implementation beyond prototype diagnostics, subject to each sub-item's prerequisites. Task interfaces, change ownership, independent review, checks, and handoff formats follow the [Agent Development and Collaboration Guide](2026-09-28-web-testing-agent-guide.md). Change ownership must resolve to real paths through RepositoryMap and be registered when work is dispatched. A prerequisite is complete when its deliverables have been accepted by both the consumer and an independent reviewer; committing code or verbally declaring completion does not satisfy it, except for the explicit sub-item dependencies below.

This stage contains 7 cards. Foundation sub-items follow T01-A → T02-A → T03-A, then T04-A/T05-A in separate files, then T06-A. Complete-card dependencies and T07's browser prerequisites still apply to full acceptance. All business operations use only official services and the single Runtime; engineering checks accompany each implemented sub-item.

<a id="development-admission"></a>

**Development admission before complete M0 acceptance**

This table owns the limited development permission. M0-T08 records it immediately as a not-passed decision with permitted sub-items; the record does not require a new user approval for every card. The integrator verifies prerequisites, records evidence and file ownership, and dispatches eligible work. Missing evidence blocks that sub-item or its affected calls, not every independent foundation task. No row is marked complete by this planning change; unchanged inputs are required to reuse prior checks. Full M0 acceptance, complete-card acceptance, and the M1 exit gate remain separate.

| Sub-item | Required evidence before dependent implementation | Permitted work and observable completion | Work still withheld |
|---|---|---|---|
| M1-T01-A | Confirmed baseline and RepositoryMap; this limited admission recorded in M0-T08 | Implement the application's profile and actual identity/data-root/configuration isolation; verify Loader activation, uninstall, and ordinary-model requests with/without the plugin. Verify application egress restrictions before using the application. | Browser integration and complete T01 acceptance await their M0 prerequisites; metadata fields alone do not establish isolation. |
| M1-T02-A | Accepted T01-A service locations and an identified current consumer | Define only IDs, schema, errors, and generated Remote calls needed by configuration, project metadata, storage, and policy; demonstrate an actual Client/Host call and invalid-input rejection. | Unconsumed Target/Broker APIs and speculative terminal-state schemas. |
| M1-T03-A | Accepted T02-A persistence definitions and current P02 evidence, including applicable local storage-fix regressions | Implement minimal metadata persistence through storage domains, idempotent creation, strict reads, and an outbox; verify reopen, interrupted publication, redelivery, and actual Windows single-writer exclusion. | Browser action dispatch and claims that attachment coordination is complete. |
| M1-T04-A | Accepted T02-A/T03-A inputs and current evidence for the main model route | Reuse official credential/configuration services, complete a real connection, persist route identity, and verify invalid credentials and secret handling. | Declaring an unverified model capability ready or treating one connection as full P05 acceptance. |
| M1-T05-A | Accepted T02-A/T03-A inputs and an inventory of the actual enabled call paths | Implement protected paths, environment declarations, and authorization; demonstrate denial through every enabled entry, including direct calls and hot-enabled tools. | Enabling a new executor before its actual enforcement and denial tests exist. |
| M1-T06-A | Accepted T03-A/T04-A/T05-A services | Connect ordinary chat, project/source-root/URL registration, metadata queries, and reopen; isolate project context and show unimplemented actions as unavailable. | Claims of logged-in page identity, browser observation, or executable tests without their evidence. |
| M1-T07 and browser-dependent parts of T01–T06 | Accepted P01 carrier/Broker decision, applicable P03 evidence, complete M0 admission, and the card's consumer prerequisites | Implement the original browser card and its positive/negative controls after those prerequisites are met. M0-T03's bounded probe itself remains separately authorized. | Product browser actions and complete M1 acceptance before the required evidence. |

For T03-A, implement the first real attachment consumer and P07 retention/reference coordination together when needed, with publication/deletion race controls and conservative retention of unknown references. This bounded integration may establish the missing evidence; destructive cleanup remains disabled until all reference owners are covered. Metadata-only progress must not claim the entire attachment part of T03 is complete. Likewise, enabling ordinary chat in T01-A requires its composition restrictions immediately; T05-A later extends and verifies the shared policy across the enabled calls.

Each sub-item handoff records its exact scope, accepted prerequisites, changed files, normal and failure-control evidence, remaining full-card conditions, and independent reviewer. A browser finding invalidates only affected evidence and dependent work. Final M1 acceptance still requires every original card and stage condition below; limited admission neither reduces the product scope nor authorizes M2–M5 wholesale.

**M1-T01: Reuse the Official Desktop and Assemble the Testing Plugin**

**Objective:** Establish a minimal application structure that starts and unloads through the actual DSH entry point.

**Prerequisites:** Complete `M0-T08` admission for full-card acceptance; T01-A may start under the development-admission table before that result.

**Reading:** DD01/DD05, TD01/TD10, G01/G02/G04/G13. Read M0-T08's current effectiveness, integration-cost, and limited-admission decision. Confirm the relevant P06–P08 gates before full-card acceptance; do not infer them from T01-A completion.

**Change ownership:** The application's profile/bundle, Client plugin, and necessary package manifests; retain the M0 RepositoryMap.

**Work allocation:** The lead integration agent owns the profile, package manifests, and build entry points. The Client subagent edits only the designated testing plugin and typed locale, without creating a second window/chat framework.

**Steps:**

1. Follow the official new-package workflow to create only the assembly currently needed, without pre-creating every eventual package. Check workspace dependency scopes and prohibit new as unknown assertions. The existing identity prototype's dataRootName/profileName fields do not change DSH_HOME or the desktop profile. Implement and verify actual separate identity, data-root, and configuration selection before claiming isolation, while preserving the official default product.
2. Reuse official windows, chat, layout, shortcuts, tray, and standard exit UI, adding only testing entry points, business cards, and necessary browser integration; do not copy the desktop framework. Put product text in typed locale; explicitly show actions as unavailable when backend capabilities are missing. Do not assemble the upstream unrestricted sidebar terminal or its services; ordinary chat remains available.
3. Before this application's first startup, explicitly disable desktop-product-telemetry and product-analytics collection/export in its composition. Verify the effective profile, destinations, queues, and exporter state under DD12; the selected desktop baseline enables both. Check ordinary feedback, model requests, target networking, updates, and onboarding separately instead of inheriting official production collection or release destinations.
4. Give registration/release one owner. Verify actual Loader resolution, active-package manifests, and source/artifact exports; direct ctx.plugin assembly alone is insufficient. Compare real ordinary-model requests with and without web-test using one profile/build. Diagnose REQUEST_EXTENSION as described in DD11. T04/T06 still own the final conversational integration; assembly alone does not deliver chat.

**Deliverables:** A startable application profile, package dependency/ownership map, and assembly/unload evidence. T02 through T07 implement within this structure.

**Handoff:** T02 receives loadable definition and service locations. T04/T06 reuse official UI entry points, and T07 reuses the selected browser hosting location.

**Normal acceptance:** The actual desktop loads the application's plugin without overwriting the official default product or its configuration; unloading leaves no registrations behind.

**Failure controls:** Missing dependencies, incorrect configuration, and duplicate assembly fail deterministically. Do not “pass” using source fallback or old build artifacts.

**Stop conditions:** Withhold full-card acceptance and browser-dependent integration while their M0 routes remain unapproved; continue eligible foundation sub-items under the development-admission table. Reject any route requiring a copied Agent loop or Loader bypass.

**M1-T02: Shared Identifiers, Domain Schema, and Remote Contracts**

**Objective:** Establish a single type boundary for Runtime, Client, policy, and executors.

**Prerequisites:** `M1-T01` for full-card acceptance; T02-A consumes accepted T01-A under the development-admission table.

**Reading:** DD01/DD05/DD06, G02/G03/G11/G15.

**Change ownership:** The web-test definition package, service declarations, necessary generation sources, and their tests.

**Work allocation:** The contract subagent proposes types required by actual consumers. The integrator freezes ContractRevision and performs generation separately. Runtime and Client owners each check consumption examples without editing shared schema concurrently.

**Steps:**

1. Define the branded IDs, revisions, schema, command identities, states, and error discriminants currently consumed. Separate planning/execution/assertion/report identities; do not prebuild every future API.
2. Expose business operations and queries through Typert Remote/RemoteScope and generate Client types and runtime descriptions through the official workflow. Do not introduce business Electron IPC or handwritten mirror DTOs.
3. Explicitly assign cancellation, event subscriptions, and release to callers. Tool parameters exposed to models include only task-required information; results, including wrappers and multibyte text, obey output limits.
4. Declare expected-result basis/diagnostic fields and recovery-freeze associations based on actual consumers. Attachment lifecycle work consumes the contract validated by P07 rather than assuming a deletion method already exists.

**Deliverables:** ContractRevision, Remote interfaces and generated artifacts, an error table, and request-deduplication/event conventions for direct use by T03/T05 and Client.

**Handoff:** T03/T05 receive generated, runnable interfaces. Any downstream field addition goes through the same contract owner; temporary any or mirror DTOs must not be used to unblock work.

**Normal acceptance:** After Host generation, Client compiles cleanly and completes a real call. Schema parses boundary values and errors remain distinguishable.

**Failure controls:** Invalid IDs/extra branches, out-of-bounds results, handles used after unloading, and old-interface calls are rejected. Type-only files must not introduce runtime side effects.

**Stop conditions:** Fix the contract first if generated files need manual edits, shared types must be copied, or cancellation ownership is unclear. Return product-semantic conflicts to the corresponding design.

**M1-T03: The Sole Domain Writer and Minimal Durable State**

**Objective:** Establish the persistence authority that every subsequent testing action must use.

**Prerequisites:** `M1-T02` for full-card acceptance; T03-A consumes accepted T02-A and P02 evidence under the development-admission table.

**Reading:** DD06/DD07/DD09, P02 conclusions, G07/G08/G12, V04/V05.

**Change ownership:** Domain services in web-test-runtime, actual storage domain declarations, and compatibility records.

**Work allocation:** The persistence subagent exclusively owns Runtime repositories, the control root, and commit code. The attachment owner supplies ticket adapters for the integrator to merge under the contract. An independent reviewer checks counterexamples for locking/recovery.

**Steps:**

1. Obtain the control root's stable identity and a Windows exclusive lock. Lock identity must not change with application identity or data generation, must cover aliases and different login sessions, and cannot be taken over merely because a timeout expires.
2. Implement creation reservations/child records/entry publication and necessary Heads according to the M0 decision. Runtime alone commits business state; Session retains its existing session authority. Resent commands return the same result.
3. Prepare attachments and other long I/O outside small control commits and recheck expected versions before committing. Establish minimal facts, an outbox, and strict reads; do not prebuild an unjustified large event framework.
4. Consume StorageDesignDecision to implement the smallest qualified structure and establish durable retention tickets and reference-publication foundations under P07. Ordinary Session/fork integration belongs to official consumers; Runtime's single-writer assumption cannot replace coordination across all references.

**Deliverables:** Domain repository APIs, commit/creation protocols, initial recovery evidence, and real durable-history samples for model configuration, project, and executor consumers. Preserve the history samples as the starting point for F4.

**Handoff:** T04–T07 receive real durable APIs and failure semantics. M2-T04 uses the same action-intent interface; F4 retains this stage's actual data.

**Normal acceptance:** Creation, closure, and reopening return the same entity. Two Hosts sharing a root have only one writer, and results publish only after successful commits.

**Failure controls:** Interrupted entry publication, duplicate commands, corrupted schema, and attachments not yet persisted cannot create extra entities or false completion. Failed exclusivity cannot open a second write channel.

**Stop conditions:** Stop dependent implementation and review P02 if it relies on nonexistent transactions, direct SQL, or cannot prevent concurrent writers.

**M1-T04: First-Run Model Configuration and General Routing**

**Objective:** Let users securely complete initial configuration within a session and provide capability-matched routes for analysis, vision, and auxiliary requests.

**Prerequisites:** `M1-T02`, `M1-T03` for full-card acceptance; T04-A consumes their accepted foundation sub-items and main-model evidence under the development-admission table.

**Reading:** DD05/DD11, R17/R18/R56, AC56, V17, G05/G15; M0 main-model conclusions.

**Change ownership:** Client configuration cards, official configuration services, and ctx.llm routing consumers; reuse the foundation's credential mechanism.

**Work allocation:** The model subagent owns routing and official configuration reuse; the Client owner provides card extension points. Work may run in separate directories alongside T05. The integrator merges credential-service and shared configuration-schema changes.

**Steps:**

1. First inventory reusable exports from the official model editor, secret-input controls, and credential service. Configure through sessions and cards, adding only thin adapters when necessary rather than a new credential store. Verify a valid alternative when official controls cannot be embedded directly; do not silently replace the sole entry point with a standalone settings page. Configure providers, models, and capabilities; secrets must not pass through chat messages, tool presentations, or exports.
2. Test real connections using the RC's DeepSeek Messages-only configuration and each other provider's own protocol. Reject old DeepSeek protocol configuration and distinguish invalid keys, unavailable models, modality mismatches, and transient errors. Select a valid alternative when no lightweight decision model is configured; remain unready if required capabilities are missing.
3. Select configured capabilities by task type and save versions/actual selections. Revalidate routes affected by rc.2's provider dependency and catalog changes through actual requests; catalog membership is not connection or capability evidence. Enable toolUpdate, caching, and modality capabilities only as declared by the actual adapter; do not claim identical caching benefits across providers. Replacing or deleting credentials puts affected tasks into recoverable waiting, without deleting tasks or silently switching models for in-flight requests.

**Deliverables:** A secure configuration flow, RoutePolicyRevision, real connection evidence, and credential-lifecycle results. M2 analysis and M3 retries consume the same entry point.

**Handoff:** T06 receives configuration actions callable from a session. M2-T02/M3-T02 receive stable RoutePolicyRevision, error classification, and credential-invalidation events.

**Normal acceptance:** A fresh data directory can complete a real main request. A valid configuration without a lightweight decision model works and records the actual model.

**Failure controls:** Incorrect credentials/modality mismatches have recoverable explanations. Check chat, logs, errors, and exports for raw keys; deleting active credentials must not lose tasks.

**Stop conditions:** Do not mark configuration ready with only fake connections, if keys must be placed in ordinary messages, or if the main route has not passed M0.

**M1-T05: Read-Only Protection, Environment Declarations, and Authorization Primitives**

**Objective:** Establish policy that every call path must obey before the first business change.

**Prerequisites:** `M1-T02`, `M1-T03` for full-card acceptance; T05-A consumes their accepted foundation sub-items under the development-admission table.

**Reading:** DD03/DD04/DD07, R12/R25/R54, AC12/AC54, V08/V15, G06.

**Change ownership:** web-test-policy, actual tool/command execution entry points, and domain authorization records.

**Work allocation:** The policy subagent exclusively owns policy decisions and pre-execution interception. An independent reviewer designs controls for tools enabled during a session and approvals exceeding scope. When working alongside T04, do not edit the same profile/schema.

**Steps:**

1. Register source roots under test and resolved protected paths, explicitly defining upload/download/temporary-material directories. Check links, replacements, and unknown commands; prohibit arbitrary shell, editor, and unrestricted desktop entry points.
2. Define environment declarations, data scopes, and revisions for each entry point. Testing authorization does not apply to production/unknown environments. Specific workflow authorization includes records/counts/valid scope and becomes invalid for revalidation when the environment changes. Third-party authorization exists separately.
3. Make ordinary chat, Skills, PTC, MCP, direct services, retries, and future native executors share pre-execution decisions that cannot be weakened. Official approval applies alongside these restrictions; the model is not the sole gatekeeper.
4. Cover tools enabled during a session, official onboarding enabling coding tools, Creator/default-preset changes, and human approval after automatic review rejection. In rc.2, disabling `developerTools` does not remove Creator or default-preset selection; verify actual composition and pre-execution policy rather than relying on UI visibility. Include existing Windows ACL diagnostics in the enabled Skill inventory. Approval can permit only product-allowed actions; it cannot override hard restrictions such as read-only source code or the prohibition on arbitrary terminals/editors.
5. Keep required business confirmation separate from the user-question wait state. Timeout, pending, skipped, and cancelled questions grant no authorization. Validate a late answer against its call/question, proposed action, and current project/environment/plan revision before accepting explicit authorization; reject stale or mismatched answers and clarify again when required. Independent work may continue while the dependent action remains blocked.

**Deliverables:** The PolicyDecision contract, EnvironmentDeclaration/ActionAuthorization records, and a cross-entry denial matrix for display by T06 and use by every executor.

**Handoff:** T06/T07 call only validated PolicyDecision. Every new executor in M2/M4 registers its integration point and denial evidence, without implementing a more permissive copy.

**Normal acceptance:** After confirming a test environment, in-scope business actions can receive permission. Read-only observation does not require invented production-write authorization.

**Failure controls:** Source writes, out-of-scope data, expired authorization, production preparation/cleanup, and indirect message sending cannot all pass under one authorization. Creator/default changes cannot bypass these restrictions; timed-question expiry or stale replies cannot authorize an action. Independently check files and business state.

**Stop conditions:** Block the specific action if its effects cannot be determined; do not remove protection. Changes to protection levels require a user decision.

**M1-T06: Native Chat, Project Onboarding, and Session Commands**

**Objective:** Establish the natural-language entry point for daily use, with or without an associated project.

**Prerequisites:** `M1-T03`, `M1-T04`, `M1-T05` for full-card acceptance; T06-A consumes their accepted foundation sub-items under the development-admission table.

**Reading:** DD04/DD05, AC01/AC06/AC20/AC26/AC54/AC56, G03/G15.

**Change ownership:** Client sessions/cards, project domain services, native Agent assembly, and Remote callers.

**Work allocation:** The Client subagent owns session commands and cards; the project-service owner owns material identity. The lead agent integrates both into the official Agent without allowing natural-language parsing to execute side effects directly.

**Steps:**

1. Connect native DSH ordinary chat, exposing controlled tools according to current context. Use the current UI host, selected-Session, and main-panel visibility interfaces for the actual seats; do not reconstruct the removed SidebarRightBinding API. Without an associated project, do not read or reuse another project's private context.
2. Accept multiple source roots and already running URLs. Record reachability, login/environment declarations, and additional user requirements. Retain unreachable entries; do not independently install dependencies, start, or deploy the project under test.
3. Define mappings from natural language to typed commands for queries, case generation, start, pause, resume, and cancel. Explicitly mark actions not implemented in this stage as unavailable. Cards and text use the same Remote; status queries cannot start tests.
4. Record the actual `tool-ask-user` mode; omitted configuration and `mode: legacy` remain blocking, while timed mode requires explicit selection. Use the official question/answer path and T05's validity decisions. If timed mode is selected, verify timeout/pending, reconnect/reopen, late answers, cancellation, and duplicate delivery without inventing authorization or a tool result for a completed call. Keep the dependent action waiting until valid explicit confirmation exists.

**Deliverables:** Project onboarding flow, command parsing and session cards, and real chat/project-isolation evidence. M2 integrates cases and runs here.

**Handoff:** T07 consumes the project panel and URL/role states. M2-T02/T03/T09 consume project inputs and typed commands; query and execution entry points remain distinguishable.

**Normal acceptance:** Users can onboard projects and correct URLs/declarations through chat, then reopen the same information. Ordinary chat works independently.

**Failure controls:** Ambiguous start commands trigger specific clarification. Bad addresses, missing materials, and absent project context cannot produce invented readiness; queries cause no business changes. An unanswered timed question permits only independent work; stale answers after a project/environment/plan change cannot start an action.

**Stop conditions:** Fix the entry point first if use requires a traditional large configuration wizard, chat bypasses policy, or cards bypass domain services.

**M1-T07: Embedded Browser Observation, Identity, and Viewport**

**Objective:** Deliver a secure actual browser-observation foundation using the same provider for M2 actions and M4 complex-capability extensions.

**Prerequisites:** `M1-T02`, `M1-T03`, `M1-T05`, `M1-T06`, the accepted P01 carrier/Broker route, applicable P03 evidence, and complete M0 admission. Foundation sub-item admission does not satisfy these browser prerequisites.

**Reading:** DD02 and its capability matrix, DD03, AC35/AC40, V01, P01/P03.

**Change ownership:** The single web-test-browser provider, necessary TargetBroker/desktop changes, and observation panel.

**Work allocation:** The desktop subagent owns targets and observation. A read-only reviewer checks isolation; the integrator handles the Host protocol. Integrate the panel after T06 completes rather than using temporary UI assumptions as prerequisites.

**Steps:**

1. Through the validated Broker, establish the Electron carrier selected by BrowserCarrierDecision. Observe DOM/AX/original images and record the target, document/frame, observation generation, and browser version. Do not give pages the control plane inside the Host.
2. Identity partitions include the run, activation generation, and role context; release them at lifecycle end. Record viewport separately from desktop window and DPI; resize requires a fresh observation.
3. Connect T06's project panel to display the real page and observation gaps. Measure initial managed-process resources to propose budget values; read-only observation does not count as full interaction support.

**Deliverables:** BrowserObservation/TargetHandle contracts, target-resource lifecycle evidence, observation UI, initial ResourceMeasurement, and links to corresponding DD02 statuses.

**Handoff:** M2-T04 receives observation interfaces containing identity and generation. M4-T01/T02 extend the same provider; resource measurements go to M3-T07.

**Normal acceptance:** Page, frame, viewport, and screenshots correspond. Reopening reacquires a target; host isolation does not incorrectly block legitimate cross-origin business flows.

**Failure controls:** Old tokens, replaced DOM, incorrect application-window IDs, and page access to the host control plane receive no permission. Incomplete observation cannot be reported as complete.

**Stop conditions:** Do not enable downstream actions if they depend on a global debugging port, a shared personal browser profile, or lack actual isolation evidence.

**Stage Handoff Gate**

Complete secure configuration, ordinary chat, project onboarding, environment declarations, and page observation from the actual desktop, with information readable after closure. Boundary-violation and leakage controls work. T06/T07 integration and baseline resource measurements must be complete; an empty UI cannot substitute for stage acceptance. Preserve actual history produced here for later compatibility validation.

## Alternatives considered

**Recorded choice.** Rebuilding general configuration or pre-creating every eventual package would duplicate ownership before consumers are known.

## Acceptance criteria

Execute this proposal’s normal and failure controls and satisfy the [shared acceptance criteria](../testing/2026-09-28-web-testing-acceptance.md) and applicable task evidence requirements. Documentation migration does not establish a pass.

## Risks

A working shell does not prove policy enforcement or source protection; consumers must use the accepted shared interfaces.
