---
description: "Register the Web testing application's own identity and data root, and inspect its entry declarations while validating a local DSH plugin composition."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test

English | [中文](README.zh.md)

## Summary

This package owns one installed Web testing application: its data root, the profile inside it, the browser `userData` directory, the update channel, and the Loader entry it mounts. The official product keeps the shared `~/.dsh` and its own `desktop` profile, so both may be installed side by side; it refuses a root or profile that would select the official one. A launcher applies `launchEnvironment` before the runtime resolves any path, and `assertWebTestDataRoot` checks the booted runtime resolved it. That environment names these Electron-owned paths to a shell carrying it. Entry declarations stay unavailable until a mounted capability backs them.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The package is a service plugin plus the application owner. `resolveWebTestApplication` reads no configuration file and creates nothing; `registerWebTestApplication` creates the install and returns the disposer that removes exactly what it created.

The shipped composition mounts contracts, the generation-owned Runtime, the published-project scope and clock, policy, model configuration, conversation commands and presentation. `scope-provider` owns the policy observations; `assembly` admits a fixed one-pixel model probe through the official attachment provider and publishes the project entry only after commands are available. Case and report entries still require their owning capabilities.

```ts
import { spawn } from 'node:child_process'
import { readOfficialHome, registerWebTestApplication, resolveWebTestApplication } from '@deepseek-ai/dsh-web-test'

const officialHome = readOfficialHome()
const application = resolveWebTestApplication({
  ...(officialHome === undefined ? {} : { officialHome }),
})
const releaseInstall = registerWebTestApplication(application)
// A launcher applies this before the runtime resolves a path, and passes
// application.compositionLayerPath as a patch file.
spawn(process.execPath, ['--profile', application.profileName], {
  env: { ...process.env, ...application.launchEnvironment },
})
// On uninstall, this removes exactly what registration created.
releaseInstall()
```

`registerWebTestApplication` writes the data root, `<home>/profiles/web-test/package.json` (the bundle list this application selects), `<home>/browser/user-data`, and `<home>/release.json` — its update channel, entry id, and composition layer for whatever shell launches it. The shipped [web-test.cordis.patch.yml](web-test.cordis.patch.yml) mounts the built entry and disables the four product egress rows; the [identity regression](tests/identity.e2e.ts) asserts every row lands over the application's own profile and that the entry activates and releases through a real Loader on that data root. That layer is published with the package, so an installed copy resolves it beside `lib/index.js`, and a copy that lacks it is refused before any runtime starts.

That resolution holds when a bundler inlines this package into an application, which the Desktop main bundle does because the package is a workspace devDependency rather than one of the `dependencies` it ships. The module's own directory is accepted only while its manifest declares this package; a bundle's directory declares the importing application instead, so the install is then the one the importer resolves by this package's name. An importer that declares neither is refused with the declaration it needs. The [bundle resolution regression](../../../apps/desktop/tests/web-test-bundle-resolution.spec.ts) bundles this package's real source, runs it where the main bundle runs, and reads both paths back from the built file.

The profile exists only where that registration wrote it. `dsh --profile web-test` under a home that never registered it is refused by name rather than auto-initialized, because a profile created under an arbitrary home would boot this application on the official product's `~/.dsh`.

The package is not an installable profile bundle. The built Loader fixture in [tests/fixtures/cordis.yml](tests/fixtures/cordis.yml) mounts its compiled entry:

```yaml
- id: web-test
  name: ../../lib/index.js
```

The path is relative to that fixture. Other compositions must resolve the file from their own configuration directory. Before using the bare package name, declare it in the application's resolver manifest and verify package-metadata resolution. A TypeScript source alias alone can load the plugin while DeepSeek request preparation fails with REQUEST_EXTENSION because its package inventory cannot resolve the manifest.

### Minimal configuration

All fields have defaults. Invalid field types fail plugin activation. These fields are labels the mounted service reports; the isolation above comes from the application owner, which reads them independently.

| Field | Default | Meaning |
|---|---|---|
| applicationId | dsh-web-test | Application identity the service reports. |
| dataRootName | web-test | Data-root label the service reports; it does not change DSH_HOME. |
| profileName | web-test | Profile label attached to entry declarations; it does not select a running profile. |

### Application identity

| Property | Meaning |
|---|---|
| home | Data root every harness service resolves storage, settings, and credentials through. |
| profileDir | Profile this application owns, inside its own data root. |
| userDataDir | Browser `userData` directory inside the same root. |
| updateChannel | Channel a shell publishes and checks; the official product keeps its own. |
| entryUrl | `file:` URL of the built entry the composition layer mounts. |
| compositionLayerPath | Patch file that mounts the entry and closes product egress. |
| launchEnvironment | `DSH_HOME` for this application, the harness telemetry opt-out, and the marker a shell reads through `isWebTestApplication`. |

<a id="recovery-only-entry"></a>
### Recovery-only entry

Configure this entry's `windowsRenameDelaysMs` separately from the ordinary Runtime. The default `[20, 40, 80, 160]` retries only the same complete atomic publication temp on transient Windows rename errors; `[]` permits one attempt. Exhaustion leaves the previous pointer selected, with no durable-success acknowledgment. The [Runtime publication policy](../web-test-runtime/README.md#use-this-package) describes admission refusal and error retention.

The ordinary composition also mounts `@deepseek-ai/dsh-web-test/prototype`, which shares the Runtime module's private authority registry. Its bounded producer requires its exact trusted owning Context to register run heads, admit dispatch, record outcomes or revoke dispatch; it returns no authority and exposes no Remote or model tools. `markNotExecuted` commits a correlated real browser denial for the original ISSUED operation; UNKNOWN operations cannot settle, and the original business intent cannot be admitted again. Truly new control roots commit an empty format-3 prototype cut before publishing their generation pointer. Existing roots with missing or damaged cuts remain incomplete; absence does not establish an idle state. The empty cut's fixed fingerprint identifies an unregistered prototype domain, and the first registered run binds the actual business composition digest.

The separate `@deepseek-ai/dsh-web-test/recovery` entry opens an existing `controlRoot`, which is required and has no default. Its profile contains no ordinary Runtime, Agents or tools. The old writer must release the same control-root lock before this entry can activate. `inspect()` reads persistent run heads without loading Sessions or writing records; `freeze`, `prepare` and `activate` require a caller's opaque `RecoveryAuthority` issued to the trusted recovery owner. The entry's own authority remains in module-local state and is not returned through the service.

`freeze` requires a revoked executor cut; `prepare` requires that frozen inventory and builds a separate recovery-only generation before `activate` selects it. Supported transitions are legacy format 1→2 and current format 3→4. Formats 1/2 retain strict read-only readers; no implicit migration to a current executor is provided. Recovery retains Pause, cancellation, UNKNOWN operations, confirmed non-execution receipts, reports and attachments without modifying predecessor generations. The [built recovery-profile regression](tests/recovery-profile.e2e.ts) exercises process isolation, lock contention, retained records and a business POST count that stays at one; it does not verify a real installer or general recovery. The [Runtime recovery implementation](../web-test-runtime/src/recovery.ts) owns data validation and generation publication.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[src/application.ts](src/application.ts) resolves the identity, guards it against the official product's home and profile, registers the install, and releases both the install and the Loader entry. [src/launcher.ts](src/launcher.ts) turns that identity into a running tree: it reads the official home while the ambient environment still names it, applies `launchEnvironment` before any runtime path resolves, carries the composition layer as its own patch layer, and refuses a runtime that came up on another data root. It takes the runtime boot as an argument, so a carrier may run the same request in process or as a child `dsh` invocation. [src/index.ts](src/index.ts) is the service: it reports the configured labels and the entry declarations for projects, cases, and reports. Entry declarations do not register UI controls, and availability stays false until a backing capability mounts. The launch request supplies the composition through `applicationPatchFiles`, below user patches, so official settings can persist model selections; `patchFiles` remains reserved for higher-priority command-line overlays.

| File | Responsibility |
|---|---|
| [src/application.ts](src/application.ts) | Identity, data root, profile, `userData`, update channel, registration, release, and the launch-time guards. |
| [src/launcher.ts](src/launcher.ts) | Launch order, the composition layer as a patch layer, and the post-boot data-root assertion. |
| [src/index.ts](src/index.ts) | Service lifetime, configured labels, and availability. |
| [src/entry-points.ts](src/entry-points.ts) | Intended entry declarations. |
| [src/types.ts](src/types.ts) | Identity and entry types. |
| [web-test.cordis.patch.yml](web-test.cordis.patch.yml) | Composition layer: mounts the entry and disables the four egress rows. |
| — | No runtime invariant companion is published; this package has no independently maintained observations that can diverge. The Loader regressions verify its service lifetime and data root. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These owners define assembly requirements and the remaining work.

- [Adding a package](../../../docs/cookbook/adding-a-package.md) — workspace registration and build requirements.
- [Architecture](../../../docs/architecture.md) — supported profiles and plugin extension points.
- [M1 task cards](../../../.agents/notes/proposed/process/2026-09-28-web-testing-tasks-m1.md) — application assembly and admission.
- [Assembly regression](tests/assembly.e2e.ts) — keyless plain-Node Loader checks for the built file entry and request inventory.
- [Identity regression](tests/identity.e2e.ts) — keyless checks for the data root, the app-owned profile, the egress closure, and the release.

-----

<a id="model-experience"></a>
## Model Experience

### Package inventory

#### What the model sees

The identity entry adds no prompt, tool, or result text. When DeepSeek plugin inventory is enabled, that upstream contributor records the active package name and version in `dsh_plugin_packages` request metadata; the [inventory package](../../llm/plugin-package-inventory-deepseek/README.md) owns the protocol.

#### Token effect

The identity entry adds no model-input text. Mounting the automation provider adds its four tool schemas and each submitted call's result; observations include page text and screenshots include image bytes. Request metadata is not a measured token-usage claim.

#### KV Cache effect

The identity entry does not construct model context or cache keys. Mounting or removing automation changes the tool set, and its results change subsequent model input; provider behavior for inventory metadata remains upstream-owned.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The sub-item this package implements is not accepted; the remaining work is stated here so the next owner does not read a green test as a delivered application.

- `launchWebTestApplication` composes a boot request and can run it in process or hand it to a child `dsh`, but only its own tests call it. The desktop shell at `apps/desktop` is a carrier rather than a booting process: `pnpm run dev:web-test` there applies `launchEnvironment`, registers the install, and opens the shell under this identity, and the shell's Host child checks the data root and the mounted entry itself through `assertDesktopHostLaunched`. Passing the shell's own start to the launcher as a runtime boot would mean inventing the entry ids that check reads, so the launcher's carrier path stays unexercised and the `desktop` profile stays unreachable from the CLI.
- The browser automation capability is not carried here. The [experimental provider](../../experimental/browser-use-web-test/README.md) owns the four channel tools and its own production wiring gap, because it needs an experimental runtime this package may not depend on.
- The registered browser `userData` directory is now consumed: a shell launched under this identity sets Electron's `userData` to it, and releases it when its registration is released. The update channel is still resolved, registered, and released with nothing consuming it, because the shell that checks it is not part of this package.
- Releasing the entry stops the row and unregisters the service; removing the row from a file-backed composition is the Loader's own `remove`, which is not exercised here.
- Declared entries have no Client controls or typed dictionary beyond their locale keys, and the ordinary load/no-load model-request contrast is still outstanding.
- `docs/config-catalog.md` and `docs/subsystems/web-test.md` still describe the identity fields as labels only; they are generated and are not updated by this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The data root separates the two products only when a launcher applies `launchEnvironment` before the runtime resolves a path, so the regressions assert the booted runtime's own `dshHomePath()` against the registered root rather than trusting a clean start.

</details>
