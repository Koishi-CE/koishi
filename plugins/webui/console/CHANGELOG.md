# @koishi-ce/plugin-console

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
