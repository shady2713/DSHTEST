---
description: "Web 测试产品共享的类型边界：branded 身份、请求 schema、指名字段的 Remote 错误，以及 Runtime、策略、Client 和执行者共同消费的生成契约 Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test-contracts

[English](README.md) | 中文

## 概述

本包拥有 Web 测试产品共享的唯一类型边界：配置、项目元数据、存储和策略之间交换的 branded 身份；这些领域发送的请求与回执记录；指名调用方写错字段的 Remote 失败；以及由 Typert 生成器转换为 Client 类型的服务声明。本包只声明类型并做校验。它不持久化、不连接模型、不驱动浏览器，也不授予任何授权——Runtime、模型配置、策略服务和执行者消费它校验的结果。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待完成工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

消费方只需引入一次契约，并通过生成的 Remote 调用服务。每个方法逐字段校验请求并返回 branded 记录；被拒绝的请求抛出 `web-test/*` 失败，其 `details.field` 指名需要更正的内容。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { WebTestContracts } from '@deepseek-ai/dsh-web-test-contracts'
declare const ctx: Context
// The Host mounts the Service Definition; a Client reaches it as
// ctx.remote.webTestContracts.registerProject({ request }).
const contracts = new WebTestContracts(ctx)
const registration = contracts.registerProject({
  commandId: 'cmd-1',
  codeRoots: ['C:\\projects\\shop', 'C:\\projects\\shop-api'],
  entryUrls: ['http://localhost:3000/checkout', 'http://localhost:4000/cart'],
})
```

一个项目可以声明多个代码根和多个已启动的 URL。声明是针对整个已注册集合一次性做出的，而不是每根一份，因此登录、测试环境标志和用户补充的要求都是关于这同一个环境的事实。

### Remote 方法

| 方法 | 校验内容 | 返回 |
|---|---|---|
| `registerProject` | 命令令牌、代码根、已启动的入口 URL | `ValidatedProjectRegistration` |
| `submitRecord` | 命令令牌、记录身份、调用方最后读到的修订 | `ValidatedRecordSubmission` |
| `confirmEnvironmentDeclaration` | 项目注册的全部代码根、入口 URL、测试环境标志、登录以及补充要求 | `EnvironmentDeclaration` |
| `confirmEnvironment` | 项目身份、命令令牌及其嵌套声明 | `ValidatedEnvironmentConfirmation` |
| `evaluatePolicy` | 策略请求加上已确认的声明 | `PolicyDecision` |

`evaluatePolicy` 只报告用户已确认的声明是否覆盖该请求。它是策略服务的输入，绝不是它授予的授权：此处返回 `true` 并不允许写入源码、执行越界动作或使用已过期的授权。目标由**任一**已声明的根覆盖即算覆盖；而一个根覆盖它自身及其下的路径，不覆盖名称恰好以其字符开头的同级目录——因此 `C:\projects\shop` 不覆盖 `C:\projects\shop-evil`，声明第二个根也只把覆盖范围扩到那个根，不扩到别处。

### 一条声明承载什么

`EnvironmentDeclaration` 承载用户陈述、且普通推断无法替代的事实：

| 字段 | 记录什么 |
|---|---|
| `codeRoots` | 项目注册的全部绝对代码根，按声明顺序 |
| `entryUrl` | 用户已启动的绝对 URL，或 `null` |
| `isTestEnvironment` | 这是测试环境而非生产环境 |
| `login` | `not-required`，或 `required` 并由 `accountLabel` 指名持有登录的账号——是标签，绝非密码、令牌或密钥 |
| `supplementaryRequirements` | 用户在代码根与 URL 之外补充的要求 |

这些根是用户一并声明的一个集合，因此一并确认，针对这条声明授予的授权适用于全部根。需要为不同代码根建立不同环境的调用方，把它们确认为各自独立的声明，这样每条声明都有自己的身份。改动根、登录或要求会产生新的声明身份，这正是使针对旧身份授予的授权一律失效的机制。

### 身份与修订

每个跨越进程、存储或线上边界的身份都是 branded，因此项目身份不会被误当作运行身份传入，持久化的修订也不会与资源自身的计数混淆。这些 brand 仅存在于编译期——`brandString` 与 `brandNumber` 原样返回值，因此相等比较、日志和 JSON 序列化保持原始类型行为。

| 身份 | 格式 | 由谁产生 |
|---|---|---|
| `ProjectId` | `project-` 加 32 位十六进制 | `evaluatePolicy`、`confirmEnvironment` |
| `ProjectRevisionId` | `project-rev-` 加 32 位十六进制 | 存储，在提交项目修订时 |
| `RunId` | `run-` 加 32 位十六进制 | 存储，在创建运行时 |
| `RunPlanRevisionId` | `plan-rev-` 加 32 位十六进制 | 存储，在提交计划时 |
| `CommandId` | `cmd-` 加 1–64 个单词字符 | 每个写命令 |
| `RecordId` | `record-` 加 32 位十六进制 | `submitRecord` |
| `Revision` | 正安全整数 | 在后续写入前比较 |

### 失败

| 代码 | 何时抛出 | `details` |
|---|---|---|
| `web-test/invalid-field` | 某字段的值违反规则 | `field`、`reason` |
| `web-test/missing-field` | 缺少必需字段 | `field` |
| `web-test/unknown-field` | 发送了 schema 未定义的字段 | `field` |

`field` 是一条点分路径，出错元素也会被指名，例如 `entryUrls[1]`、`codeRoots[0]` 或 `declaration.isTestEnvironment`，使调用方只需更正一个字段，而不必猜测。根的数量超过 `MAX_CODE_ROOTS` 时，拒绝会指名 `codeRoots[16]`——第一个没有位置的根——而不是静默截断，使逐个添加根的调用方知道该去掉哪一个。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

`src/index.ts` 是服务声明，也是 Remote 接口唯一的声明处；生成器从这些 `@Remote` 方法推导出 Client 类型和运行期调用描述符，因此手写的镜像 DTO 会成为第二个家。`src/records.ts` 声明线上记录与身份格式。`src/ids.ts` 声明 branded 身份和修订号。`src/fields.ts` 保存字段级读取器，它们为身份加 brand 或抛出指名字段的失败。`src/parse.ts` 把这些读取器组合成每个 schema 一个解析器。`src/errors.ts` 扩展协议可合并的 `RemoteErrorDetailsMap`，因此消费方按 `code` 判别并读取 `details.field` 无需任何断言。

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 服务声明、`@Remote` 接口，以及声明范围的判定。 |
| [src/records.ts](src/records.ts) | 请求、校验后、回执和策略判定记录；身份格式与上限。 |
| [src/ids.ts](src/ids.ts) | Branded 身份与修订号。 |
| [src/fields.ts](src/fields.ts) | 为值加 brand 或指名被拒字段的字段级读取器。 |
| [src/parse.ts](src/parse.ts) | 由这些读取器组合出的每个请求 schema 各一个解析器。 |
| [src/errors.ts](src/errors.ts) | `web-test/*` 失败代码与指名字段的拒绝。 |
| — | 不发布运行时不变量伴随包；本包不持有可变状态，也没有可能相互偏离的事件流，其 Remote 回归验证了与解析器相同的校验。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下所有者定义本包所校验的契约，以及消费它们的服务。

- [Typert 协议](../../typert/protocol/README.zh.md)——Remote 装饰器、协议映射，以及各所有者共同抛出的唯一失败类。
- [Typert 生成器](../../typert/generator/README.zh.md)——Client 声明与调用描述符如何生成。
- [API 网关参考](../../../docs/api-gateway.zh.md)——生成的 Remote 调用如何到达 Host 方法。
- [应用身份](../web-test/README.zh.md)——本应用拥有的数据根、profile 与 Loader 入口。
- [Remote 回归](tests/remote.spec.ts)——经真实 Registry、Gateway 与 Connection 承载层访问契约。
- [拒绝回归](tests/rejection.spec.ts)——每个 schema 一个非法输入用例，各自指名其字段。
- [多根回归](tests/multi-root.spec.ts)——接受多个根、各上限指名其元素，以及跨全部根的覆盖判定。

-----

<a id="model-experience"></a>
## 模型体验

无。本包只声明类型并校验线上请求；它定义的内容都不构造模型上下文，也不触及模型请求。

#### KV 缓存效果

无直接影响；只有消费方自身的契约把这些记录放入请求时才会产生作用。

## 已知限制与待完成工作

<a id="known-limitations-and-deferred-work"></a>

本包实现的子项尚未验收，以下工作归对应卡片所有。阅读本节是为了避免把通过的测试误读为已交付的产品。

- 未声明任何 Target 或 Broker API，也未预造用例、断言、报告或浏览器目标的终态 schema。各自的第一个消费方决定其形态；今天没有消费方的 schema 不是契约。
- 未实现持久化：`submitRecord` 校验一次提交并返回解析后的请求，权威提交、outbox 与重开路径归 Runtime 卡。
- `evaluatePolicy` 只把请求与调用方传入的声明做比较。它不读取任何已存项目，不强制受保护路径，也不签发授权；这些归策略服务所有，并消费本结果。
- 尚未声明取消、事件订阅或释放契约，因为当前没有消费方需要。出现需要时必须经由本包的所有者，而不是新增一份平行签名。
- 可达性是被记录的事实，不是探测。本包只校验用户确认的声明——包括该环境是否需要登录——此处不访问任何已声明的 URL。判定已声明目标是否可用的宿主侧读取归 Runtime，且它只判定地址与路径，不触网。因此不可达的目标保留其记录，且永不被判为就绪；URL 是否会响应是用户陈述的事实，不是产品自行发现的结果。
- 生成的 Client 声明由仓库构建从服务声明产出。生成物属构建输出，不入库；[Remote 回归](tests/remote.spec.ts) 走的是 Gateway 从同一批 `@Remote` 标记推导出的源码模式描述符。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

线上请求是普通记录，服务方法的参数为 `Record<string, unknown>`，因为 Remote 请求以不可信 JSON 到达，而静态参数类型会承诺线上并未执行的校验。每个解析器就是把那些值转为 branded 记录的边界，因此新增字段必须同时补到记录、读取器和解析器中——当某个 `@Remote` 方法在没有对应记录时新增，唯一家回归会失败。

</details>
