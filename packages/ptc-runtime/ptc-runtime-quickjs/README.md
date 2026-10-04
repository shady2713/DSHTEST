---
description: "Execute erasable TypeScript in fresh Worker-owned QuickJS WebAssembly contexts with declared async bindings and bounded resource use."
kind: "package-reference"
---

# @deepseek-ai/dsh-ptc-runtime-quickjs

English | [中文](README.zh.md)

## Summary

This provider executes an async TypeScript function body in a fresh QuickJS WebAssembly runtime and context on a dedicated Worker thread. The guest receives ECMAScript built-ins, `console`, and the declared async binding namespaces. Node, filesystem, network, process, module loaders and timers are unavailable. Host bindings retain their own authorization and file policies.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this provider as the composition's `ptcRuntime`. It requires no filesystem or subprocess Service. Launch supported applications through `dsh` profiles; the internal Worker entry is not an application entry point.

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

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `120000` | Default elapsed milliseconds |
| `maxTimeoutMs` | `600000` | Maximum elapsed milliseconds |
| `memoryLimitBytes` | `67108864` | QuickJS allocation ceiling |
| `maxStackBytes` | `1048576` | Guest stack ceiling |
| `maxOutputBytes` | `16777216` | Serialized result byte ceiling |
| `maxLogMessages` | `512` | Console message count ceiling |
| `maxMessageBytes` | `16777216` | Each binding argument or response byte ceiling |
| `maxPendingCalls` | `128` | Simultaneous binding calls |
| `maxSourceBytes` | `1048576` | Source byte ceiling |
| `maxJobsPerTick` | `128` | Promise jobs between Worker yields |
| `workerHeapMb` | `128` | Worker V8 old-generation MiB |

Every field above is configurable. All limits are positive safe integers. The default elapsed budget cannot exceed its cap; that cap fits the Node timer range. The serialized output allowance is at least 256 bytes so a failure envelope fits. QuickJS memory and stack limits cover guest allocations; `workerHeapMb` covers Worker V8 old-generation memory and excludes WASM and native allocations. `maxMessageBytes` limits each binding argument and response, while `maxPendingCalls` limits simultaneous requests.

`resolve(request)` supplies an absolute `cwd` metadata value and caps a positive finite numeric deadline. `cwd` does not grant filesystem access or change the Worker's directory. Explicit `sandboxPolicy` and `timeoutMs: null` requests fail because this provider has no direct file execution and requires a bounded elapsed deadline. `run(spec)` requires resolved inputs and introduces no defaults. TypeScript syntax must be erasable; top-level `await` and `return` are supported.

Bindings take one lossless JSON argument and asynchronously return lossless JSON. Successful execution returns `logs` and an optional JSON `value`; falling through or explicitly returning `undefined` omits `value`. Nested undefined values, sparse arrays, non-finite numbers, negative zero, BigInt, functions, cycles, accessors and non-plain objects are rejected. Declared namespace error classes expose their configured member-name property when Host calls fail.

Deadlines include startup and Host binding waits. A synchronous guest loop occupies only its Worker, so Host cancellation remains responsive. Completion, cancellation, timeout and provider disposal terminate and await the owning Worker before returning. Host binding operations belong to the consumer; late completions are ignored after the run settles, and consumers remain responsible for cancellation of their own work.

Execution failures resolve as `exception`, `timeout`, `abort`, `worker-exit`, `invalid-output`, `output-limit` or `protocol`. An oversized output returns a bounded failure envelope with empty logs. Invalid configuration, unsupported options, unresolved inputs and calls after disposal reject as caller misuse. No `sandbox` result is reported because there is no OS file-policy execution in this provider.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The Host snapshots declared bindings and owns worker lifetime, elapsed deadlines, binding lookup and output accounting. Worker messages contain source, numeric limits, namespace metadata and JSON text; they never transfer a Cordis Context or Host functions. Startup data and both message directions are validated before dispatch; malformed fields produce a protocol failure. The Worker owns its WASM runtime, context, handles and deferred guest Promises. It installs no module loader and exposes no Node API in the guest.

Captured guest intrinsics validate and serialize data without consulting user replacements of JSON, Object or collection methods. Host binding outputs are detached through the shared lossless JSON validator. QuickJS pending jobs run in bounded batches; its interrupt handler checks the elapsed deadline during synchronous evaluation. The Host timer independently terminates the Worker. Disposed contexts receive no late binding replies.

`isQuickJsPtcRuntime(value)` recognizes module-registered exact provider instances through Cordis trace layers. Subclasses and objects with matching descriptors are refused. Trusted policy consumers can use this identity check; the informational `isolation` string does not authorize execution.

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Service configuration, resolution, provider identity and Worker ownership |
| [`src/worker.ts`](src/worker.ts) | WASM context, binding Promises, log capture and handle cleanup |
| [`src/protocol.ts`](src/protocol.ts) | JSON channel types, configuration units and guest codec |

No runtime invariant companion is published: lifecycle and JSON acceptance are enforced at the Worker message and WASM execution boundaries rather than by independent same-process observations.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [PTC runtime Service Definition](../ptc-runtime/README.md) — request, spec, binding and result ownership.
- [Tools PTC consumer](../../core/tools/README.md#ptc-mode) — model-visible presentation and nested tool dispatch.
- [QuickJS upstream](https://github.com/justjake/quickjs-emscripten) — maintained WebAssembly runtime and handle API.

<a id="model-experience"></a>
## Model Experience

Indirectly, through PTC mode in `dsh-tools`, which presents declared binding schemas, provider execution instructions and the outer program result while intermediate JSON binding messages stay outside model history.

#### KV Cache effect

The named consumer owns request-prefix changes, including provider instructions; this provider adds no direct cache invalidation.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits qualify execution and resource accounting.

- Worker threads share the Host process. Isolation relies on the QuickJS WebAssembly guest API; it does not claim confinement against native or engine vulnerabilities.
- WASM startup and native memory are outside the QuickJS allocation ceiling; Host bindings can allocate memory outside both guest and Worker caps.
- Imports, non-erasable TypeScript transformations, guest timers, remote execution worlds and direct file sandboxes are unsupported.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

Focused tests run through the repository's Vitest launcher and exercise real Worker/WASM execution. Source Workers explicitly register the `tsx` ESM hook with its disk cache disabled; installed Workers load the packaged `lib/worker.js` entry under plain Node with an empty environment. Neither inherits ambient environment values or loader flags. Both modes avoid native TypeScript launch assumptions across the supported Node engine range.

</details>
