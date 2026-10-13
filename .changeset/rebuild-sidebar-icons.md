---
"@koishi-ce/plugin-console": patch
"@koishi-ce/plugin-market": patch
---

重新构建并发布控制台与插件市场前端，让已修复的 SVG 转换结果进入下游包内的 `dist`。此前单独发布构建器不会更新已发布插件包中的预构建前端，因此欢迎、插件市场和依赖管理入口仍可能加载旧图标产物。
