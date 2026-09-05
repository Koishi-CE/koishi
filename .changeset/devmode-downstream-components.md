---
"@koishi-ce/components": patch
---

client/tsconfig.json 就地声明 baseUrl 与 "schemastery-vue/client" 的 paths：compiler-sfc 解析 .vue 外部导入类型时以发起文件为起点向上找 tsconfig.json，下游没有仓库级配置、此前 extends 断链后 paths 丢失，dev 模式下编译 defineProps&lt;ActiveMenu&gt; 等跨包外部类型链时报 Failed to resolve import source。
