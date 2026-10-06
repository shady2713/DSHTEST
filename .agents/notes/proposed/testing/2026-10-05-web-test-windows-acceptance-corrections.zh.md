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

### 修正上一次的归因

上一次把 persona 冲突整体归为环境问题，并据此撤回了预设 persona 行的移除。**这个归因不完整**，
这里拆成两个独立问题：

1. **环境问题**：普通会话（不选任何预设）也报
   `deployment:persona-prefix` 已注册。在全新 profile、把插件从 bundle 列表彻底摘除、patch
   置空之后仍然复现；换到隔离 `HOME`（不含用户 `~/.dsh/local-bundles` 等本机状态）后，普通
   会话创建成功。所以这一个来自本机 DSH 既有状态，与插件无关。
2. **插件问题**：错误信息点名 `web-test-persona` 时，是预设里的 persona 行与部署 persona 在
   同一作用域冲突。移除该行后，预设在干净 profile 上创建会话成功。所以移除该行是成立的。

两者曾被我混为一谈，结论一度反了。此处按证据更正。

### 干净环境下的真实进展

用 `dsh iso --from-default-profile web` 建全新 profile，装 0.1.5，`启动失败 0 / 未激活 0`，
`web-test` 预设会话创建成功（`session-c5581e24…`）。

`web_test_start_run` 仍然以 `Cannot read properties of undefined (reading 'prepare')` 让每个
turn 以 error 结束，工具结果不落盘。**在干净 profile 上依旧复现，因此不是环境问题**，与
预设组合绑定。宿主侧该报错出现在 PTC 绑定闭包里读取
`registry[TOOL_RUNTIME_SCHEDULER]` 之后调用 `scheduler.prepare`，即该符号在会话作用域的
registry 上取不到。尚未定位为什么本插件的预设作用域缺少它。

注意：pnpm 按路径缓存——同名 tarball 重新构建不会重读安装。本轮 0.1.4 重装后安装内仍是旧的
persona 行，0.1.5 才真正生效。每个候选版本必须用**未使用过的版本号**。

### `prepare` 报错的定位进展（未修复）

失败点是 `dsh-agent-loop` 读取 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 后调用 `prepare` /
`finalize`，该符号在它读到的那个 `tools` 上取不到。用公开导出的符号在两处直接探测过：

- 宿主层：`scheduler=true`，构造函数 `ToolRuntime`
- 预设作用域（`web-test` agent 行拿到的 `tools`）：`scheduler=true`，构造函数 `ToolRuntime`，
  且与宿主层**不是同一个实例**（`same=false`）

所以预设作用域确实会得到自己的 `ToolRuntime` 实例（与交付的 kernel 预设同样 inject `tools`，
这是正常行为），而宿主与预设两处都带该符号。agent loop 读到的因此是第三个对象，尚未识别。
探针已删除，未进入产物。

### 0.2.x：作用域根因已解，`accountPage` 必修

`prepare` 报错的真正原因找到了：0.1.3 把九个 `@deepseek-ai/dsh-*` 包放进了 `dependencies`，
profile 因此装出第二份副本。`TOOL_RUNTIME_SCHEDULER` 是模块加载时求值的 `Symbol()`，两份副本
是两个不同符号，agent loop 用自己的符号去查带插件副本符号的运行时，必然取不到。改为
`peerDependencies` 后，profile 不再装 `dsh-tools` 副本，预设会话里的工具调用第一次拿到落盘结果。

（此前用插件自己副本的符号做的探测报告 `scheduler=true`，正是这个原因——探针自己骗了人。）

`assume_role` 的 `accountPage` 之前在手写 JSON Schema 里没进 `required`（`['runKey','role']`），
模型看不到它是必填，连连省略；zod 侧又是 optional，两边不一致。改为 JSON Schema 与 zod
都必填，去掉 schema 外的 `identityUrl` 别名。

### 0.3.6：两个角色各自核验通过

同一运行里先后核验了两个角色，各自读到站点自己的账号、各自匹配已确认环境里的绑定：

- `Run run-ab now acts as approver; every operation and case result records it.`
  （approver 绑定 `Bob Approver`）
- 早前 buyer 的同一句（buyer 绑定 `Alice Buyer`）

这就是角色隔离的直接证据：不同角色读到不同账号，且每个账号都来自站点而不是存储字段。

同时暴露一个未修缺陷：buyer 角色的浏览器工具报
`unknown tool "mcp__playwright-role-buyer__browser_navigate"`——两个角色同时预取时，
只有一个角色的 MCP 工具进入了该 Agent 的清单。`prefetchConfirmed` 与 `putEnvironment` 两条
预取路径并发时，角色被逐个 `await import` 后挂载，是否两个都完成需要进一步确认。

修掉一处相关缺陷：提供方在 browser-use 服务上的注册比本 effect 活得久，池上一轮挂过的角色
在下一轮挂载时会撞名并抛错。现在这种"名字已占用"被视为该角色浏览器仍然在用，不是失败。

### 0.3.7：定位"只有一个角色的工具在清单里"

直接证据（临时探针，探针已删）：

```
WT-PROBE prefetch roles=["approver","buyer"] started=["approver","buyer"] mounts=2
```

两个角色的浏览器**都挂上了**。让模型自报可见的 MCP 命名空间，只有一个：

```
命名空间: ['playwright-role-approver']
```

即失败不在挂载，而在**每个 Agent 的工具登记**。提供方在 `agent/created` 里按
`resources.available(agent)` 决定 ready 还是 blocked；`prefetch` 只等到
`mountSessionMcp` 返回，那是**注册完成**，不是浏览器就绪，第二个角色的客户端在该 Agent
创建时尚未连上，于是它的工具被按 blocked 掩掉。

### 0.3.8：单槽注册表——多角色并行浏览器在本宿主上不成立

`@deepseek-ai/dsh-browser-use` 的文档原话：

> Reserve the **sole** provider slot until the contribution is disposed.
> A second registration fails even when it repeats the current name.

`register()` 把名字写进 `this.registration`，重复注册直接抛错。也就是说**一个 browser-use
提供方槽位**——我的设计"N 个角色各挂一个 `mountSessionMcp`"在本宿主上不成立。

这也解释了 0.3.7 的现象：第二个角色的挂载必然失败。我上一轮加的
`alreadyRegistered` 容错把这次**必然失败吞成了成功**，于是看起来"挂上了"（`mounts=2`），
实际上第二个提供方从未注册，工具自然不在清单里。这个容错本身是错的：它掩盖了一个应当
暴露的架构约束，必须撤掉或改成明确失败。

由此产生的设计后果（尚未决定，需要产品判断）：

- **单角色、顺序切换**可行且真实：同一时刻只有一个角色的浏览器；切角色时真实释放旧
  浏览器（`agent/created` 已有可用钩子）再起新的，A 的登录态不会带到 B。这满足"角色不串用"，
  但不满足"A/B 同时登录"。
- **A/B 同时在线**需要别的机制。唯一在公开接口内可查的方向是：槽位是**按服务实例**持有的，
  而作用域会为服务派生子实例——若 `mountSessionMcp` 挂在一个派生作用域的 ctx 上，
  每个作用域会有自己的槽位。但提供方的工具是按 agent 登记的，派生作用域里的提供方是否
  登记到测试 Agent 的清单上，未经验证。

### 0.3.8：两条公开路径都验证过，都不成立

派生作用域这条路也实测了（0.3.8 试验，已回退）：把每个角色的 `mountSessionMcp` 挂到
`createScope(ctx, { webTestRole: key })` 派生的作用域上。模型自报工具清单的结果是
`命名空间: []`——**一个 mcp 工具都没有**，连单角色也坏了。提供方在派生作用域里注册的
工具不会进入测试 Agent 的清单。

所以两条符合既定方案的公开路径都已实际验证不可行：

1. 同一作用域挂 N 个提供方 → 被 `browserUse` 的单槽约束挡住
2. 派生作用域各挂一个 → 工具进不了 Agent 清单

同时确认了一件事：`0.3.7` 里的 `alreadyRegistered` 容错是错的——它把"第二个提供方必然
注册失败"吞成了成功，报告角色已挂载而浏览器并不存在。已回退该容错，让冲突明确失败。

### 产品决定（shady 已定）

就上述冲突询问后，决定为：**单角色在线 + 切角色真实释放重启**。

- 同一时刻只有一个角色的浏览器，符合宿主单槽约束
- 切角色时**真实释放**旧 Chromium（保存 `ctx.effect` 返回的 `AsyncDisposable` 句柄并
  `await` 它完成），再启动新角色
- 因此 A 的登录态在物理上不可能带到 B——这不是靠守卫拦的，是旧浏览器已经退出
- 放弃"A/B 同时在线"这一条；跨角色协作改为同一运行内的顺序交接

本轮只落地了这个决定，切换实现尚未开始：`role-browser.ts` 经多轮实验性编辑后偏离可编译
状态，已回退到 `5c0d6280ab` 的干净版本（102 测试通过）。从该基线重新实现，不在旧编辑上叠加。

实现要点（下一轮）：
1. `mountBrowser` 保存 `ctx.effect(...)` 返回的 `AsyncDisposable`，而不是只清 Map
2. 新增 `switchTo(role)`：若当前角色不同，先 `await` 旧句柄的 `dispose()`，确认 Chromium
   退出后再 `ensure` 新角色
3. 释放失败必须抛出并可观察，不吞掉
4. 切角色后旧身份的核验失效，需要重新核验（`agent/disposed` 已有现成钩子可用于随 Agent 释放）

### 0.4.0：真实释放句柄已就位，但"切角色时挂载"不成立

**已实现**（第六节主体）：

- `mountBrowser` 保存 `ctx.effect(...)` 返回的真实释放句柄（`Disposable<Promise<void>>`），
  不再是清 Map
- 新增 `releaseRole(role)`：`await` 句柄完成，释放失败抛出并带上角色名，不吞掉
- `releaseAll()` 依次 `await` 每个角色的释放，失败汇总成一条错误抛出；**删掉了原来的
  `await new Promise(resolve => setTimeout(resolve, 0))`**，那个写法正是不算证据的那种
- 新增 `switchTo(role)`：角色不同则先释放旧角色再挂载新角色
- 删除了 `alreadyRegistered` 容错和 `prefetch`/`prefetchConfirmed` 批量预取

**切角色时挂载不成立**，实测错误换了形态：

```
web-test: role "buyer"'s browser failed mcp__playwright-role-buyer__browser_navigate:
playwright-role-buyer: browser tool belongs to another Session
```

浏览器在 0.3.9 挂上了（chrome 进程数 30 → 30，没有新起也没有退出），但提供方把工具绑到了
**另一个 Session**：它的 `agent/created` 钩子只在 Agent 创建时为该 Agent 建会话资源，
挂载发生在 `assume_role` 也就是 Agent 之后，于是没有资源归属。

两条约束叠加后的结论：**角色必须在测试会话创建之前就确定并挂载**。也就是说一个测试会话
只能扮演环境里的第一个角色；要换角色，得结束该会话，另起一个——浏览器天然不同，登录态
自然不共享。

`0.4.0` 回到环境确认时挂载第一个角色（`stored.roles[0]`），实测单角色闭环仍成立：

```
run-1: running | activeRole: 'buyer'
```

`switchTo`/`releaseRole` 的代码保留但当前没有调用方——它们是会话结束与插件禁用时真实释放
的抓手。

**真实释放本轮没有取得证据。** 试图在隔离环境里数插件自有浏览器的进程数来证明退出，量不到：
`putEnvironment` 返回 ok，但 `ms-playwright` 与 `dsh-experimental-*` 进程数在确认环境前后都
没有变化，进程观测本身不稳定。系统里另有 29 个 `/opt/google/chrome/chrome` 是**用户自己的
个人浏览器**，按第六节要求不得当作插件资源去动，也不能计入。

### 0.4.1：宿主退出时的真实释放已取得证据

可靠的进程归属信号是 **MCP 客户端命令行**：`playwrightArgs` 以
`join(dirname(import.meta.resolve('@playwright/mcp/package.json')), …)` 解析出插件自己的
CLI 路径，它出现在该插件独有进程的 `ps` 行里。按浏览器二进制名统计是错的做法——本机还有
29 个 `/opt/google/chrome/chrome` 是用户自己的个人浏览器，既不能动也不能计入。

受控测量（隔离 `DSH_HOME`，profile `iso2`，干净基线）：

| 时点 | 匹配 `playwright/mcp` 的进程 |
|---|---|
| 干净基线 | 1（只有 grep 自身） |
| 宿主起来 | 1 |
| 确认环境 + 会话跑通，浏览器已起 | 2（grep + 1 个插件自有客户端） |
| 宿主 `SIGTERM` 优雅退出后 | 1（回到基线） |

退出后再次以 `grep -v grep` 精确计数，结果为 **0**，与上表一致。

所以"宿主退出"这一条**有证据**：插件自有的浏览器进程真的退出了，不是清 Map、不是等一个
tick。同一把句柄也用于运行结束与取消，但这两条**尚未单独测量**，不能由这一条推断。

### 0.4.1 续：禁用插件但宿主保持运行——测到一个真实缺陷

同样方法测量。把 `<profile>/cordis.patch.yml` 里
`{ id: web-test-role-browsers, disabled: false }` 改成 `disabled: true`：

| 时点 | 匹配 `playwright/mcp` 的进程 | 宿主 |
|---|---|---|
| 浏览器已起 | 2 | 存活 |
| 该行禁用后 22 秒 | **2（没变）** | 存活 |
| 该行恢复 `disabled: false` 后 | 2 | 存活 |
| 宿主 `SIGTERM` 退出后 | 1（回到基线） | 已退出 |

同时 `webTest/status` 从可用变成
`gateway/service-unavailable: active Service "webTest" is unavailable`。

**即：行被禁用、服务被销毁，但插件自有的浏览器进程没有退出**；重新启用后服务也没有恢复
（仍是 unavailable）。进程是在宿主退出时才随之消失的。

所以"插件禁用但宿主保持运行"这条**不通过**，而且暴露两个待修的生命周期缺陷：

1. `web-test-role-browsers` 行的 `ctx.effect` 释放没有真正触达已挂载的浏览器——当前池只在
   插件整体卸载时释放，行级禁用后服务实例被销毁，`releaseAll` 未必被等待
2. 该行禁用再启用后 `webTest` 服务没有回来，需要查 loader 是否会重建被禁用的行

### 0.4.1：异步 disposer 修复没有改变观测结果

先说 `dsh plugin` 的能力边界：它只有 `add` / `rm`（pnpm 透传），**没有 enable/disable
动词**；管理器代码里有走 `reload()` 的 `setEnabled`，但 CLI 未暴露。所以运行期禁用只能改
`<profile>/cordis.patch.yml`。

据此把池的释放改成可等待的 disposer：

```ts
// 之前：ctx.effect(() => () => { void this.releaseAll() })
ctx.effect(() => async () => { await this.releaseAll() })
```

`void` 丢掉了 promise，cordis 不会等；这是真实的缺陷，修得对。

但**重测没有变化**（0.4.1，隔离 `DSH_HOME`）：

| 时点 | 插件自有进程 |
|---|---|
| 浏览器已起 | 2 |
| 该行禁用后 25 秒 | 2 |
| 再等 40 秒 | 2 |

并确认这个 MCP 客户端的父进程仍是 `node …/dsh iso2`，即它仍挂在宿主下，没有被关闭。

所以"行禁用释放浏览器"**仍不通过**，且 async disposer 不是原因。### 0.4.2：服务确实被销毁了，但释放仍未发生

把上一条记的疑问分开验证了。把该行改成 `disabled: true` 之后，真实调用确实失败：

```json
{"code":"gateway/service-unavailable",
 "message":"typert gateway: … active Service "webTest" is unavailable"}
```

**服务实例是被销毁的**，不是网关视图的错觉。所以 `ctx.effect` 的 disposer 应该是被调用的。

那么剩下的问题在**释放的内容**上。`playwright/mcp` 这个标记匹配的是 **MCP 客户端进程**，
它是宿主的子进程（父进程实测为 `node …/dsh iso2`）。宿主退出时它跟着消失；只禁用该行时
它留下——说明提供方的 teardown 关掉的是**浏览器**，而客户端子进程要等宿主退出才被回收。

也就是说：我此前用 `playwright/mcp` 作为"插件自有浏览器"的标记，量到的一直是**客户端进程**，
不是浏览器进程。两条结论都要修正：

- 宿主退出：客户端进程确实消失（成立）
- 行禁用：客户端进程留下；**浏览器本身是否关闭，本轮没有量到**

### 0.4.3：浏览器与客户端分开测量，两条路径结论不同

给 `web-test-role-browsers` 行加
`config: { executablePath: '/home/weetion/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true }`，
`playwrightArgs` 会把它作为 `--executable-path` 传给 MCP，浏览器命令行因此带唯一可执行
路径，可以和客户端进程分开数。

| 时点 | MCP 客户端 | 插件浏览器 |
|---|---|---|
| 干净基线 | 1（仅 grep） | 0 |
| 会话跑通、浏览器已起 | 2 | 12 |
| **该行禁用 25 秒后** | 2 | **12** |
| **该行禁用 55 秒后** | 2 | **12** |
| **宿主 `SIGTERM` 优雅退出后** | 1 | **0** |

两条结论现在都建立在浏览器进程本身上：

- **宿主退出：浏览器真的被回收**（12 → 0）。这是对"真实释放"的正面证据。
- **插件禁用但宿主保持运行：浏览器完全没被关闭**（12 → 12）。服务已销毁
  （`gateway/service-unavailable`）但进程一个没少——这不是释放失败被吞掉，而是这条路径上
  根本没有发生释放。

### 0.4.2：运行关闭时释放已实现，但本轮没测到

`finish_run` 在写入终态之后释放该运行角色的浏览器，并 `await` 关闭完成，关闭失败带角色名
抛出：

```ts
if (existing?.activeRole !== undefined && pool !== undefined) {
  await pool.releaseRole(existing.activeRole)
}
```

实测结果是**没有测到释放**。浏览器 12 → 11、客户端仍是 2，只有一个渲染进程消失，不构成
释放。原因是这次运行没走到那一步：

```
run-1: completed | activeRole: ''
```

模型没有先登录就调 `assume_role`，角色从未核验成功，`existing.activeRole` 为空，释放分支
根本没有执行。浏览器是 `putEnvironment` 预挂的那个，与运行无关。

### 0.4.3：释放句柄本身不足以关闭浏览器

这次让 `assume_role` 真正成功了（`run-1: completed | activeRole: 'buyer'`），释放分支确实
执行了。计数：

| 时点 | MCP 客户端 | 插件浏览器 |
|---|---|---|
| 环境确认后（浏览器尚未起） | 2 | 0 |
| `finish_run` 关闭已核验的运行之后 | 2 | **11** |

`releaseRole` 拿到句柄、`await` 完、没抛错，**浏览器一个都没关**。

所以问题不在我的 disposer 形式，也不在销毁顺序：**`mountSessionMcp` 注册的那个 effect 被
释放时，并不关闭它自己启动的浏览器**。释放句柄是对的，但提供方没有把进程回收挂在上面。
浏览器只在宿主退出时消失（0.4.3 前一条已量到 12 → 0）。

这是第二个硬约束，性质和"单一 browser-use 提供方槽位"相同：公开接口里**没有**强制关闭
这个浏览器的手段。`mountSessionMcp` 自己 spawn 客户端，不把进程句柄交出来；我无法用
`dsh-subprocess` 之类去接管一个不是我启动的进程，也不应该去 kill 一个我没有所有权的 pid。

已排除的解释：不是 `void` 丢 promise（0.4.1 改过）；不是服务没销毁（`service-unavailable`
已证明销毁了）；不是 async disposer 没被等（句柄被 await 且没抛）；不是标记量错对象
（这次量的是 `--executable-path` 指定的浏览器本体）。

### 0.4.4：读到了关闭路径的确切代码位置

`mountSessionMcp`（`@deepseek-ai/dsh-experimental-browser-use-runtime/lib/types/mcp.js`）
里的结构是：

```js
ctx.effect(function* () {
  yield ctx.browserUse.register(...)
  resources = new SessionResources(ctx, { … })
  yield async () => { stopping = true; await resources.dispose(); clients.clear() }
}, `${options.name}.sessions`)

ctx.on('agent/created', async ({ agent, signal }) => {
  const state = { status: resources.available(agent) ? 'ready' : 'blocked' }
  agent.ctx.effect(() => async () => {
    clients.delete(agent)
    await state.mask?.dispose()          // 只释放掩码，不关浏览器
  }, `${options.name}.activation`)
  …
})
```

`SessionResources.dispose()` 会 `await` 每个 `OwnedSessionResource.close()`，所以**确实存在
真正的关闭路径**。但它只挂在 `….sessions` 这个 effect 的 disposer 上，也就是**提供方整体
被销毁**时；每个 Agent 的 disposer 只清 `clients` 和 `state.mask`，**不碰资源**。

这解释了观测到的全部现象：

- 宿主退出 → 提供方 effect 销毁 → `resources.dispose()` → 浏览器关闭（实测 12 → 0）
- 运行结束、取消 → 只涉及 Agent 和运行，**根本到不了** `resources.dispose()`（实测 11 → 11）
- 行禁用 → 理论上应到，但实测 12 → 12；`resources.dispose()` 里的 `close()` 显然没有让
  Chromium 退出（客户端与浏览器都没少）

也就是说：关闭能力**存在但只绑在提供方生命周期上**，而我无法把一个运行或一次角色切换绑定到
它——公开接口里没有"销毁这个提供方但保留宿主"的入口，`browserUse` 的注册又只有单槽。

### 0.4.5：我的包装 effect 并不拥有提供方的 effect

`mountSessionMcp(ctx, options)` 内部调用 `ctx.effect(function* () { … })` 登记 `….sessions`，
**它不返回那个 effect**。而我保存的句柄是外面这一层：

```ts
const mounted = this.ctx.effect(() => {
  mountSessionMcp(this.ctx, { … })   // 内部另建一个 effect
  return () => {}                    // 这个 no-op 才是我 dispose 到的
})
```

所以 `releaseRole` 里的 `await mounted()` 只会执行那个 no-op；真正的 `….sessions` effect 属于
同一个 fiber，只有整个 fiber 销毁时才会被 cordis 释放。这就是"释放被调用、句柄被 await、
没抛错、浏览器一个没关"的机制层面的原因。

要真正拿到它，公开接口没有返回点。可行的替代只有两条：

1. 把 `mountSessionMcp` 挂在一个**我自己创建并能销毁的子 fiber** 上。但那样它的工具就
   进不了已存在的 Agent 的清单（0.3.8 已实测：派生作用域下工具一个都不出现），而角色切换
   恰好发生在 Agent 已存在之后。
2. 不切换角色，一个测试会话从头到尾一个角色、一个提供方、一个浏览器。

第 1 条和角色切换直接冲突，第 2 条等于把"一个会话一个角色"变成硬约束——这正是 0.3.8
已经在做的事，只是当时结论下得不够硬。

综合两轮代码级结论，第六节在本宿主上的实际边界是：

- 浏览器在**宿主退出**时被回收（实测 12 → 0）
- 运行结束、取消、插件禁用、角色资源重建**都关不掉它**
- 因为关闭只发生在提供方 fiber 销毁时，而提供方不能在宿主存活期间被单独销毁

这不是实现取舍，是公开接口的边界。

### 产品决定（shady 已定）：接受边界，改为"授权释放"并如实标注进程限制

就上述边界询问后决定：

- **授权释放照做并且是真实的**：运行终态使其退出 `browserGrantForSession`，该运行核验过的
  角色不能再派发任何业务动作；新运行获得自己的授权，不被旧取消状态卡住
- **进程回收标注为受宿主约束的已知限制**，写进插件 README，附代码级理由与实测数字
- 不再为"运行结束/取消时关掉浏览器"继续消耗轮次，也不把进程存活记为通过

README 已补两节：授权释放与浏览器进程的边界（含 `SIGTERM` 时 12 → 0、取消运行与禁用行均
不变的实测），以及"一个宿主一个 browser-use 提供方、一次会话一个角色"。

### 0.4.6：授权代次绑定（第五节）已实现并有测试

运行记录新增 `generation`，累计该运行被启动/恢复的次数。`assume_role` 成功后铸造一枚
**授权令牌**：

```ts
{ token: randomUUID(), runKey, generation, agentId, role, grantedAtMs }
```

令牌里的 `generation` 是铸造时的代次。`requireAuthority(token, agentId)` 每次都**重读运行**，
按运行自己的状态和当前代次判断，不信任令牌自身的声明：

- 令牌来自别的 Agent → 拒绝
- 令牌所属运行已取消/结束 → 拒绝
- 令牌铸造时的代次 ≠ 运行当前代次 → 拒绝（这就是"旧运行取消后新授权不被旧排队调用借用"）
- 令牌从未签发 → 拒绝
- 新代次重新铸造的令牌 → 有效

这与"这个会话里存在某个 running 的已核验运行"是不同的事：授权绑定到**具体运行 + 代次 +
Agent**，模型无法自证——`runKey` 是模型给的，但令牌是随机不可伪造的，且每次使用都以存储
里的运行记录为准。

新增 5 个测试，全部通过；全量 **107 passed (107)**，类型检查通过。

### 0.5.1：授权已接入守卫，真实宿主上验证生效

`start_run` 每次启动把代次加一，所以恢复后的运行必然拿到新令牌。守卫的规则改成：

- **身份准备窗口内**（`mayPrepareIdentity`）不需令牌——建立角色正是令牌产生的前提
- **窗口外**每一次浏览器调用都必须带 `authority`，否则拒绝

这一条是我写错后改对的：`LOGIN_TOOLS` 几乎涵盖所有浏览器工具，所以按"是不是登录工具"
来判断是错的；真正的分界是准备窗口。

**真实宿主证据**（0.5.1，隔离 `DSH_HOME`）：登录并 `assume_role` 成功后，让模型在 buyer
角色浏览器里按一个键但**不带** `authority`，工具原话：

```
web-test: this action needs the authority web_test_assume_role issued.
Pass it as the "authority" argument; the token stops working when the run is
cancelled or restarted.
```

同一轮还暴露并修掉一处：`assume_role` 的输出 JSON Schema 没声明 `authority`，宿主按
`additionalProperties: false` 拒了整个返回。现在 `authority` 在输出 schema、zod schema 和
`note` 里三处齐备。

新增守卫测试 5 个（无令牌、旧代次、别的 Agent、带令牌放行、准备窗口免令牌），全量
**112 passed (112)**，类型检查通过。

### 0.5.2：接受侧在真实宿主上跑通，闭环首次闭合

0.5.1 修掉输出 schema 之后重测，**带正确令牌的获准业务动作真正执行了**：

```
Run run-1 now acts as buyer; every operation and case result records it.
Present authority "a1c306ec-797c-4c68-8b34-0eeb0efa5ec8" with the actions it allows;
it stops working if this run is cancelled, restarted or resumes.

### Result 2 ### Ran Playwright code
```js await page.evaluate('() => 1+1'); ```
```

同一轮里：模型在 buyer 角色浏览器真实登录站点 → `assume_role` 从站点读回账号、匹配已确认
环境里 buyer 绑定的 `Alice Buyer` → 铸造令牌 → 用该令牌发起一次浏览器动作 → **守卫放行并
真实执行**，结果 `2`。

拒绝侧已在 0.5.1 验证（不带令牌被拒，原话见上）。所以第五节的两侧在真实宿主上都有证据：

| 场景 | 结果 |
|---|---|
| 无令牌的动作 | **拒绝**（0.5.1） |
| 令牌来自别的 Agent | 拒绝（单测） |
| 令牌铸造于更早代次 | 拒绝（单测） |
| 令牌从未签发 | 拒绝（单测） |
| 当前代次的有效令牌 | **放行并执行**（0.5.2） |

### 0.6.0：恢复即新代次

`controlRun` 里凡是把非 running 的运行放回 `running`（`continue` / `resume`）都会让代次加一，
所以暂停前铸造的令牌在恢复后自动失效。暂停本身不需要加代次：非 running 的运行本来就没有
有效授权，`requireAuthority` 先按状态拒绝。

真实宿主上 `start_run` 之后 `getRun` 返回 `generation: 1`，递增确实生效。

新增 2 个测试（恢复使暂停前的令牌失效、同名新运行获得自己的代次），全量
**114 passed (114)**。

### 0.6.1：宿主重启留下的 resuming 运行会永久卡住新运行（已修）

测量"取消 A → 新建 B → 用 A 的旧令牌"时先撞上一个真缺陷。上一轮被 `kill -9` 的宿主把
`run-A` 留在 `resuming`，本轮模型无论用哪个新键启动都被拒：

```
web-test: run run-A is resuming and refuses new test actions. The DSH host
restarted during that run; report what you know through web_test_status …
```

`HELD_RUN_ALLOWED_TOOLS` 里没有 `start_run`，所以**一个被重启打断的运行能把这个会话永久
堵死**——模型再也无法开始任何新工作。这直接违反第五节"新运行获得独立有效授权，不被旧取消
状态永久卡住"。

修法：`start_run` 进入允许列表。被持有的运行保留它自己的授权边界（浏览器调用照样被拒），
而新运行拿自己的代次与授权。对应测试从"拒绝 `start_run`"改写为"拒绝被持有运行自身的动作，
但允许新运行启动"，全量 **114 passed (114)**。

顺带确认了一条**符合预期**的行为：宿主重启打断的运行回到 `resuming` 并拒绝新动作，要求
先 `web_test_status` 上报——这条本身是对的，不改。

### 0.6.1：取消场景测了，但结论不成立

修好卡死缺陷后重测，流程本身走通了：`run-A` 核验成功（`running | activeRole: 'buyer' |
gen: 1`），拿到令牌 `fe3b4bbc-baed-4343-9d39-4d1a92f0e36f`，经 API 取消后 `run-A: cancelled`，
再让模型启动 `run-B` 并连发两次 `browser_evaluate`（第一次指定旧令牌，第二次用新令牌）。

两次都返回 `### Result 2`，包括**本该用已取消令牌的那一次**。

**但这不能算"通过"，也不能算"失败"**：我无法从日志确认模型实际传进去的 `authority` 是什么。
它可能照做了，也可能两次都用了新令牌。日志只记了结果文本，没有记工具调用的参数。

这暴露一个**证据方法的缺口**：此前所有"守卫是否放行/拒绝"的结论都建立在工具返回的文本上，
而那不能证明模型传了什么。要拿到可信证据，需要能读出实际派发参数——下一轮要么在守卫拒绝时
让理由本身带上代次（可区分的文本），要么直接对 `requireAuthority` 做真实派发测试
（用可控的调用而不是让模型自由发挥）。

### 0.6.2：读日志发现——授权根本没被要求过（已修）

上一轮说"日志不记参数"是**我自己没查对**。`tool/call` 事件里就有 `arguments`。读出实际派发的
参数后，结论从"无法判断"变成"确实有问题"：

```
web_test_assume_role runKey='run-A'
web_test_assume_role runKey='run-B'
browser_evaluate   authority=None
browser_evaluate   authority=None
```

**两次浏览器调用都没带 `authority`，却都成功了**——而且此时 `run-B` 已经
`now acts as buyer`（窗口本该已关闭）。

根因在 `mayPrepareIdentity`：它对"本会话 running 且声明了该角色"的运行**一律返回 true**，
不看该角色是否已经核验通过。所以准备窗口从头到尾开着，而"不带令牌"正是准备窗口允许的行为
——**授权要求实际上从未生效过**。

修法：只有当该角色**还不是**已核验的活动角色时窗口才开着。

```ts
if (run.activeRole === role && this.verifiedAccount(run.key, role) !== '') return false
return true
```

角色切换会重新打开窗口（新角色尚未核验），所以切换登录照常可用。

**这推翻了 0.5.2 的结论**：那次"接受侧通过"也是在窗口一直开着的情况下取得的，证明不了令牌
在起作用。同样 0.5.1 的"拒绝侧"也可能是别的原因（那次的浏览器调用模型确实没带令牌，而
窗口开着本该放行——所以那次拒绝的来源需要复核）。授权链路要重新取证。

6 个 `browser-dispatch` 测试按新规则更新（核验后的调用必须带令牌），全量 **114 passed (114)**。

### 0.6.3：授权终于真正生效，两侧都有可核对的证据

0.6.2 修好之后重测。**这次的关键是读 `tool/call` 事件里的 `arguments`**——证据因此可核对，
不再依赖模型"照做"：

```
派发 authority='None'
  结果: Error: web-test: this action needs the authority web_test_assume_role issued.
        Pass it as the "authority" argument; …

派发 authority='e7a8adf5-974c-40c4-a…'
  结果: ### Result 2 ### Ran Playwright code ```js await page.evaluate('() => 1+1'); ```
```

同一次会话、同一轮、连续两次 `browser_evaluate`：

| 派发的 `authority` | 结果 |
|---|---|
| 无 | **拒绝**，理由是缺令牌 |
| `assume_role` 签发的令牌 | **放行并真实执行**，返回值 `2` |

这是第五节第一次有可核对的证据。之前的"接受侧通过"（0.5.2）是在准备窗口一直开着的情况下
取得的，证明不了令牌在起作用；0.6.2 关闭窗口之后才第一次能看到令牌真正把守。

### 0.6.4：取消 A 后旧动作被拒、新运行 B 正常执行（第五节核心命题成立）

用可读派发参数的方法重测，这次两侧都对得上：

步骤：`run-A` 启动 → 浏览器登录 → `assume_role` 核验成功
（`running | role: 'buyer' | gen: 1`）→ 拿到 `TOKEN_A = fa579e72-64ce-4d0c-8d36-0417482ca263`
→ 经 API 取消（`run-A: cancelled`）→ 启动 `run-B` 并核验 → 连发两次 `browser_evaluate`：

```
派发 authority= fa579e72-64ce-4d0c-8d36-
  结果: Error: web-test: authority names run "run-A", which is cancelled;
        only a running run may act

派发 authority= 16c6f632-07a6-47d7-971f-
  结果: ### Result 2 ### Ran Playwright code ```js await page.evaluate('() => 1+1'); ```
```

| 派发的 `authority` | 结果 |
|---|---|
| 已取消运行 `run-A` 的令牌 | **拒绝**，理由点名该运行已取消 |
| 新运行 `run-B` 的令牌 | **放行并真实执行**，返回 `2` |

这正是第五节反复强调的那条：旧运行取消后，新运行产生的新授权**不能**被旧调用借用；而新运行
**不被旧取消状态永久卡住**——它照样能启动、核验、拿到自己的授权并执行。

至此第五节在真实宿主上有的证据：绑定运行+代次+Agent、拒绝无令牌/旧代次/别人的令牌、
恢复即新代次、新运行不被旧状态卡住、取消后旧令牌被拒且新运行正常。

### 0.6.5：重启后必须重新核验身份

先补了一个缺口。硬杀宿主后运行回到 `resuming`，但 **`activeRole` 仍然是 `buyer`**，而且
`verifiedAccount` 还查得到旧账号——恢复之后可以直接再铸一枚令牌，**不用再对着站点核验**。
这违反了"浏览器重建后旧核验不能自动继续有效"：新宿主背后是另一个浏览器，旧核验描述的那个
浏览器已经不存在了。

修法：运行回到 `running` 时清空 `activeRole`。恢复后必须重新对站点核验才能再拿到授权。

真实宿主证据（0.6.3，隔离 `DSH_HOME`，`kill -9` 硬杀）：

| 时点 | run-A |
|---|---|
| 重启前 | `running \| role: 'buyer' \| gen: 1` |
| 硬杀 + 重启后 | `resuming \| role: 'buyer' \| gen: 1` |
| 执行 `resume` 之后 | **`running \| role: '' \| gen: 2`** |

`role` 从 `'buyer'` 变成 `''`、代次从 1 变成 2：旧的核验结论没有跟过去，恢复后的运行必须
重新对着站点核验才能再次获得授权。`resuming` 期间也没有任何浏览器动作可派发。

新增测试：恢复后 `activeRole` 为空、无法再铸令牌、旧令牌一律失效。全量
**115 passed (115)**。

### 0.6.6：重启后的 UNKNOWN 规则（已有强测试），宿主级组合场景未跑成

"重启后 UNKNOWN 操作不自动重提"这条规则在 `store-execution.spec.ts` 的 **restart
reconciliation** 一节已有覆盖，而且断言是完整的：

- 在途操作在存储重开后 `dispatch.kind` 变成 `unknown`
- `reconciliation.unknownOperations` 列出该操作并带原因（`must be reconciled`）
- **恢复运行不会让它变得可再次提交**：对同一 `operationKey` 再 `beginOperation` 被拒，
  理由是 `its outcome is unresolved`
- 已结算的操作在重启后保持不变

这条测试是**真的重开存储**（同一 home 上新建 harness），不是字段自证。

宿主级的组合场景本轮**没跑成**：让模型派发一个不结算的操作再 `kill -9`，运行停在
`blocked` 且没有在途操作，模型没有走到 `begin_operation`。所以"在途操作 + 真实硬杀"这条
组合证据仍缺，规则本身的证据是有的。

## 目标范围当前总账

| 场景 | 状态 |
|---|---|
| 干净安装后预设可用、浏览器能起 | **有证据** |
| 单角色登录、核验、获准动作成功 | **有证据** |
| 授权绑定运行+代次+Agent | **有证据** |
| 拒绝无令牌 / 旧代次 / 他人令牌 | **有证据** |
| 取消 A 后旧令牌被拒、新运行 B 正常 | **有证据** |
| 重启后必须重新核验身份 | **有证据** |
| 重启后运行需显式继续，不自动重跑 | **有证据**（重开存储的测试） |
| UNKNOWN 不自动重提 | **有证据**（重开存储的测试）；宿主级组合未跑成 |
| 暂停/恢复即新代次 | **有证据** |
| 恢复后清空角色 | **有证据** |
| 进程回收：宿主退出 | **有证据**（浏览器 12→0） |
| 进程回收：其余路径 | 记为宿主限制（产品决定） |
| 跨角色协作 | **未验证** |
| 普通 DSH 会话无额外角色工具 | **未验证** |
| 报告与证据可追溯 | **未完成** |

### 0.6.7：普通 DSH 会话会看到角色浏览器工具（缺陷，未修）

第七节场景 10 实测：在同一个 profile 上，**不带** `agentPreset` 创建的普通 DSH 会话，
自报的工具清单里：

```
web_test_ 开头的工具：无（它自己的网页工具是 web_search / web_fetch）
mcp__ 命名空间：['playwright-role-buyer']     ← 这一项是本插件的角色浏览器
```

`web_test_*` 确实没有泄漏，但**角色浏览器的 MCP 工具泄漏到了普通会话**。

原因清楚：提供方在池自己的 ctx 上把服务器登记，而它给的是**每一个** Agent 定义工具，不是
只给 web-test 预设的 Agent。守卫会拒绝这些调用（普通会话点不动它们），但工具**出现在清单
里**本身就是干扰——模型会看到、会在计划里提到、可能反复尝试。

要在公开接口内让它不出现，只剩 0.3.8 已经实测失败的那条路（把挂载放进派生作用域，工具
就完全进不了任何 Agent 的清单）。所以这是一个**已知缺陷**，不是遗漏：本宿主上没有既让
web-test 会话拿到工具、又不让普通会话看到它的办法，除非提供方支持按 Agent 限定。

当前影响面：普通会话的**工具清单**被污染；**实际调用**全部被守卫拒绝（`web-test sessions
may only call web_test_*` 那一类文案与"没有已核验角色"的拒绝），所以不会真的驱动浏览器。
这一点我按事实记，不按"影响很小"记。

**0.4.6 仍不是验收候选。**

"释放"的产品含义我不改。第六节要的是进程回收，把"释放"降格成"不再授权"与要求不等价。

这同时说明一件事：运行关闭时的释放只能释放**运行自己核验过的**角色浏览器；预挂的浏览器
属于环境，不随单个运行释放。这是有意的归属划分，但两条路径都要各自验证。

上一条"宿主退出"有证据与此不冲突：进程随宿主整体退出，不等于插件在运行期释放了它。

仍未验证：两角色 Cookie 不串用的直接证据、跨角色业务协作、取消/恢复、授权代次、真实释放。
`0.3.6` 仍不是验收候选。

### 0.3.5：单角色身份核验闭环成立

此前 `assume_role` 一直读到空账号。三处取值的真实缺陷叠在一起，都不是模型问题：

1. `firstText` 只认 MCP 内容块的**数组**形式，而这个提供方返回 `{ content: [...] }` **对象**，
   于是每次身份读取都得到空串。
2. 探针改回小 JSON 后，解析仍按"裸账号"写——`parseIdentity` 没跟着改（一次替换没匹配上）。
3. 提供方把求值结果渲染成 `### Result "<JSON 字符串>"`，标题与值同行、值再套一层引号。
   严格 `JSON.parse` 整段文本必然失败。

现在按配平大括号截取对象文本，必要时先还原转义引号，再解析。三种形态都能读出账号。

**真实宿主证据**（0.3.5，隔离 `DSH_HOME`，受控站点 8902）：

- 浏览器点击登录按钮：`- Page URL: http://127.0.0.1:8902/login`
- `assume_role` 返回：`Run run-1 now acts as buyer; every operation and case result records it.`
- 同一轮身份页快照：`- Page Title: 当前账号 ... generic: Alice Buyer ... 可创建：true｜可审批：false`
- `getRun` → `run-1: running | activeRole: 'buyer'`

即：浏览器真实登录 → 插件从站点读到账号 → 与已确认环境里 `buyer` 绑定的 `Alice Buyer`
一致 → 角色核验通过并写入运行。这是 `activeRole` 第一次有真实来源，而不是存储字段自证。

仍未验证：A/B 双账号 Cookie 不串用、跨角色业务、取消/恢复、授权代次、资源真实释放。
`0.3.5` 仍不是验收候选。

### 0.3.0：准备窗口内的点击解禁，身份拒绝可追溯

`browser_click` 之前被一刀切排除在准备集之外，结果真实登录走不通——站点登录表单靠按钮提交，
守卫把点击挡了，模型永远无法完成登录。这条排除过严，已解禁，但边界写清楚：点击只在**角色
核验之前**、只在**本运行自己的角色浏览器**上、只在**拥有该角色 running 运行的本会话**里可达；
一旦核验完成就回到和其他动作一样的需要已核验角色的规则。

身份探针现在回一个小 JSON（账号、URL、标题），拒绝信息因此能指名它读到的是哪个页面，
而不是一句"页面没带账号"。

受控站点补上了真实登录表单（未登录时 `/` 显示表单），此前站点只有 POST 端点，模型无从登录。
这是把受控站点做得更像真实站点，不是放宽产品要求。

真实宿主证据（0.3.0）：buyer 角色浏览器登录后，账号页返回
`<div id="account">Alice Buyer</div><pre id="main">可创建：true｜可审批：f…`，
即浏览器确实处在 Alice 的已登录会话里。`activeRole` 仍未写入：这一轮模型的自查查询读的字段
与插件探针不同（站点实际返回 `data-webtest-account="Alice Buyer"`，已用 curl 核对），
需要让模型在同一轮内登录后立即 `assume_role`，再判定插件侧是否合拢。

### 0.2.7：角色浏览器真的跑起来了

提供方在 `ctx.on('agent/created')` 里，于 Agent **创建那一刻**在该 Agent 的 ctx 上定义 MCP 工具，
没有给已存在的 Agent 补建的路径。所以浏览器必须在测试会话的 Agent 出现**之前**挂载。
环境确认正是那个时刻：操作者先确认环境、再建测试会话。`putEnvironment` 现在在写库后为该环境
声明的角色启动浏览器。（`start_run` 里的预取保留，覆盖启动时环境就已就绪的情况。）

真实宿主证据（隔离 `DSH_HOME`、0.2.7、受控站点 8902）：

- 角色浏览器打开页面：`- Page URL: http://127.0.0.1:8902/ - Page Title: 受控验收站点`
- 打开身份页并取到真实快照
- `assume_role` 带着必填的 `accountPage` 真实发出，插件读站点后**正确拒绝**：
  `confirmed role "buyer" as "" ... The page said: the page carried no
  data-webtest-account marker` —— 未登录页面没有被当成身份

另外两处修复：`ensure` 记 `started` 在 `await` 之后，两次并发调用都会各自注册同名提供方，
现在未完成的挂载先记进 `pending`，后来的调用等前一次；守卫文案里过时的 `identityUrl` 改成
`accountPage`。

尚未闭合：模型在本轮没有真正完成登录（试了几个不存在的 URL，均 404），因此
`activeRole` 仍为空。A/B 隔离、跨角色、取消/恢复、授权代次、真实释放均未验证。

### 仍未闭合：角色浏览器工具没进 Agent 清单

真实宿主上，模型从头到尾没有发起过一次 `mcp__playwright-role-<role>__*` 调用。角色浏览器在
`start_run` 里后台启动，而提供方是在 Agent **创建时**把 MCP 工具交给该 Agent 的；本会话的
Agent 早于启动就已存在，所以工具不在它的清单里。这与之前记录的"提供方不接管既有 Agent"是
同一个问题，目前没有绕开它——守卫没有放宽，也没有靠"下一轮再说"蒙混。

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

### 0.6.8：业务动作入口绑定授权，操作记录带上代次

原来只有**浏览器调用**要令牌，`web_test_begin_operation`——也就是"我准备改动业务数据"这个
动作本身——不需要。报告因此也分不清同一运行在两次不同代次里的两次尝试。

改动：

- `begin_operation` 的参数新增**必填** `authority`，执行时 `requireAuthority` 校验，
  并用令牌里的角色而不是模型自报的 `role`
- `operationRecordSchema` 新增 `generation`，写入派发时的运行代次
- 工具的 JSON Schema 与 zod schema 同步声明

这样一条业务记录同时带着：运行、角色、**代次**、请求摘要、派发状态。跨重启的两次尝试在
报告里可区分，而不是看起来像同一次被重复提交。

全量 **115 passed (115)**，类型检查通过。

仍未验证：报告渲染与 Remote 描述是否与操作输出一致（第七节场景 12）、跨角色协作、
浏览器断连期间的归属。普通会话工具泄漏仍是已知缺陷。

### 0.6.9：报告三个面一致带上角色与代次

第七节场景 12 要求"工具输出、render、Remote 描述及最终报告保持一致"。检查报告时发现
**未确认操作的行只写了意图和派发状态，没有角色和代次**——同一个 `operationKey` 在一次运行
的两代里各出现一次时，报告分不清是哪一次尝试。

三面现在都带上，并且是同一份数据渲染出来的：

- Markdown：`- \`op-1\` create order #7（角色 admin 第 2 代） — unknown：…`
- HTML：同样一段
- JSON：`unresolvedOperations[]` 增加 `role` 与 `generation` 字段

`ReportJson` 的类型声明同步更新。测试 `carries an unknown operation into all three
forms, with its reason` 扩展为同时断言 Markdown 与 HTML 都含"角色 admin 第 2 代"，
这正是场景 12 要防的那个不一致。

全量 **115 passed (115)**，类型检查通过。

仍未验证：Remote 描述与工具输出一致性（需要一次真实调用比对）、跨角色协作、
浏览器断连期间的归属。普通会话工具泄漏仍是已知缺陷。

### 0.6.10：`begin_operation` 的输出没带令牌，把上一轮的功能打断了

上一轮给 `begin_operation` 加了必填 `authority`，**输入**侧正确，但没有把这个令牌放进返回值，
而输出 schema 的 `required` 里有 `authority`。真实宿主上直接报：

```
Error: tool "web_test_begin_operation" returned invalid output:
       missing required property "value.authority"
```

业务动作路径因此完全不可用。单元测试没抓到——测试不校验工具的输出 schema。

修法：`execute` 返回 `authority: input.authority`，角色取 `requireAuthority` 返回的
`AuthorityToken.role`（不是模型自报的 `role`）。

**这一轮我走了一段弯路，要记下来**：我先是用 `git checkout` 回退了那次没提交的本轮改动，
之后用一个临时脚本批量给"缺 authority 的 properties"插入字段，脚本按缩进匹配，在嵌套的
`output.schema` 里插错了位置，TS 报重复属性，我又按内容删了 5 处——**其中包含原本正确的字段**。
最后发现 HEAD 本身是自洽的，整批插入和删除都该撤销。

教训两条：

1. **工具的输出 schema 不由单元测试覆盖**，只有宿主加载预设时才发现。改工具返回字段必须
   重新 `session/create` 验证预设能加载。
2. **批量文本改 schema 很危险**。改完要用大括号配平逐块核对 `required ⊆ properties`，不能靠
   固定窗口的字符数去截 properties 块——我因此连续三次得出"字段缺失"的错误结论。

另外：`rm -rf lib/` 会连 typert 产物一起删掉，必须重跑 `scripts/generate-typert.mjs`，
否则宿主报 `exports "./typert" but importing ... failed`，而且报错和真正原因看起来无关。

### 0.6.11：业务动作路径修复后可用

0.6.5 修复后重测，`begin_operation` 走通：

```
Operation op-1 of run run-1 is dispatching. Perform the change now, observe the
result independently, then call web_test_settle_operation.
```

操作记录落库，带角色与代次（`role: 'buyer'`、`gen: 1`）。同一次会话里更早的一次浏览器
调用被正确拒绝：

```
web-test: this session has no run that may drive a browser. A run needs to be
running and to have called web_test_assume_role …
```

构建顺序也要记下来：**tsc → tsdown → generate-typert → pack**。我先 `rm -rf lib` 再
tsdown，tsdown 依赖 tsc 写出的 `lib/types/`，于是报
`Cannot resolve entry module lib/types/role-browser.js`，宿主侧只显示
`web-test: failed to import` 和预设 `never started`——两个都不指向真正原因。以后不要在
同一轮里既删 `lib/` 又跳过 tsc。

### 0.6.12：跨角色协作在本宿主上被单提供方槽位挡住（实测）

第七节场景 3/4 要求 A/B 两个角色各自登录、Cookie 不串、A 建单 B 处理。实测路径：

会话 1 跑 buyer：`run-A` 核验成功（`acts as buyer`，令牌
`ccf1054b-…`）→ `finish_run` 关闭为 `completed`。

会话 2 跑 seller：直接失败——

```
Error: browser use provider "playwright-role-buyer" is already registered
```

这与 0.3.x 记录的硬约束一致，且现在是在"运行已正常关闭"之后仍然成立：**运行关闭并不释放
提供方**。`releaseRole` 只能处置我自己包的那层 effect（0.4.x 的结论），`mountSessionMcp`
在它自己 ctx 上登记的 effect 拿不到句柄。

因此在**一个宿主进程内**只能存在一个角色浏览器，跨角色协作必须跨进程。宿主重启后能拿到
新的槽位，但本轮第二次尝试没有走完：旧 `resuming` 运行先堵住了浏览器动作（见下条修复），
修复后模型只调了 `start_run` 和 `status` 就停了，两次 prompt 都没有推进到登录。这一条
**未测成**，不记为通过。

### 0.6.13：被持有的运行只在它是会话唯一运行时才挡路

`holdForSession` 原来是无条件的：`resuming` 的旧运行会挡住该会话**所有**浏览器动作，
包括新运行刚启动后自己的登录。实测里 run-S 已经是 `running`，浏览器动作仍被

```
web-test: run run-B is resuming and refuses new test actions.
```

拦住。这和 0.6.1 修的 `start_run` 是同一类问题，只是发生在浏览器动作上。

修法：被持有的运行**仅在它是该会话唯一运行时**挡路；一旦有别的运行处于 `running`，
被持有运行的边界仍由 `requireAuthority`（按状态拒绝）和准备窗口（要求 running 的运行）
把守。0.6.1 的"报告类工具仍可达"与"暂停的运行不能被无视"两条性质都保留——单元测试
（`withholds the browser while a run is paused, and restores it on resume`）正是单运行
场景，因此仍通过。全量 **115 passed (115)**。

### 0.6.14：在全新隔离 home 上重测跨进程交接，未走通

新建 `/home/weetion/dshiso3`（`--from-default-profile web`），启用插件的 patch 行后，buyer
那一轮**没有派发任何工具调用**——会话日志里只有 `turn/start`、`user/message`、
`assistant/attempt`，没有 `tool/call`，`run-A` 根本没建立。模型直接用文字回答了。

所以跨进程交接这条**仍未验证**。已验证的只有结构性事实：同一进程内第二个角色一定被
`browser use provider "… " is already registered` 拒绝（0.6.12）。

顺带记两条环境操作：

1. `cordis.patch.yml` 的格式是**顶层 YAML 数组**，不是 `plugins:` 键。我按后者追加，宿主报
   `failed to parse overlay … YAMLException`，而且会话创建返回空响应、看起来像宿主挂了。
2. `dsh <name> --from-default-profile web --port N --no-open` 会**一直阻塞**在前面（它在
   启动服务），要放后台跑，或者建完 profile 再单独启动。

### 0.6.15：跨进程交接——提供方槽位放开了，但会话归属仍不成立

按 shady 定的形态（每次换角色重启宿主）实测，结论分两半。

**成立的一半**：宿主重启后槽位确实空了。第二个角色 `playwright-role-seller` **注册成功**，
不再报 `already registered`。也就是说"一个进程一个角色"这个约束按预期跨进程解开了。

**不成立的一半**：`assume_role` 里的身份读取走嵌套派发时失败：

```
Error: web-test: role "seller"'s browser failed
       mcp__playwright-role-seller__browser_navigate: playwright-role-seller:
       browser tool belongs to another Session
```

这与 0.3.8 记录的一致：提供方在 `agent/created` 时把资源绑定给**那一个** Agent，而工具
是对 profile 下**所有** Agent 定义的。新宿主进程里，seller 的提供方是随"插件装载"建立
的，而不是随"这个会话要用它"建立的，所以嵌套读取找不到自己的会话。

要让 seller 正常走完，需要该角色浏览器在**这个会话的 Agent 创建时**就建立。本宿主提供的
公开接口里，`mountSessionMcp` 不接受"绑定到哪个 Agent"，而派生作用域（0.3.8 试过）会让
工具完全进不了任何 Agent 的清单。两条路都试过。

所以跨进程交接目前是：**槽位能放开，但身份核验过不去**。跨角色在当前宿主上**没有可用的
公开接口路径**。这一项按未完成记录，不按通过记录。

## prompt 形态对实测的影响（影响所有前面几轮）

长 prompt（"依次做 1…2…3…4…"）会让模型**只叙述不派发**：会话日志里有
`turn/start`、`user/message`、`assistant/attempt`，没有任何 `tool/call`，运行根本没建立。
改成**一句一个动作**的短 prompt 后立刻派发并成功（`run-A: running | role: 'buyer'`）。

0.6.14 那轮"跨进程交接未走通"的原因是 prompt 形态，不是功能。0.6.12 那轮 seller 被
`already registered` 拒绝是真实的槽位约束，两者不要混为一谈。

### 0.6.16：把挂载推迟到 `agent/created`——试过，不成立，已回退

跨角色缺的那一环是"提供方绑定到哪个 Agent"。宿主公开了 `agent/created`
（`dsh-agent/lib/types/runtime-types.d.ts`，payload 带 `agent`），所以试了这条路：环境
装载时只记下角色名，等第一个 `agent/created` 到来再挂载提供方。

真实宿主上**仍然是同一个错误**：

```
Error: web-test: role "buyer"'s browser failed
       mcp__playwright-role-buyer__browser_navigate: playwright-role-buyer:
       browser tool belongs to another Session
```

单角色路径也因此没跑通（`run-A: running | role: ''`）。

推断的机制（未进一步确证）：`agent/created` 是**所有** Agent 都会触发的事件，插件的
挂载可能赶在 web-test 会话之前就绑到了别的 Agent 上；而 `mountSessionMcp` 接受的是
`ctx` 而不是"绑定给谁"，所以即使用事件也控制不了归属。

**已回退**到提交状态（0.6.7 的行为，即环境装载时挂载），因为那一条是实测走通的。这轮
的代码改动没有留在分支上。

结论不变：跨角色在当前宿主的公开接口上**没有可用路径**。已试过的三条：
1. 环境装载时挂载 → 单角色可用，跨进程交接时 `belongs to another Session`
2. `agent/created` 时挂载 → 同样 `belongs to another Session`
3. 派生作用域挂载（0.3.8）→ 工具完全进不了任何 Agent 的清单

### 0.6.17：干净环境安装检查通过，并确认了一个装配顺序约束

在**开发检出目录之外**新建 `/home/weetion/dshclean`，用插件管理器安装 tarball：

```
dsh plugin --profile iso2 add .../dsh-plugin-web-test-0.6.7.tgz
```

依赖检查（安装后的 `package.json`）：

- 全部是发布版本号：`@deepseek-ai/dsh-browser-use@0.2.0-rc.2`、
  `…experimental-browser-use-playwright-mcp@0.2.0-rc.2`、`…-runtime@0.2.0-rc.2`、
  `…storage-sqlite@0.2.0-rc.2`、`@playwright/mcp@0.0.80`、`zod@^4.4.3`
- **无** `workspace:` 或 `file:` 依赖
- 宿主导入错误数：**0**，`session/create` 用 `web-test` 预设成功

干净环境完整闭环：`run-D: running | role: 'buyer' | gen: 1`。

**中间踩到的两件事，都要写进交付说明：**

1. **干净 home 没有凭证**。第一轮四次 prompt 全部零 `tool/call`，看起来像插件坏了。日志里
   实际是 `MISSING_CREDENTIAL: llm-deepseek: no API key for provider route`——模型请求
   根本没发出去。把 `.credentials.yaml`（`-rw-------`，只在本机、未提交）复制过去之后
   才正常。**"模型不派发工具"有两种完全不同的原因，排查时先看日志里的 `code`。**

2. **装配顺序是硬约束**：`putEnvironment`（装载环境、挂载角色浏览器）**必须在
   `session/create` 之前**。反过来做，浏览器挂到了一个已经存在的 Agent 上，
   `assume_role` 立刻失败：

   ```
   web-test: role "buyer"'s browser failed
   mcp__playwright-role-buyer__browser_navigate: playwright-role-buyer:
   browser tool belongs to another Session
   ```

   这与 0.6.15/0.6.16 的跨角色失败是**同一个机制**：提供方绑定的是"挂载那一刻存在的
   Agent"。之前所有单角色实测之所以成功，都是因为环境先于会话装载。Windows 复验时
   顺序错了会看到同样的错误，交付说明里必须写明。

### 0.6.18：浏览器断连期间的归属——通过

`run-E` 核验成功（`running | role: 'buyer' | gen: 1`），此时插件的浏览器是
`~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`，**12 个进程**。用这个可执行
路径精确定位并 `kill -9`，**12 → 3**；同时用户自己的 `/opt/google/chrome/chrome`
**保持 23 个不变**——只处理插件自己的资源。

断连后：

- 立刻再调 `assume_role`：被拒，理由是

  ```
  web-test: run "run-E" confirmed role "buyer" as "", but that role is bound to
  "Alice Buyer" in environment "acc-d1"; sign that account in before switching.
  ```

  身份读取读到空账号，**核验不通过**——不是"沿用旧结论"。

- 浏览器恢复后同一调用：核验通过，签发新令牌 `17f542a6-…`。

- 不带令牌的业务调用：拒绝（`this action needs the authority …`）。

所以断连不会让旧核验继续有效，也不会让归属错位：断连期间核验失败，恢复后重新核验才拿到
新授权。第七节场景 8 的"断连不破坏资源归属"这一半，现在有证据了。

**顺带记一条定位纪律**：隔离环境浏览器的可用标记是
`~/.cache/ms-playwright/chromium-1243/...` 这个**可执行路径**。我先用
`playwright-mcp-profile` 这个 user-data-dir 名字去数，得到 3——那是 grep 自身加噪声，
差点据此以为浏览器早就死了。计数必须用可执行路径，并且用 `grep -v grep | wc -l` 复核。

### 0.6.19：禁用插件行——派发确实停止，进程不退出

0.4.x 记的"禁用行后浏览器不变"当时是用 MCP 客户端标记数的，不是浏览器。这次用可执行路径
重测，把两半分开确认。

**派发停止：确认成立。** 把 `web-test-role-browsers` 行改成 `disabled: true` 之后，插件
的 API 立刻不可用：

```
gateway/service-unavailable: typert gateway: webTest/getRun: …
```

所以禁用行确实让服务下线，新派发被拦住——这一半是达的。

**进程不退出：仍然成立。** 禁用前后插件的浏览器都是
`~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` **3 个进程**，宿主
（`dsh iso2`）也仍在运行。也就是说**服务没了，浏览器还在**。

原因和 0.4.x 一致：池的 disposer 是 `ctx.effect(() => async () => { await this.releaseAll() })`，
而 `releaseRole` 处置的只是我自己包的那层 effect；`mountSessionMcp` 登记在**它自己 ctx**
上的 effect 拿不到句柄，服务被移除时那个 ctx 不随之销毁，浏览器因此留下。

这是宿主能力限制，按 shady 已定的产品决定记录：**授权释放是真的（派发被拦、令牌被拒），
进程回收只在宿主退出时成立（12 → 0）**。不把"释放"弱化成"不再授权"，也不在浏览器没关之前
报告已关闭。

### 0.6.20：把浏览器行移进 preset —— 半步成功，全案不成立，已回退

这一轮读到一条之前漏掉的事实：池**根本没有调用**宿主的 `tools.restrict`。插件头注释里
写着用它做角色隔离，实际隔离全在 `guardReason` 的派发路径上。这说明"用宿主机制隐藏工具"
这条路我此前没走。

于是试了正确的做法：把 `web-test-role-browsers` 从顶层 loader 行**移进 `web-test-preset`
的 `plugins:`**。依据是 preset 行的注释本来就写着浏览器行本该在里面，而实测它在外面——
注释和实现不一致，这是个真缺陷。

**半步成功**：普通会话的 `mcp__` 命名空间**一个都没有了**，泄漏消失。

**但整案不成立**。宿主立刻报：

```
Preset services require isolate realms: webTestRoleBrowsers
```

查 `dsh-agent-preset-registry/lib/types/mount.js` 的 `leakedServices()`：preset 里的服务
如果**在根作用域也存在同名实例**，就算泄漏。所以池必须只存在于 preset 里。

于是把 `webTestRoleBrowsers` 从 `index.ts` 的 `static inject` 移除、`putEnvironment`
不再触碰池、池改为在构造时读 `latestEnvironment()` 自己挂载角色，并给池补上
`webTestStore` 的 inject 声明。中间确实推进了一步（错误从"泄漏"变成
`cannot get property "webTestStore" without inject`），但补完 inject 之后**泄漏又回来了**：
`webTestStore` 本身是根作用域的行，池声明依赖它就会在根被拉起。

**结论**：在这个宿主上，"浏览器只在预设里"与"池需要读存储"两个要求互相冲突——除非存储
也能在预设作用域内提供，那是更大的组合改动，超出本轮范围。

**已回退到 0.6.7**（实测走通的状态），代码改动没有留在分支上。

**这轮最有价值的产出是那条线索**：`tools.restrict` 是 `dsh-tools` 的公开方法
（`restrict(filter): () => void`），作用是"限制**调用方作用域**的全局工具"，而角色浏览器
工具正是全局注册的。**如果能让普通会话的作用域调用一次 deny 掩码，泄漏就能在不动组合的
前提下解决。**这是下一步该查的方向，不是本轮能收口的。

### 0.6.21：`tools.restrict` 这条线索收口——不成立

上一轮留的线索是"让普通会话的作用域应用一次 deny 掩码"。读了契约，不成立。

```ts
export interface ToolRestriction {
  /** Global tool names that stay visible; everything else is removed. */
  readonly allow?: readonly string[]
  /** Global tool names removed from visibility. */
  readonly deny?: readonly string[]
}
```

只有作用域级的 `allow` / `deny`，**没有任何按 Agent 选择的字段**；`restrict` 的文档写明
"Restrict global tools for the calling agent scope"，也就是**调用方所在的作用域**。

要只在普通会话里隐藏，就必须有一段代码运行在**每个会话自己的作用域**里调用 `restrict`。
插件的 loader 行都是宿主级的，池的 ctx 是根，所以它调用的结果是根级的 deny——那会把
web-test 会话的工具也一起删掉。

也就是说这条路要么无效（根级 deny 伤到预设），要么需要宿主提供"每会话作用域的插件行"，
那是组合层的改动。**线索到此为止，不再重复推导。**

普通会话工具泄漏因此仍是**未闭缺陷**，成因和可修性现在写清楚了：

- 现状：普通会话的工具清单里出现 `mcp__playwright-role-*`；守卫拒绝一切实际调用
- 成因：提供方对所有 Agent 定义该服务器的工具，而工具只能在 Agent 创建时加入
- 试过且失败：把浏览器行移进 preset（0.6.20，泄漏消失但宿主拒绝加载）
- 试过且不成立：宿主 `tools.restrict`（本节）
- 需要的宿主能力：提供方支持按 Agent 限定，或组合层支持每会话作用域的服务行

### 0.6.22：同名角色跨环境不共用身份——补上测试覆盖

第五节要求"不同项目/环境中相同的角色名称不能意外共用身份"。实现上 `expectedAccount` 是
**按运行自己的 `environmentRevisionKey`** 取绑定的，规则是对的，但**没有测试锁住它**——
`accountRef` 在整个测试目录里只出现在 seed 夹具中，没有任何断言。

补了一条：两个运行指向两个已确认环境，环境都声明 `buyer` 但 `accountRef` 分别是
`Alice Buyer` 与 `Bob Seller`，断言 `expectedAccount` 各返回自己的账号。

seed 夹具的 `environment()` 增加了可选的 `accounts` 参数，用来给每个角色单独指定
`accountRef`（默认仍是 `ref:<name>`）。全量 **116 passed (116)**，类型检查通过。

**过程记一笔**：我第一次用"截掉文件尾部再追加"的方式加测试，把末尾的 `identity()` 辅助
函数和 5 个测试一起吞掉了，测试数从 115 掉到 110 才被发现。改成"定位 describe 块的
结尾行、在它之前插入"，结构就不会被破坏。**测试数突然变少要先怀疑文件结构，而不是以为
收集有问题。**

### 0.6.23：泄漏的根因在提供方的公开契约里写着一行字

查 `dsh-experimental-browser-use-playwright-mcp` 的公开类型声明，找到决定性的一句：

```
/**
 * Expose Playwright's upstream tools in each live Session's scope.
 * …
 */
export declare function apply(ctx: Context, config: Config): void
```

以及 `mountSessionMcp` 的：

```
/**
 * Await one MCP client during each future Agent's creation.
 * …
 */
export declare function mountSessionMcp(ctx: Context, options: SessionMcpOptions): void
```

**"in each live Session's scope" / "during each future Agent's creation"**——提供方的设计就是
把它上游的工具加进**每一个此后创建的 Agent**。这不是我的实现选择，也不是配置项：
`BrowserMcpConfig` 只有启动/附着两种形态（`executablePath` / `headless` / 超时），
`SessionMcpOptions` 有 `name`、`exclusive`、`command`、`args`、`env`、超时，
**没有任何按 Agent 或按作用域限定的开关**。

对照之下，插件自己的 `web_test_*` 工具不泄漏，正因为它们用 `tools.register` 注册在
**调用方作用域**（预设的 agent 行）里，而作用域内的注册不会进入别的会话。
**差别就在这里，而且是有意的设计。**

所以第七节场景 10 的结论可以定死了：**不是插件的缺陷，是提供方契约的必然结果**。要改变它
需要提供方增加按 Agent 限定的选项，或者组合层提供"每会话作用域的服务行"
（那样插件就能像自己的工具那样把浏览器挂进预设作用域，宿主也就会要求它在预设里唯一）。

同一条契约也解释了跨角色失败：资源绑定在 `agent/created` 那一刻的 Agent 上，而工具加给
之后所有 Agent——**绑定与暴露不是同一个维度**，公开接口里没有把它们对齐的手段。

### 0.6.24：下一轮该试的那一步（读契约时想到，尚未验证）

重读提供方契约的第一句时注意到一个我此前没抓住的差别：

```
Expose Playwright's upstream tools in each live Session's scope.
```

**"in each live Session's scope"**——暴露的落点是"会话的作用域"，那么决定它落在哪里的，
就是**传给 `mountSessionMcp` 的那个 `ctx`**。池现在传的是宿主级 ctx，所以工具落到了根、
再被带给所有会话；**如果传的是预设的作用域，工具就只落在用预设的会话里**，这正好是
泄漏要的结果。

0.3.8 试过派生作用域并得到"命名空间: []"，但那用的是 `createScope` 造的新作用域，
不是预设自己的作用域——两者不等价，不能据此判定这条路不通。

0.6.20 把浏览器行移进预设后宿主拒绝加载，原因是**池还依赖 `webTestStore`**（根作用域的行），
依赖把它拉回根。这条依赖是可以去掉的：

- 池不再 `inject` `webTestStore`
- 角色名改为**池自己 `Config` 上的一个字段**，由运维在该行上写明（环境本来就是会话之前
  确认的，角色在那时已知）
- 于是池只存在于预设作用域，`putEnvironment` 不再触碰它

这样三条同时成立：池在预设里唯一（不泄漏）、池能拿到要启的角色、池不需要根作用域的存储。
**这是当前信息下最有希望的一步，但本轮没有验证**，留给下一轮，不要当成已成立的结论。

注意它会失去一个性质：环境修订在会话存续期间换了角色，池不会自动跟着换。要么把这个限制
写进文档，要么之后再把"运行开始时确认角色"这条路补回来（那条在有作用域隔离后可能可行）。

### 0.6.25：解法的前置条件已确认——`ctx.get` 是查询，不会把服务拉进本作用域

`@deepseek-ai/cordis` 的 `lib/types/reflect.d.ts` 里：

```ts
get(name: string, strict?: boolean): any
_getImpl(name: string, strict?: boolean): Impl | undefined
```

这是**查询**语义，和 `ctx.<name>` 的属性访问不同：属性访问需要服务在本作用域的 inject 声明，
拿不到就报错（0.6.20 里的 `cannot get property "webTestStore" without inject`）；
`ctx.get` 则按名字查现有实例。

所以 0.6.24 那条路的前置条件成立：**池不声明 `static inject: ['webTestStore']`，改用
`this.ctx.get('webTestStore')`**，就不会因为依赖把池拉到根作用域，`leakedServices()` 也就
不会判定泄漏。三条要求可以同时成立：

1. 池只存在于预设（不声明存储依赖，改用 `ctx.get`）
2. 池在构造时用 `ctx.get('webTestStore')?.latestEnvironment()` 读到要启的角色
3. `mountSessionMcp(this.ctx, …)` 里的 `this.ctx` 就是预设作用域，工具只落在用预设的会话

**未验证**：0.6.20 已经证明"行移进预设 ⇒ 普通会话的 `mcp__` 命名空间清空"，所以第 3 条
的效果是实测过的；缺的是第 1、2 条能否让宿主不再报
`Preset services require isolate realms: webTestRoleBrowsers`。

注意 `_getImpl` 返回的是 `Impl | undefined` 而 `get` 返回 `any`；用 `get` 就要自己处理
`undefined`，不能用类型断言把它变成非空——本仓库禁止 `as unknown` 类的断言来绕过类型。

### 0.6.26：0.6.24 那条路实施了一轮——不成立，已回退

按 0.6.24/0.6.25 实施：浏览器行移进预设、根行不再 `inject` 池也不在 `putEnvironment`
触碰它、池在构造时用 `this.ctx.get('webTestStore')` 读已确认环境并自启第一个角色、
存储加回 `latestEnvironment()`。类型检查通过，**116 测试通过**。

**推进了一步**：错误不再是 `isolate realms`，而是

```
web-test-role-browsers (dsh-plugin-web-test/role-browser):
  this.store(...)?.latestEnvironment is not a function
```

说明 `ctx.get` 确实取到了存储、**且宿主当时没有判定泄漏**——0.6.25 关于 `ctx.get` 是查询
而不拉起服务的判断，在这一层是成立的。

**但补上 `latestEnvironment` 之后，泄漏又回来了**：

```
Preset services require isolate realms: webTestRoleBrowsers
```

也就是说 `leakedServices()` 判定的不只是"根作用域有同名实例"，**池一旦真正被使用到存储**，
某种解析路径就会让它同时出现在根。两次观察合起来说明：这条宿主约束比"声明依赖"更严格，
我目前的公开接口手段无法满足。

**已回退到 0.6.7**（实测走通），本轮代码没有留在分支上。工作树干净，116 测试通过。

**这一轮真正的收获是把边界缩小了**：

- 0.6.20：错误在 `leakedServices`，池连构造都没走到
- 0.6.26：池构造成功、用 `ctx.get` 取到存储，宿主当时没报泄漏
- 补上缺失方法后再报泄漏

所以限制**不是**"预设内不能声明依赖"，而是"**预设内的服务不能真正使用根作用域的服务**"。
这比之前的记录更接近根因，也说明单靠插件侧的组合调整大概无法绕过——需要宿主侧让预设
作用域能安全引用根服务（或者提供方按 Agent 限定工具）。**记录到此为止，不再重复实施。**

### 0.6.27：再收窄一步——泄漏是"挂载那一刻"产生的，不是组合造成的

对比 0.6.26 的两次运行，差别只有一个：**`latestEnvironment()` 存不存在**。

| 运行 | 池构造 | 读取角色 | 挂载浏览器 | 宿主判定 |
|---|---|---|---|---|
| 端口 4550 | 成功，`ctx.get` 取到存储 | 调用时抛"方法不存在"，**没有拿到角色** | **没有发生** | **没有报泄漏** |
| 端口 4560 | 成功 | 成功返回 `buyer` | **发生了** | **报 `isolate realms`** |

也就是说：**池在预设作用域里构造、查询存储都不触发泄漏；一旦真正调用
`mountSessionMcp` 挂载浏览器，宿主就判定它同时存在于根。**

所以真正的机制不是"预设服务不能声明或使用根服务"（0.6.26 的记录偏保守），而是
**提供方在挂载 MCP 会话时把服务注册到了根作用域**——与插件的组合方式、inject 声明、
`ctx.get` 还是属性访问都无关。

这与 0.6.23 读到的提供方契约是一致的：`mountSessionMcp` 走的是"provider context
supplying browser use, Agents, tools"，它在**自己那套作用域**上登记 `….sessions` effect
（0.4.x 已确认那个 effect 不返回句柄），而提供方的这套作用域解析到根。

**结论**：插件侧任何组合调整都不可能让浏览器"只在预设里"——泄漏由提供方的挂载路径
决定。可行的只有两条宿主侧变更：

1. 提供方支持把 MCP 会话挂到指定作用域（而不是解析到根）
2. `leakedServices()` 区分"提供方在挂载时解析到根"与"插件把服务显式挂在根"

**到��为止，两条路都试过了，不再重复实施。** 跨角色失败同理：它需要的是"资源绑定到
本会话的 Agent"，而提供方把绑定和暴露放在两个不同维度上，公开接口没有对齐手段。

### 0.6.28：0.6.27 那条推断的证据强度要说清楚

0.6.27 由两次运行的差异推出"泄漏发生在 `mountSessionMcp` 挂载那一刻"。**那个对照不干净**，
下一轮不要直接采信：

- 两次是**两次独立的构建与安装**，`latestEnvironment` 加进存储类之后，插件的打包分块和
  加载顺序都可能变化，而"没有泄漏"那一侧是 `latestEnvironment()` **抛异常**时被观察到的。
  也就是说未泄漏的那次观察点，**池的构造其实并没有正常走完**。
- 更关键：宿主是否报泄漏是在预设**挂载完成时**检查的，而 `ensure()` 的挂载是构造里的
  异步调用。哪一次检查跑在挂载之前、哪一次跑在之后，没有控制。

**能确定的部分**：池在预设作用域构造并通过 `ctx.get` 读到根作用域的存储，**宿主没有因为
"声明或访问根服务"而报泄漏**——这一点两次观察一致。
**不能确定的部分**：泄漏究竟由挂载触发，还是由打包/时序差异造成。

要把它变成结论，需要一次受控实验：同一份构建、同一套安装，只改一个变量（挂载前 vs 挂载后
触发检查），并捕获宿主判定泄漏的确切时刻。**这属于下一轮的事，本轮不写进结论。**

在受控实验之前，可信的说法仍然是 0.6.23 那条：提供方把工具定义给此后创建的每个 Agent，
公开接口没有按 Agent 限定的开关；组合、inject、`ctx.get` 都试过，未改变结果。

### 0.6.29：受控实验做完——0.6.27 的结论是错的

同一份构建、同一套安装（`dsh-plugin-web-test-0.6.8.tgz`），只变一个变量：

| 组 | 变量 | 池是否挂载 | `session/create` 结果 |
|---|---|---|---|
| A（端口 4570） | 会话前**未**确认环境 | **否**（读不到角色，不调 `ensure`） | `Preset services require isolate realms: webTestRoleBrowsers` |
| B（端口 4580） | 会话前**已**确认环境 | 是 | `Preset services require isolate realms: webTestRoleBrowsers` |

**两组结果完全相同，而 A 组根本没有发生挂载。**

所以 **0.6.27 那条"泄漏发生在 `mountSessionMcp` 挂载那一刻"是错的**，0.6.28 对它的质疑是对的。
真实情况是：**只要池在预设里，它就被判定为泄漏，与它有没有被使用无关**。

那么泄漏从哪来？回到 `leakedServices()` 的判据：preset 里的服务如果**在根作用域也存在
同名实例**就算泄漏。池在预设里，而根作用域……**`web-test` 根行的 `apply`/入口在装配时会
把插件声明的服务在根也建一份**——不是因为我 `inject` 了它，而是插件的根入口（`index.ts`）
在根作用域被加载时，其 `static inject` 之外的关联注册路径仍可能建出实例。这一层我这一轮
没有再往下查，**不下结论**。

能确定的收窄：

- 池在预设作用域构造、**不**声明存储 inject、通过 `ctx.get` 读根存储：宿主**仍**判泄漏
- 是否挂载浏览器：**不影响**判定
- 因此"把浏览器行移进预设"这条路线在当前宿主上**不成立**，与池怎么用存储无关

**已回退到 0.6.7。** 两处不通过项的对外结论仍然是 0.6.23 那条（提供方把工具定义给此后
创建的每个 Agent，公开接口没有按 Agent 限定的开关），那条有独立的契约证据，不受本轮影响。

### 0.6.30：受控实验最可能的混淆项已排除

0.6.29 的实验还有��个我该先查的混淆项：**profile 的 `cordis.patch.yml` 里可能残留着
`{ id: web-test-role-browsers, disabled: false }`**（0.6.7 装的时候加的，插件管理器在后续
`plugin add` 时可能重新写回）。如果 A、B 两组都带着这行，那根作用域的池实例就与"是否确认
环境"无关，实验仍然是混淆的。

实测该文件当前内容：

```
[
  { id: web-test-storage-sqlite, disabled: false },
  { id: web-test-store, disabled: false },
  { id: web-test, disabled: false },
  { id: web-test-browser-use, disabled: false },
  { id: web-test-preset, disabled: false }
]
```

**没有 `web-test-role-browsers` 行。** 插件管理器没有把它写回来，它在 0.6.8 包里只出现一次
且在预设内部。

**但 0.6.30 这一节的结论下得太快，这里更正。** 我是在 4570/4580 两次实验**跑完之后**才去查
这个文件的，而且那之前我只在下 0.6.8 之前（端口 4550 那一次）删过这一行；4570/4580 的安装
我只做了 `plugin remove` + 删 `node_modules` + `plugin add`，**没有再删 profile 里的行**。
而 `plugin remove` 是否会连带清掉 profile patch 里的行，我没有验证过。

所以准确的说法是：

- **不能排除** 4570/4580 两组都带着 profile 里的旧行；如果是那样，0.6.29 的对照仍然是混淆的
- 当前文件干净，只能说明**现在**干净，不能证明**当时**干净
- 0.6.29"池在预设里就被判泄漏，与是否使用无关"这条**证据不足**，与 0.6.27 一样需要重做

**正确的重做方式**（留给下一轮，且不要再跳过）：

1. 全新 `DSH_HOME`，`--from-default-profile web`，安装 0.6.8
2. **在启动宿主之前**把 profile patch 读出来并逐行确认没有 `web-test-role-browsers`
3. A 组不调 `putEnvironment` 直接 `session/create`；B 组先 `putEnvironment` 再 `session/create`
4. 每次都重新读一遍 patch 文件确认没被写回

只有第 2 步在**宿主启动前**完成，实验才干净。

**收口**：0.6.7 的交付材料不受影响（116 测试通过、证据表完整），两处不通过的对外结论仍是
0.6.23 那条有独立契约证据的说法。但"泄漏的具体触发条件"目前**没有可靠结论**，不要引用
0.6.27 或 0.6.29 的表述。

### 0.6.31：profile 行这个混淆项，在干净 home 上直接测掉了

用全新的 `DSH_HOME=/home/weetion/dshfresh`，`--from-default-profile web` 建 profile，
读 patch，装 0.6.7，再读 patch：

| 时点 | `profiles/iso3/cordis.patch.yml` |
|---|---|
| 装插件前 | `[]`（只有注释头） |
| `dsh plugin add …0.6.7.tgz` 之后 | `[]` |

**插件管理器不会把 loader 行写进 profile 的 patch 层。** 那些行来自插件包内的
`cordis.patch.yml`，profile 侧要写才会写。

这一条推翻了我在 0.6.30 里的担心方向：不是"管理器把行写了回来"。

对 `dshclean/profiles/iso2` 的补证：我在 4570/4580 两次实验之后、读文件之前，**没有再执行
任何会添加该行的命令**（期间只做了 `session/create` 和 `putEnvironment` 两个 API 调用），
而读到的是干净内容。所以那次实验的 profile 状态大概率也是干净的。

**因此倾向性结论回到 0.6.29**：池在预设里就被判泄漏，与是否使用无关。
但严格说仍缺"实验当时"的直接读取，只能算"倾向"，不算"证明"。

**这一条也说明一件对交付有用的事**：`dshclean` 那个 profile 的 5 行是**我或更早的实验手工
写进去的**，不是管理器写的。Windows 端用插件管理器安装时不会遇到这层，**但如果复验时手工
往 profile patch 里加行，加什么行会直接影响装配结果**——这一条要写进 Windows 复验清单。

### 0.6.32：受控实验重做，这次条件干净——0.6.29 成立

按 0.6.30 写下的方法重做，全新 `DSH_HOME=/home/weetion/dshfresh2`：

1. `dsh iso4 --from-default-profile web` 建 profile
2. 装 `dsh-plugin-web-test-0.6.8.tgz`（浏览器行在预设内）
3. **启动宿主之前**读 `profiles/iso4/cordis.patch.yml` → `[]`
4. 同一个 home 跑两组，只变一个变量

| 组 | 变量 | 池是否挂载 | `session/create` |
|---|---|---|---|
| A（端口 4600） | 未确认环境 | **否** | `Preset services require isolate realms: webTestRoleBrowsers` |
| B（端口 4610） | 先 `putEnvironment` | 是 | 同上 |

A 组跑完后**再读一次** profile patch，仍是 `[]`（运行期没有回写）。
包内 `web-test-role-browsers` 只出现一次，在预设内。

**这一次没有混淆项**：全新 home、启动前读取、单变量、运行后复验。
所以 0.6.29 的结论**成立**：

> **只要池在预设里，宿主就判定它泄漏，与它有没有被使用无关。**

也就是"把浏览器行移进预设"这条路在当前宿主上不成立。0.6.27（挂载触发）和
0.6.30/0.6.31（profile 行回写）两种解释都已被排除。

**仍未回答的**：根作用域那个同名实例从哪来。不是 profile 的行，不是 `inject`，不是使用。
**能确定的是它在池被构造之前就已经存在**（A 组根本没调用 `ensure`），所以它来自插件根入口
加载 `cordis.patch.yml` 时的注册路径——**这一层没有再查，不下结论**。

**已回退到 0.6.7。** 交付材料不受影响；两处不通过的对外结论仍是 0.6.23 那条有独立契约
证据的说法。

### 0.6.33：把 `leakedServices` 的判据读到源码级，下一轮从���里起

0.6.32 之后把 `dsh-agent-preset-registry/lib/types/mount.js` 读完了，判据是确定的：

```js
export function leakedServices(ctx, mount) {
    const store = ctx.reflect.store;
    const rootIsolate = ctx.root[Context.isolate];
    const leaked = [];
    for (const key of Object.getOwnPropertySymbols(store)) {
        const impl = store[key];
        if (impl === undefined) continue;
        if (!withinFiber(impl.fiber, mount)) continue;
        if (rootIsolate[impl.name] === key) leaked.push(impl.name);
    }
    return leaked.sort((left, right) => left.localeCompare(right));
}
```

调用处：

```js
await tree.root.update(prepareProfileEntries(ctx, plugins, ctx.baseUrl));
const audit = await auditRows(tree);
const leaked = leakedServices(ctx, ctx.fiber);
```

所以一个服务被判泄漏，**必须同时满足三条**：

1. `mount` 是**预设服务自己的 fiber**（`ctx.fiber`），不是预设的 `tree.root`
2. `withinFiber(impl.fiber, mount)` 为真——即该服务在预设服务 fiber 之内
3. **`ctx.root[Context.isolate]` 里这个名字指向同一个 symbol**

第 3 条是关键：`ctx.root` 是**宿主根**的 isolate 表。所以问题不是"池在不在预设里"，而是
**宿主根的 isolate 表里也有 `webTestRoleBrowsers` 这一项，且指向同一个 symbol**。

这也解释了 0.6.7 为什么能用：那时池在顶层，**不在预设服务 fiber 内**，`withinFiber` 为假，
循环根本不会看它，泄漏检查对它不适用。

**剩下的问题因此可以精确表述**：谁在宿主根注册了 `webTestRoleBrowsers`。
已排除的候选：profile patch 的行（0.6.31/0.6.32 实测）、`index.ts` 的 `static inject`
（0.6.8 已移除仍泄漏）、是否真的使用（0.6.32 A 组未使用仍泄漏）。
**未排除的候选**：`agent.ts` 自己也 `inject` 了 `webTestRoleBrowsers`
（`export const inject = ['tools', 'webTestStore', 'webTestRoleBrowsers']`），
而 `agent` 是包的独立入口（`./agent` 导出），需要确认它在根是否也被装载过。

**这是下一轮第一件该查的事**，且是可以在不跑宿主的情况下静态确认的。

### 0.6.34：行顺序假设也排除了

0.6.33 剩的未排除候选是"挂载顺序"：`web-test-agent` 的 `inject` 含 `webTestRoleBrowsers`，
而池排在它之后，于是 agent 先挂载时池还不存在，解析可能落到根。**把池移到 `web-test-agent`
之前**再测（同一套改动：根行不注入池、`putEnvironment` 不触碰池、池用 `ctx.get` 读存储并在
构造时自启角色）。

条件与 0.6.32 相同且干净：全新 `DSH_HOME=/home/weetion/dshfresh3`，`--from-default-profile web`
建 profile，装 0.6.8，**启动前**读 patch 得 `[]`。

结果：

```
A 组(池在 agent 之前) → 失败: Preset services require isolate realms: webTestRoleBrowsers
```

**顺序假设排除。** 现在已排除的候选清单：

| 候选 | 结论 |
|---|---|
| profile patch 里有多余的行 | 排除（0.6.31/0.6.32 实测 patch 为 `[]`） |
| 根入口 `index.ts` 的 `static inject` | 排除（0.6.8 移除后仍泄漏） |
| 是否真的使用了池 | 排除（A 组从未调用 `ensure` 仍泄漏） |
| 预设内两行的挂载顺序 | 排除（0.6.34 调换后仍泄漏） |
| 池通过 `ctx.get` 访问根存储 | 排除（0.6.26 到得了存储，宿主当时未报泄漏） |

剩下的只有 0.6.33 定位的那个问题本身：**`ctx.root[Context.isolate]` 里为什么会有
`webTestRoleBrowsers`，而且指向与预设内同一个 symbol。** 这一层是宿主内部的服务注册表行为，
插件侧的公开接口里没有对应手段，也没有配置项能影响它。

**本插件侧的路走到这里已经穷尽。** 已回退到 0.6.7。

### 0.6.35：再确认两个静态事实，以及 `withinFiber` 的语义

1. **包内没有 `cordis.yml`**（只有 `cordis.patch.yml`）。所以插件的装载入口**只**由 patch
   决定，没有第二处会把 `dsh-plugin-web-test/agent` 或 `/role-browser` 装到根。
2. **`web-test-browser-use` 这一行是宿主包** `@deepseek-ai/dsh-browser-use`（patch 第 44–45 行），
   不引用本插件的池。也就是说 0.6.7 的根行里，只有 `web-test-role-browsers`（第 31 行）
   会把池装到根。

`withinFiber` 的语义也读清楚了：

```js
function withinFiber(fiber, root) {
    let current = fiber;
    while (true) {
        if (current === root) return true;
        const parent = current.fiber.parent;
        if (parent === current) return false;
        current = parent;
    }
}
```

从服务自己的 fiber **向上**找 `root`，所以判据是"**`mount` 是该服务的祖先**"。
`mount` 是预设服务自己的 fiber，预设的 `tree.root` 是它的子 fiber，所以**预设里的每一个服务
都满足这一条**。

于是剩下的问题精确到一句话：**为什么 `ctx.root[Context.isolate]['webTestRoleBrowsers']`
等于预设里那个 symbol**。另外预设里的 `web-test-agent` 同样满足第一条却没被点名，
说明根 isolate 表并不是"预设里有什么就有什么"——**两者的差异就是下一轮要查的那一处**，
而且可以纯静态读 `PresetTree` 的构造与 cordis 的 isolate 创建来定位。

**本插件侧的公开接口路径确认穷尽**（六条候选均已排除并留证）。已回退到 0.6.7。

### 0.6.36：**泄漏解决了——用 loader 的 `isolate` 条目选项**

0.6.35 定位到的差异（预设里 `web-test-agent` 同样满足 `withinFiber` 却没被点名）指向
cordis-plugin-loader 的一处公开能力。读 `cordis-plugin-loader/lib/index.js`：

```js
/** Symbol realm used to isolate service implementations by entry or label. */
function isolate(ctx) {
    const label = entry.options.isolate?.[name];
    if (!label) return;
    if (label === true) realm = entry.realm ??= new LocalRealm(entry);
    else if (create) realm = realms[label] ??= new GlobalRealm(label);
    ...
}
```

`isolate` 是**加载器条目选项**，形如 `isolate: { 服务名: true | 标签 }`，把服务放进**独立的
symbol realm**，而不是宿主根的 realm——**这正是 `leakedServices` 要求的 "isolate realms"**。

关键细节：`Entry.update(options)` 把**整行**合并进 `this.options`（`isNullable` 的键删除），
所以 `isolate:` 必须与 `name:`/`config:` **平级**，不是嵌在 `options:` 下面。
第一次我嵌在 `options:` 里，宿主仍报 `isolate realms`；改成平级后立刻通过。

预设里两行共用同一个标签，于是它们到达**同一个池实例**，同时与根隔离：

```yaml
        plugins:
          - id: web-test-role-browsers
            name: 'dsh-plugin-web-test/role-browser'
            isolate:
              webTestRoleBrowsers: web-test-browsers
            config:
              headless: false
          - id: web-test-agent
            name: 'dsh-plugin-web-test/agent'
            isolate:
              webTestRoleBrowsers: web-test-browsers
```

配合的两处改动：根入口不再 `inject` 池、`putEnvironment` 不再触碰池（池在构造时用
`ctx.get('webTestStore')` 读已确认环境并自启第一个角色）。

**实测（全新 `DSH_HOME=/home/weetion/dshfresh4`，启动前读 profile patch 为 `[]`）**：

| 检查 | 结果 |
|---|---|
| `session/create` 用 `web-test` 预设 | **成功**，`session-f8d918` |
| 普通 `standard` 会话的事件流里 `mcp__` 出现次数 | **0**（此前是 `playwright-role-buyer`） |

**第七节场景 10「新建普通 DSH 会话没有额外角色工具」实测通过。**

**尚未完成**：web-test 会话内的完整闭环（登录、核验、获准动作）本轮没跑完——运行是
**会话里的 `web_test_*` 工具**启动的，不是 RPC，我用 RPC 探了几种命名都返回 `not found`。
**所以不要把 0.6.8 当成交付候选**，它现在的状态是"泄漏已修、闭环待复测"。

**下一轮第一件事**：用 `web_test_*` 工具在会话里跑一遍单角色闭环，确认隔离改动没有破坏
登录/核验/动作；再重新评估跨角色（池与 agent 现在共享 realm，提供方的绑定时机是否也变了）。

### 0.6.37：0.6.8 复测——工具通了，运行没建立

复测 0.6.8（`isolate` 方案），干净 home `/home/weetion/dshfresh4`：

1. 启动前读 profile patch → `[]`
2. `putEnvironment` 确认环境 `acc-p10`（成功，返回记录）
3. `session/create` 用 `web-test` 预设 → **成功** `session-5e5bf673`
4. `session/prompt`（方法名是 `session/prompt`，参数是
   `{requestId, sessionId, mode, content:[{type:'text',text}]}`）→ **accepted**
5. 会话日志里工具**确实被调用并返回**：

```
web_test_status ×5, web_test_start_run, web_test_wait, web_test_settle_operation,
web_test_resume_wait, web_test_report_case
```

工具集完整：`assume_role`、`begin_operation`、`finish_run`、`operation_unknown`、
`propose_cases` 都在。`tool/result` 与 `turn/end` 都在，**没有工具错误**。

**但 `web_test_status` 返回的是：**

```
Web testing plugin 0.6.8 (active). Projects: 0. Runs: 0.
```

**0.6.38 更正**：我先前把这条当成"realm 隔离导致池读不到存储"，**那个诊断是错的**。查了
插件的 SQLite：

```
u_web_test_environment_revisions 行数: 2
u_web_test_projects                   行数: 0
u_web_test_runs                       行数: 0
环境: [('acc-n10', 'buyer'), ('acc-p10', 'buyer')]
```

**两条已确认环境都在存储里**，`putEnvironment` 写进去了；`Projects: 0` 是**准确的**，因为
项目记录本来就是在 `start_run` 时才创建的。所以**不是读不到**。

真正的原因是模型**主动拒绝启动**。它的原话：

> The plugin is loaded and active, but its storage is empty — **0 projects and 0 runs** —
> so there's nothing I can legitimately start yet. `web_test_start_run` won't accept a
> guessed project, and it requires a **confirmed environment declaration** …

也就是说 `web_test_status` 报的 0 projects 让模型判定"没有可用的环境"，于是只调了 `status`
就结束。**这是提示与状态输出的问题，不是 realm 隔离破坏了存取**——0.6.4 早就记录过
"一个动作配一条短提示模型才立刻派发，长提示会让它叙述"，这次是同一类现象的反面：状态输出
误导了它。

**这意味着 0.6.8 的单角色闭环很可能是好的，只是没被正确驱动。** 下一轮要做的不是改代码，
而是用一条**明确指出环境已确认**的提示直接驱动 `start_run`，再判闭环。

**所以 0.6.8 目前的状态是：**

| 项 | 状态 |
|---|---|
| 普通会话无 `mcp__` 工具（场景 10） | **通过** |
| 预设可加载、会话可创建 | **通过** |
| 工具集完整、可调用、返回正常 | **通过** |
| 单角色闭环（登录/核验/动作） | **不通过**（运行未建立） |

**0.6.8 仍然不是交付候选**，但理由变了：不是 realm 隔离的副作用，而是**闭环尚未被正确驱动
并复测**。把"池在独立 realm 里怎么拿到环境"当成待解问题是没有依据的，那条诊断已撤回。

### 0.6.39：**0.6.8 的单角色闭环跑通了——两处失败现在都通过**

按 0.6.38 的判断只改提示、不改代码。会话 `session-f36a07dc`，提示明确说"环境已确认、
角色是 buyer、不要先调 status"：

```
CALL web_test_start_run {"runKey": "shop-acc-p10-buyer-run-1", "projectKey": "shop",
                         "environmentRevisionKey": "acc-p10", ...
  → Run shop-acc-p10-buyer-run-1 is running.
```

存储核对：

```
u_web_test_runs 行数: 1
  run: shop-acc-p10-buyer-run-1 | status: running | activeRole: '' | gen: 1
```

**与 0.6.7 走通时的形态一致**（`running`、代次 1、`activeRole` 尚未认领，等
`assume_role`）。**0.6.8 把两处失败都补上了**：

| 场景 | 0.6.7 | 0.6.8 |
|---|---|---|
| 普通会话无 `mcp__` 工具（场景 10） | 不通过 | **通过**（0.6.36 实测 0 次出现） |
| 单角色闭环（场景 2） | 通过 | **通过**（本节） |
| 预设可加载、工具集完整可派发 | 通过 | 通过 |

**0.6.8 是目前第一个两处都不错的构建。** 类型检查通过、**116 测试通过**。

产物：

```
dist/dsh-plugin-web-test-0.6.8.tgz
sha256 e9f7fac142a489632b6b1b8aa5d6b8b04e39817fac61b5ea434cfe9a75c37f8c
```

**还差什么才能当交付候选**（下一轮做）：

1. 登录与身份核验的**真实站点证据**（本轮只到 `start_run`，还没 `assume_role`/核验/动作）
2. **跨角色协作**复测——池与 agent 现在共享 isolate realm，提供方的绑定时机可能变了，
   这一项**有可能因为这次改动而变得可行**，必须实测
3. 干净环境重新安装最终产物复验一遍
4. 交付文档改写

**在第 1、2 项完成前，不要把 0.6.8 当成已通过全部 12 场景。**

### 0.6.40：**0.6.39 那句"第一个两处都不错的构建"是错的**

0.6.39 只验到 `start_run`，就说 0.6.8 两处都好了。**继续跑 `assume_role` 就露馅了**：

```
CALL web_test_start_run
  → Run shop-acc-p10-001 is running.
CALL web_test_assume_role
  → Error: web-test: role "buyer"'s browser failed
    mcp__playwright-role-buyer__browser_navigate:
    playwright-role-buyer: browser tool belongs to another Session
```

**`browser tool belongs to another Session`**——这正是 0.3.x 以来一直存在的那个绑定错误。

原因清楚了：**realm 隔离让池和 agent 拿到了同一个 realm 的池实例，但提供方把浏览器的
"归属 Agent"绑在别处。** 池在**预设 realm** 里构造，`mountSessionMcp(this.ctx, …)` 看到的
Agent 与会话里实际派发的 Agent 不是同一个，于是浏览器归错了会话。

**所以 `isolate` 是有代价的，它不是纯粹的改进**：

| | 普通会话无 `mcp__`（场景 10） | `assume_role` 身份接管 |
|---|---|---|
| **0.6.7**（池在根） | 不通过 | **通过**（0.4.x 起 run-D 就有 `role: 'buyer'`） |
| **0.6.8**（池在预设 + isolate） | **通过** | **不通过**（belongs to another Session） |

**两个版本各有一半，都不完整。** 0.6.39 说的"第一个两处都不错的构建"**撤回**——
我只验到 `start_run` 就下了结论，这是又一次把"跑通一半"当成"跑通"。

**这正好印证 0.6.23 读到的提供方契约**：绑定和暴露在两个不同维度上，`isolate` 解决的是
**暴露**（哪些 Agent 看得见工具），而**绑定**（工具归哪个 Agent）由 `mountSessionMcp` 自己
按它那套作用域决定，插件侧改不了。

**下一步该做的**（不是继续试 isolate 的变体）：

1. 让 `mountSessionMcp` 收到**与派发方相同的 Agent 上下文**——查 `RoleBrowserPool` 能否
   从 `agents`（已 inject）里拿到当前会话的 Agent，把那个 ctx 传给 `mountSessionMcp`
2. 若拿不到，则必须在宿主侧让提供方按 Agent 限定

**0.6.7 仍是唯一的完整单角色交付候选**，0.6.8 记录为"修好场景 10 但破坏身份接管"。

### 0.6.41：把 0.6.8 失败的原因定位到"预设是按 profile 挂载一次，不是按会话"

0.6.40 提出的方向（从 `agents` 取当前会话的 Agent 再传给 `mountSessionMcp`）在动手前先读了
加载器的 `isolate` 实现，有一条关键事实：

```js
const newMap = Object.create(entry.parent.ctx[Context.isolate]);
for (const name of Object.keys(entry.options.isolate ?? {})) newMap[name] = access(entry, name, …)
…
Object.setPrototypeOf(entry.ctx[Context.isolate], entry.parent.ctx[Context.isolate])
swap(entry.ctx[Context.isolate], newMap)
```

**隔离表是链到父级的**：只被点名的服务换 symbol，其余名字照旧从父作用域解析。这解释了
0.6.37 的观察——池在独立 realm 里，`ctx.get('webTestStore')` 仍然拿得到根的存储，
**realm 隔离没有破坏跨作用域访问**。

顺着这条线看，真正的问题清楚了：

- **预设是按 profile 挂载一次的**，`mountPreset` 在预设行初始化时跑，`web-test-agent` 那一
  条 entry 随之建立的是**一个** Agent 定义，而不是每个会话一个
- 提供方"每个服务器按 Agent 分别界定"（`it scopes each server per agent itself`），
  绑定落在**注册那一刻存在的那个 Agent** 上
- 0.6.7：池在**根**，`putEnvironment` 时挂载，浏览器的 `agent/created` 挂钩在会话创建时把
  浏览器绑到**那个会话**的 Agent → 单角色闭环通
- 0.6.8：池在**预设**，在 profile 加载时就挂载完成；等会话派发时，绑定的 Agent 与
  实际派发的 Agent 不是同一个 → `browser tool belongs to another Session`

**所以这不是"realm 隔离破坏了绑定"，而是"预设只有一个 Agent，浏览器只能绑到它"。**

**由此可以判断**：只要浏览器行在预设里，`assume_role` 就不可能按会话正确绑定——除非提供方
在 `mountSessionMcp` 之外提供"把已有服务器改绑到某个 Agent"的手段，公开接口里没有。
反过来，池在根时绑定是对的，但工具是全局的，场景 10 就不通过。

**两处失败是同一个张力的两面，而张力在提供方的契约里，不在插件的组合方式上。** 这一条把
0.6.23 的读法补完整了：不是"没有按 Agent 限定的开关"这么笼统，而是
**"挂载作用域决定暴露范围，注册时机决定绑定对象，而预设只有一个 Agent"**。

**0.6.7 仍是唯一的完整单角色交付候选。**

### 0.6.42：交付产物在干净环境上的端到端终验——通过

对**实际交付的那份 tarball**（`dsh-plugin-web-test-0.6.7.tgz`，
`sha256 759d57fb…6d8`）做终验，全新 `DSH_HOME=/home/weetion/dshfinal`：

| 步骤 | 结果 |
|---|---|
| `dsh --from-default-profile web` 建 profile | 启动前读 patch 为 `[]` |
| `dsh plugin add` 安装 tarball | 成功，**包内 0 个 `workspace:`/`file:` 依赖** |
| `putEnvironment` 确认环境 `acc-final`（buyer → Alice Buyer） | 成功 |
| `session/create` 用 `web-test` 预设 | 成功 |
| `web_test_start_run` | `Run shop-acc-final-buyer is running.` |
| `web_test_assume_role`（第一次，空账号） | **拒绝**：`confirmed role "buyer" as "", but that role is bound to "Alice Buyer"` |
| `web_test_assume_role`（第二次，真实登录） | **成功**：`now acts as buyer` + 出示 authority |

存储核对：

```
run: shop-acc-final-buyer | status: running | activeRole: 'buyer' | gen: 1
身份: buyer → 'Alice Buyer'
  detail: page http://127.0.0.1:8902/ titled "受控验收站点" declared "Alice Buyer"
```

**这一次 `assume_role` 成功了**，而 0.6.8 同样这一步是
`browser tool belongs to another Session`——**这也从正面印证了 0.6.41 的结论**：
池在根时绑定正确，在预设时绑定错误。

**两点特别值得记**：

1. **空账号被真实拒绝**，不是靠字段判断，是模型读站点后报告的身份与已确认环境的
   `accountRef` 比对不符——第四节"错误账号、错误来源均不能通过"有真实宿主证据
2. 身份 `detail` 记录了**站点页面标题和它声明的账号**，可追溯到具体页面而非仅一个字符串

**所以 0.6.7 的单角色闭环在交付产物上完整成立**：干净安装 → 环境确认 → 会话创建 →
运行建立 → 身份接管（含拒绝错误身份）→ 真实站点核验。配合此前已测的授权代次、
取消/恢复/重启、断连归属、禁用停止派发、宿主退出进程回收、报告三面一致，
**第七节 12 场景中 10 个通过，其中 8 个为真实宿主证据**。

### 0.6.43：终验继续——发现真缺陷：被宿主重启打断的运行**无法被续跑**

0.6.42 的终验会话在下一轮复用了同一个 `DSH_HOME`，宿主重启过。继续 `begin_operation`
时得到：

```
web_test_begin_operation: Error: web-test: run shop-acc-final-buyer is resuming and
  refuses new test actions. The DSH host restarted during that run; report what you
  know through web_test_status.
web_test_resume_wait: Error: run "shop-acc-final-buyer" is resuming and is not waiting
  for business time
web_test_assume_role: Error: run shop-acc-final-buyer is resuming and refuses new
  test actions.
```

守卫本身是**对的**（第七节场景 9：宿主重启后必须重新核验，不得沿用旧授权）。但随后
发现：**工具集里根本没有续跑入口**。

```
web_test_assume_role, web_test_begin_operation, web_test_finish_run,
web_test_operation_unknown, web_test_propose_cases, web_test_report_case,
web_test_resume_wait, web_test_settle_operation, web_test_start_run,
web_test_status, web_test_wait
```

**没有 `continue_run` / `resume_run` 之类。** 模型只能反复调 `status` 看同一句话，然后
卡住。

**这是 0.6.7 的真实缺陷**，也让第七节场景 9 的结论要改：

- 旧版记录写的是"重启后重新核验、UNKNOWN 不自动重提"——那是在**不经过宿主重启**的
  受控路径上测的（`controlRun` 的 `restarting` 分支）
- **真实宿主重启**走的是启动时对账，会把运行置为 `resuming`，而**没有工具能把它推回去**

**所以场景 9 应记为"部分通过"**：检测与拒绝正确，**恢复路径缺失**。

**要做的修复**（下一轮）：加一个 `web_test_continue_run` 之类的工具，把 `resuming` 的运行
交还给运维决定——运维确认后运行回到可认领状态并要求重新核验身份，而不是永久拒绝。
这是功能缺口，不是环境问题，**下一轮实现并用真实宿主重启复测**。

### 0.6.44：补上恢复路径——0.6.9，场景 9 恢复为通过

0.6.43 记的"恢复路径缺失"有两个成因，都补上了。

**成因一：模型够不着 `controlRun`。** 恢复能力本来就有——`webTest/controlRun` 是 Remote
方法，`RunControlAction` 里也有 `continue`——但**它只暴露成 RPC，没有工具**，而 hold 守卫
又不允许别的工具在运行被停住时动。模型只能读 `status` 里那句"需要运维继续"，然后卡住。

**成因二：状态机里根本没有这条边。** 加上工具后第一次跑就撞上：

```
web_test_control_run: Error: web-test: run "shop-acc-r1-buyer" is resuming and cannot continue
```

`WebTestStore.nextStatus` 的 `continue` 只接受 `awaiting-user`：

```ts
if (action === 'continue') return run.status === 'awaiting-user' ? 'running' : undefined
```

`resuming` 只能靠 `resume` 出去，而 `resume` 语义上是"恢复一个暂停的运行"，不是"运维决定
继续一个被重启打断的运行"。**两个原因缺一不可**：只加工具会撞上这条，只改状态机会没有入口。

**改动**：

- 新增 `web_test_control_run` 工具（`runKey` + `action`，`action` 为
  `pause|resume|continue|await-user|cancel`），输出 `runKey/status/activeRole/generation/message`
- 加入 `HELD_RUN_ALLOWED_TOOLS`——**这是关键**，否则运行被停住时工具仍然够不着，
  那正是 0.6.43 卡死的场景
- `nextStatus` 的 `continue` 现在也接受 `resuming`

**真实宿主复测**（杀宿主模拟崩溃 → 重启 → 对账 → 续跑）：

| 阶段 | 状态 |
|---|---|
| 重启前 | `status: running | gen: 1` |
| 重启后对账 | `status: resuming | gen: 1 | activeRole: ''` |
| 续跑后 | **`Run shop-acc-r1-buyer is now running at generation 2. Act as a role again before the next operation; the previous authority is void.`** |

**第 7 条要求的"重启后重新核验"成立**：重启 → 对账置 `resuming` 并清空角色 → 运维决定 →
回到 `running` 但**代次 +1**，因此重启前签发的授权作废，必须重新 `assume_role`。

类型检查通过，**117 测试通过**（新增一条锁住 `control_run` 在 hold 时可达）。

产物：`dsh-plugin-web-test-0.6.9.tgz`，`sha256 dacf49ef87e435edb9321742a8050d4fc57e00b1d5c86c64a11ff2851a3139e0`
（重装后重打的哈希，0.6.7 那份是 `759d57fb…`）。

**0.6.9 取代 0.6.7 成为交付候选**：单角色闭环在交付产物上已端到端验证（0.6.42），
场景 9 的恢复缺口已补并复测。跨角色与普通会话工具两处限制不变。

### 0.6.45：0.6.9 终验又抓到一个 schema 缺陷——`settle_operation`（0.6.10 修复）

0.6.9 在干净 home 跑通了 `start_run` → `assume_role`（真实登录，身份 `Alice Buyer`）→
`begin_operation`（`Operation create-order-1 … is dispatching`）→ `finish_run`
（`closed as completed`，存储 `status: completed`），但在中间这一步报了：

```
web_test_settle_operation: Error: tool "web_test_settle_operation" returned invalid
  output: missing required property "value.authority"
```

**和 0.2.x 修过的 `begin_operation` 同一类**：输出 schema 的 `required` 里有 `authority`，
函数体却没返回。根因是**输入 schema 里没有 `authority`**——落定时不需要校验授权，所以
当初没加，而输出却复用了同一个 `operationResultSchema`，那个 schema 是给 `begin_operation`
用的，带 `authority`。

**修法**（与 `begin_operation` 对齐，而不是放宽 schema）：

- `settleOperationInputSchema` 增加 `authority: z.string().min(1)`，
  `required` 同步加上
- 返回值里 `authority: input.authority` 原样回传

**理由**：落定本身就是"以该运行的身份行动"的一部分，**应当携带授权**；而浏览器在落定之后
还要继续操作，回传同一个授权可以避免模型每次落定后重新索取。**放宽 schema 等于让输出少报
一个字段，那是掩盖不是修复。**

类型检查通过，**117 测试通过**。

**尚未复测确认**：修完后驱动落定的两次尝试里，模型都没有走到 `begin_operation` 就直接
`finish_run`（`closed as blocked`），所以**这个修复在真实宿主上的效果还没测到**。
下一轮要用"一条提示一个工具"的方式把 `begin_operation` → `settle_operation` 走完，
确认 `value.authority` 不再报错。

**当前交付候选仍是 0.6.9**（`sha256 dacf49ef87e435edb9321742a8050d4fc57e00b1d5c86c64a11ff2851a3139e0`）：
它的单角色闭环与重启恢复都已实测通过。0.6.10 的修复方向正确、编译与测试通过，但**真实宿主
未复测，不作为候选**。

### 0.6.46：`settle_operation` 的修复仍未复测到——卡在驱动方式，不在代码

按 0.6.45 写的"一条提示一个工具"重试，两次都换了环境：

**第一次**用 `/home/weetion/dshv9`（已有多个 web-test 会话）：

```
web_test_assume_role: Error: role "buyer"'s browser failed
  mcp__playwright-role-buyer__browser_navigate:
  playwright-role-buyer: browser tool belongs to another Session
```

**这正好复现了 0.6.41 的限制**——浏览器绑在这个宿主进程里第一个 web-test 会话上，
后来的会话拿不到。**不是新问题，是已记录的单宿主单浏览器边界。**

**第二次**用全新 `/home/weetion/dshs10`、只建一个 web-test 会话：

```
web_test_start_run: Run shop-acc-t1-buyer is running.
web_test_assume_role: Error: confirmed role "buyer" as "", but that role is bound to
  "Alice Buyer" in environment "acc-t1"
```

`start_run` 成功、`assume_role` 正确拒绝空账号（第四节要求的行为）。但**后续两条提示
（"读身份页后再 assume_role"、"然后 begin_operation"）模型没有再调任何工具**，所以
`begin_operation` → `settle_operation` **仍然没有走到**。

**结论要写清楚**：

- 0.6.10 的 `settle_operation` 修复**方向正确、类型检查通过、117 测试通过**
- 但**真实宿主上从未执行过一次成功的落定**，所以 **`value.authority` 是否真的不再报错，仍未验证**
- 也因此**不能把 0.6.10 当候选**；候选仍是 0.6.9
- 0.6.9 自己在真实宿主上**跑通过** `finish_run`（`closed as completed`）与重启恢复，
  唯独 `settle_operation` 那一步在 0.6.9 上是报 schema 错的——**所以 0.6.9 也带着这个
  已知缺陷**

**这一条必须写进交付记录**：0.6.9 与 0.6.10 都不含一个在真实宿主上验证过的
`settle_operation`。**下一轮的驱动方式**要换——不能再靠"一条提示一个工具"，那反而让模型
停下来；改成在一条提示里把三步明确排好，并且**先让模型把身份页读出来**再让它 assume。

**诚实说明我这几轮的问题**：同一个 schema 缺陷（`begin_operation` 在 0.2.x、
`settle_operation` 在 0.6.45）本该由"输出 schema 的 `required` 逐块核对"这类静态检查兜住。
这类检查**单元测试覆盖不到**（工具输出 schema 只在宿主加载时生效），**下一轮应该加一条
静态门禁：扫描 `tools.register` 的每个 `output.schema.required` 与其 `execute` 的返回
字段是否一致**。

### 0.6.47：**完整闭环在交付产物上跑通了——0.6.10 成为交付候选**

0.6.46 指出"一条提示一个工具"会让模型停住。改成**一条提示里把七步按顺序排好**，
全新 home `/home/weetion/dshfinal`，装重建后的 0.6.10：

```
web_test_start_run:      Run shop-acc-fin-buyer-1 is running.
web_test_assume_role:    Error: confirmed role "buyer" as "", but that role is bound
                         to "Alice Buyer"          ← 空账号被真实拒绝
web_test_assume_role:    Run shop-acc-fin-buyer-1 now acts as buyer; present authority …
web_test_begin_operation: Operation create-order-1 … is dispatching.
web_test_settle_operation: Operation create-order-1 is settled. Recorded as
                         observed-success; it will appear in the report and cannot be
                         settled again.                ← value.authority 不再报错
web_test_finish_run:     Run shop-acc-fin-buyer-1 closed as completed.
```

存储：

```
运行: shop-acc-fin-buyer-1 | status: completed | activeRole: 'buyer' | gen: 1
操作: create-order-1 | dispatch: {"kind":"settled","outcome":"observed-success"}
身份: buyer → 'Alice Buyer'
```

**第七节场景 2「单角色登录、身份核验和获准动作成功」现在有完整真实宿主证据**，
而且中途**真实拒绝了一次空账号**（第四节要求）。之前 0.6.9 卡在 `settle_operation`
的 schema 错误上，这一步是第一次真正跑过去。

**同时加上了 0.6.46 说的静态门禁**：`tool-schema.spec.ts` 现在覆盖 `operationResultSchema`
——那个被 `begin_operation`、`settle_operation`、`operation_unknown`、`resume_wait`
**四个工具共用**的 schema。共用正是当初让缺口存活的原因：每个工具单看都说得通。
类型检查通过，**118 测试通过**。

产物：`dsh-plugin-web-test-0.6.10.tgz`，
`sha256 a4141ca3dec8cb5adc1c76807f2073a12c2331782185618080c697033871f19f`
（重建后的这份，就是上面实测的字节）。

干净环境核对：启动前 profile patch 为 `[]`，安装包内 **0 个 `workspace:`/`file:` 依赖**。

**0.6.10 取代 0.6.9 成为交付候选**：

| | 0.6.9 | 0.6.10 |
|---|---|---|
| 单角色闭环（含落定） | **卡在 schema 错误** | **通过** |
| 重启恢复 | 通过 | 通过（0.6.9 实测，代码未变） |
| 静态门禁覆盖共用 schema | 无 | 有 |

**仍未通过的两处不变**：跨角色协作、普通会话无额外角色工具。

### 0.6.48：0.6.10 上的重启恢复复测通过

0.6.47 的重启恢复是在 0.6.9 上测的，0.6.10 改过 `agent.ts`（新增工具、修 schema），
所以必须在交付版本上重测。

先确认**已完成的运行不受重启影响**——这本身是对的：

```
shop-acc-fin-buyer-1 | status: completed | gen: 1     ← 前后一致
```

再用一个**未完成**的运行（`shop-acc-w1-buyer`）做中断：

| 阶段 | 状态 |
|---|---|
| 中断前 | `running \| gen: 1` |
| 杀宿主后重启、对账 | **`resuming \| gen: 1 \| activeRole: ''`** |
| `web_test_control_run action=continue` | **`now running at generation 2. Act as a role again before the next operation; the previous authority is void.`** |
| 随后 `web_test_assume_role` | 仍可调用（先是 `accountPage` 格式错误，模型再调整参数） |

**第七节场景 9 在 0.6.10 上完整成立**：宿主重启 → 对账置 `resuming` 并清空角色 →
运维决定继续 → 回到 `running` 但**代次 +1**，重启前签发的授权作废，必须重新 `assume_role`。
模型没有卡住，也没有出现 0.6.43 那种反复读 `status` 的死循环。

**所以 0.6.10 的两处关键能力都在交付版本上实测过**：
完整闭环（0.6.47）与重启恢复（本节）。

**仍未复测的两项**：
- 跨角色协作——已知的提供方限制，本轮没有新路径可试
- 普通会话无额外角色工具——0.6.8 的 `isolate` 能修好但会破坏身份接管，记录已警告不要用

**还发现一个次要问题**（不影响本轮结论）：模型给 `assume_role` 传的 `accountPage`
有时不是合法 URL，工具按 schema 拒绝并给出 `invalid_format`，这是**正确的校验**，
但说明工具描述应更明确地要求绝对 URL。**下一轮可以改进描述**，不影响当前候选。

### 0.6.49：`accountPage` 补上描述，模型一次就对——0.6.11

0.6.48 发现模型给 `assume_role` 传的 `accountPage` 有时不是合法 URL，被 `url` 格式拒绝。
查参数定义，**`accountPage` 根本没有 `description`**——模型只能猜。

补上：

```ts
accountPage: {
  type: 'string',
  format: 'uri',
  description:
    'Absolute URL of the page in the role browser that states the signed-in account, read '
    + 'from the page itself. A relative path is rejected, so pass the full address bar URL. This '
    + 'is what the verification is traced to, so a login form, an error page or an empty value '
    + 'does not pass.',
}
```

全新 home 实测，**这是至今最干净的一次**：

```
web_test_start_run:        Run run-shop-buyer-1 is running.
web_test_assume_role:      Run run-shop-buyer-1 now acts as buyer. Present authority …
web_test_begin_operation:  Operation create-order-1 … is dispatching.
web_test_settle_operation: Operation create-order-1 is settled … observed-success.
web_test_finish_run:       Run run-shop-buyer-1 closed as completed.
```

```
运行: run-shop-buyer-1 | status: completed | activeRole: 'buyer' | gen: 1
操作: create-order-1 | {"kind":"settled","outcome":"observed-success"}
身份: buyer → 'Alice Buyer'
```

**`assume_role` 第一次就成功，没有 `invalid_format`，也没有空账号被拒**——五步一次跑完。
对比 0.6.10 那次要两次才成功。

**这条经验值得单独记**：工具的**参数描述本身就是产品行为**。`required` 里列了字段不等于模型
知道该填什么；缺描述会让模型猜，猜错就是一次真实的失败往返。**每个模型可见的参数都该有
说明它该是什么形状、为什么需要**。

**0.6.11 取代 0.6.10 成为交付候选**，`sha256 d64b798d2cd71f6638650d889877e86d6a99ec29c19b1e1ab3010a763e91fa9e`。
类型检查通过，**118 测试通过**。

### 0.6.50：参数描述补齐 + 门禁；0.6.12 实测（这次模型错了两次）

0.6.49 提到"下一轮系统检查其他工具的参数描述"。扫描下来：

| 工具 | 结果 |
|---|---|
| `start_run` `label` / `finish_run` `runKey` / `propose_cases` `environmentRevisionKey` / `report_case` `caseKey` / `begin_operation` `intent`+`role` / `settle_operation` `operationKey` / `operation_unknown` `reason` / `assume_role` `runKey`+`role` / `wait` `reason` | 都有描述 |
| `resume_wait` `runKey` | **缺**，已补 |
| `control_run` `runKey`+`action` | 有描述（我先前 0.6.44 写时加的） |

补了 `resume_wait.runKey`，并**加了一条门禁测试**：`tool-schema.spec.ts` 现在读
`src/agent.ts` 源码，检查每个 `parameters` 块里每个字段 420 字符内是否含 `description`，
缺一个就失败。**这样"加参数忘了写描述"以后会被测试挡住。**

类型检查通过，**119 测试通过**（新增一条门禁）。

**0.6.12 真实宿主实测**（全新 home）：

```
web_test_start_run:        Run run-shop-acc-y1-buyer is running.
web_test_assume_role:      Error: confirmed role "buyer" as "" …   ← 模型传空
web_test_assume_role:      now acts as buyer. Present authority …
web_test_begin_operation:  Operation create-order … is dispatching.
web_test_settle_operation: Error: expected string, path ["authority"]  ← 模型传了非字符串
web_test_settle_operation: Operation create-order is settled … observed-success.
web_test_finish_run:       Run run-shop-acc-y1-buyer closed as completed.
```

```
运行: run-shop-acc-y1-buyer | status: completed | activeRole: 'buyer' | gen: 1
操作: create-order | {"kind":"settled","outcome":"observed-success"}
身份: buyer → 'Alice Buyer'
```

**闭环成立，但这次模型错了两次**，和 0.6.11 的零错误不同。两次都被工具正确拒绝
（空账号、非字符串授权），然后都改对了。

**要说清楚的**：0.6.12 的改动是**代码质量**（门禁 + 补描述），**不是行为改进**。模型
这两次犯错是采样波动，不能说 0.6.12 比 0.6.11 更容易用。**0.6.11 与 0.6.12 功能等价**，
0.6.12 多一道防止参数描述退化的门禁。

产物：`dsh-plugin-web-test-0.6.12.tgz`，
`sha256 284a2714caba746781ff52c1fafd060c0d08bce45a0471fcefd93dd7ad323068`

### 0.6.51：宿主退出回收在 0.6.12 上复测通过

0.6.49 的尝试无效（模型没走到身份接管，浏览器没起，计数没变什么都没证明）。
这次先确认浏览器**真的起来了**再杀宿主。

会话驱动到身份核验完成：

```
起浏览器后 Chromium=11
身份: buyer → 'Alice Buyer'
```

然后对宿主发 SIGTERM：

| 阶段 | 插件自有 Chromium | 用户自己的 Chrome |
|---|---|---|
| 杀宿主前 | **11** | 26 |
| SIGTERM 后 12s | **0** | **26** |
| 宿主 | **自行退出**（无需 SIGKILL） | — |
| 最终 5s 后 | **0** | **26** |

**第六节「宿主退出」这一项在交付版本上成立**，且**用户自己的 26 个 Chrome 进程一个没动**——
符合「只处理插件拥有的资源，不结束其他会话或个人浏览器」。

**这次测法比上次对的教训**：上次是「跑一段提示 → 等固定时间 → 数进程」，模型没走到
该走的步骤，计数没动就当成了「没变化」。**进程计数必须先确认有进程再谈回收**，
否则「回收了 0 个」和「没起过」在数字上是一样的。**先确认起点非零，这是这次的关键。**

### 0.6.52：「禁用插件但宿主继续运行」测不了——缺的是运行时的禁用入口

0.6.51 关掉了宿主退出这一项，还剩「禁用插件但宿主保持运行」。在 0.6.12 上测，
**测不了，原因不在插件**。

先确认起点非零：浏览器起来了。

```
基线 Chromium=0 用户Chrome=26
禁用前: Chromium=10 用户Chrome=26 宿主=1
身份行数: 3
```

然后**在宿主运行中**执行 `dsh plugin --profile z1 remove dsh-plugin-web-test`：

```
Done in 232ms using pnpm v11.7.0
禁用后15s: Chromium=10 用户Chrome=26 宿主=1
禁用后25s: Chromium=10 用户Chrome=26 宿主=1
```

**命令改的是磁盘上的安装，运行中的宿主毫不知情。** 找运行时的插件控制入口，
`plugin/list` 返回 `not found`，没有可用的 disable RPC。

**所以要分清两件事**：

1. **插件侧的释放代码是对的**——0.6.51 已证明宿主退出时 `ctx.effect` 的 disposer 会把
   Chromium 收回（11 → 0），那条路径复用同一套句柄。
2. **但「禁用」这个动作本身在公开接口上不存在**。`dsh plugin remove` 是离线安装管理，
   不是运行时控制；宿主不监听它。**没有这个入口，插件就无法在宿主存活时被要求释放。**

**这一项的定性从「未测」改为「宿主缺公开接口」**，和跨角色、普通会话工具泄漏是同一类。
**不能靠插件自己轮询磁盘来补**——那是绕过宿主生命周期去猜状态，既不可靠也不该做。

**第六节四条路径的最终状态**：

| 路径 | 状态 |
|---|---|
| 运行结束或取消 | 早前版本实测，代码未变 |
| 角色资源重建 | 早前版本实测，代码未变 |
| **宿主退出** | **0.6.12 实测：11 → 0，宿主自行退出，用户浏览器未受影响** |
| **插件禁用但宿主继续运行** | **公开接口不存在，无法执行** |

**给 Windows 复验方的说明**：这一项在 Ubuntu 上无法验证，**不要在 Windows 上假设它
会通过**——那是同一个宿主行为，不是平台差异。

### 0.7.0：两处归因被推翻，资源释放句柄修好，跨角色仍未通

用户指出我把「某个 helper 的单提供方限制」等同于「宿主整体限制」，并给了
`packages/experimental/browser-use-runtime/tests/host-runtime-duplication.spec.ts`。
**那份 spec 直接推翻了此前的结论。**

#### 归因错误一：存在公开的运行时禁用接口

我此前记录「没有公开禁用接口」「Windows 必然失败」。**两处都错。**

`ctx.pluginManager` 是 `@Remote` 服务：

| 方法 | 位置 |
|---|---|
| `pluginManager/setPluginEnabled(id, enabled)` | `packages/boot/plugin-manager/src/index.ts:424-435` |
| `pluginManager/setBundleEnabled(name, enabled)` | 同上 `:442-448` |

**是否热生效由一行决定**（`:763`、`:776`）：

```ts
if (this.ownerContext.get('hmr') === undefined) return []
result.application = this.ownerContext.get('hmr') !== undefined ? 'applied' : 'restart-required'
```

`hmr` 在 base-backed profile 默认启用（`packages/bundle/base/cordis.patch.yml:28-32`），
所以正常结果是 `application: 'applied'`，**不是 restart-required**。
链路：`writePluginEnabled` → `reconcileProfilePatches`（`app-boot/src/index.ts:289`）
→ `EntryGroup.update`（`vendor/loader/src/config/group.ts:48-65`）
→ 禁用时 `entry.fiber?.dispose()`（`vendor/loader/src/config/entry.ts:134-137`）。

**我此前只试了 `dsh plugin remove`**（CLI 只跑 pnpm，无 IPC），**没查 `pluginManager`**。
CLI 那条观察本身没错，但**它不是那个接口**。

#### 归因错误二：普通会话看到 mcp 工具，不是缺陷

那份 spec 的通过用例写明：

```ts
expect(toolNames(ctx)).toEqual([])                    // 全局视图
for (const agent of [first.agent, second.agent])
  expect(toolNames(ctx, agent)).toContain(TOOL)       // 按 Agent 作用域
```

`ToolRuntime.view`（`packages/core/tools/src/index.ts:1178-1218`）按
`ScopedLayers.chainLayers/peek` 过滤，**不带 agent 参数就只读全局层**。
**我此前用全局查询判「普通会话看到角色工具」，按设计全局本就该是空的。**

#### 修复：releaseRole 释放的是空 effect

用户指出 `releaseRole` 只释放外层空 effect——**确认属实**：

```ts
const mounted = this.ctx.effect(() => {
  mountSessionMcp(this.ctx, {...})   // ← 注册在池的上下���上
  return () => {}                    // ← 空 disposer
})
```

`ctx.effect(execute)` 只回收**自己产出**的 disposer；`mountSessionMcp(this.ctx, ...)`
的注册落在 `this.ctx` 上，**不在任何可释放的作用域里**。而且
`mountSessionMcp` **返回 void**（`mcp.ts:100`），**调用方必须自己持有那个 Fiber**。

改成在独立 fiber 上挂载：

```ts
const fiber = this.ctx.plugin({ inject: [...], apply(provider) { mountSessionMcp(provider, {...}) } })
this.mounts.set(role, async () => { await fiber.dispose() })
```

`ctx.plugin()` 造的是 Cordis Fiber（`vendor/cordis/src/registry.ts:316-336`），
`fiber.dispose()` 会卸载插件并**在清理完成后才 settle**。

顺带修了 `switchTo`：它原本会**先释放上一个角色**再挂新角色（注释称「宿主只允许一个
browser-use provider」）——**那个前提是错的**，provider 给每个 Agent 自己的 client，
不同角色注册不同 `browserUse` 名字，可以并存。

类型检查通过，**119 测试通过**。

#### 跨角色：修复后仍未通

0.7.0 真实宿主上 buyer 正常（`now acts as buyer`），**seller 报
`unknown tool "mcp__playwright-role-seller__browser_navigate"`**。

这个错误来自工具层而非本插件的守卫（守卫在 `agent.ts:186` 已放行登录类工具），
说明**第二个角色的 MCP client 从未注册**。最可能的原因：`createScope(ctx, agent)`
按 **Agent** 建作用域，而 seller's fiber 是在 Agent **已存在之后**挂载的，
它的 `open(agent)` 没有被调用。**这一点尚未证实**，需要下一步定位。

**所以当前不能说跨角色已通过。** 真实浏览器的隔离是对的（Chromium=10，buyer 可用），
但第二角色拿不到工具。

### 0.7.1：工具契约一致性——`settle_operation` 的输入与内部要求矛盾

`settle_operation` 注册的 `parameters` 是

```ts
required: ['runKey', 'operationKey', 'outcome']
```

**不含 `authority`**，而 `execute` 里

```ts
const settleOperationInputSchema = z.object({ ..., authority: z.string().min(1) })
const input = settleOperationInputSchema.parse(args)
```

**`parse` 要求 `authority`。** 也就是说：模型**只要遵守对外声明的契约**（不传 `authority`），
这次调用就会被工具自己的解析拒绝。之前的真实宿主测试之所以通过，是模型碰巧多传了。

#### 修法：授权从运行取，不从模型收

`settleOperationInputSchema` 去掉 `authority`；输出里的 `authority` 改为
`store.currentAuthority(runKey, requireAgentId(exec))?.token ?? ''`。

新增 `WebTestStore.currentAuthority`：只返回**已存在且当前仍然有效**的令牌，逐项复核
`status === 'running'`、`generation` 一致、`role` 一致、身份已核验、`agentId` 匹配。

**为什么不用现成的 `mintAuthority`**：它每次调用都铸一枚**新**令牌。在落定这一步铸新令牌
等于让一个记账动作刷新授权，绕过了代次检查——暂停/重启后本该作废的授权会被重新签发。
`currentAuthority` 只读，不铸。

**副作用**：模型不必再把令牌在参数里来回传，也就少了一条「模型能自己断言授权」的路径。

#### 覆盖面：`operationResultSchema` 被七个工具共用

`begin_operation`、`settle_operation`、`operation_unknown`、`assume_role`、`wait`、
`resume_wait` 共用同一个 `output.schema`，`required` 固定为
`['runKey','operationKey','dispatch','authority','note']`。
**只要其中任何一个函数体少返回一个字段，那次调用就必然失败**——`settle_operation` 之前正是这样。

#### 新增真实执行测试

`tests/tool-execution.spec.ts`：记录插件**实际注册**的 definition，用**真实 store** 逐个驱动
`execute`，再用**该 definition 自己声明的** `output.schema` 校验返回值。

- 不读源码、不比对 schema 常量——**故障只存在于函数体运行时返回的那个值里**
- 真实 `ToolsService` 无法在此工作区运行时导入（会拉入 `dsh-sandbox`），所以用录制式
  `tools.register`；被测对象是插件自己的注册载荷与自己的 `execute` 函数体
- 带**防空转**断言：若没有任何工具体产出值则直接失败并列出各自拒绝原因

类型检查通过，**122 测试通过**（新增 3 条）。

### 0.7.2：第二角色的根因确认——单提供方槽位，启动错误此前被吞掉

0.7.0 看到 seller 报 `unknown tool`，我**推断**是「client 从未注册」。用户指出：
**先暴露启动错误**，`unknown tool` 只说明当前作用域查不到工具，不能证明 client 没注册。
照做之后，真实宿主直接给出答案：

```
web_test_assume_role: Run run-shop-ab2-roles now acts as buyer. …
web_test_assume_role: Error: web-test: the browser for role "seller" did not start:
  Error: browser use provider "playwright-role-buyer" is already registered
```

#### 为什么此前是静默的

`mountBrowser` 调用 `this.ctx.plugin({...})` 后**从不 await 它的就绪**。
`plugin()` 返回的是 `fiber.await()` 的 thenable（`vendor/cordis/src/registry.ts:331-335`），
不 await 就等于不检查激活结果。而 `mountSessionMcp` 里的
`yield ctx.browserUse.register(...)`（`mcp.ts:125`）是**激活期抛错**，
于是：抛错 → 角色仍被写进 `started` → 唯一的症状是后来某次调用 `unknown tool`。

现在 `mountBrowser` **await fiber**，失败则抛出带角色名的错误、**不写 `started`**、
不保留 disposer（并 `void fiber.dispose()` 回收半启动的 fiber）。

#### 根因

`packages/browser-use/browser-use/src/index.ts:35-45`：

```ts
register(name: BrowserUseProviderName): () => Promise<void> {
  if (this.registration !== undefined) {
    throw new Error(`browser use provider "${this.registration}" is already registered`)
  }
```

**只要已有注册就抛，名字不同也一样。** 整个宿主进程只有**一个** browser-use 提供方槽位。

而 `mountSessionMcp` 的粒度是**每个调用一个 `register`**，它的 client 粒度是**每个 Agent 一个**。
所以：**一个 `mountSessionMcp` = 一个槽位 = 多个 Agent 各一个 client**，
**但永远无法一个 Agent 内两个 client**。角色是在 Agent 之内的概念，粒度不匹配。

**这解释了我此前所有「跨角色不可能」的结论**：不是「工具不暴露」或「绑定错」，
而是**粒度根本不同**。用户说「不把某个 helper 的单提供方限制等同于宿主整体限制」——
限制在 `mountSessionMcp` 这个 helper 上，**宿主本身并没有禁止一个 Agent 持有多个浏览器**。

#### 并发

`ensure` 原先向第二个调用方返回 `RoleBrowser` 记录（浏览器**尚未启动**），
启动失败时它一无所知。改为 `pending` 存**启动 promise**，所有调用方 await 同一个任务，
失败一并抛出。

#### 测试

两条新测试锁住可观察行为（该工作区无法导入 provider 模块，所以触发的是导入失败
而非槽位拒绝——**两者必须表现一致**：抛出、不记录）：

- 启动失败必须抛给调用方，且 `list()` 为空
- 并发 `ensure` 共享同一次启动，失败同样抛出

类型检查通过，**124 测试通过**。

#### 下一步

用**公开接口**做 Agent 内的按角色隔离：`createScope(ctx, <角色键>)` 建立作用域，
把 `McpClient` 挂进该作用域，工具即落在该角色的层里。**不修改宿主、不伪造 Agent 或
生命周期事件。** 这需要确认 `dsh-scope` 的 `ScopeKey` 是否接受非 Agent 的键，以及
`dsh-mcp-client` 是否可作为直接依赖。

### 0.7.3：改用公开作用域接口，**两个浏览器同时存在了**

按用户要求「通过已核对的公开 MCP／作用域接口实现插件内适配，不修改宿主，
不伪造 Agent 或生命周期事件」，0.7.2 放弃了 `mountSessionMcp`。

#### 为什么不能用 `mountSessionMcp` 做多角色

它每次调用都会 `ctx.browserUse.register(name)`，而 `BrowserUseRegistry` 全进程只有
**一个**槽位且不论名字都拒绝第二次。所以它天然是「**一个调用 = 一个 provider = 每个
Agent 一个 client**」，无法在一个 Agent 内开第二个 client。

#### 新装配

`ScopeKey = object`（`packages/core/scope/src/index.ts:15`），**任意对象都合法**；
工具层按该键查找。所以：

- **每个角色一个 fiber**（释放句柄，且只拥有该角色的 client）
- fiber 内**每个 Agent 一个 scope**：`createScope(provider, agent)`
- `scope.ctx.plugin(McpClient, Config({ serverName: 'playwright-role-<role>', ... }))`

**两个角色的工具落在同一个 Agent 层里，但 `serverName` 不同，工具名不同，因此不冲突。**
整个过程**不碰 `browserUse` 槽位**，也不创建任何 Agent 或生命周期事件——
Agent 只来自宿主自己发出的 `agent/created`。

角色若在 Agent 已存在之后才挂载（会话中途切换角色），就对池自己记录的、
宿主已公告过的 Agent 补开 scope。

#### 真实宿主结果

```
web_test_assume_role: Run shop-acc-ab3-signin now acts as buyer. Present authority …
web_test_assume_role: Error: role "seller"'s browser failed
  mcp__playwright-role-seller__browser_navigate: unknown tool …
web_test_assume_role: Error: confirmed role "seller" as "Bob Approver", but that role
  is bound to "Bob Seller" in environment "acc-ab3"
Chromium=20
```

**`Chromium=20`：两个 Chromium 同时在跑**（此前单角色是 10）。**这是隔离真正成立的第一个
证据**——两个角色各持一个浏览器，互不抢占。

而且 seller 的浏览器**确实起来并读到了页面身份**（`"Bob Approver"` 是站点为 bob 账号
真实声明的账号）。**所以 `unknown tool` 不是「client 从未注册」**，而是**首次调用与
client 注册之间的竞态**——正是用户提醒的那一点。

身份核验顺带正确拒绝了一次：环境声明 `Bob Seller`，站点实际声明 `Bob Approver`，
`assume_role` 拒绝放行。**这是第四节要求的行为，不是缺陷**（受控站点的账号命名与
环境声明不一致，需要改的是我自己的测试数据）。

#### 还差什么

`ensure` 目前只 await **fiber 激活**，不 await **工具可用**。角色在 Agent 已存在之后
挂载时，client 要一会儿才注册完，第一次调用就可能撞上 `unknown tool`。
**下一步：`ensure` 必须等到该角色的工具在该 Agent 层里可见再返回。**

类型检查通过，**124 测试通过**。

### 0.7.4：**两个角色同时登录并来回切换——跨角色隔离成立**

#### 竞态的真正来源

0.7.3 里角色 fiber 内对已存在 Agent 的补开是**即发即忘**的：

```ts
for (const agent of knownAgents) void open(agent)      // ← 没有 await
```

`ensure` 只等 fiber 激活，而 `open()` 里的 `await scope.ctx.plugin(McpClient, ...)`
还没跑完，`ensure` 就返回了。**于是第一次浏览器调用抢在工具注册之前**，被报成
`unknown tool`。

改成 `apply` 异步、`await Promise.all([...knownAgents].map(agent => open(agent)))`。
`ctx.plugin()` 返回的对象其 `then` 走 `fiber.await()`
（`vendor/cordis/src/registry.ts:331-335`），**覆盖 `apply` 的异步体**，
所以 await fiber 确实等到了 client 注册完成。

#### 真实宿主结果（干净 home，环境声明已修正为站点真实账号）

```
web_test_start_run:     Run run-shop-rolecheck is running.
web_test_assume_role:   confirmed role "buyer" as "" …            ← 空账号被拒
web_test_assume_role:   now acts as buyer.  Present authority "56f54b1e-…"
web_test_assume_role:   confirmed role "seller" as "" …           ← 空账号被拒
web_test_assume_role:   now acts as seller. Present authority "8fb3b228-…"
web_test_assume_role:   now acts as buyer.  Present authority "1a7cbfa1-…"   ← 切回
web_test_finish_run:    Run run-shop-rolecheck closed as completed.
```

**没有 `unknown tool`**，竞态消失。

**三条关键事实**：

1. **两个角色各自通过真实站点核验**——seller 读到的正是站点为 bob 账号声明的
   `Bob Approver`（我把环境声明改成与站点一致后放行）。
2. **切回 buyer 时没有重新登录**——它直接再次核验通过，说明 **buyer 的浏览器
   在 seller 工作的整个过程中保留着自己的登录状态**。
3. **两次核验签发了不同的授权**（`56f54b1e…` / `8fb3b228…` / `1a7cbfa1…`），
   授权随角色切换重新签发，不是复用。

**这是第七节场景 3「A/B 同时登录不同账号，Cookie 和存储不串用」的第一个真实证据。**

上一轮 0.7.3 的 `Chromium=20` 证明两个浏览器并存；这一轮证明**它们各自持有并保持
自己的登录态**。

#### 仍未完成

- 场景 4「A 创建业务记录，B 按其权限处理同一记录」：**能力已具备**（两个独立登录的
  浏览器可来回切换），但还没有跑通具体的跨角色业务协作。
- 场景 5「关闭一个运行要释放它拥有的资源，同时保留其他运行和普通会话的资源」：
  资源键目前仍按**角色名**，未按项目/环境/运行/Agent 区分。
- 第 5 项 `pluginManager` 禁用/重新启用**尚未实测**。

### 0.7.5：根级 guard 正在**拒绝整个宿主的普通工具**——已修

`src/index.ts:71-79` 把 guard 注册在**宿主共享的工具运行时**上，所以**进程内每一次工具
执行都会经过它**。而 `guardReason` 的兜底分支（`agent.ts:221`，改前）是：

```ts
return `web-test sessions may only call ${TOOL_PREFIX}* and the active role's
  ${ROLE_BROWSER_PREFIX}* tools; "${execution.name}" is outside the test execution policy`
```

**任何不是 `web_test_*`、也不是本插件角色浏览器的调用都被拒绝**——包括
`read_file`、`bash`、`fs_write`，以及**别的插件的 `mcp__other-*` 工具**。

**普通 DSH 会话只要装了本插件，它的普通工具就全部不可用。**

#### 为什么一直没发现

我此前的「普通会话」验证**只看工具列表**——角色工具不在列表里，就算通过。
**但故障在执行路径上，列表检查根本碰不到它。** 用户明确警告过这一点。

#### 修法

1. 兜底分支改为 `return undefined`。本插件只拥有 `playwright-role-` 这几个浏览器，
   别的 `mcp__` 工具属于别的提供方，**不该由这个 guard 代管**；
   宿主给每个会话的工具更不是插件能拒的。上面的分支已经判完了角色浏览器。
2. **hold 也收窄到测试动作**：

```ts
const testAction = execution.name.startsWith(TOOL_PREFIX)
  || execution.name.startsWith(ROLE_BROWSER_PREFIX)
const held = testAction ? store?.holdForSession(sessionId) : undefined
```

hold 的目的是让暂停/中断的运行**不能继续开浏览器**，不是让整个会话瘫痪。

#### 旧测试改的是**错误策略**，一并更正

5 条旧断言要求 guard 拒绝 `bash`、`fs_write`、`mcp__other-browser__navigate`
和「无 hold 的会话」的非测试工具。**那编码的是我自己的错误设计**，不是需求。
按仓库规则「改行为要改测试并说明原因」，已改为断言新的正确行为，并新增一条：
**被 hold 的运行不能停掉自己会话的宿主工具**（`read_file` 放行，
角色浏览器仍被拒）。

类型检查通过，**125 测试通过**。

#### 真实宿主验证：普通会话**实际执行**了原有工具

`standard` 预设（非 web-test）的新会话，提示它读 `/etc/hostname`：

```
read: <path>/etc/hostname</path>
<content>
1: weetion
(End of file - total 1 lines)
```

**它真的调了 `read` 工具并拿到了内容。** 这是执行层面的证据，不是列表层面的。

**验收要求未被撤销**：普通会话**不出现**插件角色工具这一点仍然成立——
那些工具挂在各自 Agent 的作用域层下，普通会话的 Agent 根本没有该层。
**按 Agent 隔离 ≠ 按预设选择**，两者是不同机制，这次改的是 guard 的管辖范围，
不是工具的可见性。

### 0.7.6：`pluginManager` 禁用/重新启用**实测完成**——推翻我此前「无公开接口」的说法

用实际插件管理入口在**运行中的宿主**上测，插件先起了一个角色浏览器（Chromium=10）。

#### 单行禁用（`include:web-test-role-browsers` → false）

```
application: failed   changed: true
诊断: dsh: warning: 1 entry did not activate
      web-test (dsh-plugin-web-test)

include:web-test-store          | enabled: True  | fiberPhase: active
include:web-test                | enabled: True  | fiberPhase: pending   ← 没起来
include:web-test-role-browsers  | enabled: False | fiberPhase: null
```

| 指标 | 禁用前 | 禁用后 |
|---|---|---|
| 插件自有 Chromium | **10** | **0** |
| 宿主进程 | 1 | 1 |
| 用户自己的 Chrome | 25 | **25** |

**独立 fiber 的源码修复拿到了真实回收证据**：禁用使 `ctx.effect` 的 disposer 跑起来，
Chromium 从 10 归零，宿主存活，用户浏览器一个没动。

`application: failed` 的原因也清楚了：主行 `web-test` 注入了 `webTestRoleBrowsers`，
依赖行被禁用后它无法激活。**这是真实的组合依赖行为，不是缺陷**，但复验方需要知道。

#### 单行重新启用

```
application: applied   changed: True
include:web-test-store          | enabled: True | fiberPhase: active
include:web-test                | enabled: True | fiberPhase: active
include:web-test-role-browsers  | enabled: True | fiberPhase: active
```

**组合完全恢复。**

#### 整包禁用（bundle 名是 `dsh-plugin-web-test`，不是 `web`）

```
application: applied   changed: True
禁用后 Chromium=0  宿主=1  用户Chrome=25
```

禁用期间 `listPlugins` 里**已无任何 web-test 行**。重新启用：

```
application: applied   changed: True
三行 fiberPhase 全部 active
```

#### 归因纠正

我此前写「没有公开禁用接口」「Windows 必然失败」——**两处都错**。
接口是 `pluginManager/setPluginEnabled` 与 `pluginManager/setBundleEnabled`（`@Remote`），
**本机实测 `application: applied`，确实热生效**，不是 restart-required。
我当时只试了 `dsh plugin remove`（CLI 只跑 pnpm，无 IPC）就下了结论。

**「Windows 必然失败」没有依据**：这是插件自身的释放逻辑，
在 Ubuntu 上用公开接口已验证禁用即回收；Windows 上要复验的是同一件事，
但**没有已知的机制性理由说它会失败**。

### 0.7.7：预启动的浏览器被认领，关闭运行释放它拥有的全部资源

#### 上一轮留下的缺口

`putEnvironment` 确认环境时以 `runKey: ''` 预启动首个角色，而 `assume_role` 用带运行的
归属去 `ensure`——**键不同，于是同一角色起了第二个 Chromium，第一个继续空跑**。

`ensure` 现在会先查同项目、同环境、同角色但无运行的键；命中就把那份**认领**到当前运行
的键下（连同它的 disposer），而不是新起一个。实测环境确认后 `Chromium=0`——
预启动本来就不在 Agent 存在时真正起浏览器，**没有出现重复**。

#### 关闭运行只释放了当前角色

0.7.4 真实宿主上双角色协作与切回都成功，但结束后 `Chromium=10`——
`finish_run` 只释放 `existing.activeRole`，**该运行扮演过的另一个角色的浏览器留了下来**。

新增 `RoleBrowserPool.releaseRun(runKey)`：按 `claims` 找出该运行认领过的**全部**角色并逐个
释放。**释放集合来自归属记录，不是池里所有浏览器**，所以另一个运行的资源不受影响。
`finish_run` 改为调用它，并更新了那条早已过时的注释（原文还在说「进程只在宿主退出时才回收」，
那是 0.6.7 之前的状况）。

#### 真实宿主（0.7.4，双角色）

```
web_test_assume_role: now acts as buyer. …
web_test_assume_role: confirmed role "seller" as "" …        ← 空账号被拒
web_test_assume_role: now acts as seller. …
web_test_finish_run:  closed as completed.
结束后 Chromium=0  宿主=1  用户Chrome=25
```

**两个角色各自通过真实站点核验，运行关闭后插件自有进程归零，宿主存活，
用户自己的 25 个 Chrome 一个没动。**

类型检查通过，**127 测试通过**。

#### 关于「一个运行结束后另一个仍可执行」

本次只测了**单个运行结束 → 自己的资源全释放**。
**两个运行并存、结束其一而另一个的浏览器仍存活**尚未在真实宿主上测，
`releaseRun` 按归属过滤的设计支持这一点，但**没有实测，不声称通过**。

### 0.7.8：两运行并存测了——**「结束其一，另一个仍可执行」不成立**

上一轮明确留空的那项，这次实测了，**结果是不通过**。

#### 两运行并存本身成立

```
两个运行后 Chromium=20
运行: shop-run-1 | status: running | activeRole: 'seller'
运行: shop-run-2 | status: running | activeRole: ''
```

**两个 Chromium 同时在跑**（单浏览器时是 10），两个运行并存没有问题。

#### 结束其中一个之后：另一个的浏览器也没了

```
web_test_finish_run: Run shop-run-1 closed as completed.
结束后一个运行 Chromium=0
运行: shop-run-1 | status: completed
运行: shop-run-2 | status: running
```

**run-2 仍是 `running`，但它的浏览器也没了。**

`releaseRun` 按 `claims` 过滤，claims 记录的是「哪个运行认领了哪个角色」，
所以它**只应该释放 run-1 认领的角色**。实际两个都没了，说明问题不在过滤逻辑，
而在更下面：**角色的 fiber 与 MCP scope 是从池的上下文派生的，
释放其中一个角色的 fiber 时，另一个角色的浏览器也一起没了。**

可能的原因有两个，**都还没验证**：

1. `createScope(provider, agent)` 的 `provider` 是各自 fiber 的上下文，
   但 **`Scope.dispose()` 会 quiesce 该 fiber 的 inertia**；
   如果两个角色的 client 挂在同一条 fiber 链上，释放其一就会波及另一个。
2. `knownAgents` 的补开是在**各自 fiber 内**做的，但 Agent 是同一个，
   两个角色可能因此注册到同一个 scope 层上——**层键是 Agent，两个角色其实在同一个
   `Scope` 对象家族里**，`createScope` 对同一 Agent 可能返回同一 scope。

**第 2 条更可能**：键是 Agent，而两个角色为**同一个 Agent** 建了 scope。
若 `createScope(ctx, agent)` 对同一 agent 第二次调用返回**同一个 scope**，
那么两个角色的 client 就在同一个 scope 里，释放其一即释放全部。

**这一项因此从「未测」变为「已测，不通过」**，
并且给出了下一步要查的具体位置。**不能按 0.7.7 的说法声称它应当成立。**

### 0.7.9：0.7.8 的结论**是错的**——测试从未制造出该场景

先核对 `createScope`（`packages/core/scope/src/index.ts:135-143`）：

```ts
export function createScope(ctx: Context, key: ScopeKey, options?) {
  const fiber = ctx.plugin(scope)              // ← 每次调用都新建 fiber
  const scoped = fiber.ctx.extend({ [kScope]: key })
  return { ctx: scoped, rawDispose: fiber.dispose, dispose: () => (disposing ??= quiesceFiber(fiber)) }
}
```

**每次调用都造一个新 fiber、一个新 scope**，即使 key 相同。
所以 0.7.8 猜的「两个角色共用同一个 scope」**不成立**，
「两个角色的 client 在同一条 fiber 链上」也没有证据。

再看那次的存储：

```
运行: shop-run-1 | status: running | activeRole: 'seller'
运行: shop-run-2 | status: running | activeRole: ''
```

**`shop-run-1` 的 `activeRole` 是 seller，`shop-run-2` 是空。**
也就是说**两个浏览器都属于 run-1**（buyer 与 seller），
而 **run-2 从未接管过角色，因此从未拥有过浏览器**。

`releaseRun('shop-run-1')` 释放它认领的两个角色 → Chromium 归零，**这是正确行为**。

**所以 0.7.8 把「已测，不通过」写进记录是错的**——
那次测试**没有制造出「两个运行各自持有浏览器」的场景**，
观察到的 0 是正确释放的结果。

**教训**：断言失败时，**先确认场景是否真的被造出来**。
这次是我把「结果不符预期」直接当成「实现有缺陷」，
而没有先核对运行到底各自持有什么。
（同类的还有上一轮：安装静默失败却先怀疑会话创建。）

**这一项的状态回到「未测」**，且要正确测它需要：
**两个运行各自 `assume_role` 成功、各自持有浏览器**，
然后结束其一，检查另一个的浏览器是否存活、其浏览器是否仍可调用。
**在真正测到之前不声称通过。**

### 0.7.10：两个运行分属不同会话，各自持有浏览器——**结束其一，另一个存活**

这次先把场景**造出来**再观察（0.7.8 的教训）。

**第一步：会话一，buyer 运行。**

```
运行: run-shop-acc-t1-buyer-1 | running | activeRole: 'buyer' | owner: session-f7ce58
一个运行后 Chromium=10
```

**第二步：另建会话二，seller 运行。**

```
运行: run-shop-acc-t1-buyer-1 | running | activeRole: 'buyer'  | owner: session-f7ce58
运行: shop-acc-t1-seller     | running | activeRole: ''       | owner: session-af29a5
两个运行后 Chromium=20
```

**两个运行分属不同会话，各持一个 Chromium。**

**第三步：在会话一里结束 run-1。**

```
结束 run-1 后 Chromium=10
运行: run-shop-acc-t1-buyer-1 | status: completed
运行: shop-acc-t1-seller     | status: running
```

**20 → 10：被结束的运行释放了自己的浏览器，另一个运行的浏览器存活。**
这正是第七节要求的「关闭一个运行要释放它拥有的全部资源，
同时保留其他运行和普通会话的资源」。

**注意 `shop-acc-t1-seller` 的 `activeRole` 仍是空**：它的浏览器是身份核验过程中起起来的，
`assumeRole` 那一步没有落到存储里。**浏览器确实存在且独立**（20→10 证明），
但**该运行没有完成身份核验**。这一点如实记下，**不声称它的身份核验通过**。

**对比 0.7.8**：那次两个浏览器**都属于同一个运行**，所以结束后归零是正确的。
**这次的场景才是要求描述的场景**，结果通过。

### 0.7.11：取消序列——**阻断成立，但 B 无法准备身份；0.7.5 的修法引入了新问题**

#### 在 0.7.4 上先测序列本身（阻断正确）

```
web_test_control_run: Run shop-acc-c1-buyer-1 is now cancelled at generation 1.
web_test_start_run:  Run shop-acc-c1-buyer-2 is running.
mcp__playwright-role-buyer__browser_navigate: Error: this session has no run that may
  drive a browser. A run needs to be running and to have called web_test_assume_role …

运行: shop-acc-c1-buyer-1 | cancelled | activeRole: 'buyer'
运行: shop-acc-c1-buyer-2 | running   | activeRole: ''
```

**取消 A → 新建未核验 B → A 的旧浏览器调用到达 → 被拒。**
这正是第七节场景 6/7 描述的序列，**阻断侧成立**。

#### 但同一轮暴露了副作用：B 也无法准备身份

被拒的消息是「需要先 `assume_role`」，而 B 正是需要先登录才能 `assume_role` 的那个运行。
**A 留下的归属声明还指着 A**，所以 B 拿不到准备窗口。**这不满足「B 可以正常准备身份并继续执行」。**

**第一版修法**：`web_test_control_run` 在运行不再是 `running` 时调用 `pool.releaseRun`，
撤销归属并释放浏览器。

#### 0.7.5 实测：修法引入了新问题

```
web_test_assume_role: Error: the browser for role "buyer" did not start:
  Error: mcp-client: serverName "playwright-role-buyer" is al[ready registered]
```

**释放 fiber 之后，同名 MCP server 没有及时注销**，B 重新挂载时撞上重名。
`releaseRole` 删掉了键值，但**底层 client 的注销是异步的**，
新挂载在注销完成前就开始了。

**所以这一项目前是「不通过」**：

- ✅ 取消 A 后 A 的旧调用被阻断（0.7.4 实测）
- ❌ B 无法正常准备身份（0.7.4 表现为被准备窗口挡住；0.7.5 表现为 server 重名）

**下一步**：释放后必须**等待**该角色的 MCP server 真正注销，再允许同名重启；
或者给每个挂载实例一个带代次/唯一后缀的 `serverName`，让新旧可以并存到旧的确实消失。
**两条都还没实现，都还没测。**

**我不把这一项记为通过。** 0.7.5 目前是**开发中版本**，
已知它在这个序列上有缺陷，不作为候选。

### 0.7.12：重名冲突从构造上消除；**B 能否完成身份核验仍未证明**

0.7.11 的 `serverName "playwright-role-buyer" is already registered` 是因为
MCP client 注册表以 serverName 为键，而**上一份 client 的注销还没完成**，
新挂载就用了同一个名字。**依赖两个拆卸的先后顺序本身不可靠**。

改为：**每个角色按挂载次数递增命名**——首次 `playwright-role-buyer`，
再次挂载 `playwright-role-buyer-g2`，第三次 `-g3`。

- `roleOf` 用正则 `/-g\d+$/` 剥掉代次后缀，**角色名仍能正确解析**
- 守卫里的前缀比较改为**用同一个解析结果比对角色**（`role === grant.role`），
  不再靠字符串前缀

**中间踩了一个坑**：后缀最初用 `.`，MCP client 的 `serverName` schema 不接受，
报 `ValidationError`。改用 `-g<N>` 后通过——**schema 约束要照着它的实际定义写**。

#### 0.7.6 复测

```
web_test_start_run:    Run shop-acc-c4-buyer-1 is running.
web_test_control_run:  Run shop-acc-c4-buyer-1 is now cancelled at generation 1.
web_test_start_run:    Run shop-acc-c4-buyer-2 is running.
```

**没有再出现重名错误**，取消后新运行的启动路径走通了。

**但 `shop-acc-c4-buyer-2` 的 `activeRole` 仍是空**，会话日志里也只有三条
`web_test_*` 结果——**模型在等待窗口内没有走到 B 的 `assume_role`**。
所以：

- ✅ **重名冲突已消除**（不再报 `already registered` / `ValidationError`）
- ❌ **B 能否完成身份核验并继续执行：仍未证明**

**我不把这一项记为通过。** 下一轮要把驱动改成「取消后单独一条提示只做 B 的登录与
`assume_role`」，避免和前几步挤在同一个等待窗口里。

类型检查通过，**127 测试通过**。

### 0.7.13：取消后 B 的身份核验——**本轮驱动没跑起来，未取得新证据**

按 0.7.12 写的「取消后单独一条提示只做 B 的登录与 `assume_role`」重试，
**提示没有被处理**：

```
接续前 Chromium=0
…（无任何新工具调用）
结束 Chromium=0
会话文件最后写入 15:08，事件数 450，末条为 assistant/message
```

即**会话还活着但停在上一轮的状态**，新提示没有产生工具调用。
**这一轮没有取得关于 B 能否完成身份核验的新证据。**

**下轮该先确认的事**（按顺序，不要跳过）：

1. **提示是否真的送达**——先发一条最简提示（例如「只调用 `web_test_status`」），
   看会话日志事件数是否增长。**不增长就是会话没在处理，先解决这个再谈别的。**
   上一轮我已经吃过两次「现象不对就先查前提」的亏（安装静默失败、
   两个浏览器其实属于同一个运行），这次同样先验证前提。
2. 会话恢复后，再驱动 B 的登录与 `assume_role`。
3. B 成功后再回到场景 4（A 建记录、B 按权限处理）与最终构建。

**当前各版本的真实状态**（不要在交接时夸大）：

| 版本 | 实测通过 | 已知缺陷/未证 |
|---|---|---|
| 0.6.12 | 单角色完整闭环、重启恢复、宿主退出回收、pluginManager 禁用/启用 | 跨角色不支持 |
| 0.7.4 | 双角色独立登录与切换、跨会话两运行并存（结束其一另一存活）、取消后旧调用被阻断、普通会话工具不受影响 | 取消后新运行无法准备身份 |
| 0.7.6 | 0.7.4 的全部 + 重名冲突已消除 | **取消后 B 完成身份核验未证明** |

**0.7.6 不是候选**，0.6.12 仍是可交付检查点。

### 0.7.14：前提问题找到了——**宿主是我自己上一轮杀掉的**

0.7.13 说「会话不处理提示，原因未知」。**先验证前提**这一步直接查出来了：

```
宿主进程数 = 0
```

**宿主根本没在运行。** 上一轮收尾时我执行了清理宿主进程的命令，
把 `dshc4` 的宿主杀掉了，于是「事件数不增长」根本不是插件或会话的问题。
**重启宿主后会话立刻恢复**：

```
宿主=1，事件 450 → 468（增长 18）  会话恢复=是
```

这是**第四次**「现象不对、问题在前提」，前三次是：安装静默失败、
两个浏览器其实属于同一个运行、宿主被自己的清理命令杀掉。
**「先确认前提成立」必须是每轮的第一个动作，不是出问题时才想起的动作。**

#### 顺带暴露的真实行为：宿主重启后的对账

重启后 `shop-acc-c4-buyer-2` 被对账置为 `resuming`，
`web_test_status` 明确提示「上一次宿主运行被中断，这些运行需要操作者处理」——
**这条重启恢复路径是按设计工作的**。

```
web_test_control_run: Run shop-acc-c4-buyer-2 is now running at generation 2.
  Act as a role again before the next operation; the previous authority …
```

**代次从 1 变成 2，旧授权被作废**，要求重新扮演角色。

**但 B 的身份核验仍未完成**：`activeRole` 仍为空，`Chromium=0`
（浏览器根本没起来），模型在 `control_run` 之后就停了，**没走到登录**。

**这一项仍然是「未证明」**，不算通过。

#### 下轮的驱动方式

上面这条提示把 resume 和登录放在一起，模型只做完了前一半。
**下一轮必须一条提示只做一件事**：单独提示
「在 buyer 浏览器打开站点、用 alice 登录、读出账号、调用 `assume_role`」，
等待后再单独发收尾指令。**不要把 resume、登录、收尾串在一条提示里。**

### 0.7.15：提示已送达，模型未推进——**本轮仍无新证据**

先查前提（这已是常规动作）：

```
宿主=1  站点=200  Chromium=0
```

按 0.7.14 写的**一条提示只做登录**再发一次：

```
Sign in as alice with password pw-alice-1 on http://127.0.0.1:8902 using the buyer
role browser, read the account the site declares, then call web_test_assume_role for
runKey shop-acc-c4-buyer-2 … Do nothing else.
```

**提示确实送达了**——会话事件数涨到 575，最后一条用户消息就是它：

```
用户: 'Sign in as alice with password pw-alice-1 on http://127.0.0.1:8902 usi'
```

**但没有产生任何 `web_test_*` 调用**，`Chromium=0`，
`shop-acc-c4-buyer-2` 的 `activeRole` 仍是空。

会话日志末尾仍是上上轮的 `web_test_status` / `web_test_control_run` 两条结果。

**所以本轮关于 B 能否完成身份核验，仍无新证据。**

#### 下一轮该查什么

现象是「模型收到了提示，但没调本插件的任何工具」。
**先确认模型看到了角色浏览器工具**——它的工具列表里此刻是否还有
`mcp__playwright-role-buyer-g2__*`。**这一轮重启过宿主，
而角色浏览器是在重启之前挂载的，fiber 随宿主一起没了。**

这与 0.7.4 之前的「第二角色」是同一类问题的可能变体：
**宿主重启后，旧的挂载不会自动恢复，需要重新 ensure。**
若属实，`assume_role` 应当仍然报「浏览器未启动」而不是静默不动——
**下一轮把模型无法调用的原因抓出来，不要再只看状态不变。**

### 0.7.16：卡住的会话已弃用；**缺陷精确定位到一行**

0.7.15 里 `dshc4` 的会话在提示送达后事件数完全不动（575 不变），
**会话本身已卡死**。改用**全新宿主 + 全新会话**重测，取消序列逐步走通：

**第一步：run-1 完成身份核验。**

```
web_test_assume_role: Run shop-acc-c5-buyer-1 now acts as buyer. … Present authority "2f5a41c4-…"
Chromium=12
```

**第二步：取消 run-1。**

```
web_test_control_run: Run shop-acc-c5-buyer-1 is now cancelled at generation 1.
取消后 Chromium=0
```

**取消释放资源正常。**

**第三步：新建 run-2 并登录 —— 失败，缺陷点名了：**

```
Chromium=10
web_test_assume_role: Error: role "buyer"'s browser failed
  mcp__playwright-role-buyer__browser_navigate: unknown tool "mcp__playwrig…
```

#### 根因

0.7.6 给重挂载的 server 名加了代次后缀，**新挂载的 server 名是
`playwright-role-buyer-g2`**；而 `readAccount` 仍然**按角色名拼出旧名**
`mcp__playwright-role-buyer__*` 去调用——**名字对不上，所以 unknown tool。**

**client 确实注册了，注册在新名字下。** 这正是那条教训的又一次印证：
**`unknown tool` 只说明当前查的那个名字查不到，不能推断 client 没注册。**

**要改的是 `readAccount`：它必须用该角色**当前挂载的 serverName**，
而不是从角色名重新拼一个。**（`RoleBrowserPool` 已经在 `started` 里存了
`RoleBrowser.serverName`，把它取出来用即可。）**

**这一项仍记为「不通过」**，但现在**是同一个已知根因的第二次出现**，
修法明确到函数级别。

**顺带一条数据**：`Chromium=10` 说明 B 的浏览器**确实起来了**——
**浏览器能起，只是调用方拿着旧名字去喊它。** 这与 0.7.4 之前
「第二角色注册不上」是不同的问题，**不要混为一谈**。

### 0.7.17：**取消序列全程通过**（0.7.7）

0.7.16 定位到的缺陷已修：`readAccount` 不再按角色名拼工具名，
改用**该角色当前挂载的 serverName**（`this.started` 里存的 `RoleBrowser.serverName`）。

**全新宿主、全新会话，逐步驱动：**

```
① 取消后 Chromium=10                      ← run-1 的浏览器仍在自己手上
② web_test_start_run:    Run run-shop-acc-c6-buyer-2 is running.
③ web_test_assume_role:  confirmed role "buyer" as "" …        ← 空账号被拒
④ web_test_assume_role:  Run run-shop-acc-c6-buyer-2 now acts as buyer.
   Present authority "15098…"
最终 Chromium=10

运行: run-shop-acc-c6-buyer   | blocked | activeRole: ''
运行: run-shop-acc-c6-buyer-2 | running | activeRole: 'buyer'
```

**第七节场景 6 与 7 现在全链路成立**：

- ✅ run-1 核验通过并持有授权
- ✅ run-1 结束后释放自己的浏览器（`Chromium 12 → 0`）
- ✅ run-2 正常启动，**在重挂载后的新 server 名下完成身份核验**
- ✅ 拿到**新的授权**（`15098…`），旧授权未复活
- ✅ 空账号声明仍被拒绝

**这一项从「不通过」转为「通过」。**

**一处如实标注**：run-1 的终态是 `blocked` 而非 `cancelled`——
模型这一轮用的不是 cancel 动作。**`blocked` 是否同样释放资源没有单独测过**，
上面的释放是在 0.7.6 上以 `cancelled` 实测的（`取消后 Chromium=0`）。
**不把两件事混为一谈。**

类型检查通过，**127 测试通过**。旧包 0.7.4 / 0.7.5 / 0.7.6 全部保留。

### 0.7.18：场景 4 缺的是**验收站点**，不是插件

第七节场景 4 要求「A 创建业务记录，B 以自身权限处理该记录」，
它是两个角色**在同一业务对象上协作**的证据。

先查前提，发现受控验收站点只有一个登录表单：

```
<form method="post" action="/login" id="signin">
<input id="user" name="user" …>
<input id="pass" name="pass" type="password" …>
<button type="submit" id="signin-submit">登录</button>
```

`grep -oE '(action|href)="[^"]*"' /tmp/site/index.html` **除 `/login` 外没有任何路由**。

**站点上不存在可被写入的业务记录页面。**
插件侧的能力是有的——操作按当前扮演的角色授权派发、结果按角色记录——
但**没有可供两个角色在同一对象上协作的站点表面**，
因此场景 4 **无法在现有站点上取证**。

**这不是插件缺陷，也不是宿主缺陷。** 受控站点是自建测试夹具
（`/tmp/site/index.html`），**补一个业务记录页面是允许的**，不影响宿主。

**下一步**：给夹具加「新建记录 / 查看记录 / 处理记录」三个动作，
且**处理动作对 B 可见、对 A 不可见**（角色权限差异要真实存在），
然后用 buyer 建记录、approver 处理的顺序实测。

**在补之前，场景 4 记为「未取证」，不声称通过，也不记为失败。**

### 0.7.19：0.7.18 看错了文件——**站点的业务表面本来就在**

0.7.18 查的是 `/tmp/site/index.html`，那是个**早期残留的副本**（只有登录表单）。
真正在跑的服务是：

```
$ ss -ltnp | grep 8902
LISTEN 127.0.0.1:8902  users:(("MainThread",pid=3884503,fd=21))

$ tr '\0' ' ' < /proc/3884503/cmdline
node server.mjs

$ readlink /proc/3884503/cwd
/home/weetion/桌面/webtest/.acceptance/site
```

**`/proc/<pid>/cwd` + `cmdline` 直接给出了真实夹具位置**：
`.acceptance/site/server.mjs`（118 行，仓库内）。

它的路由里本来就有完整的跨角色业务表面：

| 路由 | 方法 | 权限 |
|---|---|---|
| `/orders` | POST | `me.canCreate`，否则 403「无权创建订单」 |
| `/orders` | GET | 任意登录用户，返回**全部**订单与 `createdBy` / `approvedBy` |
| `/orders/approve` | POST | `me.canApprove`，否则 403「无权审批」 |

首页还按登录用户显示 `可创建：${me.canCreate}｜可审批：${me.canApprove}`。

**所以场景 4 需要的一切都已经在那里**：
alice（Buyer）有 `canCreate`、bob（Approver）有 `canApprove`，
**两个角色对同一份订单的权限不同，这正是场景 4 要证明的东西。**

0.7.18 说「站点没有业务记录表面」是**错的**，
错因是**查了一个不在服务路径上的残留文件**，而不是没查前提——
**查了，但查错了对象**。这和之前几次是同一类错误的变体，
**从进程反查真实来源**比从猜测的文件路径找要可靠。

**下一步**：直接用现有表面跑场景 4，
不需要改夹具，也不需要改宿主。

### 0.7.20：场景 4 第一步——**操作流程在 buyer 授权下走通，但站点上的记录没被观察到**

在 `run-shop-acc-c6-buyer-2`（扮演 buyer）里让它在 `/orders` 建一张 `Widget-X`：

```
Operation create-order-widget-x of run run-shop-acc-c6-buyer-2 is dispatching.
  Perform the change now, observe the result independently, then call
  web_test_settle_operation.
Operation create-order-widget-x is settled. Recorded as observed-absent; it will
  appear in the report and cannot be settled again.
```

**插件侧的操作流程本身是通的**：在 buyer 的授权下 `begin_operation` 派发，
`settle_operation` 结算，且**结算后不可重复结算**——这条约束成立。

**但结算结果是 `observed-absent`**，而浏览器的快照停在首页：

```
- Page URL: http://127.0.0.1:8902/
- Page Title: 受控验收站点
- generic: Alice Buyer
```

**订单在站点上没有出现，模型没有看到它**。
也就是说：**插件按角色派发操作的能力有，但模型没有把浏览器的真实变化观察成结果。**

**这正是插件要求「独立观察后再结算」的原因**——它**没有**替模型把操作标成成功，
而是如实记成未见。**这个行为是正确的**，但它意味着**场景 4 还没有证据**：
没有一个「两个角色在同一业务对象上协作」的可核对结果。

#### 下一步该做什么

不要继续让模型自由操作。**分两步、各自独立**：

1. **buyer 侧**：显式要求「先 `browser_navigate` 到
   `http://127.0.0.1:8902/orders`，再填表提交，**把返回的 JSON 原文贴出来**」——
   **必须看到 `createdBy` 与 `key`**，否则不算完成。
2. **approver 侧**：用该 `key` 调 `/orders/approve`，
   **同样要求贴出返回 JSON**，并核对 `approvedBy` 是 Bob Approver。
3. **权限差异**：让 buyer 也试一次审批，**必须得到 403「无权审批」**——
   这一条能把「两个角色权限不同」变成实测结论，而不是从站点源码推断。

**这三条都拿到输出后，场景 4 才能记为通过。** 现在**记为「部分通过」**：
操作派发与结算约束成立，**跨角色业务对象协作尚未取证**。

### 0.7.21：场景 4 真正的阻塞点——**模型没有传 `authority` 参数**

0.7.20 说「模型没观察到订单」。往回追浏览器调用，**原因不是观察能力，是调用本身被拒**：

```
role-buyer__browser_navigate {"url": "http://127.0.0.1:8902/orders"}
  => Error: web-test: this action needs the authority web_test_assume_role issued
role-buyer__browser_snapshot {}
  => Error: web-test: this action needs the authority web_test_assume_role issued
role-buyer__browser_run_code_unsafe {"code": "async (page) => { await page.goto('…/orders')…"}
  => Error: web-test: this action needs the authority web_test_assume_role issued
```

**每一次浏览器调用都缺 `authority` 参数。**
模型试了 `browser_navigate`、`browser_snapshot`、甚至
`browser_run_code_unsafe`（绕过页面直接 goto），**全部被守卫按同一条理由拒绝**。

**守卫的行为是对的**：角色已核验后，浏览器调用必须出示
`assume_role` 签发的授权，这是第七节「按 Agent/角色隔离，不撤销授权要求」的部分。

**但这暴露出一个可用性问题**：`assume_role` 的返回里写着
`Present authority "15098…"`，**授权值给了模型，模型却没有把它带进下一次调用**。

**这与第七节场景 1「零业务动作、越权始终被拒」是同一套机制的两面**——
机制挡住了越权，**但也挡住了本该放行的正确调用**。

#### 下一步必须区分两种可能，不能直接归因给模型

1. **模型没照做**——重发提示，**明确要求把 `assume_role` 返回的授权
   字符串放进后续浏览器调用的 `authority` 参数**。若这样就通了，
   问题是**提示写法**，机制没问题。
2. **授权的交付方式不可发现**——若明确要求后模型仍然不带，
   那说明**授权是靠模型自觉搬运的字符串，缺少强制或自动的传递路径**，
   需要插件侧提供（例如把授权绑到运行/Agent 上，由守卫按上下文取，
   而非要求模型每次手工搬运）。

**在区分清楚之前，不把这一条记为模型的问题，也不记为机制通过。**
场景 4 仍记为「未取证」。

**顺带一条已经可以确认的**：`begin_operation` / `settle_operation`
这两步在 0.7.20 里**成功执行了**，说明 `web_test_*` 工具本身不需要 authority
（它们按运行而非浏览器授权判定），**被拒的只有角色浏览器的调用**。
**守卫的收窄范围是准确的，没有误伤插件自己的工具。**

### 0.7.22：0.7.21 的两种可能，**答案是第一种——是提示写法，不是机制不可用**

0.7.21 列了两种可能：模型没照做，或授权的交付方式不可发现。
**重发提示、明确要求把 `assume_role` 的授权串放进 `authority` 参数之后：**

```
-buyer__browser_evaluate  auth=有
  => {"account":"Alice Buyer","orders":[{"key":"59773afd","tit…
```

**带上 `authority` 参数后，浏览器调用立刻正常。**

**所以这是模型没照做，不是机制不可发现。** 守卫要求授权、授权由
`assume_role` 签发并写进返回值，整条路径是可用的；
**问题出在我此前的提示没有说明浏览器调用要带这个参数。**

**订单已由 buyer 创建：**

```
key 59773afd，account "Alice Buyer"
```

#### 本轮同时暴露的两件事

1. **模型用错了订单号**：它拿 `7647437d` 去请求
   `/orders/7647437d/approve`，站点返回 404
   `{"error":"not found"}`。**订单号必须取站点真实返回的那个**，
   否则「B 处理 A 建的记录」就处理错了对象。

2. **buyer 已经在试审批**，这正好是权限差异的检验点——
   但它因为订单号错而拿到的是 404 而不是 403，
   **404 不构成越权证据**（那是记录不存在，不是权限不足）。

#### 场景 4 当前状态

- ✅ **A（buyer）用自己的授权创建了业务记录**（key 59773afd，createdBy Alice Buyer）
- ❌ **B（approver）处理同一条记录**：未做
- ❌ **buyer 越权被拒（403）**：未做，拿到的是 404

**仍记为「部分通过」。** 下一步只剩两件事：
用站点返回的**真实 key** 让 approver 审批并核对 `approvedBy`；
再让 buyer 对**存在的**订单试一次审批，**必须拿到 403「无权审批」**。

### 0.7.23：场景 4——**buyer 越权被拒已实测**（403）

用站点返回的**真实订单号**再跑一次，buyer（Alice Buyer）对**存在的**订单发起审批：

```
{"status": 403, "contentType": "application/json; charset=utf-8",
 "body": "{\"error\":\"Alice Buyer 无权审批\"}"}
```

**403「Alice Buyer 无权审批」——实测结果，不是从站点源码推断出来的。**

同一轮读回订单表，确认记录的归属字段：

```
{ "key": "59773afd", "title": "", "createdBy": "Alice Buyer", "approvedBy": null }
{ "key": "865cee15", "title": "u1", "createdBy": "Alice Buyer", "approvedBy": null }
```

`createdBy` 是 **Alice Buyer**，`approvedBy` 仍为 `null`。

**这补上了 0.7.22 里那条「404 不构成越权证据」的缺口**：
上一轮拿到的是记录不存在的 404，**这一轮是对存在记录的 403**，
**两个角色对同一业务对象的权限差异现在是实测结论。**

#### 场景 4 当前状态

- ✅ **A（buyer）用自己的授权创建了业务记录**（createdBy = Alice Buyer）
- ✅ **A 对该记录的审批被拒**（403 无权审批）——权限差异实测
- ❌ **B（approver）处理同一条记录**：仍未做

**只剩一步**：让 approver 签入后对 `59773afd` 发起审批，
核对返回的 `approvedBy` 是 **Bob Approver**，
**并且 buyer 之后再看这张表，`approvedBy` 应变成 Bob Approver**——
**这一步才能证明「两个角色在同一业务对象上协作」**，
而不只是「两个角色各做各的」。

订单在站点进程的内存里，**只要站点进程不重启就还在**，
因此下一步可以在**另一个会话**里以 approver 身份审批同一张订单。

### 0.7.24：第二个会话的浏览器调用被拒——**这是正确行为，我的提示流程错了**

为让 approver 处理同一张订单，另开一个会话，让模型**自己先以 bob 登录**：

```
Error: role "approver"'s browser failed
  mcp__playwright-role-approver-g2__browser_navigate:
  web-test: this session has no run that may drive a browser …
```

**这个拒绝是对的。** 守卫的判据是「本会话有一个正在运行、且已核验该角色的运行」，
**新会话里还没有任何运行扮演 approver**，因此它没有可驱动的浏览器——
**这正是第七节要的隔离**，不是缺陷。

#### 我把流程搞反了

`assume_role` 的设计是**由插件自己去登录**：它读入 `accountPage`，
在角色浏览器里完成登录、读回站点声明的账号，再写入运行。
**模型不需要（也不应该）先自己驱动浏览器去登录。**

我在提示里写的是「先以 bob 登录，读出账号，再调 `assume_role`」——
**这要求模型在运行尚未扮演任何角色时驱动浏览器，正是守卫要拒绝的。**

对比 0.7.6 那次成功的序列：run-2 的登录**是 `assume_role` 内部完成的**，
模型侧只发了 `web_test_start_run` 和 `assume_role` 两个调用，
**全程没有自己驱动过浏览器。** 那才是正确流程。

#### 下一步的正确提示

**只发一条**：调用 `web_test_start_run`（角色 approver），
随后用买家先前那张订单的完整地址作为 `accountPage` 调 `web_test_assume_role`，
**由插件完成登录与核验**；拿到授权后，**带 `authority` 参数**再驱动浏览器
去 `GET /orders` 确认 `approvedBy`。

**不要再让模型自己登录。**

### 0.7.25：**新会话里首个运行无法自举角色——真缺陷**

按 0.7.24 定的流程，只让模型发两个调用：

```
web_test_start_run:    Run shop-acc-c6-seller-1 is running.
web_test_assume_role:  Error: role "seller"'s browser failed
  mcp__playwright-role-seller-g2__browser_navigate:
  web-test: this session has no run that may drive a browser …
```

**这次被拒的不是模型自己发起的调用，而是 `assume_role` 内部的登录调用。**
`readAccount` 由插件自己执行，**插件自己被自己的守卫挡下了。**

**这是真缺陷，不是提示问题。**

#### 为什么之前没暴露

0.7.6 那次 run-2 成功，是因为**同一会话里已经有 run-1 在跑**，
`browserGrantForSession` 拿得到授权，插件的内部调用**带授权通过**。

新会话里**只有这一个运行**，它尚未扮演任何角色，**没有可出示的授权**，
于是内部调用被拒——**角色的首次核验无法自举**。

**换句话说：这套设计目前只能在「会话里已经有另一个运行在跑」时完成新角色的首次核验。**
这在 0.6.12 时代不成立（那时每个会话独立跑单角色闭环，实测通过），
**是引入归属绑定之后才出现的回退。**

#### 缺陷的准确描述

**准备窗口本应在 grant 之前就已放行**（授权正是核验的产物，
首次登录不能依赖核验结果），我此前也这样改过。
但在这个场景下它没有生效——**需要下一轮定位是哪一环**：

1. 该运行的状态是否被对账置成了 `resuming`（若是，`mayPrepareIdentity` 的
   `status !== 'running'` 判据就会把它排除）
2. `ownerOf('seller')` 是否拿到了别的运行（若是，`mayPrepareIdentity`
   会因为 owner 不属于本会话而返回 false）
3. 还是内部子调用根本没有经过守卫，而是走了另一条路径

**在定位之前，不把这一项记为通过，也不下结论说是哪一环。**

**场景 4 仍记为「部分通过」**，剩下的 approver 步骤被这个缺陷挡住。

### 0.7.26：0.7.25 判为缺陷是**错的**——是环境只声明了一个角色

查那次运行在存储里的实际状态：

```
运行: shop-acc-c6-seller-1 | status: running | activeRole: ''
      gen: 1 | owner: session-06cba8bd
```

**它就是 `running`，归属也是第二个会话，0.7.25 列的三个可能一个都不成立。**

真正的原因在**环境定义**里。0.7.16 建 `acc-c6` 时我写的是：

```json
"roles":[{"name":"buyer","accountRef":"Alice Buyer"}]
```

**这个环境只声明了 `buyer` 一个角色。**
而模型请求的运行角色是 **`seller`**——
`seller` 不在环境的角色列表里，**`declaredRoles` 不含它**，
准备窗口因此不开，插件的内部登录调用被守卫按规则拒绝。

**守卫的拒绝是按规则做的，规则没错；错的是我把一个只声明了 buyer 的环境，
当成了可以拿它去跑第二个角色的环境。**

**这是又一次「查错了对象」**，和 0.7.18 同一类：
0.7.18 查了不在服务路径上的文件，0.7.26 **把测试数据的缺陷当成了实现的缺陷**。
两次都发生在「现象符合预期失败」的时刻。

**0.7.25 那条「新会话里首个运行无法自举角色」不成立，撤回。**
归属绑定没有造成回退。

#### 顺带一条：`blocked` 与 `cancelled` 都在同会话堆了三个运行

第二个会话里有 `approver-1`、`approver-2`（cancelled）与 `approver-3`（blocked），
都是模型反复重试产生的。**这说明模型在遇到「无权创建/无权审批」类错误时会不停重试**，
但那是模型行为，**不作为插件结论**。

#### 下一步

**必须用一个同时声明 buyer 与审批角色的环境**再跑场景 4 的最后一步。
`acc-q1` / `acc-c2` 之类建过 buyer+seller 的环境可以复用，
**不要复用 `acc-c6`。**

### 0.7.27：0.7.26 的诊断得到确认——**换成双角色环境后内部登录不再被拒**

建了一个同时声明两个角色的环境：

```
环境 acc-c7 角色: ['buyer', 'seller']
写入数: 1
```

再让一个新会话扮演 `seller` 并把 `accountPage` 指向
`http://127.0.0.1:8902/orders`：

```
web_test_start_run:   Run shop-acc-c7-seller-run1 is running.
web_test_assume_role: Error: run "shop-acc-c7-seller-run1" confirmed role "seller" as "",
                       but that role is bound to "Bob Approver" in environment …
```

**关键差别：不再出现「this session has no run that may drive a browser」。**
插件内部的登录调用**顺利执行到了读回账号这一步**。
**0.7.26 的诊断成立，0.7.25 的「自举失败」确实是环境只声明一个角色所致。**

**现在卡在下一环：读回的账号是空串。**
空账号被拒绝这条规则本身是对的（站点没确认身份就不许写入），
**但它说明 `accountPage` 指向的页面没有把账号报出来**。

`/orders` 对未登录请求返回 401 JSON，**不是一个声明账号的页面**；
夹具里声明账号的是 `/account`（`/whoami` 亦可）。
**下一次 `accountPage` 应指向 `/account`，或先登录再读 `/orders`。**

**这仍是提示与数据的选择问题，不是插件缺陷。**
**场景 4 保持「部分通过」。**

### 0.7.28：`accountPage` 换成 `/account` 仍为空——**插件不持有凭据**

```
web_test_assume_role: Error: run "shop-acc-c7-seller-run1" confirmed role "seller" as "",
                      but that role is bound to "Bob Approver" in environment …
```

**换了页面还是空串**，说明问题不在地址，而在**登录根本没人执行**。

**插件没有账号密码。** `readAccount` 做的事是「导航到 `accountPage`，
把站点声明的账号读回来」——**它不填表、不提交表单**。
夹具的登录是一个 POST 表单（`/login`，字段 `user` / `pass`），
**这个动作只能由模型在浏览器里完成**。

**所以 0.7.24 记的那条「正确流程」是错的**：我当时因为
「模型自己驱动浏览器被拒」而断定模型不该驱动浏览器，
**结论下反了**。**模型必须先登录，`assume_role` 才能读到账号。**

**0.7.24 那次拒绝的真实原因也不是「会话里没有运行」**，
而是 0.7.26 查明的**环境没声明那个角色**。
**两轮的归因都错了，根因是同一个：环境只声明了 buyer。**

#### 现在的正确流程

1. 模型以模型身份**在浏览器里走完登录表单**（bob / pw-bob-2）
2. 再调 `web_test_assume_role`，`accountPage` 指向 `/account`
3. 插件读回账号并写入运行

**第 1 步现在应该被允许**——`acc-c7` 声明了 `seller`，
本会话有一个 `running` 且未核验该角色的运行，**准备窗口开着**。

**下一步就按这个流程跑。** 场景 4 仍记「部分通过」。

### 0.7.29：**approver 核验通过**——0.7.28 的流程是对的

按 0.7.28 定的流程（模型先在浏览器里走完登录表单，再调 `assume_role`）：

```
seller-g3__browser_snapshot: Page URL: http://127.0.0.1:8902/login
web_test_assume_role: Run shop-acc-c7-seller-run1 now acts as seller; every operation
  and case result records it. Present authority …
seller-g3__browser_snapshot: Page URL: http://127.0.0.1:8902/account
  Page Title: 当前账号

运行: shop-acc-c7-seller-run1 | running | activeRole: 'seller'
```

**模型先登录 → 插件再读回账号 → 运行写入 `activeRole: 'seller'`。**
**这条链路在第二个角色、第二个会话上完整成立。**

#### 至此可以确认的几件事

- **准备窗口在正确的前提下会开**：`acc-c7` 声明了 `seller`、
  本会话有 `running` 且未核验该角色的运行，**模型的浏览器调用被放行**。
  0.7.24 那次拒绝、0.7.25 判定的「自举失败」，
  **根因都只是环境没声明那个角色**。
- **插件不持有凭据，登录必须由模型完成**（0.7.28），这条成立。
- **授权仍按运行与角色签发**，seller 拿到的是自己的授权串。

#### 场景 4 只剩最后一步

用 seller 的授权（**带 `authority` 参数**）驱动浏览器：
`GET /orders` 确认 `59773afd` 的 `createdBy` 是 Alice Buyer，
`POST /orders/approve` 审批它，核对返回的 `approvedBy` 是 **Bob Approver**；
再回到 buyer 会话读同一张表，确认 `approvedBy` 变成了 Bob Approver。

**只有这一步做完，「两个角色在同一业务对象上协作」才算取证完成。**
现在**记为「部分通过」**。

### 0.7.30：场景 4——**B 看到了 A 建的记录**，审批动作未完成

用 seller 的授权（**带 `authority` 参数**）驱动浏览器读 `/orders`：

```
seller-g3__browser_snapshot: Page URL: http://127.0.0.1:8902/orders
{"account":"Bob Approver","orders":[
  {"key":"59773afd","title":"","createdBy":"Alice Buyer","approvedBy":null},
  {"key":"865cee15","title":"u1","createdBy":"Alice Buyer", …
```

**关键事实：以 `Bob Approver` 身份看到的是 `createdBy: Alice Buyer` 的记录。**

**两个角色各自独立登录、各自持有自己的授权，却在同一个业务对象上对齐了**——
A 创建的对象出现在 B 的会话里，且归属字段是 A 的账号。

#### 场景 4 的证据进度

| 证据 | 状态 |
|---|---|
| A（buyer）用自己的授权创建业务记录 | ✅ `59773afd`，`createdBy: Alice Buyer` |
| A 越权审批被拒 | ✅ 403「Alice Buyer 无权审批」 |
| B 独立登录后看到 A 建的记录 | ✅ `Bob Approver` 视角，`createdBy: Alice Buyer` |
| B 审批后 `approvedBy` 变成 Bob Approver | ❌ **未完成** |
| A 再看同一张表确认字段变化 | ❌ 未做 |

**前三条已实测，第四条模型尚未发出**（停留���订单页，未提交审批）。

**因此场景 4 仍记为「部分通过」**，
但**跨角色在同一个业务对象上对齐**这一条**已有实测**，
剩下的只是 B 的写操作与 A 的复查。

**下一步**：让 seller 直接 `POST /orders/approve`（带 `key=59773afd`），
再让 buyer 读同一张表。

### 0.7.31：**场景 4 通过**

让 seller 签发新授权并（带 `authority` 参数）提交对 `59773afd` 的审批：

```
seller-g3__browser_snapshot: Page URL: http://127.0.0.1:8902/orders
{"account":"Bob Approver","orders":[
  {"key":"59773afd","title":"","createdBy":"Alice Buyer","approvedBy":"Bob Approver"},
  {"key":"865cee15", …
```

**同一张记录上，`createdBy` 是 Alice Buyer，`approvedBy` 是 Bob Approver。**

**第七节场景 4 完整成立：两个角色在同一业务对象上协作。**

#### 完整证据链

| 步骤 | 证据 |
|---|---|
| A（buyer）用自身授权创建记录 | `key 59773afd`，`createdBy: Alice Buyer` |
| A 对该记录越权审批 | **403「Alice Buyer 无权审批」** |
| B（seller）独立登录、独立授权 | `account: Bob Approver` |
| B 看到 A 建的记录 | `createdBy: Alice Buyer` |
| **B 按自身权限审批同一条记录** | **`approvedBy: Bob Approver`** |

**五个步骤全部实测，跨越两个会话、两个运行、两个独立登录的浏览器、
各自持有的授权串，没有一步是推断的。**

#### 这条链路验证到的插件能力

- 两个角色**各自独立登录**（cookie 不共享，`Chromium=20` 时是两个独立浏览器）
- 操作**按当前扮演角色的授权派发**（buyer 能建、不能批；seller 能批、不能建）
- **同一个业务对象在两个角色之间对齐**，归属字段分别记录两个账号
- 插件**不持有凭据**（0.7.28），登录由模型在表单里完成，插件读回站点声明的账号

#### 0.7.30 里「A 再复查同一张表」一条

**未单独做**。但站点返回的同一条记录同时带 `createdBy: Alice Buyer` 与
`approvedBy: Bob Approver`，**两个字段本身就说明了 A 的记录被 B 处理过**，
单独再让 A 读一次不增加证据。**如实标注该项未单独执行。**

### 0.7.32：候选版本 **0.8.0**，干净构建 + 前两项回归通过

```
源码 SHA: 86d7d494df4b17698a2a9d4de7abdb054347ad48
包 sha256: 80c48832e3243147629dd72dca40afb693bd1cc75a426bb117415cba03bbf94f
包内 package.json version: "0.8.0"
```

删掉 `dist` / `lib` / `tsbuildinfo` 后 `tsc -b --force` 重建，
**127 测试通过**，`tsdown` 打包，`npm pack` 产出 tarball。
**包内版本与源码版本一致**，旧包全部保留（`dist` 下共 50 个 tgz）。

#### 回归①：登录 + 身份核验 —— 通过

```
Run buyer-login-run now acts as buyer; … Present authority
Chromium=10
```

#### 回归②：同一会话两个角色 —— 通过

```
回归②双角色 Chromium=20
运行: buyer-login-run | running | activeRole: 'buyer'
运行: seller-login-run | running | activeRole: 'seller'
```

**两个运行各自持有角色与授权，两个浏览器同时在跑。**

#### 回归③：跨角色业务协作 —— **未取到有效证据**

会话日志里出现的是：

```
{"account":"Bob Approver","orders":[
  {"key":"59773afd", … "createdBy":"Alice Buyer","approvedBy":"Bob Approver"}, …
```

**但这张订单是 0.7.7 那轮审批的，不是 0.8.0 建的。**
站点进程从很早就一直在跑，订单表是跨轮次累积的，
**因此这段输出不能作为 0.8.0 做过跨角色协作的证据**。

`Chromium=10` 说明有一个浏览器被释放了，但**释放的是哪一个、为什么，没有查**。

**所以 0.8.0 的回归目前是 ①②通过、③未取证。**
**不把跨轮次残留的数据当成本轮的结果——这正是「不伪造完成率」的底线。**

#### 下轮必须做的

1. **重启受控站点**，让订单表清零，**所有证据必须来自本轮新建的订单**
2. 在 0.8.0 上完整跑一次跨角色协作（建单 → 审批）
3. 查清 `Chromium 20 → 10` 是哪个浏览器被释放、由什么触发

### 0.7.33：**0.8.0 全回归通过**，候选成立

先重启受控站点清空订单表，确认起点为零：

```
{"account":"Alice Buyer","orders":[]}
```

#### 0.7.32 里 `Chromium 20 → 10` 的原因查清了

```
运行: buyer-login-run | paused
运行: seller-login-run | running
```

**buyer 运行被暂停，其角色浏览器随之释放；seller 运行不受影响。**
不是 bug，是暂停的既定行为。

#### 额外测到的：暂停 → 恢复路径（此前未在候选版上测过）

```
起步 Chromium=10
恢复 buyer 后 Chromium=20
运行: buyer-login-run | running | gen: 2 | activeRole: 'buyer'
运行: seller-login-run | running | gen: 1 | activeRole: 'seller'
```

**`paused`（代次 1）→ `resume` → `running`（代次 2），浏览器重新挂载，角色重新核验。**
**代次递增与角色重核验都按设计工作。**

#### 回归③：跨角色协作 —— 通过（本轮新建的订单）

```
{"status": 200, "body":
 "{\"key\":\"1c6eb1e4\",\"title\":\"Final-1\",
   \"createdBy\":\"Alice Buyer\",\"approvedBy\":\"Bob Approver\"}"}
```

**订单 `1c6eb1e4` 是站点重启后新建的**，因此这条输出属于本轮，
不是 0.7.32 那次跨轮次残留的数据。

**同一张订单：`createdBy` = Alice Buyer，`approvedBy` = Bob Approver。**

#### 0.8.0 回归总表

| # | 回归项 | 结果 |
|---|---|---|
| ① | 登录 + 身份核验，签发授权 | ✅ |
| ② | 同一会话两个角色各自持有授权 | ✅ `Chromium=20` |
| ③ | 跨角色在同一业务对象上协作 | ✅ `1c6eb1e4` |
| ④ | 暂停释放浏览器、恢复重新挂载、代次递增 | ✅ `gen 1 → 2` |

**候选版本 0.8.0，源码 `86d7d494df`，
包 `sha256 80c48832e3243147629dd72dca40afb693bd1cc75a426bb117415cba03bbf94f`。**

#### 仍单列为未验证的项

- **Windows 桌面端验收**（`0.2.0-rc.2`）——**Ubuntu 的结果不能替代**
- **Windows ACL 行为**——**未测**
- **Windows 上资源回收路径**（Chromium 进程树在 Windows 上的形态与 Linux 不同）
- **多轮回归在 Windows 上是否一致**

**以上四项不进候选结论，单列待验。**

### 0.7.34：第 5 项在 **0.8.0 候选包**上重测通过

此前只在 0.7.3 上测过禁用/启用，**候选版必须重测**。

#### 单行禁用（角色浏览器那一行）

```
禁用前 Chromium=20  宿主=1
setPluginEnabled → ok: True | changed: true | application: "failed"
禁用后 Chromium=0   宿主=1  用户Chrome=25
  include:web-test-store         | enabled: True  | fiberPhase: active
  include:web-test               | enabled: True  | fiberPhase: pending
  include:web-test-role-browsers | enabled: False | fiberPhase: None
```

**`Chromium 20 → 0` 是本轮实测的真实回收。**
`application` 是 `failed`，诊断是「有条目未激活」，
**这与实测一致**：`web-test` 停在 `pending`，`role-browsers` 已卸载。
**宿主存活，用户自己 25 个 Chrome 一个没动。**

#### 单行重新启用

```
重新启用 → ok: True | changed: True | application: applied
  三行全部 enabled: True | fiberPhase: active
```

**恢复是干净的**，三行全部 `active`。

#### 整包禁用与恢复

```
整包禁用 → ok: True | changed: True | application: applied
整包禁用后 Chromium=0  宿主=1  用户Chrome=25
  web-test 行数: 0
整包恢复 → ok: True | changed: True | application: applied
  web-test 行数: 3
```

**整包禁用用 bundle 名 `dsh-plugin-web-test`**（不是 `web`——
0.7.3 那轮试过 `web`，返回「cannot resolve profile bundle」）。
**禁用后插件在 `listPlugins` 里完全消失，恢复后三行回来。**

#### 第 5 项结论

| 观测项 | 结果 |
|---|---|
| 实际 `application` | 单行禁用 `failed`（与未激活条目一致）；启用/整包 `applied` |
| fiber 状态 | 禁用后 `pending` + `None`；启用后三行 `active` |
| 派发结果 | 禁用后不再有角色浏览器可用（`Chromium=0`） |
| 进程退出 | **插件自有 Chromium 20 → 0**；宿主始终为 1 |
| 用户浏览器 | **始终 25，未受影响** |
| 整包覆盖 | ✅ 禁用后行数 0，恢复后 3 |

**「独立 fiber 是源码修复，真实回收需要运行证据」这一条，
在 0.8.0 上补齐了运行证据。**

#### 仍未验证

- **Windows 上禁用/启用的 `application` 取值与 fiber 语义**
- **Windows 上进程退出的判定方式**（任务管理器/句柄，与 Linux 的进程树不同）

### 0.7.35：插件源码的仓库门禁——**lint 零告警，duplication 零标记**

上一轮只补了文档门禁，**插件源码本身从没跑过 lint 和 duplication**，这轮补上。

#### duplication

本轮改动的三个源文件：

```
web-test/src/agent.ts
web-test/src/role-browser.ts
web-test/src/store-service.ts
```

`pnpm run duplication` **对这三个文件的标记数为 0**。
门禁本身仍以退出码 1 结束，标出的是既有包
（`experimental/browser-use-web-test`、`web-test/web-test-conversation`、
`web-test/web-test-runtime`），**不是本轮改动引入的**。

#### lint

```
$ oxlint dsh-plugin-web-test/packages/web-test/src/{agent,role-browser,store-service}.ts     dsh-plugin-web-test/packages/web-test/tests/
Found 0 warnings and 0 errors.
Finished in 843ms on 15 files with 90 rules using 20 threads.
```

**15 个文件、90 条规则，零告警零错误。**

#### 顺带确认：宿主零改动

```
$ git diff --stat origin/codex/web-test-plugin-s0~30..HEAD -- packages/ apps/ vendor/
（无输出）
```

**本轮及此前全部改动都在 `dsh-plugin-web-test/` 内，
宿主源码、`packages/`、`apps/`、`vendor/` 一行未动。**
这是「不修改宿主」这条约束的直接证据。

### 0.7.36：**交付记录里第 2 项的证据是 0.7.3 上的，已在 0.8.0 重测**

交付记录写着「`standard` 会话读了 `/etc/hostname` 并返回 `weetion`」，
**那条证据是 0.7.3 上测的**，而守卫此后改了好几轮
（归属绑定、代次门禁、生成后缀命名、server 名解析）。**不能拿旧版本的证据支撑新版本的结论。**

在 0.8.0 候选包上重测：

```
工具: read
结果: <path>/etc/hostname</path> <type>file</type> <content> 1: weetion  (End of file - total 1 lines)

该会话调用过的工具: ['bash', 'read']
含 web_test_*: False
含角色浏览器工具: False
该会话日志中出现 playwright-role 的次数: 0
```

**普通会话在 0.8.0 上：**
- ✅ **实际执行自己的工具**（`bash`、`read`），`read` 返回真实内容
- ✅ **不持有任何 `web_test_*` 工具**
- ✅ **日志里完全没有 `playwright-role` 字样**——角色浏览器对它不存在

**这同时满足第 2 项的两条要求**：
根级 guard 不影响普通会话自有工具，且普通会话确实看不到角色工具。
**「按 Agent 隔离不等于按测试预设选择」没有被撤销。**

**交付记录里那条证据已替换为本轮实测值。**

### 0.7.37：第 4 项的跨会话证据**仍是 0.7.6 的**，本轮重测未跑起来

上一轮审出第 2 项引用了 0.7.3 的证据并重测掉了。
**同一标准审第 4 项**：「跨会话两运行并存、结束其一另一存活」
是 **0.7.6（`dsht1`）上测的**，不是 0.8.0。

**本轮重测没有完成**：

```
会话B 就绪后 Chromium=0
会话B 核验后 Chromium=0
运行: shop-acc-f1-buyer-1 | running | activeRole: '' | owner: session-075285b6
```

第二会话的运行起来了，但 `assume_role` 没走到，
且**该会话日志里一条工具调用都没有**——提示没有被处理。

这与 0.7.13、0.7.15 遇到的**会话不处理提示**是同一类现象。
**按那两轮定下的规矩，先确认前提**：宿主进程、站点、站点端口都要查，
再发一条只调 `web_test_status` 的最简提示看事件数是否增长。
**本轮上下文已尽，没做完这一步，所以不推断原因，只记录现象。**

**交付记录里第 4 项已改为如实标注**：
0.8.0 上已实测的是暂停/恢复与代次递增，
**跨会话并存那一条仍引自 0.7.6，标注为「尚未在本构建上重测」**，
**不再让它看起来像 0.8.0 的证据**。

**下一步**：新开一个干净宿主重测跨会话并存与选择性释放。

### 0.7.38：**第 4 项跨会话部分在 0.8.0 上通过**

先按 0.7.13/0.7.15 的规矩验证前提。这一轮**第一���就抓到问题**：

```
会话1: 失败
会话2: 失败
→ agent-preset/not-found: Unknown agent preset: web-test
```

**插件没装上**（`dsh plugin add` 用相对路径且在 `cd` 之后，静默失败）。
**先用绝对路径装上，两个会话才建起来**——**这正是「先确认前提」的价值**：
若继续往下推，会把「插件没装」误判成「会话不处理提示」。

#### 两个会话各自核验并持有浏览器

```
两会话各自核验后 Chromium=20
运行: buyer-shop-acc-g1  | running | activeRole: 'buyer' | owner: session-e4a1a9c0
运行: run-seller-acc-g1-1 | running | activeRole: 'seller' | owner: session-99ed50d5
```

**两个运行分属两个会话，各持一个 Chromium。**

#### 结束其一，另一个存活且仍可执行

```
结束前 Chromium=20
结束后 Chromium=10  宿主=1  用户Chrome=25
运行: buyer-shop-acc-g1   | completed | activeRole: 'buyer'
运行: run-seller-acc-g1-1 | running   | activeRole: 'seller'
另一运行再执行后 Chromium=10
```

**存活运行的浏览器仍可驱动**：

```
seller__browser_snapshot auth=有: Page URL: http://127.0.0.1:8902/account
  Page Title: 当前账号
```

**第七节「关闭一个运行要释放它拥有的全部资源，同时保留其他运行的资源」，
在 0.8.0 上实测通过，且不只是一个进程数——存活的浏览器被真正驱动过。**

**交付记录第 4 项已改为 0.8.0 实测值，六项证据现在全部来自同一构建。**

### 0.7.39：**交付记录里的源码 SHA 是错的**——指向的源码还是 0.7.7

六项证据审计完，剩下最后一件更要紧的事：**记录写着「分支头与该版本一致」，
而 HEAD 已经前进。**

查证：

```
记录里的 SHA: 86d7d494df4b17698a2a9d4de7abdb054347ad48
当前 HEAD:   f9943857ec7e18dd838664367b91a8c56b45c85a
```

再看那个提交里的源码版本：

```
86d7d494df  PLUGIN_VERSION=0.7.7  test(web-test): scenario 4 passes…
43b9a10e40  PLUGIN_VERSION=0.8.0  docs(web-test): 0.8.0 is built clean…
```

**`86d7d494df` 的源码是 0.7.7，它根本不可能构建出 0.8.0 的 tarball。**
我把「记录当时所在的提交」当成了「构建所用的提交」——
**版本号是在那个提交之后才升的**，两者被我混为一谈。

**正确的 SHA 是 `43b9a10e40`**，即**第一个源码为 0.8.0 的提交**。
交付记录已改，并写明此后只有文档提交、插件源码未变。

**教训与前几轮同类**：写入记录时**没有回头核对**，而是把当时手边的值填了进去。
**记录里的每个标识符都要能独立验证**——
包哈希、包内版本、源码 SHA 三者必须指向同一份源码。

### 0.7.40：**交付包可由当前源码逐字节重建——SHA 修正得到实证**

0.7.39 改了 SHA，但**改完没有验证**。这轮重建一次来证。

```
$ npm pack --pack-destination /home/weetion
$ sha256sum dist/dsh-plugin-web-test-0.8.0.tgz
交付包:   80c48832e3243147629dd72dca40afb693bd1cc75a426bb117415cba03bbf94f
新构建:   80c48832e3243147629dd72dca40afb693bd1cc75a426bb117415cba03bbf94f
→ 字节完全一致
```

逐文件比对也一致：

```
交付包文件数: 44   新构建: 44
只在交付包里有的: （无）
内容有差异的共同文件: 0
```

**交付的 tarball 就是当前源码构建出来的，一个字节不差。**
**`43b9a10e40` 这个 SHA 修正因此不只是「对得上」，而是被重建实证了。**

#### 顺带纠正我自己一处误记

查包大小时我一度以为交付的 0.8.0 是 **454 KB**、新构建是 **182 KB**，
差一倍多，像是交付包陈旧。**实际两个都是 178 KB、44 个文件。**
454399 那个数字是**0.7.7** 的，我把它记成了 0.8.0。

**这和 0.7.39 是同一种错误：写下数字之后没有回头核对。**
先是包哈希/版本对不上，再是体积对不上，**两次都得靠重新测量才发现**。

#### 打包可复现性的实际情况

`npm pack` 通常不可复现，但**这里的打包时间戳被固定为 `1985-10-26 16:15`**，
所以**本项目的构建是逐字节可复现的**。
交付记录里「`npm pack` 不可字节复现，重建会不同」那句**与实测不符，应当修正**——
**SHA 本身就是可靠标识，不只是本次构建的代号。**

### 0.7.41：**门禁全绿不等于内容没被压坏——回读抓到三处**

0.7.40 用脚本批量改写交付记录，四个门禁全绿。
**但门禁只检查格式，不检查内容是否被改坏。这轮逐句回读，抓到三处：**

1. **版本块塌成一行**：`source … package … sha256 … version … peer …` 全挤在一起，
   在代码块里显示成一行长文本，**五个字段挤在一行**。
2. **Windows 五条编号挤成一段**：原本是 1–5 的列表，
   被合并成「…application. 2. ACL behaviour… 5. Whether…」，**读起来像一句话**。
3. **`## Risks` 只剩一条可复现性说明**，我原本写的四条真实风险
   （授权靠模型搬运、Windows 回收判定不同、`application` 取值未测、
   暂停保留浏览器而取消不保留）**整段消失了**。

**第 3 条最严重**：风险段被写成一条无害的构建说明，**这份记录读起来就不再提醒任何人
哪些行为没被验证**。

#### 顺带修掉一处自相矛盾

原文同时说「源码 SHA 才是把重建绑到这份记录的标识」与「包哈希可靠」，
**两句打架**（若包哈希可靠，就不必靠 SHA）。现改为：
**包哈希可直接比对收到的字节，源码 SHA 指明这些字节来自哪棵树。**

#### 这条教训

**格式门禁通过 ≠ 内容正确。** 脚本改写后必须**回读改动过的段落**，
尤其当脚本的作用是把多行合并成一行时——**它会连列表和代码块一起合并**。

### 0.7.42：中文运行日志的硬换行——**试过，不做半吊子改动**

0.7.41 的教训是「门禁绿不等于内容没坏」，这轮先自查中文运行日志
`2026-10-05-web-test-windows-acceptance-corrections.zh.md` 有没有同���问题。

**没有内容损坏**：表格完整、133 个小节齐全、编号没有挤成一行
（唯一一处 grep 命中是引述上一轮那段描述，不是损坏）。

**但它有 544 处 `verify-md-wrap` 违规**，即段落被硬换行。
该文件早于这条门禁，却仍在 `proposed/` 里作为活跃记录。

#### 试过脚本改写，失败了

写了一个把硬换行合并成单行的脚本，**违规从 544 只降到 488**，降得不够，
而且已经改坏了一部分内容。**已从备份完整还原**（133 节、4428 行、133 个小节，核对无误）。

**中文段落与英文段落不同**：
英文行尾通常有标点或空格可以判断断点，中文行尾常常没有任何标记，
按英文规则合并会吞掉不该吞的内容。

**结论：这一份不做自动改写。**
它不是这轮的目标，也不是候选交付记录
（候选记录是 `2026-10-09-web-test-0.8.0-delivery-candidate.md`，四个门禁零违规）。
**与其用脚本把它改成另一种不确定的样子，不如保持原样并把这件事写下来。**

**若日后要处理，应由人逐段判断中文断句，或先用小样本验证脚本再全量应用。**

### 0.7.43：**`blocked` 终态是否释放资源——0.7.17 标为未测，现已实测**

0.7.17 留下一个明确未闭项：`blocked` 与 `cancelled` 是否同样释放角色浏览器，
当时只测了 `cancelled`，**没有单独测 `blocked`**。这轮在 0.8.0 候选包上补上。

`blocked` 不是 `control_run` 的动作（那里只有 `pause` / `resume` / `continue` /
`await-user` / `cancel`），**它是 `finish_run` 的终态之一**：

```ts
src/agent.ts:476  status: z.enum(['completed', 'cancelled', 'blocked']),
```

所以测法是：新建并核验一个运行，再以 `status: blocked` 收尾。

#### 三个终态都测了

```
核验后   Chromium=10   运行 run-shop-alice-1 | running  | activeRole: 'buyer'
cancel 后 Chromium=0    运行 run-shop-alice-1 | cancelled | activeRole: 'buyer'
blocked 终态后 Chromium=0
                      运行 run-shop-alice-2 | blocked   | activeRole: 'buyer'
```

**`cancelled` 与 `blocked` 都把插件自有的 Chromium 释放到 0。**
加上此前测过的 `completed`（0.7.4 ��� `12 → 0`），
**三个终态在 0.8.0 上都实测释放资源。**

#### 顺带说明

`blocked` 与 `cancelled` 的区别不在资源，**而在是否可恢复**：
`cancelled` 的运行不会接受新的测试动作，`blocked` 是同样终态但语义是
「结论卡住、需要人介入」。**两者的资源处置相同，这一点现在有实测支撑。**

#### 一个重复三次的操作错误

这一轮又因为 `dsh plugin add` 用了相对路径且在 `cd` 之后而**安装静默失败**，
会话创建直接报 `agent-preset/not-found`。
**这是第三次**（0.7.16、0.7.40、本轮），三次都是同一条命令、同一个原因。
**每次都要靠「先查预设是否存在」才抓到。**

### 0.7.44：`await-user` 与 `continue` 的资源行为——**已测，与 `resume` 一致**

终态测完了，但**非终态的 `await-user` / `continue` 一直没单独测过**，这轮补上。

#### `await-user` 会释放浏览器

```
核验后        Chromium=10   run-shop-alice-3 | running | activeRole: 'buyer'
await-user 后 Chromium=0    run-shop-alice-3 | awaiting-user | activeRole: 'buyer' | gen: 1
```

**`await-user` 把插件自有 Chromium 释放到 0**，运行停在 `awaiting-user`。

#### `continue` 恢复运行，但浏览器不立即重挂

```
continue 后 Chromium=0
run-shop-alice-3 | running | gen: 2

Run run-shop-alice-3 is now awaiting-user at generation 1. It will not accept new test
actions in this state.
Run run-shop-alice-3 is now running at generation 2. Act as a role again before the next
operation; the p[revious authority …]
```

**`awaiting-user` → `running`，代次 1 → 2，且明确要求重新扮演角色。**

**`Chromium` 仍是 0，这不是缺陷**：浏览器在**重新核验角色时**才重挂，
不在状态切换时挂。0.7.33 测 `resume` 时 `Chromium 10 → 20`，
是因为那条提示把 `resume` 和重新登录、`assume_role` 捆在一起做的。
**两者行为一致——都等重新核验角色时才重挂。**

**未单独验证**：本次没有在 `continue` 之后重新 `assume_role` 再看 Chromium，
**所以「continue 之后重新核验能让浏览器回来」这一点未被实测**，只由 `resume` 的证据支持。

### 0.7.45：上一轮标「未单独验证」的那条——**已实测通过**

0.7.44 写明：`continue` 之后 `Chromium` 为 0，浏览器应在重新核验角色时回来，
**但那一轮没有真的重新 `assume_role`，所以只是推断**。这轮补上。

```
起点   Chromium=0    run-shop-alice-3 | running | gen: 2
继续重新核验后 Chromium=10
       run-shop-alice-3 | running | activeRole: 'buyer' | gen: 2
```

**`Chromium 0 → 10`，`activeRole` 恢复为 `buyer`，代次仍为 2。**

**推断成立**：`continue` 只把运行拉回 `running` 并作废旧授权，
**浏览器在角色重新核验时回来，与 `resume` 的行为一致。**

#### 至此状态机在 0.8.0 上的完整证据

| 动作 | 资源 | 恢复路径 |
|---|---|---|
| `completed` / `cancelled` / `blocked` | 释放到 0 | 终态，不可恢复 |
| `await-user` | 释放到 0 | `continue` → 代次+1 → 重新核验 → 浏览器回来 |
| `pause` | 释放 | `resume` → 代次+1 → 重新核验 → 浏览器回来 |
| 宿主重启对账 → `resuming` | 释放 | `resume` → 代次+1 → 重新核验 |

**四条非终态路径与三个终态，资源行为全部实测，无一条靠推断。**

### 0.7.46：**同一会话里两个运行争同一个角色，第二个无法自举**

本想测「同一运行内切换角色是否释放先前的浏览器」。
**先查环境的角色声明**（0.7.26 的教训），发现 `acc-k1` 只有 `buyer`，
于是建了双角色的 `acc-k2`（`['buyer','seller']`）再测。

结果卡住：

```
建环境后 Chromium=10
web_test_start_run:   Run run-shop-roles-k2 is running.
web_test_assume_role: Error: role "buyer"'s browser failed
  mcp__playwright-role-buyer-g5__browser_navigate: web-test: …

运行: run-shop-roles-k2 | running | activeRole: '' | gen: 1
```

#### 原因（上轮写错了，下一节纠正）

同一会话里已有 `run-shop-alice-3` 正以 `buyer` 扮演角色且已核验，
新运行 `run-shop-roles-k2` 也要 `buyer`：

1. 准备窗口：`ownerOf('buyer')` 指向 `run-shop-alice-3`，
   `mayPrepareIdentity(session, 'buyer', 'run-shop-alice-3')` 因
   「该运行已核验 buyer」而**返回 false**（窗口对已核验角色关闭，设计如此）。
2. 落到授权要求：`browserGrantForSession` 返回的是 `run-shop-alice-3` 的 buyer 授权，
   角色名匹配，于是**要求出示授权**。
3. 插件内部的 `readAccount` 调用**没有授权可出示**，被拒。

**结论：一个会话里，两个运行不能同时扮演同一个角色。**

#### 这与已测过的两种并存不同

| 场景 | 结果 |
|---|---|
| 两个运行、**两个会话**、不同角色（0.7.38） | ✅ 各持浏览器，结束其一另一存活 |
| 两个运行、**同一会话**、不同角色（0.7.32 回归②） | ✅ `Chromium=20` |
| 两个运行、**同一会话**、**同一角色** | ❌ 第二个无法自举 |

**同一会话同角色这一格此前没测过，这轮测出来是不通过。**

**是否算缺陷取决于设计意图，本轮不下结论**：
若「一个会话同时只应有一个运行扮演某角色」是有意约束，那这是按规则拒绝；
若应当允许，则需要让准备窗口在「有另一个运行正持有该角色」时也开放。
**需要先确定意图再决定改不改，不凭猜测改验收条件。**

**这一条也不进候选结论**，作为新发现的未闭项记录。

### 0.7.47：0.7.46 写的成因**是错的**，已复现并纠正

0.7.46 把成因写成「`mayPrepareIdentity` 因拥有者已核验而返回 false」。
这一轮把它复现出来，**结论相反**。

补测试时先撞上两件与预期无关的事：种子里的 running 运行会被对账置成
`resuming`（与 0.7.36 同一个现象），`assume_role` 因此直接抛
`run "run-a" is resuming; only a running run can change role`。
先 `controlRun resume` 把两个运行拉回 `running`，再打诊断：

```
b=running  grant=run-a/buyer/running
prepB=true  prepA=false  prepNone=false
```

**`mayPrepareIdentity('owner','buyer','run-b')` 返回 true——run-b 本身完全可以准备。**

**真正的成因是守卫问的是谁**：

```ts
if (preparing && store?.mayPrepareIdentity(sessionId, role, ownerOf?.(role)?.runKey)) return undefined
```

`ownerOf?.(role)` 取的是**池里该角色当前的持有者**，也就是 run-a，
**不是发起调用的 run-b**。于是 store 被问到的是 run-a，
而 run-a 的 buyer 已核验 → `prepA = false` → 准备窗口不开 →
落到授权要求 → 插件内部的 `readAccount` 没有授权 → 被拒。

**所以限制的落点在「按角色而非按运行记归属」**：
`claims` 以角色名为键，一个角色在池里只有一个持有者，
第二个运行即使自己干净也拿不到窗口。

#### 新增测试锁住实测行为

```
run-b 问自己        → true    （准备窗口对它是开的）
run-a 问自己        → false   （角色已核验，准备窗口关闭）
不指名任何运行       → false
```

**答案完全取决于问的是哪个运行**，这一点现在由测试固定，
128 个测试通过。

**这条不是凭推断写下的**，是打了诊断值才写对的。
0.7.46 那条「从守卫判据推出、未逐步复现」的记录本身就是该避免的写法。

### 0.7.48：这个限制**符合角色即身份的设计**，但不是显式规则

0.7.46 写「是否算缺陷取决于设计意图，需要先确定意图再决定改不改」。
0.7.47 定位到成因是「claims 按角色而非按运行记归属」。
这轮查了角色在模型里到底是什么：

```ts
src/records.ts:62  /** One role the cases may act as, with a credential reference the plugin never stores. */
                   export const roleSchema = z.object({
                     name: z.string().min(1),
                     /** Reference to a host-managed credential; never the credential itself. */
                     accountRef: z.string(),
                   })
```

**每个环境里的每个角色，对应一个 `accountRef`，即一个账号。**
角色在模型里就是**一个身份**，不是一个可以被多个运行分别扮演的标签。

**一个身份对应一个浏览器会话**，所以「同一会话两个运行扮演同一角色」
在语义上是**两个运行共用一个账号的同一登录态**——
而站点那边这个账号只有一份会话。

**所以这个限制与设计是一致的。**

#### 但必须说清楚：它不是显式规则

store 的 `assumeRole` 只校验三件事：
运行必须是 `running`、角色必须已声明、**核验到的账号必须等于环境里绑定的那个**。
**它没有任何「一个角色只能被一个运行扮演」的检查。**

实测到的拒绝来自守卫向池询问「这个角色当前归谁」，
答案永远是那个角色唯一的持有者。
**这是 claims 以角色名为键所涌现的结果，不是被写下来的规则。**

#### 因此的结论

- **不改成「按运行记归属」**——那会让同一账号出现两个浏览器登录态，
  与「角色即身份」相冲突，且会引入上几轮刚修好的那类归属歧义。
- **但也不写成「已确认的设计约束」**——因为代码里没有这条规则，
  它是涌现的。**若日后有人把 claims 改成别的键，这个限制会静默消失。**

**建议：要么在 store 里显式拒绝「同一环境同一角色被第二个运行扮演」，
要么在 README 里写明这条限制来自 claims 的键。**
**本轮不改代码**，因为「不改」与「改」都需要先确认意图，
而意图已从模型推出、但**尚未与需求方确认**。

**这项记为「行为已测量、与设计一致、规则未显式化」**，不是待修缺陷。

### 0.7.49：**插件 README 的资源节已经过期，写的是被推翻的结论**

0.7.48 建议的两条里，「在 README 里写明限制来自 claims 的键」不需要改代码也不需要确认意图，
这轮就做了。**顺带发现那一节本身是错的**。

原文写着：

```
The Chromium process a role drives is reclaimed on a narrower schedule than that.
mountSessionMcp … does not return it, so the pool cannot dispose that effect on its own;
the browser closes when the provider's fiber is destroyed, which happens when the host
exits. Measured … browsers 12 to 0 when the host takes SIGTERM, unchanged across a
cancelled run and across disabling the role-browser row.
```

**「跨取消运行不变」与 0.8.0 的实测直接矛盾**：
`cancelled`、`blocked` 各实测把 Chromium 从 10 降到 0。
那段话是 0.6.x 时期写的，**独立 fiber 的修复落地之后它就该改，一直没改**。

**交付者会读这份 README**——一份写着「浏览器只在宿主退出时关闭」的文档，
会让验证者对 0.8.0 的实际行为产生完全错误的预期。

#### 现已改写为实测事实

- 三个终态各把 Chromium 从 12 或 10 降到 0
- `pause` 与 `await-user` 同样释放
- `resume` / `continue` 在下一代恢复运行并作废旧授权，
  **浏览器在角色重新核验时才回来**
- 禁用插件时同样释放（`application: "failed"`，浏览器 0，宿主 1，用户浏览器不变）
- 角色即一个账号（单 `accountRef`），claims 按角色为键，
  **同一会话两个运行不能同时扮演同一角色**，
  并注明**这是 claims 键的后果，不是 store 强制的规则**

四个文档门禁对这个文件零违规。

#### 又是一次「没回头核对」

这份 README **我读过很多轮**（它是 0.6.x 时期写的，一直当既有背景），
**却从未拿它和后来的实测对照过**。
「读过多遍」不等于「核对过」——
**文档里每一句结论都应当能指到一次测量，否则它就是过期结论。**

### 0.7.50：通篇核对交付者会读的两份文件，**又抓到三处**

0.7.49 改了 README 的一节。**既然它是交付者会读的文件，就该通篇核对**，
而不是只改发现的那一节。这轮做了，结果抓到三处。

#### 1. 「暂停时仍可用」的工具清单少了两条

README 写四条，代码里是六条：

```
实际: ['status', 'start_run', 'operation_unknown', 'settle_operation',
       'resume_wait', 'control_run']
```

**漏掉的是 `start_run` 和 `control_run`**——而这两个恰好是
**把暂停或被中断的运行接续下去**所用的工具。
`start_run` 是本会话为「`resuming` 永久卡死会话」那个问题加进白名单的，
`control_run` 更是本会话新增的工具。**README 完全没提。**

#### 2. 写了一个不存在的接口名

原文写 `` `webTest/controlRun` is the operator's side ``——
**`webTest/controlRun` 不是任何真实接口**，真实的工具名是 `web_test_control_run`。
按那个名字去 Windows 上找会找不到。

#### 3. Windows 验收清单漏了三个现役工具

```
清单未覆盖的现役工具: ['web_test_control_run', 'web_test_finish_run', 'web_test_propose_cases']
```

**这直接影响交付**——清单是 Windows 执行者照着跑的东西，
三个工具没有对应条目，**它们在 Windows 上就不会被验证**。

已补一节「0.8.0 新增覆盖项」，五条，**全部标注未验证**，
并写明整包禁用要用 bundle 名 `dsh-plugin-web-test` 而非 `web`。

**其中「取消文案不再要求调用不存在的 `web_test_resume_run`」那条是原有验收项，写得对**：
`resume_run` 确实不存在，代码里是 `resume_wait`。

#### 再次印证上轮的教训

**「读过很多遍」和「核对过」是两件事。**
这三处都在**交付者会实际照着用的文件**里，
而这些文件我此前**只当作既有背景读过**，从未与代码对照。

### 0.7.51：查包内文件时发现，**0.7.50 我把一处真实接口当成了错名**

核对交付包里的 README 是否带上了修改，结果：

```
包内 README 含 web_test_control_run 的次数: 0
包内 README 含 webTest/controlRun 的次数: 1
```

**包里的 README 还是旧的**，这本身说明交付包需要重建。
但更要紧的是我去查 `webTest/controlRun` 到底存不存在：

```
$ grep -rhoE "webTest/[a-zA-Z]+" src/ | sort -u
webTest/assumeRole webTest/buildReport webTest/controlRun webTest/getRun
webTest/listCaseResults … webTest/status webTest/waitRun
```

**`webTest/controlRun` 和 `webTest/buildReport` 都是真实接口**
（`buildReport` 在 `src/report.ts:100` 与 `:145` 导出，
`controlRun` 在 `src/client/remote.ts:569` 注册）。

**所以 0.7.50 说「README 写了一个不存在的接口名」是我判断错了。**
**接口 `webTest/controlRun`（给操作者调的 RPC）和工具 `web_test_control_run`
（给模型调的）是两个不同的东西，原文写的没有错。**

**已还原英文 README 那处**，保留白名单那处（那条是对的）。

#### 中文 README 有同一个白名单问题

改的时候按行号替换，**误删了前半段「`webTest/controlRun` 是操作者一侧」**，
回读时发现并补回。

#### 当前状态

两份 README 的白名单都是六条且正确，`webTest/controlRun` 的说明都在。

**但交付包 `dsh-plugin-web-test-0.8.0.tgz` 里的 README 仍是旧的**，
**必须在交付前重建并重新核对哈希**。

#### 这是第 8 个「没核对就下结论」

0.7.50 那条我写得很肯定——「这不是任何真实接口」。
**它其实真实存在，只是我当时没查。**
**指出一个问题之前，先确认它真的不存在**，
尤其当那个名字看起来像是我自己造出来的时候。

### 0.7.52：**交付包已重建**，三处标识符同步更新

0.7.51 发现包内 README 是旧的，这轮重建。

```
$ npm pack   （tsc --force、128 测试、tsdown、generate-typert 之后）
新哈希: 67663e4edc873b3dc2acea7b3fb36a0a40b43c2f5c00244b58413850183a684c

包内 README 含 webTest/controlRun:      1
包内 README 含 web_test_control_run:    1
包内 Windows 清单含「0.8.0 新增覆盖项」: 1
包内文件数: 44    包内 version: "0.8.0"
```

**逐字节可复现性在新包上仍成立**：

```
重构建: 67663e4edc873b3dc2acea7b3fb36a0a40b43c2f5c00244b58413850183a684c
交付包: 67663e4edc873b3dc2acea7b3fb36a0a40b43c2f5c00244b58413850183a684c
```

#### 源码 SHA 必须跟着变

包的内容变了（README 修正在包里），**能产出这个包的提交也不再是 `43b9a10e40`**：

```
source   71393d989a05e71e743ee8150f12a47b70fac9e4
package  dist/dsh-plugin-web-test-0.8.0.tgz
sha256   67663e4edc873b3dc2acea7b3fb36a0a40b43c2f5c00244b58413850183a684c
```

**这是同一个陷阱的第二次出现**：0.7.39 记过一次 SHA 错配。
**区别是那次是「写记录时抄错」，这次是「包变了而没同步」**——
**包一变，SHA 与哈希两处标识符都必须一起重取，不能只改包。**

交付记录里那段解释也一并改了，如实写出**前两版各错在哪**：
`86d7d494df` 的源码还是 0.7.7；`43b9a10e40` 早于本包携带的 README 修正。

#### 旧包保留

`dist/` 下现在有 51 个 tarball，0.6.12、0.7.x 与旧版 0.8.0 都在。
**旧的 0.8.0（哈希 80c48832e…）保留**，因为它是已测过 0.8.0 全部证据的那个包；
新包只改文档、代码未动，**但两者的标识符不同，不可混用**。

### 0.7.53：**新包与实测证据的包只差三份文档，代码零差异**

0.7.52 重建了包，但**所有实测证据都来自旧包 `80c48832e…`**。
不比对就说「新包代码未动、证据仍适用」是不成立的，所以这轮做了逐文件比对。

旧包可从 git 取出（`dist/` 未被 .gitignore 忽略）：

```
$ git show a1a5dff88b~2:dsh-plugin-web-test/dist/dsh-plugin-web-test-0.8.0.tgz > /tmp/oldpkg/old.tgz
$ sha256sum /tmp/oldpkg/old.tgz
80c48832e3243147629dd72dca40afb693bd1cc75a426bb117415cba03bbf94f
$ sha256sum dsh-plugin-web-test/dist/dsh-plugin-web-test-0.8.0.tgz
67663e4edc873b3dc2acea7b3fb36a0a40b43c2f5c00244b58413850183a684c

$ diff -rq old/package new/package
README.md 不同
README.zh.md 不同
WINDOWS-ACCEPTANCE.zh.md 不同
差异文件总数: 3
```

**两个哈希都各自正确，且只差这三份文档。**

**`lib/` 与 `dist/` 下没有任何文件不同**，也就是说：
类型检查产物、tsdown 产物、生成的类型、JS 代码**全部逐字节一致**。
**0.7.17 到 0.7.49 之间做的全部实测，对新包同样成立。**

这一点已写进交付记录，让验证者不必把整轮回归重跑一遍，
**但仍写明证据来自哪个包、两者差在哪**——不是含糊的「应该一样」。

### 0.7.54：改了清单又忘了重建包——**同一轮里应连着做完的事分成了两轮**

0.7.53 改了清单的三处（判定方式、执行记录表、条目说明），
**这轮先查包内那份：**

```
包内清单含「不要把 Ubuntu 的进程数当作验收标准」: 0
包内清单含「0.8.0 新增 1–5」:                      0
```

**包里的清单是旧的。** 0.7.50 改完没重建，0.7.53 又改了一轮，
**两次都把重建留到了下一轮**。

**这不是新问题，是 0.7.52 那次的重演。**
0.7.52 建立了「改文档后必须重建并核对」的流程，
**但执行时只覆盖了 README，没把清单算进去**——
**流程写了不等于流程覆盖了全部对象。**

#### 已重建并逐文件比对

```
新哈希: fca2d26e9920e81b65518bbb95878e11d750dfda2aa6dc5dae25dd876919603b
包内含新判定说明: 1
包内含新增记录行: 1

$ diff -rq 上一包/package 新包/package
WINDOWS-ACCEPTANCE.zh.md 不同
差异总数: 1
```

**仍只有文档变化，代码零差异**，实测证据继续适用。

#### 三个 0.8.0 包的谱系

| 哈希 | 相对前一版的变化 | 实测证据 |
|---|---|---|
| `80c48832e…` | 首个 0.8.0 | 全部实测在此包上 |
| `67663e4e…` | README 两份修正 | 代码零差异，适用 |
| `fca2d26e…` | Windows 清单修正 | 代码零差异，适用 |

**三份都保留在 `dist/`，三份的标识符都写进了交付记录**，
并写明每一步只改了什么——**不让验证者猜哪个包是哪个。**

### 0.7.55：把「改动文档后必须同步」**做成脚本**，不再靠人记得

前面几轮反复出问题的地方是同一条：**改了包内文件，忘了重建包或忘了更新记录里的标识符。**
0.7.52、0.7.54 都是这个。**规则写下来两轮了，但它只在「我刚好想起来」时生效。**

#### 先查，发现 SHA 又过期了

```
HEAD:     06648889ac2850556c225f6221e625acbe64f49c
记录里的: 71393d989a05e71e743ee8150f12a47b70fac9e4
```

**但没有直接照 HEAD 改**——先确认包内文件是否真的变过：

```
$ git diff --stat 71393d989a..HEAD -- dsh-plugin-web-test/packages/web-test/
 WINDOWS-ACCEPTANCE.zh.md | 12 +++++++++---
```

**确实变了，所以旧 SHA 产不出这个包。** 若没变，**光看 HEAD 会造成一次错误的「修正」**——
这正是 0.7.39 之前的坑。**先确认前提，再改。**

#### 现在有了可重复的检查

```
$ dsh-plugin-web-test/scripts/check-delivery-identifiers.sh
✓ 源码 SHA = HEAD
✓ 哈希与包一致
✓ 包内版本 0.8.0
✓ 包内 README.md 与工作区一致
✓ 包内 README.zh.md 与工作区一致
✓ 包内 WINDOWS-ACCEPTANCE.zh.md 与工作区一致
```

六项全过，**任一不符即非零退出**，并且从任意子目录运行都有效
（用 `git rev-parse --show-toplevel` 定位仓库根）。

**「改文档 → 重建 → 核对」从流程变成了可执行检查。**
