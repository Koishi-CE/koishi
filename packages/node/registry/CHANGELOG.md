# @koishi-ce/registry

## 1.0.2

### Patch Changes

- 0623265: 修复 Bun 运行时下市场装完插件无法加载的问题：Bun 对失败解析按 specifier 做进程内负缓存，安装流程在包落盘前的 `pkg/package.json` 形态探测（必然失败）会让此后同进程内的清单读取永久失败，表现为插件装完仍显示「尚未安装」并报 failed to resolve。registry 新增 `resolvePackageJson()` 以裸名解析兜底绕开负缓存，market 与 registry 的清单读取统一接入；market 安装器的 `override()` 改为现读现写根 package.json（不再基于启动快照整体重写抹掉外部变更），并对 `workspace:` 依赖声明加不可覆盖/删除护栏（保护 `koishi` 裸名 shim 的归属，防止 npm 官方 koishi 被写回根依赖），写出格式对齐 biome（tab 缩进）。

## 1.0.1

### Patch Changes

- 36c316b: 修复配置页全部插件显示「此插件尚未安装」：webui 插件名解析适配相对路径键与 workspace 包
  
  本仓库 koishi.yml 的插件键统一为相对路径（`./plugins/...`），而 Bun 不会把未被依赖的 workspace 包链入 node_modules，导致配置页的插件名反查（短名 → 完整包名）对全部插件失效，右侧面板一律显示「此插件尚未安装」。
  
  - `@koishi-ce/registry`：`LocalScanner` 短名剥离兼容 `@koishi-ce` 作用域（导出 `getPluginShortname`），新增 `loadPath(dir)` 按目录加载未链入 node_modules 的源码包
  - `@koishi-ce/plugin-config`：服务端收集时按 loader 配置键补齐 workspace 源码包，并在 `packages` 数据中携带 `paths`（配置键 → 包名映射）；运行时缓存查找与 `config/request-runtime` 解析均兼容路径键
  - 客户端 `getFullName` 支持 `./` 路径键按 `paths` 精确匹配，裸短名候选补入 `@koishi-ce/plugin-*`；核心插件保护（`hasCoreDeps`）同步适配路径键
