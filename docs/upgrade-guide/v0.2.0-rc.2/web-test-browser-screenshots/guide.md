---
kind: upgrade-guide
description: "Web testing screenshot tools return durable image references instead of inline base64 text."
---

# Web testing screenshot image results

English | [中文](guide.zh.md)

## Change

`web_browser_screenshot` returns `image`, `target` and `hostEpoch` instead of `mediaType`, `byteLength` and `base64`. Its model-facing result contains a formal image block whose durable reference is recorded in the Session. Image-capable routes receive the image through the installed attachment provider; unsupported or unknown image input fails before Native capture. Stored image normalization may reduce dimensions; `originalDimensions` records a reduction when present.

## Migration

1. Update callers parsing screenshot values to use `image.bytes`, `image.width`, `image.height` and `image.attachmentId`. Read accepted images through `ctx.attachments.readImage(image)` instead of decoding `base64`.
2. Mount the Web testing Policy and an attachment provider beside the controlled browser provider, and choose an image-capable model route.
3. Verify that the next model request contains the screenshot image block and that reopening the Session reconstructs its reference. Reopening image history grants no browser execution permission. Ordinary user uploads and arbitrary image writes remain refused.
