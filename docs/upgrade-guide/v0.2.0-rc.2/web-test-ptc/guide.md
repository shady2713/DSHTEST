---
kind: upgrade-guide
description: "Update Web testing PTC programs to use declared tool bindings instead of direct Node APIs."
---

# Web testing PTC provider

English | [中文](guide.zh.md)

## Change

The Web testing application selects the [QuickJS PTC provider](../../../../packages/ptc-runtime/ptc-runtime-quickjs/README.md). Its programs have ECMAScript built-ins, console and declared asynchronous tool bindings. Direct Node imports, filesystem, network, process and timer APIs are unavailable. Other Harness profiles retain their existing provider.

Web testing policy admits the reserved `run_code` transport only for an actual QuickJS provider instance. Nested tools keep their existing scope, confirmation and file protections. Selecting the Node provider in a Web testing overlay leaves `run_code` refused; changing an isolation label grants no permission.

## Migration

1. Replace direct Node file and network operations with the tools declared in the PTC SDK. Await required calls and return lossless JSON.
2. Remove Node-specific imports and timer calls. Use the configured PTC deadline and tool-specific timeout controls.
3. Keep the application's PTC provider selection. Test supported source reads and permitted browser actions, and confirm that protected material reads and writes are refused.
