---
"@koishi-ce/client": patch
---

修复下游（npm 安装）实例 devMode 无法启动的三处根因：vite 依赖预打包会把宿主 TS 源码与 .yml 词典卷进 rolldown 预打包（.yml 被当 JS 解析，报 PARSE_ERROR ×7 与空 specifier），现经 optimizeDeps.exclude 显式排除宿主与组件库（工作区内两者靠工作区别名天然不进 optimizer，下游别名表为空才触发）；工作区别名缺席时 "schemastery-vue/client" 的运行时载体别名被推导为空串（resolve 直接报错），改为从本包向父级逐级 node_modules 纯 fs 探测（不走解析 API，防父目录快照缓存），探测失败省略该键；dev server 编译 .vue 的外部导入类型需要 compiler-sfc 加载 TypeScript，新增 dependencies typescript ^5.0.0（必须 5.x：npm latest 的 6.x 原生版缺 ts.sys，会报 No fs option）。
