# Agent Note: Upstream baseline and upgrades

Status: proposed

English | [中文](2026-09-28-web-testing-upstream-baseline.zh.md)

## Problem

The application must follow one reproducible DSH release and its engineering rules while retaining clearly owned local differences.

## Proposal

For the newly selected external-plugin route, the [installable plugin plan](../architecture/2026-10-04-web-testing-installable-plugin-plan.md) replaces the independent application identity, installer and source-fork delivery assumptions below. The pinned baseline remains an initial API inspection target; actual original-DSH installation compatibility is unverified until S0. Historical records and unrelated upstream changes remain preserved.

This file is the source of truth for baseline identity, inherited upstream rules, and integration differences. It defines how to develop the application; it does not establish that any code, patch, or installer has been implemented or verified. See [Product requirements](../feature/2026-09-28-web-testing-requirements.md) for scope and [DD12](../architecture/2026-09-28-web-testing-design-models-release.md) for the runtime update protocol.

## Fixed baseline

| Item | Selected value |
|---|---|
| Official repository | deepseek-ai/deepseek-harness |
| Release tag | dsh-v0.2.0-rc.2 |
| Commit verification | Resolve the selected tag to its full commit ID in Git, verify the checkout and registered application differences against that base, and record local evidence in BaselineManifest; maintained repository files use tags and PR references |
| Release status | Pre-release; selecting it does not establish runtime feasibility |
| Desktop approach | Use the original repository's Electron Main, Desktop Host, Client, and build process, assembling this application's testing plugins |
| First-release systems | Windows 10 22H2 / build 19045+, Windows 11, x64 |
| First-release distribution | Separate application identity, data root, browser profiles, and update channel; unsigned local installation and manual updates |
| Declared development tools | Root engines: Node ^22.19.0 or >=24.0.0; packageManager: pnpm 11.7.0 |
| Dependency identity | Use this commit's lockfile and the actual build BOM; package.json ranges are not resolved versions |

Official references: [release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2), [selected tag](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.0-rc.2), [root configuration](../../../../package.json), and [desktop configuration](../../../../apps/desktop/package.json).

M0-T01 must inspect the full checked-out SHA, lockfile digest, native Windows environment, rule loading, and build entry points, and produce a BaselineManifest. Do not switch to that day's master, ignore commit differences because version labels match, or independently upgrade Electron, Cua, Playwright, or other dependencies to hide incompatibility. Official links locate evidence; implementation must use source from the actual fixed commit.

## Upstream reuse and application ownership

| Capability owned by upstream | Increment owned by this application |
|---|---|
| Windows, native chat, sidebar, shortcuts, tray, hide-on-close behavior, and standard quit confirmation | Testing entry points, case confirmation, task cards, and report display; include every durable run in lifecycle decisions |
| Model catalog, provider editing, credential storage, and configuration services | Conversational onboarding, reusable configuration controls, purpose-based routing, and actual capability checks; do not build another general configuration backend |
| Agent, Session, tool execution, ctx.llm, and Typert Remote | Domain analysis, test control, execution facts, assertions, and reports; do not copy agent-loop or bypass it with an independent model-call path |
| Browser Use and Computer Use capability ownership and underlying drivers | Controlled targets, role identity, focus, operation permissions, and observation generations; the embedded browser panel still requires P01 verification |
| storage domain, AttachmentStore, and provider | Minimal business commit/recovery; extend necessary attachment references and cleanup within the official abstraction's ownership, without a parallel object store |
| Packaging, installation, and update infrastructure | Application identity and environment configuration, installation eligibility with durable tasks, recovery updates, and actual Windows acceptance |

An official browser panel does not establish that automation tools can control it. Default Jobs are not durable business tasks, and reminder delivery is not test completion. The three [detailed designs](../architecture/2026-09-28-web-testing-design-execution.md) own these distinctions; interface reuse cannot remove acceptance requirements.

## Upgrade disposition and remaining integration work

| Issue and evidence | Owning tasks and admission requirements |
|---|---|
| The selected release includes [official fix #4595](https://github.com/deepseek-ai/deepseek-harness/pull/4595); the previous local backport's source, tests, and SDK scenario registration match upstream. | Retire the duplicate local backport and retain its historical evidence. M0-T05/T07 reverify partial completion, scheduling failure, conservative result repair, and a subsequent model request on the selected release; M3 still owns business recovery. |
| Official quit/update checks primarily inspect active Agents, Inbox, and Jobs. Cold-session schedules and this application's durable runs need additional examination. [Quit inspection](../../../../apps/desktop-host/src/quit-inspection.ts), [update inspection](../../../../apps/desktop-host/src/update-tasks.ts) | M0-T05/T11 identify integration points. M3-T03/M5-T02 test waiting, paused, frozen, and inactive-Agent runs. Reuse the standard dialog; DD12 still owns business installation eligibility. |
| The selected release includes [official fix #5214](https://github.com/deepseek-ai/deepseek-harness/pull/5214). DeepSeek file invalidation now receives batches of variant/file identities. | No local backport is required. P05/V10 verify simultaneous expiry, batch index updates, preservation of newer mappings, reupload, and request continuation. Resending a model request never replays business actions; other providers retain their own mechanisms. |
| Scheduling now uses the optional [experimental schedule bundle](../../../../packages/experimental/schedule-bundle/README.md); its rows are absent from the default Web composition. | Do not patch absent schedule rows or silently add the bundle. DD08's Runtime owns recovery; an explicitly selected bundle supplies deduplicated wakeups only. |
| Dynamic model-tool declarations still depend on toolUpdate support. Windows sandbox assembly also supplies an ACL diagnostic Skill. [Model contract](../../../../packages/llm/llm/src/types.ts) | M1-T05 inventories tools and Skills in the actual composition, including diagnostics that can change permissions. Tool visibility, onboarding, and human review overrides cannot grant writes to tested sources. DD11 measures actual capabilities and total cost. |
| The desktop composition includes product analytics and desktop telemetry, with collection enabled by default. [Analytics policy](https://github.com/deepseek-ai/deepseek-harness/pull/5136) | The application composition must disable collection before its first startup and verify exporter addresses, queued events, and network behavior. Keep Session feedback, model requests, and tested-service traffic separate. An identity-service field is not a telemetry switch. |
| Official profiles still omit a browser-use provider. Browser/provider source changes do not establish a controllable desktop panel. | P01 must explicitly assemble the selected provider and verify targets through the real desktop; P03 remains dependent on that result. Standalone browser evidence does not accept the embedded route. |
| A bare local plugin can load through source aliases while DeepSeek plugin inventory cannot resolve its package manifest. The observed failure is wrapped as REQUEST_EXTENSION. | M1-T01 uses a resolvable file entry for local checks or declares the package in the application's resolver manifest before using its bare name. Verify Loader activation and request-extension preparation, then actual model requests; do not disable inventory or change the official model adapter to hide this error. |
| Local deleteFileVerbatim remains absent from upstream. The prototype at packages/web-test/web-test records identity and entry metadata only. | Retain the attachment extension and recheck shared aliases, final-owner cleanup, missing objects, and reference coordination. Keep prototype data-root isolation, UI, packaging, and actual capabilities unaccepted until implemented and tested. |

For a required patch, first reproduce the applicable issue, inspect the official fix's complete dependencies and persistence effects, produce the smallest reviewable change, and run the relevant regressions, all applicable official checks, and application scenarios. PatchManifest records the source commit, actual changes, purpose, excluded parts, test evidence, and removal condition. Do not edit logs manually, weaken checks, or fabricate successful tool results. If backporting is infeasible or requires replacing the entire tag, the main agent presents a concrete version decision; keep the affected route blocked until the scope change is authorized. Applying a patch does not itself authorize committing, pushing, or publishing.

Completing tool-result records preserves the evidence distinctions of TOOL_OUTCOME_UNKNOWN / TOOL_NOT_STARTED; it does not establish business failure, absence of side effects, or completion. Previously closed abnormal histories require separate verification. Model recovery and domain recovery are accepted separately. Upstream inclusion establishes source availability, not this application's acceptance.

The earlier upgrade from dsh-v0.1.7-rc.2 to dsh-v0.2.0-rc.1 preserved shared history and uncommitted application work, with file hashes verifying the external backup. Session writer V4 and storage-sqlite schema 1 were unchanged between those tags. Its probe results remain historical evidence with their original inputs, not passes on the currently selected release. The [collaboration guide](2026-09-28-web-testing-agent-guide.md) owns stage status and the next execution order.

<a id="rc2-incremental-upgrade"></a>

## Incremental upgrade to rc.2

The user authorized dsh-v0.2.0-rc.1 → dsh-v0.2.0-rc.2, adding 187 upstream commits. Integration preserves shared history and all registered uncommitted work after a verified external backup. Record the complete source identity, lockfile, retained differences, and actual checks in BaselineManifest/PatchManifest. The [Session version](../../../../packages/core/session/src/types.ts) remains V4 and the [SQLite schema version](../../../../packages/storage/storage-sqlite/src/schema.ts) remains 1, but [user-question replies](../../../../packages/interaction/user-questions/src/types.ts) add the `user-question-reply` message source within that Session version. Unchanged version numbers neither require an inferred data migration nor establish compatibility of all event contents or read/write behavior. Revalidate affected histories, UNKNOWN results, attachment ownership, and recovery on the selected combination.

The following source changes determine focused revalidation. They are not application runtime acceptance results, and they do not change the browser R0–R3 sequence, M1 limited-development permissions, or final acceptance thresholds.

| rc.2 change and source | Application consequence and verification owner |
|---|---|
| Desktop includes a [bundled CLI](../../../../apps/desktop/README.md) for plugin management after the desktop profile has been initialized; the CLI still rejects desktop boot and configuration dumps. | M0-T01/M1-T01 distinguish the installed Desktop command from npm/source CLI and verify profile ownership, application shutdown, and shared locks before plugin changes. This does not replace real GUI/profile verification or provide a browser automation provider. |
| [User questions](../../../../packages/interaction/tool-ask-user/README.md) add optional timed mode; omitted configuration or `mode: legacy` preserves blocking behavior. | M1-T05/T06 record the selected mode. Timeout or pending is not authorization; a late answer must match the question, action, and current project/environment/plan revision before it can authorize anything. M0-T09 preserves unanswered-intent gaps and retests after valid confirmation. |
| The [pi-ai dependency](../../../../packages/llm/llm-pi-ai/package.json) advances from `^0.85.1` to `^0.87.1`, and model catalog entries change; configured names do not establish protocol or modality support. | M0-T07/M1-T04 revalidate affected actual adapter routes, tools, modalities, usage, and cancellation. Keep catalog metadata, real main-route evidence, and lightweight-route evidence distinct; old results apply only to unchanged verified inputs. |
| [Preset settings](../../../../packages/client/ui-agent-preset/README.md) keep Creator and default-preset selection available with `developerTools` disabled. | M1-T05 validates composition changes and hot-enabled tools at actual execution paths; hiding a picker cannot enforce tested-source protection. Existing Windows ACL diagnostics remain part of the enabled Skill inventory, not a new rc.2 migration. |
| [Sidebar integration](../../../../packages/client/ui-sidebar-right/README.md) removes SidebarRightBinding and uses current host, selected-Session, and visibility interfaces. | M1-T06/T07 use the current UI interfaces when assembling conversation and browser panels; verify project/Session switching and retained hidden views without recreating removed bindings. |
| Root rules add immediate documentation of externally perceptible breaking changes through the [upgrade-guide skill](../../../skills/dsh-create-upgrade-guide/SKILL.md). | M0-T01 refreshes RulesMap/CheckPlan. Future application changes follow the inherited rule; this baseline adoption does not itself establish product acceptance. |

Run only checks justified by the changed inputs, preserving prior evidence and its scope. Mark affected runtime scenarios as pending revalidation until their actual results are recorded; a clean merge, source inspection, or documentation check cannot promote an rc.1 pass to rc.2.

## Inherited rules

Preserve the official repository's shared history and engineering system in full. Applicable root, ancestor, nearest-directory rules, and referenced files jointly define development requirements. This application adds only business restrictions with clear ownership; it does not copy a separate “DSH-compatible” rule set. Read-only tested-source restrictions do not prohibit authorized development changes to this application's repository.

| File category | Treatment during adoption and upgrades |
|---|---|
| Rule entry points such as AGENTS.md and CLAUDE.md | Preserve upstream text, links, and scope. On Windows, inspect the actual target content; receive upstream additions, moves, and deletions, rather than comparing filenames alone |
| .agents/skills, architecture, development, testing, and package READMEs | Load the rules relevant to the actual task. Assemble official development Skills and user business Skills separately, without overwriting same-named entries |
| lint, types, coverage, build, generators, and CI | Preserve official mechanisms and adapt repository/environment identity. Regenerate from source; do not lower checks or manually edit generated output |
| vendor/native, format history, and release materials | Follow official synchronization, versioning, and compatibility processes. Preserve licenses and attribution; do not rewrite previously released formats |
| Application plugins and local restrictions | Create them only when current consumers, data owners, and directories are known. Local rules link to the single product fact owner rather than copying complete requirements |
| User credentials, Skills, tasks, and evidence | Runtime data managed through configuration/data migration; Git updates must not overwrite it |

Entry points: [root rules](../../../../AGENTS.md), [package rules](../../../../packages/AGENTS.md), [architecture](../../../../docs/architecture.md), [documentation rules](../../../../docs/AGENTS.md), and [testing policy](../../../../docs/testing.md). These links do not exhaust all applicable rules; M0-T01 produces the actual RulesMap.

Resolve rule conflicts by their actual meaning, rather than mechanically choosing the nearest file, the stricter rule, or the local version. First adapt this application's implementation and supplementary text. Unresolved conflicts prevent acceptance of the combination. If an official rule entry needs to reference application restrictions, add a short link and record the difference without replacing the original text. The DSH name does not authorize initializing another personal Harness governance system.

Instructions, scripts, MCP, and PTC in runtime business Skills must pass the actual product policy. Official development tools' ability to edit code does not authorize this product to modify tested code.

<a id="document-languages-and-entry-points"></a>

## Document languages and entry points

Follow the fixed baseline's [official bilingual rules](../../../../docs/i18n/README.md). Do not introduce “English for AI, Chinese for users” or English precedence. Both languages have equal authority, and either can be authored and reviewed first. Paired content must mean the same thing. Resolve conflicts against confirmed requirements and actual evidence, correcting the documents rather than choosing a winner by language.

The official rules and actual verifier determine scope and exceptions. Applicable repository documents use three sibling files: English `foo.md`, Chinese `foo.zh.md`, and consistency record `foo.i18n.yaml`. README uses `README.md`, `README.zh.md`, and `README.i18n.yaml`. Maintain language switchers, heading and list structure, tables, code, and links to the appropriate language according to official rules. Requirement IDs, interface identifiers, and behavioral restrictions remain consistent. Explicitly excluded instruction files such as AGENTS retain their official English-only maintenance; do not mechanically add translations or create custom exclusions.

When either language changes, the editing agent updates the counterpart using official terminology, confirms meaning, and records and verifies the pair with the official command; it does not automatically start the specialized translation workflow. Passing structure and hash checks does not replace semantic verification. Do not update only the consistency record to conceal an unsynchronized translation. Generated documents and frozen history follow their respective official rules; do not manually edit generated sources or retranslate frozen records.

The 17 detailed specification pairs use this repository’s proposed Agent Note format under feature, architecture, process, and testing. The [application handoff](../../../../docs/developer/web-testing/README.md) provides the in-repository entry; it links to the owning specifications without maintaining a second copy. RepositoryMap records current paths and fact owners. Proposed preserves confirmed scope while identifying unimplemented designs and execution plans; after implementation, place actual contracts, configuration, and user guidance beside their owners and update the original proposal lifecycle and links.

CODE_ROOT is the Git/project root; DOC_ROOT is its docs/developer/web-testing directory. The root README triplet retains upstream content with a small link to the application handoff; AGENTS and official rules retain their original ownership. An incoming agent reads official rules, then this application’s collaboration proposal and related tasks. Durable specifications and task instructions live inside the checkout and must not depend on a personal directory or ignored file. Full commit identity, lockfile digest, and actual command output are local evidence under the already-ignored .artifacts/web-testing directory; missing evidence is regenerated from Git and actual checks, never treated as a pass. Maintained files follow official reference rules using tags, PRs, and relative links. Subsequent upgrades merge through shared Git history, preserve the small navigation addition, and check pairs and application references.

## Integration cost register

M0-T01 creates IntegrationSurfaceRegister, M0-T08 reviews it, and each feature task updates the rows it touches. Each row includes at least:

- Owning task, actual directories/files, upstream version, current consumers, and data owner.
- Category: public extension point / internal modification / native wrapper; interfaces, Host/Client boundaries, cancellation, and resource ownership.
- Persistent formats, old-history reads, generators, bilingual documentation, and applicable checks affected.
- Simpler compliant alternatives, runtime evidence, adoption rationale, and scenarios to reverify during upgrades.
- Owner of the application difference, patch source, expected removal conditions, and actual maintenance burden.

A small change is not evidence of feasibility. Rule compliance, product effectiveness, and upgrade compatibility need separate evidence; package count must not follow architecture-diagram box count mechanically. Register attachment-reference/deletion extensions and the installation recovery coordinator explicitly instead of hiding them in a general adapter. P02 uses actual workloads to choose the smallest adequate persistent structure; do not prebuild a complete event-sourcing framework without measurements.

## Subsequent upgrades

1. The main agent fixes the target release and SHA, then compares the old baseline, upstream changes, and application differences. Existing work does not automatically restart for every release.
2. Prepare the upgrade in an isolated workspace and review rules, configuration, protocols, models, browsers, persistent formats, telemetry, installation, and release targets. A conflict-free text merge does not establish behavioral compatibility.
3. Adapt through shared Git history. Retain necessary product differences and remove duplicate implementations only when upstream fully covers them and regression evidence confirms it. Migrate official removals/renames to the new structure.
4. Update RulesMap, RepositoryMap, IntegrationSurfaceRegister, PatchManifest, and lockfile/BOM. Regenerate through official entry points and check affected consumers, not only added lines.
5. Run applicable official checks and product regressions, repeating affected P/V scenarios. Retain old sessions, runs, shared attachments, and failure histories. Missing platforms or credentials must not be reported as passed.
6. Produce reviewable upgrade artifacts and data migration/rollback evidence. Integration, pushes, and releases follow explicit user authorization; runtime version switching follows DD12.

Do not overwrite the old repository with a downloaded new-version directory. Do not hot-swap a running Host, browser, model route, rules, or executor. Ordinary updates inspect every unsettled run. If the old program cannot continue, use DD12's freezing, compatibility checks, recovery-only mode, and recovery through linked new runs. Freezing is not cancellation or completion; UNKNOWN does not reset, and a Git rollback is not a data rollback.

Upgrade handoff retains the baseline, rule changes, patch disposition, migration results, actual commands and evidence, and remaining gaps. G01 establishes that rules were actually applied; G16 establishes consistency between rules, implementation, and results after an upgrade. Missing verification remains unexecuted.

## Alternatives considered

**Recorded choice.** Following daily master or independently upgrading dependencies would invalidate the selected baseline. Copying a separate compatible rule set would drift from upstream.

## Acceptance criteria

Execute this proposal’s normal and failure controls and satisfy the [shared acceptance criteria](../testing/2026-09-28-web-testing-acceptance.md) and applicable task evidence requirements. Documentation migration does not establish a pass.

## Risks

The selected pre-release has known gaps. Acquiring its source does not validate patches, runtime feasibility, or a later upgrade.
