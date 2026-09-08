---
"@koishi-ce/scripts": patch
---

修复 `koishi-scripts build` 在宿主根 `packageManager` 钉 `bun@x` 时被 corepack 的 yarn/pnpm shim 拒绝执行（Unsupported package manager specification）的问题：external/ 子项目构建统一改用 `bun run build`（各项目自带 node_modules、build 脚本为纯净执行器，无需包管理器安装能力）。
