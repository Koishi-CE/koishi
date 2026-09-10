---
"@koishi-ce/client": patch
---

修复 koishi-console CLI 的 shebang 仍指向 node：产物顶层依赖 Bun API（Bun.Glob / Bun.file 等，node 下模块加载期即抛 `Bun is not defined`），对齐仓内 bun shebang 范式。
