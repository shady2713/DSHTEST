---
description: "First-run model-configuration surface for Web testing: the Host Remote that reports each task type's route state, and the full-width strip above the composer that shows it; for maintainers of the model-configuration experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test-presentation

English | [中文](README.zh.md)

## Summary

This package shows each task type's model route readiness and refusal in a strip above the message composer. The Host exposes configuration, verification and state Remotes from the model-configuration authority; the browser contributes one `conversation.input.dock` entry and owns no domain state.

The same dock shows the current conversation's project, user environment declaration and saved URL observations. Users can register or select a project, correct its roots and URLs, and explicitly check reachability. Conversation tool cards retain the facts logged for each request.

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

Load the Host plugin and the browser half together; the strip then appears as full-width chrome above the composer, below any composer-context card. It is chrome, not a modal: it takes no focus, blocks no input, and cannot be dismissed, because a task type with no usable route is a standing fact about the session rather than a message to acknowledge. It stays visible for the life of the conversation instead of being shown once and dismissed.

The dock configures an existing provider, exact model, and task through the official settings and credentials Remotes. Model fields use `remote.settings.mutate`; write-only password drafts use `remote.credentials.set`, are cleared before awaiting a write, and never reach chat or tools. Blank preserves a stored key; removal uses `remote.credentials.unset`. Save performs a real exact-route probe and persists only a verified selection. State reads neither probe nor write selections.

Each task type shows its name, readiness, and the provider and model when available. Unconfigured routes, missing capabilities and required verification appear as `not-configured`, `capability-absent` and `reverify`. A connection failure without a saved classification remains generic `transient`; `ready` requires a reusable verified persisted selection.

The strip never substitutes a route that was not verified for a task type, and never hides a task type it cannot route. A refused read displays the locale-owned unavailable message; an empty route list would incorrectly imply that all task types can run.

The status strip and configuration panels fit the conversation width. Status rows wrap and form fields shrink with the panel; long model names, project paths, URLs and declarations wrap without hiding saved facts. The configuration panels share a height-limited scroll area while the route-state strip stays outside it. Both use the composer's opaque theme surface so the transcript cannot show through their text.

### Failures

The project panel reads the selected Session through the same `webTestCommands` Remote as conversation tools. Users can register explicit roots and already-started URLs, select an existing identity, or correct the project against the displayed identity and revision. Correction and HEAD requests carry that displayed project identity; a later Session selection cannot redirect either action to another project. A correction retains its identity and invalidates earlier environment confirmation; saved declarations and HEAD observations keep their own revision labels. Refresh reads saved state only. The explicit HEAD button checks the displayed URLs and offers cancellation; it does not verify login or grant test permission. Environment declarations remain read-only in the panel and require the conversation's official human confirmation question.

Web testing tool cards render only their logged facts and results. They do not query a live project during replay. Ordinary Sessions show selectable identities without another project's private metadata; switching Sessions remounts the project panel. A failed read or correction keeps the current facts visible beside localized recovery text.

A refused Remote call renders locale-owned unavailable text. Form failures render a closed recovery instruction without exception strings. Reads are local to the view; refreshing reads current state again.

Provider directories report independent `catalogState` values. An unavailable directory retains its provider configuration address and does not hide other providers. The form initially selects a readable nonempty directory; users can select an unavailable provider, enter an exact model, and verify that route explicitly.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`WebTestPresentation` exposes `routeState`, the secret-free `configuration` directory, and `configureRoute`, which probes and persists an exact user choice. The Client additionally requires the published settings and credentials Remote namespaces. It imports no private provider editor and creates no credential store.

The derivation calls `selectRoute(taskType, { reverify: false })` in strip order. A ready decision names a verified persisted route. Other decisions map from the reason discriminant; a `connection-failed` decision without a saved failure classification remains generic `transient`. State reads never re-test routes or parse provider text.

The browser entry requires the Remote registry, mounts the presentation and conversation Commands contributions, then waits for both namespaces, settings, credentials, slots and locale before registering the dock. `mountWebTestPresentation` (`src/client/mount.ts`) contributes one entry to `conversation.input.dock` with `id: 'web-test-presentation'`, `order: 20`, and `locale: 'web-test-presentation'`. The entry's injected face is a registrant-private `HostObservable` (`src/client/slots.ts`) plus refresh, model and project configuration operations using the official Remotes; the renderer binds the observable to the `useRouteStatus` prop share. The source subscribes only while that hook observes it, so unmounting the dock releases the Remote read, and a read that answers after a newer read started is dropped. Keyed `tool.call.toolview` registrations render the seven web testing commands from durable call/result slices.

View state belongs to the browser. Wire errors are replaced with locale-owned diagnostics; response strings cannot be copied into the password form feedback.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-web-test-models](../web-test-models/README.md) — the model-configuration authority: route selection, connection verdicts, and the credential store this surface reads but never writes.
- [ui-conversation](../../client/ui-conversation/README.md) — declares the `conversation.input.dock` slot and owns the composer the strip sits above.
- [dsh-typert-protocol](../../typert/protocol/README.md) — the Remote service base and contribution format this package's `./remote` export is generated in.

-----

<a id="model-experience"></a>
## Model Experience

### The route-state strip

#### What the model sees

Nothing. The strip reads the `routeState` Remote method and renders the `RouteStateResponse` it returns; it registers no system prompt, no tool schema, no provider request field, and no Session event, so nothing it produces is reconstructable into a model request and nothing it reads reaches one either.

#### Token effect

None. State reads issue no model probes and write no persisted selections. An explicit Save and test performs a real request.

#### KV Cache effect

None. The admitted history is untouched: the strip only reports which route a task type would use, and a route decision does not alter the history prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Failures without a saved classification remain generic.** A state read never re-probes or guesses credential, model or quota failures from diagnostic text. The user must explicitly test the route.
- **Provider failures can echo secrets.** Raw response strings are classified privately and discarded before route-state rows or form feedback are rendered. Only safe closed reasons reach these views.
- **A first-run surface that never hides.** The strip is chrome and stays for the life of the conversation, so a task type that stays unrouted keeps a row on screen. This is deliberate: the row is the standing reason a request would fail.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`src/types.ts` restates the task-type literals instead of importing them from the authority, so the browser half carries no edge to a Host package. The literals are identical, so the Host passes its own through with no cast. `RouteState` is a closed ten-member union; `STATE_LABELS` in `RouteDock.tsx` is total over it, so adding a state fails to compile until its copy exists in both dictionaries.

The `conversation.input.dock` slot is declared by ui-conversation, in `packages/client/ui-conversation/src/client/contract/slots.ts` (its own package, whose line numbers this file does not track). This package only contributes an entry to it, so it declares no `SlotMap` merge.

</details>

**Runtime invariant:** No companion is published. Route state is a Remote read, not an owned relationship this package can drift from: the only service injected is the model-configuration authority, and every row is derived from its answers inside a single read.
