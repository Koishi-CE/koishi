---
"@koishi-ce/client": patch
"@koishi-ce/plugin-console": patch
---

修复下游 devMode 黑屏：reggol 未进 Vite 依赖预打包，其 browser 入口 external 的 CJS 依赖 object-inspect 在浏览器裸 ESM 导入报「does not provide an export named 'default'」，现将 reggol 加入 optimizeDeps.include
