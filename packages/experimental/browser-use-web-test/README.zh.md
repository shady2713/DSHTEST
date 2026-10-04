---
description: "把 Web 测试受控自动化通道以八个浏览器工具暴露给模型，并在目标、租约或代次违规时拒绝而不是重试。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-browser-use-web-test

[English](README.md) | 中文

## 概述

把 Web 测试应用的受控 Host↔Main 自动化通道以八个工具暴露给模型：观察、截图、点击、输入文本、双击、原生按键、受限导航和刷新。本 provider 不拥有浏览器；模型工具只访问其 Session 显式绑定的目标，是否放行由 Desktop Main 判定。目标、租约和代次的违规构成一个封闭集合，遇到即拒绝而不重试；执行结果未知时，模型会收到一个独立的结果类别。

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

在同时挂载 `@deepseek-ai/dsh-web-test` 的 profile 中注册该 provider，并显式启用 Desktop Host 服务：

```yaml
- id: web-test-browser-automation
  name: '@deepseek-ai/dsh-experimental-browser-use-web-test'
  config:
    controlled: true
```

`controlled` 默认为 `false`：不注册工具或 provider 保留项，`web-test.browser-automation` 保持不可用。启用后，provider 等待 Desktop Host 私有提供的 `ctx.desktopBrowserControl`。可信应用 consumer 必须从 `targets()` 中选择存活目标，并显式等待 `bind(actualSession.id, target.target)`，模型工具才能使用它。工具不会创建绑定，也不接受模型参数中的目标或 Session ID。

`DesktopBrowserExecutionGroups` 是多角色目标的可信 Runtime 消费方。在真实 Runtime Service 完成注册后，从其所属 context 构造此消费方；无关 context 无法获得其私有权限。它接收 Main 创建的目标与显式项目／批次／活动代次所有者，原子取得角色许可，并执行一次 `SessionResources.run()` 回调。回调直接调用角色执行器，可重叠页面业务等待；原生输入仍由 Main 串行派发。回调结束时撤销遗留执行器并等待已提交工作结算，Agent 释放撤销全部许可。模型工具不提供执行组创建或目标选择。

### 最小配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `controlled` | `false` | 启用 Desktop Host 服务及其已确认 Session 绑定支持的工具。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-browser-use-web-test)是每个已接受字段及其 JSDoc 的完整来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

每次工具调用都从调用 agent 的实际 Session ID 取得已确认的 `desktopBrowserControl` 绑定。绑定缺失、目标改变、租约撤销或 Host 替换都会拒绝执行。服务负责私有 IPC 的关联；模型参数不能选择另一个目标或 Session。不确定结果传达给模型，不会自动重试。

八种拒绝原因以文本报告：`session-not-authorized`、`unknown-operation`、`wrong-target`、`stale-observation`、`epoch-mismatch`、`revoked`、`action-failed` 和 `navigation-denied`。每种原因都表示未执行任何操作。`unknown` 结果或传输失败表示操作可能已改变页面。

`observe` 与 `screenshot` 不修改页面。截图要求支持图像输入的模型路由与 Web 测试捕获策略；策略在既有 `SessionResources.run()` 回调内通过 Main 捕获已绑定目标并持久保存图片，调用者不能提供图片字节。结果包含携带完整持久引用的正式图片块，以及目标和 Host epoch 元数据；Session 日志保留该引用，以供后续重建模型请求。捕获取消或绑定变化后不返回图片结果。`click`、`type`、`double-click` 与 `press-key` 需要最近一次观察给出的元素引用与页面代次；更老代次的引用会被拒绝，因为页面可能已经移动。每次观察都开启一个新代次。`navigate` 与 `reload` 需要该代次，并在发送前使其失效。Main 只允许与当前观察结果同 HTTP(S) 源且同 pathname、无凭据、同时符合 guest 所有者导航规则的目标；只能改变查询参数与片段。主 frame 导航（包括同文档变化）会使先前观察失效。协议版本为 3；旧版本会被拒绝。

每个目标仅绑定一个 Session。Main 在绑定时冻结其当前 HTTP(S) origin，阻止页面主 frame、工具栏、表单、重定向和弹窗导航到其他 origin。同源业务路径仍可通过页面操作访问；navigate 工具保留仅允许 query/fragment 改变的更严格规则。

[共享协议](../../client/ui-sidebar-browser/README.zh.md#understand-the-implementation) 定义本 provider 发送的消息。

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 插件入口、是否挂载的判定、独占预留、八个工具与拒绝文本。 |
| [src/types.ts](src/types.ts) | Profile 显式启用类型。 |
| [src/group-execution.ts](src/group-execution.ts) | 可信 Runtime 角色协调与执行组静默释放。 |
| [tests/browser-automation-provider.spec.ts](tests/browser-automation-provider.spec.ts) | 基于显式绑定 Host 服务 fixture 的 provider 行为。 |
| [tests/browser-automation-provider.e2e.ts](tests/browser-automation-provider.e2e.ts) | 构建产物入口经真实 Loader 挂载与释放。 |
| — | 不发布运行时不变量伴随模块；本包观察的是自己不拥有的通道，没有可能发生偏离的独立维护观察。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web 测试子系统](../../../docs/subsystems/web-test.zh.md) —— 本 provider 挂载的应用身份与已声明入口点
- [browser-use 注册表](../../browser-use/browser-use/README.zh.md) —— 本 provider 预留的独占槽位
- [浏览器自动化通道](../../../apps/desktop/README.zh.md) —— Main 侧的准入与执行规则
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-experimental-browser-use-web-test) —— 每个已接受的配置字段及其源码声明

-----

<a id="model-experience"></a>
## 模型体验

### 浏览器通道工具

#### 模型看到什么

八条固定工具描述。`web_browser_observe` 返回页面地址、页面标题、页面代次，以及页面上每个具名元素一行。`web_browser_screenshot` 返回正式图片块，以及像素尺寸、目标和 Host epoch 文本，输出不含 base64 文本。`web_browser_click` 与 `web_browser_type` 返回所操作的引用及该引用所属的页面代次。被拒绝的命令返回八条固定文本之一，指明下一步：重新观察、重新打开页面，或停止。执行结果未知的命令返回另一条文本，说明该动作可能已经改变了页面。

#### Token 影响

八条工具描述在 Session 运行期间不变。观察结果是唯一长度随页面增长的结果：页面上每个具名元素占一行，因此元素多的页面成本按比例上升。截图结果追加一条固定元数据文本与一个图片块，图像输入成本遵循路由模型的图像计费规则。

#### KV Cache 影响

工具描述在 Session 生命周期内固定，因此工具 schema 前缀可以跨轮次复用。每个结果都会追加模型此前没见过的内容，本 provider 从不改写更早的请求 token。挂载或移除本 provider 会改变工具集，也因此改变 schema 前缀，每次变更一次。

## 已知限制与待完成工作

<a id="known-limitations-and-deferred-work"></a>

Desktop Host 提供生产服务，但已发布默认配置不启用这些工具，也不为 Session 选择目标。[结果场景](../../../snapshots/session/web-test-browser-outcomes/snapshot.yml) 检查确定性拒绝；[图片场景](../../../snapshots/session/web-test-browser-image/snapshot.yml) 通过 unit carrier 检查真实 Policy、本地附件保存及后续模型请求的正式图片重建。两个场景均不验证 Native 桌面页面，也不代表应用装配完成。

- 启用本 provider 的 profile 必须显式装配。已发布的 `@deepseek-ai/dsh-web-test` 不携带它，Web 测试启动器在运行期也不得依赖本包。
- 取消通过原命令信封到达 Main，并在派发前阻止输入。已交付动作不能撤销，关联答复与未知结果保持区分。提供方释放会等待其操作结算，可信应用消费方负责目标创建与绑定。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本包从 `@deepseek-ai/dsh-web-test` 拆出，因为 provider 需要 `@deepseek-ai/dsh-experimental-browser-use-runtime` 的 `SessionResources`，而已发布包不得依赖实验包。

</details>
