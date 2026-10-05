# Web 测试插件 Windows 验收的纠正与修复对照

## 目的

Windows 端在提交 `37ef29819ee94c7b503f20ea337ca9d44563a9db`、插件 `0.1.1`、
SHA-256 `64c3757ebb4a957b8ea1da6167bd5a298b6286dc9e8546d551620acc6cf4f58a`
上完成了一次桌面验收，产出 `origin/codex/web-test-windows-acceptance` 的
`1ebf93d332ff97c13af78661cad045470ecf0738`，列出 D1–D6 六项阻塞缺陷。

本记录做两件事：逐项写明当前源码的状态与新候选的实测结果，并纠正两处**归因
错误**。原始 Windows 记录不在本分支改写，原始观察保持原样。

## 归因纠正

### 禁用 bundle 后依赖残留不是插件缺陷

Windows 记录 D5 写的是"禁用一个 bundle 会留下半禁用状态"，并把它列为缺陷。

`setBundleEnabled(false)` 把插件从 `dsh.profile.bundles` 移除而保留在
`dependencies` 里，是**宿主文档规定的行为**，不是本插件造成的。`removeBundle`
两处都清，所以只有"启用 → 禁用 → 再启用"这一条路径会看到残留依赖。

正确的问题是：那条路径上**重新启用是否失败**。Windows 记录自己的第 9 组
（宿主保持运行时禁用）结论是通过，因此按"禁用 → 重新启用"复测即可，不要求宿主
在禁用时卸载包。本记录不把它计为缺陷。

### registry 与升级语义此前混为一谈

`registry: null` 表示使用 pnpm 配置的源，**不是**"未配置来源"的缺陷。此前把
registry 缺省与升级失败放在一起评价，混淆了两件事。

- registry 来源：分别验证 pnpm 配置的源是否被使用。
- 插件升级：必须用**两个不同版本**的 tarball 验证。`0.1.1` 卸载后重装
  `0.1.1` 只是同版本重装，不构成升级证据。

本记录不改动 Windows 的原始观察，只纠正归因与复测方式。

### 跨平台 owner-only 的结论不成立

此前文档写有"跨平台 owner-only 已成立"。**该结论不成立**：Windows 记录 D6 实测
`~/.dsh/plugins/dsh-plugin-web-test` 继承父 ACL，`shady\CodexSandboxUsers`
与其它主体对 SQLite 数据库和证据 PNG 持有 `Modify`。`mkdir(0o700)` 与
`chmodSync(0o700)` 在 NTFS 上是空操作。

插件自有目录的 Windows 权限加固作为**明确未闭项**保留。本轮不递归修改
`~/.dsh`、用户目录或既有日常数据的 ACL，只在插件自有目录范围内提出方案，
交 Windows 实测。记录该限制不等于满足原有安全要求，也不代表插件适合日常使用。

可复用的公开能力与候选方案（待 Windows 实测，未实施）：

- 宿主 `dsh-home-paths` 暴露的插件数据根，是唯一应被加固的路径范围。
- Node 的 `fs` 在 Windows 上没有可用的 POSIX 权限位接口；`mode` 参数被忽略。
- 可行方向是在插件创建自有目录后调用公开的文件系统能力设置受限 DACL，且只
  作用于 `plugins/dsh-plugin-web-test/**`。这属于 Windows 专属实现，需要单独的
  平台分支与实测，本轮未做。

## D1–D6 逐项状态

对照三个口径：Windows 验收的旧包 `0.1.1` / 当前源码 / 新候选 `0.1.2` 实测。

| 缺陷 | 旧包 0.1.1 | 当前源码 | 新候选 0.1.2 |
|---|---|---|---|
| D1 写死 Linux 浏览器路径 | 失败 | 已修 | 已移除 `executablePath`，交由提供方发现；行配置可在不改写预设的情况下覆盖 |
| D2 `web_test_status` 输出 schema 缺字段 | 失败 | 已修（`fe007a6336`） | 实测通过，宿主返回 `active`、版本 `0.1.2` |
| D3 `report_case` 省略可选字段被拒 | 失败 | 已修 | 存储 schema 对四个可选字段给默认值，并有三条针对性测试 |
| D4 取消后浏览器仍可驱动 | 失败 | 设计已改 | 见下 |
| D5 禁用残留 | 归因错误 | — | 见"归因纠正" |
| D6 Windows 目录权限 | 失败 | 未闭项 | 未闭项 |

### D4 的做法

没有把 `cancelled` 加进 held 状态集合。加进去会让"取消一次之后所有后续运行都
卡住"重新出现，因为会话拥有的运行不止一个。

改为把浏览器派发授权绑定到 **运行 + 会话 + 已核验角色**：执行守卫在每个浏览器
调用上问存储"这个会话当前是否有一个正在运行、且其角色已经过站点核验的运行"。
- 已取消的运行不再是 `running`，因此失去浏览器。
- 新运行是另一个运行，重新取得自己的授权，不会被旧运行堵住。
- 其他会话按自己的运行判断，互不影响。

授权查找会跳过非 `running` 的运行继续找，而不是遇到第一个就返回。这一点由
`tests/browser-dispatch.spec.ts` 针对真实存储钉住，包含"取消 A 后 B 仍可执行"
和"另一个会话不受影响"两条。

### D2 的防回归

Windows 记录指出 68 个单测没抓到 D2，因为没有任何测试让**真实 execute 返回值**
通过**声明的 output schema** 并跑通 `render`。新增：

- `tests/tool-contract.spec.ts`：用一个真实形状的返回值校验声明 schema，并断言
  额外字段会被拒；比对声明字段集与 `render` 用来收窄的 Zod 派生的字段集。
- `tests/tool-schema.spec.ts`：同样比对，并测额外字段被拒。
- 派生方案曾被尝试并**撤回**：宿主自己的 JSON Schema 校验器不接受
  `z.toJSONSchema` 的产物，直接派生会让 agent 预设加载失败。保留手写 schema，
  用测试钉住两者一致。

### 类型化 Remote 补齐

生成器原本只描述 13 个方法，源码有 18 个 `@Remote`。补齐到 19 个条目
（含 `assumeRole`、`releaseRole`、`waitRun`、`resumeWait`、`listOperations`、
`resolveOperation`），并新增检查：生成客户端描述的方法必须覆盖源码里每一个
`@Remote` 方法，缺一个即失败。这样生成文件不会再与源码脱节。

## 真实宿主实测（Ubuntu，DSH 0.2.0-rc.2，候选 0.1.2）

- 插件加载 `active`，版本 `0.1.2`，`web_test_status` 可用。
- 预设中的全局浏览器行已移除；浏览器由每角色的独立 MCP 服务器提供。
- 无已核验角色时，模型对 `mcp__playwright-role-buyer__browser_navigate` 的调用
  被守卫拒绝，原文为"this session has no run that may drive a browser"。角色隔离
  的路由强制在真实宿主上生效。

## 0.1.3：作用域派发与身份核验的修复进展

`0.1.2` 保留为开发检查点，**不视为浏览器功能可用的验收候选**。`0.1.3` 继续该目标。

### 已修（根因，不是绕过）

1. **作用域派发**。宿主 `ToolsRuntime` 用 `get(name, scope)` 取工具视图，`scope` 就是
   Agent。此前只传了 `parent`，父调用不携带作用域，于是查找落到全局视图，角色的 MCP
   工具根本不在那里，恒为 `unknown tool`。现在传 `exec.agent`，并用公开的
   `ToolCallId(id)` 工厂为子调用生成**独立 callId**，同时带 `rootCallId`、`parent`、
   `signal`，让日志里内外两层可分辨。没有伪造 Agent；没有 Agent 时直接拒绝，而不是
   退到全局查找。

2. **身份核验不再接收任意页面文字**。`readAccount` 原来把页面文本当账号，登录页或错误页
   都会被当成身份。现在读 `data-web-test-account` 标记，未登录时该属性为空，核验失败；
   受控站点已按此实现，未登录为空、两个账号各自不同。

3. **预期账号来自已确认的环境**。角色在环境里用 `accountRef` 绑定账号，核验比对的是
   环境里那个绑定值。模型不能再自己声明 `expectAccount` 来让自己通过；旧的 `identityUrl`
   参数保留为 `accountPage` 的兼容名。

4. **解开登录与授权的循环**。区分三段：身份准备（导航、读取、填表、按键）、插件固定的
   身份观察（`assume_role` 自己的核验）、已核验角色执行业务。准备阶段只对**已核验前**的
   只读/填表工具开放，且限定在本会话运行声明的角色浏览器上；**`browser_click` 明确不在
   准备集内**，因为点击是改变业务数据的动作，需要人工接管。核验失败不发业务权限。

5. **导入与装配**。`@playwright/mcp` 及 `mountSessionMcp` 那条路径的 peer 全部声明为插件
   依赖，否则在 profile 的 node_modules 里解析不到；提供方改为按需动态加载；tsdown 的
   chunk 从 `lib/shared/` 放回 `lib/`，因为 shared chunk 下一层的
   `createRequire(...)('../package.json')` 会解析失败，那正是两个行"failed to import"的原因。

### 真实宿主实测

- `0.1.3` 在 `webclean` profile 上**全部行激活**（0 次 "did not activate"），
  `web_test/status` 返回 `active 0.1.3`。
- 端到端最小闭环（建运行 → 取得角色浏览器 → 登录 → 核验身份 → 执行一个允许动作）
  **尚未取得证据**：全新 profile 启动时预设行停在
  `pending (waiting for service: agentPresets)`，导致无法建测试会话。

### 仍未解

- 端到端闭环未验证，因此角色隔离目标**仍未完成**。
- 全新 profile 的预设引导（`agentPresets` 就绪顺序）是一个新暴露的问题，尚未定位。
- 浏览器资源真实释放（保存 scope/fiber/MCP 释放句柄并等待完成）尚未实现，当前
  `releaseAll` 仍是清 Map + `setTimeout(0)`，不构成进程回收。
- 同一角色名在不同项目/环境/运行之间的隔离键尚未加代次，旧运行的排队调用仍可能借用
  新运行的授权。

### 环境诊断：persona 冲突不属于本插件

在干净 profile 上反复遇到 `persona (@deepseek-ai/dsh-persona): prompt section
"deployment:persona-prefix" is already registered`，且**普通会话（未选 web-test 预设）也失败**。
把 `dsh-plugin-web-test` 从 profile 的 bundle 列表里彻底摘除、patch 置空后重启，普通会话
**仍然报同样的错误**。

因此该冲突来自本机 DSH 的既有环境状态，不是插件装配造成的。此前移除预设 persona 行是
在追这个环境症状的根，那个改动没有证据支持，属于误判。预设 persona 行是否恢复，留待
环境恢复后重新验证再定；`web-test-probe-shell` 行的移除是**独立成立的**——该行把
`dsh-tool-bash` 挂进预设作用域，与全局 `tool:bash` 段落冲突，这条错误在插件在册时可复现。

### 另一个已定位的宿主侧错误

web-test 预设会话中每次工具调用都以 turn 错误结束：
`Cannot read properties of undefined (reading 'prepare')`，工具结果未落盘。
它在**禁用角色浏览器行之后依旧复现**，因此不是浏览器层引起。尚未定位到具体调用点。

## 未解项（如实保留）

**插件自行核验角色身份目前不可用。** `assume_role` 要通过 `tools.execute` 向角色
的 MCP 浏览器派发一次导航与读取，宿主对该派发返回 `unknown tool`。传递
`ToolExecution.token` 作为 `parent` 未能解决：MCP 服务器的工具注册在 agent 作用域
内，插件持有的服务引用看不到它们。

后果是：角色切换无法自动完成，`activeRole` 不会被写入，因此浏览器派发授权永远
拿不到已核验角色，实际效果是**浏览器一律不可用**。这是安全侧失败（拒绝多于
允许），不是越权，但角色隔离目标因此**未完成**。

不降低验收标准：角色身份核验、角色 A/B 独立 Cookie、跨角色业务流程都尚未取得
真实证据。下一轮继续在公开接口上寻找可用的作用域化派发路径；找不到时如实升级
为需要决策的问题，不以字段模拟代替隔离。

## 交接给 Windows 的复测清单

新候选：`dsh-plugin-web-test-0.1.2.tgz`，SHA-256
`230f13dc08cfb35abdfbc30d849ce807ea2805668f6cb902d3b2da5d12abe8b5`，与 `0.1.1`
不同文件名。

`0.1.1` 的 tarball 曾被后续构建以同名覆盖，已从 `6c0f6682e53` 恢复为 Windows
实际验收的那一份：133471 字节，SHA-256
`64c3757ebb4a957b8ea1da6167bd5a298b6286dc9e8546d551620acc6cf4f58a`。此后每个
候选使用自己的版本号文件名，不再覆盖既有包。

- 默认安装后的浏览器启动（无 `executablePath`，提供方自行发现）。
- `web_test_status` 与 `web_test_report_case` 的 schema 往返。
- 取消运行后浏览器被拒；新运行可执行；普通会话不受影响。
- 类型化 Remote 全量方法。
- 实际设置界面。
- 窗口隐藏到托盘、退出、重启。
- 版本升级：必须用 `0.1.1` → `0.1.2` 两个不同 tarball，并验证数据恢复。

不通过直接调用私有 Desktop Host 入口代替桌面验收。
