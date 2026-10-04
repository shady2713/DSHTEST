---
description: "Web 测试的唯一领域写入方（ctx.webTestRuntime）：控制根的稳定身份与 Windows 独占锁、预留/发布式创建协议、严格的工程读取，以及提交时写入的 webtest 存储领域通知发件箱。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test-runtime

[English](README.md) | 中文

## 概述

本包拥有 Web 测试产品共享的持久化权威：控制根的稳定身份，以及使"只可能有一个写入方"成立的 Windows 独占锁；把工程注册转换为已发布入口点的三阶段协议；变更已发布工程却绝不使其变得不可读的暂存式更新协议；严格读取目录头所发布的内容；以及每次提交都会填充的发件箱。它是 Web 测试业务状态的唯一写入方。它不分发浏览器动作、不协调附件、也不裁决策略——它只持久化契约已校验的记录，并拒绝其余一切。后续每一个测试动作都通过 `ctx.webTestRuntime` 读写，而不是直接访问存储介质。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Host 以组合层选定的控制根挂载本服务。服务在打开任何权威领域之前，先占用该根的 Windows 命名内核对象，因此同一根上的第二个写入方会被直接拒绝，而不是被降级为进程内守卫。

应用 profile 设置 `storageMode: generation-json` 后，本服务在已锁定数据代的 `dataRoot` 下注册专属 JSON backend，其他领域继续使用原 backend。`storageMode: configured` 使用组合层既有的领域路由。初始化失败时，本写入方先关闭其创建的 backend，再释放锁。

`windowsRenameDelaysMs` 配置原型活动与 Runtime 自有数据代 JSON backend 的原子发布重试。默认 `[20, 40, 80, 160]` 在首次尝试后允许四次重试；`[]` 只允许一次尝试。仅 Windows `EACCES`、`EBUSY` 和 `EPERM` 会重试。已刷新并关闭的同一临时文件以完全相同字节再次 rename，不重试业务操作。撤权写入耗尽预算时，进程内准入仍停止，前一持久化 cut 和 UNKNOWN 记录保持原样，不确认撤权已持久化。清理临时文件失败时保留原始发布错误。独立配置的 storage backend 继续使用自己的策略。

`saveSessionProject` 持久保存正式 `SessionId` 及其已发布工程。`saveEnvironment` 在当前工程修订下保存完整用户声明，拒绝缺失代码根、未登记 URL 和过期修订。对应读取方法只恢复事实，重开会话不会恢复授权。读取既有版本 2 领域时，新增的 `sessions` 和 `environments` 表初始为空。

`probeEntryUrls(projectId, expectedRevision, signal?)` 显式检查该修订登记的 URL。它逐个发送不带凭据的 HEAD 请求，不跟随重定向，不保存响应头或正文。任何 HTTP 响应，包括 4xx、5xx 和重定向，都按 `response` 保存状态码；失败、超时、无效和取消的地址也按登记顺序保留。最新观察持久保存于 `entry_url_probes`，旧领域的该表为空。`readEntryUrlProbe` 只读已保存观察，不触网；其 `revision` 可以旧于当前工程。发布前工程修订变化会拒绝本次检查，而不保存过期工作。Runtime 卸载会取消请求，等待取消结果保存后再关闭存储。

`entryUrlProbeTimeoutMs` 设置单个地址的完整期限，包含 DNS 和建连；校验范围为 1–60,000 整数毫秒，默认 10,000。取消后不再请求其余登记地址，并保存 `cancelled` 观察。含用户名或密码的 URL 保留为 `unusable`，不会请求。URL 检查不确认登录或测试环境事实，这些仍由用户明确声明。

```ts
import type { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import WebTestRuntime from '@deepseek-ai/dsh-web-test-runtime'
declare const ctx: Context
declare const dataRoot: string
// cordis.yml: the storage backend is rooted at the data generation the
// control root's pointer selects, and this service claims the root itself.
await ctx.plugin(Storage)
await ctx.plugin(storageJson, { root: dataRoot })
await ctx.plugin(storageDomain, { backend: 'json' })
await ctx.plugin(WebTestRuntime, { controlRoot: 'C:\\Users\\me\\.dsh-web-test' })

// Registering a project publishes one entry point and one notification.
const receipt = await ctx.webTestRuntime.registerProject({
  commandId: 'cmd-2f1c',
  codeRoots: ['C:\\projects\\shop', 'C:\\projects\\shop-api'],
  entryUrls: ['http://localhost:3000/checkout'],
})
```

对话资料修正向 `commitProjectUpdate` 传入界面显示的项目身份与已保存的 Session 关联。写队列在暂存与发布前核对该关联；同步活跃属主检查还会拒绝取消或上下文失效。资格在头提交前撤销时可能留下暂存内容，已发布资料保持不变。

### 冷活动与 M0 恢复原型

`readPersistentActivity()` 只读既存数据代指针和 `prototype-activity.json`，不打开领域、不加载 Session、不创建文件，也不授予执行权。未登记、格式无效、身份重复、路径不安全及读取失败都生成 `completenessErrors`；不完整快照不能证明无活动。只有 `COMPLETED` 批次头是终态；没有加载任何 Session 时，暂停、取消意图和未结算动作身份仍可见。

对于真正新建的控制根，Runtime 原子创建最后一级目录、取得其锁，并在发布首个数据代指针前登记完整的空格式 3 活动记录。该目录此时必须仍为空。既存根缺少指针或活动记录不能证明历史为空，中断的根也不会自动初始化。已有活动记录保持原样。空记录的协议摘要不代表业务组合身份；首个有界批次绑定其明确提供的实际组合摘要，之后的登记必须匹配该值。

可信 `webTestPrototypeOwner` Service 以其实际拥有的 Context 调用 `issuePrototypeAuthority`，私下持有不透明对象，并将其传入每次 Runtime 原型修改。授权绑定该 owner 及当前注入的 Runtime；授权缺失、复制、过期或伪造时，即使清除 Agent initiator 归属也会拒绝。`initializePrototypeActivity(cut, authority)` 仍是显式导入操作，拒绝替换已有活动记录。生产 `WebTestPrototypeControl` owner 仅在调用者提供该 Service 实际拥有的同一个 Context 时，委托登记、准入、UNKNOWN 保留及撤权；它不返回授权对象。`registerPrototypeRun` 在与准入共用的队列上追加没有动作的初始运行或暂停批次头，保留所有已有批次头。格式 3 保存原动作身份、暂停／取消意图、材料引用、执行者状态和组合摘要。`admitPrototypeOperation` 在调用者执行业务 I/O 前提交 `ISSUED`，拒绝重复动作身份及跨批次相同的规范化业务意图。意图具体是操作种类、目标与参数摘要；owner 必须提供规范且无歧义的值。`markPrototypeOperationUnknown` 保留不确定状态。`revokePrototypeDispatch` 先禁止新准入再提交撤权；协调器还要求旧执行进程停止并释放锁。

`issueRecoveryAuthority` 要求实际 `webTestRecovery` Service 的 Context 并发放私有不透明对象。`RecoveryCoordinator.open(controlRoot, ownerContext, authority, writePolicy)` 取得同一控制根锁；freeze、prepare、activate 和 close 每次都需要授权。Runtime 写入器及生产者状态保存在模块私有 WeakMap，协调器状态使用 JavaScript 私有字段。清除 Agent initiator 归属或保存公开服务引用均不能制造授权。Service 方法要求明确的调用者授权或生产者实际拥有的同一个 Context，不能自动授权公开服务调用。可信 Host 扩展能够注册 Service，因此这些检查不承诺进程或操作系统隔离。`freeze` 接受已撤权的执行者格式 1 和 3，枚举数据代所有普通文件，包括所引用的报告和附件。`prepare(newPackageHash, checkPrototypeExecutorFormat, authority)` 以对应执行者格式的只读检查器核对独立备份，在前代旁创建对应的仅恢复候选。恢复候选保留所有批次头和引用，登记前代摘要及 `recoveryOnly: true`。`activate` 重新核对原数据、备份、候选、manifest 和 intent，然后原子选择候选。检查器缺失、文件摘要变化或准备过程被中断均保持原指针；前代不会删除。`close` 等待工作完成后释放所有权。

活动格式与 Session 世代及 `webtest` 单元相互独立。旧格式 1 和 2 保留原有严格 JSON 校验，Runtime 对其保持只读。新建根写执行者格式 3，恢复候选使用格式 4；旧读器拒绝这些新格式。既有数据代不会原地升级，也不提供从旧数据升级执行者的操作；当前执行者使用另一个新建控制根，旧根保留用于检查或恢复。recovery-only 准入始终拒绝业务派发。文件在 rename 前刷新新文件；本原型不承诺目录刷新，也不承诺突然断电后的文件系统元数据不丢失。正式 profile 启动及安装器交接属于应用消费方。

`WebTestPrototypeControl.pause(runId, callerOwnerCtx)` 委托 `pausePrototypeRun`，先验证当前私有授权，再同步关闭已登记且未完成批次的本地派发门。真实原子写入完成后才返回 `PrototypePauseReceipt` 的批次、cut 与头修订；写入失败不产生持久确认，本地门仍关闭，可重试保存。重复成功暂停不增加修订。UNKNOWN 状态、原动作和材料引用保持，RUNNING 变为 PAUSED。准入在入队前和执行时检查门；已在保存中的 ISSUED 保留，消费者必须每个 await 后及业务 I/O 前调用 `assertDispatchable`。Runtime 从既存有效 cut 只读加载准入事实，关闭含 ISSUED 或 UNKNOWN 动作的冷批次内存门，不修改其持久头；缺失或损坏 cut 保留查询的不完整结果，且不获得执行权。本有界 owner 接口没有 resume、取消业务、Remote 用户暂停 handler 或完整 M3 状态机；协调 run controller 和上游资源仍由可信消费方负责。

可信消费方只有在观察到原动作的成功确认后，才调用 `markCompleted(operationId, callerOwnerCtx)`。`markPrototypeOperationCompleted` 在同一队列上仅提交 ISSUED → COMPLETED；缺失、已结算及 UNKNOWN 身份均拒绝结算。它不执行业务 I/O，也不结算整个批次。

`markNotExecuted(operationId, receipt, callerOwnerCtx)` 仅在格式 3 提交 ISSUED → NOT_EXECUTED，可信消费方必须先将真实浏览器 wire 拒绝回执与当前工具执行关联。Runtime 匹配回执的动作、批次、Session 和原参数摘要，保存调用 id、wire 请求 id、诊断目标、Host epoch、结果和原因。持久 JSON 校验全部回执字段及其动作关联。已保存的目标仅为诊断证据，不能作为可执行浏览器句柄。UNKNOWN 保持未结算，错误文案本身不能确认未执行。NOT_EXECUTED 是动作终态，仍禁止重复意图，且不表示批次成功完成。冷批次仅含 COMPLETED 或 NOT_EXECUTED 动作时，若 RUNNING 头没有暂停或取消意图，可派发新意图；含冷 ISSUED 或 UNKNOWN 动作则关闭准入。格式 3 恢复使用 `checkPrototypeFormat3`，在已核对备份及格式 4 候选中保留全部回执。

### 控制根及其锁

控制根是唯一永久存在的目录。它保存数据代指针，而锁的对象名是其**已解析**路径的 SHA-256 摘要。由此得到三条性质，每一条都是第二次启动所依赖的：

| 性质 | 为何重要 |
|---|---|
| 摘要的唯一输入是规范化后的控制根路径 | 不同应用构建、配置文件或安装位置会共用同一把锁，而不是在第一个写入方旁边再跑一个写入方。 |
| 路径经 `realpath` 解析并做大小写折叠 | 指向该根的联接点或符号链接别名、以及大小写不同的拼写，都落到同一目录，因而落到同一对象。 |
| 名称位于 `Global` 命名空间 | 在另一个 Windows 登录会话中启动会争用同一对象，而不是另开一条写入通道。 |

该对象是初始计数与最大计数均为 1 的命名内核信号量，创建时带有仅允许创建者用户令牌与 Local System 的自主访问控制表。之所以用信号量而非互斥体，是因为互斥体所有权与线程绑定，而 Node 写入方的释放点并不是固定线程。内核会在最后一个句柄关闭时销毁该对象，进程死亡亦然，因此崩溃的持有方不会阻塞后继者。这里没有超时也没有重试：活着但卡住的持有方会一直占住该根直到它退出，因为一次接管会让两个写入方交错写入目录头。

### 创建分三个阶段

`registerProject` 在它所命名的资源存在且已持久化之前，绝不写入入口点：

| 阶段 | 提交了什么 | 读取方看到什么 |
|---|---|---|
| 1. 预留 | 一次目录头写入，记录命令令牌、规范化参数的摘要，以及预留的工程身份 | 什么都没看到；头未发布任何入口 |
| 2. 子记录 | 在预留身份下的一次 `projects` 写入，跨重试幂等 | 什么都没看到；可见性取决于头的入口，而非记录 |
| 3. 发布 | 一次头写入，同时发布入口、回执与通知 | 该工程 |

在阶段 1 或 2 之后中断，会留下一条预留以及可能的、任何读取都看不到的持久子记录。以同一命令令牌重发会从已登记的意图继续，并沿用同一身份——因为该身份由令牌派生而非分配而来；令牌被不同参数复用时则以 `command-token-reuse` 拒绝。

### 提交顺序与发件箱

调用方先读取已提交版本，在队列之外完成其长耗时工作（附件及其他批量 I/O），再进入一条短串行队列。队列内，提交方在写入任何内容之前重新校验记录身份与期望修订，因此过期读取会被拒绝，而不是覆盖调用方从未看到的变更。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectId } from '@deepseek-ai/dsh-web-test-contracts'
import type {} from '@deepseek-ai/dsh-web-test-runtime'
declare const ctx: Context
declare const projectId: ProjectId
declare function saveLargeAttachmentOutsideTheQueue(): Promise<void>
const prepared = ctx.webTestRuntime.prepareProjectUpdate(projectId) // no I/O
await saveLargeAttachmentOutsideTheQueue()                          // long work
const commit = await ctx.webTestRuntime.commitProjectUpdate(        // revalidates, then commits
  { commandId: 'cmd-9a04', recordId: prepared.recordId, expectedRevision: prepared.expectedRevision },
  prepared,
  { codeRoots: ['C:\\projects\\shop'], entryUrls: ['http://localhost:3000/cart'] },
)
```

更新不能走创建协议那条"先写下无人引用的材料"的路。工程已经发布，因此覆写其记录会让头发布一个记录已不再持有的修订，数据根的每一次读取都会失败。提交因此把新内容暂存在已发布内容旁边：

| 阶段 | 提交什么 | 读取方看到什么 |
|---|---|---|
| 1. 暂存 | 一次 `projects` 写入，把下一修订的内容作为记录的 `pending` 更新加在旁边；已发布字段保持头所指名的修订 | 已发布修订，不变 |
| 2. 发布 | 一次头写入，同时发布入口、回执、账本行与通知 | 暂存的修订，由 `pending` 提供 |
| 3. 折叠 | 一次 `projects` 写入，把暂存内容移入记录自身字段 | 同一修订，已折叠 |

读取以头入口所点名的修订作答，取自承载它的两份副本之一。因此在阶段 1 之后中断只会留下无人引用的内容，在阶段 2 之后中断只会留下一个头已发布、且每次读取仍能服务的暂存更新：任何中断都无法让已发布工程变得不可读，也无法毒化数据根，而最后一次写入的丢失没有任何代价。

两次写入都可重放。命令令牌的账本行由与其所描述入口的同一次头写入写下，因此重发同一命令会返回首次尝试挣得的回执，补上丢失的折叠，且绝不发布第二条记录、第二个入口或第二条通知。账本已为另一工程或另一内容持有的令牌以 `command-token-reuse` 拒绝。通知由发布写入本身追加，这正是发件箱不可能描述一次未提交的原因。

### 严格读取

`readProject` 只有在目录头为某工程发布入口时才返回它，并按该入口所点名的修订返回。字段未通过其 zod 模式的已存记录会让整个打开以 `invalid-record` 失败；本领域刻意不声明 `backup-and-skip`，因为后续版本读不了的权威历史是需要暴露的失败，而不是可以丢弃的数据。若读取发现头发布的入口所点名的修订，既不在记录自身字段中、也不在其暂存更新中，则拒绝服务，而不是返回残缺内容。

### 读取已声明的材料

`inspectProjectMetadata` 逐项比对已发布记录的声明与本宿主实际持有的内容，返回一份 `ProjectInspection`，其 `complete` 标志只陈述这些状态，不多述一句：

| 已声明的事实 | `usable` | `absent` | `unusable` |
|---|---|---|---|
| 代码根 | 已存在的目录 | 本宿主上无此路径，或本宿主根本无法查看该路径 | 路径存在但不是目录 |
| 入口 URL | 绝对的 `http`/`https` 地址 | — | 其他一切拼写，含相对写法与无主机写法 |

`usable` 的入口 URL 陈述的是地址本身，而不是该服务。`inspectProjectMetadata` 不触网；显式 `probeEntryUrls` 操作记录是否应答。登录和测试环境事实来自用户声明。报告就绪的调用方必须点明检查了哪些事实。

### 失败

| 代码 | 何时抛出 |
|---|---|
| `web-test/control-root-locked` | 另一个写入方占用了控制根的内核对象。 |
| `web-test/control-root-lock-unavailable` | 对象无法创建或无法占用，包括在没有此类原语的宿主上。 |
| `web-test/command-token-reuse` | 命令令牌被以不同于其已提交内容的参数、工程或内容复用。 |
| `web-test/record-mismatch` | 提交所寻址的记录不是该变更所准备的工程。 |
| `web-test/stale-revision` | 调用方的期望版本与已提交版本不再一致。 |
| `web-test/record-unpublished` | 头发布了持久记录无法支持的入口。 |

请求字段校验不在此列：格式错误的请求属于契约包的 `web-test/*` 失败，在本服务看到它之前就已抛出。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现内部细节 — 点击展开</summary>

`src/index.ts` 是服务定义，也是整套提交协议所在。`src/spec.ts` 声明 `webtest` 存储领域：全局槽中的目录头与单张表中的子工程记录，每个字段都在持久边界由 zod 校验。`src/control-root.ts` 拥有控制根的规范身份、代指针与锁名摘要。`src/lock.ts` 是平台闸门与失败映射；`src/win32-control-semaphore.ts` 是 Koffi 绑定与 DACL。`src/errors.ts` 声明失败代码。

原型方法先校验不透明授权、生产者生命周期及其当前 Runtime，再查找私有活动写入器。Runtime init 在 Cordis 暴露 ACTIVE provider 前登记该写入器；校验与查找同步执行，登记在该 provider 的生命周期内持续存在。Cordis 可追踪代理与实际 Runtime Service 实例均找到同一个写入器。生产者或 Runtime 被释放后，保留任一引用都不授予修改权。

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 服务定义、三阶段创建协议、暂存式更新协议、串行提交队列、严格读取与发件箱。 |
| [src/spec.ts](src/spec.ts) | `webtest` 领域声明、其 zod 记录模式，以及工程/记录身份的派生。 |
| [src/control-root.ts](src/control-root.ts) | 规范控制根身份、数据代指针与锁名摘要。 |
| [src/lock.ts](src/lock.ts) | 单一写入方占用：平台闸门、争用映射、幂等释放。 |
| [src/win32-control-semaphore.ts](src/win32-control-semaphore.ts) | Koffi 绑定、双主体 DACL 与零超时占用。 |
| [src/inspection.ts](src/inspection.ts) | 把已发布工程声明的代码根与入口 URL 同本宿主实际持有的内容作比对的读取。 |
| [src/errors.ts](src/errors.ts) | 调用方据以判别的失败代码。 |
| — | 不发布运行时 invariant 伴生文件。头与工程记录在单进程内的同一条串行链上写入，而唯一的跨进程关系——只有一个写入方占住该根——由内核对象强制执行并被排他性测试直接观测，因此不存在可与第一个观测相背离的第二个观测。 |

本单元是单个 `single` 布局文档，即 StorageDesignDecision 在测得分段在 n=10 000 时读取慢 60–80 倍、且只在尚不构成约束的规模上才有界内存之后所选择的布局。分段、清单与检查点刻意不予声明。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [共享契约](../web-test-contracts/README.zh.md) — 本服务消费的品牌身份、请求记录、回执与解析器。
- [存储领域](../../storage/storage-domain/README.zh.md) — `defineDomain`、`domainTable`、写入链，以及无效记录所抛出的失败代码。
- [JSON 存储后端](../../storage/storage-json/README.zh.md) — 本证据所读取的 `single` 布局单元文档及其原子发布。
- [恢复设计](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-design-recovery.zh.md) — DD06、DD07 与 DD09：头、唯一写入方、提交顺序与创建协议。
- [持久化回归](tests/runtime.spec.ts) — 重启、幂等创建、严格读取与发件箱。
- [中断回归](tests/interruption.spec.ts) — 两套协议中写入可能失败的每一个提交边界，以及各自的重放。

-----

<a id="model-experience"></a>
## Model Experience

无，因为这个唯一领域写入方不构造任何模型上下文，也不触及模型请求；它只持久化调用方提供的记录并把它们返回。

#### KV Cache effect

无直接影响。只有当消费方自身的契约需要时，才会把这些记录放入请求中。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

本包实现的子项尚未验收，剩余工作属于下列卡片。请阅读本清单，以免把通过的测试误读为已交付的产品。

- 写锁仅支持 Windows。非 Windows 宿主会报告 `control-root-lock-unavailable` 并且不写入任何内容，因为文件锁会阻塞数据根所需的读取与搜索路径，而内存标志根本排除不了第二个进程。本包未实现 POSIX 面。Linux 通道仍会运行本包的锁失败映射、Koffi 决策、控制根身份与指针校验套件，因此 `src/lock.ts`、`src/control-root.ts`、`src/spec.ts` 与 `src/errors.ts` 在任何宿主上都仍受逐文件覆盖率闸门约束；只有 `src/win32-control-semaphore.ts` 与 `src/index.ts` 在那里被排除——前者因为 Koffi 加载 Win32 库，后者因为缺少内核对象时服务根本拒绝打开任何领域。
- 目录头内联持有其创建账本、更新账本与未投递通知，三者均无上界。回执随命令数增长，通知只在消费者确认后才会缩小。StorageDesignDecision 否决了此处所需的分页框架；上限及其淘汰语义在此刻意不予杜撰，命令数很多的数据根正是必须重开该决策的时点。
- 数据代指针只在 init 时读取一次。写入方在整个生命周期内占住控制根，因此没有第二个写入方能改指它，但运维手工编辑该指针这一情形未被检测。
- 浏览器动作分发未实现，也不声称附件协调已完成。`commitProjectUpdate` 演示了附件提交将要使用的"队列外准备/入队内校验"规则；它并不搬运附件。
- 单元格式为版本 2。早期版本 2 单元缺少会话、环境或 URL 观察表时，按空表读取；打开不重写原字节。其他单元版本会被拒绝，本包不迁移版本 1。
- 随应用交付的组合使用 `storageMode: generation-json`，专属后端根为所选的数据代。已自行把存储领域根设到该处的组合仍可使用 `configured`。
- 这些服务方法尚无生成的 Client 声明：本服务不是 `@Remote` 面。`M1-T02-A` 的契约 Remote 仍是校验方向的线路边界，而卡片与对话共同寻址的那一个面是 [`@deepseek-ai/dsh-web-test-conversation`](../web-test-conversation/README.zh.md) 里的命令 Remote。持久化是否并入自己的 Remote，由后续卡片决定。
- 一个工程注册一至十六个代码根与一组入口 URL。一份环境声明覆盖完整的已注册根集合；同一工程内无法为个别根指定不同的环境事实。再确认一份声明会替换当前生效的那份，因此需要不同声明环境的调用方应注册独立工程。在当前策略下，所有已注册代码根均为只读。
- URL 检查只记录传输可达性，不登录、不跟随重定向、不渲染页面，也不保证 HEAD 响应符合页面 GET 行为。它允许明确登记的回环和私网地址；检查这些地址不授予浏览器或测试执行权限。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

有两处实现选择是承重的，且很容易被无意撤销。第一，这三个阶段是三次独立的持久写入，其间没有事务；这是刻意为之，且头写入是唯一会发布任何内容的那次。任何"通过把入口点与子记录一起写来省一次写入"的改动，都会重新引入该协议本要防止的半成品实体。第二，`SECURITY_ATTRIBUTES` 由带每进程 Koffi 结构体名称的编码产出，因为 Koffi 全局注册结构体类型并拒绝重名；其 `nLength` 字段采用 x64 布局（DWORD、4 字节填充、指针、BOOL），改动它会静默产生一个被内核忽略的描述符。Win32 失败路径通过注入的 Koffi 表来覆盖，而不是去诱发真实失败，因为真实失败既不可复现也不可观测；成功路径与内核的真实排他性则由原生方式覆盖。

</details>
