---
kind: upgrade-guide
description: "Existing Web testing control roots need verified activity history, and direct recovery callers must supply an atomic publication policy."
---

# Web testing cold activity registration

English | [中文](guide.zh.md)

## Change

Creating or selecting a Web testing data generation previously did not register prototype activity. The Runtime now commits a complete empty format-1 activity record before publishing the first pointer only when that process created the final `controlRoot` directory and the directory remains empty. Its bootstrap fingerprint represents an unregistered business composition; the first bounded run supplies the actual composition digest.

An existing root without `current.json` is refused instead of automatically selecting a generation. An existing selected generation without valid `prototype-activity.json` remains incomplete. Desktop quit and update checks cannot infer inactivity from incomplete history. Existing valid PAUSED and UNKNOWN records remain intact. Interrupted initialization does not qualify as a new empty root on retry. The [Runtime README](../../../../packages/web-test/web-test-runtime/README.md) owns initialization and producer authorization.

## Migration

Direct trusted Host callers now pass a resolved publication policy to `PrototypeActivityStore` construction and as the fourth argument to `RecoveryCoordinator.open`. Runtime and recovery plugin entries expose `windowsRenameDelaysMs`, defaulting to `[20, 40, 80, 160]`; `[]` preserves one-attempt publication. Only the same synced temp file is retried, never business I/O. A failed revocation still stops in-process admission without claiming durable success or clearing UNKNOWN.

1. Preserve the existing configured `controlRoot` and its data generations. Do not remove records or synthesize an empty cut to clear an incomplete result. This change provides no automatic migration for unknown old history.
2. For a genuinely new profile, set the Runtime's `controlRoot` to a previously absent final directory. Let the Runtime create that directory and publish its initial record; do not pre-create the final directory. Parent directories may already exist.
3. For existing history, retain valid records and their original operation identities. Keep incomplete or damaged history offline until a trusted importer can establish its actual activity; preserve the original material. The recovery-only entry retains records and refuses business dispatch; it cannot manufacture missing history.
4. Confirm that `readPersistentActivity()` returns no `completenessErrors` and a registered `headRevision` for the new root, including after reopening. A complete empty record establishes that root's inactivity. PAUSED, UNKNOWN and unresolved operations remain activity after reopening; do not treat completeness alone as permission to quit, update or dispatch.
5. Update direct Host callers to supply `resolveControlWritePolicy(configuredDelays)` explicitly. Set `windowsRenameDelaysMs` on both owning plugin entries when overriding the default. Verify that a temporarily held target permits the same publication after release; a budget exhausted while the target remains held must leave the previous cut or pointer unchanged and return failure.
