---
"@koishi-ce/plugin-market": patch
---

market 节点侧词典目录自 `src/node/locales` 移至包根 `locales`，对齐全仓其余 28 个词典目录的惯例；运行时产物零变化（lib/assets 哈希文件名与内容均不变），npm 包内不再随 src 重复携带词典。顺带修复 check-locales 对 d8ce130 引入的 client/vendor/market/locales（上游 vendor、仅 zh-CN）的存量误报。
