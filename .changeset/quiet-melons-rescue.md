---
create-koishi-ce: patch
---

模板的上游名 npm alias 收敛为两包四名：`@koishijs/core` 与 `@koishijs/loader` 两行 alias 改指 `@koishi-ce/koishi-shim`（`@koishi-ce/koishi` 是 core + loader 的合并再导出、与上游 koishi 主包同构，named 导出全覆盖），不再引用已废弃的 `@koishi-ce/core-shim` / `@koishi-ce/loader-shim`；模板 README 同步更新。shim 体系同步重组：workspace 占位与发布 shim 统一迁入 `packages/shim/`，`packages/node/` 恢复纯功能包职责。
