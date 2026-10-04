---
kind: upgrade-guide
description: "将 Web 测试 PTC 程序从直接 Node API 调整为声明的工具绑定。"
---

# Web 测试 PTC provider

[English](guide.md) | 中文

## 变更

Web 测试应用选择 [QuickJS PTC provider](../../../../packages/ptc-runtime/ptc-runtime-quickjs/README.zh.md)。其程序具有 ECMAScript 内建对象、console 和声明的异步工具绑定。直接 Node import、文件系统、网络、进程和定时器 API 不可用。其他 Harness profile 保留现有 provider。

Web 测试策略只为真实 QuickJS provider 实例允许保留的 `run_code` 传输。嵌套工具保留现有作用域、确认和文件保护。在 Web 测试 overlay 中选择 Node provider 会让 `run_code` 继续被拒绝；改变隔离描述标签不能取得许可。

## 迁移

1. 将直接 Node 文件及网络操作替换为 PTC SDK 中声明的工具。等待必需调用并返回无损 JSON。
2. 移除 Node 专用 import 和定时器调用。使用已配置的 PTC 截止时间及工具自身的超时控制。
3. 保留应用的 PTC provider 选择。测试支持的源码读取与已获许可的浏览器动作，并确认受保护物料的读写被拒绝。
