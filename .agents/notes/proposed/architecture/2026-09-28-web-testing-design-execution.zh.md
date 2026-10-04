# Agent Note: 详细设计：接口与执行

Status: proposed

[English](2026-09-28-web-testing-design-execution.md) | 中文

## 问题

浏览器与原生操作需要一致的目标身份、授权、观察新鲜度及被测源码保护。

## 提案

状态：产品设计提案；分项探针和原型工作不代表最终实现或验收通过。本文细化[总体技术设计](2026-09-28-web-testing-architecture.zh.md)的 I01、I03，并规定分析、执行与交互接口；数据提交见[数据与恢复](2026-09-28-web-testing-design-recovery.zh.md)，模型和发行见[模型与发行](2026-09-28-web-testing-design-models-release.zh.md)。产品范围仍以[需求 R01–R58](../feature/2026-09-28-web-testing-requirements.zh.md)为准。本文接口和包名是拟新增设计，不是对 DSH 现成功能的陈述。

阅读顺序：DD01 模块和调用 → DD02 浏览器 → DD03 原生控制与源码保护 → DD04 项目分析和后端 → DD05 会话与工具展示。C01 已由用户确认采用当前 Windows 账户下的受控操作，保护级别与限制见 DD03。

**DD01：模块、调用方与资源所有者**

采用[基座与上游升级](../process/2026-09-28-web-testing-upstream-baseline.zh.md)固定的官方工作区、Electron 桌面启动方式及 Host／Client 编译面。以下为按职责规划的包位置，实际拆包须有当前调用方，不为每个职责框机械新建包。新包遵守已有包组及正式入库规则；包级 AGENTS 只补充模块事实，不替代上游规则。

官方桌面拥有主窗口、聊天、侧栏布局、快捷键、托盘、关窗隐藏和标准退出确认。本应用不重建这些组件，只接入测试卡片、目标资源与持久批次事实。模型提供方、密钥编辑及存储复用官方控件／服务；卡片嵌入接口由 M1 验证，不预先宣称零适配，也不能改成只能在独立设置页完成配置。

| 拟定位置 | 主要导出或服务 | 唯一职责 |
|---|---|---|
| packages/web-test/web-test（已有原型） | 应用身份／入口元数据服务 | 声明预期身份和入口可用性；未实现数据根隔离、Client UI、领域存储或 TestRunService。 |
| packages/web-test/ 下的定义包（拟定） | 测试领域类型、zod 声明、TestRunService 定义 | 包名与拆分依据真实消费方；命令、记录、状态和调用语义与身份元数据分开。 |
| packages/web-test/web-test-runtime | TestRunService 提供方 | 计划提交、调度、恢复、结果提交及会话通知；持有领域存储和活动 Agent（智能体） 的释放责任。 |
| packages/web-test/web-test-analysis | 分析与核验插件 | 源码依据、功能关系、用例草案、差异和断言；经 Runtime 提交资产。 |
| packages/web-test/web-test-browser | Browser Use 提供方、受控浏览器工具 | 统一内嵌和受管独立浏览器的操作、身份上下文和观察。 |
| packages/web-test/web-test-computer | Computer Use 提供方、受控电脑工具 | 包装 Cua Driver；执行桌面所有权和目标限制，不公开整个原始工具目录。 |
| packages/web-test/web-test-policy | 执行策略服务 | 受保护路径、动作范围、外部服务授权和能力检查；服务结果由实际执行器再次执行。 |
| packages/llm 下按需新增的提供方 适配器 | 提供方协议转换 | 复用可用 DSH 适配器；仅有实际专有协议缺口时新建，公共决策格式归领域定义所有者，不绑定品牌。 |
| packages/client/client-web-test | Client 插件 | 对话卡片、浏览器区域、用例／报告／skill（技能） 差异视图与 typed locale。 |
| 应用自己的 profile／组合包 | 显式插件装配 | 固定必需服务及工具；普通对话也适用源码保护。 |
| apps/desktop/src 与 apps/desktop-host/src 下的所属模块 | TargetBroker、浏览器承载、退出／更新状态适配 | 沿用官方生命周期，仅补 Electron 原生对象与 Host 的窄范围通信，以及持久批次的只读事实汇总；桌面模块不存放测试业务权威状态。 |

不单独导出没有当前调用方的抽象层。跨包共享类型放在定义包；包内仅一个实现使用的类型留在实现包。服务 提供方 与 消费方 分离，必需依赖通过 inject 声明，注册和订阅均有 effect 所有者。只有 Runtime 能改变权威测试记录；分析器、模型、Client、浏览器及报表生成器均提交候选事实。

Client→Host 的业务调用使用 @Remote／@RemoteScope，Typert 生成客户端类型和运行描述，经 api-remotes、ctx.remote 与 Connection 使用。不手写平行 DTO，不用 Electron IPC 承载项目、用例、报告业务。以下方法返回提交回执或查询结果；长任务完成由提交记录和会话投影表达。[DSH API 网关](../../../../docs/api-gateway.zh.md)

| 方法 | 输入要点 | 返回及副作用 |
|---|---|---|
| createProjectRevision | commandId、代码根、入口、身份引用、视口和观察渠道；更新时另含 projectId、expectedRevision | 返回 projectId／revisionId；不启动被测应用。 |
| prepareRun | commandId、projectRevisionId、范围、基线、intent | 返回 runId；intent 为 plan-only 或 execute-after-ready，决定准备完成后是否可开测。 |
| submitPlanDecision | commandId、runId、expectedPlanRevision、回答和用例变更决定 | 形成新版本；版本陈旧返回当前版本和冲突，不覆盖用户刚确认的内容。 |
| controlRun | commandId、runId、pause／resume／cancel | 暂停／取消立即关闭本地派发门，再持久化；返回保存状态、控制代次和在途动作数，不等远程模型完成；frozen-recovery 拒绝普通 resume，转 DD12 恢复核实与关联续测。 |
| answerQuestion | commandId、questionId、expectedRevision、answer | 只更新对应问题及受影响资产；不能扩展其他动作授权。 |
| authorizeAction | commandId、authorizationDraftId、expectedRevision、accept | 按草案 kind 采用环境业务动作或外部服务的明确范围；不同 kind 不互相代替，否决同样保存。 |
| takeOver／returnControl | commandId、runId、targetId | 更新控制所有权；归还后重新观察，不假设用户只做了预期操作。 |
| proposeSkill／acceptSkill | commandId、draftId 或草案输入、expectedBaseRevision | 展示差异；明确接受才产生可采用的 SkillRevision。 |
| getRun／listHistory／getReport | 稳定 ID、可选 revision、分页游标 | 读取已提交事实；查询不触发模型或测试操作。 |
| exportReport | commandId、reportRevisionId、格式、脱敏选项 | 固定版本后生成材料；完成才发布可打开的文件引用。 |
| confirmEnvironment | commandId、projectRevisionId、expectedRevision、声明与数据范围 | 保存 EnvironmentDeclaration；普通网址、域名或模型推断不能代替用户声明。 |
| getRunMetrics／getStorageUsage | runId 或项目／批次过滤、分页游标 | 只读已提交计数、采样时刻和空间状态，不调用模型。 |
| previewAssetCleanup／confirmAssetCleanup | 筛选范围或 planId、expectedRevision、commandId | 先列可释放与引用影响；用户确认后再校验引用并执行本地资产清理，不触发业务数据删除。 |

写命令的共同回执为 commandId、resourceId、acceptedRevision、outcome 和必要的 pendingReason；accepted 只表示已提交，不能作为“测试通过”。已存在的 commandId 与原参数哈希相同返回原回执，不同则报 COMMAND_ID_REUSED。pause／cancel 不依赖 UI 缓存的旧 revision，作用于明确 runId 的当前状态；修改计划和接受 skill 必须检查预期版本。错误区分版本冲突、等待用户、能力不可用、环境失效、保存失败与永久配置错误；重试建议不是业务操作重放许可。

commandId 的防重作用域为所属稳定资源；首次创建统一归属该数据根的创建入口，方法及参数均计入哈希。Client 在首次发送前生成并保留，连接重试使用原 ID。首次创建项目／批次也必须先持久登记该 ID 与预留资源 ID，不能等新 RunHead 建成后才开始防重。项目与 skill 的修订分别由其权威头记录提交；具体创建及发布协议见 DD06–DD07。尚在创建或保存中的相同命令返回原资源及 pending，不另起一个任务。

Electron 侧需要受控 TargetBroker；M0 先核对已有 guest lease／preload／主进程机制可复用部分，只补充 Host 目标自动化所需的最小消息。它仅接收已连接 Host 的内部请求，通过既有 Node 子进程 IPC 增加带版本、requestId、hostEpoch 的判别消息；不得把 process.send 或原始 Electron IPC 暴露给渲染页。改变现有消息联合时，同步发送方、接收方、验证器、协议版本兼容判断、打包记录和预期输出；不能只修改一侧，也不能仅凭协议代号未变认定类型兼容。[现有 Host 进程](../../../../apps/desktop/src/host-process.ts)、[协议版本](../../../../apps/desktop/src/host-protocol.ts)

Broker 只认识目标生命周期、观察、有限输入动作、截图、视口、下载路径、派发许可失效和资源关闭，不认识“通过”“缺陷”“更新用例”。请求中的 targetId 必须在当前 Host 代次拥有的目标表中；不接受任意 webContentsId、任意 CDP 方法、JavaScript 字符串、shell 或用户指定 preload。断开 Host 时先拒绝新动作、废弃旧许可，再处理资源关闭和重建。

**DD02：内置浏览器与操作协议**

P01 在 M0-T03 既有写入范围内恢复本地实施，不以上游发布 browser provider 为前提。所选基座已有 Desktop 侧栏 webview 及主进程 guest 归属，但正式 profile 尚未装配面向 Host 受控自动化的 Browser Use provider。本提案通过一个受控 provider 与有限 Broker 补齐这些操作。既有独立浏览器或 UIA 证据不满足内嵌浏览器或 P03 验收；实施顺序与失败对照由 [M0-T03](../process/2026-09-28-web-testing-tasks-m0.zh.md)维护，有限实施许可由[有限开发准入](../process/2026-09-28-web-testing-tasks-m1.zh.md#development-admission)维护。

首轮拟接入现有 webview 租约与呈现，经真实 DSH Loader 和正式桌面入口运行。Main 保留 guest WebContents 的所有权；Host 只取得受限目标身份及有限观察／输入操作，不取得 Electron 对象或任意 CDP 权限。主文档业务场景与目标拒绝对照产生证据后，P01 再以同一场景和限制比较独立归属的 WebContentsView，并据此选择载体。BrowserCarrierDecision 记录运行证据、未决能力行、必要上游改动及维护成本；上游既有选择或某一个 API 失败均不能单独决定结果。未选择候选无需完整产品化。

Broker 使用 DD01 所述已连接 Host 的私有子进程 IPC，将每次请求绑定到其已认证连接、Host／窗口／目标代次及活动租约。Main 在执行前校验目标归属、当前文档／观察、派发许可和操作白名单；未知消息或无效所有者／代次均被拒绝。固定、经审查的页面读取操作可返回有界观察，调用方不能提供可执行字符串或任意选择 Electron／CDP 方法。页面内容及其子目标不获得控制凭证或控制端点。断连、取消、释放及所有者更替先使相关许可失效，迟到回调不能再派发动作。

对已归属页面 WebContents 的直接附着，与对关联目标的自动附着是两种能力。拟定主文档探针使用目标级 debugger 命令，不把 `Target.setAutoAttach` 设为前置；子框架／OOPIF、worker 和 popup 行为仍须各自取得证据。自动附着失败时，须先明确运行时、目标类型及缺失行为，再调整路线；不能据此降低矩阵要求，也不能保证换载体即可修复。Debugger 脱离及 DevTools 争用使受影响观察与许可失效。[Electron v44 Debugger](https://raw.githubusercontent.com/electron/electron/v44.0.0/docs/api/debugger.md)、[CDP Target](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Target.pdl)

官方 guest 默认按 canonical CWD 共享临时 partition，并禁止下载、权限申请及原生弹窗。本应用必须在首次导航前指定 run／activation／角色作用域，新建目标才能改变分区；不得原地切换已打开页面的 partition。按用例受控开放合法下载／popup／文件选择能力，不套用普通浏览面板的全拒绝，也不全局解除隔离。控制目标须在聊天侧栏卸载／关窗后仍满足批次生命周期；不能只依赖 React 挂载。

官方账户页面的 WebContentsView 带专用身份及 preload 语义，不能直接作为不可信被测页面容器。P01 可以复用其布局与生命周期经验，但测试目标必须使用本节隔离配置和独立归属。

P01 对比至少覆盖按角色分区、导航／iframe／popup、下载、焦点／输入、视口与截图、关窗后的目标保留、Host 失联撤权与重建；完整能力矩阵仍由本节维护。Electron 官方当前提醒 webview 的稳定性风险并建议考虑其他载体，这是比较依据，不是宣称它必然不可用或 WebContentsView 已经合格。[Electron 文档](https://www.electronjs.org/docs/latest/api/webview-tag)、[上游实现及验证缺口](../../implemented/feature/2026-09-20-desktop-browser-webview.zh.md)

统一 browser 提供方 注册一次 ctx.browserUse，并复用 SessionResources 管理精确的活动 Agent 所有权。ctx.browserUse 本身只有提供方登记能力，不提供 open／click 等操作；这些是本应用工具与实现的职责。每个执行 Agent 拥有一组目标和身份上下文，Runtime 负责关联 runId。原 Session 恢复产生新 Agent 时不能复用旧 Agent 对象或元素令牌。[官方 Browser Use](../../../../docs/subsystems/browser-use.zh.md)、[SessionResources 源码](../../../../packages/experimental/browser-use-runtime/src/index.ts)

该基线的 SessionResources.run 按精确 Agent 串行执行；对同一 Agent 并发调用不会自动形成业务并发。需要同时操作多个身份时，将已规划执行组放在一次 run 回调中，由组内执行器对不同目标并发派发，每个分支独立保留动作身份、授权和结果；不得在回调中嵌套同一 Agent 的 run，也不修改上游队列来放宽所有权。组内只等待本次有界交互，业务长等待持久化后退出回调；同一目标和原生桌面继续串行。能力不支持真实并发时报告未验证，不能将顺序点击标成并发场景通过。

内置页的浏览器 Session 与应用界面 Session 分开。partition 身份包含 projectId、环境版本、runId、活动 Agent 代次和唯一 contextId；角色及隔离模式属于上下文配置，不能仅靠角色名共享活动档案。不同角色或独立批次不得共享可写的 Cookie、IndexedDB、缓存或 Service Worker 状态。同一业务身份需要跨域登录时保留其合法跨域流程。是否采用历史登录状态由计划引用明确的 ProfileRevision 决定，以受支持的状态导入或无活动写入者时的档案副本创建新上下文；不直接共享历史档案目录，也不能复用“上一次碰巧打开的页面”。浏览器动态档案和静态源码快照是两类资产。

目标页明确关闭 nodeIntegration，启用 contextIsolation、sandbox 和 webSecurity，不加载应用 preload。所有弹窗及子目标在创建时继承安全设置和身份归属；应用凭证注入只允许应用自己拥有的文档。主框架和子框架均不得加载 dsh-app、file 或宿主控制地址；测试入口可为合法 localhost，不能为此全面禁止本地站点。对项目跳转、登录提供方、浏览器权限和下载逐项归属，不通过全局关闭隔离解决兼容问题。

宿主控制面限制还覆盖目标页的子资源、fetch、WebSocket 和 Service Worker 请求，不能只拦截导航。宿主端独立校验连接身份和来源，不向目标页提供应用鉴权材料；目标页面及其子目标不能访问控制面。此处按实际控制端点限制，不妨碍已配置的本地被测服务。

**观察与目标身份。** Observation 至少含 observationId、runId、instanceId、targetId、contextId、targetGeneration、navigationEpoch、frameId、documentId、observedAt、URL、角色、CSS 视口、DPR、浏览器缩放、DOM／AX 摘要引用、截图引用和候选元素。候选元素令牌只在其目标、文档及观察条件有效时使用；运行时内部可以使用 backendNodeId，但不把它当永久业务 ID。

动作请求为 operationId、stepId、actionSlotId、expectedStepRevision、actionKind、targetRef、observationId、preconditions、参数、deadline、dispatchPermit。动作槽位与操作身份由 Runtime 分配，模型不能自行推进步骤修订或补发许可；防重规则见 DD06。文本参数引用保存的 InputValue，保留 CR／LF、空格、Unicode 和精确值；对话展示可转义，执行值不能被展示层改写。点击前核对目标文档、角色、可见性、可交互性及命中对象；同 URL 重渲染也能使引用失效。基于截图的坐标需附截图尺寸、坐标系和采集代次，不能直接把 CSS 坐标当 Windows 物理像素。

| 操作组 | 实现方式 | 成功只代表什么 |
|---|---|---|
| observe／waitFor | DOM、AX、网络／页面事件及截图；按显式条件等待 | 获得当前观察或满足所列等待条件，不代表用例通过。 |
| navigate／back／forward／selectTarget | Broker 管理目标；记录 frame 和导航代次 | 导航或目标选择完成，仍需页面就绪及业务断言。 |
| click／doubleClick／hover／scroll／drag | 有限 CDP Input 或受控原生输入；目标校验后派发 | 输入已交付；保存、拖拽结果另行观察。 |
| typeText／pressKey／paste | 真实输入事件；输入方式由用例固定 | 不能用直接赋值绕过键盘、换行、粘贴或输入法测试。 |
| selectOption／toggle | 经用户可操作的控件路径 | 选择生效；不直接修改页面内部业务状态。 |
| upload／download | 测试文件暂存目录、下载事件和内容读取 | 文件路径提交或下载结束；文件内容需独立校验。 |
| dialog／permission | 有归属的 JS 对话、浏览器权限和原生对话处理 | 记录实际同意、拒绝、取消及后续页面表现。 |
| capture／readNetwork／readConsole | 关联当前目标、时间和请求标识 | 产生定位证据；网络状态码不自动等于业务成功。 |

实现可以使用受审查的固定页面读取函数，但模型不得提交任意 evaluate 表达式。标准动作优先使用浏览器输入能力；Canvas、封闭 Shadow DOM、中文输入法及原生文件选择等走适合的视觉／电脑路径。测试原生文件框时必须实际打开、选择或取消；设置 input.files 只能作为计划中另列的文件内容场景。

页面就绪使用元素状态、应用特征及有界等待，不能仅等待 networkidle，也不能固定 sleep 后截图判错。超时区分操作等待上限和业务验收时限；无业务时限时只记录测量与阻塞依据。目标在校验与点击之间仍可能变化，因此点击后的实际观察不可省略；无法证明作用于正确记录时标记结果不明，不以已发出点击作为成功。

跨域 iframe 和 OOPIF 的 CDP 子会话、popup、下载及权限均属于 提供方 的真实能力矩阵。Debugger 脱离、DevTools 争用、页面崩溃或目标关闭时废弃令牌，记录未完成动作并重建观察；禁止偷偷切换到另一个同 URL 页面。有待推进批次时复用官方关窗隐藏行为，不能销毁 BrowserWindow 再假定其页面仍在运行；明确退出进入包含持久批次事实的官方退出流程。需要前台输入时在会话中显示占用并恢复测试目标窗口，不能在隐藏页上伪称完成原生输入。

Chrome／Edge 例外流程由同一 提供方 的外部实现管理，采用 Playwright 启动的专用浏览器上下文；首次发行固定 Playwright 版本后记录真实浏览器版本。已有独立浏览器只能按明确目标连接，CDP 附着与原生 Playwright 连接分别报告能力；不得接管用户日常配置目录。整条相关登录或业务流程在所选身份上下文完成，不假定外部 Cookie 会自动进入内置页。Playwright 在此承担确定性驱动，不调用自己的 AI 路由。[连接能力差异](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)

**DD02 附件：浏览器能力矩阵候选**

下表两条路线均是拟实现方案，所有行的实际支持状态均为“待验证”，不是 Electron／Playwright 或本应用现成功能保证。正式能力记录还须保存浏览器／驱动版本、操作与条件、支持／受限／不支持、证据、已知限制及可用替代路线，按实际 profile 生成执行能力集。R35 的例外路径只有取得证据后才能选择；切换需重新核验身份和流程，不自动搬运活动页面。

| 操作或场景 | 内置 Electron guest／debugger 候选路线 | 受管 Chrome／Edge／Playwright 候选路线 | 验证与边界 |
|---|---|---|---|
| DOM／AX 观察、普通点击与滚动 | 目标级 CDP、有限读取与输入 | 定位器与浏览器输入 | V01–V02；目标、角色、页面代次对应，输入交付不等于业务成功。 |
| 跨域 iframe／OOPIF／popup | Broker 管理子目标及 CDP 子会话 | frame／page 生命周期 | V01–V03；正常登录可用，子目标不取得宿主能力。 |
| Shadow DOM／Canvas／拖拽 | 可读结构定位，必要时视觉与受控输入 | 可读结构定位，必要时视觉与受控输入 | V02；封闭结构及无语义区域不能假称均可 DOM 定位。 |
| Enter、换行、焦点与粘贴 | 有限键盘和输入通路 | 键盘和输入通路 | AC09、AC50；用例要求事件行为时，直接赋值不能替代。 |
| 中文输入法与真实系统键盘 | 受控原生 提供方 配合可见目标 | 同一原生 提供方 配合专用浏览器窗口 | V02、V09、V13；按实际 IME、焦点及 DPI 验证，CDP 文本注入不足以证明。 |
| 上传和原生文件选择 | 文件内容入口与真实对话分别执行 | 文件内容入口与真实对话分别执行 | AC50、V08；通过设置文件绕过对话的场景单独标识。 |
| 下载、保存对话与内容核验 | 受控目的地、下载事件、必要原生交互 | 下载事件、专用目录、必要原生交互 | AC50、V08；目录、覆盖及内容均核验，文件存在不等于正确。 |
| 角色隔离、历史状态与并发 | 活动 partition、ProfileRevision 导入、执行组 | 隔离 context／专用 profile、执行组 | V03；同记录流程及动作重叠有证据，旧状态不假称已完整迁移。 |
| 视口、截图与布局检查 | 独立目标尺寸、受控缩放和截图 | context／page 尺寸及截图 | AC08、AC40；页面实际尺寸与 DPI 有记录，原生受限尺寸不能伪造成功。 |
| 控制台、网络及请求关联 | 受控事件采集与敏感字段清理 | 受控事件采集与敏感字段清理 | AC38；缺失响应体、流式响应或无法观察的请求显式记录。 |
| 断网、延迟、失败及解除 | 按目标施加的有限故障能力 | 按 context／请求施加的有限故障能力 | AC49；缓存／Service Worker 对照，验证实际生效和恢复，不影响宿主连接。 |
| 截图和按需录像 | 原始截图与录像采集通路另验 | 原始截图与录像采集通路另验 | AC38、AC55；真实原生对话是否入镜单列，页面录像不能代表整个桌面。 |
| 关闭、重建、重连和旧回执 | Host／目标代次及 Broker 失联处理 | 受管进程／连接和目标重建 | V04–V07；取消不会撤销已经交付的业务动作。 |
| 连接已有独立浏览器 | 不适用；不能接管应用控制页 | 如提供 CDP 附着，单独记录能力 | 不把附着等同新建受管上下文；日常用户 profile 不纳入默认接管。 |

页面权限、外部登录提供方、下载及原生交互的例外由所属行记录，不用全局关闭隔离补齐矩阵。任一路线未能完成首版必需能力，都仍是工具交付缺口；报告中如实写未验证不能关闭该验收。完整矩阵在 M4 前形成可执行样例，M5 按真实安装产物复核，见[实施计划](../process/2026-09-28-web-testing-milestones.zh.md)。

**DD03：Windows 原生控制与源码只读**

已确认选择 C01：使用当前 Windows 账户，以应用层受控操作保护被测源码；允许测试浏览器、相关原生窗口及经过校验的已有命令，禁止任意终端、代码编辑器及不受限制的桌面控制。无法确认操作是否会修改源码时，阻塞受影响项并说明，其他独立项继续。该保护不是操作系统级隔离保证；首版不以创建新账户或修改用户 ACL 为前提。

保护级别的依据：官方 Windows sandbox 提供方 的文件隔离状态是 partial，包含硬链接、读取／网络及 AppContainer ACL 等边界。原生输入能够控制同等完整性级别的其他程序，同账户程序通常也拥有同一用户的文件权限。因此本产品验证的是自己所有受支持入口的执行限制，不宣称抵抗任意同账户程序、执行器漏洞或用户主动解除限制后的写入。[DSH sandbox](../../../../docs/subsystems/sandbox.zh.md)、[Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

应用以非提权方式运行，不自动请求管理员权限、不操作 UAC 安全桌面，不把当前账户管理员身份当作执行许可。路径检查使用实际解析结果，处理 junction、符号链接、UNC 与目录替换；“只读”文件属性不能当成系统保护证明。独立账户及更强隔离不列为首版环境前提，未来如改变保证等级，需要重新设计并取得明确确认。[Windows 文件权限](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)

项目配置区分源码／配置／依赖文件与合法业务数据库、上传、日志和运行缓存；路径存在重叠或作用不明时先分析已有部署布局，不能自行改配置解决。被测服务自身的文件写入不是本地路径检查可以完全控制的；发现业务入口可以编辑源码、写配置或执行任意管理脚本时同样拒绝触发，不因它位于网页中绕过规则。已有命令的参数、运行配置及已知文件效果需要核对，无法可靠限制或判断时列为阻塞。

受保护集合包括所有源目录、项目配置、依赖、Git 元数据和已冻结的分析材料；可写集合为应用状态、证据、报告、受管浏览器数据和专门的测试文件。源码文件不作为下载或导出目的地。写路径通过最终父目录和文件标识复核；无法确认时拒绝该写操作并保留任务。导出不能覆盖用户任意文件，用户显式选择已有目的文件时另走明确覆盖决定。

已冻结的应用自有分析副本禁止内容改写；按 R55 明确确认后的资产生命周期删除由 DD09 的独立清理入口负责，不能开放成模型通用写工具，也不授权删除原始项目文件。读取共享资产与清理互斥按引用所有权校验。

普通 DSH 对话保留会话、阅读和推理体验，但不默认装配修改项目的工具。skill 的脚本、PTC 子调用、MCP、插件安装和管理命令不能扩大受保护范围。用户添加通用 DSH 插件若能绕开统一执行器，不允许在测试配置中直接获得操作能力；可用能力通过经过核验的适配加入。受控工具、路径和目标校验必须在实际执行处生效，提示词和事后文件摘要只能辅助，不能替代拒绝机制。

运行中启用新工具或官方首次引导修改 enabled 工具集合，必须重新核对实际执行器和策略，不能以配置启用等同安全放行。自动审查拒绝后的人工审批也不覆盖源码只读等绝对禁止条件；允许范围内的业务授权才进入 approval。V08 同时覆盖动态工具、引导配置、PTC 子调用及审批路径。

原生控制使用基座清单锁定的 @trycua/cua-driver，在 Host 内创建 SDK 实例。上游原生 提供方 会公开整个发现目录，本应用因此采用自己的受控 提供方，复用 SDK 和官方工具结果转换，登记为唯一 Computer Use 提供方；不同时加载上游无约束原生 提供方。初版接受 SDK 原生崩溃可能导致 Host 退出的风险，以 DD07 的已提交状态恢复，不宣称已经实现独立原生进程隔离。[上游 提供方 实现](../../../../packages/experimental/computer-use-cua-driver-native/src/index.ts)

启动先核验 SDK 发现目录与所用工具的参数 schema。只映射窗口发现、窗口快照、元素／坐标输入及必要剪贴板能力；不存在的能力报 capability-unavailable，不猜测工具名称。调用通过 listToolsJson／callTool 的实际接口，执行信号合并生命周期取消信号；卸载停止接收、取消等待、结算或标记在途，再 shutdown／uniffiDestroy，失败不提前释放占用。

DesktopLease 记录 runId、instanceId、hostEpoch、windowToken、processId、acquiredAt、mode 和控制代次。默认优先 SDK 支持的后台输入；必须前台的场景明确占用桌面，前台拒绝不会隐式升级。输入前检查前台窗口、进程及新鲜快照，操作后核验；其他程序抢焦点则撤销后续许可。系统全局输入不存在与外部应用切换窗口的原子事务，这个剩余风险属于已确认的应用层保护限制；不能宣称焦点检查消除了它。禁止自动接管应用自身的对话、设置、插件和更新窗口。原生文件框只开放选择、取消及受控保存，删除文件、修改权限、启动程序等附带能力不可开放。

锁屏、睡眠、远程桌面断开和用户接管记录为环境等待，释放可释放的输入资源；恢复后验证交互桌面和显示条件。后台浏览器可继续时独立用例继续；需要真实输入的步骤不得伪造成功。多角色业务并发可用隔离浏览器上下文；原生输入全桌面串行，不把“两个 Agent 同时点击一个桌面”作为并发实现。

**DD04：分析、用例和已有后端入口**

项目分析分成可持久化的小任务：列出材料 → 采集内容 → 建立入口／功能／业务状态关系 → 生成场景 → 生成用例 → 核对遗漏与问题。每个任务引用输入快照、分析器／模型版本及输出记录；中断后只补未提交任务。语言识别用于选择可选解析器，通用文本读取和检索始终可用；二进制、读取失败、超大文件和无法推断部分有清单，不用“文件已枚举”冒充读懂。

FeatureRecord 的稳定身份来自业务能力和入口／状态关联，不以临时路由中的订单 ID 命名。源码推断记录为 implementation-derived；用户确认规则为 user-confirmed；已有需求和 skill 另记来源及版本。存在冲突或缺乏可判断的预期时生成 Question，开测前解决所影响用例；原始代码行为不能自动覆盖业务预期。

上述 source 类型描述来源，不等于断言的 expectationAuthority。断言按报告规格分为 confirmed-business、applicable-generic、implementation-only；关键金额、权限、状态迁移、删除和外部影响规则进入 criticalRuleReview，即使代码表现明确也须绑定用户已确认的具体规则修订。仅实现匹配进入 observationComparison 诊断，不能填业务 passed；未确认预期保留问题和覆盖分母。

CaseVersion 保存 stepId、角色与入口、输入原值、动作意图、前置条件、断言及其依据、观察渠道、数据依赖和后置处理。技能提供检查模板和业务知识，执行器提供真实能力，二者不能互相替代。没有设计稿时，视觉断言针对遮挡、溢出、截断、错位、不可操作及业务语义；审美偏好不自动成为缺陷。疑似问题保存画面与元素几何，使用稳定页面和必要对照复核。

完整性核对分别输出材料分析清单、识别功能清单、用例映射和执行实例计划。计数可以显示已分析文件比例、已映射功能数和未验证断言数，但不从这些数推导代码分支覆盖率或“所有未知功能已穷尽”。执行中发现新功能先保存 PlanRevision 再开展正式测试；含新业务疑问的部分按既定规则跳过并报告。

已有后端入口采用 BackendActionDescriptor：actionId／revision、入口类型、HTTP 方法与路径或可执行文件标识、参数 schema、允许的工作目录、环境变量白名单、业务副作用、外部服务触发、结果观察、数据关联与重试条件。模型选择 actionId 并提交结构化参数，不能提供完整 shell 命令。变更描述需要生成新版本，运行批次继续引用原版本。

管理命令使用明确可执行文件与 argv 数组，不串接命令、不加载用户任意 shell profile、不安装依赖或修改配置。命令描述“只读”不是隔离证明：子进程仍受受保护路径、权限与 DSH confinement 检查；不能获得所需保护就记录该入口阻塞。后台任务触发必须按业务关联 ID 观察最终状态；HTTP 202、任务投递或退出码 0 只代表入口接受。

真实第三方动作采用 ActionAuthorization，至少包括环境、服务、动作、接收方／金额或数据范围、允许次数、有效期和是否允许核实后补发。确认卡片引用固定授权草案版本；超范围重新确认。代码分析发现间接触发发送也需关联授权。缺少真实服务按已确认规则跳过；无法知道是否真实不能标为“无服务”。已有服务不支持幂等或可靠查询时，丢失回执记录为未知，不靠授权次数判断是否发生。

R54 的 EnvironmentDeclaration 先于正式执行和业务数据准备，按入口绑定环境性质、账号／租户、数据范围、用户确认消息及相关配置摘要。测试环境可以确认全量测试数据；生产／未知环境的变更由 kind=environment-action 的 ActionAuthorization 引用明确 PlanRevision、用例／准备／清理步骤、目标记录范围、次数和有效期。已有 kind=external-service 授权仍独立满足，任一个不足均不派发；未出现第三方发送也不能绕过环境授权。

执行器按动作实际效果分类，不根据 GET／POST、按钮名字或“只读”标签猜测。必要登录及观察的已知副作用在计划中说明；可能创建记录、影响共享状态或执行故障模拟时同样校验环境范围。入口或相关环境配置变化、实际现象与声明冲突时，关闭受影响范围的新派发并重新核对；其他已核实入口可继续。用户声明不作为技术认证，源码只读禁止项不能通过环境授权解除。

**DD05：自然语言与工具呈现**

本应用 profile 不装配无限制的侧栏终端及其服务入口；上游用户终端以系统用户权限运行，不能仅隐藏按钮或假定 Agent 沙箱覆盖它。普通 DSH 对话仍保留，会话归档与插件变更需核对本应用的未结束持久任务。

自然语言先识别关联项目和 runId；单一明确上下文直接使用。生成测试用例、修改规则、执行测试、暂停和取消是不同命令。“只生成用例”固定 plan-only，不准备会改变业务的数据。模型提出的业务命令经 Runtime 校验，Client 上的显式控制动作使用同一个服务入口；状态查询不启动 Agent。

普通聊天与执行会话分离生命周期，通过 runId 和 originatingSessionId 关联。没有项目的聊天不自动载入其他项目资料；有项目的聊天遵守相同只读策略。执行 Agent 的工具目录按当前任务缩小，但能力限制最终由执行器判断。用户切换会话或关闭聊天视图不释放测试资源。

| 工具呈现 | 执行前展示 | 执行后展示 |
|---|---|---|
| web_test_browser_observe | 目标和角色 | 新鲜页面摘要与截图；内部节点 ID 默认隐藏。 |
| web_test_browser_act | 用例步骤、目标和输入方式 | 已交付／未交付／结果待核验、实际观察和证据入口。 |
| web_test_computer_act | 正在占用的测试窗口及前台要求 | 操作结果、接管或环境等待；不展示无关窗口截图。 |
| web_test_backend_invoke | 业务动作、参数摘要和副作用 | 接受结果与后续核验分别展示。 |
| web_test_case_verify | 断言与已确认预期 | 通过、失败或未验证原因；证据和定位分开展示。 |
| web_test_skill_propose | 草案目的和生效范围 | 具体差异、依据、接受／拒绝；不自动写入项目。 |

表中为拟注册的工具名称；用户界面使用 typed locale 提供中文名称，不要求用户记忆这些标识。正式声明仍须通过所选 DSH 基线的工具名称和 schema 检查。

Host 展示转换器 只根据输入、结果及已有元数据生成展示；Client 不通过文案猜执行状态。会话节点携带稳定业务 ID 与已提交 revision，重连后重新读取事实；待处理事项仅出现在所属桌面对话。持续状态的去重和投递规则见 DD07，报告字段见既有[报告规格](../feature/2026-09-28-web-testing-test-case-report-spec.zh.md)。

首启与模型配置使用普通对话中的引导及专用卡片，复用官方 提供方 编辑器、秘密输入控件和配置／凭证服务；优先检验现有组件导出及嵌入接口，不足之处按同一 Remote 和受保护凭证边界适配，不另建模型配置后端。界面复用不改变对话和卡片内可完成配置的验收要求。用户可先浏览和准备项目；调用前检查该任务所需能力。连通测试展示将使用的模型与请求性质，凭证仅经专用敏感输入进入配置服务，不经过模型工具参数、Session 正文、通用表单日志或导出。错误明确区分连接、认证、模型和能力；配置的用户可见流程及路由就绪判定见 DD11。

“看进度／用了多少 token／磁盘占用多少／清理这些历史”映射到对应只读查询或清理预览。卡片展示采样时间、当前阶段、已结算／计划内实例与断言、最后实质进展、等待及用量缺口；阶段变更和必要处理才提醒，不能持续刷屏。空间清理的确认卡片列出可释放字节、保留项、影响的报告及回归基线，固定预览版本；规则见 DD09。传统独立管理后台不是首版前提。

## 考虑过的替代方案

**已记录的取舍。** 不受限制的桌面或 shell 控制不能落实已接受的源码保护策略；受控操作保留当前 Windows 账户。

## 验收标准

执行本提案中的正常和失败对照，并满足[统一验收标准](../testing/2026-09-28-web-testing-acceptance.zh.md)及相应任务的证据要求。文档迁移不代表这些条件已通过。

## 风险

应用限制不提供操作系统隔离，原生焦点竞争可能需要等待或拒绝操作。
