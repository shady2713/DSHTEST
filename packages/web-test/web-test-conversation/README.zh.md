---
description: "Web 测试对话入口（ctx.webTestConversation）与命令 Remote（ctx.webTestCommands）：每个官方根对话代理一个作用域工具遮罩、遮罩读取的会话到项目关联、显式选择的 tool-ask-user 行，以及卡片与对话共同寻址的那一个 Remote"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test-conversation

[English](README.md) | 中文

## 概述

本包是 Web 测试的对话入口：它让普通 DSH 对话能够作用于被测项目，而不必成为第二个代理。每个官方根对话代理携带一个作用域遮罩，覆盖 Web 测试策略所管辖的工具，因此没有关联项目的会话看不到其中任何一个。它拥有四件事实：一次对话被提供哪些工具、一次会话关联到哪个项目、装配注册了哪个问题定义，以及一次请求解析成哪个类型化命令。遮罩是可见性而非强制；命令层只有一个 Remote，两个调用方都经它寻址。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

装配把它挂载到代理注册表、工具注册表、不涉凭证的策略表面，以及持有项目记录的运行时。部署只需声明它想要的问题行；受管工具集是从策略读出的，而不是在这里重述一遍。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectId, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import WebTestConversation, { WebTestCommands } from '@deepseek-ai/dsh-web-test-conversation'
declare const ctx: Context
declare const sessionId: SessionId
declare const projectId: ProjectId
declare const revision: Revision
declare const commandId: string
declare const codeRoot: string
await ctx.plugin(WebTestConversation, { askUserMode: 'timed', askUserTimeoutSeconds: 120 })
await ctx.plugin(WebTestCommands)
await ctx.webTestCommands.attachProject({ sessionId, projectId })
await ctx.webTestCommands.declareEnvironment({
  sessionId,
  commandId,
  declaration: {
    codeRoots: [codeRoot],
    entryUrl: null,
    isTestEnvironment: true,
    login: { state: 'not-required' },
    supplementaryRequirements: [],
  },
})
ctx.webTestCommands.queryStatus({ sessionId, verb: 'query', subject: 'material' })
ctx.webTestCommands.submitAction({ sessionId, verb: 'start', target: 'checkout', expectedRevision: revision })
```

### 什么可配置、什么不可

两个字段，都只关于问题行。一次对话可以被提供哪些工具**不可配置**：受管集合是策略自己的适配器表，策略不管辖的工具永不被遮罩。命令集同样**不可配置**：声明六个动词，本阶段不执行的五个以"不可用"作答，而不是作为部署可以打开的开关。

## 进一步探索

下面的注册规则就是配置面；本子项没有独立的证据文档，因为可执行的证明就是本包自己的测试套件。

<a id="understand-the-implementation"></a>
## 理解实现

### 遮罩是可见性，策略才是强制

`WebTestPolicy` 已经在注册表的守卫阶段拒绝它不予准入的每一次受管调用，且不存在监听器可以撤销的允许结果。因此遮罩一个工具并不授予任何东西，取消遮罩也不许可任何东西：遮罩决定的是模型被**提供**什么。本阶段不经由的工具是从对话的 schema 中**缺席**，而不是在场却拒绝，因此模型不会把它读成一个可用的控件。

### 新遮罩先安装，旧遮罩后释放

`refresh()` 先安装新遮罩，再释放旧遮罩，因此工具注册表观察到的重叠是两者的较严并集，而不是一段空隙。一个从「未关联」转到「已确认」的会话，不会存在一个什么都未被遮罩的瞬间。

### 受管名称来自策略，而不是这里的一份清单

遮罩可以点名的名称，是策略自己的 `adaptedToolNames()` 与全局注册表的交集。策略不管辖的工具永不被遮罩，部署未装载的受管名称也永不被点名，因为 `tools.restrict()` 会拒绝未知的全局名称，而不是忽略它。

### 命令集是封闭的，其不可用状态是被声明的

`WEB_TEST_COMMANDS` 点名六个动词：`query`、`generate-case`、`start`、`pause`、`resume`、`cancel`。第一个只读；其余五个会改动本阶段尚无领域承接的业务状态，因此 `describeCommands()` 把它们各自报为 `available: false` 并说明需要哪个领域，`submitAction` 用同一条理由作答。本阶段无法执行的请求是被回答的，不是被排队的：没有东西被存下，没有令牌被消耗，后续阶段也不会发现它在等待。

每个动词需要的字段只声明一次，在 `MUTATING_FIELDS` 与 `QUERY_FIELD` 中；`resolveCommand` 要么返回类型化命令，要么返回该请求漏掉的字段。因此一句含糊的 `start` 得到的是一个具体问题——「说明要开始什么，并说明该答案所依据的项目修订」——并点名它所针对的项目。

### 状态查询与变更请求是两个面，不是一个开关

`queryStatus` 读，`submitAction` 决定，两者的请求类型不重叠：解析后的 `query` 命令只带一个 subject，而每个变更命令都带一个目标和一个期望修订。类型化调用方无法把一次状态问题拼成一次变更请求，且 `ActionOutcome` 没有任何成员报告某个动作已执行，因为本阶段没有会记录它的领域。这正是「状态查询不能启动测试」成为面的性质、而非日后可被删掉的一个分支的原因；线路方向显式拒绝同样的混淆，因为来自卡片的请求不是类型化的。

`StatusReport` 携带工程已发布的记录、策略是否已确认其环境，以及本宿主实际找到的已声明材料。它不提交任何东西、不发布任何通知、也不占用任何策略租约；测试套件正是通过比对一次查询前后的持久化头、发件箱与账本来断言这一点的。

### 拒绝是有次序的，先命中者胜出

一次请求先因它点名的会话而被拒绝，此时还没有读取任何项目的内容，因此没有关联的会话无法从失败的请求里得知任何事；然后是因它漏掉了什么；再然后是因项目自该答案所依据之时已移动；最后才是因某个动词本阶段不执行。过期检查把每个变更命令携带的 `expectedRevision` 与工程当前发布所在的修订相比，后者是现读的，而不是记住在关联那一刻的修订——因此依据已变化项目给出的答案被拒绝，而不是被执行。

### 会话绝不借用另一个项目的上下文

闸门读的是它自己的关联记录——`attach()` 绑定到该会话的项目，以及 `declareEnvironment()` 是否已确认它——并就后果咨询策略的 `bindEntry` / `declareEnvironment`。`webTestRuntime.readProject(projectId)` 的作用是让「关联到未发布项目」在 `attach()` 处失败；闸门本身从不回落到「那唯一已声明的项目」，因此没有自己项目的会话什么也够不到。

`context(sessionId)` 是命令 Remote 解析每一次请求所依据的唯一来源，它只按拿到的会话去查。没有关联的会话读到 `{ kind: 'ordinary' }`——那是一个值而不是一个缺失值：忘记检查它的调用方拿到的是一个其中没有项目的上下文。`no-project` 的拒绝只点名会话与补救办法，不携带任何其他项目的身份、代码根或入口 URL；测试套件断言在旁边另有一个已关联且已确认的会话这一事实不会改变其中任何一条。

### 已声明的材料是被读出来的，不是被假定的

`updateProject({ sessionId, projectId, commandId, expectedRevision, codeRoots, entryUrls }, signal?)` 与 `web_test_update_project` 修正用户读取的项目身份与版本。它们拒绝变化后的 Session 选择，保留项目身份，拒绝旧版本，并仅允许同一命令 token 对相同资料幂等重放。Runtime 在写队列内检查持久 Session 选择；命令在暂存与发布前检查 Session 是否仍存活及调用是否已取消。发布前拒绝保留原已发布资料，但可能留下未发布的暂存内容。修正发布后，当前环境确认失效；持久声明与 URL 观察仍属于各自记录的旧版本。用户必须重新确认新环境事实，并显式检查新 URL。共享 Remote 保留对话拒绝的闭集 `web-test-conversation/*` 错误码。

状态报告经由运行时的 `inspectProjectMetadata` 取得事实，它把记录声明的每一个代码根与每一个入口 URL 同本宿主持有的内容比对，并逐项报为可用、缺失或不可用。代码根已被删除的工程会得到说明根已不在的状态回答。该检查只判断入口 URL 语法，不请求地址。

登记后显式调用 `probeEntryUrls({ sessionId, projectId, expectedRevision })` 或 `web_test_probe_entry_urls`，检查所显示项目已启动并已登记的 URL。若 Session 选择变化，会在发送 URL 请求前拒绝。共享命令调用 Runtime 的[限时 HEAD 检查](../web-test-runtime/README.zh.md#use-this-package)；模型工具传入自身取消信号。`StatusReport.entryUrlProbe` 在未检查时为 `null`，否则是带独立 `revision` 的最新已保存观察。状态查询只读该值，不刷新、不生成测试。调用方必须比较检查修订与 `project.revision`；已保存检查不确认环境，也不恢复测试权限。

### 三种问题行组合在加载时被拒绝

`resolveAskUserMode` 在构造函数中运行，因此配置错误的行是在装配加载时失败，而不是在用户第一次提问时。

- `'timed'` 而没有等待时长，这样一行就不能从另一个包的默认值继承时长；
- `'timed'` 且 `timeout: -1`，那会保留阻塞式 `ask()`，只是把卡片按 call id 作键——一个无限期阻塞的 timed 行；
- `'legacy'` 配一个等待时长，而阻塞式工具从不读取它。

`mode: 'legacy'` 是部署有意索取无限期等待的方式。

### 冲突由装配处理，不由本包处理

问题工具由本入口注册，因此同时挂载本插件与基础 bundle 的 `tool-ask-user` 行的装配会把该名字注册两次。挂载本插件时请禁用基础行：

```yaml
- id: tool-ask-user
  disabled: true
- insert:
    - id: web-test-conversation
      name: ../web-test-conversation/lib/index.js
```

### 不发布不变伴随模块

不发布运行时不变伴随模块。本包自己拥有、且不变式可以重新推导的那一个关系，是一次对话被提供哪些工具，而它是本入口独自记录的两件事实的纯函数——会话是否已关联，以及策略是否已确认该项目当前已发布修订。此处唯一存在第二个观察者的关系，即遮罩与策略决定之间的关系，是由策略作为该决定的唯一权威来解决的；对同一次调用的第二次断言只会复述它，而不是检查它。

### 项目关联持久化与明确确认

Commands 的 Loader 条目从 `./commands` 加载，与对话服务一同装配。`./typert` 和 `./remote` 发布生成的 Host 描述符与 Client 声明；`./types` 发布请求与结果类型。`queryStatus(StatusQueryRequest)` 不接受动作动词，`submitAction(ActionRequest)` 不接受查询；线路描述符验证同一限制。

模型可通过 `web_test_query`、`web_test_register_project`、`web_test_probe_entry_urls`、`web_test_attach`、`web_test_declare_environment`、`web_test_action` 调用同一个 Remote。Session 身份来自当前执行 Agent，模型不能指定其他会话。项目目录仅列身份与修订。登记调用 Runtime 唯一写入者；关联先持久化再公布；环境事实先保存，再由策略确认。重开的根对话恢复自身项目和已保存声明，但 `environmentConfirmed` 为 false，事实不会恢复授权。

`StatusReport.environmentDeclarationRevision` 标明已保存声明描述的修订，无已保存事实时为 `null`。项目修订改变后，旧事实仍可读取。进程内关联记录 `declaredRevision`；上下文与工具闸门均要求它等于当前已发布修订，Runtime 发布会立即刷新遮罩。项目变更后必须再次真实 Confirm；重开不会恢复确认。

模型环境工具通过官方问题服务展示完整声明，只有明确选择 Confirm 且项目修订、关联和声明未变化，才保存并确认。拒绝、跳过、自定义文本、取消和上下文变化都不确认。timed 返回 pending 时需重新请求确认；本命令不复用 `ask_user_question` 的迟到答复投影。Client 的明确用户声明直接调用同一个 Remote。工具定义与结果消耗令牌；调用与结果由官方工具流水线记录。

<a id="model-experience"></a>
## 模型体验

### 被接纳的效果

#### 模型看到什么

受管工具定义。已开放的会话在请求 schema 中携带受管名称，未关联的会话一个都不携带；注册的问题工具是已发布的 `ask_user_question` 定义，而不是新造的一个。Commands 插件注册七个模型命令工具，包括 `web_test_update_project`，调用同一个 Remote；Session 身份来自执行 Agent。环境工具在保存和确认前通过官方问题服务展示完整声明。官方工具流水线记录调用与结果，本包不新增系统提示段或 Session 事件。

#### Token 影响

七个命令工具的 schema 和结果消耗令牌。代码读取工具仅在对话已关联且环境已确认时出现。

#### KV 缓存影响

没有。本入口不添加任何前缀或后缀文本，因此既不创建也不使缓存前缀失效。

### 被拒绝的效果

#### 模型看到什么

除上述工具列表之外没有别的。本阶段不经由的工具从 schema 中缺席，模型因此不会把它读成可用的控件；没有关联项目的会话更是完全看不到任何受管名称。

#### Token 影响

不可用的业务动作与被拒绝的命令返回明确的工具结果，消耗令牌。掩码在构建模型请求之前移除受管执行工具。

#### KV 缓存影响

可见工具变化可改变请求前缀；命令拒绝不添加独立前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

这些限制界定了本包何时不适用。它们是当前的包内约束，不是任务待办清单。

- **关联是本入口的，而不是策略的。** `WebTestPolicy` 没有为会话绑定或项目声明暴露读取器，因此由任何其他调用方建立的关联对闸门不可见，工具保持关闭。在策略上增加一个一等读取器即可消除这种不对称。
- **座位接口归 Client 读取。** 当前 UI host、所选 Session 与主面板可见性都是 Client 侧事实（`ctx.sidebarRight` 已挂载的 Session、`ctx.layout` 的 `activePanelId`，以及 Web 服务器文档所述承载对话的 GUI host），没有任何一个存在本包可以消费的 Host 侧接口。本包不重建已删除的 `SidebarRightBinding`，也不自造替代物：Host 知道的是对话代理所持有的那个会话，上下文正是按它建键的。
- **六个命令中有五个是拒绝。** 生成用例、开始、暂停、恢复与取消在本阶段没有领域承接，因此各自以「不可用」作答并说明需要哪个领域。没有东西被排队，也不存在某个动作的回执，因为没有用例或运行记录可供写入。
- **状态报告不携带模型路由就绪度。** 某个任务类型可以跑在哪条 provider 路由上，是模型配置服务的决定，它要发真实请求才能回答，本阶段不依赖它；展示就绪度的调用方必须自行补上该事实，而不是从这份报告里读。
- **timed 问题行是被注册，而未被端到端验证。** 超时与 pending 处理、重连与重开、迟到答案、取消与重复投递都是问题工具与 user-questions 服务的行为；本入口只负责选择该行并拒绝配置错误的那些。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者备注</summary>

Host 构建生成 Client 消费的 Remote 描述符。源码测试与已安装 profile 检查分别运行各自的导入路径。

</details>
