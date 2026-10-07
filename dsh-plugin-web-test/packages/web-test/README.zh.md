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

### 会改变业务数据的操作

改变业务数据的步骤不只是一次浏览器点击。测试 Agent 在动作**之前**持久记录意图，在动作**之后**独立观察结果，然后结算该操作：

| 工具 | 模型何时调用 | 插件强制什么 |
|---|---|---|
| `web_test_begin_operation` | 紧接变更之前 | 记录先以 `dispatching` 落盘。结果未决的同键重复会被拒绝，因此改个名字或换个工具调用 id 无法变成第二次提交。 |
| `web_test_settle_operation` | 观察到结果之后 | 只结算一次；二次结算被拒绝，首次观察得以留存。 |
| `web_test_operation_unknown` | 断连或无法观察结果时 | 操作保持 `unknown`，作为问题进入报告与操作者界面，且永不再派发。 |

跨重启同理：DSH 进程停止时在途的操作转为 `unknown`，当时正在执行的运行停在 `resuming` 等待显式继续。重启绝不自行恢复工作，因为它无法核对环境、登录，也无法确认变更是否落地。

### 角色与业务时间等待

- `web_test_assume_role` 以操作者为该环境声明的某个角色行事。未声明的角色被拒绝；操作未决时切换角色也被拒绝，因为可能已经存在的变更属于当时的账号。
- `web_test_wait` 把运行停放到某个 ISO 8601 截止时间，并把该截止时间持久化在运行上，因此等待业务事件的等待能跨越宿主关闭。`web_test_resume_wait` 结束等待，在截止时间之前调用会被拒绝并给出剩余时间。

### 操作者控制与 hold

`webTest/controlRun` 是操作者一侧：`pause`、`resume`、`cancel`、`await-user`、`continue`。hold 只停住拥有该运行的会话，不会停住其他会话，因此一个会话的暂停不会中断另一个会话的工作。没有记录归属的运行会停住所有会话，因为插件无法判断它会中断谁的工作。

运行被 hold 期间，六个工具保持可用：`web_test_status`、`web_test_start_run`、
`web_test_operation_unknown`、`web_test_settle_operation`、`web_test_resume_wait` 与
`web_test_control_run`。后两个是把被 hold 或被中断的运行接续下去所用的工具；
一切会驱动浏览器的调用都被拒绝。

### 报告

`webTest/buildReport` 由同一份已记录结果派生出 HTML、Markdown 与 JSON，三者不会互相矛盾。只有当每条已记录用例都通过且没有任何未决事项时，结论才是 `passed`；只要存在待确认问题，或阻塞、未完成、跳过的用例，结论就是 `undetermined`。未决操作连同原因一并列出。HTML 导出会转义用例自身的措辞，因为它们来自模型阅读任意被测页面。

用例生成与确认仍属后续阶段；逐条需求的状态见[需求对应表][mapping]，并注意该表已撤回此前“S0–S6 全部完成”的结论。

## 开发

```sh
pnpm install          # 在 dsh-plugin-web-test/ 下
pnpm run typecheck    # 两个编译面
pnpm run build        # typecheck → 打包 → Typert 生成
pnpm run test         # 单元测试

# 打到新目录，不覆盖已交付过的包
OUT="$(mktemp -d)"; npm pack --pack-destination "$OUT"
```

`pnpm run build` 必须按此顺序：`tsc` 在 `lib/types` 下产出 JavaScript，tsdown 从那里打包，Typert 脚本重写 `src/client/remote.ts` 与 `lib/typert.*` 产物。`tsdown.config.ts` 的清理列表只包含各 bundle 自身的产物，因此 `lib/types` 与 Typert 产物得以保留，而早期构建的内容哈希 chunk 不会残留。

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

**Windows 上的宿主验收全部未验证。** 现有宿主证据只覆盖 Ubuntu 24.04 / Node 24.15.0 / pnpm 11.7.0、
宿主 DSH 0.2.0-rc.2。此后在 Windows 上运行的是本包自身的依赖安装、`tsc`、打包、Typert 生成与单元测试——
那属于构建证据，不是宿主验收。逐条可执行的验收单见
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
