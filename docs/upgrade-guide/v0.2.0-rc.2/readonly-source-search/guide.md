---
kind: upgrade-guide
description: "Update direct search-tool consumers and Web testing confirmations for structured read-only search."
---

# Read-only source search

English | [中文](guide.zh.md)

## Change

`applyGlobTool` and `applyGrepTool` now consume `ctx.fsSearch` rather than launching arbitrary process requests. Mounting `@deepseek-ai/dsh-tool-fs-search` installs the packaged provider automatically; direct tool installers must provide `ReadonlySearch`. The provider clears inherited environment entries except Windows `SystemRoot`, sets `LC_ALL=C`, and disables ripgrep configuration and link traversal.

Web testing policy classifies grep as `read-source`, checks the calling Session and canonical target, and spends one authorization action at execution. Search confirmations name the entry `fsSearch.search`. General subprocess, shell and terminal execution remains refused. Cancellation reports `SEARCH_ABORTED` even when the subprocess provider rejects its outcome.

## Migration

1. Keep the shipped search plugin mounted after its subprocess backend. Inside each Agent preset's `config.plugins`, add `isolate: { fsSearch: true }` to the search row, including saved profile overrides. The shipped `standard`, `ptc`, and `cordis` declarations already include it. Confirm `session.create` succeeds under the selected preset; a missing realm rejects creation with `agent-preset/invalid`. For direct installers, mount `PackagedReadonlySearch` before installing the tools and inject `fsSearch` into their context.
2. Apply `read-source` confirmation rules to grep and use `entry: 'fsSearch.search'` for search confirmation requests. Confirm the environment against every registered code root before granting a flow.
3. Handle `SEARCH_ABORTED` for caller cancellation and provider disposal. Confirm real glob and grep return source results, while private paths, escaping links and arbitrary process calls remain refused.
