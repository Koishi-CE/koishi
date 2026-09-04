# @koishi-ce/loader

## 1.0.6

### Patch Changes

- f6c5088: 启动横幅标识由 `Koishi/版本` 改为 `Koishi-CE/版本`，并在交互终端下于启动时输出 KOISHI CE 字符画（非 TTY 环境自动跳过）。
- @koishi-ce/core@1.0.1

## 1.0.5

### Patch Changes

- 32d5593: 修复安装含内置模块同名 polyfill 依赖的插件（如 adapter-napuketto 经 readable-stream 引入 buffer/events/process）后插件加载即崩、控制台日志刷屏的问题：
  
  - loader：seedCjsInterop 对 `require.resolve` 返回裸名（内置模块解析结果）的依赖不再预置种子——此前 feross/buffer polyfill 被种进 `require.cache["buffer"]` 裸名键，全进程劫持内置 buffer 导出，pino → thread-stream 顶层取 `buffer.constants.MAX_STRING_LENGTH` 即抛 TypeError；
  - config：`config/request-runtime` 解析失败同样写入缓存（failed 标记随数据下发，前端据此展示失败提示并停止重发），同键并发解析合并为一次模块加载——此前「前端请求 → 解析失败不缓存 → 广播 → 前端再请求」互相喂养成活锁，加载即崩的插件会瞬间打爆日志。
- @koishi-ce/core@1.0.0

## 1.0.4

### Patch Changes

- f63650b: 修复三处被测试噪声掩盖的产品缺陷：
  
  - `createApp` 中 `provide("baseDir")` 被 cordis 3.18 构造器自带的 `baseDir = cwd()` 自有属性遮蔽，插件读到的 `ctx.baseDir` 恒为进程 cwd 而非配置文件目录；现改为在 provide 之前直接赋值（provide 之后该属性会被访问子接管、裸赋值失效）。
  - 根作用域停机/销毁期间，插件的批量卸载不再回写为 `~` 前缀键并触发写盘——此前该路径仅靠 logger 崩溃与 `process.exit` 抢在防抖落盘之前才未造成「整份配置被停用」的事故。
  - 插件生命周期日志（apply/unload/reload）在停机销毁期 logger 服务已释放时不再抛 TypeError。
- @koishi-ce/core@1.0.0

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
