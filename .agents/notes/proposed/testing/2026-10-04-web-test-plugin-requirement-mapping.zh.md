# 需求对应表：dsh-plugin-web-test

状态：proposed

[English](2026-10-04-web-test-plugin-requirement-mapping.md) | 中文

本表把[产品需求 R01–R58](../feature/2026-09-28-web-testing-requirements.zh.md)逐条映射到可安装插件 `dsh-plugin-web-test` 的交付阶段，并如实记录每条当前的验证状态。技术方案见[可安装插件方案](../architecture/2026-10-04-web-testing-installable-plugin-plan.zh.md)，用例与报告字段见[测试用例与报告规格](../feature/2026-09-28-web-testing-test-case-report-spec.zh.md)。

状态取值：**已实测**指在未修改的 DSH 0.2.0-rc.2 上取到证据；**骨架**指接口与代码路径已就位但未产生运行证据；**未开始**指尚未实现；**宿主限制**指原版 DSH 不提供所需公开接口，已记录取舍。

平台口径：本表所有"已实测"均在 Ubuntu 24.04／Node 24.15.0／pnpm 11.7.0 取得。**Windows 10 22H2／11 x64 的桌面验收全部未验证**，见文末。

## 一、产品边界与环境

| 编号 | 要求要点 | 交付阶段 | 状态 | 证据或说明 |
|---|---|---|---|---|
| R01 | 单人桌面应用，无团队协作体系 | S1 | 骨架 | 插件不含任何组织、成员或权限模型；`Config` 仅有浏览器相关字段。 |
| R02 | Windows 10 22H2 及以上 x64 | S6 | **未验证** | 仅 Ubuntu 实测。Windows 依赖路径、权限与进程模型未取证。 |
| R03 | 沿用 DSH 底座与官方桌面路线 | S0 | 已实测 | 插件经插件管理器安装进 `dsh --from-default-profile web` 新建 profile，宿主二进制未改。 |
| R04 | 自有代码遵循 DSH 工程规范 | 全程 | 骨架 | 独立工作区复制了官方 `tsconfig` 严格项、插件导出约定、注册皆为 effect、locale 归属客户端等规则。仓库自身的 lint／hygiene 门禁未运行。 |
| R05 | 用户提供全部项目代码 | S2 | 未开始 | 项目记录已含 `sourceRoot`。 |
| R06 | 用户负责启动被测项目 | S2 | 骨架 | 项目记录已含 `baseUrl`；插件不部署、不安装依赖。 |
| R07 | 从代码自动生成需求认知，区分规则来源 | S2 | 未开始 | 需实现"已确认业务规则／通用规则／仅实现推断"三分来源。 |
| R08 | 没有设计稿，视觉检查从实际页面发现 | S3 | 未开始 | 首版证据以实际页面截图为准，不引入设计稿比对。 |
| R09 | 覆盖全部功能的集中测试 | S3 | 未开始 | 对应"全部功能纳入测试是目标，覆盖率须注明分母"。 |
| R10 | 自然语言选择与输入测试要求 | S2 | 未开始 | 对话为主入口，设置分区仅承载项目与环境参数。 |
| R11 | 性能压测与安全专项按需勾选 | S4 | 未开始 | 需独立勾选项与执行参数。 |
| R12 | 只测试，不修改被测源码／配置／依赖 | S0／S3 | **已实测（执行层）** | `web-test` 预设的执行守卫是单调拒绝的白名单：实测把 `@deepseek-ai/dsh-tool-bash` 故意放进预设后，模型调用被拒，原文为 `web-test sessions may only call web_test_* and mcp__playwright-mcp__* tools`。限制落在执行路径而非提示词。 |
| R13 | 测试环境业务数据允许增删改 | S4 | 未开始 | 须与 R54 的环境声明绑定后才能授权。 |
| R14 | 生成报告，不自动修复 | S3 | 未开始 | 插件不提供任何写回被测仓库的路径。 |
| R15 | 保存测试历史，支持回归与复测 | S3 | 未开始 | 运行记录表已声明，尚未写入。 |
| R16 | 长程任务可恢复重试 | S4 | 未开始 | 宿主已有 API 重试；本插件不重复实现。 |
| R17 | 模型调用无费用上限 | — | 宿主承担 | 插件不设任何费用阈值。 |
| R18 | 按任务路由模型 | S1／S3 | 骨架 | 使用宿主既有模型配置，未新增第二套凭证；插件不自行选路。 |
| R19 | 支持用户配置 skill | S2 | 骨架 | 沿用 DSH 既有 skill 发现机制，插件不自建格式。 |
| R20 | 保留原生 DSH 对话体验 | S0 | 已实测 | 未包装普通会话：实测默认预设仍为 `standard`，插件只贡献并列的可选 `web-test` 预设。 |
| R21 | 主动提出 skill 改进草案，经确认后生效 | S4 | 未开始 | 须经草案确认流程，不得自行改写已生效规则。 |
| R22 | 多种登录方式与人工接管 | S4 | 未开始 | 浏览器归属会话后，人工接管的资源回收语义见 S4 说明。 |
| R23 | 可用专用电脑测试 | S4 | 宿主限制 | 原版 DSH 未提供独立的受控电脑控制入口；首版以浏览器路径覆盖。 |
| R24 | 补充运行证据（日志／只读数据库核验） | S3 | 未开始 | 须按项目配置路径，不得从"有源码"推断可访问。 |
| R25 | 外部业务执行前确认 | S4 | 未开始 | 跳过原因必须进入报告且不得计为通过。 |
| R26 | 自然语言驱动测试全过程 | S2／S3 | 骨架 | 设置分区已存在且可用；计划、进度、报告的会话呈现待建。 |

## 二、用例、执行与报告

| 编号 | 要求要点 | 交付阶段 | 状态 | 证据或说明 |
|---|---|---|---|---|
| R27 | 先生成用例，再执行 | S3 | 未开始 | 用例资产需先于执行形成。 |
| R28 | 执行中新业务疑问先跳过 | S3 | 未开始 | 不得凭部分步骤成功判整条通过。 |
| R29 | 按用例逐项执行全部功能 | S3 | 未开始 | 读代码与接口成功不能替代真实页面执行。 |
| R30 | 新版本开测前确认用例更新 | S3 | 未开始 | 须与基线快照关联，不默认取最后一次未完成批次。 |
| R31 | 报告面向用户和编程助手 | S3 | 未开始 | 报告不修改被测代码。 |
| R32 | 覆盖无页面入口的后端功能 | S3 | 未开始 | 入口缺失须列为未验证。 |
| R33 | 保留问题数据，清理其他新增测试数据 | S4 | 未开始 | 清理走业务入口，不直接写库。 |
| R34 | 仅在所属会话内提醒 | S4 | 未开始 | 不建系统通知或推送渠道。 |
| R35 | 内置浏览器为主，独立浏览器补充 | S0 | **已实测** | 首版用官方 Playwright MCP 提供方驱动独立 Chrome，实测启动系统 Chrome 147、导航本地页面并返回真实截图，结果注明实际环境。 |
| R36 | 关闭窗口后继续后台测试 | S4 | 宿主限制 | 原版 DSH 无会话关闭接口；实测会话取消后浏览器仍随宿主存活，宿主退出时被完整回收。 |
| R37 | 重开应用后核验并自动续跑 | S4 | 未开始 | 须先核对环境、登录与已提交操作。 |
| R38 | 默认记录并保留必要证据 | S3 | 骨架 | 证据目录归属插件自有数据根，权限 0700／0600。 |
| R39 | 应用内报告及多格式导出 | S3 | 未开始 | HTML／Markdown／JSON 与证据包同源。 |
| R40 | 区分应用窗口与被测页面尺寸 | S2 | 未开始 | 视口宽高须在用例阶段询问并保存。 |
| R41 | 开测前检查用例完整性 | S3 | 未开始 | 不得仅凭"已执行全部已生成用例"宣称测全。 |
| R42 | 多入口项目的完整业务流程测试 | S3 | 未开始 | 需同时保留流程级与步骤级结果。 |
| R43 | 按业务需要验证并发及多角色交互 | S4 | 未开始 | 与 R48 的批次排队分别表达。 |
| R44 | 识别测试期间的版本变化 | S4 | 未开始 | 不得把不同版本数据混为同一结论。 |
| R45 | 回归比较基线可指定且可追溯 | S3 | 未开始 | 不用未完成测试或有问题的截图替换基线。 |
| R46 | 保留初次失败，支持有限复试 | S4 | 未开始 | 之后成功不能抹去此前失败。 |
| R47 | 用户可纠正或处置测试结论 | S4 | 未开始 | 处置记录不覆盖原始执行证据。 |
| R48 | 测试任务避免相互干扰 | S4 | 未开始 | 同环境共享业务数据的独立批次默认排队。 |

## 三、专项场景与数据

| 编号 | 要求要点 | 交付阶段 | 状态 | 证据或说明 |
|---|---|---|---|---|
| R49 | 异常恢复测试默认纳入 | S4 | 未开始 | 模拟须确认生效并在结束时解除。 |
| R50 | 自动准备测试数据与文件并核验 | S4 | 未开始 | 准备失败不得当作对应业务已验证。 |
| R51 | 支持跨时间业务流程 | S4 | 未开始 | 等待期间持久化并继续独立用例。 |
| R52 | 回归含旧数据兼容检查 | S4 | 未开始 | 与 R33 的清理范围须协调。 |
| R53 | 执行中持续补齐功能与用例清单 | S3 | 未开始 | 新增用例不倒填、不覆盖已执行记录。 |
| R54 | 开测前确认环境性质与数据操作范围 | S2 | 未开始 | 生产或未知环境默认不执行业务变更。 |
| R55 | 本地资产空间监测与用户清理 | S4 | 骨架 | 插件自有数据根可计量；共享证据与活动任务资产不可直接删除。 |
| R56 | 对话式首次模型配置与凭证管理 | S1 | **已实测（复用）** | 插件不建第二套凭证：会话与 Remote 全程使用宿主既有模型配置。 |
| R57 | 检测任务整体无实质进展 | S4 | 未开始 | 等待类状态须单列，不套同一墙钟超时。 |
| R58 | 运行中可查看进度、耗时与用量 | S4 | 未开始 | 读取已记录事实，不为显示状态额外调用模型。 |

## 四、S0 已实测结论

以下结论在未修改的 DSH 0.2.0-rc.2、Ubuntu 24.04 上逐条取得，可复跑：

1. 插件经插件管理器以 tarball 安装进干净 profile，宿主启动零失败插件。
2. 设置出现本地化"Web 测试"分区，并通过类型化 Remote 渲染宿主活数据。
3. `webTest/status`、`webTest/putProject`、`webTest/listProjects` 往返成功；残缺入参被严格编解码以 `gateway/input-invalid` 拒绝。
4. 业务数据落在插件自有 SQLite（`~/.dsh/plugins/dsh-plugin-web-test/web-test.sqlite`），宿主 JSON 后端未被写入；跨进程重启可读。
5. 存储版本戳改为 99 后拒绝打开并报明版本不符，不静默当作空数据。
6. `web-test` 预设在真实模型回合中执行：放行 `web_test_*` 与 `mcp__playwright-mcp__*`，拒绝存在但非白名单的 `bash`。
7. 官方 Playwright MCP 提供方驱动系统 Chrome 完成最小测试并返回真实截图。
8. 活动任务期间禁用 `include:web-test` 后停止派发、存储 drain；重新启用恢复服务且数据完好。

## 五、宿主限制与已记录偏离

1. **存储不经 Storage Domain。** 域路由是宿主 `Config` 级决定（`backend` 加逐域 `routes`），安装包无法改写宿主自有行；实测经域写入会落到宿主 JSON 后端。插件改为直接以 `ctx.storage.backend.get('sqlite').kv.open(...)` 打开自有单元，单写者与版本精确匹配由插件保证。
2. **Typert 产物由脚本直接产出。** 官方生成器从 DSH 单仓聚合 tsconfig 发现包，在独立工作区解析不到服务贡献，产出 0 services／0 invocations。插件按官方产物的同一格式自行产出 `typert.host.js` 与远端贡献，不引入第二套 RPC 协议。
3. **浏览器属会话所有。** 浏览器行在预设内（宿主持久层挂载会把浏览器工具暴露给所有普通会话，违反每会话可选）。因此禁用 bundle 行可停止派发并 drain 插件自有存储，但无法回收活会话的浏览器；宿主无会话关闭接口，浏览器随宿主退出被完整回收。
4. **插件私有行非宿主自有。** 官方 `dsh-storage-sqlite`、官方 Playwright MCP 提供方及其 peer `dsh-browser-use` 均不随未修改的 CLI 分发，插件将其声明为自有安装依赖并各自补行。

- 证据不再由模型自报：插件按 `runKey` 在自有数据根下建 `evidence/<runKey>/`，并对上报的每条证据路径校验绝对、位于该目录内、且指向真实文件，否则拒绝整条结果。`web_test_status` 现回报证据根目录供模型取用。
- 两侧均已实测：预置一个真实 PNG 证据文件后，模型上报其绝对路径，`web_test_report_case` **被接受并落库**，回读的 `evidencePaths` 为规范化后的绝对路径，文件在盘上真实存在（12596 字节 PNG）；对照的 `run-2`（模型自报路径）**结果数仍为 0**。拒绝消息原文仍未在会话日志中取到，但"坏路径不入库"已由对照组证实。
- 报告生成：`webTest/buildReport(runKey)` 从已记录结果渲染 Markdown 报告，含运行级结论、逐用例步骤／断言／证据／待确认，以及跨用例汇总的"本次运行未能确认的问题"。报告**只由已记录结果推导**，因此报告中每句话都能回溯到插件接受过的用例记录。
- 结论口径已定并实测：只要存在任何 `openQuestions`，运行级结论即为"存在 N 项待确认，结论未定"，用例标题同时显示"通过（N 项待确认）"，逐用例 `outcome` 仍原样可见。修正前 `run-3` 的结论为"全部已记录用例通过"，修正后为"存在 2 项待确认，结论未定"。空运行 `run-none` 结论为"没有可判定的用例"，不判定通过。
- 证据目录权限改为 `mkdirSync` 后显式 `chmodSync(dir, 0o700)`（前者受 umask 影响且不作用于已存在目录）。**该修复尚未观测到结果**：目录只在记录用例结果时创建，而本轮两次会话中模型只调用了 `web_test_status`、未再调用 `web_test_report_case`，因此新建目录的 700 权限仍未实测确认。
- 运行层已建立并实测：`web_test_start_run` 创建运行记录（`phase: execution` / `status: running`）**并在运行开始时就建好证据目录**，`web_test_finish_run` 关闭运行（`phase: cleanup` / `status: completed|cancelled|blocked`），未通过 `web_test_start_run` 开始过的运行无法关闭。`webTest/getRun` 与 `webTest/listRuns` 可经类型化 Remote 读取。
- 实测 `run-5`：完整走完 start → report_case → finish，运行记录为 `{phase: cleanup, status: blocked}`，证据目录 `evidence/run-5` 权限实测为 **700**（上轮未观测到的权限修正在此确认）。报告显示"存在 1 项待确认，结论未定"，用例标题为"阻塞（1 项待确认）"，并完整带出"环境性质未确认，用例无法执行"这条待确认。
- 暂停/恢复/取消已实现并在执行层强制：`webTest/controlRun(runKey, pause|resume|cancel)` 改变运行状态与存储的 held 集合；`ctx.tools.guard` 在派发前读取 held，暂停或取消的运行**拒绝一切测试动作**，`web_test_status` 仍可达以便模型说明原因。非法转换被拒：重复暂停报 `is paused and cannot pause`；已取消的运行**不可恢复**（`is cancelled and cannot resume`），因为其浏览器与证据已不复存在。
- 实测：暂停期间模型调用 `browser_navigate` 被真实拒绝，日志原文 `Error: web-test: run run-6 is paused by operator request and refuses new test actions; resume it with web_test_resume_run before acting`。转换链 `running → paused → resuming → cancelled` 逐级实测通过。
- 取消后的拦截已单独取证：`run-7` 取消后，新会话里的 `browser_navigate` 被真实拒绝，日志原文 `Error: web-test: run run-7 is cancelled by operator request and refuses new test actions`。模型随后调用 `web_test_status` 并如实报告"导航被拒绝、运行已取消"，未谎称已执行。
- 上一轮把"取消后无浏览器调用结果"报成未观测，**该判断有误**：日志中 `tool/result` 事件的 `name` 为 `None`，而当轮的过滤条件按 `name` 匹配浏览器工具，因此统计为 0。实际调用发生过并被拒绝。是校验脚本的过滤条件写错，不是模型没有调用。
- 悬空的 `resuming` 状态已消除：暂停不拆除会话的浏览器，因此没有需要表示的"重新建立"阶段，`resume` 直接回到 `running`。`resuming` 仍留在模式中但不再产生。
- **已修复的活性缺陷**：held 集合原先包含已取消的运行，而 `heldRun()` 返回任意一个，于是**一次取消会拦死宿主里所有后续运行**（新会话的 `run-8` 被无关的已取消 `run-7` 拦下，模型试遍 `web_test_start_run`、`bash`、`web_test_finish_run` 全部被拒）。现已收窄为**只有暂停的运行才持有**；取消是终态、不再持有。修复后新运行 `run-9` 完整跑通。
- **证据来源的已知缺口**：`run-9` 完整跑通（start → 浏览器导航 → 读标题 → 上报 → finish），报告结论"全部已记录用例通过"，证据文件 `evidence/run-9/home-title.png` 真实存在（12596 字节 PNG，901x831）。但该文件与早前预置的 `run-3` 文件 **sha256 完全相同**，且模型在过程中多次调用 `browser_run_code_unsafe`。因此：**已验证浏览器真实导航并读到页面标题**；**未验证该证据文件是本次浏览器产出的**。插件的证据校验只检查"是绝对路径、位于该运行目录内、且是真实存在的文件"，**不检查文件是否本次新生成、是否由浏览器产出**。上一轮"证据路径双向校验完成"的说法因此需要收窄。
- **普通会话不受影响（目标要求，已单独取证）**：在 `run-9` 处于**暂停**（对 held 机制最不利的情况）时，新建一个**非 web-test 预设**的普通会话，其 `bash` 工具正常执行并返回 `PLUGIN-IS-NOT-IN-THE-WAY`。插件的执行限制挂在 web-test agent 上，不波及普通会话。
- 证据新鲜度检查**已实现但未取证**：`ensureEvidenceDir` 记录本次运行准备目录的时刻，`report_case` 拒绝 mtime 早于该时刻的证据文件（`cannot be evidence of this run`）。本轮的验证尝试未成功：模型没有按指示用旧文件调用 `report_case`，而是把 `run-10` 以 blocked 关闭，因此**新文件被接受、旧文件被拒绝这两侧都还没有实测**。
- **证据方案存在真实冲突（已定位）**：Playwright MCP 的截图工具被限制只能写 `/tmp/.playwright-mcp/`，而插件的证据目录在 `~/.dsh/plugins/dsh-plugin-web-test/evidence/`。模型把截图写进证据目录的尝试被工具改写到前者，插件随后**正确拒绝**：`evidence path "/tmp/.playwright-mcp/fresh.png" is outside the run's evidence directory`。该轮最终 0 条结果，运行以 completed 关闭。
- 由此解释并确认了此前"证据文件与旧文件同哈希"的原因：浏览器**根本没有能力**在该目录产出新文件，模型只能复用已存在的文件。旧文件现在会被新鲜度检查拒绝（诱饵文件 mtime 设为三天前，未被接受）。
- **待决的方案方向**：插件应在接收时把浏览器产出的文件**复制进自己的证据目录**，以复制时刻为新鲜度基准，并记录复制后的规范路径；这样既保留插件对证据的所有权，又不受浏览器沙箱写入范围限制。直接要求浏览器写入插件目录在当前宿主下不可行。
- 新鲜度检查目前只验证了"旧文件被拒"一侧；"新文件被接受"一侧**尚未取证**，因为在当前目录方案下浏览器无法产出新文件。
- 已改为**接收时复制**：插件把模型上报的绝对路径（浏览器沙箱允许的任意位置）复制进本次运行的证据目录，文件名为 `<序号>-<原名>`，并以**来源文件的 mtime** 对照运行开始时刻判新鲜度；拒绝的旧文件不复制。工具描述与参数说明同步改为"上报截图工具给出的绝对路径"。
- 复制机制在文件系统层面已生效：`run-13` 的证据目录出现两个由插件复制的新文件（`home-title.png`、`home-title-fresh-1791107058062.png`，mtime 均为本次运行时刻）。
- **但"结构化结果里带证据"仍未落地**：`run-13` 最终记录的 `home-title` 为 `incomplete`，`evidencePaths` 为空，模型给出的待确认是"截图证据无法附上"。日志显示原因是模型复制后又试图让浏览器去打开插件目录里的副本，被宿主拒绝：`File access denied: .../run-13/home-title.png is outside allowed roots`。模型因此**拒绝声称一条它无法附上证据的通过**，把用例降级为 incomplete 并留待确认——这一点符合"证据缺失不判定通过"的要求。
- 顺带修复一个真实的校验缺陷：工具参数声明 `evidencePath` 等字段可选，而校验模式此前要求它们必须存在，模型省略时直接报 zod 类型错误。已改为接受缺省。
- **两侧状态的准确表述**：旧文件被拒 ✅（诱饵与模型自述的 clock/mtime 冲突）；新文件被复制 ✅（文件系统层面）；**新文件出现在已记录用例的 `evidencePaths` 中 ❌ 尚未取证**。
- **已修复我引入的新鲜度误判**：`report_case` 同样会调用 `ensureEvidenceDir`，而它每次都把运行开始时刻覆盖为当前时刻，导致本次运行刚截的图被判为"早于运行开始"而遭拒（日志原文 `evidence path "/tmp/run-14-home-title.png" was last written before this run started`）。改为只在首次准备目录时记录开始时刻。
- **三侧证据校验现已全部取证**：
  - 旧文件被拒 ✅（三天前的诱饵文件未被接受）
  - 新文件被复制 ✅（`run-15` 的证据目录出现插件复制的新文件）
  - **新文件出现在已记录用例的 `evidencePaths` 中** ✅（`run-15` 的 `home-title` 为 `passed`，`evidencePaths` 指向插件证据目录内的副本，报告同时列出该证据）
- 该证据文件与更早一次对同一静态页面的截图**字节相同**。目标页是未改动的静态 HTML，重新截图本就应得到相同字节，因此**哈希相同不能再用作复用的证据**；本次会话日志中确有 `browser_navigate` 与 `browser_take_screenshot` 调用。
- 提示语已改正：先前 `start_run` 与 `web_test_status` 仍在叫模型"把证据存到插件目录"，这正是模型去写插件目录、随后又试图回读副本的原因。现改为"让截图工具存它自己存的地方，把它给你的绝对路径报上来，插件会复制"，并明确告知**不需要再打开那些文件**。
- **S5 回归基线（当前构建实测）**：重启宿主后逐类读回全部记录均正常——`{project: 1, environment-revision: 1, run: 1, policy: 0, case-result: 1}`，项目 `shop`、环境 `本机测试页 / test / read-only`、运行 `run-15 / completed`、用例结果 `home-title / passed` 且带 1 个证据，证据文件 `evidence/run-15/0-run-15-home-title-abs.png` 在盘上仍在。
- 禁用/启用回归：禁用 `include:web-test` 后该行 `fiber = null`、`webTest/*` Remote 返回错误、数据目录未被触碰（`evidence`、`web-test.sqlite*` 原样保留）；重新启用后 `state = active` 且记录数不变。设置分区在禁用周期后照常渲染（数据版本 3、项目 1、运行 1）。
- **S6 干净宿主周期（全新 profile `webclean`）实测**：
  - 安装：经插件管理器装入 tarball，5 行全部 `fiber = active`，`compatibility.json` 为空（**未使用任何 `allow-version` 豁免**），profile 记录依赖与 bundle。
  - 禁用：五行逐个 `changed = true`，禁用后无一存活。
  - 卸载：`dependencies`、bundle 条目、`node_modules` 全部清除；**用户数据目录保留**（卸载不应删除用户数据）。卸载后宿主启动零失败。
  - 重装：安装成功，但**五行全部带 `disabled: true` 回来**。
- **已定位的重装缺陷**：行开关持久化在 profile 的 `cordis.patch.yml`（五行均为 `disabled: true`），**卸载不清理这些条目**，而插件包自身并不带 `disabled`（已核对）。后果是：用户禁用后卸载再重装，会得到一个「已安装但静默失效」的插件——管理界面显示已启用，实际一个 fiber 都不启动。这属于宿主卸载路径的行为，需在 S6 报告里单列，不能算作通过。
- 重装缺陷**可自愈**：逐行重新启用那五行后全部 `fiber = active`，`webTest/status` 恢复。恢复步骤已写入插件的中英双语 README。
- **数据跨卸载/重装存活已单独取证**：先写入项目 `survive` → 卸载（数据目录 `web-test.sqlite*` 仍在）→ 重装 → 逐行重新启用 → `listProjects` 读回 `['survive']`。卸载与重装都不删除用户数据。
- 前一轮"重装后计数为 0"是**我自己的前置清理所致**（本轮开头删过数据目录），当时**并未验证**数据存活；本条才是该结论的取证。
- **升级路径已定义并实测**：宿主没有升级机制（只有 UI 文案），因此本插件的"可升级"定义为**版本递增后用插件管理器覆盖安装**。把版本从 `0.1.0` 升到 `0.1.1` 后，`dsh plugin add` 覆盖安装到已装 `0.1.0` 的 profile：`node_modules` 版本变为 `0.1.1`，宿主启动零失败插件，`webTest/status` 回报 `version 0.1.1`，设置分区显示"版本 0.1.1"，**升级前的项目 `survive` 仍在**，`compatibility.json` 依旧为空。
- 需要注意的边界：profile 里记录的是 `file:/tmp/dsh-plugin-web-test-0.1.1.tgz`。这是**从本地 tarball 覆盖安装**，不是从注册表升级；本环境没有插件注册表，因此注册表式升级无法在此验证。
- **Windows 验收单已交付**，随包发布（`WINDOWS-ACCEPTANCE.zh.md`，已加入 `files`）。清单覆盖 11 组：前置、安装启用、设置入口、Remote 往返、预设与执行层限制、真实浏览器最小测试、存储与重启、普通会话不受影响、运行控制、禁用与清理、卸载与重装、升级。每条给出操作、预期结果，并含一张空的执行记录表。
- 清单开头即声明 **Windows 上全部未验证**，并写明现有证据只覆盖 Ubuntu 24.04 / Node 24.15.0 / pnpm 11.7.0 与未修改的 DSH 0.2.0-rc.2。**未执行的条目不得勾选**，记录表空白行一律视为未验证。README 中英双语均链接该清单。
## 六、宿主配置表单机制（S2 调研结论）

插件数据分两类，归属不同：

| 类别 | 归属 | 依据 |
|---|---|---|
| 插件配置（浏览器产品、启动方式、无头、可执行文件、调试端点） | 宿主设置命名空间，经 `configForms` 在 UI 编辑 | 宿主为配置设计的机制，含暂存、校验、保存、丢弃全链路 |
| 业务记录（项目、环境声明、策略、运行、证据） | 插件自有 SQLite，经类型化 Remote | 插件拥有自己的业务数据；写入宿主设置存储会使"禁用插件不动宿主数据"失效 |

已查明的宿主公开契约（全部来自 `@deepseek-ai/dsh-client-ui-primitives` 与 `@deepseek-ai/dsh-client-ui-settings`）：

- `SettingsForm`（props：`labels` / `state: SettingsFormShell` / `onSave` / `onDiscard` / `children`）为表单外壳。
- `SettingsFormModel<T>` 暂存编辑并在保存时写入，构造参数为 `SettingsFormScope<T>`、字段规格数组与可选密文字段。
- `SettingsValueField` / `SettingsSecretField` 渲染受控字段；`settingsTextField` / `settingsNumberField` 提供转换规格，非法草稿阻止保存而非丢弃。
- 客户端侧 `ctx.configForms.<命名空间>` 提供读写；`ConfigFormController` 构造签名为 `(ctx, spec, mirror, persistence, schema)`，其中 `ConfigFormSpec<T>` 为 `{ namespace, decode? }`。
- 官方分区的注入集合形如 `["slots","locale","connection","remote","remote.settings","configForms",...]`。

已推翻的假设：以为 `SettingsForms.configure({ auto: true })` 会把本行的 `Config` 投影成表单。实测 `settings/describe` 返回 19 个命名空间（`bash-sandbox`、`agent-loop`、`locale` 等），**不含本插件**；`configure` 只设置"自动页面"策略，并不声明命名空间。相应代码与注释已撤销，不保留未经证实的声明。

**已解决的假配置：预设行是浏览器设置的唯一来源。** 曾把浏览器设置同时放进插件 `Config`（可经宿主配置界面编辑）与预设行，配置写回链路本身实测通过（`settings/update` 改 `browserHeadless`，`revision` 0→1，值落进 profile 的 `cordis.patch.yml` 并跨重启存活），但**对浏览器毫无影响**：预设改为加载器行声明后，`Config` 不再喂给预设行，而 `agentPresets` 只有 `register` 与 `list`，没有更新已注册预设行的公开接口。宿主预设机制下浏览器设置只能写在预设行的内联 `config` 里。已据此删除整套死 `Config`（含 `meta.volatile` 标记、`browserProviderConfig`、bundle 行里的对应字段与 `dsh-settings` peer），设置命名空间由 20 个回到 19 个且不再有 `web-test`——插件当前没有真正生效的运维配置，不应假装有。`meta.volatile` 的机制本身已查明并保留记录，待插件出现真正生效的配置字段时启用。删除后复验：启动零失败、预设会话可创建、浏览器导航与截图成功、执行层仍拒绝 `bash`。

**已查明：声明入口就是 Config 模式上的 volatile 标记。** 宿主 `SettingsForms.describe()` 逐行取 `volatileForm(schema)`，而 `volatileForm` 只保留带 `meta.volatile` 标记的节点；没有该标记的行不进入任何命名空间。给本插件的 `Config` 加上 `meta.volatile = true` 后实测：`settings/describe` 的命名空间由 19 个变为 20 个，新增 `web-test`，`autoGenerate: true`，值投影为 `{browserProduct: "chrome", browserLaunchMode: "launch", browserHeadless: false, browserExecutablePath: "", browserDebugEndpoint: ""}`，即插件配置自此可在宿主配置界面编辑，无需改 bundle 文件。

## 七、Windows 验收（全部未验证）

以下条目在 Ubuntu 上未取证，**不得计入通过**：

- 插件 tarball 安装、`cordis.patch.yml` 写入与回滚在 Windows 路径语义下的行为。
- `dshHomePath` 下的 SQLite 文件锁与 `0700`／`0600` 权限在 NTFS 上的实际效果。
- 系统 Chrome／Edge 的 `executablePath` 发现、启动与回收。
- 宿主退出与崩溃时浏览器、SQLite 单元与写链的清理时序。
- 托盘、最小化、窗口关闭与应用退出在测试任务运行中的交互。
- 多人账户与受控操作边界（R12 的 Windows 账户级保证范围）。

## 考虑过的替代方案

- **把浏览器行移到 bundle 根行**：可让禁用直接回收浏览器，但会把浏览器工具暴露给普通会话，违反"不全局包裹"。已否决，理由记入 §五.3。
- **继续使用 Storage Domain**：需改写宿主 `dsh-storage-domain` 行以加 `routes`，属于修改原版 DSH 的组合。已否决，理由记入 §五.1。
- **用 `allow-version` 豁免绕过兼容校验**：不采用。兼容结论只来自 peer 范围校验与干净环境中的实际安装运行。
