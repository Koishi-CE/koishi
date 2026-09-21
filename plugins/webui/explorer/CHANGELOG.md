# @koishi-ce/plugin-explorer

## 1.2.0

### Minor Changes

- db59fd0: 编辑器由 monaco 整体换为 CodeMirror 6：前端产物 **13.55 MB → 0.72 MB**（首屏静态可达约 431 KB），文件数 97 → 23。
  
  - **体积来源说明**：monaco 的 `.` 入口会连带引入全部语言定义与 css / html / json / typescript 四个语言服务注册模块（其 worker 合计 9.15 MB），而本插件自移植起就在运行期用 `setModeConfiguration` 把这些语言服务全部关掉——这 9.15 MB 属"付了钱不用"，且仅改单处导入无法摘除。
  - **语言**：改为 21 种语法的按需加载（YAML / JSON / JS / TS / JSX / TSX / HTML / XML / CSS / SCSS / Sass / Less / Markdown / SQL / Vue，以及经 `@codemirror/legacy-modes` 包装的 Shell / PowerShell / TOML / Dockerfile / INI / Diff）。每个语言独立成 chunk，只在打开对应类型文件时下载；清单集中在 `client/languages.ts`，新增语言只需装包 + 加一项。
  - **语言选取原则**：只收录 Koishi 生态真实会出现的类型（纯 TS / JS 世界）；后端语言（Python / Java / C-C++ / Rust / Go / PHP）已整体剔除（连同 6 个依赖包），这类文件回退纯文本。
  - **主题**：编辑器配色收敛为一组 `--cm-*` 变量（`client/editor.scss`），跟随控制台主题变量；`theme-vanilla` 的 coffee-dark 同步把原 monaco 变量覆写改写为 `--cm-*` 覆写。
  - **行为差异**：不再向 `window` 挂全局 `monaco` 命名空间（仓库内无消费者）；不再有 worker，控制台侧为 monaco worker 做的根绝对路径兜底自此不再被触发（兜底逻辑保留）。
  - 编辑器容器改为 CodeMirror 实例持有文档（不再有全局共享 model），容器尺寸自适应故移除手动 layout 调用。

### Patch Changes

- bf3fc59: 依赖收敛：文件树路径过滤由 `anymatch` 换为直连 `picomatch` 4（该版本本仓已由 vite / tsdown 等经传递依赖引入，显式声明不新增物理包），`anymatch` / `normalize-path` 及其嵌套的 `picomatch@2` 三包出仓，物理依赖净减 2；源码中为 anymatch 的 CJS/ESM 互操作保留的 `as unknown as` 双重断言随之清零（断言基线 18 → 17）。行为经多模式 × 13 输入矩阵实测与原先逐条一致（含 win32 反斜杠路径与 dotfile 忽略），另显式声明 `windows` 平台选项以规避 picomatch 4「不传 options 即按 posix 处理」的坑点。
- c489bc4: 依赖跟进：`@vueuse/core` 由 ^14.4.0 升到 ^15.0.0（全仓 5 处声明：`client` 为 dependencies，admin / explorer / insight / market 四插件为 devDependencies），非冻结线 major 清零。
  
  破例点与本仓无实质交集：用到的 13 个符号（`useWindowSize` / `useEventListener` / `usePreferredDark` / `useResizeObserver` / `useLocalStorage` / `RemovableRef` / `useDebounceFn` / `watchDebounced` / `watchThrottled` / `useTimeoutFn` / `onKeyStroke` / `useElementSize` / `useThrottleFn`）在 15 全部保留；唯一有交集的是 `useThrottleFn` 的 `trailing` 默认值由 false 翻转为 true，而 `insight` 的 `watchThrottled` 已显式传 `trailing: true`，行为等价；被移除的 deprecated timer options（`interval` / `immediate` / `updateInterval` / `immediateCallback`）只落在本仓未使用的 composable 上。入口仍是 `dist/index.js`，宿主共享块 `vueuse.js` 的打包路径与 peer（`vue ^3.5.0`）均不变。
- Updated dependencies [bcaad36]
  - @koishi-ce/plugin-console@1.3.6

## 1.1.2

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
  - @koishi-ce/plugin-console@1.3.4
  - @koishi-ce/koishi@1.0.16

## 1.1.1

### Patch Changes

- Updated dependencies [412c225]
  - @koishi-ce/console@1.0.1
  - @koishi-ce/plugin-console@1.3.3
  - @koishi-ce/koishi@1.0.15

## 1.1.0

### Minor Changes

- 98c86df: i18n: 五个 webui 插件前端文案接入全局词典
  
  - explorer / config / dataview / insight / analytics 的 client 侧新增 7 语种词典，经 `ctx.$i18n.extend()` 注入宿主全局实例，页名、菜单、按钮、确认框、toast 等文案随设置页语言切换实时生效
  - explorer 的 node 侧 schema 词典补齐 7 语种；analytics 的两处 schema 描述由中文直写改为 `.i18n()`
  - 宿主侧配套：`$i18n.t` 支持插值参数、`createChart` 的标题支持 getter（详见 @koishi-ce/client 的 changeset）

### Patch Changes

- d1c1552: 移除从未生效的 chokidar 死依赖：`watchers` 集合自上游移植以来从未被填充（上游 webui 同样如此），`stop()` 关闭的是恒空集合；随字段与 override 一并删除，chokidar 从 workspace 包的直接依赖中移除。文件树的刷新仍由读写等 RPC 触发，行为无任何变化。
- Updated dependencies [bac9f1d]
  - @koishi-ce/plugin-console@1.1.0
  - @koishi-ce/koishi@1.0.8

## 1.0.2

### Patch Changes

- 随前端构建钉死剥离 Vue 模板注释（@koishi-ce/client 1.0.4）重建前端产物：上述插件的存量 npm 产物里，模板根元素前带注释的组件（侧栏 activity 图标、文件树 / 登录表单图标等）被烘焙成多根 fragment，宿主传入的 class 透传不进去——侧栏图标缩水（24px 落回 16px）即此因。重构建后产物恢复单根语义，下游更新即修复。

## 1.0.1

### Patch Changes

- 8b081a7: knip 全仓清理：修真问题、配准误报。
  
  - 修复前端构建覆盖配置从未接线的问题：`koishi-console build` 现在会显式加载插件自带的 `build/client.ts` 并合并进 vite 配置（vite 不会自动发现该文件名），analytics 的 "fuck-echarts" Symbol 遮蔽修补自此真正生效，其 dist 已重建验证；explorer 的 monaco manualChunks 覆盖已删除（rolldown 自动分包已实现其目标且粒度更优）。
  - 修复 plugin-hmr 在无 `koishi` 裸名残留链接的环境下启动即崩的问题：框架依赖集的解析锚点由 `require.resolve("koishi")` 改为 `require.resolve("@koishi-ce/koishi")`（后者是其 peer 依赖，必然可解析）。
  - 依赖卫生：移除 11 处声明而未用的依赖（含 cli 的 `@satorijs/core`、actions/oobe/theme-vanilla 的 `@koishi-ce/console` 等）；为仅被类型引用或前端源码引用的包补齐 20 余处缺失声明（`vue` / `vue-router` / `@vueuse/core` / `element-plus` / `vite` 及各 `@koishi-ce/*` 类型借用）。
  - 死代码清理：sandbox node 侧无人消费的 `words` 昵称表、若干仅为模块内部使用却导出的符号与接口改为私有。
  - 新增根级 `knip.json`：登记前端构建入口与 cordis 插件双导出惯例等误报豁免，`bunx knip` 输出收敛至零（测试文件的 unlisted 依赖另行处理中）。
- Updated dependencies [8b081a7]
  - @koishi-ce/koishi@1.0.4
  - @koishi-ce/plugin-console@1.0.3
