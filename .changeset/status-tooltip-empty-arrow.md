---
"@koishi-ce/client": patch
"@koishi-ce/plugin-console": patch
---

修复状态栏空内容 tooltip 悬停残留箭头黑菱形：空占位标记嵌在 el-scrollbar 内层与弹层箭头节点不平级，原相邻选择器永远匹配不上，改用 `:has()` 在无内容时整体隐藏弹层（同时惠及所有不传 tooltip 插槽的 k-status 使用方）。
