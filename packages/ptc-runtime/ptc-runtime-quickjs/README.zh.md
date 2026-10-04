---
description: "在独立 Worker 持有的全新 QuickJS WebAssembly 上下文中执行可擦除 TypeScript，提供声明的异步绑定与可配置资源限制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ptc-runtime-quickjs

[English](README.md) | 中文

## 概述

该提供者（provider）在独立 Worker 线程上的全新 QuickJS WebAssembly 运行时与上下文中执行异步 TypeScript 函数体。客体仅获得 ECMAScript 内置对象、`console` 和已声明的异步绑定命名空间。Node、文件系统、网络、进程、模块加载器和定时器均不可达。宿主绑定继续执行自身的授权与文件策略。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将该提供者挂载为组合中的 `ptcRuntime`，无需文件系统或子进程服务（Service）。受支持的应用通过 `dsh` profile 启动；内部 Worker 入口不作为应用入口。

```yaml
- name: '@deepseek-ai/dsh-ptc-runtime-quickjs'
  config:
    timeoutMs: 120000
    maxTimeoutMs: 600000
    memoryLimitBytes: 67108864
    maxStackBytes: 1048576
    maxOutputBytes: 16777216
    maxLogMessages: 512
    maxMessageBytes: 16777216
    maxPendingCalls: 128
    maxSourceBytes: 1048576
    maxJobsPerTick: 128
    workerHeapMb: 128
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `120000` | 默认经过时间，毫秒 |
| `maxTimeoutMs` | `600000` | 最长经过时间，毫秒 |
| `memoryLimitBytes` | `67108864` | QuickJS 分配上限 |
| `maxStackBytes` | `1048576` | 客体栈上限 |
| `maxOutputBytes` | `16777216` | 序列化结果字节上限 |
| `maxLogMessages` | `512` | console 消息数量上限 |
| `maxMessageBytes` | `16777216` | 每个绑定参数或响应的字节上限 |
| `maxPendingCalls` | `128` | 同时进行的绑定调用 |
| `maxSourceBytes` | `1048576` | 源码字节上限 |
| `maxJobsPerTick` | `128` | Worker 让出执行之间的 Promise 任务数 |
| `workerHeapMb` | `128` | Worker V8 老生代 MiB |

以上字段均可配置，所有限制均为正安全整数。默认经过时间预算不能超过上限，上限必须处于 Node 定时器范围内。序列化输出预算至少为 256 字节，以容纳失败信封。QuickJS 内存与栈限制覆盖客体分配；`workerHeapMb` 限制 Worker V8 老生代内存，不包含 WASM 与原生分配。`maxMessageBytes` 限制每个绑定参数与响应，`maxPendingCalls` 限制同时进行的请求数。

`resolve(request)` 补全绝对路径 `cwd` 元数据，并限制正有限数值期限。`cwd` 不授予文件访问权，也不改变 Worker 的目录。显式 `sandboxPolicy` 与 `timeoutMs: null` 均被拒绝，因为该提供者没有直接文件执行能力，且要求经过时间有界。`run(spec)` 仅接受已解析输入，不补默认值。TypeScript 语法必须可擦除，支持顶层 `await` 与 `return`。

绑定接收一个无损 JSON 参数，异步返回无损 JSON。成功执行返回 `logs` 与可选 JSON `value`；自然结束或显式返回 `undefined` 时省略 `value`。嵌套 undefined、稀疏数组、非有限数值、负零、BigInt、函数、循环引用、访问器和非普通对象均被拒绝。宿主调用失败时，已声明的命名空间错误类提供配置的成员名属性。

期限包含启动与等待宿主绑定的时间。同步客体循环仅占用所属 Worker，宿主仍能响应取消。完成、取消、超时与提供者释放都会终止并等待所属 Worker，之后才返回。宿主绑定操作由消费者持有；执行结束后忽略迟到结果，消费者仍负责取消自身工作。

执行失败以 `exception`、`timeout`、`abort`、`worker-exit`、`invalid-output`、`output-limit` 或 `protocol` 返回。输出超限时返回有界失败信封，日志为空。非法配置、不支持的选项、未解析输入与释放后的调用属于调用方误用，抛出异常。该提供者不执行操作系统文件策略，因此不报告 `sandbox` 结果。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节</summary>

宿主对声明的绑定取快照，持有 Worker 生命周期、经过时间期限、绑定查找与输出计量。Worker 消息仅携带源码、数值限制、命名空间元数据与 JSON 文本，不传递 Cordis Context 或宿主函数。启动数据与双向消息均在派发前验证，畸形字段返回 protocol 失败。Worker 持有 WASM 运行时、上下文、句柄与客体 deferred Promise，不安装模块加载器，也不向客体暴露 Node API。

已捕获的客体内置操作验证并序列化数据，不依赖用户替换的 JSON、Object 或集合方法。宿主绑定输出通过共享无损 JSON 验证器生成独立快照。QuickJS 待处理任务按有界批次运行，中断处理器在同步求值时检查经过时间期限；宿主定时器独立终止 Worker。已释放的上下文不会接收迟到绑定响应。

`isQuickJsPtcRuntime(value)` 穿过 Cordis trace 层，识别模块登记的精确提供者实例，拒绝子类与仅描述符相同的对象。可信策略消费者可使用该身份检查；仅供说明的 `isolation` 字符串不授予执行权。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务配置、解析、提供者身份与 Worker 所有权 |
| [`src/worker.ts`](src/worker.ts) | WASM 上下文、绑定 Promise、日志与句柄清理 |
| [`src/protocol.ts`](src/protocol.ts) | JSON 通道类型、配置单位与客体编解码器 |

不发布运行时不变量伴随模块：生命周期与 JSON 接受规则由 Worker 消息和 WASM 执行边界实施，没有独立的同进程观察值。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [PTC 运行时服务定义](../ptc-runtime/README.zh.md) — 请求、解析规格、绑定与结果的持有方。
- [Tools PTC 消费者](../../core/tools/README.zh.md#ptc-mode) — 模型可见呈现与嵌套工具派发。
- [QuickJS 上游](https://github.com/justjake/quickjs-emscripten) — 维护中的 WebAssembly 运行时与句柄 API。

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tools` 的 PTC 模式间接呈现，消费者提供声明的绑定 schema、提供者执行指导与外层程序结果，中间 JSON 绑定消息不进入模型历史。

#### KV Cache 影响

请求前缀变更由该消费者持有，包括提供者指导；该提供者不直接触发缓存失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制限定执行保证与资源计量。

- Worker 线程共享宿主进程。隔离依赖 QuickJS WebAssembly 客体 API，不声称能够约束原生代码或引擎漏洞。
- WASM 启动与原生内存不包含在 QuickJS 分配上限内；宿主绑定可在客体与 Worker 限制之外分配内存。
- 不支持导入、不可擦除 TypeScript 转换、客体定时器、远程执行环境或直接文件沙箱。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

聚焦测试通过仓库的 Vitest 启动器运行，执行真实 Worker/WASM。源码 Worker 显式注册 `tsx` ESM hook 并禁用其磁盘缓存；已安装的 Worker 在普通 Node 下以空环境加载打包的 `lib/worker.js`。两者均不继承外部环境值或加载器参数，也不依赖跨 Node 支持范围的原生 TypeScript 启动假设。

</details>
