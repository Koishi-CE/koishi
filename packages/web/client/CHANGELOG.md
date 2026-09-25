# @koishi-ce/client

## 1.4.1

### Patch Changes

- Updated dependencies [9a6ea29]
  - @koishi-ce/components@1.1.0

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

## 1.3.3

### Patch Changes

- e2492f7: 内置 Markdown 渲染组件（`k-markdown`）不再依赖 npm 包 `marked-vue`，改为就地 vendor 的本地实现（`client/components/markdown.ts`，源自 `marked-vue@1.3.0`，MIT）。该包自 2023 年起停更、无 release，且把 `marked` 钉在 `^9.1.6` 永不前进；收回源码后本包直接声明 `marked` / `xss`，可自主升级解析器与消毒器。
  
  运行时行为零变化：props 语义（`source` / `inline` / `tag` / `unsafe`）、包裹标签与 `markdown` class，以及非 unsafe 模式下的消毒白名单、`<a>` 属性规范化（协议白名单、`rel` / `target` 加固）与栈式补闭合均与上游逐字等价；另新增 25 条回归测试锁定该行为基线。
- c277a4e: `k-markdown` 的手写消毒层换成 `dompurify`（`xss` 出仓）。
  
  原消毒层是 `marked-vue` 的手写实现（白名单过滤 + 自维护标签栈补闭合 + 手写 `<a>` 属性重建），自带两处偏差：白名单外标签的闭标签会残留（`<script>x</script>` → `x</script>`）、标签名大小写不归一（`<B>x</B>` → `<b>x</B>`）。二者都无可利用面，但暴露的正是「手写近似解析器」这一层的问题——嵌套、大小写、自闭合、属性引号形态都得自己覆盖。换入 DOMPurify 后由真实 DOM 解析器承担这些工作，偏差随之消失。
  
  行为变更有 7 处，逐条核对后均为「更正确」：`<script>` / `<iframe>` 连内容整体移除；孤儿闭标签（`</b>`）直接丢弃而非转义显示；标签名统一归一为小写；非法协议的 href 由「降级为 `#`」改为整体剔除（且无 href 时不补 `rel` / `target`，不再伪造假链接）；属性值内的尖括号按 HTML 规范原样保留（已由 round-trip 用例证否「会变成标签」）。另需显式关掉 DOMPurify 默认开启的 `ALLOW_DATA_ATTR` / `ALLOW_ARIA_ATTR`，否则它们会绕过 `ALLOWED_ATTR` 的收敛。
  
  产品口径不变：`ALLOWED_TAGS` 仍不含 `img`——非 unsafe 模式的渲染对象包含市场里的第三方插件描述，放行图片等于允许其借图片请求静默外发访客信息。
  
  代价是产物 +10.3 KB（`xss` 18,786 B → `dompurify` 29,354 B，minify 实测）；换来的是十余年攒下的攻击面覆盖面与持续维护的安全修复（`xss` 的 npm 最新版已停在 2024-03，属发版停摆）。测试期新增 `jsdom` + `@types/jsdom`（DOMPurify 是 DOM-only 库）：linkedom 会**静默返回未消毒原文**、happy-dom 会谎报 `isSupported` 并把元素整体剥光（30 条输入里 27 条与 jsdom 分歧），两者均已实测证否。
  
  回归测试由 29 用例 / 55 断言增至 31 用例 / 60 断言，新增一组「消毒输出的二次解析安全性（round-trip）」：把消毒结果重新解析为 DOM，确认不产生新的可执行节点或 `on*` 属性。
- df92195: `k-markdown` 的 Markdown 解析器由 `marked@9.1.6` 升到 `marked@18.0.14`（跨 9 个 major）。原 `marked-vue` 把解析器钉在 9.x，其更新几乎全是解析边界修复与 ReDoS 加固，长期停留在 9 意味着持续吃旧 bug。
  
  升级前先做双装对拍（72 条语料 × 块级/行内两模式），实测 16 处输出差异，逐条核对后确认全部是上游解析修复，无一处涉及本仓消毒层的前提：HTML 正确性（裸 URL 自动链接的 `href` 里裸 `&` 现转义为 `&amp;`）、安全（不再产出非法的链接套链接 `<a>` 嵌套）、CommonMark 合规（数字字符引用 `&#65;` 现解码为 `A`）、块级修复（空列表项、空代码块的多余换行、ATX 标题闭合序列前的制表符、引用后接空列表、硬换行后的前导空白）。
  
  代码改动仅在类型面：marked 9 的 `parse` 是 `typeof marked`（重载函数，最宽松一条返回 `string`），marked 18 改为三条调用签名后回到 `string | Promise<string>`，故渲染函数对两个分支的结果统一 cast 一次。上述差异中可观测的部分已钉成 4 组新回归用例（测试文件 25 → 29 用例）。
  
  代价是字节数：`marked` minify 后由 35,632 B 涨到 45,639 B（+10.0 KB），宿主前端 `client.js` 相应由 310.68 kB 涨到 321.05 kB（+10.4 kB / +3.3%，gzip 104.37 kB）——本次判据是解析正确性与安全修复，不是体积。

## 1.3.2

### Patch Changes

- 57718ed: 依赖页暗色观感修复:依赖卡边框引用了不存在的 `--k-border-color` 变量,整条 border 声明失效(卡片描边、版本占位虚线框、悬停高亮全部丢失),改回主题正名 `--k-color-border`;宿主为状态色 plain 按钮的浅底/描边系列补暗色映射(此前用 EP 默认亮色值,暗色界面里「卸载」按钮呈刺眼浅粉色块)。
- bcaad36: 修复状态栏空内容 tooltip 悬停残留箭头黑菱形：空占位标记嵌在 el-scrollbar 内层与弹层箭头节点不平级，原相邻选择器永远匹配不上，改用 `:has()` 在无内容时整体隐藏弹层（同时惠及所有不传 tooltip 插槽的 k-status 使用方）。
- c489bc4: 依赖跟进：`@vueuse/core` 由 ^14.4.0 升到 ^15.0.0（全仓 5 处声明：`client` 为 dependencies，admin / explorer / insight / market 四插件为 devDependencies），非冻结线 major 清零。
  
  破例点与本仓无实质交集：用到的 13 个符号（`useWindowSize` / `useEventListener` / `usePreferredDark` / `useResizeObserver` / `useLocalStorage` / `RemovableRef` / `useDebounceFn` / `watchDebounced` / `watchThrottled` / `useTimeoutFn` / `onKeyStroke` / `useElementSize` / `useThrottleFn`）在 15 全部保留；唯一有交集的是 `useThrottleFn` 的 `trailing` 默认值由 false 翻转为 true，而 `insight` 的 `watchThrottled` 已显式传 `trailing: true`，行为等价；被移除的 deprecated timer options（`interval` / `immediate` / `updateInterval` / `immediateCallback`）只落在本仓未使用的 composable 上。入口仍是 `dist/index.js`，宿主共享块 `vueuse.js` 的打包路径与 peer（`vue ^3.5.0`）均不变。

## 1.3.1

### Patch Changes

- f2f2acd: 修复底部状态栏项悬停 tooltip 的滚动条闪烁循环：popper 的 preventOverflow 原本 padding 为 0，弹层被允许贴死视口右缘，经典滚动条 + DPI 缩放环境下亚像素取整溢出会撑出 body 滚动条，进而顶起 footer 使鼠标脱离状态项，tooltip 反复开关形成闪烁。现给 preventOverflow 留 8px 安全边距使弹层不再贴边；另兜底 body overflow: hidden——控制台为全 fixed 布局，body 级滚动没有正当消费者，关闭后任何弹层瞬态溢出都不再产生滚动条
- @koishi-ce/components@1.0.4

## 1.3.0

### Minor Changes

- e537fa2: fallow 审计收敛：断掉 core 最后一处循环依赖并收敛重复代码样板（1024 → 357 行）。
  
  - core：runtime.ts 的 `Service.setup` 经新增的 context 工厂槽（`context/factory.ts`）创建 root Context，消除 context/index.ts ↔ runtime.ts 模块环，公共 API 不变。
  - console（核心包）：新增 `clientEntry` 导出——插件向控制台注册前端产物的三环境路径样板（KOISHI_BASE 部署 / browser 构建 / 本地 dev-prod），各 webui 插件入口的三分支复制统一改为一行调用。
  - client：新增 `extendLocales`（插件前端入口的七语种词典批量注入，配合 `import.meta.glob` 收敛 import+extend 样板）与 `scrollActiveTree`（keep-alive 页面重激活时把 el-tree 激活节点滚到可视中央）。
  - loader：公共导出 `insertKey` / `rename`（键顺序保持式改名工具），config 插件 writer 复用之。
  - utils：新增 npm-registry 模块（`getLocalRegistry` / `readNpmrcRegistry` / `NPM_OFFICIAL_REGISTRY`），create-koishi-ce 与 market 的本机 registry 探测共享同一实现。
  - config：manager/* 事件签名收敛到 `src/shared/console-events.ts` 唯一定义（node 与浏览器两端声明合并经 extends 引用）；global/group 设置面板的 modelValue 代理改用 `defineModel`。
  - admin/sandbox/sqlite/check-docs-links：对称逻辑（用户组加入与移出、方向键历史回溯、`_all`/`_get` 读取原语、链接检查循环）就近抽取共享实现。

### Patch Changes

- @koishi-ce/components@1.0.4

## 1.2.4

### Patch Changes

- f8cb474: 修复 koishi-console CLI 的 shebang 仍指向 node：产物顶层依赖 Bun API（Bun.Glob / Bun.file 等，node 下模块加载期即抛 `Bun is not defined`），对齐仓内 bun shebang 范式。
- @koishi-ce/components@1.0.4

## 1.2.3

### Patch Changes

- 6cb2db5: 修复下游 Bun 环境启动段错误与 devMode vite 无法启动
  
  - loader：CJS interop 种子预置不再 require 非 CJS 入口（.mjs / type:module 的 .js 等），并跳过 realpath 同一实体文件的伪分歧路径——此前会对依赖树里的包无差别执行入口顶层副作用，unocss 66.10 拖入的 zigpty（入口顶层 dlopen，Bun win32 直接段错误且不可捕获）即被引爆，下游 `bun dev` 在 console 插件后必崩
  - client：collectWorkspaceAliases 在下游 npm 安装布局（.bun 嵌套 / 根提升）下上跳四级读不到仓库根清单时返回空表而非抛 ENOENT——该函数在模块顶层 await 执行，抛出会拖垮整个 client 加载，devMode 的 vite dev server 随之无法启动
- @koishi-ce/components@1.0.4

## 1.2.2

### Patch Changes

- d71f928: 修复下游 devMode 侧边栏空白：组件库入口的 cosmokit 直连 re-export 与 schemastery-vue 透传在浏览器端形成同名 conflicting star exports，全部 webui 插件前端加载失败。components 入口改为仅经 form 链单源透传 cosmokit（类型面由 "schemastery-vue/client" 的双载体同步补齐 re-export）；client 的 dev server 将 schemastery-vue（裸名与 /client 子路径）加入 optimizeDeps.exclude，消除预打包产出的第二份 cosmokit 实例与缺失产物引用。
- Updated dependencies [d71f928]
  - @koishi-ce/components@1.0.4

## 1.2.1

### Patch Changes

- 340f989: 修复下游 devMode 黑屏：reggol 未进 Vite 依赖预打包，其 browser 入口 external 的 CJS 依赖 object-inspect 在浏览器裸 ESM 导入报「does not provide an export named 'default'」，现将 reggol 加入 optimizeDeps.include

## 1.2.0

### Minor Changes

- f90fa0a: 欢迎卡（welcome.vue 与 welcome.* 词典 7 语种）迁出至新独立插件 @koishi-ce/plugin-welcome，宿主 app 的首页仅保留 home 插槽；lottie-web 依赖随动画一并移出。

### Patch Changes

- cab60d9: 修复下游（npm 安装）实例 devMode 无法启动的三处根因：vite 依赖预打包会把宿主 TS 源码与 .yml 词典卷进 rolldown 预打包（.yml 被当 JS 解析，报 PARSE_ERROR ×7 与空 specifier），现经 optimizeDeps.exclude 显式排除宿主与组件库（工作区内两者靠工作区别名天然不进 optimizer，下游别名表为空才触发）；工作区别名缺席时 "schemastery-vue/client" 的运行时载体别名被推导为空串（resolve 直接报错），改为从本包向父级逐级 node_modules 纯 fs 探测（不走解析 API，防父目录快照缓存），探测失败省略该键；dev server 编译 .vue 的外部导入类型需要 compiler-sfc 加载 TypeScript，新增 dependencies typescript ^5.0.0（必须 5.x：npm latest 的 6.x 原生版缺 ts.sys，会报 No fs option）。
- Updated dependencies [cab60d9]
- Updated dependencies [08733b3]
  - @koishi-ce/components@1.0.3

## 1.1.1

### Patch Changes

- 074bced: 控制台页面模板加 no-referrer meta，修复外链头像等资源因携带本站 Referer 被平台 CDN 拒绝（upstream: koishijs/koishi#1377）
- Updated dependencies [2665a25]
  - @koishi-ce/components@1.0.2

## 1.1.0

### Minor Changes

- 4e25fa0: i18n: 前端国际化机制落地（宿主）
  
  - `$i18n` 服务新增 `extend()` 与 `t()`：扩展语言包经 `ctx.$i18n.extend(locale, messages)` 深合并注入全局 vue-i18n 实例，兑现「loader 注入」的注释承诺
  - 新增宿主全局词典 `client/locales/`（7 语种），设置页/主题/欢迎页/加载态/404/图片查看器等硬编码文案全部改走词典
  - 设置页语言选择器从 zh-CN/en-US 扩至 7 语种，显示名采用各语言本地名称
  - `SettingOptions.title` 放宽为 `MaybeRefOrGetter<string>`，设置分区标题随界面语言实时切换；activity 页名（`name` 本就支持 getter）同步接入
  - 欢迎页从组件局部词典迁移至全局词典（原 en-US 半中半英文案顺带补全，en 之外新增 5 语种）

### Patch Changes

- @koishi-ce/components@1.0.1

## 1.0.4

### Patch Changes

- 173e819: 前端构建（宿主总装 / 单插件 build / dev server）钉死 Vue SFC 模板编译 `comments: false`：模板根元素前的 HTML 注释会把组件编译成多根 fragment，令 Vue 禁用 attribute 透传——侧栏 activity 图标因此丢失 `activity-button-icon` 尺寸类（24px 缩水为 1em/16px）。此前是否剥注释随构建进程的 NODE_ENV 漂移（Bun 无 NODE_ENV 时按 development 条件解析 @vue/compiler-core，dev 产物默认保留注释），现显式钉死为生产语义，与 NODE_ENV 解耦。

## 1.0.3

### Patch Changes

- 8b081a7: knip 全仓清理：修真问题、配准误报。
  
  - 修复前端构建覆盖配置从未接线的问题：`koishi-console build` 现在会显式加载插件自带的 `build/client.ts` 并合并进 vite 配置（vite 不会自动发现该文件名），analytics 的 "fuck-echarts" Symbol 遮蔽修补自此真正生效，其 dist 已重建验证；explorer 的 monaco manualChunks 覆盖已删除（rolldown 自动分包已实现其目标且粒度更优）。
  - 修复 plugin-hmr 在无 `koishi` 裸名残留链接的环境下启动即崩的问题：框架依赖集的解析锚点由 `require.resolve("koishi")` 改为 `require.resolve("@koishi-ce/koishi")`（后者是其 peer 依赖，必然可解析）。
  - 依赖卫生：移除 11 处声明而未用的依赖（含 cli 的 `@satorijs/core`、actions/oobe/theme-vanilla 的 `@koishi-ce/console` 等）；为仅被类型引用或前端源码引用的包补齐 20 余处缺失声明（`vue` / `vue-router` / `@vueuse/core` / `element-plus` / `vite` 及各 `@koishi-ce/*` 类型借用）。
  - 死代码清理：sandbox node 侧无人消费的 `words` 昵称表、若干仅为模块内部使用却导出的符号与接口改为私有。
  - 新增根级 `knip.json`：登记前端构建入口与 cordis 插件双导出惯例等误报豁免，`bunx knip` 输出收敛至零（测试文件的 unlisted 依赖另行处理中）。
- Updated dependencies [8b081a7]
  - @koishi-ce/components@1.0.1

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

- 6e6be22: 单插件前端构建的 css 产物统一改名为 `style.css`（与上游约定及 console 服务端 `resolveEntry` 的探测逻辑对齐，此前产出的 `index.css` 从未被下发，插件页面缺样式）。
