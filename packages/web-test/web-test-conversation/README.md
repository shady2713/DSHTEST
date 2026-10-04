---
description: "Web testing conversation entry (ctx.webTestConversation) and command Remote (ctx.webTestCommands): one scoped tool mask per official root conversation agent, the session-to-project association that mask reads, the explicitly chosen tool-ask-user row, and the one Remote a card and a conversation both address"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-test-conversation

English | [中文](README.zh.md)

## Summary

This package is the Web testing conversation entry: it lets an ordinary DSH conversation act on a tested project without becoming a second agent. Each official root conversation agent carries one scoped mask over the tools the web testing policy governs, so a session with no attached project sees none of them. It owns four facts: which tools a conversation is offered, which project a session is attached to, which question definition the composition registered, and which typed command one ask resolves to. The mask is visibility, not enforcement; the command layer is one Remote both callers reach.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The composition mounts the service over the agent registry, the tools registry, the credentials-free policy surface, and the runtime that holds the project record. A deployment states only the question row it wants; the governed tool set is read from the policy rather than restated here.

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectId, Revision } from '@deepseek-ai/dsh-web-test-contracts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import WebTestConversation, { WebTestCommands } from '@deepseek-ai/dsh-web-test-conversation'
declare const ctx: Context
declare const sessionId: SessionId
declare const projectId: ProjectId
declare const revision: Revision
declare const commandId: string
declare const codeRoot: string
await ctx.plugin(WebTestConversation, { askUserMode: 'timed', askUserTimeoutSeconds: 120 })
await ctx.plugin(WebTestCommands)
await ctx.webTestCommands.attachProject({ sessionId, projectId })
await ctx.webTestCommands.declareEnvironment({
  sessionId,
  commandId,
  declaration: {
    codeRoots: [codeRoot],
    entryUrl: null,
    isTestEnvironment: true,
    login: { state: 'not-required' },
    supplementaryRequirements: [],
  },
})
ctx.webTestCommands.queryStatus({ sessionId, verb: 'query', subject: 'material' })
ctx.webTestCommands.submitAction({ sessionId, verb: 'start', target: 'checkout', expectedRevision: revision })
```

### What is configurable and what is not

Two fields, both about the question row. Which tools a conversation may be offered is not configurable: the governed set is the policy's own adapter table, and a tool the policy does not govern is never masked. The command set is not configurable either: six verbs are declared, and the five this stage does not perform are answered as unavailable rather than offered as something a deployment could switch on.

## Further Exploration

The registration rules below are the configuration surface; there is no separate evidence document for this sub-item, because the executable proof is the package's own suite.

<a id="understand-the-implementation"></a>
## Understand the implementation

### The mask is visibility; the policy is enforcement

`WebTestPolicy` already refuses every governed call it does not admit, at the registry's guard stage, with no allow result a listener can undo. Masking a tool therefore grants nothing and unmasking one permits nothing: what the mask decides is what the model is *offered*. A tool this stage does not act through is absent from the conversation's schema rather than present and refusing, so a model cannot read it as a working control.

### The next mask is installed before the previous one is released

`refresh()` installs the new mask and only then releases the old, so the overlap a tool registry observes is the stricter union of both rather than an empty gap. A session that moves from unattached to confirmed never has a moment in which nothing is masked.

### The governed names come from the policy, not from a list here

The names the mask may name are the policy's own `adaptedToolNames()` crossed with the global registry. A tool the policy does not govern is never masked, and a governed name the deployment does not ship is never named, because `tools.restrict()` refuses an unknown global name rather than ignoring it.

### The command set is closed, and its unavailability is stated

`WEB_TEST_COMMANDS` names six verbs: `query`, `generate-case`, `start`, `pause`, `resume`, `cancel`. The first reads; the other five would change business state that has no domain in this stage, so `describeCommands()` reports each of them as `available: false` with the domain that would have to exist, and `submitAction` answers them with that same reason. An ask this stage cannot perform is answered, not queued: nothing is stored, no token is spent, and no later stage will find it waiting.

Every field a verb needs is declared once, in `MUTATING_FIELDS` and `QUERY_FIELD`, and `resolveCommand` answers with either the typed command or the fields the ask left out. A vague `start` therefore comes back as a specific question — "name what to start and name the project revision the answer was given against" — naming the project it is about.

### A status query and a mutating ask are two surfaces, not one switch

`queryStatus` reads and `submitAction` decides, and their request types do not overlap: a resolved `query` command carries a subject and nothing else, while every mutating command carries a target and an expected revision. A typed caller cannot build an action out of a status question, and `ActionOutcome` has no member reporting an action as performed, because there is no domain that would record one. That is what makes "a status query cannot start a test" a property of the surface rather than a branch a later edit could delete; the wire path refuses the same confusion explicitly, because a request arriving from a card is not typed.

`StatusReport` carries the project's published record, whether the policy confirmed its environment, and the declared material as this host finds it. It commits nothing, publishes no notification, and takes no policy lease, which the suite asserts by comparing the durable head, the outbox, and the ledger around a query.

### A refusal is ordered, and the first one wins

An ask is refused for the Session it names before anything is read about a project, so a session attached to nothing cannot learn anything from a failed ask; then for what it left out; then for a project that moved since the answer it was expressed against; and only then for a verb this stage does not perform. The staleness check compares the `expectedRevision` every mutating command carries against the revision the project is published at now, read live rather than remembered from the attachment — so an answer given against a project that has since changed is refused instead of acted on.

### A session never borrows another project's context

The gate reads its own association record — the project `attach()` bound to this session, and the revision `declareEnvironment()` confirmed — and consults the policy's `bindEntry` / `declareEnvironment` for the consequences. `webTestRuntime.readProject(projectId)` is what makes an attachment to an unpublished project fail at `attach()`; the gate itself never falls back to "the one declared project", so a session with no project of its own reaches nothing.

`context(sessionId)` is the one source the command Remote resolves every ask against, and it looks up the Session it was handed. A session with no project reads `{ kind: 'ordinary' }`, which is a value rather than a missing value: a caller that forgets to check it is handed a context with no project in it. The `no-project` refusal names the Session and the remedy and carries no other project's identity, code root, or entry URL, and the suite asserts that a second, attached and confirmed session running beside it changes neither fact.

### Declared material is read, never assumed

`updateProject({ sessionId, projectId, commandId, expectedRevision, codeRoots, entryUrls }, signal?)` and `web_test_update_project` correct the project identity and revision the user read. They refuse a changed Session selection, retain the project identity, refuse an old revision, and replay the same command token idempotently only for the same metadata. Runtime checks the durable Session selection inside its write queue; the command checks live Session ownership and cancellation before staging and publication. A refusal before publication leaves published metadata unchanged, but may retain an unpublished stage. A published correction expires the current environment confirmation; persisted declarations and URL observations still describe their recorded older revision. A user must confirm the new environment facts and explicitly check its new URLs. Conversation refusals preserve their closed `web-test-conversation/*` code over the shared Remote.

The status report reaches the runtime's `inspectProjectMetadata`, which compares each code root the record declares, and every entry URL, with what this host holds and reports each fact as usable, absent, or unusable. A project whose code root was deleted answers a status question that says the root is gone. This inspection judges entry URL syntax only; it never requests an address.

After registration, explicitly call `probeEntryUrls({ sessionId, projectId, expectedRevision })` or `web_test_probe_entry_urls` to check the displayed project's already-started registered URLs. A changed Session selection is refused before any URL request. The shared command uses the Runtime's [bounded HEAD check](../web-test-runtime/README.md#use-this-package); the model tool passes its cancellation signal. `StatusReport.entryUrlProbe` is `null` while unchecked, or the latest saved observation with its own `revision`. A status query reads that value without refreshing it or generating tests. Callers must compare the checked revision with `project.revision`; a saved check neither confirms an environment nor restores test permission.

### Three question-row combinations are refused at load

`resolveAskUserMode` runs in the constructor, so a misconfigured row fails when the composition loads rather than when a user first asks a question.

- `'timed'` with no wait, so a row cannot inherit a duration from another package's default;
- `'timed'` with `timeout: -1`, which keeps a blocking `ask()` and only keys the card by call id — a timed row that blocks indefinitely;
- `'legacy'` with a wait, which the blocking tool never reads.

`mode: 'legacy'` is how a deployment asks for the indefinite wait on purpose.

### The composition owns the collision, not this package

The question tool is registered by this entry, so a composition that mounts both this plugin and the base bundle's `tool-ask-user` row registers the name twice. Disable the base row when mounting this one:

```yaml
- id: tool-ask-user
  disabled: true
- insert:
    - id: web-test-conversation
      name: ../web-test-conversation/lib/index.js
```

### Durable project selection and explicit confirmation

The Commands Loader row mounts the `./commands` export beside the conversation service. `./typert` and `./remote` publish generated Host descriptors and Client declarations; `./types` publishes their request and result types. `queryStatus(StatusQueryRequest)` cannot accept an action verb, and `submitAction(ActionRequest)` cannot accept a query. The wire descriptors validate the same separation.

Project registration calls the runtime writer. Project attachment is saved before the conversation association becomes visible. Environment facts are saved before policy confirmation. A reopened root conversation restores its own saved project and displays the saved declaration, with `environmentConfirmed: false`; saved facts never restore authorization. The project catalogue returns identities and revisions only.

`StatusReport.environmentDeclarationRevision` names the revision described by the saved declaration, or `null` when no facts were saved. Saved facts remain readable after a revision change. The process-local association records `declaredRevision`; both context and the tool gate require equality with the current published revision. Runtime publication immediately refreshes the masks. A revised project requires another real Confirm; reopening never restores confirmation.

The model environment tool requires an exact human Confirm answer and checks the project revision, association, and declaration again after the wait. Decline, skip, custom text, cancellation, and a changed context do not confirm anything. Under a timed row, pending requires a fresh confirmation request; this custom command does not reuse the `ask_user_question` late-reply projection. A Client explicitly submitting a user declaration uses the same Remote directly.

### The invariant companion is omitted

No runtime invariant companion is published. The one relation this package owns that an invariant could re-derive is which tools a conversation is offered, and that is a pure function of the two facts this entry alone records — whether the session is attached, and whether the policy has confirmed that project's current published revision. The one relation here with a second observer, the mask against the policy's decision, is settled by the policy being the sole authority for it, which a second assertion of the same call would restate rather than check.

<a id="model-experience"></a>
## Model Experience

### Admitted effects

#### What the model sees

The governed tool definitions. An open session carries the governed names in its request schema and an unattached one carries none, and the registered question tool is the shipped `ask_user_question` definition rather than a new one. No additional system-prompt section or custom Session event is registered; the official tool pipeline logs command calls and results. The Commands plugin registers `web_test_query`, `web_test_register_project`, `web_test_update_project`, `web_test_probe_entry_urls`, `web_test_attach`, `web_test_declare_environment`, and `web_test_action`. Each body calls this same Remote; the calling Agent supplies the Session identity. The environment tool asks the user to confirm the complete declaration before saving it or confirming policy state.

#### Token effect

The seven command schemas and their tool results consume tokens. The governed code-reading schemas appear only for an attached, confirmed conversation.

#### KV Cache effect

None. The entry adds no prefix or suffix text, so it neither creates nor invalidates a cached prefix.

### Refused effects

#### What the model sees

Nothing beyond the tool list above. A tool this stage does not act through is absent from the schema, so the model cannot read it as a working control, and a session with no attached project sees none of the governed names at all.

#### Token effect

Unavailable business actions and refused command calls return explicit tool results, which consume tokens. The mask removes governed execution tools before a model request is built.

#### KV Cache effect

Changes to visible tools can change the request prefix; command refusals do not add a separate prefix.

## Known Limitations and Deferred Work

These limits define when this package is a poor fit. They are current package constraints, not a task backlog.

- **The association is this entry's, not the policy's.** `WebTestPolicy` exposes no reader for a session's binding or for a project's declaration, so an attachment established by any other caller is invisible to the gate and the tools stay closed. A first-class reader on the policy would remove the asymmetry.
- **The seat interfaces are the Client's to read.** The current UI host, the selected Session, and main-panel visibility are Client-side facts (`ctx.sidebarRight`'s mounted Session, `ctx.layout`'s `activePanelId`, and the GUI host the Web server documents), and none of them has a Host-side interface this package could consume. It does not reconstruct the removed `SidebarRightBinding`, and it invents no replacement: what the Host knows is the Session the conversation agent holds, and that is what the context is keyed by.
- **Five of the six commands are refusals.** Case generation, start, pause, resume, and cancel have no domain in this stage, so each is answered `unavailable` with the domain that would have to exist. Nothing is queued, and no receipt exists for an action, because there is no case or run record to write one to.
- **The status report does not carry model route readiness.** Which provider route a task type may run on is the model configuration service's decision, it makes real requests to answer, and this stage does not depend on it; a caller that shows readiness must add that fact itself rather than read it from this report.
- **The timed question row is registered, not validated end to end.** Timeout and pending handling, reconnect and reopen, late answers, cancellation, and duplicate delivery are the question tool's and the user-questions service's behaviour; this entry chooses the row and refuses the misconfigured ones.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer notes</summary>

The Host build generates the Remote descriptors used by Client consumers. Source tests and installed-profile checks exercise separate import paths.

</details>
