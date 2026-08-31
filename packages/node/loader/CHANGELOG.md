# @koishi-ce/loader

## 1.0.3

### Patch Changes

- 6f77b35: 修复市场装完插件同进程解析失败（Bun 父目录快照缓存），并为 console / core / loader 三个上游 peer 名新增占位 shim
  
  根因实证：Bun 对失败的解析按「父目录快照」做进程内缓存——解析失败时只要包的直接父目录（node_modules 或 node_modules/@scope）已存在，该目录内容列表即被缓存，包落盘后同进程内该包任何形态、任何解析 API（createRequire.resolve / Bun.resolveSync）都永久失败（生产装完插件报 failed to resolve / cannot resolve plugin、重启即消的原因；开发环境因依赖已在 node_modules 而无法复现）。
  
  - registry：resolvePackageJson 改为全程纯 fs 探测（装前探测零解析 API 调用，消除污染源），isResidentInCache 下沉至本包供 config / market 共用；LocalScanner 跳过带 upstreamShim 标记的占位包
  - loader：resolvePlugin 对裸名候选在 Bun.resolveSync 失败后纯 fs 沿 node_modules 链定位包目录、按 manifest（bun→require→node→default 条件序）计算入口绝对路径——require 绝对路径不受快照影响，装完插件无需重启即可加载
  - config：parsePackage 驻留判断弃用裸名 require.resolve（负缓存假警源），改用 isResidentInCache
  - market：installer 改用下沉后的 isResidentInCache
  - create-koishi-ce 模板：新增三行 npm alias——@koishijs/plugin-console → @koishi-ce/console-shim@^5.30.11、@koishijs/core → @koishi-ce/core-shim@4.18.11（loader peer 精确锁，不带 ^）、@koishijs/loader → @koishi-ce/loader-shim@^4.6.11；无占位时 Bun 的 peer 自动安装会把 npm 官方 console / core / loader 全家桶拉进下游实例形成双实例
  
  注意：@koishi-ce/console-shim、@koishi-ce/core-shim、@koishi-ce/loader-shim 为新包（在 changesets ignore 中，版本冻结），发布须先于本版 create-koishi-ce，否则下游安装 alias 解析不到。
- @koishijs/core@4.18.11

## 1.0.2

### Patch Changes

- bcfbe4e: 修复 Bun 运行时下市场安装上游插件的两大报错：postgres 等「exports 带 `bun` 条件指向 ESM」的包被上游 CJS 驱动链 require 到 ESM namespace，esbuild 的 `__toESM(mod, 1)` interop 无条件把整个 namespace 当 default，`@minatojs/driver-postgres` 据此抛 "is not a function ... is an instance of Module"——loader 现于加载插件前遍历其依赖树，对「Bun require 实际命中入口 ≠ Node require 语义入口」的包把后者预置进 `require.cache`（无分歧零副作用，ESM import 侧不受影响）；market 安装器装完插件报 `ResolveMessage: Cannot find module`（Bun 负缓存污染裸名）的旧版本驻留判定改走 resolvePackageJson + require.cache 目录前缀扫描。

## 1.0.1

### Patch Changes

- c9f7ef5: worker 启动流程新增端口预检：应用创建前探测 server 插件声明的端口区间（按包名识别，覆盖 vendored 包与上下游命名），全部被占时只输出一行提示并以退出码 1 干净退出——此前绑定失败会以 cordis 错误事件触发依赖 server 服务的全部插件连锁 dispose，刷出大片堆栈噪音。loader 顺势导出 `resolvePlugin` / `pluginCandidates` 供 worker 复用插件解析。
