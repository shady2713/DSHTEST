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

第 1 条正是第六节要的"保存并调用实际释放句柄"的适用场景，现在有了可复现的失败样本。
注意上一条"宿主退出"有证据并不与这条冲突：那是进程随宿主整体退出的结果，不等于插件
自己在运行期释放了它。

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
