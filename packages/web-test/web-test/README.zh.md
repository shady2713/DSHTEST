---
description: "注册 Web 测试应用自己的身份与数据根，并在验证本地 DSH 插件装配时检查其入口声明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test

[English](README.md) | 中文

## 概述

此包拥有一个已安装的 Web 测试应用：它的数据根、其中的 profile、浏览器 `userData` 目录、更新渠道，以及它所挂载的 Loader 入口。官方产品保留共享的 `~/.dsh` 和自己的 `desktop` profile，因此两者可以并存安装；当数据根或 profile 会指向官方产品时，本应用拒绝启动。启动器在运行时解析任何路径之前应用 `launchEnvironment`，`assertWebTestDataRoot` 负责核对已启动的运行时确实解析到了它。该环境把这些 Electron 自有的路径指明给承载它的 shell。入口声明在挂载的能力真正支撑之前保持不可用。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待完成工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

本包既提供服务插件，也提供应用所有者。`resolveWebTestApplication` 不读取配置文件，也不创建任何内容；`registerWebTestApplication` 创建安装并返回释放器，释放器只删除自己创建的部分。

```ts
import { spawn } from 'node:child_process'
import { readOfficialHome, registerWebTestApplication, resolveWebTestApplication } from '@deepseek-ai/dsh-web-test'

const officialHome = readOfficialHome()
const application = resolveWebTestApplication({
  ...(officialHome === undefined ? {} : { officialHome }),
})
const releaseInstall = registerWebTestApplication(application)
// A launcher applies this before the runtime resolves a path, and passes
// application.compositionLayerPath as a patch file.
spawn(process.execPath, ['--profile', application.profileName], {
  env: { ...process.env, ...application.launchEnvironment },
})
// On uninstall, this removes exactly what registration created.
releaseInstall()
```

`registerWebTestApplication` 写入数据根、`<home>/profiles/web-test/package.json`（本应用选择的 bundle 列表）、`<home>/browser/user-data` 以及 `<home>/release.json`——其中记录更新渠道、入口 id 和供外部 shell 使用的装配层。随包的 [web-test.cordis.patch.yml](web-test.cordis.patch.yml) 挂载构建入口并禁用四个产品出口行；[身份回归](tests/identity.e2e.ts) 在本应用自己的 profile 上断言每一行都生效，并断言入口经由真实 Loader 在该数据根上激活与释放。该层随包发布，因此安装后的副本能在 `lib/index.js` 旁解析到它；缺少该层的副本会在启动任何运行时之前被拒绝。

这一解析在打包器把本包内联进某个应用时依然成立——Desktop 主 bundle 正是这样做的，因为本包是工作区 devDependency，而不是它随包发布的 `dependencies` 之一。只有当模块自身目录的 manifest 声明本包时，该目录才被接受；bundle 所在目录声明的是导入它的应用，此时改由导入方按本包的名字解析出安装位置。两者都拿不到的导入方会被拒绝，并被告知需要哪一条声明。[bundle 解析回归](../../../apps/desktop/tests/web-test-bundle-resolution.spec.ts) 会打包本包的真实源码，在主 bundle 实际运行的位置执行它，并从构建产物里读回这两个路径。

profile 只存在于那次注册写入的位置。在从未注册过它的 home 下执行 `dsh --profile web-test` 会按名字被拒绝，而不会被自动创建：在任意 home 下创建的 profile 会让本应用运行在官方产品的 `~/.dsh` 上。

随包组合层挂载 contracts、拥有数据代的 Runtime、已发布工程作用域与时钟、policy、模型配置、会话命令和展示。`scope-provider` 提供策略所读事实；`assembly` 通过正式 attachment provider 接纳固定一像素模型探测图，并在命令可用后发布工程入口。用例与报告入口仍须由其所属能力提供。

本包不是可安装的 profile bundle。[tests/fixtures/cordis.yml](tests/fixtures/cordis.yml) 中的构建产物 Loader 夹具按以下方式挂载编译入口：

```yaml
- id: web-test
  name: ../../lib/index.js
```

路径相对于该夹具。其他装配必须从自己的配置目录解析文件。使用裸包名前，先将它声明在应用的 resolver manifest 中，并验证包元数据解析。仅有 TypeScript 源码别名时，插件可以加载，但 DeepSeek 请求准备可能因插件清单解析不到包元数据而报 REQUEST_EXTENSION。

### 最小配置

所有字段都有默认值。字段类型错误会导致插件激活失败。这些字段是已挂载服务所报告的标签；上文所述的隔离来自应用所有者，后者独立读取它们。

| 字段 | 默认值 | 含义 |
|---|---|---|
| applicationId | dsh-web-test | 服务报告的应用身份。 |
| dataRootName | web-test | 服务报告的数据根标签；不改变 DSH_HOME。 |
| profileName | web-test | 附加到入口声明的 profile 标签；不选择运行中的 profile。 |

### 应用身份

| 属性 | 含义 |
|---|---|
| home | 所有 harness 服务解析存储、设置和凭据时使用的数据根。 |
| profileDir | 本应用自己的 profile，位于自己的数据根内。 |
| userDataDir | 同一数据根内的浏览器 `userData` 目录。 |
| updateChannel | shell 发布与检查的渠道；官方产品保留自己的渠道。 |
| entryUrl | 装配层所挂载构建入口的 `file:` URL。 |
| compositionLayerPath | 挂载入口并关闭产品出口的 patch 文件。 |
| launchEnvironment | 本应用的 `DSH_HOME`、harness 的遥测退出开关，以及 shell 通过 `isWebTestApplication` 读取的标识。 |

<a id="recovery-only-entry"></a>
### 仅恢复入口

此入口的 `windowsRenameDelaysMs` 需独立于普通 Runtime 配置。默认 `[20, 40, 80, 160]` 仅在 Windows 暂时性 rename 错误后重新发布同一个完整临时文件；`[]` 只允许一次尝试。预算耗尽后仍选中前一指针，不确认持久化成功。[Runtime 发布策略](../web-test-runtime/README.zh.md#use-this-package) 说明准入拒绝和错误保留。

普通组合也挂载 `@deepseek-ai/dsh-web-test/prototype`，与 Runtime 模块共用私有权限登记。有界生产者要求调用方提供其真实所属 Context，才能登记运行头、准入派发、记录结果或撤销派发；它不返回权限，不提供 Remote 或模型工具。`markNotExecuted` 为原始 ISSUED 操作提交与之关联的真实浏览器拒绝；UNKNOWN 操作无法结算，原始业务意图无法再次准入。真正全新的控制根在发布数据代指针前提交格式 3 的空 prototype cut。已有根缺少或损坏 cut 时仍报告不完整，文件不存在不能证明空闲。空 cut 的固定指纹标识尚未登记的原型域，首次登记运行时绑定实际业务组合摘要。

独立的 `@deepseek-ai/dsh-web-test/recovery` 入口打开已有的 `controlRoot`；该配置必填且没有默认值。其 profile 不包含普通 Runtime、Agent 或工具。旧写入者必须先释放同一控制根的锁，此入口才能激活。`inspect()` 读取持久化运行头，不加载 Session，也不写入记录；`freeze`、`prepare` 和 `activate` 要求调用方持有由可信恢复 owner 获发的不透明 `RecoveryAuthority`。入口自己的授权保存在模块本地状态中，不通过服务返回。

`freeze` 要求 executor cut 已撤权；`prepare` 要求先冻结文件清单，并构建独立的仅恢复 generation，随后由 `activate` 选中。支持的转换为旧格式 1→2 和当前格式 3→4。格式 1/2 保留严格的只读读取器，不提供到当前 executor 的隐式迁移。恢复保留 Pause、取消状态、UNKNOWN 操作、确认未执行的回执、报告及附件，不修改前驱 generation。[构建后的恢复 profile 回归](tests/recovery-profile.e2e.ts) 验证进程隔离、争锁、记录保留，以及始终为一次的业务 POST 计数；它不验证真实安装器或通用恢复。[Runtime 恢复实现](../web-test-runtime/src/recovery.ts) 负责数据验证及 generation 发布。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

[src/application.ts](src/application.ts) 解析身份、阻止其指向官方产品的 home 与 profile、注册安装，并释放安装与 Loader 入口。[src/launcher.ts](src/launcher.ts) 把该身份变成一棵运行中的运行时树：它在环境变量仍然指向官方 home 时读取该 home，在任何运行时路径解析之前应用 `launchEnvironment`，把装配层作为自身的 patch 层携带，并拒绝在别的数据根上启动的运行时。它把运行时引导作为参数接收，因此承载方可在本进程内运行同一请求，也可作为子 `dsh` 调用运行。[src/index.ts](src/index.ts) 是服务：它报告配置标签，以及项目、用例、报告的入口声明。入口声明不注册 UI 控件，在挂载的能力接管之前可用性保持 false。 启动请求通过 `applicationPatchFiles` 将装配层放在组合包之后、用户补丁之前，使模型选择可以经正式设置保存；`patchFiles` 保留给更高优先级的命令行覆盖。

| 文件 | 职责 |
|---|---|
| [src/application.ts](src/application.ts) | 身份、数据根、profile、`userData`、更新渠道、注册、释放，以及启动期守卫。 |
| [src/launcher.ts](src/launcher.ts) | 启动顺序、把装配层作为 patch 层携带，以及启动后的数据根断言。 |
| [src/index.ts](src/index.ts) | 服务生命周期、配置标签与可用性。 |
| [src/entry-points.ts](src/entry-points.ts) | 预期入口声明。 |
| [src/types.ts](src/types.ts) | 身份与入口类型。 |
| [web-test.cordis.patch.yml](web-test.cordis.patch.yml) | 装配层：挂载入口并禁用四个出口行。 |
| — | 不发布运行时不变量伴随模块；本包没有可能发生偏离的独立维护观察。Loader 回归验证其服务生命周期与数据根。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下归属文件规定装配要求和剩余工作。

- [添加包](../../../docs/cookbook/adding-a-package.zh.md) — 工作区注册与构建要求。
- [架构](../../../docs/architecture.zh.md) — 支持的 profiles 与插件扩展点。
- [M1 任务卡](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m1.zh.md) — 应用装配与准入。
- [装配回归](tests/assembly.e2e.ts) — 无密钥、普通 Node 下对构建文件入口和请求清单的 Loader 检查。
- [身份回归](tests/identity.e2e.ts) — 无密钥检查数据根、应用自有 profile、出口关闭与释放。

-----

<a id="model-experience"></a>
## 模型体验

### 包清单

#### 模型看到什么

身份入口不增加提示、工具或结果文本。启用 DeepSeek 插件清单时，上游贡献者将活动包名与版本记录在 `dsh_plugin_packages` 请求元数据中；协议归[插件清单包](../../llm/plugin-package-inventory-deepseek/README.zh.md)。



#### Token 影响

身份入口不增加模型输入文本。挂载自动化 provider 会增加四个工具 schema 和每次提交调用的结果；观察包含页面文本，截图包含图像字节。请求元数据不构成实测 token 用量结论。

#### KV 缓存影响

身份入口不构建模型上下文或缓存键。挂载或移除自动化会改变工具集，其结果会改变后续模型输入；提供方对清单元数据的行为仍由上游负责。

## 已知限制与待完成工作

<a id="known-limitations-and-deferred-work"></a>

本包实现的子项尚未验收；剩余工作列在这里，以免下一位 owner 把通过的测试当成已交付的应用。

- `launchWebTestApplication` 能组装引导请求并在本进程内运行或交给子 `dsh`，但只有它自己的测试调用它。`apps/desktop` 的桌面 shell 是承载方而非引导进程：该目录下的 `pnpm run dev:web-test` 会应用 `launchEnvironment`、注册安装，并以本身份打开 shell，shell 的 Host 子进程则自行通过 `assertDesktopHostLaunched` 校验数据根与已挂载入口。把 shell 自身的启动当作运行时引导交给启动器，就等于伪造该校验要读取的入口 id，因此启动器的承载路径仍未实际使用，且 `desktop` profile 仍无法从 CLI 到达。
- 浏览器自动化能力不在本包。[实验 provider](../../experimental/browser-use-web-test/README.zh.md) 拥有那四个通道工具及其自身的生产接线缺口，因为它需要一个本包不得依赖的实验运行时。
- 已注册的浏览器 `userData` 目录现在有了消费方：以本身份启动的 shell 会把 Electron 的 `userData` 指向它，并在注册释放时一并释放。更新渠道仍然是解析、注册、释放后无人消费，因为检查它的 shell 不属于本包。
- 释放入口会停止该行并注销服务；从文件装配中删除该行属于 Loader 自身的 `remove`，此处未做验证。
- 已声明入口除语言键外没有 Client 控件或类型化词典，普通加载／不加载的模型请求对照仍待完成。
- `docs/config-catalog.md` 与 `docs/subsystems/web-test.md` 仍把身份字段描述为纯标签；它们是生成内容，本包不更新。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

只有当启动器在运行时解析任何路径之前应用 `launchEnvironment` 时，数据根才真正分离两个产品，因此回归测试核对已启动运行时自己的 `dshHomePath()` 与已注册的数据根，而不是相信一次干净的启动。

</details>
