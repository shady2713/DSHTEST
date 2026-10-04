---
kind: upgrade-guide
description: "Controlled Desktop browser input refuses a hidden current document even when its owning window is focused."
---

# Visible documents for Native browser input

English | [中文](guide.zh.md)

## Change

Controlled Desktop browser actions previously checked native window and guest focus without checking the current document's visibility. A focused window can own a hidden document after navigation or reload; dispatched input may never reach that document.

Element revalidation now refuses a hidden current document when its owning window and guest are ready for input. The action returns `not-executed` with `stale-observation` before Native events are sent. A background owner may still restore its window before the second element revalidation. Visible-document input and existing navigation restrictions remain available. The [Desktop README](../../../../apps/desktop/README.md) owns the input requirements and recovery limitation.

## Migration

1. Handle `not-executed` separately from `unknown` when consuming `desktopBrowserControl` results. A fresh observation alone cannot establish that the document can receive input; do not repeatedly submit the same action to a hidden document.
2. Treat an `unknown` navigation outcome as the end of that action. Retain its uncertainty and stop further input on that document. A trusted owner may need to explicitly rebuild the guest or its window, obtain a fresh lease and binding, and observe the new document before starting a separate action. This change does not repair Electron's hidden-document state automatically.
3. Verify that a focused but genuinely hidden document is refused without input events. Confirm that visible-document actions still reach the page and that a restored background window undergoes a second element validation before dispatch.
