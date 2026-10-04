---
description: "首次运行的模型配置界面（Web 测试）：Host 侧 Remote 报告每种任务类型的路线状态，浏览器侧在输入框上方以全宽条带呈现；面向模型配置体验的维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test-presentation

[English](README.md) | 中文

## 概述

本包在消息输入框上方的状态条显示各任务类型的模型路线就绪状态和拒绝原因。Host 公开来自模型配置权威的配置、验证和状态 Remote；浏览器贡献一个 `conversation.input.dock` 条目，不持有任何领域状态。

同一 dock 显示当前会话的项目、用户环境声明与已保存 URL 观察。用户可以登记或选择项目、修正代码根和 URL，并显式检查可达性。对话工具卡片保留每次请求日志中的事实。

## 目录

- [使用方法](#use-this-package)
- [实现原理](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方法

同时加载 Host 插件与浏览器侧；条带随后出现在输入框上方的全宽 chrome 位置，在任何输入框上下文卡片之下。它是 chrome，不是模态框：不夺取焦点、不阻断输入、也无法被关闭——因为「某个任务类型没有可用路线」是关于本次会话的持续事实，而不是一条需要确认的消息。它在整个会话期间保持可见，而不是显示一次后即被关掉。

会话 dock 通过官方设置与凭据 Remote 配置已装配提供方、确切模型和任务用途。模型字段通过 `remote.settings.mutate` 保存；只写密码草稿直接发送给 `remote.credentials.set`，在等待写入前清空，且绝不进入聊天或工具。留空保留密钥，显式删除调用 `remote.credentials.unset`。保存会真实探测所选路线，仅验证通过的路线才持久化；状态读取不探测，也不写入选择。

每个任务类型显示名称、就绪状态，以及可用时的提供方与模型。未配置、能力缺失和需要重新验证分别显示为 `not-configured`、`capability-absent` 与 `reverify`。没有已保存分类的连接失败显示通用 `transient`；`ready` 仅表示模型权威可以复用已验证且持久化的选择。

条带绝不用未经该任务类型验证的路线做替换，也绝不隐藏它无法路由的任务类型。被拒绝的读取显示 locale 所有的不可用提示；不会显示空路线列表，使用户误以为所有任务都可运行。

状态条与配置面板适应对话区宽度。状态行可换行，表单字段随面板收缩；较长的模型名称、项目路径、URL 与声明换行显示，不隐藏已保存的事实。配置面板共用有高度上限的滚动区域，路线状态条保留在该区域外。两者采用输入框的不透明主题背景，防止聊天内容透过其文字。

### 失败情形

项目面板与对话工具读取同一 `webTestCommands` Remote，所有请求都属于所选 Session。用户可以登记明确给定的代码根与已启动 URL、选择已有项目，或根据界面显示的项目身份与版本修正资料。修正与 HEAD 请求携带该显示身份，之后的 Session 选择不能把操作转向另一个项目。修正保留项目身份，使旧环境确认失效；已保存的声明与 HEAD 观察分别保留自己的版本标签。刷新只读保存状态；显式 HEAD 按钮检查显示的 URL，并提供取消入口，不验证登录，也不授予测试许可。面板只读显示环境声明，声明确认必须经过对话的官方人类确认问题。

测试工具卡片只呈现本次日志中的事实与结果，回放不查询实时项目。普通会话仅看到可选身份，不显示其他项目的私有资料；切换 Session 会重新挂载项目面板。读取或修正失败时，当前资料保持可见，并显示本地化恢复说明。

Remote 调用被拒时显示 locale 所有的不可用提示。表单失败仅显示闭集恢复说明，不渲染异常字符串；读取为视图本地状态，刷新重新读取当前状态。

提供方目录分别报告 `catalogState`。不可用的目录保留提供方配置地址，不隐藏其他提供方。表单初始选择可读取且非空的目录；用户仍可选中目录不可用的提供方，填写确切模型并显式验证路线。

-----

<a id="understand-the-implementation"></a>
## 实现原理

<details>
<summary>实现内部细节——点击展开</summary>

`WebTestPresentation` 暴露 `routeState`、不含秘密的 `configuration` 目录，以及真实探测并保存用户确切选择的 `configureRoute`。Client 还依赖已发布的 settings／credentials Remote 命名空间，不导入私有 provider editor，也不创建凭证库。

派生过程按条带顺序对每个 `ROUTE_TASK_TYPES` 调用 `selectRoute(taskType, { reverify: false })`。就绪决策提供已验证且持久化的提供方与模型。其余决策按原因判别字段映射；没有已保存失败分类的 `connection-failed` 返回通用 `transient`，不会重新测试，也不会解析提供方文本。

浏览器入口要求 Remote 注册服务，挂载 presentation 与 conversation Commands 两份贡献，再等待两个命名空间、settings、credentials、slots 和 locale 后注册条带。`mountWebTestPresentation`（`src/client/mount.ts`）向 `conversation.input.dock` 贡献一个条目，`id: 'web-test-presentation'`、`order: 20`、`locale: 'web-test-presentation'`。条目的注入面是一个注册方私有的 `HostObservable`（`src/client/slots.ts`）、刷新动作以及通过官方 Remote 实现的模型与项目配置操作；渲染器把该 observable 绑定到 `useRouteStatus` prop 分片。该来源仅在该 hook 观察它时订阅，因此卸载条带即释放 Remote 读取；而在更新的读取开始之后才返回的旧读取会被丢弃。`tool.call.toolview` 的 keyed 注册从持久调用与结果片段呈现七个测试命令。

视图状态归浏览器所有。Wire 错误被 locale 所有的诊断替代，响应字符串不会复制到密码表单反馈中。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-web-test-models](../web-test-models/README.zh.md)——模型配置权威：路线选择、连接判定，以及通过官方凭证 Remote 使用的存储。
- [ui-conversation](../../client/ui-conversation/README.zh.md)——声明 `conversation.input.dock` 槽并拥有条带所在的输入框。
- [dsh-typert-protocol](../../typert/protocol/README.zh.md)——本包 `./remote` 导出所依据的 Remote 服务基类与贡献格式。

-----

<a id="model-experience"></a>
## 模型体验

### 路线状态条带

#### 模型看到什么

什么也没有。条带读取 `routeState` Remote 方法并渲染它返回的 `RouteStateResponse`；它不注册任何系统提示、工具 schema、提供方请求字段，也不注册 Session 事件，因此它产出的任何内容都无法被重建进一次模型请求，而它读取的任何内容同样不会进入模型请求。

#### Token 影响

无。状态读取不执行模型探测，也不写入持久选择。只有用户显式保存并测试路线时才会执行真实请求。

#### KV 缓存影响

无。已接纳的历史不受影响：条带只报告某个任务类型将会使用哪条路线，而路线决策并不改变历史前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **缺少已保存分类的失败仅显示通用状态。** 状态读取不会重新探测，也不会从诊断文本猜测凭据、模型或配额失败。用户须显式测试路线。
- **提供方错误可能回显秘密。** 模型权威在内部按原文分类，仅输出闭集安全原因；dock 丢弃不可信异常文字，在等待写入前清空密钥草稿，永不把它放入聊天、工具输出或配置响应。
- **永不隐藏的首次运行界面。** 条带是 chrome，在整个会话期间常驻，因此持续不可路由的任务类型会在屏幕上保留一行。这是有意为之：这一行正是请求会失败的那个持续原因。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

`src/types.ts` 复述任务类型字面量，而不是从权威包导入，这样浏览器侧就不会对 Host 包产生任何边。字面量完全相同，因此 Host 端可以不做任何 cast 直接透传自己的值。`RouteState` 是十成员的封闭联合；`RouteDock.tsx` 里的 `STATE_LABELS` 对它是全映射，因此新增一个状态会编译失败，直到它的文案在两份字典里都存在为止。

`conversation.input.dock` 槽由 ui-conversation 声明，位于 `packages/client/ui-conversation/src/client/contract/slots.ts`（那是它自己的包，本文件不跟踪其行号）。本包只向它贡献条目，因此不声明任何 `SlotMap` merge。

</details>

**运行时不变量：** 未发布伴随不变量。路线状态是一次 Remote 读取，不是本包可能发生漂移的既有关系：唯一被注入的服务是模型配置权威，每一行都在单次读取内由它的答案派生。
