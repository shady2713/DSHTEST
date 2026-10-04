# Requirement mapping: dsh-plugin-web-test

Status: proposed

[English](2026-10-04-web-test-plugin-requirement-mapping.md) | 中文

## 0. Retraction

**"S0–S6 are all complete" is withdrawn.** The delivery phases were named as though each were finished; only S0 was measured end to end. A requirement that is *recorded as not implemented* is not a requirement that is met, and this table no longer treats a documented gap as progress toward completion. Nothing below narrows a requirement or relaxes its completion condition to make a row look finished.

The business inventory stays [product requirements R01–R58](../feature/2026-09-28-web-testing-requirements.md); the delivery sequence stays the [installable plugin plan](../architecture/2026-10-04-web-testing-installable-plugin-plan.md) S0–S6; case and report fields stay in the [test-case and report specification](../feature/2026-09-28-web-testing-test-case-report-spec.md).

### Status values

| Value | Meaning |
|---|---|
| **implemented, verified** | The behaviour exists and a check produced evidence on a real host. |
| **implemented, unverified** | The behaviour exists and is covered by the package's own tests, but no host run has exercised it. |
| **partially implemented** | Part of the requirement's behaviour exists; the rest does not. |
| **not implemented** | No code path serves this requirement. |
| **host-limited** | Unmodified DSH exposes no public interface for it, and the trade-off is recorded in §5. |

### Platform basis

Two platforms appear in this table and they are not interchangeable.

- **Ubuntu 24.04 / Node 24.15.0 / pnpm 11.7.0, unmodified DSH 0.2.0-rc.2** — the host evidence in §4, all gathered before this round.
- **Windows, this round** — the package's dependency install, `tsc`, the bundle, the Typert generation and 68 unit tests all ran and passed. **No DSH host run happened this round**, so no requirement gains host evidence from it. The machine's installed `dsh` is `0.1.5-rc.1` while the package declares `0.2.0-rc.2`, so the installed-artifact acceptance could not be run against the compatible host.

## 1. Product boundary and environment

| ID | Requirement | Phase | Status | Evidence or note |
|---|---|---|---|---|
| R01 | Single-developer desktop app, no team features | S1 | implemented, verified | The durable schema holds projects, environments, runs, results and operations. `roleSchema` names a test account the operator declared, not a team member; nothing in the store or the Remote models membership. |
| R02 | Windows 10 22H2 or later, x64 | S6 | implemented, unverified | This round's build and unit tests ran on Windows, so the sources compile there. Host installation, `dshHomePath` permissions, browser discovery and teardown order remain unexercised; see §7. |
| R03 | Reuse the DSH base and the official desktop route | S0 | implemented, verified | Installs through the plugin manager into a profile from `dsh --from-default-profile web`; host binaries unmodified. |
| R04 | All first-party code follows DSH engineering rules | throughout | partially implemented | Strict `tsconfig` under both faces, plugin export conventions, registrations as effects, locale-owned Client copy, and a test suite added this round. The repository's own `lint`, `hygiene` and `duplication` gates do not cover this out-of-tree workspace and have not been run against it. |
| R05 | The user supplies the whole project codebase | S2 | partially implemented | The project record carries `sourceRoot`, but nothing ingests, indexes or bounds the tree. |
| R06 | The user starts the system under test | S2 | partially implemented | The project record carries `baseUrl`; nothing checks that it answers, and the plugin neither deploys nor installs. |
| R07 | Derive requirement understanding from code, separating rule provenance | S2 | not implemented | Needs a three-way split: confirmed business rule, applicable general rule, implementation inference. No record type or tool exists. |
| R08 | No design mockups; visual checks discover issues from the live page | S3 | partially implemented | Evidence is a real page screenshot and no mockup comparison exists. Discovering an issue from the page still depends on the unimplemented case analysis in R27. |
| R09 | One concentrated pass covering all functionality | S3 | not implemented | A goal, not a mechanism: there is no coverage denominator the plugin computes or reports. |
| R10 | Test scope and requirements entered in natural language | S2 | partially implemented | The conversation is the entry point and the settings section holds only project and environment parameters. No scope is captured as a record. |
| R11 | Load and security testing opted into separately | S4 | not implemented | `policyRecordSchema` carries `failureSimulation` only. There is no load or security test type, opt-in or parameter set. |
| R12 | Test only; never modify the system under test | S0/S3 | implemented, verified | Enforced at dispatch: with `@deepseek-ai/dsh-tool-bash` present in the composition, the model's call was denied. The allowlist and its denial wording are now also unit-tested. |
| R13 | Test-environment business data may be created, changed, deleted | S4 | partially implemented | This round added the durable operation lifecycle and the environment-scoped role gate. Creating and changing are covered; **deleting test data (R33) is not implemented**. |
| R14 | Produce reports, never auto-fix | S3 | implemented, verified | No code path writes back into the system under test, and the report is derived from recorded results only. |
| R15 | Keep test history for regression and retest | S3 | implemented, verified | Runs, case results and operations persist and read back after a process restart. |
| R16 | Long-running tasks recover and retry | S4 | partially implemented | This round added restart reconciliation: an interrupted run waits for a deliberate continuation and an in-flight operation becomes `unknown`. **Retry is deliberately never automatic**, and model/network retry stays host-owned. |
| R17 | No model spend ceiling | — | host responsibility | The plugin sets no threshold and states none. Out of the plugin's scope by requirement. |
| R18 | Route models per task | S1/S3 | partially implemented | `environmentRevisionRecordSchema.modelRef` exists and is never applied; no second credential system, no self-selected routing. |
| R19 | User-configurable skills | S2 | not implemented | The plugin defines no skill format and no skill surface; it relies on the host's discovery. |
| R20 | Keep the native DSH conversation experience | S0 | implemented, verified | Normal sessions stay `standard`; `web-test` is a sibling opt-in preset, and a non-web-test session's tools were measured to run normally while a test run was paused. |
| R21 | Propose skill improvement drafts, effective only after confirmation | S4 | not implemented | No draft record, no confirmation step, and no guarantee that a rule in effect is never rewritten. |
| R22 | Multiple login methods and human takeover | S4 | not implemented | A role is a declared name plus a host credential reference; no login, no takeover, and no per-role browser context. |
| R23 | May use a dedicated computer for testing | S4 | host-limited | Unmodified DSH exposes no separate controlled computer-control entry. See §5.3. |
| R24 | Supplementary run evidence (logs, read-only database checks) | S3 | not implemented | No per-project evidence path configuration, and availability is never inferred from having source code. |
| R25 | Confirm before real external business actions | S4 | partially implemented | `policyRecordSchema.externalActions` exists and the operation lifecycle is the enforcement point, but **no confirmation gate is wired to it**: nothing consults the field before a dispatch. |
| R26 | Natural language drives the whole test run | S2/S3 | partially implemented | The settings section works. In-conversation plan, progress, question and report surfaces are not built. |
| R27 | Generate cases before executing | S3 | not implemented | There is no case or case-revision record at all. `report_case` writes results against a `caseKey` string the model supplies, with nothing to confirm the case existed first. |
| R28 | Skip cases blocked by new business questions | S3 | not implemented | A `blocked` outcome is recorded per case, but nothing decides which cases a new question suspends. |
| R29 | Execute every case against all functionality | S3 | not implemented | No case set exists, so no completeness statement is possible. |
| R30 | Confirm case updates before a new version starts | S3 | not implemented | No case revision or baseline snapshot exists to confirm against. |
| R31 | Reports serve users and coding assistants | S3 | partially implemented | This round added HTML, Markdown and JSON from one derivation. **No coding-assistant import path exists**: a report can be read by a person, not loaded into a coding session. |
| R32 | Cover backend functions with no page entry | S3 | not implemented | No enumeration of backend functions, so a missing entry point is never listed as unverified. |
| R33 | Keep defect data, clean other newly created data | S4 | not implemented | No cleanup plan, no record of what a run created, and no deletion through business entry points. |
| R34 | Reminders only inside the owning session | S4 | partially implemented | This round made run ownership explicit (`ownerSessionId`) and scoped holds to it, so one session's work cannot be stopped by another's. No reminder surface exists. |
| R35 | Built-in browser first, standalone browser as supplement | S0 | implemented, verified | Superseded by the plan's decision to drive external Chrome/Edge first. Measured: system Chrome 147 launched through the official Playwright MCP provider, navigated, and returned a real screenshot. |
| R36 | Closing the window does not stop background testing | S4 | host-limited | Split as the requirement asks. **DSH host still running, page or window closed:** served by the host's own background execution, measured on the host side, with no plugin work. **DSH host exited:** the new scheme persists the run and reconciles on the next start — implemented this round (unit-tested), no host run. A separate daemon was not added and DSH was not modified. |
| R37 | Verify and resume automatically after reopening | S4 | partially implemented | This round reconciles on open and requires an explicit continuation rather than resuming blindly. **The eligibility checks it depends on — re-checking environment, login and already-submitted operations — are not implemented**, so there is no automatic path at all. |
| R38 | Record and retain evidence by default | S3 | implemented, verified | `evidence/<runKey>/` under the plugin's own data root, measured at 0700; a stale file is refused and a fresh one is copied on receipt. |
| R39 | In-app report plus multi-format export | S3 | partially implemented | This round added HTML, Markdown and JSON from one source, with the HTML escaping a case's own words. **The in-app report view is not built.** |
| R40 | Distinguish app window size from tested page viewport | S2 | partially implemented | Viewport width and height are declared on the environment revision. Nothing records the application window size at capture time, so the two are not yet distinguished in evidence. |
| R41 | Check case completeness before starting | S3 | not implemented | No case set to be complete. |
| R42 | End-to-end business flows across multiple entry points | S3 | not implemented | Per-case steps exist; no flow-level result above the case exists. |
| R43 | Verify concurrency and multi-role interaction as needed | S4 | partially implemented | This round enforces the role declaration and refuses a role change while an operation is unresolved. **Independently owned browser contexts per role are host-limited**: the official provider's per-role isolation is unverified, so concurrency is expressed only in the record. |
| R44 | Detect version changes during a test run | S4 | not implemented | No source or deployment fingerprint is captured, so results from two versions could still be merged into one conclusion. |
| R45 | Regression baseline is selectable and traceable | S3 | not implemented | No baseline record. An unfinished run or a poor screenshot cannot yet be excluded by rule, because there is nothing to select. |
| R46 | Keep the first failure, allow limited retest | S4 | partially implemented | A settled operation refuses re-settlement and a case result is keyed by run and case, so the first observation survives. **There is no retest allowance, no limit, and no separate retest record.** |
| R47 | The user can correct or dispose of conclusions | S4 | not implemented | No disposition record, so a correction can only overwrite the raw result. |
| R48 | Test tasks must not interfere with each other | S4 | implemented, verified | This round fixed a real defect: a single held run refused every test action in the host, so one session's pause stopped every other session's work. Holds are now scoped to the run's owning session, and the scoping is unit-tested. |

## 2. Cases, execution, and reports

| ID | Requirement | Phase | Status | Evidence or note |
|---|---|---|---|---|
| R49 | Failure-recovery testing is in scope by default | S4 | not implemented | `failureSimulation` is declared in the policy schema and never read. Simulation is neither confirmed effective nor lifted. |
| R50 | Prepare test data and files automatically and verify content | S4 | not implemented | No preparation step and no content verification. |
| R51 | Support business flows across time | S4 | implemented, unverified | This round added a durable wait: `web_test_wait` stores an ISO deadline on the run, the run refuses new test actions while parked, and `web_test_resume_wait` releases it only once the deadline has passed. Unit-tested including across a simulated restart. Independent cases are **not** continued while a run waits, so a run is still serial. |
| R52 | Regression includes legacy-data compatibility checks | S4 | not implemented | No regression pass exists; not reconciled with R33 because neither exists. |
| R53 | Keep completing the function and case inventory during execution | S3 | not implemented | No inventory exists to complete. |
| R54 | Confirm environment nature and data-operation scope before starting | S2 | partially implemented | `nature` and `dataOperations` are declared and `nature` defaults to `unknown`, but **no start path checks them**: a run can begin against an `unknown` environment. |
| R55 | Monitor local asset space and let the user clean up | S4 | partially implemented | The plugin's own data root is measurable and counted. Shared attachments and active-run evidence are not deletable through the plugin, and no space monitor or cleanup UI exists. |
| R56 | Conversational first-run model configuration and credentials | S1 | implemented, verified | No second credential system: sessions and Remote calls use the host's existing model configuration. |
| R57 | Detect when a task makes no substantive progress | S4 | not implemented | No stall detection. Waiting states are now persisted separately per cause, which is the precondition for telling them apart, but nothing measures progress. |
| R58 | Show progress, elapsed time, and model usage while running | S4 | not implemented | Nothing reads recorded facts for display. |

## 3. Delivery phases

| Phase | Status | What is actually established |
|---|---|---|
| S0 original-DSH feasibility | implemented, verified | The eight conclusions in §4, all measured on Ubuntu against unmodified DSH 0.2.0-rc.2. |
| S1 package and data foundation | partially implemented | Packed artifact with no checkout dependency, data surviving restart, ordinary defaults intact. The out-of-tree workspace is outside the repository's lint and hygiene gates (§1 R04), and the config namespace this phase was to establish was withdrawn after the preset row turned out to be the only live source. |
| S2 migrate useful business parts | partially implemented | Projects, environments, policies and runs work through the typed Remote, and a test session keeps ordinary sessions usable. **Source and page analysis, session cards, and model references are not built.** |
| S3 first complete test flow | partially implemented | A real browser workflow with operation facts, evidence custody, and HTML/Markdown/JSON reporting exists. **Case generation and confirmation, the report view, and the interrupted-mutation check are not built** — the operation lifecycle that R16/R46 need arrived this round in S4, without a case layer to drive it. |
| S4 durable execution | implemented, unverified | This round implemented the operation lifecycle with durable intent and `unknown` outcomes, session-scoped holds, the persistent business-time wait, restart reconciliation that never resumes blindly, and the operator control surface. All of it is covered by 68 unit tests. **No host run has exercised any of it.** |
| S5 complete business coverage | not implemented | No work has started. Every S5 item in the plan depends on S3's case layer, which does not exist. |
| S6 distribution acceptance | partially implemented | Tarball install, disable, uninstall, reinstall, data survival and a version-increment upgrade were measured on Ubuntu, and the reinstall-residual-`disabled` defect and its recovery were recorded. **The registry source is not implemented and unverified, and Windows acceptance is unexercised** (§7). |

## 4. Evidence measured before this round

Obtained one by one on unmodified DSH 0.2.0-rc.2 on Ubuntu 24.04, and still valid because the code paths they cover did not change:

1. The plugin installs from a tarball through the plugin manager into a clean profile, and the host starts with zero failed plugins.
2. A localized "Web 测试" section appears in Settings and renders live host data through the typed Remote.
3. `webTest/status`, `webTest/putProject`, and `webTest/listProjects` round-trip; a malformed argument is rejected by the strict codec with `gateway/input-invalid`.
4. Business data lands in the plugin's own SQLite database; the host's JSON backend is never written; the data is readable after a process restart.
5. After the stored version stamp is set to 99, the store refuses to open and names the version mismatch instead of reading as empty.
6. The `web-test` preset executes in a real model turn: `web_test_*` and `mcp__playwright-mcp__*` are admitted, and `bash` — present in the composition — is denied.
7. The official Playwright MCP provider drives system Chrome through a minimal test and returns a real screenshot.
8. Disabling `include:web-test` during an active run stops dispatch and drains storage; re-enabling restores service with data intact.

Further conclusions from the earlier rounds that remain valid are kept in the git history of this file.

## 5. Host limitations and recorded deviations

1. **Storage does not go through the Storage Domain.** Domain routing is a host `Config`-level decision, and an installable bundle cannot rewrite a host-owned row. The plugin opens its own unit with `ctx.storage.backend.get('sqlite').kv.open(...)` and guarantees single-writer and exact version matching itself.
2. **Typert artifacts are emitted by a script.** The official generator resolves no service contribution in an independent workspace. The plugin emits `typert.host.js` and the Remote contribution in the same format the official artifacts use, introducing no second RPC protocol.
3. **The browser is session-owned.** The browser row lives inside the preset, because mounting the provider at host level would expose browser tools to every normal session. Consequently a disable stops dispatch and drains the plugin's storage but cannot reap a live session's browser, and the host exposes no session-close interface.
4. **The plugin owns its own rows.** `dsh-storage-sqlite`, the official Playwright MCP provider and its peer `dsh-browser-use` are not shipped with the unmodified CLI, so the plugin declares them as its own install dependencies.
5. **A `single`-layout unit cannot be re-stamped.** The backend refuses any version but the descriptor's and offers no way to write a higher stamp over a lower one, so bumping the record version would strand every existing database rather than migrate it. Fields added after v3 therefore carry documented defaults, and a stamp this schema does not know still refuses to open. The trade-off: a build older than the field ignores it. Measured this round by reading a record written without the later fields, and by refusing a stamp of 99.
6. **The report is Chinese-only.** Markdown, HTML and JSON share one derivation but one wording. The Client section is locale-owned; the exported report is not, and selecting a locale is not implemented.
7. **Reports are unlocalized but escaped.** A case's own words come from a model reading an arbitrary page under test, so the HTML export escapes them; this is a safety property, not a localization one.

## 6. Defects found and fixed this round

| Defect | Why it mattered | Fix |
|---|---|---|
| `pnpm run build` failed on a clean tree | The solution config referenced only the host face, so `lib/types/client/*.js` was never emitted and the client bundle could not resolve its entry. The published build was not reproducible. | The solution root now references both faces; the workspace programs still seed the face configs. |
| The published tarball carried chunks from earlier builds | `clean: false` plus content-hashed chunk names left two copies of every shared chunk in `lib/shared`, so the package shipped stale code beside current code. | The clean list names only each bundle's own outputs, leaving tsc's `lib/types` and the Typert artifacts intact. |
| The package had no tests at all | `package.json` declared `test: vitest run` with no dependency and no test file, so the command could not run. R04 and the plan's §12 both expect coverage of record validation, transitions and report statistics. | 68 tests over three files, driving the real store through a real `Storage` hub and an in-memory backend that reproduces the documented version-stamp and close semantics. |
| One held run stopped every session in the host | `heldRun()` returned any held run, so a paused run refused another session's unrelated work. This is R48. | Holds are scoped to the run's owning session; a run with no recorded owner still stops everyone, because the plugin cannot tell whose work it would end. |
| The hold message named a tool that does not exist | It told the model to call `web_test_resume_run`, which was never registered and which the policy refuses. A denial a model cannot act on is a dead end. | The message asks for the operator, and a restart interruption explains itself separately. |
| Restart reconciliation destroyed a persistent wait | Clearing `waitingUntilMs` on every interrupted run would have made R51's durable deadline meaningless across exactly the restart it exists for. Caught by a test written for the rule. | A run that was already waiting keeps waiting; a pause and an open question are likewise not the restart's to convert. |
| `report_case` accepted results for a run that was not executing | A paused, cancelled or interrupted run could take new results describing steps it never performed. | Results require an executing run. |

## 7. Windows acceptance: not exercised

This round ran the build and the unit tests on Windows, which is new but is not host acceptance. The following remain unverified and must not be counted as passed:

- Installing the plugin tarball, writing `cordis.patch.yml`, and rolling back under Windows path semantics.
- SQLite file locking and 0700/0600 permissions under `dshHomePath` on NTFS.
- Discovery, launch, and reclamation of system Chrome or Edge through `executablePath`.
- Cleanup ordering of the browser, the SQLite unit, and the write chain on host exit and crash.
- Interaction with the tray, minimize, window close, and application exit while a test task runs.
- Multi-account and controlled-operation boundaries (the Windows account-level guarantee scope of R12).

The step-by-step checklist with prerequisites, expected results and an evidence table ships in `WINDOWS-ACCEPTANCE.zh.md`; a blank row counts as unverified.

## 8. Blocked, and what is being done instead

| Blocker | Evidence | Requirements affected | What continues |
|---|---|---|---|
| The machine's installed `dsh` is `0.1.5-rc.1`; the package declares `0.2.0-rc.2` | `dsh --version` on the machine versus `peerDependencies` in the manifest | Every host-dependent verification, including all four priority checks | Package-level work continues: S4 logic, tests, the report, and the distribution surface. |
| No `DEEPSEEK_API_KEY` in the environment; a credential reference exists in the host credential store but was not exercised | environment inspection only; no credential value was read | Real-model turns: defect detection, control runs, the four priority checks | Nothing that needs a model turn. |
| The plugin's own lint, hygiene and duplication gates are not wired into the repository's gate runner | The workspace is deliberately outside the DSH monorepo | R04 | Manual review against the same rules, recorded as partial. |

## Considered alternatives

- **Move the browser row to the bundle root row**: rejected; it would expose browser tools to normal sessions and violate per-session opt-in. Rationale in §5.3.
- **Keep using the Storage Domain**: rejected; it would require rewriting a host-owned row. Rationale in §5.1.
- **Bump the record version for the new fields**: rejected for the reason in §5.5; an unverified stamp must still refuse to open, and a known older stamp must still be readable after an upgrade.
- **Resume interrupted runs automatically on restart**: rejected. A restart cannot check the environment, the login, or whether a business operation landed, so an automatic resume is exactly the blind repeat the requirement forbids. Eligibility checks are unimplemented (R37) and the run waits for the operator until they are.
