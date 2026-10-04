---
kind: upgrade-guide
description: "Web 测试 URL 检查与项目修正除修订外还须提供界面显示的项目身份。"
---

# Web 测试项目命令身份

[English](guide.md) | 中文

## 变更

`WebTestCommands.probeEntryUrls` 与 `web_test_probe_entry_urls` 工具除 `expectedRevision` 外还必须提供 `projectId`。新 `updateProject` Remote 与 `web_test_update_project` 工具也必须提供正在修正的项目身份。卡片仍显示时，Session 关联可能已切换；调用方须发送界面显示的项目身份，不能依赖当前关联。

修正保留项目身份，发布新的资料修订。旧环境声明与 URL 观察保留各自修订；修正不授予许可，也不发送 URL 请求。Runtime 在写队列中核对已保存的 Session 关联，并在发布前再次核对活跃属主资格。发布前拒绝可能保留暂存内容，已发布资料保持不变。Session 日志与持久项目格式不变。

## 迁移

1. 更新 Remote 与工具调用方，读取当前 `StatusReport.project.projectId` 与 `revision`，分别作为 `projectId` 与 `expectedRevision` 发送。不能把后来选择的身份代入用户实际操作的旧卡片。
2. 使用匹配 Host 重新生成 Client 定义。项目修正调用须提供显式替换的 `codeRoots`、`entryUrls` 及 `cmd-` 命令 token；只有相同修正才能复用 token。
3. 收到 stale 或 context-changed 拒绝后刷新所选 Session。确认两个同修订项目之间切换时，旧卡片的修正或 HEAD 请求不会转向新项目；查询保存状态不产生网络请求或测试运行。参阅[对话参考](../../../../packages/web-test/web-test-conversation/README.zh.md)。
