---
description: "Windows 桌面实机验收：dsh-plugin-web-test 0.1.1 在原版 DeepSeek Harness 0.2.0-rc.2 桌面宿主上的逐项结果、阻塞缺陷与修复清单"
kind: note
status: active
date: 2026-10-04
---

# dsh-plugin-web-test — Windows 桌面实机验收

英文 | [中文](2026-10-04-web-test-windows-desktop-acceptance.zh.md)

## Summary

在用户已安装的原版 DeepSeek Harness 桌面宿主上，对 `dsh-plugin-web-test` 0.1.1 做了一次完整实机验收：经真实插件管理器安装、在 `web-test` 预设里用真实模型驱动真实 Chrome 完成三个用例、构造宿主崩溃做重启对账、再走完禁用/卸载/重装。**15 组清单中 10 组通过、4 组部分通过、1 组未验证。**

结论：**当前不适合装入日常使用环境**。插件的 Host 半边、S4 持久执行语义、SQLite 与报告链路在真实桌面上工作正常且证据充分，但有两个 P0 缺陷会让真实使用直接失败：插件发布的 bundle patch 把浏览器可执行文件写死为 Linux 路径，Windows 上浏览器无法启动；`web_test_status` 工具的 output schema 少声明两个字段，在真实宿主里 100% 失败，而 guard 的拒绝文案恰恰把这个坏掉的工具指给模型。

本记录只写实测结果。凡是没跑过的项都标为未验证，不按"应该能过"记。

## Table of Contents

- [固定验收版本](#fixed-acceptance-candidate)
- [环境](#environment)
- [隔离与日常环境保护](#isolation-and-daily-environment)
- [逐组结果](#per-group-results)
- [阻塞缺陷](#blocking-defects)
- [交回 Ubuntu 的修复清单](#fix-list-for-ubuntu)
- [结论](#conclusion)
- [复现步骤](#reproduction)
- [Dev Note](#dev-note)

-----

## Fixed acceptance candidate

| Item | Value |
| --- | --- |
| Repository | `https://github.com/shady2713/DSHTEST` |
| Source branch | `codex/web-test-plugin-s0` |
| Source commit | `37ef29819ee94c7b503f20ea337ca9d44563a9db` |
| Acceptance branch | `codex/web-test-windows-acceptance` |
| Acceptance worktree | `.worktrees/windows-acceptance` |
| Plugin version | `0.1.1` |
| Tarball | `dsh-plugin-web-test/dist/dsh-plugin-web-test-0.1.1.tgz` |
| Tarball size | 133471 bytes, 40 files |
| Tarball SHA-256 | `64c3757ebb4a957b8ea1da6167bd5a298b6286dc9e8546d551620acc6cf4f58a` |

The tarball was verified byte-for-byte before installation and was not rebuilt. `origin/codex/web-test-plugin-s0` pointed at the same commit, so the candidate is the handed-over build, not a local rebuild.

## Environment

| Item | Value |
| --- | --- |
| OS | Windows 11, 10.0.26200 x64 |
| Desktop app | `C:\Users\64576\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe`, FileVersion 0.2.0-rc.2 |
| Desktop runtime | 0.2.0-rc.2 (node 24.21.0, pnpm 11.7.0) |
| Bundled `@deepseek-ai/dsh` | 0.2.0-rc.2 |
| Desktop CLI | `…\resources\runtime\cli\bin\dsh.cmd` → `0.2.0-rc.2` |
| Global `dsh` on PATH | 0.1.5-rc.1 — **not used for any compatibility judgement** |
| Host listen address | `127.0.0.1:19387` |
| `DSH_HOME` | `C:\Users\64576\.dsh` |
| Desktop profile | `C:\Users\64576\.dsh\profiles\desktop` |
| Electron user data | `%APPDATA%\@deepseek-ai\dsh-desktop` |
| Chrome used by Playwright | `C:\Program Files\Google\Chrome\Application\chrome.exe`, 154.0.8037.95 |
| Model | `deepseek-account / deepseek-flash`, reasoning high |

This machine is one Windows version only. Nothing here is evidence about any other Windows release.

## Isolation and daily environment

The desktop CLI refuses the `desktop` profile by name (`apps/cli/src/args.ts:83-87` compares `profile.toLowerCase() === 'desktop'`), so that is a name guard, not a lock. The acceptance host was therefore started from the same executable, the same profile and the same runtime as the desktop application, without the Electron window:

```text
"…\DeepSeek Harness.exe" --expose-internals \
  "…\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js" \
  "…\resources\app.asar\dsh" "C:\Users\64576\.dsh\profiles\desktop" \
  "…\resources\runtime\primary-runtime" "…\resources\runtime\pnpm\bin\pnpm.mjs" \
  "…\resources\runtime\bin"
```

The single-instance check does not hand a second start to a running instance; a second process dies on `EADDRINUSE`
(`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-2026-10-01T13-26-38-340Z-host.log`). No ordinary DSH session was
open in this profile during the run, and no process the user had started was ended.

Guards actually used instead of faking isolation:

- Baseline hashes of `cordis.yml`, `cordis.patch.yml`, `package.json`, `pnpm-workspace.yaml` plus a per-file hash list of the
  profile's plugin directory, saved before installation.
- The launch token was read from the host's own stdout; **no credential value was read or exported**. `.credentials.yaml` was
  never opened — only its modification time was observed.
- No personal browser profile was copied. Playwright used its own throwaway `playwright_chromiumdev_profile-*` directory.
- Business-data changes happened only against a local throwaway HTTP site on `127.0.0.1:18999` whose state lives in one
  process's memory.
- The host was driven over the same authenticated loopback API the Client UI calls, using the host's own
  `GET /?token=…` → 303 → signed cookie exchange.

**Daily environment after the run:** the plugin is uninstalled, `package.json` again lists only `@deepseek-ai/dsh-base` and
`@deepseek-ai/dsh-web-app`, the user's hand-installed `dsh-opencode-session` plugin is untouched, `~/.dsh/storages` was
never written by the plugin, and the profile's `cordis.patch.yml` carries no acceptance edits. The plugin's own data root
`~/.dsh/plugins/dsh-plugin-web-test` is still on disk (7 files, 179517 bytes) because uninstall does not delete it.

## Per-group results

Legend: **pass** / **partial** / **fail** / **unverified**.

### 0. Prerequisites — pass

Host reports 0.2.0-rc.2 through its own CLI. The bundled node and pnpm satisfy the package's own ranges. Chrome is installed.
A reachable test target was built for the run (see [Reproduction](#reproduction)).

### 1. Install and enable — pass

- `pluginManager/inspect` → `status: accepted, kind: tarball`.
- `pluginManager/installBundle` → `stage: enable, target: dsh-plugin-web-test, enabled: true, changed: true, application: applied`,
  pnpm `exitCode 0`, `+ dsh-plugin-web-test file:…0.1.1.tgz`, `Packages: +12`.
- `pluginManager/listVersionExemptions` → `{"exemptions":{},"warnings":[]}` — **no `allow-version` exemption anywhere**.
- All five rows `fiberPhase: active`: `include:web-test-storage-sqlite`, `include:web-test-store`, `include:web-test`,
  `include:web-test-browser-use`, `include:web-test-preset`.
- Install warnings only concerned the profile's pre-existing `desktop-product-telemetry` (missing `serviceVersion`) and a
  pending `product-analytics`. Nothing from web-test.

The install was driven through the plugin manager, not by hand-editing the profile.

### 2. Settings entry — unverified (GUI gap) / partial

The plugin declares a `settings.section` contribution (`src/client/index.ts`, section id `web-test`, order 90) and ships
`locale/{en,zh}.json`. The **server-side** half is proven: `webTest/status`, `listProjects` and `listEnvironments` all answer
through the same gateway the section calls.

The **rendered** half is not verified. The Client's settings panel would not open in the available in-app Browser: two
clicks on the settings control and one `Ctrl+Alt+,` all left the page text unchanged, and the viewport this session gets is
917×1259. No `computer_*` tool is available, so the Electron window itself could not be driven. Treat "the localized
'Web 测试' entry appears and renders status / version / data version / host version / counts / data root" as **unverified**.

### 3. Typed Remote round trip — pass

- `webTest/status` → `ok`, `version 0.1.1`, `state active`, `schemaVersion 3`, `dshVersion 0.2.0-rc.2`.
- `webTest/putProject` then `webTest/listProjects` round-tripped project `win-accept`.
- Value-level rejection answers `gateway/input-invalid`
  (`webTest/putProject: wire field "project" failed boundary validation`) for an empty `key` and for missing fields.
- A **surplus** field is accepted (`surprise: true` → `ok: true`) because the generated schemas use `z.object()`, which strips
  unknown keys rather than rejecting them. Not a failure; noted so nobody reads `mode: 'strict'` as "unknown keys are refused".
- Writes land in the plugin's own `web-test.sqlite`. `~/.dsh/storages/workspace.json` still carries its pre-run timestamp.

**Drift found.** `src/client/remote.ts` is generated from the same schemas the wire uses, but it does not match the
implementation:

| Implementation (`@Remote`) | In generated descriptors |
| --- | --- |
| `status`, `putProject`, `putEnvironment`, `listEnvironments`, `putPolicy`, `controlRun`, `listRuns`, `getRun`, `buildReport`, `listCaseResults`, `listProjects` | present |
| `waitRun`, `resumeWait`, `assumeRole`, `resolveOperation`, `listOperations` | **absent** |
| `status` result `recordCounts.operation`, `reconciliation` | **absent from the schema** |
| `buildReport` result | declared as `z.object({ markdown: z.string() })`; the service returns `runKey`, `verdict`, `markdown`, `html`, `json` |

The five missing methods still answer on the wire — the host dispatches straight to the `@Remote` method — but a typed
client cannot call them and gets no schema validation. See [D2](#d2).

### 4. Test preset and execution-layer restriction — pass

- `agentPresets/list` gains `web-test` next to `standard`, `ptc`, `minimal`, `cordis`.
- `session/create` with `agentPreset: "web-test"` returns a session bound to that preset.
- In a real model turn, the refused tools are rejected **in the execution layer**, verbatim as the checklist expects:
  - `bash` → `web-test sessions may only call web_test_* and mcp__playwright-mcp__* tools; "bash" is outside the test execution policy`
  - `list_mcp_resources` and `read_mcp_resource` → same message with their own names.
- Allowed tools execute normally.

The preset deliberately ships `@deepseek-ai/dsh-tool-bash` as a probe so the refusal can be proven on the execution path
rather than by the tool's absence. That is intentional, but it does mean a test Agent can see `bash` in its tool list and
waste turns discovering it cannot call it.

### 5. Real browser completes a minimal test — partial

Works, after one environment adaptation (see [D1](#d1)):

- `web_test_start_run` created run `win-accept-run-1` and returned the evidence root
  `C:\Users\64576\.dsh\plugins\dsh-plugin-web-test\evidence\win-accept-run-1`.
- Playwright launched the machine's Chrome with a throwaway profile and read real page content
  (`单价 12.50 / 数量 3 / 小计 37.50 / 折扣 10% / 合计 33.75`).
- Screenshots were copied into the run's evidence directory, e.g.
  `…\evidence\win-accept-run-1\0-checkout-total-defect-checkout.png`.
- `webTest/buildReport` lists those evidence paths in all three formats.
- **Stale evidence is refused**, verbatim:
  `web-test: evidence path "…\site\server.mjs" was last written before this run started, so it cannot be evidence of this run. Take a new screenshot for this run.`

Two things do not hold on Windows:

- **Evidence directory mode 700 is not in effect.** The plugin's `mkdir(mode 0o700)` and `chmodSync(0o700)` are POSIX
  calls; on NTFS they do nothing. Every ACL entry under `~/.dsh/plugins/dsh-plugin-web-test` reports
  `IsInherited: True`, including `Everyone: DeleteSubdirectoriesAndFiles (Deny)`, `Modify` for three SIDs,
  `shady\CodexSandboxUsers: Modify`, and `shady\64576: FullControl`. Evidence and business records are writable by more
  principals than the plugin intends. Whether the plugin should converge ACLs on Windows, or document the platform limit,
  is a decision for Ubuntu — see the open question in the handoff.
- `web_test_report_case` first failed with
  `steps.0.evidencePath: Invalid input: expected string, received undefined`. See [D3](#d3).

### 6. Storage and restart — pass (except the version gate)

After a real host restart, `webTest/status` reports `project 1, environment-revision 1, run 3, policy 1, case-result 3,
operation 2` and every record reads back through the typed Remote; the evidence files are still on disk. The plugin's
SQLite is single-writer, so the file itself is locked while the host runs — the data is read through the Remote, not the
file.

The version-gate half (stamping the store version 99 and expecting a refusal) was **not executed**; it would have required
editing the plugin's own database while it is the user's data root.

### 7. Ordinary sessions unaffected — pass

- A `standard`-preset session created while web-test work was in flight carries **no** `web_test_*` and no `mcp__*` tool.
- Its `bash` tool runs. (It fails with the machine's known Git-bash `NtCreateDirectoryObject … 0xC0000022` defect, which is
  this host's environment, not the plugin.)
- The execution guard is scoped to the web-test preset: the same `bash` call refused inside a web-test session is allowed
  inside a standard session.

### 8. Run control — pass, with one item not met as written

- `webTest/controlRun` `pause` → `paused`; `browser_navigate`, `browser_take_screenshot` and `web_test_begin_operation` are
  then all refused in the execution layer with
  `web-test: run win-accept-run-2 is paused and refuses new test actions. Ask the operator to continue it; do not act for it in the meantime.`
- `web_test_status` stays callable while paused — it is in the hold allowlist.
- Pausing again is refused: `run "win-accept-run-2" is running and cannot resume` for the illegal transition; a cancelled run
  answers `run "win-accept-run-3" is cancelled and cannot cancel`.
- `resume` → `running`; the browser tools work again immediately, and the run closes as `completed`.
- `cancel` → `cancelled`, and a new run afterwards works end to end (run `win-accept-run-4`: browser, evidence, case result,
  `finish_run`).
- Business work on a cancelled run is refused at the state layer:
  `web-test: run "win-accept-run-3" is cancelled; only a running run may change business data`.

**Not met as written:** the checklist expects "after cancelling, the browser tools are refused too". They are not.
`runHoldStatusSchema` is `['paused', 'awaiting-business-time', 'awaiting-user', 'resuming']` — `cancelled` is not a held
status, so `guardReason` does not stop browser calls for a cancelled run. The browser can still be driven under a cancelled
run. Business tools are stopped by their own state checks, which is not the same guarantee. See [D4](#d4).

### 9. Disable while the host keeps running — pass

`pluginManager/setBundleEnabled {name: dsh-plugin-web-test, enabled: false}` → `stage: enable, enabled: false, changed: true,
application: applied`, with no host restart.

- `webTest/*` stops answering: `gateway/definition-unavailable — its strict definition was withdrawn and SRC fallback is forbidden`.
- `web-test` disappears from `agentPresets/list` (back to `standard`, `ptc`, `minimal`, `cordis`).
- A session that still holds the retired preset reports `unknown tool "mcp__playwright-mcp__browser_navigate"`,
  `unknown tool "web_test_status"`, `unknown tool "web_test_start_run"` — new dispatch stops.
- Playwright's Chrome process count for this run went to **0**. The bundle's own README says a live session's browser cannot be
  reaped by disabling; on 0.2.0-rc.2 it was reaped, because the preset row unload disposes the provider fiber.

**Residue found.** After disabling, the profile's `package.json` lost the `dsh-plugin-web-test` entry from
`dsh.profile.bundles` but **kept** it under `dependencies`. That half-disabled shape is exactly the "disabled configuration
left behind" case the distribution work called out. `removeBundle` afterwards cleaned both up. See [D5](#d5).

### 10. Uninstall and reinstall — pass

- `removeBundle` → `stage: remove, changed: true, application: applied`, pnpm `exitCode 0`.
- `package.json` clean, `node_modules/dsh-plugin-web-test` gone.
- **Plugin data retained**: `web-test.sqlite` (81920 bytes) and all 6 evidence PNGs still under
  `~/.dsh/plugins/dsh-plugin-web-test`.
- `inspect` after removal → `status: accepted, kind: tarball` (the tarball is still a valid install source).
- `installBundle` of the same tarball → `enabled: true, changed: true, application: applied`; `webTest/status` reports
  `version 0.1.1, state active, schemaVersion 3` with `run 4, case-result 4, operation 2` and the 6 evidence files intact.
- `listVersionExemptions` is still empty after reinstall. No stale disabled state blocked it.

### 11. Upgrade — unverified

`pluginManager/inspect` reports `registry: null` and `installBundle` answers `registries: [null]`: this profile has no
registry source configured, so there is no registry install or upgrade path to exercise. A tarball overwrite install was
exercised in group 10 and is recorded as such. **No claim is made about registry installation or version upgrade**, and the
post-upgrade migration/recovery checks are therefore also unverified.

### 12. Business operations and restart reconciliation — pass

A business operation was recorded as `dispatching` and the host process tree was then killed (`taskkill /T /F`) while it
was in flight. The desktop Electron user data produced
`crash-2026-10-04T12-47-16-581Z-renderer.log`.

After restarting the same executable and profile:

```json
"reconciliation": {
  "blockedRuns": ["win-accept-run-3"],
  "unknownOperations": [{
    "runKey": "win-accept-run-3", "operationKey": "op-inflight-1",
    "reason": "the DSH process restarted while this operation was in flight, so its outcome was never observed; it must be reconciled with the operator, not repeated"
  }]
}
```

- The in-flight operation is `unknown`, **not** reset to `not-dispatched`.
- The run is `resuming`, and the guard's message distinguishes a restart from an operator pause:
  `run win-accept-run-3 is resuming and refuses new test actions. The DSH host restarted during that run; report what you know through web_test_status and ask the operator to continue it.`
- After the operator resumes the run, a **second** attempt on the same `operationKey` is refused by the state layer:
  `operation "op-inflight-1" of run "win-accept-run-3" is unknown; its outcome is unresolved, so it must not be submitted again. Settle it or reconcile it with the operator, and use a new operation for genuinely new work.`
- `webTest/resolveOperation` then settles it to `settled`.

One real usability consequence: the guard tells the model to "report what you know through `web_test_status`", and that tool
fails 100% of the time on this host ([D2](#d2)). The instruction the guard gives cannot be followed.

### 13. Per-session hold isolation — pass

Run `win-accept-run-3` was held (`resuming`) in `session-ab946445-…`. A second `web-test` session
(`session-89c2a86c-…`) ran at the same time and its `browser_navigate` and `browser_take_screenshot` both succeeded. One
session's hold does not stop another session's work. The allowlist still applies in the second session
(`bash` refused).

### 14. Roles and business-time waiting — pass

- `webTest/assumeRole(run-3, "operator")` → accepted (the environment declared that role).
- `webTest/assumeRole(run-3, "admin")` → refused:
  `web-test: environment "win-accept-env-1" declares [operator]; role "admin" was not declared, so the run may not act as it`.
- `webTest/waitRun(run-3, <+30 min ISO>, reason)` → `awaiting-business-time`.
- `webTest/resumeWait(run-3)` before the deadline → refused with the remaining time and the instruction
  `Check the page instead of waiting; do not repeat a case that already ran.`

The success path of `resumeWait` after the deadline was not executed (the recorded deadline was 30 minutes out).

### 15. Report in three formats — pass

`webTest/buildReport('win-accept-run-1')` returns `runKey`, `verdict`, `markdown` (3326 chars), `html` (4905 chars) and a
`json` object. The Markdown is localized Chinese and carries, per case, the steps with their observed values, the assertions
with outcomes and reasons, the canonical evidence paths, and an "open questions" list. `verdict` was `undetermined` because
the run raised a question for the operator.

The run found the preset defect independently: the normal control page prints `合计 33.75` and the defect page prints
`合计 40.13` for the same unit price, quantity and discount, and the model recorded `checkout-total-defect` as `failed` on
its own reading rather than on the operator's word. The second defect (the cart still rendering old rows after "clear") was
observed, reported as a failed assertion with a reason, and raised as an open question rather than being silently passed.

Minor: the same copied evidence file appears under two different names in one case — `0-cart-clear-after-reload.png` inside
the step and `1-cart-clear-after-reload.png` in the evidence list — because `takeEvidence` numbers by per-list index while the
steps and `evidencePaths` are separate lists.

## Blocking defects

Ordered by how much they block real use on Windows.

### D1

**The published bundle patch hardcodes a Linux browser path, so the browser cannot start on Windows or macOS.**

`cordis.patch.yml`, preset row `web-test-browser`:

```yaml
executablePath: /usr/bin/google-chrome
```

Every browser tool call in a `web-test` session fails with
`Error: async createBrowserWithInfo: Failed to launch chromium because executable doesn't exist at /usr/bin/google-chrome`.
The row's own comment says "Drive the machine's own Chrome", and the provider README documents `executablePath` as
optional with upstream discovery as the default. The bundle overrides it with one machine's path.

Worse, the value is not overridable the obvious way. It lives **inside** `@deepseek-ai/dsh-agent-preset`'s
`config.plugins[]`, so the loader's id-targeted `config` override for `web-test-browser` does not reach it — verified: an
override on `- id: web-test-browser` had no effect and the failure was identical. Only overriding the whole
`web-test-preset` row works, and that means restating the entire preset in the profile's patch layer.

Everything in groups 5, 8 and 15 that needs a browser was verified **with that profile-level override in place**. On a stock
profile the plugin's browser capability is dead on arrival.

### D2

**`web_test_status` fails on every call in the real host: its declared output schema omits two fields it always returns.**

`src/agent.ts` registers the tool with

```json
"additionalProperties": false,
"required": ["state", "version", "projectCount", "runCount", "evidenceRoot"],
"properties": { state, evidenceRoot, version, projectCount, runCount }
```

while `execute` returns `statusResultSchema`, which also has `interruptedRuns: string[]` and `unknownOperations: string[]`
— and the tool's own `render` reads both. Every call answers:

```text
tool "web_test_status" returned invalid output: "value.interruptedRuns" is not a declared property
(additionalProperties: false); "value.unknownOperations" is not a declared property (additionalProperties: false)
```

Impact beyond the tool itself: the guard's hold message instructs the model to "report what you know through
`web_test_status`", and `report_case`'s description says "Call `web_test_status` first to learn the directory". Both point at
a tool that cannot succeed.

Why 68 unit tests missed it: no test registers the tools and asserts that the declared output schema accepts what
`execute` returns. The two schemas are maintained independently and nothing compares them.

### D3

**`web_test_report_case`'s parameter schema and its storage schema disagree, so omitting an optional field fails the tool.**

The tool declares `steps[].evidencePath`, `steps[].observed`, `assertions[].reason` and `assertions[].actual` as optional
and says "the stored record fills the empty values in", and `caseResultInputSchema` extends them with `.optional()`. The
storage schema declares the same four as plain `z.string()` with no default, so a model that honours the tool's own contract
gets:

```text
Error: [{"expected":"string","code":"invalid_type","path":["steps",0,"evidencePath"],
"message":"Invalid input: expected string, received undefined"}]
```

Observed in a real run, then worked around by passing `""` for every omitted field. The comment describes behaviour the code
does not implement.

### D4

**A cancelled run is not held, so the browser keeps being drivable after the operator cancels.**

`runHoldStatusSchema` is `['paused', 'awaiting-business-time', 'awaiting-user', 'resuming']`. `cancelled` is absent, so
`guardReason` finds no held run and lets `mcp__playwright-mcp__*` through. Business tools are stopped by their own
`only a running run may change business data` checks, but the browser itself is not. The checklist expects the browser tools
to be refused after a cancel; today they are not. Whether the right fix is adding `cancelled` to the hold statuses or
narrowing the guarantee, this is a product decision, not a mechanical edit.

### D5

**Disabling a bundle leaves a half-disabled profile.**

`setBundleEnabled(enabled: false)` removed `dsh-plugin-web-test` from `dsh.profile.bundles` but left it in `dependencies`.
The profile then has a dependency nothing activates. `removeBundle` cleans both, so this only bites the
enable → disable → enable path. This is the "disabled configuration left behind" case the distribution work asked to have a
verified recovery procedure for; the procedure that works today is disable → remove → install.

### D6

**Plugin data directories are not owner-only on Windows.**

`~/.dsh/plugins/dsh-plugin-web-test` inherits its ACL. `mkdir(0o700)` and `chmodSync(0o700)` are no-ops on NTFS, and
`shady\CodexSandboxUsers` plus other principals hold `Modify` over the SQLite database and the evidence PNGs. See the open
question below.

## Fix list for Ubuntu

Ordered as suggested sequence. Nothing here needs a Windows-only change; all of it is plugin-side.

1. **D1 — make the browser path platform-correct.** Drop `executablePath` from the preset row and let the provider's upstream
   discovery find the installed Chrome/Edge, or resolve it from a documented `dsh` home-path/config expression. If a concrete
   path must ship, it has to come from configuration the user can override, not a literal in the bundle. Re-run checklist
   group 5 on a stock profile afterwards — the current "pass" for group 5 depended on my override.
2. **D2 — reconcile the status tool's output schema with `statusResultSchema`.** Either add the two array properties to the
   declared `output.schema` (and to `required`), or drop them from what `execute` returns and from `render`'s text. Add a
   test that mounts the agent row and asserts the declared schema parses the value `execute` returns, for **every**
   registered `web_test_*` tool — that class of bug should not survive a second time.
3. **D3 — make the input schema and the storage schema agree.** Either make those four fields required in the tool's
   `parameters`, or give them `.default('')` in `caseResultRecordSchema` so an omitted value is stored as an empty string, which
   is what the comment already claims. Add a test that calls `web_test_report_case` with those fields omitted.
4. **D4 — decide the post-cancel guarantee.** If a cancelled run must stop browser dispatch, add `cancelled` to
   `runHoldStatusSchema` and make the hold message read sensibly for it. If not, change `WINDOWS-ACCEPTANCE.zh.md` group 8 to
   state the narrower guarantee the code actually provides. One of the two must change; today they disagree.
5. **D5 — make disable complete.** Either `setBundleEnabled(false)` also drops the dependency, or the documented recovery is
   disable → remove → install, and the checklist says so explicitly.
6. **Regenerate `src/client/remote.ts`.** It is behind the implementation: five `@Remote` methods have no descriptor, and
   `status` and `buildReport` results are declared narrower than the service returns. The generator should fail when the
   implementation declares a method the generated file omits, so this cannot drift silently again.
7. **Report evidence paths consistently.** Number copies once per case and use that name in both the step and the evidence
   list, instead of numbering per list.
8. **Decide and document the Windows ACL question** (D6): either implement NTFS ACL convergence for the plugin's data root,
   or state the platform limit in the README and drop the `0o700` claims where they cannot hold.

Also worth doing: the bundle's own comment claims disabling cannot reap a live session's browser. On 0.2.0-rc.2 it does
(Chrome process count went to 0). Update the comment so the next reader is not designing around a limit that is not there.

## Conclusion

**Not suitable for daily use as of this candidate.**

What is genuinely solid, on real evidence: installation through the plugin manager with zero version exemptions; the typed
Remote namespace; the execution-layer allowlist and its per-session hold; the S4 persistence semantics that matter most —
in-flight operations survive a host crash as `unknown`, the run is marked `resuming`, and a repeat submission of the same
`operationKey` is refused after the operator resumes; role and business-time enforcement; the plugin's own SQLite across
restarts; and uninstall/reinstall with data retained. The report chain produces all three formats with real evidence
attached, and the model found the planted defect on its own reading.

What blocks daily use: **D1** means a stock Windows profile cannot start a browser at all, so the plugin's entire reason to
exist does not function; and **D2** means the tool the guard itself points at fails on every call. Both are small, local
fixes, and both are in plugin code, not in the host.

The plugin is safe to leave uninstalled. It is also safe to reinstall — the reinstall path is clean and keeps data — but
until D1 and D2 are fixed, a test session will hit a dead browser and a dead status tool on the first turn.

## Reproduction

**Controlled test site** (throwaway, in-process state only, no persistence):

```text
.acceptance-local/site/server.mjs        # node:http, 127.0.0.1:18999
  /            normal control: site identity and navigation
  /pricing     normal control: 12.50 x 3 = 37.50, 10% off, total 33.75 (correct)
  /checkout    preset defect A: prints 合计 40.13 for the same inputs
  /cart        preset defect B: "clear cart" empties server state, page keeps old rows
```

**Acceptance scripts** (all under `.worktrees/windows-acceptance/.acceptance-local/`, git-excluded, never committed):

| Script | Purpose |
| --- | --- |
| `dsh-remote.mjs` | typed Remote over the loopback API, using the host's own launch token |
| `session-create / session-turn / session-read` | create a preset-bound session, send a prompt, read the durable log |
| `restart-host.ps1` | restart the acceptance host with the same executable, profile and runtime |
| `register-env.ps1` | declare the test site as an environment revision plus its execution policy |
| `site/server.mjs` | the controlled test site |

**Environment adaptation used for groups 5, 8, 12, 15** (removed again afterwards, see [D1](#d1)):

```yaml
# C:\Users\64576\.dsh\profiles\desktop\cordis.patch.yml
- id: web-test-preset          # overrides the whole preset row, not just the browser line
  config:
    id: web-test
    plugins:
      - id: web-test-browser
        name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'
        config:
          mode: launch
          headless: false
          executablePath: 'C:\Program Files\Google\Chrome\Application\chrome.exe'
      # ... persona, agent and probe rows restated unchanged
```

**Session ids used** (all created by this run, all in the acceptance profile):

| Session | Preset | Used for |
| --- | --- | --- |
| `session-5ecfec28-74c0-41be-886d-b4fa1552618e` | web-test | first turn, browser blocked by D1 |
| `session-cd33ed04-bd77-434e-8f02-1854066548e0` | web-test | second attempt, still blocked by D1 |
| `session-ab946445-8e77-4b22-abc4-172dd4143234` | web-test | the main run: cases, pause/resume/cancel, crash, roles, waits |
| `session-89c2a86c-d59d-4ae0-b81b-8b66dc41d75f` | web-test | hold-isolation control session |
| `session-fd667098-0a51-414f-b306-59f0db854d64` | standard | ordinary-session control |

Runs recorded: `win-accept-run-1` (three cases, completed), `win-accept-run-2` (paused → resumed → completed),
`win-accept-run-3` (crashed in flight → resuming → operation settled → cancelled), `win-accept-run-4` (post-cancel run,
completed), `win-accept-run-6` (stale-evidence probe).

Host boot logs, session logs and the report dump live in `.worktrees/windows-acceptance/.acceptance-local/evidence/`.
`evidence/host-boot.log` contains the launch token and **must not be committed or shared**; it is git-excluded for that
reason.

## Dev Note

Two things about the method, so the next acceptance run is cheaper.

The typed Remote over `POST /api/<endpoint>` is the right backbone for host-side acceptance: it is the same Typert gateway
the Client UI calls, it needs no Electron window, and it survives a host restart. The cost is that UI-specific claims
(settings section rendering, console cleanliness) have no backbone and stay unverified when no GUI driver is available.
Record them as unverified rather than substituting a server-side proxy for them.

Two of the three highest-value findings came from reading the generated artifact against the implementation before trusting
either: `client/remote.ts` had drifted from the `@Remote` methods, and the status tool's two schemas disagreed. Neither was
visible from a passing test run. A diff of "what the generator emitted" against "what the service declares" is cheap and found
both.
