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

### Business-changing operations

A step that changes business data is never just a browser click. The test Agent
records the intent durably **before** acting, observes the result independently
afterwards, and settles the operation:

| Tool | When the model calls it | What the plugin enforces |
|---|---|---|
| `web_test_begin_operation` | immediately before the change | The record is written in `dispatching` first. A same-key repeat whose outcome is unresolved is refused, so renaming an intent or issuing a new tool-call id cannot become a second submission. |
| `web_test_settle_operation` | after observing the result | Settles once. A second settlement is refused, so the first observation survives. |
| `web_test_operation_unknown` | when the connection drops or the result cannot be observed | The operation stays `unknown` and reaches the report and the operator as a question. It is never dispatched again. |

The same applies across a restart: an operation that was in flight when the DSH
process stopped becomes `unknown`, and the run that was executing waits in
`resuming` for an explicit continuation. A restart never resumes work by itself,
because it cannot check the environment, the login, or whether a change landed.

### Roles and business-time waits

- `web_test_assume_role` acts as one of the roles the operator declared for the
  environment. An undeclared role is refused, and a role change is refused while a
  business-changing operation is unresolved, because the effect that may exist
  belongs to the account that was active.
- `web_test_wait` parks a run until an ISO 8601 deadline and stores that deadline
  on the run, so a wait for a business event survives the host closing.
  `web_test_resume_wait` ends it and is refused before the deadline, with the
  remaining time.

### Operator control and holds

`webTest/controlRun` is the operator's side: `pause`, `resume`, `cancel`,
`await-user` and `continue`. A hold stops the session that owns the run and no
other, so one session's pause never stops another session's work. A run with no
recorded owner stops every session, because the plugin cannot tell whose work it
would be ending. While a run is held, the tools that record or retire state —
`web_test_status`, `web_test_settle_operation`, `web_test_operation_unknown` and
`web_test_resume_wait` — stay reachable; everything that would drive the browser
is refused.

### Reports

`webTest/buildReport` derives HTML, Markdown and JSON from one set of recorded
results, so the three forms cannot disagree. The verdict is `passed` only when
every recorded case passed and nothing was left open; any open question, blocked,
incomplete or skipped case makes it `undetermined`. Unresolved operations are
listed with their reasons. The HTML export escapes a case's own words, because
they come from a model reading an arbitrary page under test.

Case generation, confirmation and assertion are still the subject of the
following stages; see the [requirement mapping][mapping] for the per-requirement
status, and note that the mapping withdraws the earlier claim that S0–S6 are all
complete.

## Development

```sh
pnpm install          # in dsh-plugin-web-test/
pnpm run typecheck    # both compiler faces
pnpm run build        # typecheck, bundle, then Typert generation
pnpm run test         # unit tests
pnpm --filter dsh-plugin-web-test pack --pack-destination ../../dist
```

`pnpm run build` must run in that order: `tsc` emits JavaScript under
`lib/types`, tsdown bundles from there, and the Typert script rewrites
`src/client/remote.ts` plus the `lib/typert.*` artifacts. The clean lists in
`tsdown.config.ts` name only each bundle's own outputs, so `lib/types` and the
Typert artifacts survive while content-hashed chunks from an earlier build do not.

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

**Every Windows acceptance item is unverified.** The host evidence gathered so far covers Ubuntu 24.04 /
Node 24.15.0 / pnpm 11.7.0 with an unmodified DSH 0.2.0-rc.2 host only. What has since run on Windows is
the package's own dependency install, `tsc`, the bundle, the Typert generation and the unit suite — that is
build evidence, not host acceptance. The step-by-step checklist is
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
