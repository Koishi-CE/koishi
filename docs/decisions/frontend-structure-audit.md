# 前端结构审计

> **审计日期**:2026-09-25(全新重审,旧版整体作废删除,本文档从零重写,不继承任何旧结论)。
> **方法**:六个分区并行扫描(builder / client+app 宿主 / components / 插件矩阵前后两半 / 横切层)+ 架构中枢人工复核 + 重磅发现逐条实证(文中所列 P1 级问题均经代码二次确认,带 `file:line` 证据)。
> **范围**:`packages/web/*`(4 包)与 `plugins/webui/*`(19 插件)的 client 侧;server 侧仅看与 client 联动的接口面。
> **口径**:一切以当日代码为准,本文档会过时;滞后时听代码的。

## 1. 总览

### 1.1 基线数据

前端合计约 **4.2 万行** 源码(不含 svg / yml 词典 / lottie 数据)。23 个前端单元的行数分布:

| 包 | 行数 | 包 | 行数 |
| --- | ---: | --- | ---: |
| plugins/webui/market(含 vendor) | 9689 | plugins/webui/insight | 1230 |
| plugins/webui/config | 4497 | plugins/webui/logger | 1014 |
| packages/web/components | 4235 | packages/web/builder | 916 |
| plugins/webui/auth | 2383 | plugins/webui/locales | 800 |
| plugins/webui/explorer | 2392 | plugins/webui/notifier | 660 |
| packages/web/app | 2701 | plugins/webui/oobe | 62 |
| plugins/webui/commands | 2205 | plugins/webui/theme-vanilla | 299 |
| plugins/webui/admin | 2031 | plugins/webui/welcome | 289 |
| plugins/webui/sandbox | 1900 | plugins/webui/actions | 56 |
| plugins/webui/console | 1795 | packages/web/client | 2074 |
| plugins/webui/dataview | 1630 | plugins/webui/analytics | 1819 |
| plugins/webui/status | 1443 | | |

### 1.2 五层架构图景

自底向上,分层基本清晰、单向依赖:

1. **构建层 `@koishi-ce/console-builder`**(916 行):无 vite 配置文件的纯编程式构建。`bin.ts` CLI 分流单插件 build 与宿主总装(assemble);`collectWorkspaceAliases` 从根 workspaces 声明收集跨包别名表;单插件产物 `client/index.ts → dist/{index.js,style.css}`,插件可自带 `build/client.ts` 覆盖配置(仓内唯一使用者是 analytics 的 fuck-echarts);devMode 走 `createServer` middlewareMode 挂 `/vite/`。
2. **UI 库 `@koishi-ce/components`**(39 文件):全仓唯一组件库。k-* 基础件 + schemastery 表单扩展 + 虚拟列表 + markdown 管线(marked + DOMPurify)+ 图标中心(`assets/icons/` 133 个集中 svg,经 `~icons/k/*` 虚拟模块消费)。element-plus 全量安装,主题经 `--el-* → --k-*` 变量映射定制。
3. **运行时内核 `@koishi-ce/client`**(9 文件):无界面浏览器内核。构造 cordis 根 Context,装 action/i18n/loader/router/setting/theme 六服务;`data.ts` 承担 WebSocket 收发、patch 合并与 id 关联 RPC;对 components 做全量二次转出保住插件历史导入面。
4. **宿主壳 `@koishi-ce/console-app`**(32 文件):六个内置插件(home/layout/settings/status/theme)向具名插槽注册默认视图,order ±1000 抢占首末位;样式层以 `--bg*/--fg*/--k-*` CSS 变量为单一事实源,暗色由 client theme 服务写 `<html theme>` + `.dark`。
5. **插件矩阵 `plugins/webui/*`**:19 插件中 16 个有 client。统一模式:单入口 `export default (ctx) => {...}` + `ctx.page()/slot()` 注册视图 + `icons.register()` 补注图标 + 词典经 `import.meta.glob` + `extendLocales` 装载;RPC 全部走 DataService(store 订阅)抽象,无插件级裸 WebSocket。console 宿主插件(server 侧)负责静态资产服务与 entry 产物基准,工程质量为矩阵之最。

**market 的 vendor 分界**(本仓最大前端单元):`client/vendor/`(domain/search/sort/icons 四模块,自上游逻辑层收编)为纯逻辑层,视图四组件(filter/list/package/search)只从 vendor 导入、无反向依赖,边界清晰且 vendor 带 3 套测试;52 个 vendor 图标映射到 components 集中 svg 资产,其中 6 个与主库同名同语义复用。

## 2. 分区审计

### 2.1 构建体系(builder)

构建契约清晰(dist 命名、`build/client.ts` 接线、产物后处理改名),happy path 自洽;主要短板是**失败路径普遍「静默降级」而非显式失败**,以及同一套插件组装在三处复制粘贴(见问题清单 P1-1/P1-2)。`yaml.ts` 用 `Bun.YAML.parse` 替代 js-yaml 规避 CVE,`.vue` 统一钉死剥注释,icons 经 `createRequire` 定位组件包资产(workspace / npm 双形态通用)。

### 2.2 client 内核与 app 宿主壳

服务初始化顺序明确(构造期 action→i18n→loader→router→setting→theme,ready 后 await loader.initTask 再 mount),运行时依赖收敛到 utils/messages 叶子模块、无环。app 与 client 的分界以 `ctx.page/slot/settings/schema/theme` mixin API 实现,基本干净;越界点有两处:app 大量直读 `ctx.internal.*` 等于把 client 内部契约公共化;`client/utils.ts` 的 scrollActiveTree 直查 element-plus 树节点 DOM,UI 耦合漏进运行时库。`data.ts` 的 RPC 实现存在一组行为缺陷(见 P1-6)。

### 2.3 components 组件库

工程质量高:39/39 文件带 AGPL SPDX 头、零 `any`、markdown 消毒层(DOMPurify 标签白名单 + 协议白名单 + 刻意禁 img)有 391 行回归测试钉死行为。133 个集中 svg 资产经反查 **全部有消费,无死资产**。schemastery-vue 双轨(client 类型镜像 / runtime 运行时文件)是绕过该包「仅 TS 源码发布」约束的现实方案,机理自洽但构成第三处手工镜像。短板:image-viewer 与 chat/overlay 整套重复实现、可访问性普遍缺失(可点击 span 无 role/键盘支持、k-button 禁用仅靠 class)。

### 2.4 webui 插件矩阵

16 个有 client 的插件横向高度一致(单入口函数、slot 注册、icons.register、DataService RPC);例外均有理由:config 的 default export 是 `ConfigWriter extends Service`(供其他插件编程调用,合理)。三个维度的不一致:词典位置与装载方式(dataview 手动 7 语 import、admin/auth/commands 包根词典疑似死资产,见 P1-7);图标注册(5 家独立 icons.ts,admin/commands 内联);UI 字符串大量硬编码中文。超 400 行文件共 6 个,最重的是 `dataview/client/components/data-table.vue`(666)与 `market/client/components/install.vue`(588)。**oobe 经查实为占位空壳**(见 P1-9)。

console 宿主插件(server 侧 4 文件)是矩阵中工程质量最高的部分:403/404 判定以 entry 自身产物路径为穿越基准(workspace 布局与上游 node_modules 布局的差异已注释)、findDistRoot 修正 rolldown 拆 chunk 的 dist 定位漂移、rewriteSharedImports 覆盖 from 导入/副作用导入/动态 import 三形态且带语句边界防文案误改。遗留一处弱放行(P1-3)。

### 2.5 横切层:类型 / 样式 / i18n / 测试 / tsconfig

**类型体系**:client 侧对 node 侧 `@koishi-ce/plugin-console` 的手写 `declare module` 镜像共 **12 处**(骨架在 client/src/shims.d.ts,10 个插件各自补键),`@koishi-ce/client` 的 ActionContext 合并另有 6 处,schemastery-vue 同一实体两份声明。同步机制 = **纯手工**,各文件注释自述「须保持同步」,tooling/checks 下无任何 shim 同步校验(见 P1-4)。

**样式体系**:unocss 无独立配置文件,内联在 builder 两处(仅 preset-mini);实际 utility 类用量很小(约 12 个 vue 文件,flex 居多),16 个入口引 `virtual:uno.css` 的收益与管线成本不成比例。暗色机制单一写入点(client theme 服务),CSS 侧三套主题约定(semantic 变量 / element 映射 / hc 高对比)组织有序,但新增主题需同时改 3 处 scss。

**i18n 词典**:标准 7 语种,client / admin / analytics / auth / config / console / dataview / explorer / insight / logger / status / welcome / market 双套均齐;commands 与 sandbox 仅 zh-CN;app / components / notifier / theme-vanilla / oobe 无词典。vue-i18n 真实消费集中在组件层(`useI18n` 28 处 + `$i18n.t` 37 处),但 TS 层与部分模板硬编码中文普遍(market install.vue 全文、admin/group.vue、logger 页名等)。tooling/checks/locales.ts 已有键对齐 / 语种齐全 / 假翻译闸门。

**测试盘点**:前端 9 个 client 侧测试文件(components 2、explorer 1、market vendor+dependencies 6),server 侧 31 个。vendor search/sort **有测试**。真正裸奔的高风险纯逻辑:builder 的 collectWorkspaceAliases 路径推算(错一处全前端构建崩)、client 的 data.ts RPC(213 行)、messages 词典摘取、config 的 tree/utils。另 tsconfig.web.json 的 types:[] 使 client 测试不在 client 侧类型闸门内。

**tsconfig 双编译器分界**:node 侧 `tsconfig.json` 管 src,.vue 不进 tsc 程序(global.d.ts 声明为不透明 Component);client 侧 `tsconfig.client.json`(基座)+ `tsconfig.web.json`(19 个 client 目录大一统)+ 16 个插件级子工程,paths 因 extends 整体替换语义在三层重复维护;.vue 由 vue-tsc 影子闸门(tooling/checks/vue-types.ts,26 键基线)只拦新增。builder 属前端域却走 node 基座 tsconfig.base。

## 3. 问题清单

### P1(高:正确性 / 发布面 / 安全 / 结构性重复)

| # | 问题 | 证据 |
| --- | --- | --- |
| 1 | **builder 失败路径静默降级组**:裸包名/路径拼错 → `client/` 不存在 → 静默 return 零产物零报错,CLI 无法区分「没有前端」与「路径错了」;`findModulePath` indexOf 切片 -1 时静默产出畸形路径;`assertRepoLayout` 仅查四级上跳有 package.json,npm 下游同样满足,断言形同虚设,与注释宣称的「显式报错」不符;所有 "imported multiple times" 告警被静默丢弃,真实循环依赖告警一并被吞 | builder/src/index.ts:149,101 / assemble.ts:45-55,68-74 / index.ts:192-199 |
| 2 | **builder 重复组**:`BuildResult` 接口两处同构定义(注释自认);icons+vue(comments:false)+yaml+unocss 插件组在 index.ts 两处与 assemble.ts 三处复制粘贴,uno 配置也各写一份无共享常量,漂移风险实存 | index.ts:30-37,215-240,331-352 / assemble.ts:29-37,131-145,182 |
| 3 | **console 主体资源 403 判定弱放行**:路径含 `"node_modules"` 字符串即绕过 root 前缀约束(`includes` 匹配),可借 `../` 构造穿越读取 root 外同串路径文件;上游语义是白名单 node_modules 目录,应改为逐 entry 的目录前缀匹配 | console/src/node/assets.ts:167-171 |
| 4 | **类型镜像纯手工同步组**:console 服务声明 12 处镜像 + ActionContext 6 处 + schemastery-vue 双镜像 + logger LogRecord 双副本 + explorer/commands/config 事件镜像,共 20+ 处靠注释约定同步,无任何编译期或 CI 校验;Events 声明劈 5+ 处,漏写一处该事件类型即静默退化为 any 调用 | client/src/shims.d.ts:18 及各插件镜像文件 |
| 5 | **client 发布面缺 locales**:`files: ["src", "global.d.ts"]` 不含 `locales/`,而 messages.ts 直接 import `../../locales/*.yml`——npm 源码形态构建必炸;当前下游经 client-shim 钉名兜底、宿主产物走 workspace 源码不受影响,暴露面受限但缺陷成立 | client/package.json(files) / client/src/plugins/messages.ts:14-18 |
| 6 | **client data.ts RPC 缺陷组**:receive 每事件仅存一个监听,多模块同注册互相覆盖;RPC 超时 setTimeout 应答后不清理;重连失败 reject 无消费者(unhandled rejection);socket 为 null 时 send 静默 return 与 Promisify 类型不符 | client/src/data.ts:87-93,76-79,169-185,69-70 |
| 7 | **i18n 结构债**:语言清单三处硬编码(client i18n.ts / messages.ts / setting.ts),新增语种需改三处;TS 层与模板硬编码中文普遍(market install.vue 全文、admin/group.vue、logger 页名、components image-viewer/k-filter 等,公共组件硬编码使下游无法覆盖);commands/sandbox 仅 zh-CN;admin/auth/commands 包根非中词典疑似死资产(server 侧仅 define("zh-CN"),是否被内核 locales 自动装载覆盖待核) | client/src/plugins/{i18n,messages,setting}.ts / market/client/components/install.vue / admin/client/group.vue:8 / logger/client/index.ts:44 |
| 8 | **commands 别名重名检测失效**:aliases 是数组,以字符串索引恒 undefined,检测从未生效;代码已有在案注释(以 Reflect.get 忠实复刻错误语义),属待定夺项;正确修法 = 把别名摊平成 Set 按 InputName 查 | commands/client/command.vue:274-283 |
| 9 | **oobe 占位空壳**:18 行 `apply` 空实现,README 声称「引导流程实际逻辑位于 @koishi-ce/client」,但 client 包 grep oobe/引导/first-run 零命中——市场上可装可载,功能在本仓不存在 | oobe/src/index.ts:18 |
| 10 | **前端测试盲区**:builder 路径推算(单点故障面)、client data.ts RPC、messages 词典摘取、config 配置树,四块高风险纯逻辑零测试;market 四视图与 install 面板亦无测试 | 全仓 *.test.* 分布 |
| 11 | **克隆代码组**:image-viewer.vue 与 chat/overlay.vue 的 scale/rotate/工具条几乎整套重写未抽公共件;getShortname 在 config client 与 node registry 两份实现;toValue 解包逻辑在 app 两处 menu-item 重复;dataview client 跨树 import `../src/codec.ts`(exports 未声明该子路径,发布面脆弱) | components/src/image-viewer.vue:44-91 ↔ chat/overlay.vue / config/client/index.ts:49-54 ↔ packages/node/registry/src/local.ts:42 / dataview/client/utils.ts:15-17 |

### P2(中:一致性 / 可访问性 / 死代码 / 脆弱点)

- **死代码组**(均经 grep 反查确认):components 导出 `ChatImage`、`messageBox` 零消费,`SlotItem` 类型无外部消费;app/src/theme/blank.vue 404 兜底页全仓零引用;client `provideStorage/createStorage` 无调用;market `hasUpdate(name)` 单参版已被双参版取代;install.vue 两组死 CSS 与注释掉的 span;computed.vue/auth bind-dialog 空 style 块;element.scss `.left/.right-adjacent` 无使用。
- **文案 bug**:image-viewer.vue:24-27 undo 与 redo 两个按钮 tooltip 均为「逆时针旋转」(redo 应为顺时针)。
- **app 右抽屉链路断裂**:header.vue 声明 `update:isRightAsideOpen` emit 但从不触发,layout.vue 状态恒 false——移动端右栏开合实际不可用。
- **可访问性组**:k-button 禁用仅 class 无 disabled/aria-disabled;k-tab/tab-item 可点击 span 无 role 与键盘支持;image-viewer 图标按钮无 aria-label;header tabindex 1 与 0 混用;app/index.html `lang="zh"` 不随语言切换更新。
- **脆弱点**:client/src/index.ts:41-47 手抄 ScopeStatus 常量(cordis 升级即静默漂移);theme.ts:62 模块顶层 useConfig() 与 i18n 的 TDZ 规避约定矛盾,靠 import 顺序存活;virtual/list.vue scrollToBottom 3ms 无上限重试;item.ts 假定 margin 恒为 px;analytics fuck-echarts 依赖 chunk 文件名含 "echarts" 的文本替换;768px 断点在 6 处重复;`--k-tree-bg-active` 等 3 个 CSS 变量全仓无定义恒走 fallback(疑似冗余或漏定义);components 的 `@koishijs/components` 别名在 npm 下游(workspace 表为空)时值为 undefined 仍写入(builder/src/index.ts:254-255)。
- **一致性**:入口导出形态基本统一(config 的 class 例外合理);图标注册 5 家独立 icons.ts + 2 家内联;dataview 词典手动装载不走 glob;tsconfig.web.json 头注释「17 个 client tsconfig」实为 19 个;builder 走 node 基座属同一前端域两套编译边界;theme-vanilla pale-night.scss 文件名与注册 id `pale-night-dark` 不一致;insight 遗留调试命名 `id="couple"`;logger 的 `import {} from "@koishi-ce/plugin-config"` 空导入仅类型副作用。
- **XSS 面盘点**(受控,列出备查):全前端唯一 `v-html` 在 logger(AnsiUp 默认 escape_html 先转义再上色,风险闭合但换库需回归);markdown `unsafe` prop 跳过消毒,唯一消费点是 config 页 usage 文档渲染,信任边界 = 插件作者;notifier 的 satori 渲染白名单含 img 且 attrs 原样透传,信任边界弱于 k-markdown;market 包描述经 k-markdown(DOMPurify 全链消毒)。

## 4. 正面结论

- **类型纪律贯彻到底**:前端全部源码显式 `any` 为 0,`@ts-ignore` 为 0,仅 console/src/node/index.ts:153 一处带完整说明的 `@ts-expect-error`。
- **XSS 主防线是组件库级而非插件级**:第三方插件描述 / usage 文档渲染统一走 k-markdown 的 DOMPurify 白名单(禁 img、协议白名单、禁 data 属性),插件层无一处绕过。
- **market vendor 边界清晰且带测试**:纯逻辑层四模块 + 3 套测试,视图层单向依赖,上游同步面收敛。
- **console 宿主 server 侧工程质量最高**:穿越判定以产物为基准、双名兼容探测、dist 定位漂移自愈,注释文化完整。
- **依赖声明一致性抽查通过**:client / app / components 三包的 dependencies 与实际 import 对齐,未发现「值导入未声明」类必炸项。
- **图标资产零死账**:133 个集中 svg 全部有消费;许可证头 39/39 合规(AGPL 分区)。

## 5. 建议方向(未拍板,仅列序)

1. **shim 同步校验入闸门**:20+ 处手工镜像中,优先给 console 服务声明(12 处)加「声明面键集对账」check——成本最低、防退化收益最高。
2. **builder 失败路径显式化**:静默 return / catch {} / 吞告警四处改显式报错;顺手把插件组与 uno 配置抽成共享函数(P1-1/P1-2 一次修)。
3. **403 判定白名单前缀化**:node_modules 弱放行改为逐 entry 目录前缀匹配(P1-3,安全加固)。
4. **i18n 收敛专项**:语言清单三处合一、公共组件(components)文案词典化、market install/admin 等硬编码清偿——体量最大,宜单独立项。
5. **data.ts 补测试**:RPC 报文 / responseHooks / patch 合并 / 重连,四块先补用例再动修(P1-6 修复的前置)。
6. **两个待拍板**:oobe 去留(补实或明示占位);commands 别名检测修正(类型与行为一并)。
7. 死代码组与文案 bug 可随日常改动顺手清,不单独立项。
