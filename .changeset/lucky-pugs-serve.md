---
"@koishi-ce/plugin-console": patch
---

修复 `@plugin-*` 静态产物路由对 workspace 目录布局的插件一律 403：路径越界判定改以各 entry 自身声明的产物路径为基准（上游以 console root / node_modules 为白名单，前提是插件装在 node_modules 下，本仓库插件位于 `plugins/**` 不满足），同时移除 node_modules 兜底以消除穿越漏洞。
