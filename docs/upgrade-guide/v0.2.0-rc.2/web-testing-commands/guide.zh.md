---
kind: upgrade-guide
description: "为修订后的应用 profile 更新 Web 测试命令客户端、模型策略读取方及 Desktop 浏览器载体。"
---

# Web 测试应用接口

[English](guide.md) | 中文

## 变更

Web 测试命令客户端改用带判别字段的 `StatusQueryRequest` 与 `ActionRequest`，不再接收任意记录。会话包发布 `./commands`、`./types`、`./typert` 和 `./remote`，六个会话工具共用同一命令服务。环境声明保留所属工程修订，工程变化后须重新确认。登记的 URL 可达性须显式调用 `probeEntryUrls`；状态查询仅读取已保存观察。

`POLICY_KINDS` 改为策略种类字符串。供应商失败使用闭集诊断，应用不得依赖原始供应商错误文本。持久模型选择在应用重启后的首次使用须通过真实连接探测。

模型状态读取以及 `selectRoute` 的 `reverify: false` 不执行探测或写入。就绪状态须有可复用的持久选择。

`ProfileContext` 新增必填 `applicationPatches`。`runProfile`、Web testing 和 Desktop Host 请求新增必填 `applicationPatchFiles`，在用户补丁之前应用；`patchFiles` 保留更高的命令行优先级。

模型配置目录为每个提供方新增必填 `catalogState` 字段。`unavailable` 保留配置地址并返回空的建议模型列表，其他提供方仍可使用。客户端须区分目录读取失败和成功读取的空目录。

Desktop 浏览器命令协议从版本 1 升为版本 2。载体须支持会话绑定目标、按键、双击、导航及刷新，并处理 `navigation-denied`。不同协议版本混用会被拒绝。浏览器 provider 将 `automation` 回调替换为 `controlled: true` 和正式 `desktopBrowserControl` 服务，默认保持禁用。

## 迁移

1. 重建 Web 测试包并应用随包的 `web-test.cordis.patch.yml`。其中 Runtime 使用 `storageMode: generation-json`；已自行把领域路由到所选数据代的定制组合，可显式保留 `configured`。 提供新的应用层字段，普通 CLI 调用使用空数组。确认保存的选择在重启后仍可读取。
2. 从 `@deepseek-ai/dsh-web-test-conversation/commands` 导入命令请求类型，按对应联合成员更新查询及动作调用。为 Client 调用方注册生成的 `./remote` contribution。分别展示已保存声明的修订和当前环境确认状态。
3. 将 `POLICY_KINDS` 项视为字符串，开始工作前处理连接探测拒绝。凭据继续由正式 credential 服务持有，持久选择仅保存引用。重建 presentation Remote，逐提供方呈现 `catalogState`；建议目录不可用时仍保留显式的确切模型验证。 状态读取不再完成初始化；须显式调用 `configureRoute` 或 `selectRoute` 的 `reverify: true`，并确认后续状态读取不发出模型请求。
4. 同时把 Desktop Main、Host 及浏览器 provider 更新到协议版本 2。将 `automation` 配置替换为 `controlled: true`，并挂载 `desktopBrowserControl`。通过可信载体将既有会话绑定到其所属目标，再发出命令；移除由调用方自行指定 epoch 或目标的捷径。
5. 确认完整 profile 挂载工程命令及模型配置，重开保留工程事实而不恢复权限，导航或刷新后须重新观察。既有版本 2 工程记录仍可读取，不要为迁移删除数据。
