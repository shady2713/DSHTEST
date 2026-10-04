---
description: "Web 测试执行前策略（ctx.webTestPolicy）：不可放宽的工具守卫与服务层兜底、只读代码根保护并命名上传/下载/临时物料目录、绑定已发布项目修订的按入口环境声明，以及有界的具体流程授权。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test-policy

[English](README.md) | 中文

## 概述

本包拥有 Web 测试每条执行路径在产生效果之前必须通过的同一个判定。它挂在工具注册表的单调守卫阶段，因此官方审批与本限制同时生效且互不放宽；它同时装饰公开的能力服务，使直接调用 `ctx.fs`、`ctx.web` 或 `ctx.terminals` 由同一个账本判定。它从已确认的环境声明中读取被测代码根与命名的物料目录，把每份授权绑定到已发布的项目修订，并拒绝任意 shell、终端能力、链接，以及任何没有适配器的入口路径。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [开发备注](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

组合层在工具注册表、契约边界、已发布作用域读取器与时钟之上挂载本服务，并把部署的取舍写成配置。

闭合的对话资料工具集包含 `web_test_update_project`，通过核对修订的 Remote 修正当前项目的代码根与 URL，不授予许可。资料工具内部的能力调用仍须通过同一个服务层兜底。

`web_test_submit_report` 保留给组合层的报告验证器，用于接收报告文本并记录验证资料。处理器不授予许可、不派发测试，也不认证业务验收；处理器内部的任何能力调用仍须通过服务层兜底。相似的工具名仍不被识别。

```ts
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { WebTestPolicy } from '@deepseek-ai/dsh-web-test-policy'
declare const ctx: Context
declare const dataRoot: string
await ctx.plugin(WebTestPolicy, {
  protectedPaths: [
    { path: join(dataRoot, 'uploads'), role: 'upload' },
    { path: join(dataRoot, 'downloads'), role: 'download' },
    { path: join(dataRoot, 'staging'), role: 'temporary-material' },
  ],
  confirmationRequiredFor: ['read-source'],
  confirmationTtlMs: 120_000,
  authorizationValidityMs: 600_000,
  maxActionsPerFlow: 40,
})
```

不挂载任何东西的产品仍可用自己的账本构造该判定：

```ts
import { EnvironmentLedger } from '@deepseek-ai/dsh-web-test-policy'
import type { DeclarationEvaluator, LedgerLimits, ProtectedPath, WebTestClock, WebTestScopeSource } from '@deepseek-ai/dsh-web-test-policy'
declare const protectedPaths: readonly ProtectedPath[]
declare const limits: LedgerLimits
declare const scopeSource: WebTestScopeSource
declare const contracts: DeclarationEvaluator
declare const clock: WebTestClock
const ledger = new EnvironmentLedger(protectedPaths, limits, scopeSource, contracts, () => clock.now())
```

### 哪些可配置、哪些不可配置

每一个随部署变化的取舍都是经过校验的 `Config` 字段：受保护目录及其角色、哪些效果种类需要业务确认、确认可作答的时长、一份授权的有效时长，以及一份授权可覆盖的动作数。测试会话能做什么则不可配置。已声明的代码根是只读的；任意 shell 与终端能力对每份授权都被拒绝，包括人工已批准的授权；没有适配器的入口路径被拒绝。

### 声明、授权与重新验证

`declareEnvironment` 通过契约自身的解析器校验请求，因此 Client、Runtime 与本服务会以相同的代码拒绝相同的非法字段。声明的代码根必须是该项目已发布的目录树，且任何受保护目录都不得位于其内。声明的身份由其内容派生，每份授权都携带该身份与已发布的项目修订。因此内容发生变化的声明、或修订发生移动的作用域，会让此前每份授权同时失效：环境已经改变，会话必须重新验证。

`grantFlow` 授予某个具体流程行动的权利，以该流程的记录身份、动作数与有效窗口为界。预算属于流程而不属于请求：在相同修订上重新签发同一个流程会返回仍然存在的记录，即它还剩多少动作、以及它在什么时刻到期，因此重试无法凭空得到一份新的额度，也无法延长一个已经在计时的窗口。流程的身份随其计划修订、已发布的项目修订、声明与第三方标志而移动，因此在这些之一发生变化时重新签发就是另一份授权，并会获得自己的额度。触达第三方的授权只与触达第三方的效果匹配，因此测试环境授权永不授权搜索，第三方授权也永不授权读取被测目录树。

### 必需的业务确认与等待提问的区别

`requireConfirmation` 只为产品本来就会允许的动作发问；本身就已被拒绝的动作绝不会被变成一个问题。等待不授予任何东西：状态是 `pending`，判定仍然拒绝。`answerConfirmation` 在接受任何答案之前重新检查该问题、意图中的动作，以及当前的项目修订、流程计划修订与环境声明，因此窗口关闭之后才到达的答案、或针对已经移动的上下文的答案，都会被拒绝，下一次尝试会提出一个全新的问题。独立的工作不受影响，而依赖该确认的工作保持阻塞。

<a id="understand-the-implementation"></a>
## Understand the implementation

### 两个执行点，一个判定

每一次模型发起的调用都会到达 `ToolRuntime.execute`，而本服务挂在守卫阶段，而不是 `tools/pre-execute` waterfall。守卫没有 allow 结果，它在每个 pre-execute 监听器之后、审批提问之后运行，审批服务已允许的调用仍会到达它。这就是拒绝不可放宽的原因：监听器回答 `allow` 或审批回答 `allowed-once` 都无法把它变回许可。

守卫按调用而非按注册被查询，因此会话中途注册的工具在下一次调用时即被判定，无需任何东西注意到这次注册。本包没有适配器的工具名会被拒绝，这同时覆盖中途启用的工具、部署未装载的包所提供的工具，以及参数集合畸形的调用。

保留的 `run_code` 传输只在已安装 provider 是 [QuickJS runtime](../../ptc-runtime/ptc-runtime-quickjs/README.zh.md)的真实实例时允许执行。该 provider 暴露声明的工具绑定与 ECMAScript 内建对象，不暴露 Node、文件、网络或进程 API。嵌套工具仍经过同一守卫及服务保护。Node PTC 和仅复制隔离描述字段的 provider 仍被拒绝。

直接调用公开文件、Web、进程、附件、终端和受控浏览器服务也经过服务兜底。受控浏览器工具检查调用 Session 已确认的目标；`desktopBrowserControl.submit` 只扣减一次操作次数，并再次检查实际绑定的 URL。角色提交先要求 Runtime 的不透明授权，再按所属 Session 检查角色 URL；两个提交入口都保留调用者的取消信号。

纯文本提示准入只复制文字，不访问附件存储，因此 `attachments.admitPromptContent` 允许仅含文本的内容。包含图片或文件引用的内容仍受附件拒绝规则约束；提示入口不会授予上传、读取或发布权限。

`glob` 与 `grep` 使用结构化 `fsSearch` 服务。守卫基于 Session 工作目录解析相对或省略的路径，仅检查而不扣除动作。在 subprocess backstop 中，只有打包 Provider 的私有、一次性 spawn 身份才能为 glob 选择 `list-source` 或为 grep 选择 `read-source`；账本以 `fsSearch.search` 入口授权规范目标并扣除一次动作。显式链接、私有目标及确认根外的路径均被拒绝；`--no-follow` 防止遍历嵌套 junction 和 symlink。通用 shell、subprocess 和 terminal 请求即使复制搜索 argv 也仍被拒绝。

### 兜底层判定的每一个方法，以及它放过的每一个方法

下表覆盖公开 Service Definition，包括读取存储材料或创建持久 shell 的不同方法。「可产生效果」指调用能够读取或变更材料、创建进程、操作终端或控制浏览器。

| 服务 | 方法 | 可产生效果 | 已装饰 | 被判定为的效果 |
| --- | --- | --- | --- | --- |
| `ctx.desktopBrowserControl` | `submit` | 是 | 是 | 按 Session 绑定的 URL 判定为 `fetch-web`；缺少所有权会被拒绝。 |
| `ctx.fs` | `readText`、`readBytes`、`readByteRange`、`streamText` | 是 | 是 | `read-source` |
| `ctx.fs` | `listDir` | 是 | 是 | `list-source` |
| `ctx.fs` | `writeText` | 是 | 是 | `write-source` |
| `ctx.fs` | `editText` | 是 | 是 | `edit-source` |
| `ctx.fs` | `watch` | 否 | 否 | 观察者只报告调用方已经命名的路径发生了变化。它不返回内容，也不创建任何东西。 |
| `ctx.fs` | `resolve`、`processPath`、`processPathFromHostPath`、`fileUrl`、`contains` | 否 | 否 | 投影与包含性测试。它们为某个目标命名或比较两个目标；读取与写入在真正发生之处被判定。 |
| `ctx.fs` | `stat`、`lstat` | 否 | 否 | 关于调用方已经解析出的路径的元数据，从不含内容，也从不含调用方尚未掌握的名字。枚举用的 `listDir` 与每一次内容读取对受保护目录都被拒绝；会话日志、代理的指令文件与语言服务器仍能 stat 自己的存储。 |
| `ctx.fs` | `sandboxMode` | 否 | 否 | 关于 backend 的一个事实。 |
| `ctx.shell` | `execute` | 是 | 是 | `spawn-process` |
| `ctx.shell` | `resolve` | 否 | 否 | 为请求套用默认值而不执行它。它所描述的派生在 `execute` 处被判定。 |
| `ctx.shell` | `sandboxMode` | 否 | 否 | 关于执行器的一个事实。 |
| `ctx.subprocess` | `spawn` | 是 | 是 | `spawn-process`；一次性打包搜索请求使用 `list-source` 或 `read-source` |
| `ctx.subprocess` | `spawnTerminal` | 是 | 是 | `use-terminal` |
| `ctx.subprocess` | `resolveExecutable`、`terminalEnvironment` | 否 | 否 | 一次查找与一个平台事实。二者都不启动进程，而它们各自所提示的派生在 `spawn` 或 `spawnTerminal` 处被判定。 |
| `ctx.web` | `fetch`、`search` | 是 | 是 | `fetch-web`、`search-web` |
| `ctx.web` | `registerSearchProvider`、`registerFetchProvider` | 否 | 否 | 注册表组合。已注册的 provider 若不经过 `search` 或 `fetch` 仍然无法运行。 |
| `ctx.attachments` | `saveImage`、`saveImages`、`saveFile`、`saveFileStream`、`admitEncodedFile`、`admitPromptContent`、`stageEncodedFile`、`stageFile`、`stageFileStream`、`deleteFile` | 是 | 是 | `write-upload`；暂存的 Host 上传携带精确的私有生产者权限。 |
| `ctx.attachments` | `readImage`、`readFileStream`、`readImageRequest`、`acquireFileReadLease` | 是 | 是 | `read-upload`；真实的 Session 日志导出所有者绑定私有只读权限。 |
| `ctx.attachments` | `commitFileReferences`、`releaseFileReferences`、`releaseFileStage` | 是 | 是 | 要求真正拥有 Service 的 Host 生产者发起一次精确私有调用；公开调用方不能修改保留记录。 |
| `ctx.attachments` | `imageHostPath`、`fileHostPath` | 否 | 否 | 一个投影：已存对象的位置，答案背后没有内容。对该位置的每一次 `ctx.fs` 读取都会因受保护目录被拒绝，而模型自身的请求路径依赖该投影，因此拒绝它只会破坏产品而不会封住任何通路。 |
| `ctx.attachments` | `validateImage` | 否 | 否 | 解码调用方提供的字节，并不持久化任何东西。 |
| `ctx.attachments` | `isAttachmentError` | 否 | 否 | 一个类型守卫。 |
| `ctx.attachments` | `imageLimits` | 否 | 否 | 关于部署图像策略的一个事实。 |
| `ctx.terminals` | `spawn`、`startSend`、`read`、`signal` | 是 | 是 | `use-terminal` |
| `ctx.terminals` | `kill` | 否 | 否 | 它移除一个会话而不是使用一个，且 `expectOwned` 把它限制在调用方自己的会话上。拒绝它会让一个策略已判定不应存在的 PTY 滞留。 |
| `ctx.terminals` | `registerBackend`、`listBackends` | 否 | 否 | 注册表组合与已注册类型的列表。不会分配任何会话。 |
| `ctx.terminals` | `hasOwnerActivity`、`list` | 否 | 否 | 调用方自己会话的快照：id、名字、类型、pid 与状态。不含任何会话内容，也不含其他所有者的会话。 |

### 兜底层覆盖不到的东西

兜底层通过 Cordis 注入跟随各 provider。每次注入的 provider 完成清理后，后继 provider 才会安装。晚加载的 provider 会被装饰，替换后的旧实例保持保护直到策略卸载，因此保留服务引用也不能绕过。仍有两条路径不经过被装饰的服务：

- **被提前捕获的方法引用。** 在 effect 安装之前就把 `ctx.fs.readText` 读进变量的消费者持有的是未包装的函数，本包无法触及。要判定这样的调用，需要在 Service Definition 内部有一个判定点。
- **某个 backend 导出的函数。** `fs-local`、`subprocess-local` 与 `attachment-local` 各自导出自己的入口；直接导入其中一个并不是在服务上调用。

关闭这两条路径需要在所属 Service Definition 内部作出判定。

### 相对路径在工具层被拒绝，在服务层则按其解析到的位置被判定

两个执行点对相对路径的处理并不相同，这个差别值得写明，而不是被抹平。

工具参数由一个同步守卫读取，而它无法向 backend 询问工作目录，因此带 `file_path: "src/app.ts"` 的 `read` 是 `denied-unknown-target`：本包不去推理一个它无法规范命名的目标。`ctx.fs` 调用则不同——它收到的是 backend 已经解析过的 `FsTarget`，而 `processPath` 会把它变成绝对路径，因此 `ctx.fs.readText(await ctx.fs.resolve('src/app.ts'))` **运行了**并返回了文件内容。因此服务层对相对路径并非视而不见；它更粗糙，因为它在该路径解析到的位置上做判定，无法分辨调用方是怎么拼写它的。仅当 backend 的工作目录就是已声明的代码根时这一点才是无害的：此时相对路径解析到根内，在有效授权下按普通的根内读取被判定；而任何以别处为工作目录配置的 backend 都会把它解析到根外，于是被包含性检查拒绝。装载了工作目录并非代码根的 filesystem backend 的部署，应当预期经由服务层的相对路径读取会被拒绝——这是安全的方向。

### 判定为什么是同步的

`ToolGuard` 是同步的，因此判定无法 await 路径解析。于是每个目标都用同步的 `lstat`/`realpath` 对解析，且只有已存在、不是链接、且能规范解析的目标才可用。通过文件系统解析也正是无需按平台分支就能让包含判定可信的原因；拒绝链接而不是跟随它，堵住了「代码根内的链接指向根未覆盖之处」这一替换。相对路径或缺失路径无法被本包规范命名，因此被拒绝。

<a id="further-exploration"></a>
## Further Exploration

- [`.artifacts/web-testing/upgrade-v02/m1-t05-a/rejection-matrix.md`](../../../.artifacts/web-testing/upgrade-v02/m1-t05-a/rejection-matrix.md) —— 每条已启用的入口路径，在两者都存在时各一个放行案例与一个拒绝案例，附上确切的原因与其后效果的观察。兜底层装饰的每一个方法都有一行，而每一个新装饰的方法都是在真实的本地 filesystem、attachment store、subprocess runtime 或终端注册表上被观察的。
- [`.artifacts/web-testing/upgrade-v02/m1-t05-a/confirmation-ledger.md`](../../../.artifacts/web-testing/upgrade-v02/m1-t05-a/confirmation-ledger.md) —— pending、expired、mismatched、skipped、declined 的答案各值多少。
- [`.artifacts/web-testing/upgrade-v02/m1-t05-a/entry-path-inventory.md`](../../../.artifacts/web-testing/upgrade-v02/m1-t05-a/entry-path-inventory.md) —— 本包执行点的选择依据来自的那份调研。

<a id="dev-note"></a>
## 开发备注

不发布运行时 invariant 伴随包，因为两个执行点询问的是同一个账本，而调用方据以行动的判定*就是*该账本的返回值，而不是一个可能与之分叉的第二个观测。挂载时哪些服务存在是组合层的事实，不是本包可以比对的第二个来源。

<a id="model-experience"></a>
## Model Experience

### 效果被拒绝时

#### What the model sees

被拒绝的调用会变成一行工具结果错误。闭合的原因与策略判定时命名的主体都写在里面，因此模型能区分只读目录树、声明环境之外的目标、链接、已失效的授权与缺失的确认，而不必猜测。拒绝不是可以重试的工具错误，也不是「换个工具就能行」的提示：同一个效果经由不同入口路径会得到同样的答案，因此模型在 `write` 被拒后改用 `edit` 工具，并没有找到绕过它的办法。

##### 被拒绝调用产生的拒绝文本

```markdown
Error: web testing policy refused "write" (denied-protected-path): C:\repo\src\app.ts
```

#### Token effect

策略不新增 Session 事件类型。浏览器截图以持久图像引用进入普通 `tool/result`；Host 专属 `webTestScreenshots` 投影在重开或分叉后重建配对成功的引用，不恢复浏览器派发许可。被拒绝的调用仍为普通工具错误。

#### KV Cache effect

无。被拒绝不会改变模型请求前缀，因此缓存的前缀在一次被拒绝的调用之后依然有效。

### 效果被放行时

#### What the model sees

什么都没有。被放行的调用运行它本来就会运行的工具，模型收到的是该工具自己的结果，因此在被放行的路径上策略不可见。

#### Token effect

只有该工具自己的结果贡献 token。

#### KV Cache effect

无。被放行同样不改变模型请求前缀。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了该契约何时不合适、以及何时需要特别的运维注意。它们是当前包的约束，不是一份通用的策略对比，也不是任务清单。

- **相对文件读取/编辑参数在工具层被拒绝。** 抽象的 `FileSystem` 不暴露 backend 工作目录，因此读取/编辑工具参数中的 `src/app.ts` 是 `denied-unknown-target`。经由 `ctx.fs` 到达的相对路径按 backend 解析后的位置判定。搜索根据调用 Session 工作目录解析自己的相对路径；参见[该章节](#understand-the-implementation)。
- 用户提供的上传和下载仍被拒绝。`createModelProbeImage` 准入固定的一像素探测图。`captureBrowserScreenshot` 只接受调用 Agent 自身仍有效的 Main 授权目标，自行捕获图片并通过已安装附件提供方持久化。原始写入器和已准入引用保存在私有 WeakMap 中，调用者不能提供图片字节。读取须匹配精确记录的元数据，模型发起的读取还须属于对应 Session。重开后的成功截图历史允许读取图片，不会恢复浏览器派发。
- **不分发任何浏览器动作，附件协调也未完成。** 本包判定一个效果是否可以发生，而不是促成它发生。
- **兜底层覆盖不到装饰前捕获的方法引用或对 backend 的直接导入。** 通过注入服务发起的调用在 provider 替换后仍受约束。
- **每次判定都会读取已发布作用域。** 这正是让作用域变化被观察到而不是被缓存的原因，代价是每次判定一次对域内存状态的同步读取。
- **一份生效中的环境声明覆盖一个工程注册的所有代码根。** 工程无法为个别根表达不同的环境事实，且再确认一份声明会替换当前生效的那份。混合环境不得整体声明为测试环境以获取许可。该限制将持续到某个执行器要求并校验独立作用域的环境为止；所有已注册代码根均为只读。
