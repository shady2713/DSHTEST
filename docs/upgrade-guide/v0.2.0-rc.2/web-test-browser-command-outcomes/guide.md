---
kind: upgrade-guide
description: "Web testing activity formats 3 and 4 distinguish confirmed browser non-execution and make legacy executor data read-only."
---

# Web testing browser command outcomes

English | [中文](guide.zh.md)

## Change

Fresh Web testing control roots write activity format 3. Confirmed browser non-execution settles an original ISSUED operation as NOT_EXECUTED, retaining the correlated tool-call and wire receipt. UNKNOWN remains unresolved, and the original business intent cannot be dispatched again. Format 4 is the corresponding recovery-only candidate. Older readers reject formats 3 and 4.

Legacy formats 1 and 2 retain their strict validation and are read-only for the current Runtime. Existing selected generations are not rewritten or automatically migrated. These activity formats are independent of the [Session format](../../../session-format-status.md); the change does not alter Session events.

## Migration

1. Stop the old executor before opening its configured `controlRoot` with the current Runtime. Retain the complete old root and its `current.json`, data generations and recovery backups. Read it with `readPersistentActivity()`; do not remove or reclassify UNKNOWN operations.
2. Configure a separate, genuinely absent `controlRoot` for current execution. No legacy-to-current executor migration is provided. Starting a fresh root does not authorize repeating an unresolved business intent from an old root.
3. Update trusted consumers to call `WebTestPrototypeControl.markNotExecuted(operationId, receipt, callerOwnerCtx)` only for a real correlated browser denial. Keep error results as errors; success uses `markCompleted`, and ambiguous outcomes use `markUnknown`.
4. For recovery, use `checkPrototypeFormat1` for the retained 1→2 path or `checkPrototypeFormat3` for 3→4. `RecoveryCoordinator.prepare` verifies a separate backup and creates an adjacent candidate; `activate` selects it only after rechecking inventories. Preserve the predecessor and backup. Recovery candidates never grant execution or downgrade support.
5. Confirm the selected activity format with `readPersistentActivity()` and inspect `prototype-activity.json`. Confirmed denials retain their full receipt and are absent from `unsettledOperationIds`; UNKNOWN remains listed. See the [Runtime reference](../../../../packages/web-test/web-test-runtime/README.md) for admission and receipt requirements.
