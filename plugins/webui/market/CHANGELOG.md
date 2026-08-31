# @koishi-ce/plugin-market

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
