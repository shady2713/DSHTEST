# Windows 验收单

**当前状态：全部未验证。** 本插件的验收证据全部来自 Ubuntu 24.04 / Node 24.15.0 / pnpm 11.7.0，
宿主为未修改的 DSH 0.2.0-rc.2。**没有任何一项在 Windows 上跑过**，下面每条都不得当作已通过。

本清单供拿到 Windows 环境的人逐条执行。每条给出操作、预期结果与实际结果栏；实际结果必须
由执行者填写，**不要在未执行时勾选**。

## 0. 前置

- [ ] 宿主 DSH 版本为 0.2.0-rc.2（`dsh --version`）
- [ ] Node 与 pnpm 版本满足插件包 `engines` 声明
- [ ] 本机已安装 Google Chrome 或 Microsoft Edge（首个版本驱动独立 Chrome/Edge）
- [ ] 一个可访问的测试目标页面

## 1. 安装与启用

- [ ] **经插件管理器安装**：`dsh plugin --profile <profile> add <dsh-plugin-web-test-0.1.1.tgz>` 成功
- [ ] 宿主启动**零失败插件**
- [ ] `compatibility.json` 中**没有**本插件的 `allow-version` 豁免
- [ ] 插件五行全部 `fiber = active`：`web-test-storage-sqlite`、`web-test-store`、
      `web-test`、`web-test-browser-use`、`web-test-preset`

## 2. 设置入口

- [ ] 设置中出现本地化条目 **"Web 测试"**
- [ ] 分区渲染实时数据：状态 / 版本 0.1.1 / 数据版本 3 / 宿主版本 0.2.0-rc.2 /
      项目数 / 运行数 / 数据目录
- [ ] 浏览器控制台**无错误**

## 3. 类型化 Remote 往返

- [ ] `webTest/status` 返回 `ok`
- [ ] `webTest/putProject` 写入后 `webTest/listProjects` 读回
- [ ] 畸形参数被拒，报 `gateway/input-invalid`
- [ ] 写入的数据落在插件自有 SQLite，**宿主 JSON 存储未被写入**

## 4. 测试预设与执行层限制

- [ ] Agent 预设列表中出现 `web-test`
- [ ] 在真实模型回合中：允许的工具（`web_test_*`、`mcp__playwright-mcp__*`）可执行
- [ ] 禁止的工具被**在执行层**拒绝，消息为
      `web-test sessions may only call web_test_* and mcp__playwright-mcp__* tools; "bash" is outside the test execution policy`

## 5. 真实浏览器完成最小测试

- [ ] `web_test_start_run` 建运行并准备证据目录（权限 700）
- [ ] 浏览器打开目标页面，读到页面内容
- [ ] 截图经插件复制进本次运行的证据目录
- [ ] `web_test_report_case` 记录结构化结果，`evidencePaths` 指向插件目录内的副本
- [ ] `webTest/buildReport` 生成的报告列出该证据
- [ ] **陈旧文件被拒**：上报一个早于运行开始的文件，报
      `was last written before this run started`

## 6. 存储与重启

- [ ] 重启宿主后项目、环境声明、运行、用例结果、证据文件全部可读
- [ ] 数据版本为 3；把库版本戳改成 99 后宿主**拒绝打开**（版本闸门）

## 7. 普通会话不受影响

- [ ] 在某个 Web 测试运行处于**暂停**时，新建**非 web-test 预设**的普通会话
- [ ] 该会话的 `bash` 工具正常执行

## 8. 运行控制

- [ ] `webTest/controlRun` 暂停后，浏览器工具在执行层被拒：
      `run <key> is paused by operator request and refuses new test actions`
- [ ] `web_test_status` 在暂停期间**仍可调用**，以便模型说明原因
- [ ] 重复暂停被拒：`is paused and cannot pause`
- [ ] 恢复回到 `running`
- [ ] 取消后**不可恢复**：`is cancelled and cannot resume`
- [ ] 取消后浏览器工具同样被拒

## 9. 禁用与清理

- [ ] 活动任务期间禁用 `include:web-test` → `changed: true, application: applied`，该行 `fiber = null`
- [ ] 禁用后 `webTest/*` Remote 不再响应
- [ ] 插件数据目录**未被触碰**（`evidence`、`web-test.sqlite*` 保留）
- [ ] 重新启用后 `state: active`、记录数不变
- [ ] 宿主退出时浏览器进程**全部回收**

## 10. 卸载与重装

- [ ] 卸载后 `dependencies`、bundle 条目、`node_modules` 全部清除
- [ ] 卸载**不删除**用户数据目录
- [ ] **已知行为**：行开关持久化在 profile 的 `cordis.patch.yml`，卸载不清理；
      「禁用 → 卸载 → 重装」后五行带 `disabled: true` 回来，插件管理器显示已启用但无 fiber 启动。
      恢复方式：逐行重新启用那五行。

## 11. 升级

- [ ] `0.1.1` 覆盖安装到已装 `0.1.0` 的 profile
- [ ] `node_modules` 版本为 `0.1.1`，宿主启动零失败
- [ ] 升级前的数据仍可读，数据格式未变（v3，无需迁移）

## 执行记录

| 项 | 执行人 | 日期 | 结果 | 备注 |
|---|---|---|---|---|
| 1–11 |  |  |  |  |

未填写的行视为**未验证**。
