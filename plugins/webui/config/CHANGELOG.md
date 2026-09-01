# @koishi-ce/plugin-config

## 1.0.7

### Patch Changes

- d1329eb: fix(market,config): 修复安装弹窗版本键越界解构报错与上游名 peer「依赖未满足」误报
  
  - market 安装弹窗的 result computed 在版本号来自 override 暂存或依赖 range（非精确版本号）时对 `data.value[version.value]` 直接解构，控制台抛 `Cannot destructure property 'result'`——改为可选链兜底，查不到按未定级处理；showRemoveButton 同步补 `store.dependencies?.` 可选链
  - config 的 getEnvInfo 对 peer 上游名（如社区插件声明的 `@koishijs/plugin-console`）按字面名直查 store.packages，被 shim / npm alias 占名时必然查不到而误报「必需依赖 (点击添加)」——新增 resolveProvider 归一：字面名查不到时回退 `@koishi-ce/plugin-*` 再分发名，coreDeps 判定与已加载态均按归一结果；market 的 dep-link 同规则内联（避免跨插件值引入整份 config 前端），点击目标跟随归一名

## 1.0.6

### Patch Changes

- 4298163: 修复 1.0.5 / 1.0.6 / 1.0.3 发布产物的 dependencies 残留 `workspace:*` 协议问题（2026-08-31 事故：该波发布绕过了发布链的 workspace 协议改写环，三个版本原样带上 npm，下游 `bun install` 直接报 "Workspace dependency not found"）。本版本经发布链正确改写后重新发布以覆盖 latest；发布链已加终局断言（改写后依赖字段不得残留 workspace:/file:/link:）与 `--only` 精确重发能力，杜绝再犯。

## 1.0.5

### Patch Changes

- 6f77b35: 修复市场装完插件同进程解析失败（Bun 父目录快照缓存），并为 console / core / loader 三个上游 peer 名新增占位 shim
  
  根因实证：Bun 对失败的解析按「父目录快照」做进程内缓存——解析失败时只要包的直接父目录（node_modules 或 node_modules/@scope）已存在，该目录内容列表即被缓存，包落盘后同进程内该包任何形态、任何解析 API（createRequire.resolve / Bun.resolveSync）都永久失败（生产装完插件报 failed to resolve / cannot resolve plugin、重启即消的原因；开发环境因依赖已在 node_modules 而无法复现）。
  
  - registry：resolvePackageJson 改为全程纯 fs 探测（装前探测零解析 API 调用，消除污染源），isResidentInCache 下沉至本包供 config / market 共用；LocalScanner 跳过带 upstreamShim 标记的占位包
  - loader：resolvePlugin 对裸名候选在 Bun.resolveSync 失败后纯 fs 沿 node_modules 链定位包目录、按 manifest（bun→require→node→default 条件序）计算入口绝对路径——require 绝对路径不受快照影响，装完插件无需重启即可加载
  - config：parsePackage 驻留判断弃用裸名 require.resolve（负缓存假警源），改用 isResidentInCache
  - market：installer 改用下沉后的 isResidentInCache
  - create-koishi-ce 模板：新增三行 npm alias——@koishijs/plugin-console → @koishi-ce/console-shim@^5.30.11、@koishijs/core → @koishi-ce/core-shim@4.18.11（loader peer 精确锁，不带 ^）、@koishijs/loader → @koishi-ce/loader-shim@^4.6.11；无占位时 Bun 的 peer 自动安装会把 npm 官方 console / core / loader 全家桶拉进下游实例形成双实例
  
  注意：@koishi-ce/console-shim、@koishi-ce/core-shim、@koishi-ce/loader-shim 为新包（在 changesets ignore 中，版本冻结），发布须先于本版 create-koishi-ce，否则下游安装 alias 解析不到。
- Updated dependencies [6f77b35]
  - @koishi-ce/registry@1.0.4
  - @koishi-ce/loader@1.0.3
  - @koishijs/loader@4.6.11
  - koishi@4.18.11
  - @koishijs/plugin-console@5.30.11

## 1.0.4

### Patch Changes

- Updated dependencies [bcfbe4e]
  - @koishi-ce/loader@1.0.2
  - koishi@4.18.11

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
