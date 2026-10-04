---
kind: upgrade-guide
description: "更新直接搜索工具 Consumer 和 Web 测试确认请求，以使用结构化只读搜索。"
---

# 只读源码搜索

[English](guide.md) | 中文

## 变更

`applyGlobTool` 和 `applyGrepTool` 改为使用 `ctx.fsSearch`，不再发起任意进程请求。挂载 `@deepseek-ai/dsh-tool-fs-search` 会自动安装打包的 Provider；直接安装工具时必须提供 `ReadonlySearch`。Provider 删除 Windows `SystemRoot` 以外的继承环境条目，设置 `LC_ALL=C`，并禁用 ripgrep 配置及链接遍历。

Web 测试策略将 grep 判定为 `read-source`，检查调用 Session 和规范目标，并在执行时扣除一次授权动作。搜索确认请求使用 `fsSearch.search` 入口。通用 subprocess、shell 和 terminal 执行仍被拒绝。取消时报告 `SEARCH_ABORTED`，包括 subprocess Provider 拒绝其 outcome 的情况。

## 迁移

1. 保持已发布搜索插件挂载在 subprocess backend 之后。在每个 Agent 预设的 `config.plugins` 中，为搜索行添加 `isolate: { fsSearch: true }`，包括已保存的 profile 覆盖。已发布的 `standard`、`ptc` 和 `cordis` 声明已包含此项。确认所选预设下的 `session.create` 成功；缺少此域时，创建会以 `agent-preset/invalid` 拒绝。直接安装工具时，先挂载 `PackagedReadonlySearch`，再安装工具，并向其 Context 注入 `fsSearch`。
2. 对 grep 应用 `read-source` 确认规则，搜索确认请求使用 `entry: 'fsSearch.search'`。确认环境覆盖每个已注册代码根后，再授权流程。
3. 处理调用方取消和 Provider 卸载对应的 `SEARCH_ABORTED`。确认真实 glob 和 grep 返回源码结果，同时私有路径、越界链接及任意进程调用仍被拒绝。
