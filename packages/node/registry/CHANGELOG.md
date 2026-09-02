# @koishi-ce/registry

## 1.0.5

### Patch Changes

- f63650b: `LocalScanner` 的清单解析锚点由进程 cwd 改为与扫描起点一致的 `baseDir`：宿主以非 cwd 启动时，此前会出现「扫到了却解析不到」的分裂。

## 1.0.4

### Patch Changes

- 6f77b35: 修复市场装完插件同进程解析失败（Bun 父目录快照缓存），并为 console / core / loader 三个上游 peer 名新增占位 shim
  
  根因实证：Bun 对失败的解析按「父目录快照」做进程内缓存——解析失败时只要包的直接父目录（node_modules 或 node_modules/@scope）已存在，该目录内容列表即被缓存，包落盘后同进程内该包任何形态、任何解析 API（createRequire.resolve / Bun.resolveSync）都永久失败（生产装完插件报 failed to resolve / cannot resolve plugin、重启即消的原因；开发环境因依赖已在 node_modules 而无法复现）。
  
  - registry：resolvePackageJson 改为全程纯 fs 探测（装前探测零解析 API 调用，消除污染源），isResidentInCache 下沉至本包供 config / market 共用；LocalScanner 跳过带 upstreamShim 标记的占位包
  - loader：resolvePlugin 对裸名候选在 Bun.resolveSync 失败后纯 fs 沿 node_modules 链定位包目录、按 manifest（bun→require→node→default 条件序）计算入口绝对路径——require 绝对路径不受快照影响，装完插件无需重启即可加载
  - config：parsePackage 驻留判断弃用裸名 require.resolve（负缓存假警源），改用 isResidentInCache
  - market：installer 改用下沉后的 isResidentInCache
  - create-koishi-ce 模板：新增三行 npm alias——@koishijs/plugin-console → @koishi-ce/console-shim@^5.30.11、@koishijs/core → @koishi-ce/core-shim@4.18.11（loader peer 精确锁，不带 ^）、@koishijs/loader → @koishi-ce/loader-shim@^4.6.11；无占位时 Bun 的 peer 自动安装会把 npm 官方 console / core / loader 全家桶拉进下游实例形成双实例
  
  注意：@koishi-ce/console-shim、@koishi-ce/core-shim、@koishi-ce/loader-shim 为新包（在 changesets ignore 中，版本冻结），发布须先于本版 create-koishi-ce，否则下游安装 alias 解析不到。

## 1.0.3

### Patch Changes

- f16283b: 修正 Bun 解析负缓存兜底的实现缺陷：此前在主路径（`pkg/package.json` 形态）失败后以裸名 `pkg` 解析兜底，但 Bun 对**任何形态**的失败解析都按 specifier 记进程内负缓存——安装流程落盘前的探测会把两种形态双双污染，装完后兜底同样失效（表现为市场装 database-postgres 后仍报 failed to resolve）。兜底改为纯 fs 探测：沿 node_modules 链逐级 `existsSync` 定位 package.json，不经过解析缓存、永不污染。

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
