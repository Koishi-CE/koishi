"@koishi-ce/plugin-locales": patch
---
i18n 编辑的服务端全量回推防抖从 0 提到 1000ms（与客户端发送侧一致），修复编辑中值回跳把光标甩到末尾、编辑器难以使用的问题（upstream: koishijs/koishi#1462）
