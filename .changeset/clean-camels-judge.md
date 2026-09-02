---
"@koishi-ce/client": patch
"@koishi-ce/koishi": patch
"@koishi-ce/assets": patch
"@koishi-ce/components": patch
"@koishi-ce/plugin-hmr": patch
"@koishi-ce/plugin-analytics": patch
"@koishi-ce/plugin-sandbox": patch
"@koishi-ce/plugin-actions": patch
"@koishi-ce/plugin-admin": patch
"@koishi-ce/plugin-auth": patch
"@koishi-ce/plugin-commands": patch
"@koishi-ce/plugin-config": patch
"@koishi-ce/plugin-console": patch
"@koishi-ce/plugin-explorer": patch
"@koishi-ce/plugin-insight": patch
"@koishi-ce/plugin-locales": patch
"@koishi-ce/plugin-logger": patch
"@koishi-ce/plugin-market": patch
"@koishi-ce/plugin-notifier": patch
"@koishi-ce/plugin-oobe": patch
"@koishi-ce/plugin-status": patch
"@koishi-ce/plugin-theme-vanilla": patch
---

knip 全仓清理：修真问题、配准误报。

- 修复前端构建覆盖配置从未接线的问题：`koishi-console build` 现在会显式加载插件自带的 `build/client.ts` 并合并进 vite 配置（vite 不会自动发现该文件名），analytics 的 "fuck-echarts" Symbol 遮蔽修补自此真正生效，其 dist 已重建验证；explorer 的 monaco manualChunks 覆盖已删除（rolldown 自动分包已实现其目标且粒度更优）。
- 修复 plugin-hmr 在无 `koishi` 裸名残留链接的环境下启动即崩的问题：框架依赖集的解析锚点由 `require.resolve("koishi")` 改为 `require.resolve("@koishi-ce/koishi")`（后者是其 peer 依赖，必然可解析）。
- 依赖卫生：移除 11 处声明而未用的依赖（含 cli 的 `@satorijs/core`、actions/oobe/theme-vanilla 的 `@koishi-ce/console` 等）；为仅被类型引用或前端源码引用的包补齐 20 余处缺失声明（`vue` / `vue-router` / `@vueuse/core` / `element-plus` / `vite` 及各 `@koishi-ce/*` 类型借用）。
- 死代码清理：sandbox node 侧无人消费的 `words` 昵称表、若干仅为模块内部使用却导出的符号与接口改为私有。
- 新增根级 `knip.json`：登记前端构建入口与 cordis 插件双导出惯例等误报豁免，`bunx knip` 输出收敛至零（测试文件的 unlisted 依赖另行处理中）。
