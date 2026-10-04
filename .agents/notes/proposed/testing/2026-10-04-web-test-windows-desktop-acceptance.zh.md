---
description: "Windows 桌面实机验收：dsh-plugin-web-test 0.1.1 在原版 DeepSeek Harness 0.2.0-rc.2 桌面宿主上的逐项结果、阻塞缺陷与修复清单"
kind: note
status: active
date: 2026-10-04
---

# dsh-plugin-web-test — Windows 桌面实机验收

中文 | [English](2026-10-04-web-test-windows-desktop-acceptance.md)

## 摘要

在用户已安装的原版 DeepSeek Harness 桌面宿主上，对 `dsh-plugin-web-test` 0.1.1 做了一次完整实机验收：经真实插件管理器安装、在 `web-test` 预设里用真实模型驱动真实 Chrome 完成三个用例、构造宿主崩溃做重启对账、再走完禁用/卸载/重装。**15 组清单中 10 组通过、4 组部分通过、1 组未验证。**

结论：**当前不适合装入日常使用环境**。插件的 Host 半边、S4 持久执行语义、SQLite 与报告链路在真实桌面上工作正常且证据充分，但有两个 P0 缺陷会让真实使用直接失败：插件发布的 bundle patch 把浏览器可执行文件写死为 Linux 路径，Windows 上浏览器无法启动；`web_test_status` 工具的 output schema 少声明两个字段，在真实宿主里 100% 失败，而 guard 的拒绝文案恰恰把这个坏掉的工具指给模型。

本记录只写实测结果。凡是没跑过的项都标为未验证，不按“应该能过”记。

## 目录

- [固定验收版本](#固定验收版本)
- [环境](#环境)
- [隔离与日常环境保护](#隔离与日常环境保护)
- [逐组结果](#逐组结果)
- [阻塞缺陷](#阻塞缺陷)
- [交回 Ubuntu 的修复清单](#交回-ubuntu-的修复清单)
- [结论](#结论)
- [复现步骤](#复现步骤)
- [Dev Note](#dev-note)

-----

## 固定验收版本

| 项目 | 值 |
| --- | --- |
| 仓库 | `https://github.com/shady2713/DSHTEST` |
| 源码分支 | `codex/web-test-plugin-s0` |
| 源码提交 | `37ef29819ee94c7b503f20ea337ca9d44563a9db` |
| 验收分支 | `codex/web-test-windows-acceptance` |
| 验收 worktree | `.worktrees/windows-acceptance` |
| 插件版本 | `0.1.1` |
| tarball | `dsh-plugin-web-test/dist/dsh-plugin-web-test-0.1.1.tgz` |
| tarball 大小 | 133471 字节，40 个文件 |
| tarball SHA-256 | `64c3757ebb4a957b8ea1da6167bd5a298b6286dc9e8546d551620acc6cf4f58a` |

安装前逐字节校验了 tarball，全程没有重建。`origin/codex/web-test-plugin-s0` 指向同一提交，所以验收对象就是交接的构建产物，不是本地重打包。

## 环境

| 项目 | 值 |
| --- | --- |
| 操作系统 | Windows 11，10.0.26200 x64 |
| 桌面应用 | `C:\Users\64576\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe`，FileVersion 0.2.0-rc.2 |
| 桌面运行时 | 0.2.0-rc.2（node 24.21.0，pnpm 11.7.0） |
| 内置 `@deepseek-ai/dsh` | 0.2.0-rc.2 |
| 桌面 CLI | `…\resources\runtime\cli\bin\dsh.cmd` → `0.2.0-rc.2` |
| PATH 上的全局 `dsh` | 0.1.5-rc.1 —— **未用于任何兼容性判断** |
| 宿主监听地址 | `127.0.0.1:19387` |
| `DSH_HOME` | `C:\Users\64576\.dsh` |
| 桌面 profile | `C:\Users\64576\.dsh\profiles\desktop` |
| Electron user data | `%APPDATA%\@deepseek-ai\dsh-desktop` |
| Playwright 实际使用的 Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`，154.0.8037.95 |
| 模型 | `deepseek-account / deepseek-flash`，reasoning high |

本机只代表一个 Windows 版本。这里的任何结果都不构成其它 Windows 版本的证据。

## 隔离与日常环境保护

桌面 CLI 拒绝 `desktop` profile 是按名字拦截的（`apps/cli/src/args.ts:83-87` 比较 `profile.toLowerCase() === 'desktop'`），不是文件锁。因此验收宿主用与桌面应用相同的可执行文件、相同 profile、相同运行时启动，只是不带 Electron 窗口：

```text
"…\DeepSeek Harness.exe" --expose-internals \
  "…\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js" \
  "…\resources\app.asar\dsh" "C:\Users\64576\.dsh\profiles\desktop" \
  "…\resources\runtime\primary-runtime" "…\resources\runtime\pnpm\bin\pnpm.mjs" \
  "…\resources\runtime\bin"
```

单实例检查不会把第二次启动转交给运行中的实例；第二个进程在 `EADDRINUSE` 上启动致命失败（`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-2026-10-01T13-26-38-340Z-host.log`）。验收期间该 profile 没有用户自己的 DSH 会话在跑，也没有结束任何用户启动的进程。

实际使用的保护手段，而不是声称隔离：

- 安装前保存了 `cordis.yml`、`cordis.patch.yml`、`package.json`、`pnpm-workspace.yaml` 的基线哈希，以及 profile 插件目录的逐文件哈希清单。
- launch token 读自宿主自己的 stdout；**没有读取或导出任何凭证值**。`.credentials.yaml` 从未打开，只观察了修改时间。
- 没有复制个人浏览器档案。Playwright 使用自己的临时 `playwright_chromiumdev_profile-*` 目录。
- 业务数据变更只发生在 `127.0.0.1:18999` 的本地一次性测试站上，状态只存在于单个进程内存。
- 宿主通过 Client UI 调用的同一条已认证回环 API 驱动，使用宿主自己的 `GET /?token=…` → 303 → 签名 cookie 交换。

**验收后的日常环境：** 插件已卸载，`package.json` 再次只列 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app`，用户手工安装的 `dsh-opencode-session` 未被触碰，插件从未写入 `~/.dsh/storages`，profile 的 `cordis.patch.yml` 不含任何验收改动。插件自有数据根 `~/.dsh/plugins/dsh-plugin-web-test` 仍在磁盘上（7 个文件，179517 字节），因为卸载不删数据。

## 逐组结果

图例：**通过** / **部分通过** / **失败** / **未验证**。

### 0. 前置 —— 通过

宿主通过自带 CLI 报告 0.2.0-rc.2。自带 node 与 pnpm 满足插件包声明的范围。本机装有 Chrome。测试目标页面为本次验收新建（见[复现步骤](#复现步骤)）。

### 1. 安装与启用 —— 通过

- `pluginManager/inspect` → `status: accepted, kind: tarball`。
- `pluginManager/installBundle` → `stage: enable, target: dsh-plugin-web-test, enabled: true, changed: true, application: applied`，pnpm `exitCode 0`，`+ dsh-plugin-web-test file:…0.1.1.tgz`，`Packages: +12`。
- `pluginManager/listVersionExemptions` → `{"exemptions":{},"warnings":[]}` —— **没有任何 `allow-version` 豁免**。
- 五个插件行全部 `fiberPhase: active`：`include:web-test-storage-sqlite`、`include:web-test-store`、`include:web-test`、`include:web-test-browser-use`、`include:web-test-preset`。
- 安装告警只涉及 profile 原有的 `desktop-product-telemetry`（缺 `serviceVersion`）和 pending 的 `product-analytics`，与 web-test 无关。

安装走的是真实插件管理器，不是手工改 profile。

### 2. 设置入口 —— 未验证（GUI 缺口）/ 部分通过

插件声明了 `settings.section` 贡献（`src/client/index.ts`，section id `web-test`，order 90）并随包发布 `locale/{en,zh}.json`。**服务端半边已证实：** `webTest/status`、`listProjects`、`listEnvironments` 都通过设置分区调用的同一个 gateway 正常应答。

**渲染半边未验证。** 可用的内置浏览器里 Client 设置面板打不开：对设置控件点了两次、再按一次 `Ctrl+Alt,+`，页面文字都没有变化，本会话拿到的视口是 917×1259。环境没有 `computer_*` 工具，因此也无法驱动 Electron 窗口本身。“设置中出现本地化『Web 测试』条目并渲染状态 / 版本 0.1.1 / 数据版本 3 / 宿主版本 0.2.0-rc.2 / 项目数 / 运行数 / 数据目录”应记为**未验证**。

### 3. 类型化 Remote 往返 —— 通过

- `webTest/status` → `ok`，`version 0.1.1`，`state active`，`schemaVersion 3`，`dshVersion 0.2.0-rc.2`。
- `webTest/putProject` 写入后 `webTest/listProjects` 读回项目 `win-accept`。
- 值级校验失败返回 `gateway/input-invalid`（`webTest/putProject: wire field "project" failed boundary validation`），空 `key` 与缺字段都如此。
- **多余**字段被接受（`surprise: true` → `ok: true`），因为生成的 schema 用的是 `z.object()`，它剥离未知键而不是拒绝。这不算失败；记下来是为了不让任何人把 `mode: 'strict'` 读成“未知键会被拒”。
- 写入落在插件自有 `web-test.sqlite`。`~/.dsh/storages/workspace.json` 仍保留验收前的时间戳。

**发现漂移。** `src/client/remote.ts` 由与线格式相同的 schema 生成，但它与实现不一致：

| 实现（`@Remote`） | 生成的 descriptors |
| --- | --- |
| `status`、`putProject`、`putEnvironment`、`listEnvironments`、`putPolicy`、`controlRun`、`listRuns`、`getRun`、`buildReport`、`listCaseResults`、`listProjects` | 存在 |
| `waitRun`、`resumeWait`、`assumeRole`、`resolveOperation`、`listOperations` | **缺失** |
| `status` 结果的 `recordCounts.operation`、`reconciliation` | **schema 中缺失** |
| `buildReport` 结果 | 声明为 `z.object({ markdown: z.string() })`；服务实际返回 `runKey`、`verdict`、`markdown`、`html`、`json` |

这五个缺失方法在线上仍能应答——宿主直接派发到 `@Remote` 方法——但类型化客户端既调不到它们，也拿不到 schema 校验。见 [D2](#d2)。

### 4. 测试预设与执行层限制 —— 通过

- `agentPresets/list` 在 `standard`、`ptc`、`minimal`、`cordis` 之外新增 `web-test`。
- `session/create` 带 `agentPreset: "web-test"` 返回绑定该预设的会话。
- 在真实模型回合中，被禁工具**在执行层**被拒，原文与清单一致：
  - `bash` → `web-test sessions may only call web_test_* and mcp__playwright-mcp__* tools; "bash" is outside the test execution policy`
  - `list_mcp_resources` 与 `read_mcp_resource` → 同一条消息带上它们各自的名字。
- 允许的工具正常执行。

预设有意把 `@deepseek-ai/dsh-tool-bash` 作为探针装进去，好让拒绝发生在执行路径上而不是靠工具缺席来证明。这是有意设计，但代价是测试 Agent 的工具列表里看得见 `bash`，会白白花几轮去发现调不了。

### 5. 真实浏览器完成最小测试 —— 部分通过

在一处环境适配之后可以工作（见 [D1](#d1)）：

- `web_test_start_run` 建出运行 `win-accept-run-1`，返回证据目录 `C:\Users\64576\.dsh\plugins\dsh-plugin-web-test\evidence\win-accept-run-1`。
- Playwright 用一次性档案拉起本机 Chrome，读到真实页面内容（`单价 12.50 / 数量 3 / 小计 37.50 / 折扣 10% / 合计 33.75`）。
- 截图被复制进本次运行的证据目录，例如 `…\evidence\win-accept-run-1\0-checkout-total-defect-checkout.png`。
- `webTest/buildReport` 在三种格式里都列出这些证据路径。
- **陈旧证据被拒**，原文：`web-test: evidence path "…\site\server.mjs" was last written before this run started, so it cannot be evidence of this run. Take a new screenshot for this run.`

两件事在 Windows 上不成立：

- **证据目录的 700 权限没有生效。** 插件的 `mkdir(mode 0o700)` 与 `chmodSync(0o700)` 是 POSIX 调用，在 NTFS 上不起作用。`~/.dsh/plugins/dsh-plugin-web-test` 下每条 ACL 都是 `IsInherited: True`，其中包含 `Everyone: DeleteSubdirectoriesAndFiles (Deny)`、三个 SID 的 `Modify` 允许、`shady\CodexSandboxUsers: Modify` 允许、`shady\64576: FullControl`。证据与业务记录对超出插件本意的主体可读写。插件是否应当在 Windows 上收敛 ACL，还是在文档里声明平台限制，是 Ubuntu 的决定——见交接里的开放问题。
- `web_test_report_case` 第一次失败，报 `steps.0.evidencePath: Invalid input: expected string, received undefined`。见 [D3](#d3)。

### 6. 存储与重启 —— 通过（版本闸门除外）

真实重启宿主后，`webTest/status` 报告 `project 1, environment-revision 1, run 3, policy 1, case-result 3, operation 2`，每条记录都能通过类型化 Remote 读回，证据文件仍在磁盘上。插件 SQLite 是单写入者，宿主运行时文件本身被锁——数据是通过 Remote 读的，不是直接读文件。

版本闸门那一半（把存储版本戳改成 99 并期望被拒）**未执行**；那需要改动插件自己的数据库，而它就是用户的数据根。

### 7. 普通会话不受影响 —— 通过

- web-test 工作进行中创建的 `standard` 预设会话**不含**任何 `web_test_*` 与 `mcp__*` 工具。
- 该会话的 `bash` 能执行。（它失败于本机已知的 Git bash `NtCreateDirectoryObject … 0xC0000022` 缺陷，那是这台机器的环境问题，与插件无关。）
- 执行 guard 的作用域限于 web-test 预设：同一个 `bash` 调用在 web-test 会话里被拒，在 standard 会话里被允许。

### 8. 运行控制 —— 通过，但有一项与清单写法不符

- `webTest/controlRun` `pause` → `paused`；此后 `browser_navigate`、`browser_take_screenshot` 与 `web_test_begin_operation` 全在执行层被拒，文案为 `web-test: run win-accept-run-2 is paused and refuses new test actions. Ask the operator to continue it; do not act for it in the meantime.`
- 暂停期间 `web_test_status` 仍可调用——它在 hold 白名单里。
- 重复暂停被拒：非法转换报 `run "win-accept-run-2" is running and cannot resume`；已取消的运行报 `run "win-accept-run-3" is cancelled and cannot cancel`。
- `resume` → `running`；浏览器工具立即恢复可用，运行以 `completed` 关闭。
- `cancel` → `cancelled`；之后的全新运行端到端正常（运行 `win-accept-run-4`：浏览器、证据、用例结果、`finish_run`）。
- 已取消运行上的业务动作被状态层拒绝：`web-test: run "win-accept-run-3" is cancelled; only a running run may change business data`。

**与清单写法不符：** 清单期望“取消后浏览器工具同样被拒”。实际不会被拒。`runHoldStatusSchema` 是 `['paused', 'awaiting-business-time', 'awaiting-user', 'resuming']` —— `cancelled` 不在 hold 状态里，所以 `guardReason` 找不到 hold 的运行，`mcp__playwright-mcp__*` 放行。已取消的运行下浏览器仍可被驱动。业务工具被各自的状态检查挡住，这与该保证不是一回事。见 [D4](#d4)。

### 9. 宿主保持运行时禁用 —— 通过

`pluginManager/setBundleEnabled {name: dsh-plugin-web-test, enabled: false}` → `stage: enable, enabled: false, changed: true, application: applied`，无需重启宿主。

- `webTest/*` 停止应答：`gateway/definition-unavailable — its strict definition was withdrawn and SRC fallback is forbidden`。
- `web-test` 从 `agentPresets/list` 消失（回到 `standard`、`ptc`、`minimal`、`cordis`）。
- 仍持有退休预设的会话报告 `unknown tool "mcp__playwright-mcp__browser_navigate"`、`unknown tool "web_test_status"`、`unknown tool "web_test_start_run"` —— 新派发停止。
- 本次运行相关的 Playwright Chrome 进程数降到 **0**。bundle 自己的 README 说禁用无法回收活会话的浏览器；在 0.2.0-rc.2 上它被回收了，因为预设行卸载会释放 provider fiber。

**发现残留。** 禁用之后，profile 的 `package.json` 把 `dsh-plugin-web-test` 从 `dsh.profile.bundles` 移除了，却**仍留在** `dependencies` 里。profile 于是多出一个没有东西激活的依赖。这正是分发工作里点名的“重装后残留 disabled 配置”那类问题。随后执行的 `removeBundle` 把两处都清干净了。见 [D5](#d5)。

### 10. 卸载与重装 —— 通过

- `removeBundle` → `stage: remove, changed: true, application: applied`，pnpm `exitCode 0`。
- `package.json` 干净，`node_modules/dsh-plugin-web-test` 消失。
- **插件数据保留**：`web-test.sqlite`（81920 字节）和 6 个证据 PNG 仍在 `~/.dsh/plugins/dsh-plugin-web-test` 下。
- 卸载后 `inspect` → `status: accepted, kind: tarball`（该 tarball 仍是有效安装源）。
- 用同一 tarball 执行 `installBundle` → `enabled: true, changed: true, application: applied`；`webTest/status` 报告 `version 0.1.1, state active, schemaVersion 3`，`run 4, case-result 4, operation 2`，6 个证据文件完好。
- 重装后 `listVersionExemptions` 仍为空，没有残留的 disabled 状态挡路。

### 11. 升级 —— 未验证

`pluginManager/inspect` 报告 `registry: null`，`installBundle` 应答 `registries: [null]`：该 profile 没有配置 registry 来源，因此没有可演练的 registry 安装或升级路径。tarball 覆盖安装在第 10 组演练过，并按此记录。**不对 registry 安装或版本升级作任何声明**，升级后的迁移与恢复检查因此也未验证。

### 12. 业务操作与重启对账 —— 通过

一个业务操作被记录为 `dispatching` 后，在它仍在途时用 `taskkill /T /F` 杀掉宿主进程树。桌面 Electron user data 产生了 `crash-2026-10-04T12-47-16-581Z-renderer.log`。

用同一可执行文件与 profile 重启后：

```json
"reconciliation": {
  "blockedRuns": ["win-accept-run-3"],
  "unknownOperations": [{
    "runKey": "win-accept-run-3", "operationKey": "op-inflight-1",
    "reason": "the DSH process restarted while this operation was in flight, so its outcome was never observed; it must be reconciled with the operator, not repeated"
  }]
}
```

- 在途操作是 `unknown`，**没有**被重置为 `not-dispatched`。
- 运行是 `resuming`，guard 文案区分了宿主重启与操作员暂停：`run win-accept-run-3 is resuming and refuses new test actions. The DSH host restarted during that run; report what you know through web_test_status and ask the operator to continue it.`
- 操作员恢复该运行后，对同一 `operationKey` 的**第二次**尝试被状态层拒绝：`operation "op-inflight-1" of run "win-accept-run-3" is unknown; its outcome is unresolved, so it must not be submitted again. Settle it or reconcile it with the operator, and use a new operation for genuinely new work.`
- 随后 `webTest/resolveOperation` 把它结算为 `settled`。

一个真实可用性后果：guard 让模型“通过 `web_test_status` 报告已知情况”，而该工具在本宿主上 100% 失败（[D2](#d2)）。guard 给出的指令无法执行。

### 13. 按会话隔离的 hold —— 通过

运行 `win-accept-run-3` 在 `session-ab946445-…` 中处于 hold（`resuming`）。同时运行的第二个 `web-test` 会话（`session-89c2a86c-…`）的 `browser_navigate` 与 `browser_take_screenshot` 都成功。一个会话的 hold 不会停掉另一个会话的工作；第二个会话里白名单仍然生效（`bash` 被拒）。

### 14. 角色与业务时间等待 —— 通过

- `webTest/assumeRole(run-3, "operator")` → 接受（环境声明了该角色）。
- `webTest/assumeRole(run-3, "admin")` → 拒绝：`web-test: environment "win-accept-env-1" declares [operator]; role "admin" was not declared, so the run may not act as it`。
- `webTest/waitRun(run-3, <+30 分钟 ISO>, reason)` → `awaiting-business-time`。
- 期限前 `webTest/resumeWait(run-3)` → 拒绝，给出剩余时间与指令 `Check the page instead of waiting; do not repeat a case that already ran.`

期限到达后 `resumeWait` 的成功路径未执行（记录的期限在 30 分钟后）。

### 15. 报告三格式 —— 通过

`webTest/buildReport('win-accept-run-1')` 返回 `runKey`、`verdict`、`markdown`（3326 字符）、`html`（4905 字符）和一个 `json` 对象。Markdown 是中文，逐用例给出步骤及其实际观察、断言及其结论与原因、规范后的证据路径，以及“待确认”列表。因为该运行向操作员提出了一个问题，`verdict` 是 `undetermined`。

这次运行独立发现了预置缺陷：正常对照页打印 `合计 33.75`，缺陷页对同样的单价、数量与折扣打印 `合计 40.13`，模型依据自己的读数把 `checkout-total-defect` 记为 `failed`，而不是采信操作员的话。第二个缺陷（清空后购物车仍渲染旧行）被观察到，记为一条带原因的失败断言，并作为待确认问题提出，而不是被悄悄放过。

小问题：同一个被复制的证据文件在同一用例里以两个名字出现——步骤里是 `0-cart-clear-after-reload.png`，证据列表里是 `1-cart-clear-after-reload.png`——因为 `takeEvidence` 按各自的列表下标编号，而 `steps` 与 `evidencePaths` 是两个独立列表。

## 阻塞缺陷

按对 Windows 上真实使用的阻塞程度排序。

### D1

**发布的 bundle patch 写死了 Linux 浏览器路径，Windows 与 macOS 上浏览器无法启动。**

`cordis.patch.yml` 的预设行 `web-test-browser`：

```yaml
executablePath: /usr/bin/google-chrome
```

`web-test` 会话里每一次浏览器工具调用都失败：`Error: async createBrowserWithInfo: Failed to launch chromium because executable doesn't exist at /usr/bin/google-chrome`。该行自己的注释写的是“Drive the machine's own Chrome”，provider 的 README 也把 `executablePath` 记为可选项、默认走上游发现。bundle 把它覆盖成了某一台机器的路径。

更麻烦的是这个值没法按常规方式覆盖。它位于 `@deepseek-ai/dsh-agent-preset` 的 `config.plugins[]` **内部**，所以 loader 针对 `web-test-browser` 的 id-targeted `config` override 根本够不到——已实测：写 `- id: web-test-browser` 的 override 无效，失败完全一样。只有整体覆盖 `web-test-preset` 行才起作用，那意味着要在 profile 的 patch 层把整个预设重述一遍。

第 5、8、12、15 组里所有需要浏览器的项，都是**在这个 profile 级 override 存在的前提下**验证通过的。在默认 profile 上，插件的浏览器能力一装就死。

### D2

**`web_test_status` 在真实宿主里每次调用都失败：它声明的 output schema 漏了两个它总会返回的字段。**

`src/agent.ts` 注册该工具时写的是：

```json
"additionalProperties": false,
"required": ["state", "version", "projectCount", "runCount", "evidenceRoot"],
"properties": { state, evidenceRoot, version, projectCount, runCount }
```

而 `execute` 返回 `statusResultSchema`，后者还有 `interruptedRuns: string[]` 与 `unknownOperations: string[]` —— 工具自己的 `render` 就在读这两个字段。于是每次调用都答：

```text
tool "web_test_status" returned invalid output: "value.interruptedRuns" is not a declared property
(additionalProperties: false); "value.unknownOperations" is not a declared property (additionalProperties: false)
```

影响不止工具本身：guard 的 hold 文案让模型“通过 `web_test_status` 报告已知情况”，`report_case` 的描述也让模型“先调用 `web_test_status` 了解目录”。两处都指向一个不可能成功的工具。

68 个单测为什么漏掉：没有任何测试注册这些工具并断言声明的 output schema 能接受 `execute` 的返回值。两套 schema 各自独立维护，没有任何东西比对它们。

### D3

**`web_test_report_case` 的参数 schema 与存储 schema 不一致，省略可选字段会让工具失败。**

工具把 `steps[].evidencePath`、`steps[].observed`、`assertions[].reason`、`assertions[].actual` 声明为可选，并写明“存储的记录会补上空值”，`caseResultInputSchema` 也用 `.optional()` 扩展了它们。存储 schema 把同四个字段声明成不带默认值的 `z.string()`，于是遵守工具自己契约的模型会得到：

```text
Error: [{"expected":"string","code":"invalid_type","path":["steps",0,"evidencePath"],
"message":"Invalid input: expected string, received undefined"}]
```

真实运行中观察到，随后靠给每个省略字段传 `""` 绕过。注释描述的行为代码并没有实现。

### D4

**已取消的运行不算 hold，所以操作员取消后浏览器仍可被驱动。**

`runHoldStatusSchema` 是 `['paused', 'awaiting-business-time', 'awaiting-user', 'resuming']`，其中没有 `cancelled`，于是 `guardReason` 找不到 hold 的运行，放行 `mcp__playwright-mcp__*`。业务工具被各自的 `only a running run may change business data` 检查挡住，但浏览器本身没有被挡。清单期望取消后浏览器工具被拒；今天不是这样。正确的修法是把 `cancelled` 加进 hold 状态、还是收窄保证，这是产品决策而非机械改动。

### D5

**禁用一个 bundle 会留下半禁用状态。**

`setBundleEnabled(enabled: false)` 把 `dsh-plugin-web-test` 从 `dsh.profile.bundles` 移除，却把它留在 `dependencies` 里。profile 于是多出一个没有东西激活的依赖。`removeBundle` 会两处都清，所以这只影响“启用 → 禁用 → 再启用”的路径。这正是分发工作要求给出已验证恢复步骤的“禁用配置残留”场景；今天可行的步骤是 禁用 → 移除 → 安装。

### D6

**插件数据目录在 Windows 上不是 owner-only。**

`~/.dsh/plugins/dsh-plugin-web-test` 继承其 ACL。`mkdir(0o700)` 与 `chmodSync(0o700)` 在 NTFS 上是空操作，而 `shady\CodexSandboxUsers` 与其它主体对 SQLite 数据库和证据 PNG 持有 `Modify`。见下面的开放问题。

## 交回 Ubuntu 的修复清单

按建议顺序排列。这些都不需要 Windows 专属改动，全在插件侧。

1. **D1 — 让浏览器路径跨平台正确。** 从预设行里去掉 `executablePath`，让 provider 的上游发现去找已安装的 Chrome/Edge；或者从一个有文档的 `dsh` home-path/配置表达式解析它。如果一定要随包发布具体路径，那它必须来自用户能覆盖的配置，而不是 bundle 里的字面量。之后在默认 profile 上重跑清单第 5 组——当前第 5 组的“通过”依赖我的 override。
2. **D2 — 让 status 工具的 output schema 与 `statusResultSchema` 一致。** 要么把那两个数组属性补进声明的 `output.schema`（并进 `required`），要么从 `execute` 的返回值和 `render` 的文案里去掉它们。加一个测试：挂载 agent 行，断言声明的 schema 能 parse `execute` 的返回值，对**每一个**注册的 `web_test_*` 工具都断言——这类 bug 不该有第二次机会。
3. **D3 — 让输入 schema 与存储 schema 对齐。** 要么把这四个字段在工具的 `parameters` 里改成必填，要么在 `caseResultRecordSchema` 里给它们 `.default('')`，让省略的值被存成空字符串——也就是注释已经声称的行为。加一个省略这些字段调用 `web_test_report_case` 的测试。
4. **D4 — 定下取消后的保证。** 如果已取消的运行必须停止浏览器派发，把 `cancelled` 加进 `runHoldStatusSchema`，并让 hold 文案对它读得通。如果不，就把 `WINDOWS-ACCEPTANCE.zh.md` 第 8 组改成陈述代码实际提供的、更窄的保证。两边必须有一个改；今天它们互相矛盾。
5. **D5 — 让禁用变完整。** 要么 `setBundleEnabled(false)` 同时移除依赖，要么把文档化的恢复步骤定为 禁用 → 移除 → 安装，并在清单里写明。
6. **重新生成 `src/client/remote.ts`。** 它落后于实现：五个 `@Remote` 方法没有 descriptor，`status` 与 `buildReport` 的结果声明比服务返回的更窄。生成器应当在实现声明了某个方法而生成文件漏掉它时直接失败，这样这类漂移不会再无声发生。
7. **统一报告里的证据路径命名。** 每个用例只编号一次复制出来的文件，步骤与证据列表都用那个名字，不要各自编号。
8. **决定并记录 Windows ACL 问题**（D6）：要么为插件数据根实现 NTFS ACL 收敛，要么在 README 里声明平台限制，并撤掉那些无法成立的 `0o700` 说法。

另外值得做一件：bundle 自己的注释声称禁用无法回收活会话的浏览器。在 0.2.0-rc.2 上它可以（Chrome 进程数降到 0）。更新该注释，免得下一个读者围绕一个并不存在的限制做设计。

## 结论

**以本次候选版本计，不适合装入日常使用环境。**

有真实证据支撑的部分：经插件管理器安装且零版本豁免；类型化 Remote 命名空间；执行层白名单与它的按会话 hold；最要紧的 S4 持久执行语义——在途操作在宿主崩溃后存活为 `unknown`、运行被标记 `resuming`、操作员恢复后同一 `operationKey` 的重复提交被拒；角色与业务时间强制；插件自有 SQLite 跨重启；卸载/重装且数据保留。报告链路产出三种格式并附带真实证据，模型靠自己读数发现了预置缺陷。

阻塞日常使用的：**D1** 意味着默认 Windows profile 根本起不来浏览器，插件存在的意义无法工作；**D2** 意味着 guard 自己指向的工具每次调用都失败。两者都是小的、局部的修复，且都在插件代码里，不在宿主里。

保持插件卸载是安全的。重新安装也安全——重装路径干净且保留数据——但在 D1 与 D2 修好之前，测试会话第一轮就会撞上死浏览器和死状态工具。

## 复现步骤

**受控测试站**（一次性，状态只在进程内，无持久化）：

```text
.acceptance-local/site/server.mjs        # node:http，127.0.0.1:18999
  /            正常对照：站点标识与导航
  /pricing     正常对照：12.50 x 3 = 37.50，打九折，合计 33.75（正确）
  /checkout    预置缺陷 A：同样输入下打印 合计 40.13
  /cart        预置缺陷 B：“清空购物车”清空服务端状态，页面仍渲染旧行
```

**验收脚本**（全部在 `.worktrees/windows-acceptance/.acceptance-local/` 下，git 排除，从不提交）：

| 脚本 | 用途 |
| --- | --- |
| `dsh-remote.mjs` | 用宿主自己的 launch token 走回环 API 的类型化 Remote |
| `session-create / session-turn / session-read` | 创建绑定预设的会话、发送 prompt、读取持久日志 |
| `restart-host.ps1` | 用同一可执行文件、profile 与运行时重启验收宿主 |
| `register-env.ps1` | 把测试站登记为环境修订及其执行策略 |
| `site/server.mjs` | 受控测试站 |

**第 5、8、12、15 组使用的环境适配**（事后已移除，见 [D1](#d1)）：

```yaml
# C:\Users\64576\.dsh\profiles\desktop\cordis.patch.yml
- id: web-test-preset          # 覆盖整个预设行，而不只是浏览器那一行
  config:
    id: web-test
    plugins:
      - id: web-test-browser
        name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'
        config:
          mode: launch
          headless: false
          executablePath: 'C:\Program Files\Google\Chrome\Application\chrome.exe'
      # ... persona、agent、probe 行原样重述
```

**用到的会话 id**（全部由本次验收创建，全部在验收 profile 内）：

| 会话 | 预设 | 用途 |
| --- | --- | --- |
| `session-5ecfec28-74c0-41be-886d-b4fa1552618e` | web-test | 第一轮，浏览器被 D1 阻塞 |
| `session-cd33ed04-bd77-434e-8f02-1854066548e0` | web-test | 第二次尝试，仍被 D1 阻塞 |
| `session-ab946445-8e77-4b22-abc4-172dd4143234` | web-test | 主运行：用例、暂停/恢复/取消、崩溃、角色、等待 |
| `session-89c2a86c-d59d-4ae0-b81b-8b66dc41d75f` | web-test | hold 隔离的对照会话 |
| `session-fd667098-0a51-414f-b306-59f0db854d64` | standard | 普通会话对照 |

记录下来的运行：`win-accept-run-1`（三个用例，completed）、`win-accept-run-2`（暂停 → 恢复 → completed）、`win-accept-run-3`（在途崩溃 → resuming → 操作结算 → cancelled）、`win-accept-run-4`（取消后新运行，completed）、`win-accept-run-6`（陈旧证据探测）。

宿主启动日志、会话日志与报告 dump 在 `.worktrees/windows-acceptance/.acceptance-local/evidence/`。`evidence/host-boot.log` 含 launch token，**不得提交或外传**；正因如此它被 git 排除。

## Dev Note

关于方法的两点，让下一次验收更省事。

`POST /api/<endpoint>` 上的类型化 Remote 是宿主侧验收的正确骨干：它走的是 Client UI 调用的同一条 Typert gateway，不需要 Electron 窗口，并且能扛过宿主重启。代价是 UI 相关论断（设置分区渲染、控制台干净）没有骨干，在没有 GUI 驱动可用时只能保持未验证。把它们记成未验证，而不是拿服务端代理去顶替。

价值最高的三个发现里，有两个来自在信任任何一方之前先把生成产物与实现对读一遍：`client/remote.ts` 已经与 `@Remote` 方法漂移，而 status 工具的两套 schema 互相矛盾。两者在测试全绿的运行里都看不见。“生成器输出了什么”与“服务声明了什么”之间做一次 diff，代价很低，而且一次找出了两个。
