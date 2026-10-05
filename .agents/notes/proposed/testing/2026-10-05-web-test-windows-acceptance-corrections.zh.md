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
