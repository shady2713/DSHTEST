# Agent Note: 开发覆盖与交接

Status: proposed

[English](2026-09-28-web-testing-development-coverage.md) | 中文

## 问题

每项验收要求和验证场景都需要一个主责任务及可检索证据。

## 提案

状态：现行任务映射。历史探针与受限 M1 原型不等于阶段准入或最终验收；证据记录须区分原基座结果、所选基座复验、输入未变可复用项与未执行项。本文件不重新定义产品需求和通过条件；以[需求](../feature/2026-09-28-web-testing-requirements.zh.md)、[验收标准](2026-09-28-web-testing-acceptance.zh.md)、[详细 V 场景](../architecture/2026-09-28-web-testing-design-models-release.zh.md)为准。开发执行方式见[总控指南](../process/2026-09-28-web-testing-agent-guide.zh.md)。

**按依赖安排开发**

共 50 张卡：M0 为 11、M1 为 7、M2 为 9、M3 为 7、M4 为 10、M5 为 6。各卡的“前置”是权威依赖；派发波次、可并行条件和共享文件归属统一见[总控指南](../process/2026-09-28-web-testing-agent-guide.zh.md#recommended-execution-waves)，本文件只维护覆盖关系和交接资产，不另列一套执行顺序。

相邻阶段不等于必须等到所有工作都结束才能阅读下一阶段设计；实际改动仍受任务授权与前置约束。不能为了并行，把创建、提交、目标、动作、用量各复制一个“临时实现”再合并。整体关键路径尚依赖 M0 的真实结论，因此不估一个缺乏依据的总周数；每张卡进入时依据实际仓库给出本地实现、检查、外部等待的分项估算。M0 的 72 工时只是八项探查的初始时间盒，准备与总结另记，24 小时是末期持续运行验收，二者都不代表全部项目工期。

**需求与产品验收主责**

一条需求只有一个收口主责任务；协作任务负责明确的组成部分。主责必须收集协作交付，不能以“我这层已写完”关闭验收。以下全部 58 条的正式产品复核归 M5-T03；系统安装、升级及 V07 还分别引用 M5-T01、M5-T02、M5-T04 的实际结果。

| 需求／标准 | 内容 | 主责任务 | 协作任务 | 收口时必须取到的证据 |
|---|---|---|---|---|
| R01／AC01 | 单人桌面工具 | [M1-T06](../process/2026-09-28-web-testing-tasks-m1.zh.md) | M1-T01、M1-T03 | 单人接入、任务和历史轨迹 |
| R02／AC02 | Windows x64 | [M5-T01](2026-09-28-web-testing-tasks-m5.zh.md) | M4-T01、M4-T03 | 真实系统／安装包／原生输入 |
| R03／AC03 | DSH 底座与升级 | [M5-T02](2026-09-28-web-testing-tasks-m5.zh.md) | M1-T01、M5-T05 | 旧新组合、历史与预检恢复；含旧逻辑卡住的封存更新及 UNKNOWN 跨批次核实 |
| R04／AC04 | DSH 工程规范 | [M5-T05](2026-09-28-web-testing-tasks-m5.zh.md) | M0-T01、各实现卡 | 真实规则、适用性与检查输出 |
| R05／AC05 | 全项目代码与通用接入 | [M2-T02](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T01、M2-T03 | 多根多语言快照、可读性缺口 |
| R06／AC06 | 用户启动项目 | [M1-T06](../process/2026-09-28-web-testing-tasks-m1.zh.md) | M1-T05、M1-T07 | 已启动 URL 与不擅自部署对照 |
| R07／AC07 | 自动推导需求 | [M2-T02](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T03、M4-T06；M0-T09 | 来源、冲突与用户预期；三类依据和关键规则确认 |
| R08／AC08 | 无设计稿视觉检查 | [M2-T05](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M1-T07、M4-T03 | 同条件正常／变形对照 |
| R09／AC09 | 完整功能执行 | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M2-T03、M2-T04、M2-T05 | 功能—用例—实例—断言证据 |
| R10／AC10 | 选择和输入要求 | [M2-T03](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M1-T06、M4-T08 | 自然语言和选项的同一计划 |
| R11／AC11 | 可选专项 | [M4-T08](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M4-T09 | 已选实际执行／未选不执行 |
| R12／AC12 | 被测源码只读 | [M1-T05](../process/2026-09-28-web-testing-tasks-m1.zh.md) | M2-T06、M4-T01、M4-T06 | 所有实际入口拒绝及独立文件核对；含动态工具、官方引导及人工审批路径 |
| R13／AC13 | 业务数据可变更 | [M2-T04](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M1-T05、M2-T07 | 环境范围内新旧业务变更 |
| R14／AC14 | 报告而不自动修复 | [M2-T08](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M1-T05、M2-T09 | 缺陷包与源码未变 |
| R15／AC15 | 测试历史 | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M1-T03、M3-T01、M5-T02 | 真实历史、重开与旧引用 |
| R16／AC16 | 长任务自动恢复 | [M3-T02](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M3-T01、M3-T03、M4-T07 | 两类请求持久重试／重开；失败步骤工具结果配对、UNKNOWN 核实及实际续跑 |
| R17／AC17 | 无模型费用额度 | [M3-T02](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M1-T04、M3-T04 | 无费用终止条件及支付独立授权 |
| R18／AC18 | 按任务模型路由 | [M4-T07](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M1-T04、M3-T02 | 真实轻量路线、公共协议、替换能力及校准；A／B／C 质量及收益分开结论 |
| R19／AC19 | 用户 skill（技能） | [M4-T06](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M2-T03、M1-T05 | 适用规则、冲突和版本 |
| R20／AC20 | 原生对话体验 | [M1-T06](../process/2026-09-28-web-testing-tasks-m1.zh.md) | M1-T04、M4-T06 | 项目关联／无关联对话与隔离 |
| R21／AC21 | skill 草案确认 | [M4-T06](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M2-T02、M3-T01 | 草案差异、接受／拒绝与冻结依赖 |
| R22／AC22 | 登录与接管 | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M3-T03、M4-T01、M4-T02 | 实际登录、人工接管及脱敏 |
| R23／AC23 | 电脑占用 | [M4-T01](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M3-T03 | 桌面租约、焦点和恢复 |
| R24／AC24 | 日志和只读数据 | [M2-T06](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M1-T05、M2-T05 | 业务 ID 关联、实际只读权限 |
| R25／AC25 | 真实外部动作确认 | [M2-T06](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M1-T05、M2-T04 | 范围、间接触发、未知发送核实 |
| R26／AC26 | 自然语言控制全程 | [M2-T09](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M1-T02、M1-T06、M3-T03 | 去重创建、真实控制和卡片 |
| R27／AC27 | 先用例后执行 | [M2-T03](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T07、M1-T05 | 用例先于数据准备时间线 |
| R28／AC28 | 中途新业务疑问 | [M2-T03](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T08、M4-T05 | 疑问→新用例→真实补测 |
| R29／AC29 | 逐项执行与覆盖 | [M2-T05](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T03、M2-T08 | 动态分母与单次完整尝试；实现诊断不混入业务通过 |
| R30／AC30 | 新版本用例确认 | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M2-T02、M2-T03 | 旧新预期与开测前确认 |
| R31／AC31 | 人与 AI（人工智能） 可用的报告 | [M2-T08](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T05、M5-T03 | 独立人员／AI 复现固定缺陷 |
| R32／AC32 | 无页面后端功能 | [M2-T06](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T04、M4-T04 | 异步真实终态，不只看受理 |
| R33／AC33 | 数据保留与清理 | [M2-T07](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T08、M3-T01 | 初报→清理→新报及保留材料 |
| R34／AC34 | 仅所属会话提醒 | [M3-T06](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M1-T06、M3-T01 | 只在所属会话的去重提醒 |
| R35／AC35 | 内置及独立浏览器 | [M4-T02](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M1-T07、M4-T01、M4-T03 | 双浏览器及宿主隔离 |
| R36／AC36 | 关窗与退出 | [M3-T03](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M1-T07、M4-T01、M4-T02 | 官方关窗／托盘／退出复用；冷会话持久批次纳入检查，明确退出／重开区别 |
| R37／AC37 | 重开自动续跑 | [M3-T01](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M2-T04、M3-T02、M3-T03 | 关键中断点外部业务对账 |
| R38／AC38 | 证据与保留 | [M2-T05](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M4-T03、M3-T05 | 原图／录像／引用和清理 |
| R39／AC39 | 多格式报告 | [M2-T08](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M3-T05、M4-T05 | 固定版本三格式离线完整性 |
| R40／AC40 | 页面视口 | [M1-T07](../process/2026-09-28-web-testing-tasks-m1.zh.md) | M2-T03、M4-T03 | 实际视口／DPR／DPI |
| R41／AC41 | 用例完整性检查 | [M2-T03](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T02、M4-T09 | 植入遗漏被发现与补齐 |
| R42／AC42 | 跨入口完整流程 | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M2-T01、M2-T04 | 同业务记录跨端闭环 |
| R43／AC43 | 业务并发 | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M0-T05、M3-T03 | 有时间重叠的冲突与同步 |
| R44／AC44 | 测试期间版本变化 | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M2-T02、M2-T08 | 部署信号／声明与变化隔离 |
| R45／AC45 | 可选回归基线 | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M2-T05、M2-T08 | 指定正确基线不被未完成覆盖 |
| R46／AC46 | 保留初次失败与有限复试 | [M2-T04](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T05、M4-T05 | 初次失败、有限尝试、分母不增 |
| R47／AC47 | 用户纠正与处置 | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M2-T08、M4-T06 | 处置理由、版本与旧事实 |
| R48／AC48 | 任务避免干扰 | [M3-T03](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M4-T01、M4-T03 | 跨批排队／组内并发／桌面独占 |
| R49／AC49 | 默认异常恢复 | [M4-T04](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M2-T03、M1-T05 | 注入实际生效、解除及业务结果 |
| R50／AC50 | 数据和文件准备 | [M2-T07](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T06、M4-T03 | 附件真实内容、准备和错误下载 |
| R51／AC51 | 跨时间业务 | [M4-T04](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M3-T03、M3-T04 | 实际经过时间、时窗与缺口 |
| R52／AC52 | 旧数据兼容 | [M4-T05](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M2-T01、M4-T03 | 可追溯旧记录／附件／缓存 |
| R53／AC53 | 运行中补齐用例 | [M2-T03](../process/2026-09-28-web-testing-tasks-m2.zh.md) | M2-T02、M2-T04 | 发现去重、先保存计划再执行 |
| R54／AC54 | 环境声明及授权范围 | [M1-T05](../process/2026-09-28-web-testing-tasks-m1.zh.md) | M1-T06、M2-T06、M2-T07 | 入口声明、具体授权与变化失效 |
| R55／AC55 | 空间与本地资产管理 | [M3-T05](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M2-T05、M2-T08、M3-T03；M0-T10、M1-T03 | 预警、等待、确认清理和共享保护；普通 Session／fork 共享及实际 提供方 删除 |
| R56／AC56 | 首次配置及凭证 | [M1-T04](../process/2026-09-28-web-testing-tasks-m1.zh.md) | M1-T06、M3-T02 | 官方编辑和凭证服务复用、会话配置卡片、全新配置与真实连接、秘密不入日志 |
| R57／AC57 | 整体无进展检测 | [M3-T04](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M3-T03、M3-T06 | 成对停滞／等待与重启不清零 |
| R58／AC58 | 运行状态与用量 | [M3-T06](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M3-T02、M3-T04 | 请求去重、未知用量与查询无调用 |

**官方工程标准主责**

这些要求适用时在功能开发当时执行，不能全部拖到 M5。主责建立机制或收口证据，所有改动方遵守；最终复核为 M5-T05。实际基线的上游新增要求即使未列入旧表也不能忽略。

| 标准 | 内容 | 主责任务 | 收口证据重点 |
|---|---|---|---|
| G01 | 规则与入口 | [M1-T01](../process/2026-09-28-web-testing-tasks-m1.zh.md) | loader／规则发现，M0-T01 基线和 M5 最终入口 |
| G02 | 包与编译 | [M1-T02](../process/2026-09-28-web-testing-tasks-m1.zh.md) | 各新增包真实严格编译、导出和依赖 |
| G03 | 远程接口 | [M1-T02](../process/2026-09-28-web-testing-tasks-m1.zh.md) | 真实 Remote 生成／Connection／取消 |
| G04 | 插件与生命周期 | [M3-T03](../process/2026-09-28-web-testing-tasks-m3.zh.md) | 所有 提供方／监听／目标／进程释放 |
| G05 | 模型与回放 | [M4-T07](../process/2026-09-28-web-testing-tasks-m4.zh.md) | 主／辅助请求记录、回放和唯一重试 |
| G06 | 工具执行 | [M1-T05](../process/2026-09-28-web-testing-tasks-m1.zh.md) | 工具、PTC、直接服务及原生执行处 |
| G07 | 权威状态 | [M1-T03](../process/2026-09-28-web-testing-tasks-m1.zh.md) | 创建／锁／提交／旧槽位及外部对账 |
| G08 | 附件与证据 | [M2-T05](../process/2026-09-28-web-testing-tasks-m2.zh.md) | 正式附件、原字节、共享保护及导出 |
| G09 | 行为与代码覆盖 | [M5-T05](2026-09-28-web-testing-tasks-m5.zh.md) | 每文件覆盖、适用顶层不变量及失败对照 |
| G10 | 快照与 SDK | [M5-T05](2026-09-28-web-testing-tasks-m5.zh.md) | 真实录制、回放、期望与相关 SDK |
| G11 | 类型、配置与事件 | [M1-T02](../process/2026-09-28-web-testing-tasks-m1.zh.md) | ID／Config／事件／判别和输出边界 |
| G12 | 持久化兼容 | [M5-T02](2026-09-28-web-testing-tasks-m5.zh.md) | 持久类型变更、历史读取和迁移失败 |
| G13 | 构建与发行 | [M5-T01](2026-09-28-web-testing-tasks-m5.zh.md) | 干净构建、产物 smoke、原生安装 |
| G14 | 正式文档 | [M5-T05](2026-09-28-web-testing-tasks-m5.zh.md) | 正式英中配对、JSDoc、目录及预算 |
| G15 | 界面与模型体验 | [M2-T09](../process/2026-09-28-web-testing-tasks-m2.zh.md) | typed locale、纯 展示转换器、重连与模型描述 |
| G16 | 升级证据 | [M5-T05](2026-09-28-web-testing-tasks-m5.zh.md) | 规则变化、窄修改、CI 和升级语义；新外发默认值及首启配置审计 |

**详细技术场景主责**

V 场景与 AC／G 相互补充，不用一次普通流程成功替代故障对照。正式证据在 M5-T03 汇总；V07 的实际运行必须由 M5-T04 完成。

| 场景 | 内容 | 主责任务 | 协作任务 |
|---|---|---|---|
| V01 | 页面与宿主隔离 | [M1-T07](../process/2026-09-28-web-testing-tasks-m1.zh.md) | M1-T05、M4-T02 |
| V02 | 复杂页面和真实输入 | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M4-T01、M4-T02 |
| V03 | 身份、跨入口与并发 | [M4-T03](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M0-T05、M3-T03 |
| V04 | 跨 Host／登录会话唯一写入 | [M3-T01](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M1-T03、M5-T02 |
| V05 | 创建／动作／通知中断 | [M3-T01](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M2-T04、M3-T02 |
| V06 | 暂停与迟到结果 | [M3-T03](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M3-T02、M4-T01 |
| V07 | 真实 24 小时及数值预算 | [M5-T04](2026-09-28-web-testing-tasks-m5.zh.md) | M3-T07、M4-T10 |
| V08 | 所有入口源码保护 | [M1-T05](../process/2026-09-28-web-testing-tasks-m1.zh.md) | M2-T06、M4-T01、M4-T06 |
| V09 | 原生窗口、焦点与路径 | [M4-T01](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M1-T05、M4-T03 |
| V10 | 轻量决策协议／故障／恢复 | [M4-T07](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M3-T02 |
| V11 | 过期观察／模型别名／缓存 | [M4-T07](../process/2026-09-28-web-testing-tasks-m4.zh.md) | M1-T04、M3-T02 |
| V12 | 历史、清理和导出 | [M3-T05](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M2-T08、M4-T05、M4-T06 |
| V13 | Windows 安装及显示环境 | [M5-T01](2026-09-28-web-testing-tasks-m5.zh.md) | M4-T01、M4-T03 |
| V14 | 更新资格、迁移和失败恢复 | [M5-T02](2026-09-28-web-testing-tasks-m5.zh.md) | M3-T01、M5-T05；M0-T11 |
| V15 | 环境及授权变化 | [M1-T05](../process/2026-09-28-web-testing-tasks-m1.zh.md) | M1-T06、M2-T06、M2-T07 |
| V16 | 空间与引用安全 | [M3-T05](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M2-T05、M2-T08；M0-T10 |
| V17 | 首启配置和凭证 | [M1-T04](../process/2026-09-28-web-testing-tasks-m1.zh.md) | M1-T06、M3-T02 |
| V18 | 停滞、等待、状态和用量 | [M3-T07](../process/2026-09-28-web-testing-tasks-m3.zh.md) | M3-T04、M3-T06 |

**跨阶段交接的必备资产**

以下是逻辑交付物名称，不要求另建通用项目管理框架。实际路径、格式、生成／维护方式在 M0-T01 按 DSH 规则确定；下游记录读取版本，避免消费“最新文件”而不知版本。

| 资产 | 首次主责 | 后续消费方与版本要求 |
|---|---|---|
| BaselineManifest／RulesMap／RepositoryMap／CheckPlan | M0-T01，M0-T08 收口 | 全部任务；基线或目录规则改变就重新核对适用检查。 |
| ProbeResult／GateDecision | M0-T03–T07、T09–T11 探查，T08 收口 | 八项分开结论，主路线成功不代替有效性、资产生命周期、恢复更新或其他必需能力。 |
| FixtureManifest／独立 Oracle | M0-T02，M2-T01 扩展，M4-T09 封版 | 全部验收；记录版本、种子、复位、正常／缺陷对照和隐藏答案边界。 |
| ContractRevision／生成 Remote | M1-T02 | Runtime、策略、Client、执行者；公共签名只维护一处。 |
| 领域创建、提交及恢复协议 | M1-T03，M2-T04，M3-T01 | 所有业务写入和通知；状态与事实由唯一 Runtime 提交。 |
| Policy／EnvironmentDeclaration／Authorization | M1-T05 | 全部实际入口；执行前验证修订、范围、目标与副作用。 |
| SourceSnapshot／Plan／Case／Instance | M2-T02／T03 | 执行、回归及报告；不可用当前文件替换历史引用。 |
| EvidenceRef／DataLedger／ReportRevision | M2-T05／T07／T08 | 报告、清理、历史及导出；发布引用前材料已保存，旧报告不可变。 |
| RecoveryMatrix／RetryState／ProgressPolicy | M3-T01／T02／T04 | M4 扩展和 M5；新执行者不能绕开恢复／控制门。 |
| ProductEffectivenessProtocol／Result | M0-T09，M2／M4 扩展保留材料 | M0-T08、M5-T03；预登记分母／独立答案／人工参照，材料泄漏或调优后须重新取得保留证据。 |
| BrowserCarrierDecision／StorageDesignDecision | M0-T03／T04 | M1-T07／T03 及后续；消费实测比较结果，不默认继承旧候选。 |
| AssetLifecycleDecision／引用保留约定 | M0-T10，M1-T03／M2-T05 基础，M3-T05 完成 | 普通 Session／fork、报告、快照及导出所有消费方；发布和删除遵守同一生命周期边界。 |
| RecoveryUpdateDecision／FrozenRunManifest／RecoveryLink | M0-T11，M3-T01／M5-T02 完成 | 控制、报告与安装；旧批次不可变，UNKNOWN 不因换批次清除。 |
| IntegrationSurfaceRegister | M0-T01 初建，全部探查更新，T08 决策 | 全部改动者与 M5-T05；公共扩展、内部补丁、替代方案及升级成本分别登记。 |
| ExecutionRecipeRevision／RouteBenefitDecision | M4-T05／T07 | 模型路由与实际执行；每轮新观察，接入能力和默认收益分开。 |
| ResourceBudgetRevision | M3-T07 冻结当前组合，M4-T10 冻结全组合 | M5-T04；运行前有数值、负载和参考机，禁止事后调阈值包装通过。 |
| 能力矩阵与 CalibrationRevision | M4-T10／M4-T07 | 调度、报告和发行；能力状态只在 DD02 维护，模型／路线变化须重验。 |
| ReleaseCandidateId／BOM／验收结果 | M5-T01–T05 | M5-T06；最终产物、配置和有效证据保持同一组合。 |

**任务推进和返工规则**

实际进度只在 M0-T01 选定的一处任务记录维护。当前这些文档保留计划状态，不在总控、卡片和表格反复手填三个进度版本。每次完成任务按总控格式交接，并按以下条件选择下一张卡：

1. 正式任务准入要求用户授权范围与已接收前置交付物。明确授权的受限原型工作可在准入前继续，须记录缺口与限制，不能满足缺失前置；授权范围内主 agent 可继续派发，不需逐卡请求许可。M0-T08 可汇总缺口，M0-T09 可消费 M0-T07 已接收主路线而轻量分项仍未完成；这些安排均不代表未验证能力已经通过。
2. 共享文件的当前修改者已交接，工作区无未解释冲突；只读代码与保护策略来自实际版本，不能只看旧摘要。
3. 缺设备／凭证／外部窗口时，保留待外部条件及恢复条件，继续不依赖它的已授权任务；不虚构通过也不删除交付项。
4. 发现缺陷回到所属任务修复，保留失败证据；公共约定变化通知其实际消费方并运行影响范围检查，不能靠改 Oracle 或降低验收修复失败。
5. 候选构建变化记录新身份，逐项标明哪些旧证据有效、哪些须重验；24 小时等有组合要求的证据不能跨候选随意相加。
6. 必需产品项失败／未执行，或适用工程检查缺证据，都不能宣布产品已完成。被测项目可在报告中有未验证项，与本工具自己的交付验收是两件事。

## 考虑过的替代方案

**已记录的取舍。** 分设进度台账，或只因某实现层完成就关闭验收项，会掩盖最终组合缺口。

## 验收标准

执行本提案中的正常和失败对照，并满足[统一验收标准](2026-09-28-web-testing-acceptance.zh.md)及相应任务的证据要求。文档迁移不代表这些条件已通过。

## 风险

映射完整不能证明通过；证据必须指向已接收的实现及适用的最终候选。
