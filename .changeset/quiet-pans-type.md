---
"@koishi-ce/components": patch
"@koishi-ce/console-app": patch
"@koishi-ce/plugin-admin": patch
"@koishi-ce/plugin-config": patch
"@koishi-ce/plugin-explorer": patch
"@koishi-ce/plugin-sandbox": patch
---

补全局组件与指令的类型声明（GlobalComponents / GlobalDirectives）：k-* 组件族、virtual-list 与 v-loading 此前无类型（vue-tsc 宽松放过），现经 vue 模块增强合并获得真实类型；随之修复暴露的模板类型错误（undefined 兜底、slot prop 收窄、k-tab 的 data 契约放宽数组形态），并断开 computed.vue 对 schemastery-vue 裸名的源码导入链（消除类型程序里的第三方源码噪音）。
