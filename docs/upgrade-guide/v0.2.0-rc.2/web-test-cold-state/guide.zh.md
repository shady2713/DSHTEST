---
kind: upgrade-guide
description: "既存 Web 测试控制根需要经核实的活动历史，直接调用恢复 API 的代码必须提供原子发布策略。"
---

# Web 测试冷活动登记

[English](guide.md) | 中文

## 变更

创建或选定 Web 测试数据代之前不会登记原型活动。现在，仅当该进程创建了 `controlRoot` 最后一级目录、且目录仍为空时，Runtime 才会在发布首个指针前提交完整的空格式 1 活动记录。其启动摘要表示业务组合尚未登记；首个有界批次提供实际组合摘要。

既存根缺少 `current.json` 时会被拒绝，不再自动选择数据代。已选定的数据代缺少有效 `prototype-activity.json` 时仍不完整。Desktop 退出与更新检查不能从不完整历史推断无活动。既存有效的 PAUSED 和 UNKNOWN 记录保持原样。初始化中断后，重试时该根不再属于新的空根。[Runtime README](../../../../packages/web-test/web-test-runtime/README.zh.md) 说明初始化与生产者授权。

## 迁移

可信 Host 的直接调用现在要向 `PrototypeActivityStore` 构造函数及 `RecoveryCoordinator.open` 第四个参数传入已解析的发布策略。Runtime 与恢复插件入口提供 `windowsRenameDelaysMs`，默认 `[20, 40, 80, 160]`；`[]` 保留一次发布尝试。重试仅使用已刷新到磁盘的同一临时文件，不重新执行业务 I/O。撤权写入失败后，进程内准入仍停止，不声称持久化成功，也不清除 UNKNOWN。

1. 保留已配置的 `controlRoot` 及其数据代。不要删除记录或伪造空活动记录来消除不完整结果。本变更不提供未知旧历史的自动迁移。
2. 对于真正的新 profile，将 Runtime 的 `controlRoot` 设置为此前不存在的最后一级目录。让 Runtime 创建该目录并发布初始记录，不要预先创建最后一级目录。父目录可以已经存在。
3. 对于既存历史，保留有效记录及原动作身份。不完整或损坏的历史应保持离线，直到可信导入方可以确认其实际活动；保留原材料。recovery-only 入口保留记录并拒绝业务派发，不能制造缺失的历史。
4. 确认新根的 `readPersistentActivity()` 返回空 `completenessErrors` 及已登记的 `headRevision`，重新打开后也应如此。完整空记录证明该根无活动。PAUSED、UNKNOWN 及未结算动作在重新打开后仍属于活动；不能仅凭完整性允许退出、更新或派发。
5. 更新 Host 的直接调用，显式传入 `resolveControlWritePolicy(configuredDelays)`。覆盖默认值时，在两个所属插件入口上分别配置 `windowsRenameDelaysMs`。验证临时占用的目标在释放后允许同一次发布完成；目标一直被占用而耗尽预算时，必须保留前一 cut 或指针并返回失败。
