# @koishi-ce/plugin-console

## 1.4.0

### Minor Changes

- f644c05: 拆分 `packages/web/client`：宿主 SPA 独立为 `@koishi-ce/console-app`，浏览器侧源码目录统一为 `src/`
  
  继 node 侧构建器（`@koishi-ce/console-builder`）之后，本次把 `packages/web/client` 的最后一块异质职责——**宿主 SPA 源码**（原 `app/` 子目录）——拆为独立包 `packages/web/app`（`@koishi-ce/console-app`）。`@koishi-ce/client` 由此收窄为纯粹的浏览器运行时库。同批将三处浏览器侧源码目录统一为 `src/`（全仓约定：包的源码一律 `src/`）。
  
  - `@koishi-ce/console-app`（新增，AGPL-3.0）：应用源码在 `src/`（`src/index.html` + `src/index.ts`），只发布源码、不走 tsdown。由宿主总装（构建期）与 devMode（运行期）以 `src/` 为 vite root 消费，**故必须可发布**——devMode 是面向下游用户的 console 配置项，运行期要在 npm 安装形态下找到这份源码。
  - `@koishi-ce/client`：`files` 改为 `src` + `global.d.ts`，描述改为「浏览器运行时库」。**包名、导出名与 `global.d.ts` 位置一律不变**，浏览器侧 API 零变更；源码目录 `client/` → `src/`（`main` / `exports` / 内部跳包相对导入同步），宿主 SPA 的发布节奏自此与库解耦（改首页布局不再牵动库版本号）。
  - `@koishi-ce/components`：源码目录 `client/` → `src/`（`main` / `exports` 同步）；顺带清掉 `files` 里从未存在的 `tsconfig.client.json` 死项（审计报告 §4.2 B5 已登记）。
  - `@koishi-ce/console-builder`：`locateApp()` 改为解析 `@koishi-ce/console-app` 的 `src/`（原为 `@koishi-ce/client` 下的 `app/` 子目录），并新增对该包的依赖；`collectWorkspaceAliases()` 对无入口的包跳过裸名映射（原实现会生成指向不存在目录的假路径），裸名对插件包仍优先落到 `client/index.ts`。总装与开发服务器两条链路照旧共用该定位点。
  - `@koishi-ce/plugin-console`：`devMode` 分支改为按包名解析 `@koishi-ce/console-app` 的 `src/`，新增其可选 peer 与 devDep（与既有 `@koishi-ce/client` 可选 peer 同形）；`files` 去掉从不存在的 `app` 死项。未开启 devMode 的部署不受影响。
  - `create-koishi-ce`：内置模板 devDependencies 预置 `@koishi-ce/console-app`，保证新项目开箱即用的 `devMode` 仍可用。
  - 顺带补齐 eslint 对宿主 SPA `.vue` 的覆盖（此前 glob 为 `packages/web/*/client/**`，`app/` 目录从未被 `lint:client` 检查），并修掉由此暴露的 4 处 `v-for` 缺 `key`——其中 `layout.vue` 的 `:key="menu"` 让同一列表的所有项共用同一个 key（非 `v-for` 变量），属真实反模式。
  
  **唯一不改名的例外**：`plugins/webui/*/client/`。该子路径（`@koishi-ce/plugin-config/client`）是插件生态跳包引用彼此的公开面，上游与 npm 产物均以它为准；`packages/web/{app,client,components}` 改名后与上游的文件名集合不再两两对应，`tooling/upstream-audit` 对这三个目录退化为单边清单（映射注记已同步），port 时按 `src/` → 上游 `client/`（或 `app/`）手工对位。
- 549520e: 拆分 `packages/web/client`：node 侧构建器独立为 `@koishi-ce/console-builder`
  
  `packages/web/client` 此前同时承载浏览器运行时库、宿主 SPA 源码、node 侧构建器与宿主总装脚本，四种职责共用一个版本号与一次发版。本次把其中 **node 侧**部分拆为独立包 `packages/web/builder`（`@koishi-ce/console-builder`），使浏览器运行时库不再连带拉入 vite / unocss / sass / typescript。
  
  - `@koishi-ce/console-builder`（新增）：`build(root)` 单插件前端构建、`createServer(baseDir)` 开发服务器、`koishi-console` CLI（`bin` 名不变）。宿主总装脚本迁入 `src/assemble.ts` 并由 CLI 无参分支调用，**顺带修复了 npm 安装形态下总装分支不可用的问题**（原 `scripts/` 不在 `files` 白名单内）；总装现在会在非仓库形态下显式报错，而不是把产物写到无关路径。
  - `@koishi-ce/client`：`exports` 的 `./lib`、`./bin` 与 `bin` 字段移除，`files` 收窄为 `app` / `client` / `global.d.ts`，构建工具依赖全部移出。**浏览器侧 API 与源码路径（`client/`、`app/`、`global.d.ts`）一律不变**，无运行时行为变更。`./lib` 与 `koishi-console` 属构建工具面而非运行时 API，消费者请改用 `@koishi-ce/console-builder`；两者均为 `^1.0.0` 线兼容变更故按 minor 发布。
  - `@koishi-ce/plugin-console`：devMode 的 Vite 开发服务器改从 `@koishi-ce/console-builder` 动态导入，新增可选 peer（与既有 `@koishi-ce/client` 可选 peer 同形），未开启 devMode 的部署不受影响。
  - `create-koishi-ce`：内置模板 devDependencies 预置新增 `@koishi-ce/console-builder`，保证新项目开箱即用的 `devMode` 仍可用。

### Patch Changes

- Updated dependencies [f644c05]
- Updated dependencies [549520e]
  - @koishi-ce/client@1.4.0
  - @koishi-ce/console-app@1.0.1
  - @koishi-ce/console-builder@1.0.1

## 1.3.6

### Patch Changes

- bcaad36: 修复状态栏空内容 tooltip 悬停残留箭头黑菱形：空占位标记嵌在 el-scrollbar 内层与弹层箭头节点不平级，原相邻选择器永远匹配不上，改用 `:has()` 在无内容时整体隐藏弹层（同时惠及所有不传 tooltip 插槽的 k-status 使用方）。
- Updated dependencies [57718ed]
- Updated dependencies [bcaad36]
- Updated dependencies [c489bc4]
  - @koishi-ce/client@1.3.2

## 1.3.5

### Patch Changes

- a69d1c8: 修复生产模式下控制台前端根目录定位：构建产物中本模块被 rolldown 拆至 lib/ 一层（lib/node/index.mjs 仅为壳），原先按 import.meta.url 向上两级的写法随 chunk 落点漂移，root 被指到包外导致 index.html 读取失败、webui 白屏；改为按 __dirname（恒为产物文件所在目录）定位 dist，与 market 插件同款。
- @koishi-ce/client@1.3.0

## 1.3.4

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
  - @koishi-ce/client@1.3.0
  - @koishi-ce/koishi@1.0.16

## 1.3.3

### Patch Changes

- Updated dependencies [412c225]
- Updated dependencies [f8cb474]
  - @koishi-ce/console@1.0.1
  - @koishi-ce/client@1.2.4
  - @koishi-ce/koishi@1.0.15

## 1.3.2

### Patch Changes

- b445d19: 修复并行第二个 dev 实例的 Vite HMR WebSocket 端口冲突（报错形态为「WebSocket server error: Port undefined is already in use」，Bun 的 EADDRINUSE 错误缺 port 字段所致）：缺省 24678 被占用时自动顺延并提示，新增 `dev.wsPort` 显式指定。
- @koishi-ce/client@1.2.3

## 1.3.1

### Patch Changes

- 340f989: 修复下游 devMode 黑屏：reggol 未进 Vite 依赖预打包，其 browser 入口 external 的 CJS 依赖 object-inspect 在浏览器裸 ESM 导入报「does not provide an export named 'default'」，现将 reggol 加入 optimizeDeps.include
- Updated dependencies [340f989]
  - @koishi-ce/client@1.2.1

## 1.3.0

### Minor Changes

- f90fa0a: 宿主控制台前端重 build：内建欢迎卡移除，欢迎页改由 @koishi-ce/plugin-welcome 提供（需另行启用该插件，脚手架默认模板已预写）。

### Patch Changes

- 08733b3: 宿主控制台前端重 build：带入 @koishi-ce/components 虚拟列表首屏渲染区间修复（日志页冷加载空白，见同期 components 条目）。
- Updated dependencies [cab60d9]
- Updated dependencies [f90fa0a]
  - @koishi-ce/client@1.2.0

## 1.2.0

### Minor Changes

- 03b38d0: console 新增 `dev.allowedHosts` 配置：透传 Vite 的 `server.allowedHosts`，供域名访问开发模式控制台时显式放行（Vite 6.0.9 起默认仅放行 localhost 与 IP 直连，域名访问会被 403 拦截导致白屏，上游缺陷 koishijs/koishi#1492）。默认留空维持 Vite 原行为。

### Patch Changes

- Updated dependencies [074bced]
  - @koishi-ce/client@1.1.1
  - @koishi-ce/koishi@1.0.11

## 1.1.0

### Minor Changes

- bac9f1d: i18n: 补齐多语种词典缺口
  
  - console：配置 schema 词典恢复 7 语种（新增 de-DE/en-US/fr-FR/ja-JP/ru-RU/zh-TW，含上游缺失的 head 键段），并在 `.i18n()` 中全部注册
  - core：`internal.invalid-{image,audio,video,file}` 4 个 CE 新增键补齐 de-DE/fr-FR/ja-JP/ru-RU/zh-TW 翻译
  - auth：de-DE/en-US/fr-FR/ja-JP/ru-RU 六个语言文件此前的简体中文占位替换为真翻译
  - bind：全语种补齐 `self-1/self-2` 键；de-DE/fr-FR/ja-JP/ru-RU 的中文占位替换为真翻译
  - inspect：de-DE/fr-FR/ja-JP/ru-RU 的中文占位（及半占位）替换为真翻译

### Patch Changes

- Updated dependencies [4e25fa0]
  - @koishi-ce/client@1.1.0
  - @koishi-ce/koishi@1.0.8

## 1.0.4

### Patch Changes

- 4c86c84: 适配依赖类型漂移的存量类型错误：browser 变体读取 loader 挂载的 `koishi.socket` 改为显式定型（`Record<symbol, unknown>` 索引 + `Universal.WebSocket` 断言），替换因 Loader 类型变化而失效的 `@ts-expect-error`，运行时行为不变。
- @koishi-ce/client@1.0.3
  - @koishi-ce/koishi@1.0.6

## 1.0.3

### Patch Changes

- 8b081a7: knip 全仓清理：修真问题、配准误报。
  
  - 修复前端构建覆盖配置从未接线的问题：`koishi-console build` 现在会显式加载插件自带的 `build/client.ts` 并合并进 vite 配置（vite 不会自动发现该文件名），analytics 的 "fuck-echarts" Symbol 遮蔽修补自此真正生效，其 dist 已重建验证；explorer 的 monaco manualChunks 覆盖已删除（rolldown 自动分包已实现其目标且粒度更优）。
  - 修复 plugin-hmr 在无 `koishi` 裸名残留链接的环境下启动即崩的问题：框架依赖集的解析锚点由 `require.resolve("koishi")` 改为 `require.resolve("@koishi-ce/koishi")`（后者是其 peer 依赖，必然可解析）。
  - 依赖卫生：移除 11 处声明而未用的依赖（含 cli 的 `@satorijs/core`、actions/oobe/theme-vanilla 的 `@koishi-ce/console` 等）；为仅被类型引用或前端源码引用的包补齐 20 余处缺失声明（`vue` / `vue-router` / `@vueuse/core` / `element-plus` / `vite` 及各 `@koishi-ce/*` 类型借用）。
  - 死代码清理：sandbox node 侧无人消费的 `words` 昵称表、若干仅为模块内部使用却导出的符号与接口改为私有。
  - 新增根级 `knip.json`：登记前端构建入口与 cordis 插件双导出惯例等误报豁免，`bunx knip` 输出收敛至零（测试文件的 unlisted 依赖另行处理中）。
- Updated dependencies [8b081a7]
  - @koishi-ce/client@1.0.3
  - @koishi-ce/koishi@1.0.4

## 1.0.2

### Patch Changes

- 1581751: fix(webui): 修复生产环境插件前端产物服务链路，存量插件包免升级恢复样式与功能
  
  生产环境（npm 安装形态）下 webui 插件前端大面积崩坏，根因与修复：
  
  - **插件样式未下发**：`resolveEntry` 只探测 `dist/style.css`，而存量 1.0.0 插件包的样式产物名为 `index.css`（css 改名约定未随其重新发布），导致 sandbox / explorer / insight / commands / status 等十个插件无样式——表现为图标偏小、状态栏悬停弹层呈黑色矩形、沙盒页面崩坏。现按 `style.css` → `index.css` 双名兼容探测，旧包直接恢复。
  - **裸导入改写漏形态**：`transformImport` 只匹配 `import … from` 形态，logger 产物的副作用导入 `import"vue-router"` 不被改写，浏览器以裸名解析失败导致整个插件模块不加载（页面路由不注册）。重写为覆盖静态导入 / 副作用导入 / 再导出 / 动态导入四种形态，并增加前导语句边界约束（避免误伤字符串字面量中的同类文案）；映射表补 `@koishijs/client`（市场安装的上游官方 webui 插件复用同一份宿主 client chunk）。
  - **worker 请求 404 回退 HTML**：monaco 产物以根绝对路径引用 worker（`/editor.worker-*.js`），不带 `@plugin-` 前缀落到主体分支，未命中时 SPA 兜底返回 index.html，浏览器报 `Unexpected token '<'` 且 monaco 降级主线程。主体分支现按文件名在各 entry 产物目录兜底探测；带扩展名的资源未命中时如实 404，不再回退 HTML。
  - **devMode 直出短路**：dev 模式下 npm 安装的插件回退产物 URL 后原样直出裸导入，一并改为统一走改写；entry 声明的源码形态误达 `@plugin` 通道时返回 404。
  - **初始导航 no match 警告**（@koishi-ce/client）：loader 的 `initTask` 在入口文件实际加载完成前即 resolve（`Promise.all` 的 map 回调未返回加载任务），router install 早于插件注册路由，直接访问 `/sandbox`、`/graph` 等路径时 vue-router 报 no match。现等待全部入口文件 settle（单个扩展失败仍不阻塞界面）。

## 1.0.1

### Patch Changes

- 6e6be22: 修复 `@plugin-*` 静态产物路由对 workspace 目录布局的插件一律 403：路径越界判定改以各 entry 自身声明的产物路径为基准（上游以 console root / node_modules 为白名单，前提是插件装在 node_modules 下，本仓库插件位于 `plugins/**` 不满足），同时移除 node_modules 兜底以消除穿越漏洞。
