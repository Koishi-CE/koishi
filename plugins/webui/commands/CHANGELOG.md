# @koishi-ce/plugin-commands

## 1.0.4

### Patch Changes

- e537fa2: fallow 审计收敛：断掉 core 最后一处循环依赖并收敛重复代码样板（1024 → 357 行）。
  
  - core：runtime.ts 的 `Service.setup` 经新增的 context 工厂槽（`context/factory.ts`）创建 root Context，消除 context/index.ts ↔ runtime.ts 模块环，公共 API 不变。
  - console（核心包）：新增 `clientEntry` 导出——插件向控制台注册前端产物的三环境路径样板（KOISHI_BASE 部署 / browser 构建 / 本地 dev-prod），各 webui 插件入口的三分支复制统一改为一行调用。
  - client：新增 `extendLocales`（插件前端入口的七语种词典批量注入，配合 `import.meta.glob` 收敛 import+extend 样板）与 `scrollActiveTree`（keep-alive 页面重激活时把 el-tree 激活节点滚到可视中央）。
  - loader：公共导出 `insertKey` / `rename`（键顺序保持式改名工具），config 插件 writer 复用之。
  - utils：新增 npm-registry 模块（`getLocalRegistry` / `readNpmrcRegistry` / `NPM_OFFICIAL_REGISTRY`），create-koishi-ce 与 market 的本机 registry 探测共享同一实现。
  - config：manager/* 事件签名收敛到 `src/shared/console-events.ts` 唯一定义（node 与浏览器两端声明合并经 extends 引用）；global/group 设置面板的 modelValue 代理改用 `defineModel`。
  - admin/sandbox/sqlite/check-docs-links：对称逻辑（用户组加入与移出、方向键历史回溯、`_all`/`_get` 读取原语、链接检查循环）就近抽取共享实现。
- Updated dependencies [e537fa2]
  - @koishi-ce/console@1.1.0
  - @koishi-ce/plugin-console@1.3.4
  - @koishi-ce/koishi@1.0.16

## 1.0.3

### Patch Changes

- Updated dependencies [412c225]
  - @koishi-ce/console@1.0.1
  - @koishi-ce/plugin-console@1.3.3
  - @koishi-ce/koishi@1.0.15

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
