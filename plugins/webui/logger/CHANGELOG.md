# @koishi-ce/plugin-logger

## 1.1.0

### Minor Changes

- f66c005: i18n: 清剿存量假翻译并新增词典检查工具
  
  - broadcast / callme / echo / help / hmr / admin / logger / status 及 core 的 prompt-argument、commands.$ 等非中文语种中的上游中文占位全部替换为真翻译（含 ja-JP 残留）
  - 新增 `bun tooling/check-locales.ts`：以 zh-CN 为基准检查全仓词典的键对齐、语种齐全与假翻译（market 等上游再分发目录按约定跳过/豁免），当前零报警

### Patch Changes

- Updated dependencies [bac9f1d]
  - @koishi-ce/plugin-console@1.1.0
  - @koishi-ce/koishi@1.0.8

## 1.0.2

### Patch Changes

- 随前端构建钉死剥离 Vue 模板注释（@koishi-ce/client 1.0.4）重建前端产物：上述插件的存量 npm 产物里，模板根元素前带注释的组件（侧栏 activity 图标、文件树 / 登录表单图标等）被烘焙成多根 fragment，宿主传入的 class 透传不进去——侧栏图标缩水（24px 落回 16px）即此因。重构建后产物恢复单根语义，下游更新即修复。

## 1.0.1

### Patch Changes

- 8b081a7: knip 全仓清理：修真问题、配准误报。
  
  - 修复前端构建覆盖配置从未接线的问题：`koishi-console build` 现在会显式加载插件自带的 `build/client.ts` 并合并进 vite 配置（vite 不会自动发现该文件名），analytics 的 "fuck-echarts" Symbol 遮蔽修补自此真正生效，其 dist 已重建验证；explorer 的 monaco manualChunks 覆盖已删除（rolldown 自动分包已实现其目标且粒度更优）。
  - 修复 plugin-hmr 在无 `koishi` 裸名残留链接的环境下启动即崩的问题：框架依赖集的解析锚点由 `require.resolve("koishi")` 改为 `require.resolve("@koishi-ce/koishi")`（后者是其 peer 依赖，必然可解析）。
  - 依赖卫生：移除 11 处声明而未用的依赖（含 cli 的 `@satorijs/core`、actions/oobe/theme-vanilla 的 `@koishi-ce/console` 等）；为仅被类型引用或前端源码引用的包补齐 20 余处缺失声明（`vue` / `vue-router` / `@vueuse/core` / `element-plus` / `vite` 及各 `@koishi-ce/*` 类型借用）。
  - 死代码清理：sandbox node 侧无人消费的 `words` 昵称表、若干仅为模块内部使用却导出的符号与接口改为私有。
  - 新增根级 `knip.json`：登记前端构建入口与 cordis 插件双导出惯例等误报豁免，`bunx knip` 输出收敛至零（测试文件的 unlisted 依赖另行处理中）。
- Updated dependencies [8b081a7]
  - @koishi-ce/koishi@1.0.4
  - @koishi-ce/plugin-console@1.0.3
