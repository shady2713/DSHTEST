---
description: "Expose the Web testing controlled automation channel to a model as eight browser tools, and refuse a target, lease, or generation violation instead of retrying it."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-browser-use-web-test

English | [中文](README.zh.md)

## Summary

Exposes the Web testing application's controlled Host↔Main automation channel to a model as eight tools: observe, screenshot, click, type, double-click, native key input, restricted navigation, and reload. The provider owns no browser; model tools reach only their explicitly bound Session target, and the Desktop Main decides whether that command may act. A closed set of target, lease, and generation violations is refused rather than retried, and an unknown command outcome reaches the model as its own outcome kind.

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

Register the provider in a profile that also mounts `@deepseek-ai/dsh-web-test`, then explicitly enable the Desktop Host service:

```yaml
- id: web-test-browser-automation
  name: '@deepseek-ai/dsh-experimental-browser-use-web-test'
  config:
    controlled: true
```

`controlled` defaults to `false`: no tools or provider reservation are registered, and `web-test.browser-automation` remains unavailable. When enabled, the provider waits for `ctx.desktopBrowserControl`, supplied privately by the Desktop Host. A trusted application consumer must choose a live target from `targets()` and explicitly await `bind(actualSession.id, target.target)` before model tools can use it. Tools never create a binding or accept a target or Session ID from model arguments.

`DesktopBrowserExecutionGroups` is the trusted Runtime consumer for multiple role targets. Construct it from the real Runtime Service's owning context, after its Service registration; unrelated contexts cannot obtain its private authority. It accepts Main-created targets and an explicit project/batch/activation owner, acquires atomic role grants, and invokes one `SessionResources.run()` callback. That callback submits directly through its role executor and may overlap page business waits; Native input remains serialized by Main. Callback settlement revokes captured executors and joins already submitted work. Agent disposal withdraws all grants. Group creation and target selection are absent from model tools.

### Minimal configuration

| Field | Default | Meaning |
|---|---|---|
| `controlled` | `false` | Enables tools backed by the Desktop Host service and its acknowledged Session bindings. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-browser-use-web-test) is the exhaustive source for every accepted field and its JSDoc.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each tool call derives the calling Agent's actual Session ID and uses that Session's acknowledged `desktopBrowserControl` binding. A missing binding, changed target, revoked lease, or replaced Host refuses execution. The service owns private IPC correlation; model arguments cannot select another target or Session. Unknown outcomes reach the model without an automatic retry.

Eight refusal reasons are reported as text: `session-not-authorized`, `unknown-operation`, `wrong-target`, `stale-observation`, `epoch-mismatch`, `revoked`, `action-failed`, and `navigation-denied`. Every one means nothing was executed. An `unknown` outcome or transport failure reports that the action may already have changed the page.

`observe` and `screenshot` perform no page mutation. A screenshot requires an image-capable model route and the Web testing capture policy. Inside its existing `SessionResources.run()` callback, that policy captures the bound target through Main and persists the image; callers cannot supply image bytes. The result contains a formal image block with its complete durable reference, alongside target and Host epoch metadata. Session logs retain that reference for later model-request reconstruction, and a cancelled capture or changed binding yields no image result. `click`, `type`, `double-click`, and `press-key` require the element reference and page generation from the most recent observation; a reference from an older generation is refused, because the page may have moved. Each observation starts a new generation. `navigate` and `reload` require that generation and invalidate it before dispatch. Main admits navigation only to the same HTTP(S) origin and pathname as the current observation, with no credentials and subject to the guest-owner navigation rules; only query and fragment changes are available. Main-frame navigation, including same-document changes, invalidates prior observations. The protocol revision is 3; a previous revision is refused.

Each target is exclusively bound to one Session. Main freezes its live HTTP(S) origin at binding and prevents main-frame page, toolbar, form, redirect, and popup navigation to another origin. Same-origin business paths remain available through page actions; the navigate tool retains its stricter query/fragment-only rule.

The [shared protocol](../../client/ui-sidebar-browser/README.md#understand-the-implementation) owns the message definitions this provider sends.

| File | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | Plugin entry, the mount decision, the exclusive reservation, the eight tools, and the refusal texts. |
| [src/types.ts](src/types.ts) | Profile opt-in type. |
| [src/group-execution.ts](src/group-execution.ts) | Trusted Runtime role coordination and quiescent group release. |
| [tests/browser-automation-provider.spec.ts](tests/browser-automation-provider.spec.ts) | Provider behavior against explicitly bound Host-service fixtures. |
| [tests/browser-automation-provider.e2e.ts](tests/browser-automation-provider.e2e.ts) | Built entry mounted and disposed by the real Loader. |
| — | No runtime invariant companion is published; this package observes a channel it does not own, so it has no independently maintained observation that can diverge. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web testing subsystem](../../../docs/subsystems/web-test.md) — the application identity and declared entry points this provider mounts
- [browser-use registry](../../browser-use/browser-use/README.md) — the exclusive slot this provider reserves
- [Browser automation channel](../../../apps/desktop/README.md) — the Main-side admission and execution rules
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-browser-use-web-test) — every accepted config field and its source declaration

-----

<a id="model-experience"></a>
## Model Experience

### Browser channel tools

#### What the model sees

Eight fixed tool descriptions. `web_browser_observe` returns the page address, the page title, the page generation, and one line per element the page names. `web_browser_screenshot` returns the captured image as a formal image block plus pixel dimensions, target and Host epoch text. The output contains no base64 text. `web_browser_click` and `web_browser_type` return the reference acted on and the page generation it was taken from. A refused command returns one of eight fixed sentences naming the next step: observe again, reopen the page, or stop. A command whose outcome is unknown returns a separate sentence stating that the action may already have changed the page.

#### Token effect

The eight tool descriptions do not change while the Session runs. The observe result is the only output that scales with the page: it lists one line per named element, so a page with many elements costs proportionally more. The screenshot result adds a fixed metadata sentence and one image block; its image-input cost follows the routed model’s image accounting.

#### KV Cache effect

Tool descriptions are fixed for the life of the Session, so the tool-schema prefix stays reusable across turns. Every result appends content the model has not seen before, and the provider never rewrites earlier request tokens. Mounting or removing the provider changes the tool set, and therefore the schema prefix, once per change.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The Desktop Host supplies the production service, but shipped defaults do not enable these tools or select a target for a Session. The [outcome scenario](../../../snapshots/session/web-test-browser-outcomes/snapshot.yml) checks deterministic refusals. The [image scenario](../../../snapshots/session/web-test-browser-image/snapshot.yml) checks actual Policy, local attachment persistence and formal image reconstruction in a subsequent model request through a unit carrier. Neither scenario verifies a Native desktop page or completes the application assembly.

- A profile that enables this provider must assemble it explicitly. The released `@deepseek-ai/dsh-web-test` package does not carry it, and the Web testing launcher must not depend on this package at runtime.
- Cancellation reaches Main through the original command envelope and prevents input before dispatch. Delivered actions cannot be undone; correlated or unknown outcomes remain distinct. Provider teardown joins owned operations, and the trusted application consumer owns target creation and binding.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package was split out of `@deepseek-ai/dsh-web-test` because the provider needs `SessionResources` from `@deepseek-ai/dsh-experimental-browser-use-runtime`, and a released package may not depend on an experimental one.

</details>
