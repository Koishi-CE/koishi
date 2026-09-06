---
"@koishi-ce/components": patch
"@koishi-ce/client": patch
---

修复下游 devMode 侧边栏空白：组件库入口的 cosmokit 直连 re-export 与 schemastery-vue 透传在浏览器端形成同名 conflicting star exports，全部 webui 插件前端加载失败。components 入口改为仅经 form 链单源透传 cosmokit（类型面由 "schemastery-vue/client" 的双载体同步补齐 re-export）；client 的 dev server 将 schemastery-vue（裸名与 /client 子路径）加入 optimizeDeps.exclude，消除预打包产出的第二份 cosmokit 实例与缺失产物引用。
