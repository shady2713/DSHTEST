# Windows 验收单

## 第一步：先跑这个门禁，不要跳过

```sh
cd dsh-plugin-web-test
bash scripts/check-candidate-tarball.sh
```

它验四件事，任一不过就不要开始复验：

- 候选包（`dist/` 里版本号最大的那个）里的三份文档与工作区一致
  —— 改了文档不重建时，这里会报 `已过期`
- 重新打包得到同样的字节 —— 记录的哈希才有意义
- `npm install` 该 tarball 到一个干净项目能装上、依赖能自行解析
- `web_test_status` 会报的版本与 manifest 一致

**`check-delivery-identifiers.sh` 校验的是 0.8.0 那个历史包，不是本候选包。**

**当前状态：全部未验证。** 本插件的验收证据全部来自 Ubuntu 24.04 / Node 24.15.0 / pnpm 11.7.0，
宿主为未修改的 DSH 0.2.0-rc.2。**没有任何一项在 Windows 上跑过**，下面每条都不得当作已通过。

本清单供拿到 Windows 环境的人逐条执行。每条给出操作、预期结果与实际结果栏；实际结果必须
由执行者填写，**不要在未执行时勾选**。


---

# 0.8.1 复验须知（本节最新）

**待验包**：`dsh-plugin-web-test-0.8.1.tgz`
**SHA-256**：`784b869e9086d4ac12e98a151bbbfffe0439819813683e06bf7ace6b1b4a287b`
**基线提交**：`993a2e9bc793c27436b148b5c5a2b4d15821a1dd`
**0.8.0 原包未被覆盖**，`f6621d41ff3920eabaf5ef4346691d9d2655355feba08f3f7a33b08b4d11bafd` 保持不变。

## 本包修的四个点

1. guard 改为按**实际被调用的挂载**判定 owner，并与凭据的 run / role / 代次 / agent / 会话逐项比对
2. `releaseRun` 按 owner 释放而不是按角色名；认领在挂载时记录；`readAccount` 读调用方自己的浏览器
3. `releaseAll` 按真实键释放；一个 disposer 失败不阻断其余，且失败项仍被跟踪
4. **准备分支只在调用未递上任何凭据时生效**——此前一个属于别的运行的 authority 能驱动同角色另一个运行的浏览器

**第 4 条是本包新修的，0.8.1 之前存在。**

## 复验顺序

1. 装包，确认 `web_test_status` 报 **0.8.1**（不是 0.8.0）
2. 同 session 建 buyer 与 approver 两个 run：**各自凭据成功，交换凭据必须在工具正文执行前被拒**
3. 取消其中一个运行：**浏览器进程必须归零**，另一个仍可用
4. 单行禁用 `web-test-role-browsers`，再整包禁用：**浏览器进程必须归零**
5. **带错误凭据的登录类调用必须被拒**；不带凭据的首次登录仍须可达
6. 最后独立跑回归 1–4，用新会话、新 run，不复用旧 authority

## 尚未修复

**Windows 数据目录的访问控制**：插件用 `mkdir(..., { mode: 0o700 })`，
Node 在 Windows 忽略该 mode，`chmod` 只切换只读位，目录保留从父目录继承的 ACE。
README 已按此更正措辞。**修复需在 Windows 上进行**，本包未包含。

**本包的 155 项测试全部在 Ubuntu 上运行，没有任何一项是 Windows 复验。**

## 0. 前置

- [ ] 宿主 DSH 版本为 0.2.0-rc.2（`dsh --version`）
- [ ] Node 与 pnpm 版本满足插件包 `engines` 声明
- [ ] 本机已安装 Google Chrome 或 Microsoft Edge（首个版本驱动独立 Chrome/Edge）
- [ ] 一个可访问的测试目标页面

## 1. 安装与启用

- [ ] **经插件管理器安装**：`dsh plugin --profile <profile> add <dsh-plugin-web-test-0.1.1.tgz>` 成功
- [ ] 宿主启动**零失败插件**
- [ ] `compatibility.json` 中**没有**本插件的 `allow-version` 豁免
- [ ] 插件五行全部 `fiber = active`：`web-test-storage-sqlite`、`web-test-store`、
      `web-test`、`web-test-browser-use`、`web-test-preset`

## 2. 设置入口

- [ ] 设置中出现本地化条目 **"Web 测试"**
- [ ] 分区渲染实时数据：状态 / 版本 0.1.1 / 数据版本 3 / 宿主版本 0.2.0-rc.2 /
      项目数 / 运行数 / 数据目录
- [ ] 浏览器控制台**无错误**

## 3. 类型化 Remote 往返

- [ ] `webTest/status` 返回 `ok`
- [ ] `webTest/putProject` 写入后 `webTest/listProjects` 读回
- [ ] 畸形参数被拒，报 `gateway/input-invalid`
- [ ] 写入的数据落在插件自有 SQLite，**宿主 JSON 存储未被写入**

## 4. 测试预设与执行层限制

- [ ] Agent 预设列表中出现 `web-test`
- [ ] 在真实模型回合中：允许的工具（`web_test_*`、`mcp__playwright-mcp__*`）可执行
- [ ] 禁止的工具被**在执行层**拒绝，消息为
      `web-test sessions may only call web_test_* and mcp__playwright-mcp__* tools; "bash" is outside the test execution policy`

## 5. 真实浏览器完成最小测试

- [ ] `web_test_start_run` 建运行并准备证据目录（权限 700）
- [ ] 浏览器打开目标页面，读到页面内容
- [ ] 截图经插件复制进本次运行的证据目录
- [ ] `web_test_report_case` 记录结构化结果，`evidencePaths` 指向插件目录内的副本
- [ ] `webTest/buildReport` 生成的报告列出该证据
- [ ] **陈旧文件被拒**：上报一个早于运行开始的文件，报
      `was last written before this run started`

## 6. 存储与重启

- [ ] 重启宿主后项目、环境声明、运行、用例结果、证据文件全部可读
- [ ] 数据版本为 3；把库版本戳改成 99 后宿主**拒绝打开**（版本闸门）

## 7. 普通会话不受影响

- [ ] 在某个 Web 测试运行处于**暂停**时，新建**非 web-test 预设**的普通会话
- [ ] 该会话的 `bash` 工具正常执行

## 8. 运行控制

- [ ] `webTest/controlRun` 暂停后，浏览器工具在执行层被拒：
      `run <key> is paused by operator request and refuses new test actions`
- [ ] `web_test_status` 在暂停期间**仍可调用**，以便模型说明原因
- [ ] 重复暂停被拒：`is paused and cannot pause`
- [ ] 恢复回到 `running`
- [ ] 取消后**不可恢复**：`is cancelled and cannot resume`
- [ ] 取消后浏览器工具同样被拒

## 9. 禁用与清理

- [ ] 活动任务期间禁用 `include:web-test` → `changed: true, application: applied`，该行 `fiber = null`
- [ ] 禁用后 `webTest/*` Remote 不再响应
- [ ] 插件数据目录**未被触碰**（`evidence`、`web-test.sqlite*` 保留）
- [ ] 重新启用后 `state: active`、记录数不变
- [ ] 宿主退出时浏览器进程**全部回收**

## 10. 卸载与重装

- [ ] 卸载后 `dependencies`、bundle 条目、`node_modules` 全部清除
- [ ] 卸载**不删除**用户数据目录
- [ ] **已知行为**：行开关持久化在 profile 的 `cordis.patch.yml`，卸载不清理；
      「禁用 → 卸载 → 重装」后五行带 `disabled: true` 回来，插件管理器显示已启用但无 fiber 启动。
      恢复方式：逐行重新启用那五行。

## 11. 升级

- [ ] `0.1.1` 覆盖安装到已装 `0.1.0` 的 profile
- [ ] `node_modules` 版本为 `0.1.1`，宿主启动零失败
- [ ] 升级前的数据仍可读，数据格式未变（v3，无需迁移）
- [ ] 存储带 99 戳时存储拒绝打开并指出版本不匹配，而不是读成空
- [ ] 读回一条早于新增字段的记录：归属、角色、等待字段取到文档化默认值

## 12. 业务操作与重启对账

前置：会话 A 已 `web_test_start_run`；本组全部使用同一个 `runKey`。

- [ ] `web_test_begin_operation` 后 `webTest/listOperations` 显示 `dispatching`
- [ ] 未结算前再次 `begin_operation` 同键 → 被拒绝，报文含「结果未决，不得再次提交」
- [ ] `web_test_settle_operation` 成功；再次结算同键 → 被拒绝
- [ ] 断连场景：`begin_operation` 后不结算，直接结束宿主进程
- [ ] 重启后 `webTest/status` 的 `reconciliation.unknownOperations` 含该操作
- [ ] 该操作 `dispatch` 为 `unknown`，且继续 `begin_operation` 同键仍被拒绝
- [ ] 被中断的运行状态为 `resuming`，`webTest/listOperations` 与 `getRun` 一致
- [ ] `resuming` 运行上 `begin_operation` 与 `report_case` 均被拒绝
- [ ] `webTest/controlRun(run, "resume")` 后运行回到 `running`；未结算操作仍不可重提

## 13. 按会话隔离的 hold

前置：会话 A 与会话 B 各自 `web_test_start_run` 一个运行。

- [ ] 对 A 的运行 `webTest/controlRun(runA, "pause")`
- [ ] A 会话内的浏览器调用被拒绝，报文含「paused」
- [ ] **B 会话内的浏览器调用仍正常**（此前实现会在此处失败）
- [ ] A 会话内 `web_test_status`、`web_test_settle_operation`、
      `web_test_operation_unknown`、`web_test_resume_wait` 仍可用
- [ ] 取消文案不再要求调用不存在的 `web_test_resume_run`

## 14. 角色与业务时间等待

- [ ] 环境未声明的角色 → `web_test_assume_role` 被拒绝并列出已声明角色
- [ ] 操作未决时切换角色 → 被拒绝并指出未决操作
- [ ] `web_test_wait` 设为未来时刻 → 运行状态 `awaiting-business-time`
- [ ] 等待期间浏览器调用被拒绝
- [ ] 截止时间前 `web_test_resume_wait` 被拒绝并给出剩余秒数
- [ ] 截止时间后 `web_test_resume_wait` 成功，运行回到 `running`
- [ ] 等待中重启宿主 → 运行仍为 `awaiting-business-time` 且截止时间未丢失

## 15. 报告三格式

- [ ] `webTest/buildReport` 返回 `markdown`、`html`、`json` 与 `verdict`
- [ ] 三者对同一运行的用例数与结论一致
- [ ] 存在待确认问题时 `verdict` 为 `undetermined`，而非 `passed`
- [ ] 未结算操作连同原因出现在三种格式中
- [ ] 用例文案中的 `<script>` 在 `html` 中被转义

## 执行记录

| 项 | 执行人 | 日期 | 结果 | 备注 |
|---|---|---|---|---|
| 1–15 |  |  |  |  |
| 0.8.0 新增 1–5 |  |  |  |  |

## 0.8.0 新增覆盖项

0.6.12 时代的清单没有覆盖后来出现的 `web_test_control_run`、`web_test_finish_run`
与 `web_test_propose_cases`，也没有覆盖整包禁用。这五条在 Ubuntu 上都有实测，
**在 Windows 上全部未验证。**

**关于第 3 条的判定方式**：不要再引用「12 → 0 / 10 → 0」这个 Ubuntu 数字。
那是 0.8.0 时期的记录，而 **Windows 验收 0.8.0 实测：取消后浏览器进程在 12 秒观察期结束时仍全部存活**，
后来取消另一个运行才顺带关闭。`releaseRun` 在 0.8.0 上按角色名从认领索引取目标而非按挂载句柄，
所以大部分取消根本没释放任何东西。0.8.1 改的是这条选择路径，**该数字必须在 0.8.1 上重新测量才有意义**。

Windows 上请用任务管理器或句柄确认插件自带的浏览器进程已经消失，并同时确认宿主进程仍在运行。
**不要把任何历史进程数当作验收标准。**

- [ ] `web_test_control_run` 的 `pause` 之后该会话的浏览器调用被拒，且**其他会话不受影响**
- [ ] `web_test_control_run` 的 `resume` / `continue` 使运行进入**下一代**并作废旧授权，重新核验角色后浏览器回来
- [ ] `web_test_finish_run` 在 `completed` / `cancelled` / `blocked` 三种终态下**都释放插件自带的浏览器进程**（Windows 上按进程或句柄判断，不按数量）
- [ ] `web_test_propose_cases` 在有运行与无运行两种情形下都返回符合其 `output.schema` 的值
- [ ] 整包禁用用 bundle 名 `dsh-plugin-web-test`（**不是 `web`**，后者报 cannot resolve profile bundle），恢复后三行插件条目回到 `active`

未填写的行视为**未验证**。

## 未闭项：Windows 数据目录的访问控制

**Linux 上通过不等于这里通过。**

插件用 `mkdir(..., { mode: 0o700 })` 建数据根，POSIX 上得到仅属主访问。
Windows 上 Node 忽略 mkdir 的 mode，`chmod` 只切换只读位，
目录保留从父目录继承的 ACE。Windows acceptance 曾观察到根、SQLite 主文件、
WAL、SHM 与 evidence 目录存在非 owner 的继承 Allow ACE（含 Modify）。

**尚未修复。** 修复需要在打开 SQLite **之前**施加 DACL
（Node 无此 API，需经 `icacls` 之类外部手段），并明确是否保留
`SYSTEM` / `Administrators` 例外——保留就必须在文档与验收里写明，
不能继续宣称字面上的「仅属主」。README 已按此更正措辞。

**本项未做另一实际身份的有效读写拒绝测试，因此不得据此声称任何用户都能读取。**

## 复验 0.8.1 前：全新安装需要哪些包

**在 Ubuntu 上复现全新安装时，卡在 `web-test-preset: pending (waiting for service: agentPresets)`。**

只装插件本身是不够的，profile 里还必须有下面四个包，**版本全部钉 `0.2.0-rc.2`，
与插件自身的 peer 一致，不需要 `allow-version`**：

```
@deepseek-ai/dsh-storage-sqlite@0.2.0-rc.2
@deepseek-ai/dsh-browser-use@0.2.0-rc.2
@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.2.0-rc.2
@deepseek-ai/dsh-experimental-browser-use-runtime@0.2.0-rc.2
```

**但这四个装齐后 Ubuntu 上的全新宿主仍然起不来**，而依赖树与之完全相同的
长期使用宿主照常启动。差别只剩后者的累积运行状态，**未定位**。
**Windows 上首次复验请先确认这一点，不要把它记成 0.8.1 的缺陷。**

## 已修：提供了错误凭据的登录类调用曾被当作准备放行

**已在 0.8.1 修复，并由 `execution-guard.spec.ts` 的两条用例钉住。**

guard 的准备分支先于凭据校验：只要该挂载已被认领、且该运行允许准备身份，
`browser_click`、`browser_navigate` 这类登录工具就直接放行，
**不管调用方是否递上了一个属于别的运行的凭据。**

任务书要求「错误 token 不能回退到 preparation」。**当前实现没有做到这一点。**

### 复现方式

同一 session 内 run-a 与 run-c 都声明 `buyer`，两个挂载各自认领。
对 run-c 的挂载调用 `browser_click`，递上 run-a 的 authority：
预期被拒（`not to run …`），**实际被放行**。

### 修法与那个 5 个失败的真因

准备分支改为**只在调用未递上任何凭据时生效**。
第一次改完出现 5 个既有用例失败，**真因是条件里漏了「空串」**：
暂停或取消的运行铸不出凭据，递上来的是 `''`，
而空串并不是凭据，应当仍按「未提供」处理。补上后全绿。

**Windows 复验请把这一条一并验**：两个同角色运行之间，
带错误凭据的登录类调用必须在工具正文执行前被拒；
不带凭据的首次登录仍须可达。

## 未闭项：启动过程中取消运行，浏览器仍会留下

**本轮在读代码时确认的机制，未修复，也没有测试覆盖。**

### 机制

```
ensure()                      mountBrowser(...)        recordMount(...)
   │  pending[key] = settled        │                      │  owners.set(serverName, …)
   └──── 挂载在途 ───────────────────┘                      └─ 归属此刻才写入

releaseRun(runKey) 在挂载在途时到达：
   owners 里还没有该运行的条目
   → mountKeysOfRun 返回空
   → 什么都没释放

挂载随后完成：recordMount 写入归属 → 浏览器永远留着
```

**这正是任务书列出的「启动中取消」，也是「取消后浏览器进程仍存活」的一条独立成因。**

### 为什么没有直接修

修法需要一个「已被释放的键」集合，让挂载完成后立刻回收自己。
**但本工作区无法产生真实挂载（provider 导入必然失败），
这条并发路径既写不出有意义的测试，也无法验证。**

**不把未验证的并发修复放进交付物**——同一份包里已经有 Windows ACL
那种「改了但在目标平台跑不了」的未验证代码，不再增加第二处。

### Windows 复验时请一并验

1. 发起 `assume_role` 后**立刻**取消该运行
2. 观察浏览器进程是否在观察期结束时归零
3. 若未归零，就是这条路径

## 复验时的测量方法：浏览器与 MCP 客户端必须分开数

`playwright/mcp` 这个标记匹配的是 **MCP 客户端进程**，不是浏览器进程。
客户端是宿主自己的子进程（父进程为 `node …/dsh`），**宿主退出时它自然消失**，
行禁用时它也会留下。**只数它会同时给出两种错误的结论。**

历史记录里「禁用后 Chromium 20 → 0」就是这么来的——量错了进程。
**但这只解释得了记录早期（0.4.1–0.4.2）那两处**：从 0.4.3 起 Linux 侧已改用
`executablePath` 数浏览器本体，那之后的「10 → 0」是真结果，不是量错。

**因此 Windows 报告的「单行禁用后 8 个、整包禁用后 17 个浏览器进程全部存活」
与 Linux 的结论是冲突的，不是同一个测量错误。** 本包修了释放路径，
但这个冲突尚未在任一平台上复验过——复验时不要用「量错进程」把它解释掉。

**分开数的方法**：给 `web-test-role-browsers` 行配
`config: { executablePath: '<某个唯一的 Chromium 可执行文件路径>' }`，
`playwrightArgs` 会把它作为 `--executable-path` 传给 MCP，
浏览器命令行因此带唯一路径，可与客户端进程分开计数。
**这是宿主暴露的设置，不需要改插件或宿主任何一侧。**

参考计数（Linux，0.4.1 时期）：

| 时点 | MCP 客户端 | 插件浏览器 |
|---|---|---|
| 会话跑通、浏览器已起 | 2 | 12 |
| 该行禁用 25 秒后 | 2 | **12** |
| 该行禁用 55 秒后 | 2 | **12** |
| 宿主 SIGTERM 优雅退出后 | 1 | **0** |

**判定标准是右边一列。** 左边一列的变化不构成释放证据。

## 数进程时的第二个坑：管道会数到自己

`ps -eo args | grep -c 'chromium-1243'` **会把 grep 自己那条管道的 bash 进程算进去**，
因为那个进程的命令行里就带着匹配串。本机实测：该命令报 3，
实际浏览器进程为 **0**；把 `ps` 输出落到文件再 grep，命中的是那条 bash 自身。

**用排除计数管道自身的方式**：

```sh
ps -eo pid,comm,args --no-headers \
  | awk '$2!~/^(bash|grep|awk|ps)$/ && /chromium-1243/' | wc -l
```

**任何「进程数归零」或「进程数保持 N」的结论，都必须用这一条命令复核后再记录。**
管道返回 0 行不总是因为没有进程，也可能是因为写错了过滤条件——
两种情况在终端上看起来一模一样。

## 已闭：缺陷 3 的修复已补上回归测试

**用变异检查确认过**：把 `releaseAll` 里的 `releaseByKey(key)` 改回
`releaseRole(key)`（即 0.8.0 的写法），`tests/release-lifecycle.spec.ts`
的 15 条用例**全部仍然通过**。

**原因**：真正走池对象的只有「空池重复调用 `releaseAll`」一条，
空池下两种写法行为相同；其余用例直接测 `mountKeysOfRun` / `disposeAll` /
`detachMount` / `restoreMount` 这些纯函数，**它们不知道调用方传了什么**。

**为什么补不上**：`releaseAll` 要真的释放什么，池里必须有一个 disposer，
而挂载需要 browser provider，本工作区导入必然失败。disposer 存在私有字段里，
`recordMount` 只能播种 owner 表，播种不了它。

**补法**：把池的四个跟踪 Map（`mounts` / `started` / `owners` / `claims`）从
`private` 收窄为公开只读——它们的元素类型 `Disposable<Promise<void>>`、
`RoleBrowser`、`MountOwner` 本就是公开导出的契约，只是此前被隐藏。测试据此播种
真实 disposer，走完 `releaseAll` / `releaseRun` 的整条链路。

**`releaseRun` 曾是同样的零覆盖**：改回 0.8.0 的取法（从认领索引读出 serverName
再当键传）时，同样一条测试都不红。本轮补的用例复刻了缺陷 2 的场景——
两个运行挂同一角色，取消其中一个只关掉它自己的；变异后立刻变红。

**变异检查确认**：改回 0.8.0 的 `releaseRole(key)`，两条新测试立刻变红。

**仍未验证的是真实浏览器是否退出**——那仍然需要 Windows 上的真实会话。

## 这些测试有效吗：变异检查记录

「测试全绿」不说明测试有效——断言了错误东西的测试同样会绿。
下面每条都是把对应的修复**改回 0.8.0 的写法**，再跑测试：

| 修复 | 变异后 | 结论 |
|---|---|---|
| 凭据与 owner 逐项比对（缺陷 1） | 3 条变红 | 有保护 |
| 预启动收养的空串豁免 | 1 条变红 | 有保护 |
| 错误凭据回退到准备 | 1 条变红 | 有保护 |
| `releaseAll` 按真实键释放（缺陷 3） | 2 条变红 | 有保护 |
| `releaseRun` 按 owner 释放（缺陷 2） | 1 条变红 | 有保护 |

**未做变异检查的改动**：删除死的 `browserGrantForSession`、`PLUGIN_VERSION`
与 manifest 对齐、文档更正——它们要么无运行时行为，要么被各自的断言直接钉住。

**仍然完全没有覆盖的**：真实浏览器是否真的退出。这不是测试能回答的，
只能在 Windows 上以进程或句柄确认。

## 已闭：`releaseRole` 的两个清理缺陷

原先它在删掉 `started` 行**之后**才去读浏览器，读到的永远是 `undefined`；
而且它只清认领，**不清 owner**，被释放的挂载仍能被 `ownerOfServer` 解析出来。
现改为**先读后删**，并一并清认领与 owner。

**播种方式**：暴露的是操作 `addKeyForRole`，不是内部的 `keysByRole` 表，
测试像生产代码一样调用它，不接触任何 Map 的内部表示。

**变异检查确认**：去掉清 owner 那一行，测试立刻变红。


## 已修：启动过程中取消会留下浏览器

`releaseRun` 原先只从 `owners` 取目标，而在途挂载的 owner 要等挂载完成才写入，
所以取消落在「已开始、未完成」的窗口里时选不出任何键，浏览器随后留在池中。

现在：`pending` 连同 owner 一起记录，`releaseRun` 把它算进目标；
`releaseByKey` 对这种尚无 disposer 的释放打一个标记，
挂载完成后自己关闭自己并抛出说明取消原因的异常。标记只消费一次。

**变异检查确认**：拿掉「在途挂载也算进目标」这一段，测试立刻变红。

**仍未验证的是「挂载完成后真的会自己关闭」**——那需要真实 provider 让挂载真的
在途。Windows 复验时请验：`assume_role` 发起后立刻取消，观察期结束时插件自带的
浏览器进程是否归零。

## Windows 数据目录的访问控制：本包实现了，未在 Windows 上跑过

`mkdir` 的 mode 在 Windows 上被忽略，`chmod` 只切只读位，目录保留从父目录继承的 ACE。
Node 没有 POSIX 权限位接口，**唯一公开途径是平台自带的工具**。

本包据此在 `ensureDataRoot` 里加了平台分支，Windows 上执行两次：
先对该目录本身 `icacls <root> /inheritance:r /grant:r <user>:(OI)(CI)F`，
使**之后新建的文件继承这一限制**；再一次同样命令加 `/T`，
把**已经存在的 SQLite 主文件、WAL、SHM 和旧证据目录**重新施加一遍。
递归只在插件自有数据根之内，不越出 `.dsh`，不跟随重解析点。
`ensureDataRoot` 在 SQLite 打开之前运行，失败则**拒绝打开数据库**，
而不是继续在一个其他账户可读的目录上开库。

`restrictsDirectoryToOwner` 在 POSIX 上返回空操作，行为不变。

**必须先在隔离测试目录验证**：先造一个测试目录跑一遍，确认
`/inheritance:r` 之后当前用户仍能读写，再对真实数据根启用。
**既有数据的 DACL 迁移需要先备份**；不要对本机现有数据目录直接执行。

**变异检查覆盖了三处**：`restrictCommandsForWindows` 的参数由测试钉住
（只点名一个目录、不递归、含 `/inheritance:r`）；
两次调用的顺序与形状由测试钉住（先目录后树）；
平台分支由注入平台与执行的测试钉住——让它永远提前返回，两条用例立刻变红。
**这证明的是「什么时候执行、执行什么」，不是 `icacls` 在 Windows 上的实际效果。**

## 已补：`browser-dispatch.spec.ts` 现在有一条走真实存储

原记录称该文件「针对真实存储钉住」，实际十三条全部走 `guardReason` 加替身。
现已补一条：用 harness 的内存后端开真实的 `WebTestStore`，建project 与环境修订、
写入运行，取消之后断言 `hasRunningRun` 为假、`guardReason` 拒绝该浏览器的调用。

第二条用例复刻记录点名的场景：**取消 A 之后 B 仍能驱动自己的浏览器**，
同时断言 A 的 token 被拒、B 的 token 不能被 A 的 agent 使用。

**变异检查确认**：`hasRunningRun` 恒为真，两条一起变红；
`mintAuthority` 不看运行状态，第二条单独变红。

顺带确认的事实：harness 的 `seed` 是**表映射**（`Record<table, rows>`），
表名是 `projects` / `environment_revisions`，不是领域对象。

## 修正：收养路径曾被我改坏（已修）

`putEnvironment` 会以 `runKey: ''`、`sessionId: ''` 预挂一个浏览器，运行核验时**收养**
它而不是再挂一个（0.8.9 确认这条路径是活的）。收养原本只把挂载改写到运行的键下，
**没有改写归属**。于是按归属判定的两处逻辑会一起失效：

- 凭据与 owner 逐项比对时，`authority.runKey !== ''`，每一次带凭据的调用都被拒；
- `releaseRun` 按 owner 选目标时，这个挂载永远选不中，取消不回收。

**现已改为收养时一并改写归属**（`recordMount` 同一处写入）。

**新增的用例走的是生产路径**：`ensure` 在收养时会在挂载之前返回，
所以这一段不需要浏览器 provider 就能测。变异检查确认：拿掉这次修复，用例立刻变红。

**此前那条「预启动收养」用例是假保护**——它手工构造了一个生产代码不会产生的
owner 行。新用例取代了它的证明力。

## 记录点名、但此前漏写的复验前提

以下每条都来自更正记录里的「必须写明」「要写进 Windows 复验清单」，
**顺序或环境错了会看到和缺陷一模一样的错误**：

- **装配顺序**：`putEnvironment` 必须在 `session/create` **之前**。
  反过来做，浏览器会挂到一个已经存在的 Agent 上，`assume_role` 立刻失败
  （0.6.17）。**这个错误和权限缺陷长得一样。**
- **profile 必须含 `@deepseek-ai/dsh-web-app`**：从默认 profile 复制时若漏了它，
  `web-test` 预设不存在，`session/create` 直接失败（0.7.61 / 0.7.79）。
- **`dsh plugin add` 只认绝对路径**：相对路径加 `cd` 会**静默失败**。
  同一个原因已经错了三次（0.7.38 / 0.7.43）。
- **手工往 profile patch 加行会直接影响装配结果**（0.6.31）。
- **干净 home 没有凭据**：模型不派发工具有两种完全不同的原因，
  排查时先看日志里的 `code`，不要只看「没有 tool/call」（0.6.17）。
- **每个候选包必须用未使用过的版本号**：pnpm 按路径缓存，
  同名 tarball 重新构建不会重读安装（0.1.3）。
- **「已挂载」不等于「有进程」**：`ensure` 挂的是 MCP server，
  Chromium 进程首次导航时才起。**`putEnvironment` 之后数到 0 是预期**，
  不是「浏览器没起来」（0.8.9）。
- **单行禁用 role-browsers 的 `application` 期望值是 `failed` 而非 `applied`**：
  `web-test` 停在 `pending`、role-browsers 已卸载，与实测一致（0.7.34 / 0.7.98）。
- **回归 ③ 前先释放占着该角色的旧运行**：一个角色只绑定一个运行，这是设计内行为
  （0.8.1 节）。不释放就看不到新挂载，会误判成回归失败。
- **进程计数必须先确认起点非零**（0.6.51）；**`unknown tool` 不构成证据**（0.7.83 / 0.8.8）。

## 未闭项：同会话同角色的限制只靠涌现，代码里没有这条规则

更正记录 0.7.48 明确记过：这条限制**是涌现的，不是被写下来的**，
「若日后有人把 claims 改成别的键，这个限制会静默消失」。

**本包又动过一次 claims 的键**（从按角色改成按 `serverName`），
所以那条地基确实又变了一次。

**已核实**：`assumeRole` 只写 `activeRole` 并校验账号与环境的绑定，
**没有任何一处检查「一个角色只绑定一个运行」**。
`RoleBrowserPool.addKeyForRole` 维护的 `keysByRole` 允许多把键共存，
所以两次同角色挂载在数据结构上是允许的。

**因此记录里那句「一个角色只绑定一个运行，这是设计内行为」，
在代码里没有强制点。** 复验时若依赖它来判断回归，请以实测为准，
不要把当前行为当成已声明的约束。

## 关于 `scripts/check-delivery-identifiers.sh`

**这个门禁写死校验 0.8.0 那个交付候选包**：

```
P=.agents/notes/proposed/testing/2026-10-09-web-test-0.8.0-delivery-candidate.md
D=dsh-plugin-web-test/dist/dsh-plugin-web-test-0.8.0.tgz
```

所以在 0.8.1 工作区上跑它，会报

```
✓ 包内版本 0.8.0
✗ 包内 README.md 已过期，需重建
✗ 包内 WINDOWS-ACCEPTANCE.zh.md 已过期，需重建
```

**这两个 ✗ 是正常的，不是缺陷。** 本包改了这两份文档，而 0.8.0 那个包按交付要求
必须保持原样、不得覆盖。**它报的是「0.8.0 的内容与今天的工作区不同」，
而那正是应该如此。**

**不要为了让这个门禁变绿去改 0.8.0 的 tarball**——那是历史交付物。

**对 0.8.1 做的等价检查**：解包后 `README.md`、`WINDOWS-ACCEPTANCE.zh.md`、
`README.zh.md` 三份均与工作区一致。**这个才是 0.8.1 该满足的条件。**
