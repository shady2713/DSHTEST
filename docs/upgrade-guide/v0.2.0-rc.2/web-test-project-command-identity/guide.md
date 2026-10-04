---
kind: upgrade-guide
description: "Web testing URL checks and project corrections require the displayed project identity as well as its revision."
---

# Web testing project command identity

English | [中文](guide.zh.md)

## Change

`WebTestCommands.probeEntryUrls` and the `web_test_probe_entry_urls` tool require `projectId` alongside `expectedRevision`. The new `updateProject` Remote and `web_test_update_project` tool also require the identity of the project being corrected. A Session association can change while a card remains visible; callers must send the displayed project's identity instead of relying on the current association.

Corrections retain the same project identity and publish a new metadata revision. Old environment declarations and URL observations retain their own revisions; a correction grants no permission and performs no URL request. The Runtime verifies the saved Session association inside its write queue and rechecks live-owner eligibility before publication. A refusal before publication may retain staged content but leaves published metadata unchanged. Session logs and persisted project formats do not change.

## Migration

1. Update Remote and tool callers to read the current `StatusReport.project.projectId` and `revision`, then pass both as `projectId` and `expectedRevision`. Do not substitute a later selection's identity for the card the user acted on.
2. Regenerate Client definitions from the matching Host and update project correction callers to pass explicit replacement `codeRoots`, `entryUrls` and a `cmd-` command token. Reuse a token only for the same correction.
3. Refresh the selected Session after a stale or context-changed refusal. Confirm that switching between two projects at the same revision cannot redirect an old card's correction or HEAD request. Querying saved status must produce no network request or test run. See the [conversation reference](../../../../packages/web-test/web-test-conversation/README.md).
