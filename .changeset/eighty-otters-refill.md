---
"@koishi-ce/plugin-config": patch
"@koishi-ce/plugin-market": patch
"@koishi-ce/plugin-hmr": patch
---

修复 1.0.5 / 1.0.6 / 1.0.3 发布产物的 dependencies 残留 `workspace:*` 协议问题（2026-08-31 事故：该波发布绕过了发布链的 workspace 协议改写环，三个版本原样带上 npm，下游 `bun install` 直接报 "Workspace dependency not found"）。本版本经发布链正确改写后重新发布以覆盖 latest；发布链已加终局断言（改写后依赖字段不得残留 workspace:/file:/link:）与 `--only` 精确重发能力，杜绝再犯。
