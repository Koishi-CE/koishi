---
"@koishi-ce/client": patch
---

单插件前端构建的 css 产物统一改名为 `style.css`（与上游约定及 console 服务端 `resolveEntry` 的探测逻辑对齐，此前产出的 `index.css` 从未被下发，插件页面缺样式）。
