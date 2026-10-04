---
kind: upgrade-guide
description: "更新通过注入服务读取或修改原始运行时句柄的动态 Host 包。"
---

# 动态 Host 运行时句柄访问

[English](guide.md) | 中文

## 变更

动态 Host 包此前可能通过注入服务的属性、方法结果、事件参数及回调接收对象获得未包装的运行时对象。Host runner 现在递归保护返回的 Agent、Scope 和 Service 对象，包括数组中的句柄及异步结果中的句柄。事件、effect、计时器及服务回调也收到受保护的参数与接收对象。Cordis Context 值会被拒绝。框架符号不可访问，包括 `Symbol.for('cordis.original')`；反射属性描述符提供受保护的访问方式，不暴露原始实例状态。对受保护的运行时对象赋值、定义或删除属性会被拒绝。

活动的 `Map` 和 `Set` 状态会被拒绝。数组、二进制及普通 JSON 数据仍可读取。读取运行时私有字段、修改返回句柄或通过反射获取原始服务的动态包会受到影响。公共服务方法仍是操作运行时的受支持方式，其自身的授权要求依然适用。[Host runner](../../../../packages/extensions/cordis-host-runner/README.zh.md) 负责动态包执行。

## 迁移

动态工具执行元数据也保护调用方 Agent。向 Service 的 `create`、`resume` 或 `createAgent` 传递受信任 `setup` 回调会被拒绝，包括 factory 别名。将 scoped Agent 组合移入已安装 Host provider，动态包的 effect 保留在包自己的 `ctx` 上。

1. 更新动态包的 Host `apply(ctx)` 代码及处理器，使用 `inject` 中声明的服务的公共方法。移除对其他对象 `.ctx`、原始服务符号，以及用于获取运行时对象的描述符 `.value` 字段的读取。
2. 将直接访问私有 `Map` 或 `Set` 字段的代码改为调用公共查询方法。若 provider 归你维护，通过公共方法返回所需的普通 JSON 数据。等待异步结果，并通过公共方法使用返回的句柄；不要对其属性赋值、定义或删除。
3. 重跑包已有的操作及查询。确认受支持的数组、二进制和 JSON 读取仍能成功，而 Context 访问、原始服务获取、活动容器访问及运行时属性修改均被拒绝。[sandbox-context 回归](../../../../packages/extensions/cordis-host-runner/tests/sandbox-context.spec.ts) 覆盖这些拒绝行为。
