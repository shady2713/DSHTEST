# Agent Note: 详细设计：数据与恢复

Status: proposed

[English](2026-09-28-web-testing-design-recovery.md) | 中文

## 问题

长程测试必须在故障后保留权威结果，避免重复业务副作用或丢失共享证据。

## 提案

状态：产品设计提案；分项探针和原型工作不代表最终实现或验收通过。本文细化[总体设计](2026-09-28-web-testing-architecture.zh.md)的 I02；调用及实际执行见[接口与执行](2026-09-28-web-testing-design-execution.zh.md)，模型重试与发行见[模型与发行](2026-09-28-web-testing-design-models-release.zh.md)。结果语义以[报告规格](../feature/2026-09-28-web-testing-test-case-report-spec.zh.md)为真源。

阅读顺序：DD06 数据 → DD07 提交与所有权 → DD08 调度恢复 → DD09 快照、证据和报告。下述字段为拟定领域 schema，正式实现从 zod 声明推导类型；不是另起一套手写的 TypeScript／JSON／RPC 三份定义。

**DD06：标识、记录和存储划分**

所有业务 ID 为不透明品牌类型，不从 ID 解析时间、文件位置或业务字段。revision 为实体内单调递增的安全整数；时间保存 UTC 时刻，业务时间另记 IANA 时区、当地时间和适用规则。长期调度保存绝对 dueAt，单次操作耗时使用单调时钟；系统时钟跳变触发等待重新核对。

| 记录 | 必需字段，除公共 id／schemaVersion／createdAt 外 | 修改规则 |
|---|---|---|
| ProjectRevision | projectId、revision、codeRoots、entrypoints、identityRefs、viewportProfiles、observationChannels、protectedRoots、runtimeDataRoots | 不可变；凭证只有引用。 |
| EnvironmentDeclaration | projectRevisionId、entrypointRefs、kind、identity／tenantRefs、dataScope、relatedConfigDigest、acceptedByMessageRef、observedConflicts | 不可变；kind 为 test／production／unknown，声明与观察事实分开。 |
| SourceSnapshot | projectRevisionId、manifestRef、captureStartedAt／endedAt、consistency、unreadItems、contentDigest | 不可变；保存实际分析内容及缺口。 |
| RuntimeIdentity | entrypointId、claimedVersion、observedSignals、confidenceKind、checkedAt | 新观察追加；confidenceKind 为 verified／user-declared／unknown。 |
| Requirement／FeatureRevision | stableId、revision、description、sourceRefs、expectationAuthority、relations、uncertainties | 推断与用户确认分开，不因代码变动覆盖旧业务预期。 |
| CaseVersion | caseId、version、featureRefs、steps、assertions、dataPlan、applicableConditions、skillRevisionRefs、expectationRefs | 不可变；steps 和 assertions 各有稳定 ID；关键规则另含 criticalRuleReviewRef，确认必须绑定具体规则修订 |
| PlanRevision | runId、revision、sourceSnapshotId、baselineRefs、caseVersionRefs、instanceManifestRef、scopeChanges、openQuestionRefs | 不可变；记录初始、增补及移出范围。 |
| ExecutionInstance | planMembershipId、caseVersionId、environmentRevisionId、roleFlow、browserProfile、viewportProfile、dataSet、faultScenario | 计划内稳定；适用维度确定后生成，不用重试增加实例。 |
| Attempt | instanceId、attemptNo、purpose、startedAt、finishedAt、priorAttemptRef、preconditionEvidenceRefs | 新一次完整执行／补测才新增；同一步模型重试不新增。 |
| ActionRecord | operationId、attemptId、stepId、actionSlotId、stepRevision、actionOrdinal、kind、inputRefs、targetRef、observationId、effectClass、dispatchState、outcomeState、receiptRefs、reconciliationRefs | 每次变更形成不可变修订；交付与业务结果分别记录。 |
| AssertionResult | assertionId、instanceId、attemptId、expectedRef、expectationAuthority、authorityRevisionRef、applicabilityRef、actualRefs、observationComparison、verdict、reasonCode、verifier、evidenceRefs | 不覆盖；诊断匹配与业务判定分开；仅实现推断不得产生业务 passed。 |
| Question | kind、affectedRefs、prompt、options、raisedAt、answerRevisionRef、handling | business／interaction／authorization／environment 分开，等待行为不同。 |
| ActionAuthorization | kind、draftRevision、environmentDeclarationRef、planRevisionRef、action／caseRefs、dataScope、limits、validUntil、acceptedByMessageRef；外部服务另含 service | kind 为 environment-action／external-service；范围独立核验，未知发送占用待结算名额。 |
| DataLedgerEntry | entityRef、creationOrigin、actionRefs、beforeEvidenceRefs、dependencies、retentionReason、cleanupStatus | 可追加修订；已有数据不能冒充本轮新建。 |
| Issue／Disposition／RetestLink | instance／assertionRefs、symptom、impact、reproduction、codeSuspects、evidenceRefs、userDecision、linkedRunRefs | 缺陷事实、推测定位、处置与实际复测分别记录。 |
| SkillRevision | skillId、revision、manifestRef、dependencyRefs、digest、acceptedByMessageRef、scope | 草案和已采用版本分开；运行不读取后来改变的活动目录。 |
| ReportRevision | runId、revision、committedRunRevision、planRevisionId、resultManifestRef、evidenceManifestRef、cleanupRevisionRef、completeness | 不可变；后续清理和补测产生新版本。 |
| ProgressCheckpoint | runId、phase、lastMeaningfulCommitRef、progressKind、activeElapsedMs、repeatSignature、recoveryCycle、waitReason、nextCheckAt | 由已提交事实派生并持久化，不把每次模型调用当进展。 |
| StoragePolicyRevision／SpaceSample | 可选 maxOwnedBytes、预警／安全余量、采样周期、控制预留；卷身份、容量、剩余及采样时刻 | 策略版本化，默认无硬配额；事实采样不代表未来一定有空间。 |
| AssetCleanupPlan／AssetDisposition | 批次／资产引用、引用快照、保留原因、预计独占可释放字节、确认消息、逐项处置与结果 | 先预览后确认；处置历史追加，不能伪造证据仍存在；正式引用生命周期按下述 P07 扩展路线实现，不能假定上游已有删除服务 |

FrozenRunManifest、RecoveryUpdateIntent 与 RecoveryLink 是拟新增的恢复记录：分别保存一致封存清单、包／数据／锁／备份身份及恢复阶段、旧新批次与未结算动作的关联。定义归 Runtime／安装协调器的明确持久边界，不能另建会话日志。未知动作按原 operationId 保留核实责任，跨新批次查询并阻止同一语义的重复派发；若不能确定关联业务是否相同，保持阻塞。恢复写入者与普通 Runtime 争用同一控制根锁，绝不并写。

RunHead 是批次提交入口，至少包含 runId、headRevision、phase、status、ownerEpoch、controlEpoch、planRevisionId、committedViewRef、lastCommitRef、activeAttemptRefs、unsettledOperationRefs、waitRefs、outboxRef、latestReportRevisionId、recoveryRequired、updatedAt。大集合使用有版本的分页 manifest（元数据清单） 引用，不能让头记录随每次截图或动作无限增长。

执行工具不信任模型传入的 operationId。Runtime 根据已提交 instanceId、attemptId、stepId 和 actionOrdinal 分配操作身份，并保存动作语义哈希。每个步骤另有持久化 StepCursor，记录 stepRevision、当前 actionSlotId 及已消费槽位；工具请求绑定生成它时的槽位、观察和修订。同一槽位同一语义返回原动作及当前结果，包括已结算动作；同槽位不同语义拒绝，旧修订不自动分配下一序号。只有 Runtime 根据新观察和用例推进提交新槽位，才能接受下一次动作。连续键入等多个合法动作分别记账；重复 toolCallId 与重复业务动作不是同一层身份。

领域数据通过 ctx.storageDomain／ctx.storage.domain 和 defineDomain、domainTable 访问。SQLite／single layout 作为首版候选，由 P02 核对访问模式和实际组合后登记 StorageDesignDecision；不从业务包直接连接 SQLite。必须严格拒绝不兼容或无效权威记录；不使用 backup-and-skip 或把未知版本当缺失的行为保存测试历史。官方领域 update 只有所属实例内的串行原子更新，不是多 Host 的数据库 CAS。[存储说明](../../../../docs/subsystems/storage.zh.md)、[领域声明](../../../../packages/storage/storage-domain/src/spec.ts)

以下分段物理组织是 P02 的比较候选，不是已冻结实现。为避免打开应用就把所有历史动作载入内存，该候选按资产和批次分单元：小型 catalog 保存项目及批次入口；每批次 control domain 保存 RunHead；计划／用例资产和运行事实按不可变 segment 保存；跨批次列表为可重建索引。一个 owner factory 以同一份 schema 创建经过验证的单元名，名称只使用内部 ID 和序号，不包含用户路径。

catalog 的 CatalogHead 是资源登记的权威入口，引用分段的创建意图、已发布资源和 commandId 回执索引；界面历史列表仍是可重建投影。ProjectHead 和 SkillHead 分别提交本实体的活动修订及命令回执，不能由文件修改时间推断当前版本。头记录保持有界，索引和历史按不可变 manifest 分页；只有已发布入口才进入正常分析／执行调度。

活动 segment 的建议轮转点为 1,024 条业务记录或 8 MiB 序列化内容，任一达到即在完整记录边界轮转；这是实现配置建议，不是任务长度上限。封存 segment 不再修改，只在查询、恢复或报告需要时打开；当前 segment、所需检查点和少量最近页面保持打开。打开的领域句柄必须有引用计数及关闭所有者，跨并发调用共享同一已打开句柄，不能重复 open 同名 domain。

建议每 128 次业务提交或报告生成前形成当前视图检查点，记录成员索引及各实体最新修订引用；历史仍可沿 commit 引用追溯，查询不必从第一步重放全部记录。CommitRevision 描述业务变更、前一提交、记录引用和命令回执，不保存另一份模型 token 流、通用工具事件或 Session 日志。分段、manifest、检查点及其数值均为候选实现；M0 必须测量访问成本并比较满足同样约束的更简单方案，再决定保留或调整。业务权威、不可覆盖历史、可恢复控制和官方存储归属是必需约束，内部结构不是已证明必要的框架。轮转与检查点失败不得删除事实或推进 RunHead。

P02 至少比较满足同样持久意图、头提交、去重和历史约束的最小按批次记录方案，以及带 segment／checkpoint 的候选方案；同一材料和故障点测量打开、提交、查询、恢复、内存及实现／迁移成本。先以最小合格结构进入 M1，只有测量显示具体瓶颈且复杂结构解决它时才采用后者。上文分段与检查点是候选物理组织，Head／提交／未知动作的逻辑语义保留；选择写入 StorageDesignDecision，所有后续任务消费该决定，不凭细稿里的数值预建框架。

**DD07：唯一写入者、提交顺序与派发**

首版每个应用数据根仅一个 Host 写入者，可调度多个隔离任务，但不做多个 Host 竞争同一批次。保留官方 Electron single-instance 行为，再为测试数据根增加进程存活期的 Windows 命名 mutex。锁使用 Global 命名空间、固定协议前缀和规范化控制根身份摘要，访问范围限制到当前用户和系统；同一控制根不能因应用版本或安装标识不同取得两把独立锁。Host 在打开权威 domain 前取得锁，由固定所有者线程持有直到执行器、领域句柄关闭。其他 Host 不因超时或租期到期自行接管；旧进程真正退出、锁可取得后才恢复。WAIT_ABANDONED 进入恢复核对，不作为干净退出。[官方单实例实现](../../../../apps/desktop/src/single-instance.ts)、[Windows mutex](https://learn.microsoft.com/en-us/windows/win32/sync/using-mutex-objects)、[跨登录会话命名空间](https://learn.microsoft.com/en-us/windows/win32/termserv/kernel-object-namespaces)

mutex 封装是拟新增的窄范围 Windows 能力，按 native 模块规则实现和验证；它不冒充 DSH 已有公共服务，也不复用安装或配置事务锁持有整个 Host 生命周期。控制根是保存数据代际指针的稳定目录，锁依据最终目录身份而非指针当前指向的候选数据目录；升级切换代际不改变锁身份。数据根别名和 junction 必须归一到同一实际目录身份；无法确认唯一所有权时拒绝写入和派发，而非降级为内存锁。首版不支持运行中搬移控制根，跨 Windows 登录会话启动也须争用同一个数据根锁。

Host 每次成功启动生成新 ownerEpoch。所有活动 Agent（智能体）、目标、派发许可和返回值都携带该代次；同一 runId 恢复不意味着旧连接继续有效。Electron Main 与 Host 握手后只认可当前代次，失联时废弃尚未交付的队列项。模型及工具的实际异步等待不得占有 Runtime 的业务提交队列，否则暂停和取消会被它们阻塞。

**业务提交顺序。** 先读取已提交版本，将模型／网络等待、大附件保存和大批材料准备放在提交队列外；准备完成后入短串行队列，重新校验 commandId、预期版本、控制代次和当前状态。只有校验仍成立，才写入有界的业务记录及 CommitRevision，最后一次 RunHead.update 发布引用、headRevision 和通知 outbox。版本已变则重算或返回冲突，不将陈旧候选事实直接推进为执行进度。成功回执以头写入完成为准。单次存储写入仍可能卡顿，暂停／取消另有即时派发门，见下文。

**更新路径必须携带记录的两份副本，且没有任何写入顺序能免掉这一点。** 跨记录无事务，而记录与头同处一个文档，因此已提交的更新无法靠重排变成原子的。对创建而言，前置写入只是恢复时从头引用越过的孤立材料；对更新而言，记录**已经**被头引用，先写新修订会留下悬空的已发布入口，先发布入口又会留下指向不存在内容的入口 —— head-first 只是把悬空引用挪到另一侧。因此记录保留其已发布修订，并把未提交的下一修订放在 pending 槽位；读取时把头入口与已发布修订**或** pending 修订对照解析，使任何中断点都落在记录能回答的状态上。更新分三次写入 —— 暂存、发布头、把 pending 合入 —— 且头携带与创建路径相同的可重放命令账本，故重试返回原回执且不追加任何内容。**已发布实体在跨重启后绝不可变得不可读。**

**首次创建也须可恢复。** 创建项目、批次或 skill（技能） 时，在 CatalogHead 的一次提交中先登记 createIntent，包含 commandId、规范化参数哈希与预留资源 ID；再用相同 ID 幂等建立子实体头；最后将入口发布并保存最终回执。三个阶段之间中断，恢复都沿已登记意图完成或明确记录创建失败，不另分配 ID；未发布入口不得启动执行 Agent。相同命令重送返回原资源和进度，不同参数重用同 ID 拒绝。已有项目／skill 的版本修改经各自 Head 提交，并由原命令引用定位结果，且携带与创建路径相同的可重放账本；资源登记账不是可丢弃的列表索引。

业务动作分两次持久提交：先保存 PREPARED 意图及前置观察，实际派发前再保存 DISPATCHING 和许可身份。随后核验即时派发门、控制代次、目标及执行条件，再交给实际执行者。dispatchState 仅记录 PREPARED／DISPATCHING／RECEIVED；outcomeState 单独记录 UNKNOWN／CONFIRMED_OCCURRED／CONFIRMED_NOT_OCCURRED。观察是追加证据，不是名为 OBSERVED 的成功终态；只有足以结算动作并满足用例推进条件时才推进 StepCursor。DISPATCHING 表示可能已经送达，不能因没有 RECEIVED 就判定未发生。

| 交付／结果条件 | 是否允许自动再次发出同一业务动作 | 下一步 |
|---|---|---|
| PREPARED，明确尚未取得派发许可 | 是，需重新检查目标与条件 | 原 operationId 继续，不新增业务动作。 |
| DISPATCHING／RECEIVED，结果尚未核实 | 否 | 读取目标状态、业务 ID、服务回执或只读日志。 |
| CONFIRMED_OCCURRED | 否 | 保存观察后继续；发生不等于断言通过。 |
| CONFIRMED_NOT_OCCURRED | 视用例、授权及环境条件 | 原动作建立新的交付尝试，保留核实依据。 |
| UNKNOWN，仍有有效观察渠道 | 否 | 保存下一核验时间，继续独立工作。 |
| UNKNOWN，确认已无进一步观察条件 | 否 | 受影响实例阻塞，报告未知操作及补测条件。 |

不宣称对任意网站实现 exactly-once；本工具保证不把未结算操作盲目重放。目标提供可靠幂等键时记录并复用，目标没有该能力时依赖核实，仍可能无法确定。键盘输入部分送达时应读取当前值并按用例恢复；若按键本身触发了提交，转入业务结果核实，不直接全选重输。

CONFIRMED_NOT_OCCURRED 必须有足以排除原请求稍后生效的依据，例如实际执行者确认从未交付，或目标提供明确的终态拒绝且没有遗留异步任务。暂时查不到记录、页面没变化、读取副本延迟、客户端超时或取消请求都不足以证明未发生。存在排队或最终一致性窗口时保持 UNKNOWN；没有可靠核验条件则阻塞，不把等待了足够久当作补发依据。

pause／cancel 到达 Runtime 后立即关闭内存派发门，并向执行者撤销旧许可，不等待大附件、模型或业务网络返回；同时优先排入控制提交，持久化新的 controlEpoch 和决定。回执分开显示本地已禁止新派发、决定待保存／已保存／保存失败、执行者是否确认停止接收及在途动作数。保存未完成不能显示“已保存暂停”；存储失败时保持禁止派发，说明跨重启控制状态尚无保证。resume 只有持久化成功且重新核验环境后才开放派发门。已交付操作无法瞬时撤回，其结果继续核实；迟到模型回答仅作为记录，不能恢复用户已停止的任务。

Session 通知采用事务外 outbox：deliveryId 由 runId、提交修订、事件种类和该提交内固定序号稳定生成；业务提交后追加已注册的测试会话事件，记录 businessRef、revision 和 deliveryId，随后提交投递确认。若追加成功而确认丢失，重投保持同 ID。Session 保存真实追加历史，Client 投影和送入模型的语义通知分别按 ID 去重；只在界面隐藏重复不合格。

模型实际输入、输出和工具调用由 DSH Session 保存。只读查询结果若进入下一次模型请求，也必须经 Session 可重建的工具结果或持久引用进入；不允许从内存注入未记录的业务摘要。后台模型辅助决策在执行 Agent 的已记录工具过程中调用 ctx.llm，保存输入、输出及归属；公共决策格式及候选协议规则见 DD10。

调用 ctx.llm 本身不作为辅助请求已进入 Session 的证明。决策工具在发送前追加有类型的测试决策请求事件，记录 decisionId、requestAttemptId、实际输入引用、routeRevision 和 observationId；响应或失败再追加对应结果事件，记录实际输出／错误、用量和模型版本。同一决策的模型重试共用 decisionId，每次真实请求有独立 requestAttemptId，不与业务 Attempt 混用。只有结果已持久化且观察仍有效，才能采用决策。事件与展示／回放按 DSH 扩展规则实现，领域动作仅引用这些事件，不复制另一套模型日志；保存失败停止采用结果。

**崩溃恢复次序。** 取得独占写入权 → 严格打开 control domain → 核对 RunHead 所引用记录和附件 → 恢复通知投递 → 区分用户暂停／取消与意外中断 → 创建新的活动 Agent／目标代次 → 验证源码、部署、身份及浏览器环境 → 核实所有未结算业务动作 → 按依赖调度可继续实例。通知修复不会触发业务动作；源码或部署版本变化不能被重新登录成功掩盖。

已写入但未被 RunHead 引用的记录保留为待检查孤立材料，不计入报告。垃圾回收只在证明没有权威引用、运行写入者或待提交使用者后处理；本阶段不设计自动删除用户历史。附件不足、数据损坏或格式不兼容明确阻塞恢复，不能呈现为空项目或“没有失败”。

故障恢复更新是独立的人工选择路径，见 DD12。封存后旧批次不进入普通自动恢复；未知动作的核实清单跨 RecoveryLink 继续生效，不能以新 runId／新命令身份规避去重。重启、更新及更换模型都不能清空它。

**DD08：调度、等待和重试**

所选基座的会话归档具有活动检查和停止扩展点。Runtime 必须把排队、执行、暂停、等待、待恢复和未结算批次纳入会话活动判定；首版在这些状态下阻止归档，并在原会话提示先处理任务。归档、关闭卡片或插件卸载不构成用户取消批次；不能让上游归档的 turn 取消动作悄然清空持久任务。具体接入使用所选基座公开扩展点，不修改 Agent 循环。

Run 的 phase 为 analysis／planning／execution／reporting／cleanup，status 为 queued／running／recovering／waiting-user／waiting-time／paused／frozen-recovery／ended／cancelled；phase 与 status 是不同维度。等待及控制不覆盖实例和断言结果。run ended 的结论还需区分 completed-coverage 与 incomplete-coverage，后者列明缺口；cancelled 不能换名为完成。

Instance 的活动调度状态为 ready、executing、waiting、blocked、settled；最终结果仍按报告规格的通过、失败、待确认、阻塞、跳过、未执行表达。单实例失败可以同时含后续未验证断言。Run 有独立可执行实例时保持 running，并在 waits 中显示局部等待；只有全部可推进工作都等待时，才选择对应整体等待状态。

| 事件 | 持久化变化 | 调度规则 |
|---|---|---|
| 开测前业务预期不清楚 | Question＋受影响用例依赖 | 先询问并落实到用例；正式执行和会变更业务状态的数据准备等待开测问题解决，独立的材料读取与分析可以继续。 |
| 执行中出现新业务疑问 | 受影响断言待确认、报告问题 | 本轮跳过受影响部分；答案落实到新用例版本，再建立关联补测。 |
| 暂时 API、网络或限流故障 | Failure＋retryAt＋routeAttempt | 不因达到短重试次数结束任务；冷却后恢复或使用能力匹配的备用路由。 |
| 凭证无效或配置不支持 | 问题与 waiting-user 原因 | 不高速重复无效请求；配置修复事件重新核对后恢复。 |
| 环境声明缺失、范围不足或相关配置变化 | 声明问题、所需授权与受影响范围 | 在正式执行／业务准备前满足 R54；不能沿用不适用的旧授权。 |
| 空间进入保护状态 | 空间采样、受影响保存位置与恢复条件 | 禁止需要新材料的派发，保留在途核验；空间恢复且保存检查成功后再调度。 |
| 有效工作持续无进展 | ProgressCheckpoint、原因、有限恢复次数 | 先恢复或推进独立项；无法推进则等待并提醒，不因计数变大而重置停滞。 |
| 业务定时到期 | 时间条件与 nextObservationAt | 不占用模型等待；到时取证，错过时间窗口则记录缺失证据。 |
| 部署、源码或外部浏览器版本改变 | 环境变更事实与受影响集合 | 隔离旧结果，生成关联版本段或新批次；预期变更需确认。 |
| 用户继续 | 新 controlEpoch＋recoveryRequired | 先核实目标及在途事实再派发，不直接重用旧坐标。 |
| 关闭主窗口 | 无业务终止状态变化 | 保留必要承载资源；需原生输入时恢复目标窗口。 |
| 显式退出 | 保存恢复位置并停止派发 | 不自动重启应用；下次打开对未暂停、未取消批次按规则恢复；frozen-recovery 不自动续跑，按 DD12 的 recovery-only 与关联续测处理 |
| 所有测试已结算 | 固定测试结果版本，进入 reporting | 待核验或临时可恢复项不能被强制结算以凑完成。 |
| 初步报告保存成功 | ReportRevision＋cleanup 计划 | 清理通过受控业务入口；完成后生成报告新修订。 |

模型重试与业务复试由不同配置控制。Agent 主请求由显式装配的官方 llm-retry 插件在请求失败扩展点执行 提供方 的 normal 策略；短重试耗尽后，可恢复故障交给 Runtime 持久调度。直接调用 ctx.llm 的轻量决策等辅助请求不经过该扩展点，故每次请求失败由 Runtime 记录并安排下一次 ctx.llm 调用；需要短重试时按同一 提供方 策略计算，由这一处负责，SDK、适配器 和工具不再各叠加循环。两条路径不得同时调度同一个失败请求。[官方重试插件](../../../../packages/llm/llm-retry/src/index.ts)、[提供方 重试策略](../../../../packages/llm/llm/src/retry-policy.ts)

**工具调度失败的会话恢复。** M0 的 P03／P05 覆盖已记录工具请求、已完成结果、后续准备或调度失败、步骤关闭及真实模型续发；V05 和 M3 沿用此对照。所选基座已包含 #4595 实时修复，仅短重试或重启尾部修复仍不能证明该行为。复验应用组合，保留已完成结果、UNKNOWN 核实和未开始状态的区别；不维护重复 Agent 结果修补循环。

| 会话或业务事实 | Runtime 处理 | 允许继续的条件 |
|---|---|---|
| 已有正式工具结果 | 保留原结果和对应 ActionRecord，不以补齐覆盖 | 核对结果所指的当前动作及提交状态；通过与否仍看断言。 |
| 官方修复输出 TOOL_OUTCOME_UNKNOWN | 映射为需要核实，保持原 operationId／动作槽位 | 取得业务或执行者证据后结算；模型消息合法不等于外部效果已知。 |
| 官方修复输出 TOOL_NOT_STARTED | 先按工具调用身份关联领域意图、许可与派发记录 | 只有同时证明未交付且不存在可晚到的同语义动作，才按 PREPARED 路径继续；不能仅凭文字解除已有 UNKNOWN。 |
| 日志写入失败、已关闭旧历史不一致或工具身份无法对应 | 标记协议恢复失败与受影响范围，保留业务未知状态 | 使用已验证的官方读取／修复范围；不删除历史或新建会话来绕过业务核实。 |
| 取消时尚有已接受的工具派发 | 关闭派发门、排空或结算已接受工作，保留无法确定的结果 | 不重启已取消任务，不因补齐结果而重新调用工具。 |

P03／P05 同时验证工具请求与结果配对合法、已完成结果不丢失、未开始动作不冒充执行，以及后续模型请求能够继续。会话协议恢复通过和业务安全恢复通过是两个结论；补丁版本、适用旧历史边界及上游检查记录进入基座清单。

官方 Schedule 不是持久 Runtime 的前置。需要定时唤醒时先显式选择可选 schedule 组合包，再配置其插件行；未选择的组合包没有可补丁的行。提醒回执只证明 Inbox 投递。先按稳定唤醒身份去重，再核对 RunHead、retryAt、控制代次和准入；陈旧或已入队提醒不能恢复暂停、取消或封存批次。投递失败时，Runtime 仍负责持久重试和启动扫描。

进入长期恢复后的建议退避为 30 秒、1 分钟、2 分钟、5 分钟、随后最高 15 分钟，附随机抖动；有效 Retry-After 是下一次请求时间的下界，可超过本地退避上限。等待前保存失败分类、下次时刻、路由、requestAttemptId 和恢复条件，重启不从第一次短重试重新计数。每次恢复先核对观察和控制状态，旧决策不继续重试；新观察建立新决策，原请求历史保留。具体值由 Config 管理，不设整个任务的累计调用上限。

不因用户没有费用额度就持续高频空转。备用路由只选已配置且能力满足的模型；一个提供方不可用不阻塞其他独立任务。请求或判断永久不支持时换合法路线或等待修复，不能无限重试相同无效 schema。任务取消时停止新的重试，迟到模型结果不重新激活任务。

业务复试是新 Attempt，前提是已核实原动作且满足用例的复试条件；默认建议失败后最多安排一次用于复现的完整尝试，保留首次失败，额外复试由显式用例策略或用户请求安排。此数值是待实现的可配置默认，不是用户回归任务次数上限；不能靠反复执行直到碰巧通过来消除失败。

调度锁按目标资源取得：原生桌面串行；一个身份上下文中的普通流程串行；业务并发用例由一个有计划的执行组统一拥有多个隔离上下文，并记录参与者、同步点和业务关联 ID。执行组经 DD02 的单次 SessionResources.run 协调，各分支独立通过 DD07 派发检查，不嵌套取得同一队列。同环境的独立批次默认排队，只有计划明确隔离的数据和资源才并行；不同任务不能碰巧争抢同一份测试数据来模拟并发。依赖图阻塞仅向真实后继传播，不因某个模块失败把其他模块都判失败。

异常模拟保存 FaultLease，记录目标、类型、开始条件、原状态、解除方式及影响范围。浏览器离线或请求延迟只证明本工具施加的条件，不等同真实服务故障。中断恢复先核对仍存在的模拟并解除或隔离；解除失败停止受影响后续执行，报告环境残留，不隐藏错误。

R57 使用阶段相关的 ProgressPolicyRevision，包含有效活动时间窗口、重复签名阈值、可用恢复动作、最大连续恢复轮次和提醒合并规则。参数须在 M3 验收前用正常长流程与循环对照确定；不是模型 token 总额限制。Runtime 根据新材料结果、StepCursor 推进、有效断言及问题结算维护进展检查点；同一事实重复提交、改写同一计划、无业务变化的截图和 UI 时钟变化不推进该检查点。

检测只累计可执行工作的活动时间，并联合重复行为判断；定时等待、API 退避、用户暂停、接管及环境／空间等待均有独立原因和唤醒条件。先尝试重新观察、合法路由切换或已允许的执行恢复，不能以恢复名义盲目重发未知业务动作。有限恢复仍无效时保存 stall 原因进入 waiting-user，独立实例继续；有新证据、配置修复或用户继续后重新核验。相同原因的提醒按 runId／停滞轮次去重，单纯重启应用不清零恢复计数，也不无限反复发卡片。

R58 的 RunMetrics 为领域进度、DSH 请求记录和活动时间段的只读投影；每次模型请求按 requestAttemptId 去重汇总，主 Agent 请求使用其官方请求身份，二者不重复计数。已知 token、未知用量请求数、失败与重试次数分开；未返回用量不补零。采样或会话投递有延迟时显示时间与缺口；指标不能推动业务状态、解除等待或改变报告结论。

**DD09：快照、证据、报告和迁移**

所选基座使用 Session V4 与独立 tool／developer 消息。领域历史仍由自身 schema 管理；采用官方当前异步历史读取和消息构造入口，不使用已弃用的 snapshotEvents／eventAt／ownEvents 新增实现。保存于自定义事件中的附件不应假定能被官方通用导出自动发现；EvidenceManifest 必须显式维护引用、权限和导出读取路径，并以真实旧格式材料验证官方支持的相邻迁移。

SourceSnapshot 按文件保存原始内容摘要、实际使用内容引用、相对路径、编码／换行、采集时间和读取状态。采集期间复核发生变化的文件；多根目录不能保证同一时刻一致时标记 consistency=unverified 并说明范围。Git commit 只作为可用依据之一，不能代替未提交内容或被忽略配置的实际快照。用于代码定位的行号指向保存版本，源文件后续变动不移动旧报告的行号。

SkillRevision 的 manifest 列出 SKILL.md、声明的本地规则、脚本及其依赖引用和摘要；未冻结的动态依赖不伪称属于旧版本。模型建议更新 skill 只生成 Draft，用户接受后新增版本，运行中的批次仍引用原版本。不可保留的敏感材料记录缺口；不能保留明文密钥来换取表面上的“完整快照”。

EvidenceItem 包括 evidenceId、attachmentRef、mediaType、byteLength、digest、capturedAt、run／instance／attempt／operation／assertionRefs、targetIdentity、captureConditions、redaction、derivedFrom。原始截图、日志、接口响应、导出文件和录像分别保存；模型用的缩图为派生件。网络及日志证据先按凭证字段清理，保留可定位的请求标识和业务值；必要敏感原件只按已有材料政策保留，不默认进入模型或交接包。

附件引用必须由 ctx.attachments 成功保存后取得；不构造 AttachmentId 或绕过 提供方 读写底层路径。大文件流式保存，能力不足是可见失败；采集一半的文件不能登记成完整证据。新采集、业务事实提交和报告导出分别记录完整性，不能从文件存在推导其完好。

report.json 的首版业务格式定为 web-test-report/1，包含以下一级字段；与用户看到的字段含义不一致时以报告规格为准并同步类型，而非由渲染器临时改数值。

| 字段 | 内容 |
|---|---|
| format | 固定值 web-test-report/1；未知主版本明确拒绝或走已验证的兼容读取。 |
| identity | reportId、revision、runId、生成时间、固定的 run／plan／源码／应用版本引用。 |
| environment | 实际入口、版本核实状态、角色、浏览器、视口、缩放、系统和异常条件。 |
| scope | 原始范围、当前范围、适用实例清单、移出项及原因。 |
| coverage | 计划内实例和断言分母、各结果计数、未验证数量及完整性；复试不增加分母；按 confirmed-business／applicable-generic 分列必测分母与结果，implementation-only 诊断及业务待确认项单列且不充当通过 |
| instances | 用例版本、适用条件、Attempt 引用、步骤与逐项断言结果。 |
| issues | 稳定缺陷 ID、影响、复现、预期／实际、事实定位与推测定位、证据、历史关联。 |
| gaps／questions | 未验证原因、受影响断言、可执行的解除条件和待确认问题。 |
| evidenceManifest | 导出内相对路径、附件身份、字节长度、摘要、缺失或脱敏信息。 |
| dataAndCleanup | 新建／变更业务数据、保留依据、清理结果或待清理项。 |
| history | 基线、预期变更、补测及问题状态变化的证据关联。 |
| modelSummary | 实际路由、调用及用量、失败重试、版本未知情况；不含 API key。 |
| integrity | 材料检查结果、缺失清单、脱敏派生说明、导出状态。 |
| operationalContext | 环境声明与操作授权引用、停滞／空间等待及恢复摘要、本次和累计活动时间、用量缺口；无凭证。 |

JSON 枚举建议采用 passed／failed／needs-confirmation／blocked／skipped／not-run，中文显示从同一字典映射。断言结果与实例摘要分离：失败实例的未执行后续断言仍纳入 gaps；一个流程只有同一适用 Attempt 的完整步骤和关联业务记录才能证明通过，不能拼接不同失败尝试的局部成功。报告计算器只读已提交记录，模型不能直接写 coverage 或 passed；implementation-only 的观察匹配不形成业务通过。依据字段、诊断字段和分组计数纳入 web-test-report/1 的首版草案，尚无已发行格式需要迁移；后续实际发行后再按版本兼容流程变更。

缺陷包包含 issue.json、reproduce.md 和所引用证据。代码定位字段分 confirmedLocation 与 suspectedLocations，各自保存 path、snapshotId、line、依据及置信说明；没有证据不能填写“已确认根因”。复现步骤包含入口、身份要求、数据准备、精确输入、操作顺序和观察位置，供用户及编程助手使用。报告不给编程助手暗含修改授权，本工具不自动执行修复。

导出先固定 ReportRevision 和证据清单，在应用拥有的 staging 目录生成 HTML／Markdown／JSON；所有不可信文本按数据转义，HTML 不包含远端可执行脚本，附件预览无宿主能力。相对证据路径不得包含绝对路径或目录穿越。输出到其他磁盘时，先复制到目的文件系统中经路径校验的专用临时目录，再核对 schema、计数、引用、长度和摘要，最后在同一文件系统内重命名发布；不能假定跨盘移动具有原子性。目的地不支持所需发布语义时，使用明确未完成状态和最后写入的完成清单，客户端只认可通过清单核验的完整包。失败保留明确状态，不覆盖已有完整报告或宣布成功。

清理初始报告的 revision N 不可变，清理完成或失败产生 N+1；同时正在导出的 N 保持原内容。后续业务预期确认不把历史缺陷直接改成已修复，补测新结果通过 RetestLink 关联。多个报告共享证据时，删除某个报告不能顺带删除其他报告仍引用的对象。

**附件清理的扩展归属。** 上游 AttachmentStore 仍无完整的引用感知删除生命周期。保留的 attachment-local 扩展提供 deleteFileVerbatim 并保护剩余别名；这是 provider 功能，不代表公共保留服务已完成；引用协调与删除串行化仍归调用方，返回的对象逻辑字节不证明磁盘空间已立即回收或并发调用安全。P07 须复验它并补齐真实普通 Session／fork、报告、导出读者及在途票据的集成；历史模拟票据不能证明这些消费方。保持保存／读取语义，在官方附件包内确定生命周期归属；web-test 不得拼接 AttachmentId 或删除对象文件。[官方附件说明](../../../../docs/subsystems/attachment.zh.md)、[当前抽象](../../../../packages/attachment/attachment/src/index.ts)

归属分三层：Runtime 决定用户选择的清理范围和业务保留理由；附件生命周期服务负责统一引用／保留票据及删除准入；提供方 负责实际对象删除和结果。所有应用资产写入者均需登记，包括普通 Session／fork、测试批次／报告／回归基线、源码与 skill 快照、导出读者、进行中的保存和未提交引用。共享对象按一次实际占用统计；本应用数据根以外的官方 DSH 安装不纳入清理。预览列明选中资产在测试会话中的展示引用，只有同属用户已确认处置范围的引用才可释放保留资格；普通聊天／fork 或其他未选中所有者继续持有。会话和报告原记录不改写，通过处置记录解释附件已删除；不能为清理一个批次自动放弃不相关会话的证据。

拟采用保留票据与删除互斥协议：发布可达引用前取得可持久恢复的保留票据；提交后确认所属引用，失败或崩溃留下待核实票据而非直接回收。删除前在同一生命周期协调边界撤销新增引用资格、复核全部已知所有者与活动读写票据、提交删除意图，再由 提供方 删除并结算。新引用与删除准入必须互斥，不能只扫描一次 EvidenceManifest；无跨记录事务时明确提交点和恢复顺序。历史普通会话或未知引用无法完整盘点的对象标记保留，不推定为孤立。旧报告引用通过处置记录解释已删除，不改写旧结果。

P07 最小验证要求普通聊天／fork 与两个测试报告共享同一附件，删除一个报告不损害剩余引用；同时覆盖引用发布、导出读取、删除意图处的崩溃及新引用竞态。M0-T10 明确公共约定补丁与检查负担；M1-T03 建立保留票据基础，M2-T05 接入证据发布，M3-T05 完成用户清理及 提供方 删除，M5 汇总 AC55／G08／V16。未证明生命周期闭环前不得放行依赖它的长期资产架构；不能仅把“清理受限”作为正常交付方案。

**本地资产空间与清理。** 业务数据清理遵守 R33、R54；本节处理应用自己的证据、快照、历史及临时材料，不调用被测业务删除接口。StoragePolicyRevision 配置预警余量、关键控制记录预留和检测周期；maxOwnedBytes 可为空，表示不设应用硬配额。运行前、按周期及大文件保存前采样所有实际写入卷，包括证据与导出目的地；去重资产计数，分别列独占占用、共享引用和暂不可归属部分。

空间低于预警余量时只在所属会话提示；不足以保存必要材料、达到用户上限或探测失败时关闭相应派发门并持久化 space 等待。预留空间只服务控制与在途小型事实，不能当成录像或新证据的额度；操作系统／其他应用仍可能抢占，实际写入失败继续按 DD07 的未保存状态如实处理。停止开始新录制片段或新业务步骤，不能悄悄降低已经承诺的证据要求；存在其他可用卷不自动迁移活动档案。空间改善后重新检查目录、引用、在途事实及保存能力，再恢复未被用户暂停的任务。

本地清理先形成固定 AssetCleanupPlan，列出选中批次、预计可释放字节、共享资产、当前基线、活动任务、导出或其他读者所持引用及会失去的复现材料。活动与未结算任务、当前基线及未选中报告仍引用的对象不可直接删除；用户需先通过既定流程结束相关工作或更换基线，不能由清理器自动改写这些关联。确认后在 Runtime 独占所有权下重查引用及材料代次，陈旧预览返回更新后的影响清单，不扩大已确认删除范围。

删除通过 P07 验证并在官方附件／领域归属实现的生命周期能力完成；能力缺失继续作为 AC55 阻塞，不能绕过 提供方。先保存处置意图、撤销相应新增引用资格，再按对象结算；普通 Session 与导出持有的引用同样受保护。恢复从意图继续，已不存在对象与删除失败分别留痕。保留最小处置账及批次摘要，旧报告通过处置记录说明证据已由用户删除；只报告实际释放空间，不默默清除必要历史。

存储 schema 的升级和报告交换格式的升级分别版本化。迁移先备份、读取旧版本并在新位置生成候选、核对引用与计数，最后在同一控制根的独占锁下切换数据代际指针；稳定控制根和锁身份不随候选目录改变。失败保留原数据，禁止 backup-and-skip 恢复历史。迁移后的新数据不默认被旧程序兼容。正式实现涉及 DSH 声明的持久化类型时，按其变更确认和生成流程办理，而非自行改一个 JSON version 就算完成。[持久化变更流程](../../../../docs/cookbook/reviewing-persistence-type-changes.zh.md)

## 考虑过的替代方案

**已记录的取舍。** P02 先比较最小批次记录与分段、检查点，再决定是否增加复杂度；超时不能成为重放 UNKNOWN 动作的理由。

## 验收标准

执行本提案中的正常和失败对照，并满足[统一验收标准](../testing/2026-09-28-web-testing-acceptance.zh.md)及相应任务的证据要求。文档迁移不代表这些条件已通过。

## 风险

存储顺序、附件所有权和恢复观察需要故障证据；日志结构合法本身不能证明业务完成。
