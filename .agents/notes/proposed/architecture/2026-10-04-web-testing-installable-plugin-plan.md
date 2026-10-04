# Agent Note: Installable Web Testing Plugin Plan

Status: proposed

English | [中文](2026-10-04-web-testing-installable-plugin-plan.zh.md)

## Problem

The existing Web testing work combines useful business plugins with changes to the DSH desktop, private browser IPC, application identity, and release machinery. The requested delivery is an independently installable extension inside an unmodified DSH application. Repackaging the current workspace does not satisfy that requirement.

## Proposal

This is a technical proposal and implementation plan, not a completed migration or an installation guide. The user has selected external Chrome/Edge for the first implementation. Source inspection uses the local original `dsh-v0.2.0-rc.2` baseline and separately identifies workspace additions; compatibility with the user's installed binary remains an S0 verification item. No product acceptance is inherited from the customized desktop.

### 1. Delivery and interaction

Deliver one installable package, provisionally named `dsh-plugin-web-test`, with its own version. It declares `dsh.bundle.patch`, Host exports, and a built `./client` export with `dsh.client` metadata. Its bundle adds its own entries and a Web Test Agent preset. It does not replace DSH executables, patch Electron Main, edit the built-in default preset, or replace shared model and telemetry configuration.

The first supported installation sources will be a prebuilt package directory, a tarball and a published registry package, each verified through the Plugins page. The development workspace root is not the installable package directory. Git installation is added only after a repository source with an installable distribution root and its build-script policy is tested. Settings gains a localized Web Testing section for projects, browser selection, model references, evidence storage, and recovery preferences. The actual test conversation carries plan, progress, questions, and report cards. A Start Web Test action creates or selects a dedicated test Session through verified public APIs; ordinary Sessions never silently switch presets.

DSH remains the interaction host while Chrome/Edge displays the tested website. The report records browser product/version, viewport, launch or attachment mode, and relevant environment facts. Success in Chrome/Edge does not certify the same website in DSH's embedded browser. Embedded automation is a separate compatibility capability; a missing public control API is a documented limitation, not permission to resume a desktop fork.

### 2. Existing requirements and partial supersession

The [product requirements](../feature/2026-09-28-web-testing-requirements.md) and [case/report specification](../feature/2026-09-28-web-testing-test-case-report-spec.md) remain the business inventory. A small first usable flow is a delivery increment, not deletion of the remaining requirements. This proposal replaces the delivery assumptions below; it retains old code, data formats, decisions, and execution records as migration inputs.

| Prior owner | Retained | Changed for the plugin |
|---|---|---|
| [Architecture](2026-09-28-web-testing-architecture.md) and [execution design](2026-09-28-web-testing-design-execution.md) | Business ownership, evidence semantics, read-only tested source | Dedicated test preset and public browser integration replace application-wide composition and private Main IPC |
| [Baseline](../process/2026-09-28-web-testing-upstream-baseline.md) and [models/release design](2026-09-28-web-testing-design-models-release.md) | Version compatibility, model capability checks, recoverable data | Plugin package versions replace independent application identity, installer, updater, and DSH-source merge maintenance |
| [Recovery design](2026-09-28-web-testing-design-recovery.md) | Intent recording, unresolved actions, pause, evidence preservation | Plugin-owned recovery replaces custom host exit/update interception |
| [Milestones](../process/2026-09-28-web-testing-milestones.md) and M0–M5 task cards | Relevant scenarios and historical evidence | S0–S6 below own the new delivery sequence; old phase completion is not a prerequisite by itself |
| Requirements R03/R12/R20/R35/R36/R55/R56 | Testing restrictions, native conversation, background work, managed evidence and model access | Restrictions apply to test work; external browser is first; DSH owns its process lifecycle, shared attachments and credentials |

These owners are partially superseded and remain active; no complete note is archived, rejected, or deleted by this plan. Business requirements not listed as changed remain in scope. The full R01–R58 mapping is reconciled in S1 before implementation claims broad coverage. The old M0/M1 records remain historical evidence of their exact inputs.

### 3. Reuse and ownership

| Capability | DSH owns | Plugin owns |
|---|---|---|
| Agent execution | Agent loop, model adapters, request logging, compaction and cancellation primitives | Test instructions, confirmed cases, bounded task progression and business recovery |
| Interaction | Chat, questions, approval mechanisms, settings shell and slots | Web Testing settings, test cards, project and report navigation |
| Models | Provider registry, credential storage and existing model configuration | References to suitable configured models and optional task-specific routing |
| Storage | Session log, supported Storage Domain/backend and attachment APIs | Projects, versioned plans, runs, action facts, reports and evidence ownership |
| Browser | Existing browser/MCP integration and Session-scoped execution facilities | Allowed targets and operations, role isolation, test assertions and evidence correlation |
| Packaging | DSH application and plugin manager | Installable bundle, built assets, compatibility declaration and plugin data migration |

The [original browser service](../../../../packages/browser-use/browser-use/README.md) registers one provider name; it is not a uniform click/observe API. [Jobs](../../../../packages/jobs/jobs/README.md) are process-local, and neither Goals nor Schedule constitutes a durable business test scheduler. Reuse these facilities where their documented guarantees match; retain a small plugin-owned run coordinator for the obligations they do not provide.

### 4. Package and module layout

Use an independent development workspace with one published runtime package. A small workspace layout allows the existing Typert build tooling to be evaluated without importing the DSH monorepo as a runtime dependency. The following paths are proposed, not files already created:

```text
dsh-plugin-web-test/
  package.json
  tsconfig.host.json
  tsconfig.client.json
  packages/web-test/
    package.json
    cordis.patch.yml
    src/index.ts
    src/agent.ts
    src/config.ts
    src/domain/
    src/projects/
    src/planning/
    src/execution/
    src/browser/
    src/policy/
    src/reports/
    src/remote/
    src/client/
    tests/
    lib/
```

The root Host entry owns configuration, persistence, Remote services and lifecycle. Mount that row by the bare package name so the original Typert loader can discover its artifact. Publish `./package.json`, generated `./typert` and `./remote` exports; the Client mounts its own generated Remote contribution without modifying DSH's api/remotes package. The `/agent` entry contributes tools, prompts and enforcement only within the Web Test preset. `./client` owns settings and cards. Runtime imports use published package exports and package-local paths; no `../web-test-*`, source aliases, DSH checkout paths, or workspace protocol ranges may remain unresolved in the distributed artifact.

Keep directly used DSH/Cordis runtime services as compatible peers and bundle or declare plugin-owned dependencies deliberately. Preserve shared React/Cordis identity and the documented Client module factory format. Build typed Remote artifacts locally; do not hand-code a second RPC protocol. S0 must verify generator assumptions about face configurations and workspace directories. The initial compatibility declaration names only the DSH release actually tested; a matching version string alone does not validate local patches.

### 5. Settings, Sessions and normal DSH behavior

Register the Web Testing page through `settings.section` and localized dictionaries. Reuse existing project forms, status views and tool-result cards where their dependencies are public. Settings stores browser choices, references to configured models, evidence policy and test defaults; credentials stay in DSH's credential service. Installing or disabling the plugin does not rewrite provider credentials or delete shared model configuration.

Bind a test Session explicitly to one project and the selected environment revision. The user can continue ordinary DSH conversations independently. Plugin tools, browser resources, prompts and restrictions apply only to identified test Agents and their permitted children. Source-reading tools are read-only; inherited editing, arbitrary shell, dynamic code/plugin execution and unadapted tools cannot bypass the test policy. Do not wrap shared Host filesystem or subprocess objects for all Sessions.

This is application-level control under the user's account, consistent with the retained requirement; a preset is not an operating-system sandbox. Enforcement uses verified execution hooks, not prompts alone. In the original tool registry, a visibility restriction on inherited tools does not necessarily hide tools registered directly on an Agent; the test guard must reject forbidden execution even when a schema is visible.

### 6. Browser integration and compatibility

S0 first evaluates the official [Playwright MCP provider](../../../../packages/experimental/browser-use-playwright-mcp/README.md) in a dedicated test preset, with its browser registration isolated according to the preset service rules. Use a plugin-owned browser profile and a visible browser for login or takeover; headless execution is optional after the same scenarios pass. Connecting to an existing browser is an explicit choice and does not imply access to all personal tabs.

The adapter must enforce permitted origins, role/context ownership, approved file transfer locations and action categories. Arbitrary page evaluation, filesystem-writing tools, uncontrolled downloads/uploads, browser configuration and external destinations are not granted merely because the upstream server exposes them. Known operations validate target and current observation before dispatch. Controlled page scripts, if necessary, are fixed plugin implementations with validated inputs, not arbitrary model programs.

Prefer the official provider plus a Session-scoped execution guard when S0 proves it can enforce the required operations and record dispatch outcomes. If it cannot expose the required pre-dispatch or result facts, implement a narrow plugin-owned MCP adapter using maintained upstream protocol and browser packages. This fallback owns only connection/tool translation and policy, not Chromium, an Agent loop, Electron IPC or a second DSH application. Choose one route before broad business migration.

A user-installed global browser provider may also attach to a test Agent. An isolated browser registry alone does not suppress the global provider's lifecycle listener, and identical MCP server identities can conflict. Detect the unsupported combination and report it without disabling the user's plugin. S0 tests both a clean default DSH and the discovered conflict configuration; coexistence is a compatibility result, not an assumption.

Login credentials and cookies are not reconstructed from the Session transcript. The original official launch wrapper forces an isolated browser and does not expose persistent userDataDir/storageState configuration. A plugin-owned persistent profile therefore requires a separately verified launch/attachment adapter; the S0 official-provider baseline may require login again after restart. Reconnect or create the browser according to supported behavior, then recheck account, tenant, page and environment before resuming. Multi-role tests require independently owned browser contexts; provider capabilities must be verified before claiming role isolation. Embedded-browser coverage stays separate from external-browser success.

### 7. Business data and evidence

Reuse the public [Storage Domain](../../../../packages/storage/storage-domain/README.md) facility under a unique plugin domain. Prefer the public SQLite backend in a plugin-owned database and isolated domain facility, subject to S0 verification in the actual Electron/Node runtime; do not change the Host's default storage route. Keep a small run catalog and open historical run data on demand. One Host service owns writes; UI, tools and jobs call that service. The following are proposed business records, not additions to DSH's Session format:

| Record | Essential information |
|---|---|
| Project / EnvironmentRevision | Source roots, URLs, roles, environment declarations, viewport and revision |
| SourceSnapshot / Requirement | Actual source version, readable coverage, immutable excerpts/references, confirmed or inferred expectation |
| PlanRevision / CaseRevision | Scope, prerequisites, steps, assertions, open questions, role and environment requirements |
| Run / CaseAttempt | Referenced revisions, phase, control state, progress, waiting reason, model route and usage observations |
| Operation | Stable identity, request digest, run/attempt/step, dispatch state, observed result and evidence references |
| Evidence / ReportRevision | Original artifacts, normalized model references, environment facts, coverage/results and export manifest |
| Baseline / Correction | Selected comparison versions, human decisions, affected cases and retained prior conclusions |
| CleanupPlan | Plugin-owned assets or newly created test data, affected references, user decision and actual outcome |

Storage Domain serializes writes but does not promise multi-table transactions or cross-process business exclusion. Write immutable referenced records before publishing their head; keep operation state in an authoritative record and rebuild derived progress after interruption. Do not equate a notification with durable commitment. S1 establishes one writer per plugin data root; a SQLite file lock alone does not synchronize two Hosts' cached business state. The existing Windows ownership lock is a reuse candidate. Unknown schema versions must refuse opening authoritative records, never appear as missing data; verify this behavior instead of adopting the original JSON per-record cache semantics.

Keep model-visible inputs and tool results in the normal DSH log. Plugin tables hold business authority; every fact sent to a model is projected through logged input or tool results and their metadata. Add no custom Session event types: the original external-plugin guidance forbids them because Session.append cannot mark an unknown event as ignorable for future readers. Use supported followup/inject and standard tool settlements, preserving read-only history when the UI plugin is absent.

Keep original screenshots and exported files in a plugin-owned evidence area with validated paths, hashes and a reference manifest. Use supported attachment APIs for model-facing images and ordinary Session references; preserve the distinction between originals and resized images. Do not depend on the workspace-only file-retention/file-publisher additions or parse opaque AttachmentIds.

Deletion removes only plugin-owned unreferenced assets selected by the user. DSH's shared Session attachments remain under DSH ownership, and the cleanup UI reports that distinction and actual bytes reclaimed. Preserve active-run evidence and regression baselines. Plugin uninstall retains business data by default; old application data is imported through a versioned read-only importer into a separate destination, with unresolved operations and history intact.

### 8. Test execution and recovery

The user flow is project/environment selection, source and page analysis, candidate cases, clarification and scope confirmation, execution, assertion evaluation, report publication, then permitted test-data cleanup. Code implementation supplies candidate expectations; it cannot certify its own correctness. Unknown business rules remain questions or uncovered cases in the denominator. Only generating cases never authorizes business mutations.

Keep phase separate from status. Phases are analysis, planning, execution, reporting and cleanup. Statuses distinguish queued, running, waiting for user, waiting for business time, paused, recovering, completed, cancelled and blocked. A completed run may contain failed or unverified cases; it never means all assertions passed.

For a state-changing operation: durably record intent; revalidate the environment, scope and target; persist dispatching; dispatch once; independently observe and durably settle the outcome. A crash or transport loss after possible dispatch leaves UNKNOWN. Replanning or issuing a new tool-call id does not authorize repeating the same unresolved intent. Observation may establish success or non-execution; otherwise retain the gap and continue only independent work.

Pause/cancel first closes local admission synchronously, then saves the control decision and requests cancellation of owned work. Report failure to save separately. In-flight effects are not rolled back by stopping a model call. Model/network retries and business-operation retries have different policies. Concurrency is serialized for runs sharing a test environment; role concurrency requires explicit case intent and isolated contexts.

On plugin or DSH restart, read unfinished runs before granting dispatch. Preserve user-paused and cancelled states; automatically recover other eligible runs only after checking compatibility, source/deployment changes, account state and unresolved operations. Waiting for a business deadline persists a timestamp and resumes observation when the host next runs. A closed DSH process cannot execute tests; no custom updater or exit veto is assumed.

### 9. Enable, disable, uninstall and upgrade

The root plugin owns an admission generation shared by all its test Agents and browser adapters. Disabling revokes it before asynchronous cleanup, rejects new runs, settles or records uncertain in-flight work, and drains owned processes before closing storage. Retired preset revisions may still be retained by live Agents; removing the preset definition alone is insufficient. S0 verifies public Agent control and manager teardown behavior; an unsupported quiescence path blocks release.

Do not infer the user's intent from a generic disposer: manual disable, HMR and Host shutdown may share it. S0 must determine whether public management events or selected-bundle state establish a durable stop reason. Explicit Pause/Cancel always persists its reason. If generic disposal cannot be classified, preserve the run and require an explicit continuation on reactivation rather than guessing that a user-disabled run may restart; ordinary crash recovery is handled separately. The exact reactivation behavior must be documented before S4 acceptance.

Uninstall removes registrations and package code while retaining data and exports. Ordinary DSH history and conversations continue to work. A former test conversation whose preset is absent may require reinstalling a compatible plugin before it can continue; read-only report exports remain usable. The supported upgrade procedure is: pause and confirm plugin work is quiescent, install the replacement package, restart when the manager reports restart-required, then validate the loaded version and migrate a verified data copy before selecting it. Package replacement does not itself guarantee that the manager paused an old running implementation. Old data is preserved; the plugin does not intercept DSH's own updater.

### 10. Migration inventory

| Existing area | Treatment | Completion evidence |
|---|---|---|
| `web-test-contracts` | Extract project/environment parsing and branded ids; remove application-only metadata | Published exports typecheck and boundary validation tests |
| `web-test-runtime` | Retain project/revision/session/environment logic; adapt to public storage; separate business recovery from installer recovery | Restart, conflict, interrupted-write and single-writer scenarios |
| `web-test-conversation` | Retain tools/Remote business methods; bind only to test Sessions | Ordinary/test Session isolation and logged results |
| `web-test-presentation` | Retain components, dictionaries and tool cards; add settings section and scoped rendering | Actual Client loading and registration disposal |
| `web-test-models` | Reference existing configured routes first; migrate capability checks and later multi-route logic | Existing account works without copied credentials; missing capability is explicit |
| `web-test-policy` | Retain decisions; replace global decoration and private-interface imports | Forbidden test actions rejected; ordinary DSH actions unchanged |
| `browser-use-web-test` | Retain action/evidence semantics; replace private desktop transport | Real external browser workflow launched from DSH |
| Desktop/CLI patches and application launcher | Preserve as historical sources; exclude from distributed plugin | No modified DSH binary or checkout required |
| QuickJS, attachment retention and recovery prototypes | Evaluate only against remaining concrete requirements | A named consumer and supported package path justify each retained dependency |
| Old tests, probes and evidence | Port applicable scenarios; retain historical outcomes | Re-run changed paths on the actual plugin artifact |

### 11. Implementation stages

The sequence below replaces delivery sequencing for the new route. S0 is the first implementation work after this plan. Do not port the whole repository before it passes. Parallel work uses separate module ownership; the integrator owns the installed artifact and final acceptance.

| Stage | Tasks and deliverables | Dependencies | Exit condition |
|---|---|---|---|
| S0: original-DSH feasibility | S0.1 record clean baseline/public exports; S0.2 build and install one packed bundle+Client+Remote+test preset without checkout access; S0.3 exercise browser, SQLite, existing-provider conflict and active-disable behavior | User-selected external browser route | Original DSH loads a non-broken preset and executes one allowed tool; settings/Remote/browser work; a retained old Agent cannot dispatch after disable; every unsupported API has an explicit decision |
| S1: package and data foundation | S1.1 fix external build/peer versions; S1.2 config namespace, locale and cleanup ownership; S1.3 storage/writer design, compatibility checks and R01–R58 mapping | S0 | Packed artifact has no checkout dependency; project data survives restart; ordinary defaults remain intact |
| S2: migrate useful business parts | S2.1 contracts/projects/environment; S2.2 Session commands and cards; S2.3 model references and test-scoped policy | S1; UI and domain can proceed independently after Remote definitions | Real project onboarding, environment confirmation and source reading work in a test Session; ordinary Session remains usable |
| S3: first complete test flow | S3.1 source/page analysis and confirmed cases; S3.2 one real browser workflow with operation facts and cancellation/interruption checks; S3.3 evidence, report view and HTML/Markdown/JSON exports | S2 and chosen browser adapter | DSH starts a test against a controlled site, detects a known defect, records a passing control, and produces a reproducible report; an interrupted mutation is not silently retried |
| S4: durable execution | S4.1 pause/cancel/unload; S4.2 crash recovery and UNKNOWN reconciliation; S4.3 role/environment scheduling and persistent waits | S3 | Interrupted mutation is not blindly repeated; paused/cancelled runs stay stopped; eligible work resumes only after checks |
| S5: complete business coverage | S5.1 cross-entry/role/file/backend/abnormal-network cases; S5.2 regression/baselines/corrections/Skills; S5.3 lightweight routing, opt-in specialized tests, cleanup and progress | S3; recovery-dependent work also requires S4 | Retained requirements have actual evidence or an explicit unresolved item; a small demo is not full acceptance |
| S6: distribution acceptance | S6.1 install/disable/uninstall/reinstall/upgrade on a clean original host; S6.2 compatibility and resource tests; S6.3 user docs, license inventory and legacy-data import/export | S4 and accepted S5 scope | One distributable artifact works without the development checkout; ordinary DSH and retained user data pass regression |

S0 has the largest architectural uncertainty. Estimate later work only after measuring its build, scope, browser and teardown outcomes and the amount of code that can be extracted unchanged. Publish per-task evidence and remaining work, not speculative percentage completion or calendar promises. S3 provides an early usable increment; it does not label the full original requirements complete.

### 12. Verification and release evidence

Unit tests cover record validation, revision conflicts, authorization expiry, scope decisions, action transitions and report statistics. Recorded-session cases cover model-visible plans, questions, tool results, images and report content. Component tests cover localized settings/cards and disposal. These are followed by tests of the built package through the real plugin manager and original DSH host.

The central end-to-end case is original DSH installation, plugin addition, project/environment selection, confirmed cases, real browser actions, independent assertion checks and saved report. Include failed login, navigation outside scope, cancelled mutation, browser disconnect, restart, missing image capability, full evidence storage and incompatible plugin version. A standalone Playwright pass or a mocked Host does not complete this case.

Use an isolated compatible test profile and owned test browser/resources. Compare ordinary DSH behavior and relevant configuration before installation, while enabled, after disable and after uninstall. Test an already-installed browser provider explicitly. For packaged-artifact validation, make the development checkout unavailable so source aliases and adjacent workspace dependencies cannot mask a broken package.

Real-model checks use the selected DSH route and a controlled site, with the test oracle unavailable to the model. Resource measurements include idle plugin overhead, an actual test run, retained artifacts and cleanup; characterize observed processes and bytes without claiming the entire machine was measured. Full retained-scope release includes the original 24-hour task acceptance and Windows 10 22H2/Windows 11 x64 compatibility; S3 alone does not satisfy them. Re-run only checks whose relevant inputs changed and the required final artifact checks; no full DSH platform matrix is a default plugin milestone.

## Alternatives considered

**Continue the customized desktop.** It preserves the existing private browser bridge but requires a modified DSH distribution and ongoing application upgrades. It conflicts with installation through the original plugin manager, so it remains historical implementation material.

**Only add a settings item and repackage all existing code.** The UI entry does not remove private imports, global guards, application identity or checkout-relative dependencies. Packaging must follow extraction and isolation.

**Use only a Skill or generic browser MCP server.** These may supply instructions and actions, but not the required project history, confirmed plans, business-operation recovery, evidence ownership and report workflow. They can be dependencies of the plugin rather than its complete replacement.

**Require embedded-browser parity first.** This retains the former browser preference but blocks the independent installation route on currently missing public controls. External Chrome/Edge is the selected first implementation; embedded support requires its own evidence and explicit supported integration.

## Acceptance criteria

1. One package is installed through the original DSH plugin manager without changing DSH source, binaries or default presets.
2. Its settings, typed Remote, test preset and built Client load from the installed artifact, including when the development checkout is unavailable.
3. Ordinary Sessions retain their original tools, model settings and browser behavior while the plugin is enabled and after it is removed.
4. A test Session follows confirmed cases through actual browser actions to a persisted report with independently checked results and evidence.
5. Test-only restrictions are enforced at execution; unsafe or unsupported paths fail explicitly and cannot acquire authority from a prompt or approval meant for another action.
6. Disable and cancellation prevent new dispatch and release owned resources; possible in-flight effects retain accurate outcomes. Restart never blindly repeats UNKNOWN operations.
7. Retained business requirements have a current acceptance mapping. External-browser success is not represented as embedded-browser coverage.
8. Data, reports and baselines remain recoverable across disable, uninstall and supported upgrades; deletion respects ownership and references.

## Risks

Public DSH APIs and browser providers are pre-stable. The external Client/Remote build, concurrent provider composition and active-preset unload are the primary S0 risks. A failure changes the affected integration design or supported version; it does not authorize silently patching the user's DSH.

The independent plugin still owns substantial testing business behavior. DSH supplies execution infrastructure, not automatically correct cases, complete coverage or safe repeated mutations. Simplifying delivery does not remove those implementation and verification obligations.

External browser profiles, credentials and shared Session attachments have different owners. Login recovery, disk reclamation and uninstall guarantees must match those owners. Old data imports preserve historical versions and unresolved actions; they never overwrite the only copy of earlier work.
