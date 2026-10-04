# dsh-plugin-web-test

[English](README.md) | [中文](README.zh.md)

Web testing for DSH: drive confirmed test cases in a real Chrome or Edge, keep
evidence and run records in the plugin's own storage, and report back to the
session that started them.

This plugin is installable through DSH's plugin manager and runs on an unmodified
DSH `0.2.0-rc.2`. It adds no second credential system, no second browser stack,
and no source checkout dependency.

## What it does today

The first release delivers the verified skeleton plus the storage and execution
guarantees around it:

- a localized **Web 测试** section in Settings, backed by typed Remote calls;
- a `web-test` Agent preset that is opt-in per session, leaving normal sessions
  untouched;
- an execution-path allowlist that admits `web_test_*` and
  `mcp__playwright-mcp__*` tools and refuses everything else, even when the
  composition provides the tool;
- a real browser through DSH's official Playwright MCP provider;
- plugin-owned storage in a SQLite database under the plugin's own data root,
  with single-writer ordering and an exact version stamp that refuses to open on
  an unknown schema.

Case generation, confirmation, assertion, and report generation are the subject
of the following stages; see the [requirement mapping][mapping] for the
per-requirement status.

## Install

```sh
dsh plugin --profile <profile> add dsh-plugin-web-test
```

Installing registers the bundle, which adds the plugin's loader rows: a SQLite
backend pointed at the plugin's own data root, the storage service, the bundle
root, and the opt-in `web-test` preset. Disable or re-enable the plugin from
Settings, or through the plugin manager.

## Requirements

- DSH `0.2.0-rc.2` (the peer range is checked at install).
- Node `^22.19.0 || >=24.0.0`.
- A Chrome or Edge executable for the browser provider; the first release drives
  the machine's own browser rather than a bundled one.

## Windows acceptance status

**Every Windows acceptance item is unverified.** The evidence gathered so far covers Ubuntu 24.04 /
Node 24.15.0 / pnpm 11.7.0 with an unmodified DSH 0.2.0-rc.2 host only. The step-by-step checklist is
[WINDOWS-ACCEPTANCE.zh.md](WINDOWS-ACCEPTANCE.zh.md); no item in it counts as passed until a Windows
executor has actually run it.

## Known behaviour: re-enabling every row after a reinstall

The plugin's row toggles persist in the profile's `cordis.patch.yml`, and **uninstalling does not clear those entries**. After disable → uninstall → reinstall, the plugin therefore comes back installed with every row disabled: the manager shows it enabled, no fiber starts, and every `webTest/*` call answers not found.

This is host uninstall-path behaviour; the plugin package itself carries no `disabled`. The recovery is to re-enable each of these five rows in the plugin manager, in any order:

- `web-test-storage-sqlite`
- `web-test-store`
- `web-test`
- `web-test-browser-use`
- `web-test-preset`

The plugin resumes as soon as the rows are enabled again, and user data is untouched because uninstalling does not delete the data directory.

## Data

All business records and evidence live under the plugin's own data root,
`$DSH_HOME/plugins/dsh-plugin-web-test`, created owner-only. The host's own
storage backends are not used for plugin data, so disabling or removing the
plugin cannot disturb host or session state.

[mapping]: ../../.agents/notes/proposed/testing/2026-10-04-web-test-plugin-requirement-mapping.md
