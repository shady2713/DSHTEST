# Agent Note: Agent development and collaboration guide

Status: proposed

English | [中文](2026-09-28-web-testing-agent-guide.zh.md)

## Problem

Incoming agents need unambiguous fact owners, write ownership, dependency evidence, and authorization limits.

## Proposal

Audience: the main development agent taking over this project and its subagents. The user revoked the decision to wait for an upstream embedded browser. Existing development authorization covers bounded local browser integration and the [eligible M1 subitems](2026-09-28-web-testing-tasks-m1.md#development-admission), subject to their evidence and stopping conditions. M0 remains unpassed; neither the prototype nor eligible subitem implementation establishes whole-card, stage, or product acceptance. Commits, pushes, PRs, releases, deployments, and external messages still require explicit authorization.

Current continuation gaps: the baseline already has an embedded webview and desktop assembly; P01 lacks controlled automation integration and actual qualification, so complete P03 browser-lifecycle acceptance remains blocked. The rc.1 audit's cached Electron 44 exited with `0x80000003` even for `--version`; recheck the current runtime under R0 before drawing API conclusions. [M0-T03](2026-09-28-web-testing-tasks-m0.md) owns the concrete probe sequence. Preserve P06's partial results, verify the latest retests against its protocol, and retain the user's human-reference deferral to M5 without claiming time savings. Recheck P07's ordinary Session/fork and real export-reader integration against current evidence. Keep historical and current evidence separate in one TaskRegister rather than promoting old-baseline passes or treating superseded blocking decisions as current instructions.

## Taking over and locating authoritative information

First read the [upstream root rules](../../../../AGENTS.md), [fixed baseline](2026-09-28-web-testing-upstream-baseline.md), this guide, the current [task card](2026-09-28-web-testing-tasks-m0.md), and its related requirements, interfaces, and acceptance criteria. Then read all applicable rules, code, and prerequisite handoff evidence in the actual repository. Do not start from a conversation summary, proposed package name, or a previous agent's claim of completion.

This is a single-user Windows desktop Web testing tool. The user supplies all project code and an already running URL. The application generates and confirms cases, actually operates pages, controlled native windows, and permitted backend entry points, and produces reports without modifying tested source/configuration/dependencies. Authorization to develop this application permits changing its own repository. Do not apply the product's read-only restriction to the development workspace, or expose an arbitrary terminal to the product merely because development has shell access.

[Product requirements](../feature/2026-09-28-web-testing-requirements.md) alone define requirement scope; [Test case and report specification](../feature/2026-09-28-web-testing-test-case-report-spec.md) defines report semantics; [Acceptance criteria](../testing/2026-09-28-web-testing-acceptance.md) defines pass conditions. Interfaces belong in the [architecture](../architecture/2026-09-28-web-testing-architecture.md) and DD documents; stage admission and P01–P08 timeboxes belong in the [milestone plan](2026-09-28-web-testing-milestones.md). Task cards own prerequisites, steps, assignments, and deliverables; the [coverage table](../testing/2026-09-28-web-testing-development-coverage.md) owns AC/G/V accountability mappings.

Implementation uses dsh-v0.2.0-rc.2 under the user's upgrade authorization and does not automatically follow later releases. Follow the [incremental-upgrade review](2026-09-28-web-testing-upstream-baseline.md#rc2-incremental-upgrade) for desktop CLI, user-question modes, model routes, preset/sidebar interfaces, and inherited-rule changes; affected runtime evidence remains pending revalidation. CODE_ROOT is the current DSH repository root; DOC_ROOT is CODE_ROOT/docs/developer/web-testing. Detailed specifications remain proposed Agent Notes. Preserve historical .artifacts/web-testing evidence with its original baseline and inputs; it is not evidence that the new combination passed. Refresh M0-T01's baseline, RulesMap, RepositoryMap, CheckPlan, and integration records for this combination. Reuse the existing workspace and resolve paths without personal usernames.

These specifications are proposed Agent Notes classified as feature, architecture, process, and testing. Proposed means the product or implementation plan is not implemented; it does not revoke confirmed requirements. [The baseline document](2026-09-28-web-testing-upstream-baseline.md#document-languages-and-entry-points) governs languages, pairing, and the root and application README entries. Upstream rules and code remain in place; the root README preserves upstream content and adds only an application navigation link. After implementation, update the applicable decision lifecycle and maintain implemented contracts beside their packages; do not initialize another Harness governance system.

## Main agent and subagents

The default recommendation is a main agent plus at most 3 concurrent subagents, not a required minimum. Work sequentially when tasks are not independent, tools do not support subagents, or only one directory can be modified. Delegate complex, lengthy work that can be isolated; do not split tiny tasks merely to fill slots.

| Role | Responsibilities | Responsibilities it cannot replace |
|---|---|---|
| Main agent / integrator | Interpret requirements, determine dependencies, maintain contracts and write ownership, integrate, control stage scope, resolve user questions, and accept final results | Do not treat a subagent's self-reported pass as final, or let implementers relax business/permission decisions themselves |
| Implementation subagent | Complete a card or explicit deliverable, write relevant normal/failure controls, and deliver files and evidence | Do not replace the baseline, silently add public interfaces, modify another task's files, or sign off final acceptance |
| Probe / fixture subagent | Check upstream interfaces, conduct bounded experiments, and create resettable examples and independent answers | Do not put expected answers into the execution agent's context or use mock results as proof of actual operation |
| Independent review subagent | Seek counterexamples against requirements, actual changes, and evidence; check scope violations, gaps, recovery, and upgrade effects | Read-only by default; do not silently change implementation/acceptance during review or authorize new scope for the user |

Normally use two slots for nonoverlapping implementation or probes and the third for review/fixtures. When three probes are independent, all three slots may run probes first, followed by independent review. While subtasks run, the main agent continues integration, read-only review, and preparation; it uses completion notifications or bounded waits rather than repeatedly polling unchanged status.

Each task card's execution assignments and handoff specify delegation boundaries. Task IDs do not identify permanent agents. One agent may handle consecutive related tasks, but responsibility, write scope, and evidence must be defined again. Do not recursively expand the team without the main agent's arrangement.

## Assignment and file ownership

Before assignment, record taskId, dependency-evidence versions, allowed read/write paths, interface revisions, expected artifacts, test entry points, reserved devices, and stopping conditions in one TaskRegister. Write scope must name actual files/directories resolved in RepositoryMap. Proposed package names locate intended work; they do not establish existing APIs. Before contracts are settled, parallel work may conduct read-only investigation or propose concrete drafts, but must not implement incompatible competing types.

| Shared object | Exclusive write arrangement |
|---|---|
| Root/package manifests, pnpm-lock, tsconfig, Cordis profile/bundle | Main agent or explicitly designated integrator; subtasks provide required changes and the owner applies them |
| Public ID/schema, Typert Remote, Host protocol, domain formats and migrations | The contract owner edits and informs every consumer; work is incomplete until consumers have recompiled/verified |
| Generated files, directory catalogs, translation pairs, and snapshot expectations | The relevant source owner generates and reviews them through official entry points; do not edit manually or concurrently run generators writing the same output |
| The same Test Runtime state machine/commit core or Browser provider target implementation | One implementation task writes at a time; other tasks read accepted contracts or perform read-only review |
| Windows desktop, test accounts, browser profiles, data roots, exclusive locks, and fault fixtures | Each experiment has explicit ownership; focus capture, fault injection, installation, and resource measurements run sequentially on the same device |

Do not concurrently write the same file in one workspace or rely on later merging to offset overwrite risk. Isolated worktrees/checkouts may support independent work, but do not remove shared dependencies, protocol obligations, or integration responsibility. Without commit authorization, hand off reviewable diffs or files; do not commit/cherry-pick merely to support a merge workflow. The main agent checks existing changes, hashes, and ownership before integrating into the local workspace, preserving unrelated user edits.

A subagent that needs a larger writeSet or a changed public contract first explains the concrete reason and consumer impact. The main agent reassigns and releases ownership within authorized scope without repeatedly asking the user about routine implementation choices. User decisions are needed for product scope, protection level, a different overall baseline, missing necessary information, or external permissions. The main agent returns review findings to the existing owner or explicitly changes ownership, preventing review and implementation from overwriting each other.

<a id="recommended-execution-waves"></a>

## Recommended execution waves

This table recommends scheduling; exact card prerequisites and accepted component evidence determine admission. Parallel work also requires nonconflicting files, devices, data, and interfaces; otherwise run sequentially. Within authorized scope, the main agent may assign ready tasks without asking the user to confirm each card.

| Stage | Recommended arrangement | Integration and acceptance point |
|---|---|---|
| M0 preparation | Main agent completes T01 first; fixture agent completes T02 while another agent may check upstream interfaces read-only | Fix BaselineManifest/RulesMap/RepositoryMap/CheckPlan; independent fixtures have resets and answers |
| M0 first group | Verify T01 records and current T07 ordinary-request comparisons; T08 records no stage admission and evidence-based eligibility for M1 subitems. Diagnose the Electron runtime; T04 storage may proceed independently | Preserve current fixes and reproduce a recorded failure before classifying it as active. T07 verifies upstream-integrated #4595/#5214; restore Electron before evaluating guest/CDP behavior |
| M0 second group | T03 adds a finite Host/Main broker, tests the existing webview, and compares an independent WebContentsView under identical scenarios; complete T05 browser lifecycle after accepted P01/P05 evidence | Revalidate affected T04/T07/T10/T11 components independently. T06 external-browser/native evidence cannot establish P01; a single-page success cannot close the complete browser matrix |
| Before M0 closure | T09 product effectiveness and T11 recovery updates may run concurrently with independent answers/devices; retain the human-reference deferral to M5 | T08 may perform interim reviews now; a full-admission decision waits for all required evidence, including unresolved P06/P07 items |
| M1 | Follow the [eligible-subitem table](2026-09-28-web-testing-tasks-m1.md#development-admission) and its actual prerequisite evidence; proceed from assembly/isolation to consumed definitions/storage, configuration/policy, and ordinary conversation | One owner for public Remote/schema/profile; disabled browser actions remain unavailable. Real browser observation/actions and whole-card or stage acceptance keep their complete prerequisites |
| M2 | T01 fixtures → T02 analysis → T03 cases → T04 execution → T05 assertions → T06 backend → T07 data → T08 reports → T09 integration | Strong main-chain dependencies require sequential work. Other subagents review frozen contracts, prepare fixtures, and build failure controls; do not prebuild fictitious downstream interfaces |
| M3 | After T01 recovery, T02 model retry and T03 control may run in parallel in different files; then split T04 stalling and T05 space; T06 → T07 | Runtime's shared state machine and commit protocol always have one writer; fault experiments do not compete for a data root |
| M4 | Schedule T01 native, T02 external browser, T04 time, T05 regression, and T06 Skills across at most 3 slots as prerequisites permit; T03 waits for T01/T02; T07 waits for T05 and the lightweight route; T08 waits for T03/T04 | T09 consolidates fixtures and independent answers; T10 aggregates capabilities and the complete resource budget. Cua/native-focus tests run sequentially; model-benefit comparisons use the same frozen fixtures |
| M5 | T01 build/install → T02 update; T03 full acceptance and T04 24-hour testing run concurrently only on independent environments with the same candidate combination; T05 → T06 | Other acceptance work must not alter or occupy the 24-hour workload. Changes to candidate code/dependencies require impact analysis and repetition of affected evidence |

Partial prerequisites are allowed only where explicitly documented. M0-T05 and M0-T09 may consume T07's accepted main route while its lightweight subroute remains unaccepted; T07 as a whole remains incomplete. M0-T08 may record M0 as unpassed and permit the [listed M1 subitems](2026-09-28-web-testing-tasks-m1.md#development-admission) after checking their evidence. This does not admit the complete M1 stage or real browser operations; full admission still requires core P01/P02/P03, P05 main-route, and P06/P07/P08 evidence. M4-T07 requires accepted lightweight-route evidence. Do not interpret any other unaccepted prerequisite as complete.

## Fixtures, interfaces, and handoff

M0 artifacts are actual inputs to later tasks, not descriptive placeholders: BaselineManifest, RulesMap, RepositoryMap, CheckPlan, IntegrationSurfaceRegister, FixtureManifest, ProbeResult, BrowserCarrierDecision, StorageDesignDecision, ProductEffectivenessResult, AssetLifecycleDecision, and RecoveryUpdateDecision. These are document-defined names. T01 chooses real file locations under official rules; do not invent existing service APIs.

The subsequent main paths are shared definitions/Remote → one domain commit/policy owner → controlled target execution/facts → assertions/reports; model configuration → ctx.llm → Session records → durable retries; and case/rule versions → execution instances/action slots → historical regression. Downstream work checks actual prerequisite types, errors, cancellation, persistence, generation, and versions instead of copying public definitions.

The acceptance-fixture agent holds the independent Oracle. The testing tool and its execution model must not read hidden defect inventories or acceptance logs. Create execution with fresh context containing only the tested project, public requirements, confirmed rules, and necessary tools; do not fork conversation history containing hidden answers. Separate repair fixtures from held-out validation fixtures. An example whose answers have been seen cannot remain an unfamiliar validation set. Fixture edits occur only in development-owned copies, respecting tested-project read-only restrictions.

Each subtask hands off the following fields. Update the single TaskRegister only after main-agent acceptance:

| Field | Content |
|---|---|
| taskId/status/owner | Task, owner, and not started/in progress/waiting for external conditions/awaiting review/accepted/rework required; list component statuses separately |
| baseline/inputs | Baseline SHA, PatchManifest, current diff/file digests, prerequisite deliveries, and interface versions |
| writeSet/changes | Actual modified files, generated artifacts, persistence and upstream differences; reasons for scope changes |
| contracts | New/changed public inputs and outputs, errors, cancellation, resource ownership, and consumers |
| evidence | Actual commands, cwd, environment, exit codes, normal/failure controls, evidence locations, and externally observable facts |
| gaps/resources | Separate incomplete, unexecuted, and failed items; blocking reasons, recovery conditions, active processes/devices, and unsettled operations |
| next/review | Consumers allowed to start, prohibited starts, review findings and dispositions; do not declare downstream acceptance |

Before stage handoff or a context switch in long work, update one compact checkpoint: objective and scope, fixed version, accepted results, current file owners, running jobs, pending work, and evidence locations. Store large logs separately and link them. On recovery, verify processes and workspace state before repeating any action with an unknown outcome. Reuse passed checks whose inputs have not changed; repeat relevant parts only for new changes, failures, or evidence. Formal delivery still completes all applicable checks.

## Verification and stage admission

After task self-checks, a non-implementer examines requirements, changes, and failure controls; the main agent then checks integration and necessary cross-module scenarios. Review does not mean repeating full-repository tests for every small change; it establishes that evidence covers the risk. Do not resolve failures by changing expectations, deleting cases, weakening coverage, or disabling protection.

CheckPlan follows scripts at the fixed commit and applicable rules. The following are entry points to locate, not execution records; M0 verifies arguments, platforms, keys, and dependencies.

| Change category | Entry points and evidence |
|---|---|
| Source, types, and packages | typecheck, lint, duplication, applicable hygiene/constraints; official Host builds/contract generation precede Client consumption |
| Behavior and coverage | Owning tests, test:coverage, and top-level invariants; follow per-file requirements and actual Loader assembly |
| Model-visible and user-visible behavior | Applicable test:snapshot, test:expected, test:web, and other entry points; review recording/expectation refreshes rather than silently rerecording |
| Session/persistent formats | verify-persistence-changes and relevant format/release checks, reading actual old fixtures and interrupted samples |
| UI/formal documentation | Typed locale, relevant UI checks, test:docs, doc-sync, bilingual consistency, and generated-output consistency |
| Release/Windows | Actual built smoke tests, applicable platform checks, package:desktop:win:x64:unsigned; native Win10/11 installation and operation |

Use `pnpm run <入口>` for commands, but do not paste script fragments containing POSIX environment-variable syntax directly into PowerShell. Actual model requests use only authorized providers and credentials; do not put secrets in chat, logs, or handoffs. Mark missing environments/credentials as unexecuted and continue independent tasks. Missing evidence for a required check stops its downstream work; pure mocks or screenshot demonstrations cannot replace actual verification.

Passing under WSL cannot replace native Windows input and installation evidence. Track the browser matrix, 24-hour resource thresholds, model quality/benefit, and every AC/G/V through the [coverage table](../testing/2026-09-28-web-testing-development-coverage.md). Stage completion and product completion are distinct. M5 cannot disguise a required capability missing from this tool as an unverified part of the tested project.

<a id="dispatch-instructions"></a>

## Copyable assignment instructions

For continuation, assign resumed browser integration, M0 revalidation, and explicitly eligible M1 subitems while keeping stage acceptance distinct. The following instructions are for future copying by the user; organizing these documents does not execute them.

```text
请作为主开发 agent 接续本仓库 Web 测试桌面应用。我已撤销“暂不建设内嵌浏览器、等待上游”的决定。本次接续包括恢复浏览器受控接入、M0 复验及 M1 开发准入表明确列出的有限子项；不得将它们的实现视为整卡或阶段通过，也不自动扩展到 M2–M5。

当前工程目录就是 CODE_ROOT，DOC_ROOT 为 CODE_ROOT/docs/developer/web-testing。先检查 Git 状态和现有文件，保留所有已跟踪及未跟踪改动。应用文档可能尚未提交；不要只从 Git 历史新建工作区而遗漏它们，不要重新克隆覆盖当前目录。必要文件缺失时索取完整材料，不从聊天摘要猜补。

先读 AGENTS.md 和 docs/developer/web-testing/README.md，再读 .agents/notes/proposed/process/ 下的 2026-09-28-web-testing-agent-guide.md、2026-09-28-web-testing-upstream-baseline.md、2026-09-28-web-testing-milestones.md、2026-09-28-web-testing-tasks-m0.md、2026-09-28-web-testing-tasks-m1.md#development-admission，以及 .agents/notes/proposed/architecture/2026-09-28-web-testing-design-execution.md；按链接读取任务相关需求、报告规格、验收和实际源码。中英文配对同等权威，可使用 .zh.md。历史 artifact 中的“等上游”约束已撤销。基座已有普通 webview，受控自动化 provider／Broker 仍待实现；旧探针证据按原范围保留，不能据此断言全仓没有载体。

基座固定 dsh-v0.2.0-rc.2。从 Git 解析完整提交，核对现有检出、锁文件与全部保留差异；不要自行更换标签或升级依赖。#4595／#5214 已在基座内，不再次回移。保留 .artifacts/web-testing 的历史证据及原输入，复验受影响项；基座切换和文档检查不代表 M0 通过。

按基座文档 rc2-incremental-upgrade 段审查本次 187 个提交的实际影响；rc.1 结果保留原版本，受影响运行场景待复验。Desktop 随附 CLI 的插件管理不能替代 GUI 启动或 desktop 配置 dump。用户问题仍默认 legacy，timed 仅显式启用；超时／pending 不是业务授权，迟到答案按 M1-T05／T06 核对问题、动作及当前修订，P06 未确认意图保持缺口。Creator／默认预设不依赖 developerTools 开关作为保护，须在实际装配及执行处拦截；采用当前侧栏接口，不恢复 SidebarRightBinding。实际模型路线按解析的提供方版本与能力复验。

本次授权上述范围所需的本地依赖准备、自有样例、最小实现、上游已含修复的归并复验、构建和验证；所有保留代码遵守 DSH 原有架构、工具链和检查要求。使用真实官方扩展点及受支持的 dsh profile 启动路径，不编造接口、不另建 agent loop、不降低检查标准。被测项目源码、配置、依赖和 Git 保持只读；开发本应用的源码不受该产品只读限制。

先核对 M0-T01 规则、工程映射、检查计划和当前证据。M0-T08 现在就可记录“M0 未通过＋有限子项开发许可”；按 M1 开发准入表逐项核实实际输入、消费者、停止点，不能因为整卡未验收而冻结所有独立工作，也不能把有限许可扩大为完整准入。普通模型请求及 REQUEST_EXTENSION 以当前对照为准，保留修复，不凭历史失败重复停工。保留原时间盒及历史耗用；需要追加或重分配时，由你在既有开发授权内记录问题、预算和停止点，不反复要求我逐卡批准，也不承诺原估算的 15–25 工程日。

浏览器主线按 M0-T03 执行：先复核 rc.1 审计记录的缓存 Electron 44 连 --version 都以 0x80000003 退出的问题，取得可运行环境后再判断 API。基座已有 apps/desktop/src/browser-guests.ts 和 packages/client/ui-sidebar-browser 中的真实 webview，缺的是受控自动化。先为现有载体接入有限 Host／Main broker，在同一可见页验证观察、点击、输入、截图及错误目标、旧观察、断连后拒绝操作；再用独立 WebContentsView 对照相同场景，按任务卡补角色隔离、iframe、弹窗、下载、焦点及生命周期。不要复用带账号权限的 platform view，不开放任意 CDP／脚本或全局调试端口，不关闭 sandbox；不同时建设两套完整产品。Target.setAutoAttach 未验证不能阻止主页面探针，切换载体也不保证解决 CDP 问题。按实际证据选择载体并重新估算，单页面通过不能代替完整 P01／P03。

独立推进准入表中前置已验的 M1 子项；公共 schema／Remote 只为现有消费者设计，未实现浏览器动作保持禁用，真实浏览器观察／动作仍等待 P01／P03。P05 限流使用受控 429 沿真实 Loader／Agent 链验证重试、取消和恢复，不故意打满真实额度；真实主模型请求另留证据。桌面取消经实际 UI／Remote 路径验证，SDK 缺少线协议取消指令单列，不泛化成桌面不能取消。

你负责工作安排与集成；支持 subagent 时最多同时使用 3 个，限定任务、真实文件写入权、资源占用、输入和交付证据，避免并发修改同一文件。不支持时顺序推进，并保留必须独立审查但尚未接收的项目。产品执行模型不得接触隐藏答案；持有 Oracle 的独立验收方核对结果，已泄漏答案的执行样本必须更换。P06 人工参照按用户决定延期至 M5，不能由模型编造人工用时或宣布收益通过；其余规则与覆盖缺口仍须补测。

实际运行适用的正常与失败对照。模型、浏览器、原生输入、持久恢复及产品有效性必须按任务要求取真实证据；mock、截图或检查通过不能替代运行验收。查阅已有检查失败记录；环境受限时说明原因和恢复条件，不跳过测试、不修改预期来制造通过，不自行修改系统权限。

只使用已配置且获授权的模型凭证，不把密钥写入对话、日志或交付。缺少凭证、设备或其他必要条件时，保留阻塞及恢复条件，并继续不依赖它们的工作。区分失败、未执行和 UNKNOWN；不能因重试或恢复而盲目重复业务动作。

持续完成本轮已授权且可推进的工作，不在输出计划或完成单张卡后结束。维护一个 TaskRegister 和简洁的恢复检查点，记录版本、改动、证据、运行资源及下一步。常规实现安排自行处理；必须改变需求、保护程度或整体基座时，提供具体证据和方案再询问我。

未经另行明确授权，不 commit、push、创建 PR、发布、部署或发送外部消息；不修改其他项目，不把阶段准入当作后续阶段授权。

交付 M0-T01 至 M0-T11 及本轮准入 M1 子项的真实状态、变更文件、基座与补丁清单、实际命令及退出码、正常／失败证据、剩余问题和 M0-T08 结论。区分环境故障、实现待办、缺验收证据和外部条件；列明载体对照结果、未验证 API、实际耗时及下一步。整卡或阶段前置未满足仍记未通过；未运行、失败或待独立接收不得写为通过。请先简要报告接手核验和执行安排，然后开始执行。
```

For later stages, specify scope using this template. If prerequisites are missing, identify the gaps first and continue independent work within the current scope.

```text
请执行 <阶段或任务ID集合>，按 AGENTS.md 和 .agents/notes/proposed/process/2026-09-28-web-testing-agent-guide.md 接手；可使用相应的 .zh.md 配对文件。
本次授权该范围所需的本地实现、依赖准备、构建、验证及有明确边界的subagent委派；既有需求和基座保持。
先核实前置代码、接口和证据，再按每卡步骤与验收完成；由主Agent集成与复核，保留无关用户改动。
在授权范围内持续推进，不扩大到其他阶段；外部动作仍按既有明确授权办理。
交付实际文件、接口、测试证据、未完成项和下游准入结果，更新单一任务记录与当前检查点。
```

The main agent's assignment to a subagent must instantiate this format:

```text
角色：<实现/探查/材料/只读审查>；任务：<唯一ID及明确子范围>。
输入：<DOC_ROOT、CODE_ROOT、基座/补丁/约定版本、前置交付链接、适用R/AC/G/V/P>。
允许修改：<真实路径列表>；禁止修改：<共享文件、其他任务目录及用户数据>。
目标/步骤：<本卡的具体部分>；验收：<正常及失败对照、实际命令、必须真实运行的部分>。
接口/资源：<消费方、取消和持久化边界、设备/数据根/端口占用>。
停止条件：<缺什么不能继续，接口变化向主Agent报告；不自行改范围或底座>。
交付：<按本指南的字段，附实际diff/文件、证据和未完成项；不得自签集成验收>。
禁止再次派生subagent，除非主Agent明确分配独立范围和并发额度。
```

## Alternatives considered

**Recorded choice.** Filling every parallel slot or letting agents edit shared files concurrently does not resolve dependencies. Sequential work is required when ownership or devices overlap.

## Acceptance criteria

Execute this proposal’s normal and failure controls and satisfy the [shared acceptance criteria](../testing/2026-09-28-web-testing-acceptance.md) and applicable task evidence requirements. Documentation migration does not establish a pass.

## Risks

Subagent self-reports and stale handoff paths can create false readiness; the main agent remains responsible for integration and final verification.
