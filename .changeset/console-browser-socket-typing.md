---
"@koishi-ce/plugin-console": patch
---

适配依赖类型漂移的存量类型错误：browser 变体读取 loader 挂载的 `koishi.socket` 改为显式定型（`Record<symbol, unknown>` 索引 + `Universal.WebSocket` 断言），替换因 Loader 类型变化而失效的 `@ts-expect-error`，运行时行为不变。
