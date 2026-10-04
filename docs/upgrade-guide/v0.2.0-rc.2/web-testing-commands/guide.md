---
kind: upgrade-guide
description: "Update Web testing command clients, model policy readers and Desktop browser carriers for the revised application profile."
---

# Web testing application interfaces

English | [中文](guide.zh.md)

## Change

Web testing command clients use discriminated `StatusQueryRequest` and `ActionRequest` inputs instead of arbitrary records. The conversation package publishes `./commands`, `./types`, `./typert` and `./remote`; its six conversation tools share the same command service. Environment declarations retain their stored project revision, and a changed project requires fresh confirmation. Registered URL reachability requires an explicit `probeEntryUrls` call; status queries only read saved observations.

`POLICY_KINDS` now contains policy-kind strings. Provider failures use closed diagnostics; applications must not depend on raw provider error text. A persisted model selection requires a successful connection probe on first use after application restart.

Model state reads and `selectRoute` with `reverify: false` issue no probes or writes. Readiness requires a reusable persisted selection.

`ProfileContext` requires `applicationPatches`. `runProfile`, Web testing and Desktop Host requests require `applicationPatchFiles`, applied before user patches; `patchFiles` retains higher command-line precedence.

The model configuration directory adds a required `catalogState` field to each provider. `unavailable` preserves its configuration address with an empty advisory model list; other providers remain available. Clients must distinguish an unreadable directory from a successfully read empty directory.

The Desktop browser command protocol moves from version 1 to version 2. Carriers must support session-bound targets, press-key, double-click, navigation and reload, and handle `navigation-denied`. Mixed protocol versions are refused. The browser provider replaces its `automation` callback with `controlled: true` and the formal `desktopBrowserControl` service; it stays disabled by default.

## Migration

1. Rebuild the Web testing packages and apply the shipped `web-test.cordis.patch.yml`. Its Runtime uses `storageMode: generation-json`; custom compositions may explicitly retain `configured` when they already route the domain to the selected generation. Supply the new application fields; ordinary CLI calls use empty arrays. Confirm saved selections survive restart.
2. Import the command request types from `@deepseek-ai/dsh-web-test-conversation/commands` and update query/action calls to the corresponding union member. Register the generated `./remote` contribution for Client callers. Display the saved declaration revision separately from current environment confirmation.
3. Treat `POLICY_KINDS` entries as strings and handle connection-probe refusal before starting work. Keep credentials in the official credential service; persisted selections hold references only. Rebuild the presentation Remote and render each provider's `catalogState`; retain explicit exact-model verification when its advisory directory is unavailable. State reads no longer initialize routes; explicitly call `configureRoute` or `selectRoute` with `reverify: true`, then confirm subsequent state reads issue no model requests.
4. Update Desktop Main, Host and browser provider together to protocol version 2. Replace `automation` configuration with `controlled: true` and mount `desktopBrowserControl`. Bind an existing session to its owned target through the trusted carrier before issuing commands; remove any caller-supplied epoch or target shortcut.
5. Confirm the full profile mounts project commands and model configuration, reopening preserves project facts without restoring permission, and a fresh observation is required after navigation or reload. Existing version-2 project records remain readable; do not delete their data to migrate.
