---
"@koishi-ce/plugin-welcome": patch
---

前端构建新增 `build/client.ts` 覆盖，静音 rolldown 对 lottie-web AE 表达式求值器的 [EVAL] 构建警告（该 eval 系上游固有能力，本插件只加载内置 splash.json，分支实际不可达）；产物无变化。
