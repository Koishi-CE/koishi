# @koishi-ce/plugin-market

## 1.0.11

### Patch Changes

- 随前端构建钉死剥离 Vue 模板注释（@koishi-ce/client 1.0.4）重建前端产物：上述插件的存量 npm 产物里，模板根元素前带注释的组件（侧栏 activity 图标、文件树 / 登录表单图标等）被烘焙成多根 fragment，宿主传入的 class 透传不进去——侧栏图标缩水（24px 落回 16px）即此因。重构建后产物恢复单根语义，下游更新即修复。

## 1.0.10

### Patch Changes

- 7613c69: config 与 market 插件把 `ctx.loader` 声明为非必需注入（生产环境 loader 由宿主以 builtin 服务提供、恒存在）：此前未声明 inject，裸 App 环境（如测试）装配时会刷 cordis 的 `property loader is not registered` 警告。
- @koishi-ce/koishi@1.0.5
  - @koishi-ce/plugin-console@1.0.3

## 1.0.9

### Patch Changes

- 8b081a7: knip 全仓清理：修真问题、配准误报。
  
  - 修复前端构建覆盖配置从未接线的问题：`koishi-console build` 现在会显式加载插件自带的 `build/client.ts` 并合并进 vite 配置（vite 不会自动发现该文件名），analytics 的 "fuck-echarts" Symbol 遮蔽修补自此真正生效，其 dist 已重建验证；explorer 的 monaco manualChunks 覆盖已删除（rolldown 自动分包已实现其目标且粒度更优）。
  - 修复 plugin-hmr 在无 `koishi` 裸名残留链接的环境下启动即崩的问题：框架依赖集的解析锚点由 `require.resolve("koishi")` 改为 `require.resolve("@koishi-ce/koishi")`（后者是其 peer 依赖，必然可解析）。
  - 依赖卫生：移除 11 处声明而未用的依赖（含 cli 的 `@satorijs/core`、actions/oobe/theme-vanilla 的 `@koishi-ce/console` 等）；为仅被类型引用或前端源码引用的包补齐 20 余处缺失声明（`vue` / `vue-router` / `@vueuse/core` / `element-plus` / `vite` 及各 `@koishi-ce/*` 类型借用）。
  - 死代码清理：sandbox node 侧无人消费的 `words` 昵称表、若干仅为模块内部使用却导出的符号与接口改为私有。
  - 新增根级 `knip.json`：登记前端构建入口与 cordis 插件双导出惯例等误报豁免，`bunx knip` 输出收敛至零（测试文件的 unlisted 依赖另行处理中）。
- Updated dependencies [8b081a7]
- Updated dependencies [f63650b]
  - @koishi-ce/koishi@1.0.4
  - @koishi-ce/plugin-console@1.0.3
  - @koishi-ce/registry@1.0.5

## 1.0.8

### Patch Changes

- d1329eb: fix(market,config): 修复安装弹窗版本键越界解构报错与上游名 peer「依赖未满足」误报
  
  - market 安装弹窗的 result computed 在版本号来自 override 暂存或依赖 range（非精确版本号）时对 `data.value[version.value]` 直接解构，控制台抛 `Cannot destructure property 'result'`——改为可选链兜底，查不到按未定级处理；showRemoveButton 同步补 `store.dependencies?.` 可选链
  - config 的 getEnvInfo 对 peer 上游名（如社区插件声明的 `@koishijs/plugin-console`）按字面名直查 store.packages，被 shim / npm alias 占名时必然查不到而误报「必需依赖 (点击添加)」——新增 resolveProvider 归一：字面名查不到时回退 `@koishi-ce/plugin-*` 再分发名，coreDeps 判定与已加载态均按归一结果；market 的 dep-link 同规则内联（避免跨插件值引入整份 config 前端），点击目标跟随归一名

## 1.0.7

### Patch Changes

- 4298163: 修复 1.0.5 / 1.0.6 / 1.0.3 发布产物的 dependencies 残留 `workspace:*` 协议问题（2026-08-31 事故：该波发布绕过了发布链的 workspace 协议改写环，三个版本原样带上 npm，下游 `bun install` 直接报 "Workspace dependency not found"）。本版本经发布链正确改写后重新发布以覆盖 latest；发布链已加终局断言（改写后依赖字段不得残留 workspace:/file:/link:）与 `--only` 精确重发能力，杜绝再犯。

## 1.0.6

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
  - koishi@4.18.11
  - @koishijs/plugin-console@5.30.11

## 1.0.5

### Patch Changes

- bcfbe4e: 修复 Bun 运行时下市场安装上游插件的两大报错：postgres 等「exports 带 `bun` 条件指向 ESM」的包被上游 CJS 驱动链 require 到 ESM namespace，esbuild 的 `__toESM(mod, 1)` interop 无条件把整个 namespace 当 default，`@minatojs/driver-postgres` 据此抛 "is not a function ... is an instance of Module"——loader 现于加载插件前遍历其依赖树，对「Bun require 实际命中入口 ≠ Node require 语义入口」的包把后者预置进 `require.cache`（无分歧零副作用，ESM import 侧不受影响）；market 安装器装完插件报 `ResolveMessage: Cannot find module`（Bun 负缓存污染裸名）的旧版本驻留判定改走 resolvePackageJson + require.cache 目录前缀扫描。
- koishi@4.18.11

## 1.0.4

### Patch Changes

- 770d611: 修复 create-koishi-ce 生成全官方生态项目的根本缺陷：默认模板此前直接下载上游官方 @koishijs/boilerplate 解包，产物依赖全是 npm 官方包（koishi / @koishijs/*，559 包），完全绕开 @koishi-ce 再分发生态，且官方 market 在 Bun 下因 get-registry 依赖直接崩溃。默认模板改为内置的纯 @koishi-ce 依赖集（Bun 运行时、预配 registry.koishi.chat 市场镜像源、不预装本仓无再分发的 adapter / database，官方版可后续从市场安装）；--template 保留为远程模板逃生舱。配套新增 @koishi-ce/koishi-shim（版本冻结 4.18.x 线，不随 changesets 演进），模板以 npm alias "koishi": "npm:@koishi-ce/koishi-shim@^4.18.11" 钉住上游裸名——上游官方插件与社区 koishi-plugin-* 的 peer `koishi ^4.x` 由此满足，市场安装不再拉入 npm 官方 koishi 形成第二份框架副本。plugin-market：安装清单护栏扩展，npm:@koishi-ce alias 声明与 workspace: 声明同等不可覆盖/删除。
- Updated dependencies [f16283b]
  - @koishi-ce/registry@1.0.3

## 1.0.3

### Patch Changes

- 0623265: 修复 Bun 运行时下市场装完插件无法加载的问题：Bun 对失败解析按 specifier 做进程内负缓存，安装流程在包落盘前的 `pkg/package.json` 形态探测（必然失败）会让此后同进程内的清单读取永久失败，表现为插件装完仍显示「尚未安装」并报 failed to resolve。registry 新增 `resolvePackageJson()` 以裸名解析兜底绕开负缓存，market 与 registry 的清单读取统一接入；market 安装器的 `override()` 改为现读现写根 package.json（不再基于启动快照整体重写抹掉外部变更），并对 `workspace:` 依赖声明加不可覆盖/删除护栏（保护 `koishi` 裸名 shim 的归属，防止 npm 官方 koishi 被写回根依赖），写出格式对齐 biome（tab 缩进）。
- Updated dependencies [0623265]
  - @koishi-ce/registry@1.0.2

## 1.0.2

### Patch Changes

- a772c44: 修复 Bun 运行时下 webui 长时间转圈无法加载的问题：hmr 的 chokidar 在 win32 上以反斜杠原生路径调用匹配器，glob 形式的 ignored 完全失效，导致巨型 node_modules 被完整遍历（每秒数万条目、持续数分钟），事件循环被 IO 回调风暴挤压，server 的 HTTP 请求 72 秒以上无响应——现将「双星通配包裹目录名」的忽略规则编译为目录段剪枝函数，目录命中即整树剪枝（实测初始扫描从 99 秒未就绪降到 267ms）。另修复 market 两处启动报错：Scanner 构造裸取 registry.get 丢失 this 抛 TypeError（包一层箭头函数保持绑定）；本机 npmrc 无 registry 配置时 endpoint 无默认回落，相对 URL 在 resolveURL 抛 Invalid URL（回落 npm 官方源，对齐被移除的 get-registry 默认值）。
- c581b88: 修复 npm 源限流导致市场数据刷新整体失败：registry 搜索接口（/-/v1/search）对无认证请求有速率限制，超频返回 429 时 collect 首页搜索直接抛错，被 prepare 捕获置 _error，市场页面整体清空。现对 429 / 408 / 5xx 这类可重试错误做退避重试（优先遵循 Retry-After 响应头，缺省按 1s 起指数退避，最多重试 2 次），市场与安装器共用的请求包装一并生效。
- 6e6be22: 修正前端入口注册的 `__dirname` 相对路径：本文件位于 `src/node`（两层），打包后位于 `lib`（一层），按源码深度写的 `../../dist` / `../../client` 在产物中解析到错误目录，导致生产模式下插件前端资源 404。
- Updated dependencies [36c316b]
  - @koishi-ce/registry@1.0.1

## 1.0.1

### Patch Changes

- 44da00e: 修复 Bun 运行时下 market 服务启动崩溃：移除 get-registry 依赖，registry 探测改原生 npmrc 读取。get-registry 按 user-agent 选 `bun config get registry`，而 Bun 没有 config 子命令，子进程退出码 1 直接抛错打断 webui 加载；新实现按 环境变量 > 项目 .npmrc > 用户 ~/.npmrc 的优先级零子进程读取，与 cab5689 对 create-koishi-ce 的修复同源。
