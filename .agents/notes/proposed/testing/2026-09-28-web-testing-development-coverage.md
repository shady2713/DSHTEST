# Agent Note: Development coverage and handoff

Status: proposed

English | [中文](2026-09-28-web-testing-development-coverage.zh.md)

## Problem

Every acceptance requirement and validation scenario needs one accountable task and retrievable evidence.

## Proposal

Design state: current task mapping. Historical probes and the restricted M1 prototype are distinct from stage admission and final acceptance. Evidence records must distinguish original-baseline results, selected-baseline revalidation, unchanged inputs eligible for reuse, and unexecuted items. This document does not redefine product requirements or passing criteria; the [requirements](../feature/2026-09-28-web-testing-requirements.md), [acceptance criteria](2026-09-28-web-testing-acceptance.md), and [detailed V scenarios](../architecture/2026-09-28-web-testing-design-models-release.md) govern them. See the [coordination guide](../process/2026-09-28-web-testing-agent-guide.md) for development execution.

**Arrange development by dependency**

There are 50 cards: 11 in M0, 7 in M1, 9 in M2, 7 in M3, 10 in M4, and 6 in M5. Each card's prerequisites are authoritative. Dispatch waves, conditions for parallel work, and shared-file ownership are defined in the [coordination guide](../process/2026-09-28-web-testing-agent-guide.md#recommended-execution-waves); this document maintains coverage and handoff assets only, without a separate execution order.

Adjacent stages do not require all work to finish before the next stage's design can be read; actual changes remain subject to task authorization and prerequisites. Do not create separate temporary implementations of creation, commits, targets, actions, or usage merely to enable parallel work and merge them later. The overall critical path still depends on real M0 findings, so no unsupported total duration in weeks is estimated. On entering each card, estimate local implementation, checks, and external waits separately against the actual repository. M0's 72 person-hours are only the initial timebox for eight probes, with preparation and synthesis recorded separately. The 24 hours refer to the final sustained-runtime acceptance check. Neither figure is the duration of the entire project.

**Owners of requirements and product acceptance**

Each requirement has one task responsible for final closure; collaborating tasks own explicit components. The owner must collect collaborating deliverables and cannot close acceptance because its own layer is implemented. M5-T03 owns formal product review for all 58 requirements below. System installation, upgrades, and V07 also reference the actual results of M5-T01, M5-T02, and M5-T04 respectively.

| Requirement / criterion | Content | Owner task | Collaborating tasks | Evidence required for closure |
|---|---|---|---|---|
| R01 / AC01 | Single-user desktop tool | [M1-T06](../process/2026-09-28-web-testing-tasks-m1.md) | M1-T01, M1-T03 | Single-user onboarding, tasks, and history |
| R02 / AC02 | Windows x64 | [M5-T01](2026-09-28-web-testing-tasks-m5.md) | M4-T01, M4-T03 | Real systems, installation packages, and native input |
| R03 / AC03 | DSH foundation and upgrades | [M5-T02](2026-09-28-web-testing-tasks-m5.md) | M1-T01, M5-T05 | Old/new combinations, history, and preflight recovery; recovery updates from frozen runs stuck in old logic and cross-run reconciliation of UNKNOWN |
| R04 / AC04 | DSH engineering rules | [M5-T05](2026-09-28-web-testing-tasks-m5.md) | M0-T01, every implementation card | Actual rules, applicability, and check output |
| R05 / AC05 | Full-project code and general onboarding | [M2-T02](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T01, M2-T03 | Multiple-root, multiple-language snapshots and readability gaps |
| R06 / AC06 | User starts the project | [M1-T06](../process/2026-09-28-web-testing-tasks-m1.md) | M1-T05, M1-T07 | Started URLs and controls showing no unauthorized deployment |
| R07 / AC07 | Automatic requirement inference | [M2-T02](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T03, M4-T06; M0-T09 | Sources, conflicts, and user expectations; three authority categories and critical-rule confirmation |
| R08 / AC08 | Visual checks without design mockups | [M2-T05](../process/2026-09-28-web-testing-tasks-m2.md) | M1-T07, M4-T03 | Normal/deformed controls under the same conditions |
| R09 / AC09 | Complete functional execution | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.md) | M2-T03, M2-T04, M2-T05 | Feature–case–instance–assertion evidence |
| R10 / AC10 | Selecting and entering requirements | [M2-T03](../process/2026-09-28-web-testing-tasks-m2.md) | M1-T06, M4-T08 | One plan for natural language and options |
| R11 / AC11 | Optional specialized testing | [M4-T08](../process/2026-09-28-web-testing-tasks-m4.md) | M4-T09 | Actual execution when selected; no execution when unselected |
| R12 / AC12 | Read-only tested source | [M1-T05](../process/2026-09-28-web-testing-tasks-m1.md) | M2-T06, M4-T01, M4-T06 | Rejection at every actual entry point and independent file checks; dynamic tools, official guidance, and manual-approval paths |
| R13 / AC13 | Mutable business data | [M2-T04](../process/2026-09-28-web-testing-tasks-m2.md) | M1-T05, M2-T07 | Changes to new and existing business data within the declared environment scope |
| R14 / AC14 | Reports without automatic fixes | [M2-T08](../process/2026-09-28-web-testing-tasks-m2.md) | M1-T05, M2-T09 | Defect packages and unchanged source |
| R15 / AC15 | Test history | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.md) | M1-T03, M3-T01, M5-T02 | Actual history, reopening, and old references |
| R16 / AC16 | Automatic recovery of long-running tasks | [M3-T02](../process/2026-09-28-web-testing-tasks-m3.md) | M3-T01, M3-T03, M4-T07 | Persistent retries/reopening for both request paths; paired tool results in failed steps, UNKNOWN reconciliation, and actual continuation |
| R17 / AC17 | No model-cost budget | [M3-T02](../process/2026-09-28-web-testing-tasks-m3.md) | M1-T04, M3-T04 | No cost-based termination and separate payment authorization |
| R18 / AC18 | Task-based model routing | [M4-T07](../process/2026-09-28-web-testing-tasks-m4.md) | M1-T04, M3-T02 | Real lightweight route, common protocol, replacement capability, and calibration; separate A/B/C quality and benefit conclusions |
| R19 / AC19 | User skills | [M4-T06](../process/2026-09-28-web-testing-tasks-m4.md) | M2-T03, M1-T05 | Applicable rules, conflicts, and versions |
| R20 / AC20 | Native conversation experience | [M1-T06](../process/2026-09-28-web-testing-tasks-m1.md) | M1-T04, M4-T06 | Project-linked/unlinked conversations and isolation |
| R21 / AC21 | Skill draft confirmation | [M4-T06](../process/2026-09-28-web-testing-tasks-m4.md) | M2-T02, M3-T01 | Draft diffs, acceptance/rejection, and frozen dependencies |
| R22 / AC22 | Login and takeover | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.md) | M3-T03, M4-T01, M4-T02 | Actual login, manual takeover, and redaction |
| R23 / AC23 | Computer occupancy | [M4-T01](../process/2026-09-28-web-testing-tasks-m4.md) | M3-T03 | Desktop lease, focus, and recovery |
| R24 / AC24 | Logs and read-only data | [M2-T06](../process/2026-09-28-web-testing-tasks-m2.md) | M1-T05, M2-T05 | Business-ID correlation and actual read-only permissions |
| R25 / AC25 | Confirmation of real external actions | [M2-T06](../process/2026-09-28-web-testing-tasks-m2.md) | M1-T05, M2-T04 | Scope, indirect triggers, and reconciliation of unknown sends |
| R26 / AC26 | Natural-language control throughout | [M2-T09](../process/2026-09-28-web-testing-tasks-m2.md) | M1-T02, M1-T06, M3-T03 | Deduplicated creation, actual control, and cards |
| R27 / AC27 | Cases before execution | [M2-T03](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T07, M1-T05 | Timeline showing cases before data preparation |
| R28 / AC28 | New business questions during execution | [M2-T03](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T08, M4-T05 | Question → new case → actual supplemental test |
| R29 / AC29 | Item-by-item execution and coverage | [M2-T05](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T03, M2-T08 | Dynamic denominator and one complete attempt; implementation diagnostics excluded from business passes |
| R30 / AC30 | Case confirmation for new versions | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.md) | M2-T02, M2-T03 | Old/new expectations and confirmation before testing |
| R31 / AC31 | Reports usable by people and AI | [M2-T08](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T05, M5-T03 | Independent person/AI reproduction of fixed fixture defects |
| R32 / AC32 | Backend features without page entry points | [M2-T06](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T04, M4-T04 | Real asynchronous terminal state, beyond request acceptance |
| R33 / AC33 | Data retention and cleanup | [M2-T07](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T08, M3-T01 | Initial report → cleanup → new report and retained materials |
| R34 / AC34 | Reminders only in the owning conversation | [M3-T06](../process/2026-09-28-web-testing-tasks-m3.md) | M1-T06, M3-T01 | Deduplicated reminders confined to the owning conversation |
| R35 / AC35 | Embedded and standalone browsers | [M4-T02](../process/2026-09-28-web-testing-tasks-m4.md) | M1-T07, M4-T01, M4-T03 | Both browser paths and host isolation |
| R36 / AC36 | Window closure and exit | [M3-T03](../process/2026-09-28-web-testing-tasks-m3.md) | M1-T07, M4-T01, M4-T02 | Reused official close/tray/exit behavior; checks include persistent runs in unloaded sessions and distinguish explicit exit from reopening |
| R37 / AC37 | Automatic continuation after reopening | [M3-T01](../process/2026-09-28-web-testing-tasks-m3.md) | M2-T04, M3-T02, M3-T03 | External business reconciliation at critical interruption points |
| R38 / AC38 | Evidence and retention | [M2-T05](../process/2026-09-28-web-testing-tasks-m2.md) | M4-T03, M3-T05 | Originals, video, references, and cleanup |
| R39 / AC39 | Multi-format reports | [M2-T08](../process/2026-09-28-web-testing-tasks-m2.md) | M3-T05, M4-T05 | Offline completeness of three formats at a fixed revision |
| R40 / AC40 | Page viewport | [M1-T07](../process/2026-09-28-web-testing-tasks-m1.md) | M2-T03, M4-T03 | Actual viewport, DPR, and DPI |
| R41 / AC41 | Case completeness checks | [M2-T03](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T02, M4-T09 | Detection and completion of planted omissions |
| R42 / AC42 | Complete flows across entry points | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.md) | M2-T01, M2-T04 | End-to-end flow across clients for the same business record |
| R43 / AC43 | Business concurrency | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.md) | M0-T05, M3-T03 | Conflicts and synchronization with overlapping action times |
| R44 / AC44 | Version changes during testing | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.md) | M2-T02, M2-T08 | Deployment signals/declarations and isolation of changes |
| R45 / AC45 | Selectable regression baseline | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.md) | M2-T05, M2-T08 | Correct selected baseline not replaced by incomplete work |
| R46 / AC46 | Initial-failure retention and bounded retesting | [M2-T04](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T05, M4-T05 | Initial failure, bounded attempts, and unchanged denominator |
| R47 / AC47 | User corrections and dispositions | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.md) | M2-T08, M4-T06 | Disposition reasons, versions, and historical facts |
| R48 / AC48 | Avoiding task interference | [M3-T03](../process/2026-09-28-web-testing-tasks-m3.md) | M4-T01, M4-T03 | Queuing between runs, concurrency within a group, and exclusive desktop control |
| R49 / AC49 | Default fault-recovery testing | [M4-T04](../process/2026-09-28-web-testing-tasks-m4.md) | M2-T03, M1-T05 | Effective injection, removal, and business results |
| R50 / AC50 | Data and file preparation | [M2-T07](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T06, M4-T03 | Actual attachment contents, preparation, and incorrect downloads |
| R51 / AC51 | Business flows over time | [M4-T04](../process/2026-09-28-web-testing-tasks-m4.md) | M3-T03, M3-T04 | Actual elapsed time, windows, and gaps |
| R52 / AC52 | Old-data compatibility | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.md) | M2-T01, M4-T03 | Traceable old records, attachments, and caches |
| R53 / AC53 | Adding cases during execution | [M2-T03](../process/2026-09-28-web-testing-tasks-m2.md) | M2-T02, M2-T04 | Deduplicated discoveries and plans saved before execution |
| R54 / AC54 | Environment declarations and authorization scope | [M1-T05](../process/2026-09-28-web-testing-tasks-m1.md) | M1-T06, M2-T06, M2-T07 | Entry-point declarations, specific authorization, and invalidation on change |
| R55 / AC55 | Space and local-asset management | [M3-T05](../process/2026-09-28-web-testing-tasks-m3.md) | M2-T05, M2-T08, M3-T03; M0-T10, M1-T03 | Warnings, waiting, confirmed cleanup, and shared-reference protection; ordinary Session/fork sharing and actual provider deletion |
| R56 / AC56 | Initial configuration and credentials | [M1-T04](../process/2026-09-28-web-testing-tasks-m1.md) | M1-T06, M3-T02 | Reused official editors and credential services, conversational setup cards, fresh configuration, actual connections, and no secrets in logs |
| R57 / AC57 | Detecting overall lack of progress | [M3-T04](../process/2026-09-28-web-testing-tasks-m3.md) | M3-T03, M3-T06 | Paired stalled/waiting cases and history preserved across restart |
| R58 / AC58 | Runtime status and usage | [M3-T06](../process/2026-09-28-web-testing-tasks-m3.md) | M3-T02, M3-T04 | Request deduplication, unknown usage, and status queries without model calls |

**Owners of official engineering standards**

Applicable requirements run during feature development; they cannot all be deferred to M5. Owners establish mechanisms or close evidence, and all contributors comply. M5-T05 performs final review. New upstream requirements in the actual baseline remain applicable even when absent from an older table.

| Standard | Content | Owner task | Evidence focus for closure |
|---|---|---|---|
| G01 | Rules and entry points | [M1-T01](../process/2026-09-28-web-testing-tasks-m1.md) | loader/rule discovery, M0-T01 baseline, and final M5 entry points |
| G02 | Packages and compilation | [M1-T02](../process/2026-09-28-web-testing-tasks-m1.md) | Actual strict compilation, exports, and dependencies for every new package |
| G03 | Remote interfaces | [M1-T02](../process/2026-09-28-web-testing-tasks-m1.md) | Actual Remote generation, Connection, and cancellation |
| G04 | Plugins and lifecycle | [M3-T03](../process/2026-09-28-web-testing-tasks-m3.md) | Release of all providers, listeners, targets, and processes |
| G05 | Models and replay | [M4-T07](../process/2026-09-28-web-testing-tasks-m4.md) | Main/auxiliary request records, replay, and single retry ownership |
| G06 | Tool execution | [M1-T05](../process/2026-09-28-web-testing-tasks-m1.md) | Tools, PTC, direct services, and native execution points |
| G07 | Authoritative state | [M1-T03](../process/2026-09-28-web-testing-tasks-m1.md) | Creation, locks, commits, old slots, and external reconciliation |
| G08 | Attachments and evidence | [M2-T05](../process/2026-09-28-web-testing-tasks-m2.md) | Official attachments, original bytes, shared-reference protection, and export |
| G09 | Behavior and code coverage | [M5-T05](2026-09-28-web-testing-tasks-m5.md) | Per-file coverage, applicable top-level invariants, and failing controls |
| G10 | Snapshots and SDKs | [M5-T05](2026-09-28-web-testing-tasks-m5.md) | Actual recording, replay, expected output, and relevant SDKs |
| G11 | Types, configuration, and events | [M1-T02](../process/2026-09-28-web-testing-tasks-m1.md) | IDs, Config, events, discriminants, and output boundaries |
| G12 | Persistence compatibility | [M5-T02](2026-09-28-web-testing-tasks-m5.md) | Persistent-type changes, historical reads, and migration failures |
| G13 | Builds and releases | [M5-T01](2026-09-28-web-testing-tasks-m5.md) | Clean builds, artifact smoke tests, and native installation |
| G14 | Formal documentation | [M5-T05](2026-09-28-web-testing-tasks-m5.md) | Formal English/Chinese pairs, JSDoc, catalogs, and budgets |
| G15 | UI and model experience | [M2-T09](../process/2026-09-28-web-testing-tasks-m2.md) | Typed locale, pure presenters, reconnection, and model-facing descriptions |
| G16 | Upgrade evidence | [M5-T05](2026-09-28-web-testing-tasks-m5.md) | Rule changes, narrow modifications, CI, and upgrade semantics; audits of new outbound defaults and first-run configuration |

**Owners of detailed technical scenarios**

V scenarios complement AC/G criteria; one successful ordinary flow cannot replace fault controls. M5-T03 consolidates formal evidence; M5-T04 must perform the actual V07 run.

| Scenario | Content | Owner task | Collaborating tasks |
|---|---|---|---|
| V01 | Page/host isolation | [M1-T07](../process/2026-09-28-web-testing-tasks-m1.md) | M1-T05, M4-T02 |
| V02 | Complex pages and real input | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.md) | M4-T01, M4-T02 |
| V03 | Identity, cross-entry flows, and concurrency | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.md) | M0-T05, M3-T03 |
| V04 | Single writer across Hosts/login sessions | [M3-T01](../process/2026-09-28-web-testing-tasks-m3.md) | M1-T03, M5-T02 |
| V05 | Creation/action/notification interruptions | [M3-T01](../process/2026-09-28-web-testing-tasks-m3.md) | M2-T04, M3-T02 |
| V06 | Pause and late results | [M3-T03](../process/2026-09-28-web-testing-tasks-m3.md) | M3-T02, M4-T01 |
| V07 | Real 24-hour run and numeric budgets | [M5-T04](2026-09-28-web-testing-tasks-m5.md) | M3-T07, M4-T10 |
| V08 | Source protection at every entry point | [M1-T05](../process/2026-09-28-web-testing-tasks-m1.md) | M2-T06, M4-T01, M4-T06 |
| V09 | Native windows, focus, and paths | [M4-T01](../process/2026-09-28-web-testing-tasks-m4.md) | M1-T05, M4-T03 |
| V10 | Lightweight-decision protocol, faults, and recovery | [M4-T07](../process/2026-09-28-web-testing-tasks-m4.md) | M3-T02 |
| V11 | Stale observations, model aliases, and caching | [M4-T07](../process/2026-09-28-web-testing-tasks-m4.md) | M1-T04, M3-T02 |
| V12 | History, cleanup, and export | [M3-T05](../process/2026-09-28-web-testing-tasks-m3.md) | M2-T08, M4-T05, M4-T06 |
| V13 | Windows installation and display environments | [M5-T01](2026-09-28-web-testing-tasks-m5.md) | M4-T01, M4-T03 |
| V14 | Update eligibility, migration, and failure recovery | [M5-T02](2026-09-28-web-testing-tasks-m5.md) | M3-T01, M5-T05; M0-T11 |
| V15 | Environment and authorization changes | [M1-T05](../process/2026-09-28-web-testing-tasks-m1.md) | M1-T06, M2-T06, M2-T07 |
| V16 | Space and reference safety | [M3-T05](../process/2026-09-28-web-testing-tasks-m3.md) | M2-T05, M2-T08; M0-T10 |
| V17 | First-run configuration and credentials | [M1-T04](../process/2026-09-28-web-testing-tasks-m1.md) | M1-T06, M3-T02 |
| V18 | Stalling, waiting, status, and usage | [M3-T07](../process/2026-09-28-web-testing-tasks-m3.md) | M3-T04, M3-T06 |

**Required assets for handoff between stages**

These are logical deliverable names, not a requirement for another general project-management framework. M0-T01 determines actual paths, formats, and generation/maintenance methods under DSH rules. Downstream tasks record the version they read, rather than consuming an unidentified latest file.

| Asset | Initial owner | Later consumers and version requirements |
|---|---|---|
| BaselineManifest / RulesMap / RepositoryMap / CheckPlan | M0-T01; M0-T08 closes | All tasks; reassess applicable checks whenever baseline or directory rules change. |
| ProbeResult / GateDecision | M0-T03–T07 and T09–T11 probe; T08 closes | Separate conclusions for all eight probes; primary-route success does not substitute for effectiveness, asset lifecycle, recovery updates, or other required capabilities. |
| FixtureManifest / independent Oracle | M0-T02; M2-T01 extends; M4-T09 freezes | All acceptance; record versions, seeds, resets, normal/defective controls, and hidden-answer boundaries. |
| ContractRevision / generated Remote | M1-T02 | Runtime, policy, Client, and executors; maintain public signatures in one place. |
| Domain creation, commit, and recovery protocols | M1-T03, M2-T04, M3-T01 | All business writes and notifications; only the single Runtime commits state and facts. |
| Policy / EnvironmentDeclaration / Authorization | M1-T05 | Every actual entry point; validate revision, scope, target, and side effects before execution. |
| SourceSnapshot / Plan / Case / Instance | M2-T02 / T03 | Execution, regression, and reports; current files cannot replace historical references. |
| EvidenceRef / DataLedger / ReportRevision | M2-T05 / T07 / T08 | Reports, cleanup, history, and exports; save materials before publishing references, and keep old reports immutable. |
| RecoveryMatrix / RetryState / ProgressPolicy | M3-T01 / T02 / T04 | M4 extensions and M5; new executors cannot bypass recovery/control gates. |
| ProductEffectivenessProtocol / Result | M0-T09; M2/M4 extend held-out materials | M0-T08 and M5-T03; preregister denominators, independent answers, and human references; obtain fresh held-out evidence after material leakage or tuning. |
| BrowserCarrierDecision / StorageDesignDecision | M0-T03 / T04 | M1-T07 / T03 and later; consume measured comparisons, without automatically inheriting old candidates. |
| AssetLifecycleDecision / reference-retention contract | M0-T10; M1-T03 / M2-T05 establish the foundation; M3-T05 completes | All ordinary Session/fork, report, snapshot, and export consumers; publication and deletion obey the same lifecycle boundary. |
| RecoveryUpdateDecision / FrozenRunManifest / RecoveryLink | M0-T11; M3-T01 / M5-T02 complete | Control, reporting, and installation; old runs are immutable, and changing runs does not clear UNKNOWN. |
| IntegrationSurfaceRegister | M0-T01 creates; all probes update; T08 decides | All contributors and M5-T05; register public extensions, internal patches, alternatives, and upgrade costs separately. |
| ExecutionRecipeRevision / RouteBenefitDecision | M4-T05 / T07 | Model routing and actual execution; fresh observations each run, with integration capability assessed separately from default-route benefits. |
| ResourceBudgetRevision | M3-T07 freezes the current combination; M4-T10 freezes the full combination | M5-T04; numeric limits, load, and reference machine exist before execution; never adjust thresholds afterward to manufacture a pass. |
| Capability matrix and CalibrationRevision | M4-T10 / M4-T07 | Scheduling, reports, and release; maintain capability status only in DD02 and revalidate model/route changes. |
| ReleaseCandidateId / BOM / acceptance results | M5-T01–T05 | M5-T06; final artifacts, configuration, and valid evidence refer to the same combination. |

**Task progression and rework rules**

Maintain actual progress in the single task record selected by M0-T01. These documents currently remain plans; do not hand-maintain three competing progress versions in the coordination guide, cards, and tables. On task completion, hand off in the coordination format and select the next card under these conditions:

1. Formal task admission requires user-authorized scope and accepted prerequisite deliverables. Explicitly authorized restricted prototype work may continue before admission, with its gaps and limits recorded; it does not satisfy missing prerequisites. Within authorized scope, the main agent may dispatch without permission for each card. M0-T08 may consolidate gaps; M0-T09 may consume M0-T07's accepted primary-route component while the lightweight component remains incomplete. None of these arrangements accepts unverified capabilities.
2. The current shared-file editor has handed off, and the workspace has no unexplained conflicts. Read-only source boundaries and protection policies come from the actual version, not an old summary alone.
3. When devices, credentials, or external availability are missing, retain the external dependency and resumption conditions, and continue authorized tasks that do not depend on them. Do not invent passes or remove deliverables.
4. Return defects to their owning tasks for repair and retain failure evidence. Notify actual consumers of public-contract changes and run checks for the affected scope. Do not fix failures by changing the Oracle or weakening acceptance.
5. Record a new identity when a candidate build changes, identifying which previous evidence remains valid and which must be rerun. Evidence tied to a specific combination, such as the 24-hour run, cannot be freely added across candidates.
6. Do not announce product completion when a required product item fails or remains unexecuted, or an applicable engineering check lacks evidence. A tested project's report may contain unverified items; this is separate from this tool's own delivery acceptance.

## Alternatives considered

**Recorded choice.** Separate progress ledgers or closing an acceptance item when only its implementation layer finishes would obscure final-combination gaps.

## Acceptance criteria

Execute this proposal’s normal and failure controls and satisfy the [shared acceptance criteria](2026-09-28-web-testing-acceptance.md) and applicable task evidence requirements. Documentation migration does not establish a pass.

## Risks

A complete mapping does not establish a pass; evidence must refer to the accepted implementation and applicable final candidate.
