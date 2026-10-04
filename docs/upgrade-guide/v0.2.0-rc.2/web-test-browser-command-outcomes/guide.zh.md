---
kind: upgrade-guide
description: "Web testing 活动格式 3 和 4 区分浏览器确认未执行，并使旧执行者数据保持只读。"
---

# Web testing 浏览器命令结果

[English](guide.md) | 中文

## 变更

新建 Web testing 控制根写活动格式 3。浏览器确认未执行后，原 ISSUED 动作结算为 NOT_EXECUTED，保留已关联的工具调用与 wire 回执。UNKNOWN 保持未结算，原业务意图不能再次派发。格式 4 是对应的仅恢复候选。旧读器拒绝格式 3 和 4。

旧格式 1 和 2 保留严格校验，当前 Runtime 对其保持只读。已选择的既有数据代不会复写或自动迁移。这些活动格式独立于 [Session 格式](../../../session-format-status.zh.md)，本次改动不改变 Session 事件。

## 迁移

1. 使用当前 Runtime 打开既有配置的 `controlRoot` 前，停止旧执行者。保留完整旧根及其 `current.json`、数据代和恢复备份。以 `readPersistentActivity()` 读取；不得删除或重新分类 UNKNOWN 动作。
2. 为当前执行配置另一个真正不存在的 `controlRoot`。不提供旧执行者向当前执行者的迁移。启动新根不会授权重复旧根中的未结算业务意图。
3. 更新可信消费者，仅对真实且已关联的浏览器拒绝回执调用 `WebTestPrototypeControl.markNotExecuted(operationId, receipt, callerOwnerCtx)`。错误结果仍保留为错误；成功使用 `markCompleted`，不确定结果使用 `markUnknown`。
4. 恢复时，保留的 1→2 路径使用 `checkPrototypeFormat1`，3→4 使用 `checkPrototypeFormat3`。`RecoveryCoordinator.prepare` 核对独立备份并创建相邻候选，`activate` 重新检查文件清单后才选择候选。保留前代和备份。恢复候选不会授予执行权或降级支持。
5. 通过 `readPersistentActivity()` 并检查 `prototype-activity.json` 确认所选活动格式。确认未执行的动作保留完整回执，且不出现在 `unsettledOperationIds`；UNKNOWN 仍列出。准入与回执要求见 [Runtime 参考](../../../../packages/web-test/web-test-runtime/README.zh.md)。
