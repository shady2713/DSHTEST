# dsh-plugin-web-test

[English](README.md) | [中文](README.zh.md)

DSH 的 Web 测试插件：在真实 Chrome 或 Edge 中执行已确认的用例，把证据与运行记录保存在插件自有存储中，并向发起测试的会话汇报。

本插件可通过 DSH 插件管理器安装，运行于**未修改的** DSH `0.2.0-rc.2`。它不引入第二套凭证体系、不引入第二套浏览器栈，也不依赖 DSH 源码检出目录。

## 当前已交付的能力

首个版本交付的是经实测的骨架，以及围绕它的存储与执行保证：

- 设置中本地化的 **Web 测试** 分区，数据来自类型化 Remote 调用；
- 每会话可选的 `web-test` Agent 预设，不影响普通会话；
- 落在**执行路径**上的白名单：放行 `web_test_*` 与 `mcp__playwright-mcp__*`，拒绝其他一切工具——即使该工具确实存在于组合中；
- 通过 DSH 官方 Playwright MCP 提供方驱动真实浏览器；
- 存储位于插件自有数据根下的 SQLite，单写者有序写入，版本戳精确匹配，遇到未知数据模式拒绝打开。

用例生成、确认、断言与报告生成属于后续阶段；逐条需求的状态见[需求对应表][mapping]。

## 安装

```sh
dsh plugin --profile <profile> add dsh-plugin-web-test
```

安装会注册 bundle，并加入插件的加载器行：一个指向插件自有数据根的 SQLite 后端、存储服务、bundle 根行，以及可选的 `web-test` 预设。可在设置中禁用或重新启用，也可通过插件管理器操作。

## 运行要求

- DSH `0.2.0-rc.2`（peer 范围在安装时校验）。
- Node `^22.19.0 || >=24.0.0`。
- 一个 Chrome 或 Edge 可执行文件；首版驱动本机浏览器，不使用内置构建。

## Windows 验收状态

**Windows 上的验收全部未验证。** 现有证据只覆盖 Ubuntu 24.04 / Node 24.15.0 / pnpm 11.7.0、
宿主 DSH 0.2.0-rc.2。逐条可执行的验收单见
[WINDOWS-ACCEPTANCE.zh.md](WINDOWS-ACCEPTANCE.zh.md)，其中每一条在未由 Windows 执行者实际跑过之前
都不得记为通过。

## 已知行为：卸载后重装需要重新启用各行

插件的行开关持久化在 profile 的 `cordis.patch.yml` 中，**卸载不会清理这些条目**。因此「禁用 → 卸载 → 重装」之后，插件会以**已安装但全部行禁用**的状态回来：插件管理器显示已启用，但没有任何 fiber 启动，`webTest/*` 全部返回 not found。

这是宿主卸载路径的行为，插件包自身不带 `disabled`。恢复方式是在插件管理器中**逐行重新启用**以下五项（顺序不限）：

- `web-test-storage-sqlite`
- `web-test-store`
- `web-test`
- `web-test-browser-use`
- `web-test-preset`

逐行重新启用后插件即刻恢复，用户数据不受影响（卸载不删除数据目录）。

## 数据

全部业务记录与证据位于插件自有数据根 `$DSH_HOME/plugins/dsh-plugin-web-test`，以仅属主权限创建。插件数据**不使用**宿主自有存储后端，因此禁用或卸载本插件不会影响宿主与会话状态。

[mapping]: ../../.agents/notes/proposed/testing/2026-10-04-web-test-plugin-requirement-mapping.zh.md
