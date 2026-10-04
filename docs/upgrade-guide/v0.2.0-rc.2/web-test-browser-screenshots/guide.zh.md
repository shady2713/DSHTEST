---
kind: upgrade-guide
description: "Web testing 截图工具返回持久图像引用，替代内联 base64 文本。"
---

# Web testing 截图图像结果

[English](guide.md) | 中文

## 变更

`web_browser_screenshot` 返回 `image`、`target` 和 `hostEpoch`，替代 `mediaType`、`byteLength` 和 `base64`。面向模型的结果包含正式图像块，完整持久引用记录在 Session 中。支持图像的路线通过已安装附件提供方接收图片；图像输入不支持或未知时，在 Native 捕获前拒绝。存储归一化可能缩小图片；发生缩小时，`originalDimensions` 记录原尺寸。

## 迁移

1. 将解析截图结果的调用者改为使用 `image.bytes`、`image.width`、`image.height` 和 `image.attachmentId`。通过 `ctx.attachments.readImage(image)` 读取已接收的图片，替代解码 `base64`。
2. 在受控浏览器提供方旁挂载 Web testing Policy 和附件提供方，并选择支持图像的模型路线。
3. 验证下一次模型请求含截图图像块，且重开 Session 能重建其引用。重开图片历史不会授予浏览器执行许可。普通用户上传和任意图像写入仍被拒绝。
