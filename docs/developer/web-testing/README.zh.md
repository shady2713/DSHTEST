---
description: Web 测试桌面应用的需求、设计、验收及开发任务导航。
---

# Web 测试应用：开发交接入口

[English](README.md) | 中文

<a id="summary"></a>

## 概述

通过本参考页查找 Web 测试需求、设计、验收标准与开发任务。[可安装插件计划](../../../.agents/notes/proposed/architecture/2026-10-04-web-testing-installable-plugin-plan.zh.md)负责选定的交付路线及 S0–S6 顺序：在原版 DSH 中安装外部 bundle，首期采用独立 Chrome／Edge。旧规范保留业务要求和历史证据。[协作指南](../../../.agents/notes/proposed/process/2026-09-28-web-testing-agent-guide.zh.md)记录之前的交付状态和工作派发。用户指令决定授权范围；文档检查不代表产品验收通过。

<a id="contents"></a>

## 目录

- [阅读顺序](#reading-order)
- [规范归属](#specification-owners)
- [开发任务](#development-tasks)
- [仓库位置](#repository-locations)
- [开发备注](#dev-note)

<a id="reading-order"></a>

## 阅读顺序

用户本次指令决定授权任务范围；持有这些文档不自动获得开发、提交、推送、发布、部署或发送外部消息的授权。

1. 阅读[根规则](../../../AGENTS.md)、[协作指南](../../../.agents/notes/proposed/process/2026-09-28-web-testing-agent-guide.zh.md)和[固定基座](../../../.agents/notes/proposed/process/2026-09-28-web-testing-upstream-baseline.zh.md)，包括 [rc.2 增量升级影响与证据范围](../../../.agents/notes/proposed/process/2026-09-28-web-testing-upstream-baseline.zh.md#rc2-incremental-upgrade)。
2. 阅读[需求](../../../.agents/notes/proposed/feature/2026-09-28-web-testing-requirements.zh.md)、[架构](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-architecture.zh.md)、任务相关详细设计及[验收标准](../../../.agents/notes/proposed/testing/2026-09-28-web-testing-acceptance.zh.md)。
3. 阅读[里程碑](../../../.agents/notes/proposed/process/2026-09-28-web-testing-milestones.zh.md)、当前任务卡、前置证据、适用目录规则与实际代码；指南提供[可复制的派发指令](../../../.agents/notes/proposed/process/2026-09-28-web-testing-agent-guide.zh.md#dispatch-instructions)。

<a id="specification-owners"></a>

## 规范归属

每份文档负责下列主题；需要更新时修改其归属文件，不另建规范副本。

| 文档 | 唯一负责的内容 |
|---|---|
| [产品需求](../../../.agents/notes/proposed/feature/2026-09-28-web-testing-requirements.zh.md) | R01–R58、首版范围、用户交互与产品限制 |
| [测试用例与报告规格](../../../.agents/notes/proposed/feature/2026-09-28-web-testing-test-case-report-spec.zh.md) | 预期依据、用例确认、覆盖分母、结果分类、缺陷包与复现证据 |
| [技术架构](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-architecture.zh.md) | TD01–TD12、模块职责、数据与调用关系、I01–I05 |
| [详细设计：接口与执行](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-design-execution.zh.md) | DD01–DD05、浏览器/原生目标、策略、Remote、能力矩阵 |
| [详细设计：数据与恢复](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-design-recovery.zh.md) | DD06–DD09、持久权威、动作、恢复、版本和附件引用 |
| [详细设计：模型与发行](../../../.agents/notes/proposed/architecture/2026-09-28-web-testing-design-models-release.zh.md) | DD10–DD13、路由与收益、安装更新、V01–V18 |
| [基座与上游升级](../../../.agents/notes/proposed/process/2026-09-28-web-testing-upstream-baseline.zh.md) | 基座策略与固定版本核验、规则继承、官方复用、必要补丁及升级程序 |
| [验收标准与追踪](../../../.agents/notes/proposed/testing/2026-09-28-web-testing-acceptance.zh.md) | AC01–AC58、G01–G16、场景与最终通过条件 |
| [开发里程碑与验证计划](../../../.agents/notes/proposed/process/2026-09-28-web-testing-milestones.zh.md) | M0–M5、P01–P08、材料与资源预算、阶段放行 |
| [Agent 开发与协作指南](../../../.agents/notes/proposed/process/2026-09-28-web-testing-agent-guide.zh.md) | 主 agent/subagent、文件写入权、并行波次、审查与交接 |
| [开发覆盖与交接](../../../.agents/notes/proposed/testing/2026-09-28-web-testing-development-coverage.zh.md) | 每项 AC/G/V 的主责任务和证据索引要求 |

<a id="development-tasks"></a>

## 开发任务

六份阶段文件包含 50 张任务卡；执行顺序取决于各卡前置条件与里程碑放行标准。等待上游内嵌载体的约束已撤销。按[协作指南](../../../.agents/notes/proposed/process/2026-09-28-web-testing-agent-guide.zh.md)，并行恢复 M0-T03 的受控浏览器接入与满足前置的[M1 基础子项](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m1.zh.md#development-admission)。有限开发许可不代表整卡或阶段验收通过。

| 阶段 | 任务数 | 文件与阶段目标 |
|---|---|---|
| M0 | 11 | [基座验证](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m0.zh.md)：固定规则/材料，验证关键假设及产品有效性 |
| M1 | 7 | [基础装配](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m1.zh.md)：官方桌面、约定、最小状态、配置/策略/项目及页面观察 |
| M2 | 9 | [测试闭环](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m2.zh.md)：分析、用例、真实执行、证据和报告 |
| M3 | 7 | [持久任务](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m3.zh.md)：恢复、重试、接管、停滞、空间和资源 |
| M4 | 10 | [完整能力](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m4.zh.md)：原生/外部浏览器、复杂业务、回归、Skills、轻量模型和专项 |
| M5 | 6 | [验收发行](../../../.agents/notes/proposed/testing/2026-09-28-web-testing-tasks-m5.zh.md)：原生安装/更新、全部验收、真实 24 小时及交付 |

<a id="repository-locations"></a>

## 仓库位置

Git 根目录包含源码、官方规则与应用规范。根 README 链接到本页；中英文按[官方配对规则](../../i18n/README.zh.md)保持同等权威。

| 相对 Git 根目录的位置 | 用途 |
|---|---|
| `AGENTS.md`、`docs/AGENTS.md`、适用目录规则 | 上游开发要求 |
| `README.md`、`README.zh.md`、`README.i18n.yaml` | 上游介绍及应用导航 |
| `docs/developer/web-testing/` | 本交接入口及其双语记录 |
| `.agents/notes/proposed/` | 按 feature、architecture、process、testing 分类的应用规范 |
| `.artifacts/web-testing/` | 被忽略的本地核验清单和日志，缺失时重新生成 |

升级和文档归属见[基座规则](../../../.agents/notes/proposed/process/2026-09-28-web-testing-upstream-baseline.zh.md#document-languages-and-entry-points)。交接必须同时包含应用文档与 DSH 源码。文档尚未提交时，仅从 Git 历史创建的克隆或工作树会遗漏这些文件；应使用当前目录，或迁移并核验未提交文件。本地核验结果不能证明另一环境已经通过验收。

<a id="dev-note"></a>

## 开发备注

无。
