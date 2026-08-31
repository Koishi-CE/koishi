# @koishi-ce/plugin-config

## 1.0.3

### Patch Changes

- Updated dependencies [f16283b]
  - @koishi-ce/registry@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [0623265]
  - @koishi-ce/registry@1.0.2

## 1.0.1

### Patch Changes

- 6e6be22: 修正前端入口注册的 `__dirname` 相对路径：本文件位于 `src/node`（两层），打包后位于 `lib`（一层），按源码深度写的 `../../dist` / `../../client` 在产物中解析到错误目录，导致生产模式下插件前端资源 404。
- 36c316b: 修复配置页全部插件显示「此插件尚未安装」：webui 插件名解析适配相对路径键与 workspace 包
  
  本仓库 koishi.yml 的插件键统一为相对路径（`./plugins/...`），而 Bun 不会把未被依赖的 workspace 包链入 node_modules，导致配置页的插件名反查（短名 → 完整包名）对全部插件失效，右侧面板一律显示「此插件尚未安装」。
  
  - `@koishi-ce/registry`：`LocalScanner` 短名剥离兼容 `@koishi-ce` 作用域（导出 `getPluginShortname`），新增 `loadPath(dir)` 按目录加载未链入 node_modules 的源码包
  - `@koishi-ce/plugin-config`：服务端收集时按 loader 配置键补齐 workspace 源码包，并在 `packages` 数据中携带 `paths`（配置键 → 包名映射）；运行时缓存查找与 `config/request-runtime` 解析均兼容路径键
  - 客户端 `getFullName` 支持 `./` 路径键按 `paths` 精确匹配，裸短名候选补入 `@koishi-ce/plugin-*`；核心插件保护（`hasCoreDeps`）同步适配路径键
- Updated dependencies [c9f7ef5]
- Updated dependencies [36c316b]
  - @koishi-ce/loader@1.0.1
  - @koishi-ce/registry@1.0.1
