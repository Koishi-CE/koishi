---
"@koishi-ce/plugin-welcome": patch
---

开屏动画的 lottie-web 入口由 `lottie_svg.min.js`（SVG 渲染器 + AE 表达式引擎）换为更小的 `lottie_light.min.js`（仅 SVG 渲染器，无表达式引擎）：本插件动画数据零表达式，用不到求值器，前端产物 250.5 KB → 178.4 KB（−29%）；产物同时不再含 `eval`，配套删除仅为静音 `[EVAL]` 构建警告而加的 `build/client.ts` 覆盖。
