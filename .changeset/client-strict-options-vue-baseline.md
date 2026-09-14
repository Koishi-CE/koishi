---
"@koishi-ce/plugin-auth": patch
"@koishi-ce/plugin-config": patch
"@koishi-ce/plugin-dataview": patch
"@koishi-ce/plugin-market": patch
"@koishi-ce/plugin-status": patch
---

client 侧 tsconfig 严格选项对齐 node 侧（补 noPropertyAccessFromIndexSignature / noUnusedLocals / noUnusedParameters / noImplicitReturns / noFallthroughCasesInSwitch / noImplicitOverride / allowUnreachableCode / allowUnusedLabels 八项），并修复由此暴露的存量类型错误（未用导入、缺失返回路径、switch 贯穿与索引签名属性访问）；另新增 check:vue-types 影子基线闸门（vue-tsc 全量快照只拦新增）。
