# Requirement mapping: dsh-plugin-web-test

Status: proposed

[English](2026-10-04-web-test-plugin-requirement-mapping.md) | 中文

This table maps [product requirements R01–R58](../feature/2026-09-28-web-testing-requirements.md) one by one onto the delivery phases of the installable plugin `dsh-plugin-web-test`, and records each item's current verification status honestly. The technical approach is in the [installable plugin plan](../architecture/2026-10-04-web-testing-installable-plugin-plan.md); test-case and report fields are in the [test-case and report specification](../feature/2026-09-28-web-testing-test-case-report-spec.md).

Status values: **verified** means evidence was produced on unmodified DSH 0.2.0-rc.2; **skeleton** means the interface and code path exist but produced no runtime evidence; **not started** means not implemented; **host limitation** means unmodified DSH exposes no public interface for it, and the trade-off is recorded.

Platform basis: every "verified" below was obtained on Ubuntu 24.04 / Node 24.15.0 / pnpm 11.7.0. **Desktop acceptance on Windows 10 22H2 / 11 x64 is entirely unverified**; see the closing section.

## 1. Product boundary and environment

| ID | Requirement | Phase | Status | Evidence or note |
|---|---|---|---|---|
| R01 | Single-developer desktop app, no team features | S1 | skeleton | The plugin carries no organization, membership, or permission model; `Config` holds only browser-related fields. |
| R02 | Windows 10 22H2 or later, x64 | S6 | **unverified** | Only Ubuntu was exercised. Windows dependency paths, permissions, and process behaviour are untested. |
| R03 | Reuse the DSH base and the official desktop route | S0 | verified | The plugin installs through the plugin manager into a profile created by `dsh --from-default-profile web`; the host binaries are unmodified. |
| R04 | All first-party code follows DSH engineering rules | throughout | skeleton | The independent workspace replicates the official strict `tsconfig` options, plugin export conventions, registrations-as-effects, and locale ownership. The repository's own lint and hygiene gates have not run. |
| R05 | The user supplies the whole project codebase | S2 | not started | The project record already carries `sourceRoot`. |
| R06 | The user starts the system under test | S2 | skeleton | The project record already carries `baseUrl`; the plugin neither deploys nor installs dependencies. |
| R07 | Derive requirement understanding from code, separating rule provenance | S2 | not started | Needs a three-way provenance split: confirmed business rule, applicable general rule, implementation inference only. |
| R08 | No design mockups; visual checks discover issues from the live page | S3 | not started | First-release evidence is the actual page screenshot; no mockup comparison. |
| R09 | One concentrated pass covering all functionality | S3 | not started | "All functionality under test" is a goal; coverage must state its denominator. |
| R10 | Test scope and requirements entered in natural language | S2 | not started | Dialogue is the primary entry; the settings section carries only project and environment parameters. |
| R11 | Load and security testing opted into separately | S4 | not started | Needs its own opt-in and execution parameters. |
| R12 | Test only; never modify the system under test | S0/S3 | **verified (execution layer)** | The `web-test` preset's guard is a monotonic allowlist: with `@deepseek-ai/dsh-tool-bash` deliberately placed in the preset, the model's call was denied with `web-test sessions may only call web_test_* and mcp__playwright-mcp__* tools`. The restriction is enforced on the execution path, not in the prompt. |
| R13 | Test-environment business data may be created, changed, deleted | S4 | not started | Must be bound to the R54 environment declaration before authorization. |
| R14 | Produce reports, never auto-fix | S3 | not started | The plugin offers no path that writes back into the system under test. |
| R15 | Keep test history for regression and retest | S3 | not started | The run record table is declared but not yet written. |
| R16 | Long-running tasks recover and retry | S4 | not started | The host already retries API calls; the plugin does not reimplement it. |
| R17 | No model spend ceiling | — | host responsibility | The plugin sets no spend threshold. |
| R18 | Route models per task | S1/S3 | skeleton | Uses the host's existing model configuration; no second credential system and no self-selected routing. |
| R19 | User-configurable skills | S2 | skeleton | Reuses DSH's existing skill discovery; the plugin defines no format of its own. |
| R20 | Keep the native DSH conversation experience | S0 | verified | Normal sessions are not wrapped: the default preset remained `standard`, and the plugin contributes `web-test` as a sibling opt-in preset. |
| R21 | Propose skill improvement drafts, effective only after confirmation | S4 | not started | Must go through draft confirmation; it must never rewrite a rule already in effect. |
| R22 | Multiple login methods and human takeover | S4 | not started | Resource-recovery semantics for takeover depend on session-owned browsers; see the S4 note. |
| R23 | May use a dedicated computer for testing | S4 | host limitation | Unmodified DSH exposes no separate controlled computer-control entry; the first release covers the browser route. |
| R24 | Supplementary run evidence (logs, read-only database checks) | S3 | not started | Paths must be configured per project; availability cannot be inferred from having source code. |
| R25 | Confirm before real external business actions | S4 | not started | A skip reason must reach the report and must not count as a pass. |
| R26 | Natural language drives the whole test run | S2/S3 | skeleton | The settings section exists and works; in-conversation plan, progress, and report surfaces are not built. |

## 2. Cases, execution, and reports

| ID | Requirement | Phase | Status | Evidence or note |
|---|---|---|---|---|
| R27 | Generate cases before executing | S3 | not started | Case assets must exist before execution begins. |
| R28 | Skip cases blocked by new business questions | S3 | not started | Partial step success must never pass the whole case. |
| R29 | Execute every case against all functionality | S3 | not started | Reading code or a successful API call does not replace real page execution. |
| R30 | Confirm case updates before a new version starts | S3 | not started | Must relate to a baseline snapshot, never simply the latest unfinished batch. |
| R31 | Reports serve users and coding assistants | S3 | not started | Reports do not modify the system under test. |
| R32 | Cover backend functions with no page entry | S3 | not started | A missing entry point must be listed as unverified. |
| R33 | Keep defect data, clean other newly created data | S4 | not started | Cleanup goes through business entry points, never direct database writes. |
| R34 | Reminders only inside the owning session | S4 | not started | No system notification or push channels. |
| R35 | Built-in browser first, standalone browser as supplement | S0 | **verified** | The first release drives a standalone Chrome through the official Playwright MCP provider: system Chrome 147 launched, navigated to a local page, and returned a real screenshot, annotated with the actual environment. |
| R36 | Closing the window does not stop background testing | S4 | host limitation | Unmodified DSH has no session-close interface; experimentally the browser survives session cancel and is fully reclaimed when the host exits. |
| R37 | Verify and resume automatically after reopening | S4 | not started | Must first re-check environment, login, and already-submitted operations. |
| R38 | Record and retain necessary evidence by default | S3 | skeleton | The evidence directory lives under the plugin's own data root with 0700/0600 permissions. |
| R39 | In-app report plus multi-format export | S3 | not started | HTML, Markdown, JSON, and the evidence package share one source. |
| R40 | Distinguish app window size from tested page viewport | S2 | not started | Viewport width and height must be asked and saved during the case phase. |
| R41 | Check case completeness before starting | S3 | not started | Executing every generated case does not justify claiming full coverage. |
| R42 | End-to-end business flows across multiple entry points | S3 | not started | Both flow-level and step-level results must be kept. |
| R43 | Verify concurrency and multi-role interaction as needed | S4 | not started | Must be expressed separately from R48 batch queueing. |
| R44 | Detect version changes during a test run | S4 | not started | Data from different versions must not be merged into one conclusion. |
| R45 | Regression baseline is selectable and traceable | S3 | not started | Unfinished tests or bad screenshots must not replace the baseline. |
| R46 | Keep the first failure, allow limited retest | S4 | not started | Later success must not erase the earlier failure. |
| R47 | The user can correct or dispose of conclusions | S4 | not started | Disposition records must not overwrite raw execution evidence. |
| R48 | Test tasks must not interfere with each other | S4 | not started | Independent batches sharing an environment and business data queue by default. |

## 3. Special scenarios and data

| ID | Requirement | Phase | Status | Evidence or note |
|---|---|---|---|---|
| R49 | Failure-recovery testing is in scope by default | S4 | not started | Simulation must be confirmed effective and lifted at the end. |
| R50 | Prepare test data and files automatically and verify content | S4 | not started | A failed preparation must not count as verified business behaviour. |
| R51 | Support business flows across time | S4 | not started | Persist progress while waiting and continue independent cases. |
| R52 | Regression includes legacy-data compatibility checks | S4 | not started | Must be reconciled with the R33 cleanup scope. |
| R53 | Keep completing the function and case inventory during execution | S3 | not started | New cases are never backfilled and never overwrite executed records. |
| R54 | Confirm environment nature and data-operation scope before starting | S2 | not started | Production or unknown environments get no business mutation by default. |
| R55 | Monitor local asset space and let the user clean up | S4 | skeleton | The plugin's own data root is measurable; shared evidence and active-task assets are not directly deletable. |
| R56 | Conversational first-run model configuration and credentials | S1 | **verified (reuse)** | The plugin builds no second credential system: sessions and Remote calls use the host's existing model configuration throughout. |
| R57 | Detect when a task makes no substantive progress | S4 | not started | Waiting states are listed separately rather than sharing one wall-clock timeout. |
| R58 | Show progress, elapsed time, and model usage while running | S4 | not started | Reads recorded facts; never calls a model just to display status. |

## 4. S0 verified conclusions

The following were obtained one by one on unmodified DSH 0.2.0-rc.2 on Ubuntu 24.04 and are reproducible:

1. The plugin installs from a tarball through the plugin manager into a clean profile, and the host starts with zero failed plugins.
2. A localized "Web 测试" section appears in Settings and renders live host data through the typed Remote.
3. `webTest/status`, `webTest/putProject`, and `webTest/listProjects` round-trip successfully; a malformed argument is rejected by the strict codec with `gateway/input-invalid`.
4. Business data lands in the plugin's own SQLite database (`~/.dsh/plugins/dsh-plugin-web-test/web-test.sqlite`); the host's JSON backend is never written; the data is readable after a process restart.
5. After the stored version stamp is set to 99, the store refuses to open and names the version mismatch instead of silently reading as empty.
6. The `web-test` preset executes in a real model turn: `web_test_*` and `mcp__playwright-mcp__*` are admitted, and `bash` — present in the composition — is denied.
7. The official Playwright MCP provider drives system Chrome through a minimal test and returns a real screenshot.
8. Disabling `include:web-test` during an active run stops dispatch and drains storage; re-enabling restores service with data intact.

## 5. Host limitations and recorded deviations

1. **Storage does not go through the Storage Domain.** Domain routing is a host `Config`-level decision (`backend` plus per-domain `routes`), and an installable bundle cannot rewrite a host-owned row; experimentally, opening through the domain lands the data in the host's JSON backend. The plugin instead opens its own unit with `ctx.storage.backend.get('sqlite').kv.open(...)` and guarantees single-writer and exact version matching itself.
2. **Typert artifacts are emitted by a script.** The official generator discovers packages from the DSH monorepo aggregate tsconfig and resolves no service contribution in an independent workspace, emitting 0 services and 0 invocations. The plugin emits `typert.host.js` and the Remote contribution directly in the same format the official artifacts use, introducing no second RPC protocol.
3. **The browser is session-owned.** The browser row lives inside the preset, because mounting the provider at host level would expose browser tools to every normal session and violate per-session opt-in. Consequently, disabling the bundle row stops dispatch and drains the plugin's own storage but cannot reap a live session's browser; the host exposes no session-close interface, and the browser is fully reclaimed when the host exits.
4. **The plugin owns its own rows.** The official `dsh-storage-sqlite`, the official Playwright MCP provider, and its peer `dsh-browser-use` are not shipped with the unmodified CLI, so the plugin declares them as its own install dependencies and adds a row for each.

- Evidence is no longer self-reported by the model: the plugin creates `evidence/<runKey>/` under its own data root and checks every reported path for being absolute, inside that directory, and an existing file, refusing the whole result otherwise. `web_test_status` now reports the evidence root for the model to use.
- Both directions are now verified: with a real PNG pre-placed, the model reported its absolute path, `web_test_report_case` **accepted and stored it**, and the read-back `evidencePaths` holds the canonical absolute path with the file genuinely present on disk (12596-byte PNG); the control `run-2` (model self-reported path) still holds **0 results**. The refusal message text still could not be recovered from the session log, but "a bad path does not enter storage" is now confirmed by the control.
- Report generation: `webTest/buildReport(runKey)` renders a Markdown report from recorded results only, carrying a run-level verdict plus each case's steps, assertions, evidence, and open questions, and a run-wide section for questions the run could not settle. Because it is derived from recorded results alone, every statement in the report traces back to a case result the plugin accepted.
- The verdict rule is now decided and verified: any `openQuestions` at all makes the run-level verdict "N open questions, undetermined", each case heading reads "passed (N open questions)", and the per-case `outcome` stays visible unchanged. Before the fix `run-3` read "all recorded cases passed"; after it reads "2 open questions, undetermined". The empty run `run-none` reads "no decidable case" and never claims a pass.
- Evidence directory permissions now use an explicit `chmodSync(dir, 0o700)` after `mkdirSync` (the latter is umask-masked and never applies to an existing directory). **This fix is not yet observed**: the directory is only created when a case result is recorded, and in this round's two sessions the model called `web_test_status` and then made no further tool call, so `web_test_report_case` never ran and a fresh 700 directory has not been confirmed.
- The run layer is established and verified: `web_test_start_run` creates the run record (`phase: execution` / `status: running`) **and prepares the evidence directory when the run begins**, `web_test_finish_run` closes it (`phase: cleanup` / `status: completed|cancelled|blocked`), and a run that was never started cannot be closed. `webTest/getRun` and `webTest/listRuns` read them through the typed Remote.
- The `run-5` experiment walked start → report_case → finish: the run record reads `{phase: cleanup, status: blocked}`, the `evidence/run-5` directory permission is measured at **700** (confirming the permission fix left unobserved last round), and the report reads "1 open question, undetermined" with the case heading "blocked (1 open question)", carrying through that the environment's nature is unconfirmed so the case could not be executed.
- Pause, resume, and cancel are implemented and enforced in the execution path: `webTest/controlRun(runKey, pause|resume|cancel)` changes the run status and the store's held set, and `ctx.tools.guard` reads the held set before dispatch, so a paused or cancelled run **refuses every test action** while `web_test_status` stays reachable so the model can explain why. Invalid transitions are refused: a repeated pause reports `is paused and cannot pause`, and a cancelled run **cannot be resumed** (`is cancelled and cannot resume`), because its browser and evidence no longer exist.
- Measured: during the pause the model's `browser_navigate` call was genuinely refused, logged as `Error: web-test: run run-6 is paused by operator request and refuses new test actions; resume it with web_test_resume_run before acting`. The chain `running → paused → resuming → cancelled` was measured step by step.
- Denial after cancel is now directly evidenced: with `run-7` cancelled, a fresh session's `browser_navigate` was genuinely refused, logged as `Error: web-test: run run-7 is cancelled by operator request and refuses new test actions`. The model then called `web_test_status` and reported truthfully that the navigation was refused and the run cancelled, rather than claiming it had run.
- Last round's report of "no browser call observed after cancel" **was wrong**: the `tool/result` events carry `name: None`, and that round's filter matched browser tools on `name`, so the count came out 0. The call did happen and was refused. The verification script's filter was wrong, not the model.
- The dangling `resuming` state is gone: a pause does not tear down the session's browser, so there is no re-establishment phase to represent and `resume` returns straight to `running`. `resuming` remains in the schema but is no longer produced.
- **Liveness defect fixed**: the held set originally included cancelled runs, and `heldRun()` returns any of them, so **one cancellation blocked every later run in the host** — a fresh session's `run-8` was blocked by the unrelated cancelled `run-7`, and the model found `web_test_start_run`, `bash`, and `web_test_finish_run` all refused. The set is now narrowed so **only a paused run is held**; a cancelled run is terminal and no longer holds. After the fix a new run, `run-9`, completed end to end.
- **Known gap in evidence provenance**: `run-9` completed (start → browser navigation → read title → report → finish), the report reads "all recorded cases passed", and `evidence/run-9/home-title.png` genuinely exists (12596-byte PNG, 901x831). But that file is **sha256-identical** to the pre-placed `run-3` file, and the model called `browser_run_code_unsafe` repeatedly along the way. So: **the browser really navigated and the page title was really read**; **it is not verified that this evidence file was produced by the browser in this run**. The plugin's evidence check only requires an absolute path, inside the run's directory, and an existing file — it does **not** require the file to be newly produced or browser-written. Last round's "evidence verification complete in both directions" therefore needs narrowing.
- **A normal session is unaffected (required by the objective, now evidenced separately)**: with `run-9` **paused** (the least favourable case for the held mechanism), a fresh session on a **non-web-test preset** ran its `bash` tool normally and returned `PLUGIN-IS-NOT-IN-THE-WAY`. The plugin's execution restriction is attached to the web-test agent and does not reach ordinary sessions.
- The evidence freshness check is **implemented but unverified**: `ensureEvidenceDir` records when the run prepared its directory, and `report_case` refuses evidence whose mtime predates that moment (`cannot be evidence of this run`). This round's attempt did not succeed — the model did not call `report_case` with the stale file as instructed and instead closed `run-10` as blocked, so **neither the accept-new nor the reject-stale side has been measured**.
- **A real conflict in the evidence design (located)**: the Playwright MCP screenshot tool is confined to writing under `/tmp/.playwright-mcp/`, while the plugin's evidence directory is `~/.dsh/plugins/dsh-plugin-web-test/evidence/`. The model's attempt to write a screenshot into the evidence directory was redirected by the tool to the former, and the plugin then **correctly refused** it: `evidence path "/tmp/.playwright-mcp/fresh.png" is outside the run's evidence directory`. The run closed as completed with 0 recorded results.
- This explains and confirms why the earlier evidence file was hash-identical to a pre-existing one: the browser **cannot** produce a new file in that directory at all, so the model could only reuse an existing file. Stale files are now refused by the freshness check (the decoy's mtime was set three days back and was not accepted).
- **Direction still to decide**: the plugin should **copy** browser-produced files into its own evidence directory on receipt, use the copy moment as the freshness baseline, and record the canonical post-copy path. That preserves the plugin's ownership of evidence without depending on the browser's write sandbox. Asking the browser to write into the plugin's directory is not workable under the current host.
- Only the "stale file is refused" side of the freshness check has been measured; the "new file is accepted" side is **not yet evidenced**, because under the current directory scheme the browser cannot produce a new file.
- Now **copy-on-receipt**: the plugin copies the absolute paths the model reports (from wherever the browser sandbox allowed) into the run's evidence directory as `<index>-<original name>`, judging freshness from the **source file's** mtime against the run's start; a refused stale file is not copied. The tool description and parameter text now ask for the absolute path the screenshot tool reported.
- The copy mechanism works at the filesystem level: `run-13`'s evidence directory gained two new files copied by the plugin (`home-title.png`, `home-title-fresh-1791107058062.png`), both with this run's timestamps.
- **But "a structured result carrying evidence" has still not landed**: `run-13`'s recorded `home-title` is `incomplete` with an empty `evidencePaths`, and the model's open question is that the screenshot evidence could not be attached. The log shows why: after copying, the model tried to have the browser open the plugin's copy, which the host refused with `File access denied: .../run-13/home-title.png is outside allowed roots`. The model therefore **declined to claim a pass it could not attach evidence for**, downgrading the case to `incomplete` with an open question — consistent with "no evidence, no pass".
- Also fixed a real validation defect: the tool parameters declared `evidencePath` and friends optional while the validator required them, so a model omitting them hit a Zod type error. Absent values are now accepted.
- **Precise status of the two sides**: a stale file is refused ✅ (the decoy, plus the model's own clock/mtime message); a fresh file is copied ✅ (filesystem level); **a fresh file appearing in a recorded case's `evidencePaths` ❌ not yet evidenced**.
- **Fixed a freshness misjudgement I introduced**: `report_case` also calls `ensureEvidenceDir`, and it overwrote the run's start time with the current moment each time, so a screenshot taken during the run was refused as older than the run (logged as `evidence path "/tmp/run-14-home-title.png" was last written before this run started`).
  The start time is now recorded only when the directory is first prepared.
- **All three sides of the evidence check are now measured**: a stale file is refused ✅ (the three-day-old decoy), a fresh file is copied ✅ (a new file appeared in `run-15`'s evidence directory), and **a fresh file appears in a recorded case's `evidencePaths`** ✅ (`run-15`'s `home-title` is `passed` with `evidencePaths` pointing at the plugin's copy, and the report lists that evidence).
- That evidence file is byte-identical to an earlier screenshot of the same static page.
  The target is unchanged static HTML, so a fresh screenshot would legitimately produce the same bytes, so **hash equality can no longer serve as evidence of reuse**; this session's log does contain `browser_navigate` and `browser_take_screenshot` calls.
- The prompts were corrected: `start_run` and `web_test_status` had been telling the model to save evidence into the plugin directory, which is exactly why it wrote there and then tried to read its own copy back.
  They now say to let the screenshot tool save where it already saves, report the absolute paths it gives, and the plugin copies them — and state that the model **does not need to open those files**.
- **S5 regression baseline (measured on the current build)**: after a host restart every record type reads back correctly — `{project: 1, environment-revision: 1, run: 1, policy: 0, case-result: 1}`, project `shop`, environment `本机测试页 / test / read-only`, run `run-15 / completed`, case result `home-title / passed` with 1 evidence path, and `evidence/run-15/0-run-15-home-title-abs.png` is still on disk.
- Disable/re-enable regression: disabling `include:web-test` left the row's `fiber = null`, made the `webTest/*` Remote return an error, and left the data directory untouched (`evidence` and `web-test.sqlite*` intact); re-enabling restored `state = active` with unchanged record counts. The settings section renders normally after the disable cycle (data version 3, project 1, run 1).
- **S6 clean-host cycle (fresh `webclean` profile) measured**:
  - Install: the tarball goes in through the plugin manager, all 5 rows reach `fiber = active`, `compatibility.json` is empty (**no `allow-version` exemption used**), and the profile records the dependency and bundle.
  - Disable: each of the 5 rows reports `changed = true`, and none survives.
  - Uninstall: `dependencies`, the bundle entry, and `node_modules` are all cleared; the **user data directory is kept** (uninstalling must not delete user data). The host boots with zero failures afterwards.
  - Reinstall: the install succeeds, but **all 5 rows come back with `disabled: true`**.
- **Reinstall defect located**: the row toggles persist in the profile's `cordis.patch.yml` (all five are `disabled: true`), and **uninstall does not clear those entries**, while the plugin package itself carries no `disabled` (verified). A user who disables the plugin, uninstalls, and reinstalls therefore gets a plugin that is "installed but silently inert" — the manager shows it enabled while not a single fiber starts. This is host uninstall-path behaviour, must be listed separately in the S6 report, and does not pass.
- The reinstall defect is **recoverable**: re-enabling the five rows one by one returns all of them to `fiber = active` and `webTest/status` answers again. The recovery steps are written into the plugin's Chinese and English READMEs.
- **Data survival across uninstall and reinstall is now measured separately**: write project `survive` → uninstall (the data directory `web-test.sqlite*` remains) → reinstall → re-enable the rows → `listProjects` reads back `['survive']`. Neither uninstalling nor reinstalling deletes user data.
- The previous round's "0 records after reinstall" came from **my own cleanup** (I deleted the data directory at the start of that round), so data survival was **not** verified there; this entry is the actual evidence.
- **The upgrade path is defined and measured**: the host has no upgrade mechanism (only UI copy), so "upgradeable" here means **installing a version increment over the top through the plugin manager**. After bumping the version from `0.1.0` to `0.1.1`, `dsh plugin add` installed over the profile that already had `0.1.0`: `node_modules` reports `0.1.1`, the host boots with zero failed plugins, `webTest/status` reports `version 0.1.1`, the settings section shows version 0.1.1, **the pre-upgrade project `survive` is still there**, and `compatibility.json` is still empty.
- One boundary to note: the profile records `file:/tmp/dsh-plugin-web-test-0.1.1.tgz`. This is an **overwrite install from a local tarball**, not a registry upgrade; this environment has no plugin registry, so a registry-style upgrade cannot be verified here.
- **The Windows acceptance checklist is delivered** and ships with the package (`WINDOWS-ACCEPTANCE.zh.md`, added to `files`). It covers 11 groups: prerequisites, install and enable, settings entry, Remote round-trip, preset and execution-layer limits, a real browser minimal test, storage and restart, normal sessions being unaffected, run control, disable and cleanup, uninstall and reinstall, and upgrade. Each item gives the operation and the expected result, and the document carries an empty execution record table.
- The checklist states up front that **everything on Windows is unverified**, and that current evidence covers Ubuntu 24.04 / Node 24.15.0 / pnpm 11.7.0 with an unmodified DSH 0.2.0-rc.2 only. **An item that has not been run must not be ticked**, and blank rows in the record table count as unverified. Both READMEs link the checklist.
## 6. Host configuration form mechanism (S2 research conclusion)

Plugin data falls into two categories with different owners:

| Category | Owner | Basis |
|---|---|---|
| Plugin configuration (browser product, launch mode, headless, executable path, debug endpoint) | A host settings namespace, edited through `configForms` in the UI | The host's mechanism for configuration, covering staging, validation, save, and discard |
| Business records (projects, environment declarations, policies, runs, evidence) | The plugin's own SQLite, through the typed Remote | The plugin owns its business data; writing into host settings storage would void "disabling the plugin does not touch host data" |

Host public contracts now established (all from `@deepseek-ai/dsh-client-ui-primitives` and `@deepseek-ai/dsh-client-ui-settings`):

- `SettingsForm` (props: `labels` / `state: SettingsFormShell` / `onSave` / `onDiscard` / `children`) is the form frame.
- `SettingsFormModel<T>` stages edits and writes them on save; its constructor takes a `SettingsFormScope<T>`, a field-spec array, and optional secret specs.
- `SettingsValueField` / `SettingsSecretField` render controlled fields; `settingsTextField` / `settingsNumberField` supply conversion specs, where an invalid draft blocks the save instead of being discarded.
- On the client, `ctx.configForms.<namespace>` provides reads and writes; `ConfigFormController` is constructed as `(ctx, spec, mirror, persistence, schema)`, with `ConfigFormSpec<T>` being `{ namespace, decode? }`.
- An official section's injection set looks like `["slots","locale","connection","remote","remote.settings","configForms",...]`.

A falsified assumption: that `SettingsForms.configure({ auto: true })` projects this row's `Config` into a form. Experimentally `settings/describe` returns 19 namespaces (`bash-sandbox`, `agent-loop`, `locale`, and others) and **none of them is this plugin's**; `configure` only sets the automatic-page policy and declares nothing. The corresponding code and comment were withdrawn rather than left as an unproven claim.

**Resolved: the preset row is the only source of browser settings.** Browser settings had briefly lived in both the plugin's `Config` (editable through the host's configuration UI) and the preset row. The write-back path itself was verified — `settings/update` changed `browserHeadless`, `revision` advanced 0 to 1, and the value persisted into the profile's `cordis.patch.yml` and survived a restart — yet it had **no effect on the browser**: since the preset became a loader-declared row, `Config` no longer feeds it, and `agentPresets` offers only `register` and `list`, with no public interface to update an already-registered preset row. Under the host's preset mechanism, browser settings can only be written into the preset row's inline `config`. The whole dead `Config` was therefore removed (the `meta.volatile` marker, `browserProviderConfig`, the matching fields in the bundle row, and the `dsh-settings` peer); settings namespaces went from 20 back to 19 with no `web-test` — the plugin has no operator configuration that actually takes effect, and should not pretend otherwise. The `meta.volatile` mechanism itself is now established and recorded, ready for the first genuinely live configuration field. Re-verified after removal: clean start, preset session created, browser navigation and screenshot succeeded, and the execution layer still denied `bash`.

**Established: the declaration entry point is the volatile marker on the Config schema.** The host's `SettingsForms.describe()` walks each row through `volatileForm(schema)`, and `volatileForm` keeps only nodes marked `meta.volatile`; a row without the marker enters no namespace at all. After adding `meta.volatile = true` to this plugin's `Config`, `settings/describe` went from 19 namespaces to 20, adding `web-test` with `autoGenerate: true` and a projected value of `{browserProduct: "chrome", browserLaunchMode: "launch", browserHeadless: false, browserExecutablePath: "", browserDebugEndpoint: ""}` — the plugin's configuration is now editable in the host's configuration UI without editing the bundle file.

## 7. Windows acceptance (entirely unverified)

The following were not exercised on Ubuntu and **must not be counted as passed**:

- Installing the plugin tarball, writing `cordis.patch.yml`, and rolling back under Windows path semantics.
- SQLite file locking and 0700/0600 permissions under `dshHomePath` on NTFS.
- Discovery, launch, and reclamation of system Chrome or Edge through `executablePath`.
- Cleanup ordering of the browser, the SQLite unit, and the write chain on host exit and crash.
- Interaction with the tray, minimize, window close, and application exit while a test task runs.
- Multi-account and controlled-operation boundaries (the Windows account-level guarantee scope of R12).

## Considered alternatives

- **Move the browser row to the bundle root row**: this would let a disable reclaim the browser directly, but would expose browser tools to normal sessions and violate "no global wrapping". Rejected; the rationale is recorded in §5.3.
- **Keep using the Storage Domain**: this would require rewriting the host's `dsh-storage-domain` row to add a `routes` entry, which is modifying the unmodified DSH composition. Rejected; the rationale is recorded in §5.1.
- **Use an `allow-version` exemption to bypass compatibility checks**: not used. Compatibility conclusions come only from peer-range validation plus a real install and run in a clean environment.
