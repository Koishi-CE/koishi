# create-koishi-ce

## 1.2.1

### Patch Changes

- 4298163: 模板的上游名 npm alias 收敛为两包四名：`@koishijs/core` 与 `@koishijs/loader` 两行 alias 改指 `@koishi-ce/koishi-shim`（`@koishi-ce/koishi` 是 core + loader 的合并再导出、与上游 koishi 主包同构，named 导出全覆盖），不再引用已废弃的 `@koishi-ce/core-shim` / `@koishi-ce/loader-shim`；模板 README 同步更新。shim 体系同步重组：workspace 占位与发布 shim 统一迁入 `packages/shim/`，`packages/node/` 恢复纯功能包职责。

## 1.2.0

### Minor Changes

- 6f77b35: 修复市场装完插件同进程解析失败（Bun 父目录快照缓存），并为 console / core / loader 三个上游 peer 名新增占位 shim
  
  根因实证：Bun 对失败的解析按「父目录快照」做进程内缓存——解析失败时只要包的直接父目录（node_modules 或 node_modules/@scope）已存在，该目录内容列表即被缓存，包落盘后同进程内该包任何形态、任何解析 API（createRequire.resolve / Bun.resolveSync）都永久失败（生产装完插件报 failed to resolve / cannot resolve plugin、重启即消的原因；开发环境因依赖已在 node_modules 而无法复现）。
  
  - registry：resolvePackageJson 改为全程纯 fs 探测（装前探测零解析 API 调用，消除污染源），isResidentInCache 下沉至本包供 config / market 共用；LocalScanner 跳过带 upstreamShim 标记的占位包
  - loader：resolvePlugin 对裸名候选在 Bun.resolveSync 失败后纯 fs 沿 node_modules 链定位包目录、按 manifest（bun→require→node→default 条件序）计算入口绝对路径——require 绝对路径不受快照影响，装完插件无需重启即可加载
  - config：parsePackage 驻留判断弃用裸名 require.resolve（负缓存假警源），改用 isResidentInCache
  - market：installer 改用下沉后的 isResidentInCache
  - create-koishi-ce 模板：新增三行 npm alias——@koishijs/plugin-console → @koishi-ce/console-shim@^5.30.11、@koishijs/core → @koishi-ce/core-shim@4.18.11（loader peer 精确锁，不带 ^）、@koishijs/loader → @koishi-ce/loader-shim@^4.6.11；无占位时 Bun 的 peer 自动安装会把 npm 官方 console / core / loader 全家桶拉进下游实例形成双实例
  
  注意：@koishi-ce/console-shim、@koishi-ce/core-shim、@koishi-ce/loader-shim 为新包（在 changesets ignore 中，版本冻结），发布须先于本版 create-koishi-ce，否则下游安装 alias 解析不到。

## 1.1.0

### Minor Changes

- 770d611: 修复 create-koishi-ce 生成全官方生态项目的根本缺陷：默认模板此前直接下载上游官方 @koishijs/boilerplate 解包，产物依赖全是 npm 官方包（koishi / @koishijs/*，559 包），完全绕开 @koishi-ce 再分发生态，且官方 market 在 Bun 下因 get-registry 依赖直接崩溃。默认模板改为内置的纯 @koishi-ce 依赖集（Bun 运行时、预配 registry.koishi.chat 市场镜像源、不预装本仓无再分发的 adapter / database，官方版可后续从市场安装）；--template 保留为远程模板逃生舱。配套新增 @koishi-ce/koishi-shim（版本冻结 4.18.x 线，不随 changesets 演进），模板以 npm alias "koishi": "npm:@koishi-ce/koishi-shim@^4.18.11" 钉住上游裸名——上游官方插件与社区 koishi-plugin-* 的 peer `koishi ^4.x` 由此满足，市场安装不再拉入 npm 官方 koishi 形成第二份框架副本。plugin-market：安装清单护栏扩展，npm:@koishi-ce alias 声明与 workspace: 声明同等不可覆盖/删除。

## 1.0.1

### Patch Changes

- cab5689: 修复 `bunx create-koishi-ce` 在 Bun 运行时下 registry 探测崩溃（子进程退出码 1 导致脚手架中断）：既有实现按 user-agent 派生探测命令，bun 场景下执行不存在的 `bun config get registry` 后非 npm 分支直接 reject。现移除 `get-registry` 依赖，改为零子进程的原生探测——依次读环境变量 `npm_config_registry` → 项目 `.npmrc` → 用户 `~/.npmrc`，取首个合法 http(s) 地址，任何一步拿不到都静默回落官方源，探测路径不再可能打断主流程。
