# 前端结构审计

> **审计日期**:2026-09-25(重审)。上轮审计(b21b1830)完成后,本仓落地了三笔大改(79f9baba console 类型源头共享 / 997d3ab0 components 域分层重组 / ce806906 单测落位),本文档按当日代码从头复核:上轮问题逐条核对现状、新结构重新扫描、重磅发现逐条实证(均带 `file:line` 证据)。
> **方法**:六个分区并行扫描(builder / client+app 宿主 / components / 插件矩阵前后两半 / 横切层)+ 关键结论人工对账(图标资产 133↔133 精确对账、行数口径复核、新机制链路抽查)。
> **范围**:`packages/web/*`(4 包)与 `plugins/webui/*`(19 插件)的 client 侧;server 侧仅看与 client 联动的接口面。
> **口径**:一切以当日代码为准,本文档会过时;滞后时听代码的。
>
> **上轮修复消化速览**(P1 编号指上轮文档):**已修 2 条**——P1-4 主组(console 类型镜像 12 处→0,机制重造为「源头共享+接线+闸门」)、P1-5(client 发布面 locales 入包);**部分修 1 条**——P1-11:其 image-viewer 与 chat/overlay 整套克隆已合流、dataview 跨树 import 已挪 `src/shared/` 并注释(跨树相对导入仍在)、余下 getShortname / toValue 克隆仍在;**原样仍在 8 条**(P1-1/2/3/6/7/8/9/10 全数未动);P2 的 redo 文案 bug 已随合流修复,ScopeStatus 手抄已加编译期对账守卫,logger 空导入已修。

## packages/web 文件树

> 审计基线快照(2026-09-25 重审):已排除 `node_modules/`、`lib/`、`dist/` 产物;`assets/icons/` 的 133 个 svg 折叠为计数行。与上轮快照的差异:app 删 `src/shims.d.ts`;client 新增 `console-services.d.ts`、词典 `locales/` 定位包根;components 重组为八域并去 k- 前缀。

```text
packages/web/
├── app/                                # 宿主壳 @koishi-ce/console-app(§2.2)
│   ├── assets/
│   │   └── logo.png
│   ├── src/
│   │   ├── home/                       # 首页插槽视图
│   │   │   ├── home.vue
│   │   │   └── index.ts
│   │   ├── layout/                     # 三栏骨架与顶栏
│   │   │   ├── header.vue
│   │   │   ├── index.ts
│   │   │   ├── layout.vue
│   │   │   └── menu-item.vue
│   │   ├── settings/                   # /settings 页与主题控件
│   │   │   ├── index.ts
│   │   │   ├── settings.vue
│   │   │   └── theme.vue
│   │   ├── status/                     # 状态栏
│   │   │   ├── index.ts
│   │   │   ├── loading.vue
│   │   │   └── status.vue
│   │   ├── styles/                     # 全局样式层(index/element/hc/layout 四件)
│   │   │   ├── element.scss
│   │   │   ├── hc.scss
│   │   │   ├── index.scss
│   │   │   ├── index.ts
│   │   │   └── layout.scss
│   │   ├── theme/                      # 主题壳(活动栏/菜单/状态栏视图)
│   │   │   ├── activity/
│   │   │   │   ├── button.vue
│   │   │   │   ├── index.vue
│   │   │   │   ├── item.vue
│   │   │   │   ├── separator.vue
│   │   │   │   └── utils.ts
│   │   │   ├── menu/
│   │   │   │   ├── index.vue
│   │   │   │   ├── menu-item.vue
│   │   │   │   └── menu.vue
│   │   │   ├── blank.vue               # 404 兜底(死文件,P2)
│   │   │   ├── index.ts
│   │   │   ├── index.vue
│   │   │   └── status.vue
│   │   ├── index.html
│   │   ├── index.scss
│   │   └── index.ts
│   ├── tsconfig.json
│   ├── package.json
│   ├── CHANGELOG.md
│   └── README.md
├── builder/                            # 构建层 @koishi-ce/console-builder(§2.1)
│   ├── src/
│   │   ├── app.ts
│   │   ├── assemble.ts                 # 宿主总装(console dist)
│   │   ├── bin.ts                      # CLI 入口
│   │   ├── icons.ts                    # unplugin-icons 封装(~icons/k/*)
│   │   ├── index.ts                    # build()/createServer()/collectWorkspaceAliases
│   │   └── yaml.ts                     # .yml transform(Bun.YAML.parse)
│   ├── tsconfig.json
│   ├── tsdown.config.ts
│   ├── package.json
│   ├── CHANGELOG.md
│   └── README.md
├── client/                             # 运行时内核 @koishi-ce/client(§2.2)
│   ├── console-services.d.ts           # console 类型接线文件:14 插件 lib 产物副作用导入(§2.5)
│   ├── locales/                        # 宿主词典 7 语(包根,已入发布面 files)
│   │   ├── de-DE.yml … zh-TW.yml
│   ├── src/
│   │   ├── plugins/                    # 七服务(action/i18n/loader/router/setting/theme/messages)
│   │   │   ├── action.ts
│   │   │   ├── i18n.ts
│   │   │   ├── loader.ts
│   │   │   ├── messages.ts
│   │   │   ├── router.ts
│   │   │   ├── setting.ts
│   │   │   └── theme.ts
│   │   ├── context.ts
│   │   ├── data.ts                     # WebSocket/RPC/patch(P1-4)
│   │   ├── index.ts                    # 含 ScopeStatus 编译期对账守卫
│   │   └── utils.ts
│   ├── global.d.ts
│   ├── tsconfig.json
│   ├── package.json
│   ├── CHANGELOG.md
│   └── README.md
├── components/                         # UI 库 @koishi-ce/components(§2.3)
│   ├── assets/
│   │   ├── icons/                      # 集中图标资产:133 个 .svg(133↔133 对账零死账零断链)
│   │   └── README.md
│   ├── src/
│   │   ├── chat/                       # 聊天图(经 display/image-viewer/state 共享接入查看器)
│   │   │   └── image.vue
│   │   ├── common/                     # 基础原子件
│   │   │   ├── button.vue
│   │   │   ├── hint.vue
│   │   │   ├── index.ts
│   │   │   ├── link.ts
│   │   │   └── tab.vue
│   │   ├── core/                       # 纯逻辑与基建(无视图)
│   │   │   ├── injection.ts
│   │   │   ├── markdown.test.ts
│   │   │   ├── markdown.ts             # marked + DOMPurify 消毒管线
│   │   │   └── slot.ts                 # KSlot 具名插槽合并
│   │   ├── display/                    # 展示域
│   │   │   ├── comment.vue
│   │   │   ├── markdown.ts
│   │   │   └── image-viewer/           # 双查看器合流后的共享实现
│   │   │       ├── overlay.vue         # 全屏查看器
│   │   │       ├── state.ts            # 双方共享的全屏图状态
│   │   │       ├── toolbar.scss        # 工具条 mixin
│   │   │       ├── toolbar.vue         # 工具条组件
│   │   │       ├── use-transform.ts    # 缩放/旋转变换共享抽象
│   │   │       └── viewer.vue          # 容器内查看器
│   │   ├── form/                       # schemastery 扩展与 filter 三件套
│   │   │   ├── computed.vue
│   │   │   ├── dynamic.vue
│   │   │   ├── filter.vue
│   │   │   ├── filter-button.vue
│   │   │   ├── filter-expr.vue
│   │   │   ├── filter-types.ts
│   │   │   ├── index.ts
│   │   │   ├── perms.vue
│   │   │   ├── schemastery-client.ts   # 双轨:类型载体
│   │   │   └── schemastery-runtime.ts  # 双轨:运行时载体
│   │   ├── icons/                      # 图标注册表与 k-icon 渲染层
│   │   │   ├── index.ts
│   │   │   ├── style.scss
│   │   │   └── virtual.d.ts
│   │   ├── layout/                     # 容器排版 card/content/empty/tab-group
│   │   │   ├── card.vue
│   │   │   ├── content.vue
│   │   │   ├── empty.vue
│   │   │   ├── index.ts
│   │   │   ├── tab-group.vue
│   │   │   └── tab-item.vue
│   │   ├── virtual/                    # 虚拟列表(模型/测量/滚动壳)
│   │   │   ├── index.ts
│   │   │   ├── item.ts
│   │   │   ├── list.vue
│   │   │   ├── virtual.test.ts
│   │   │   └── virtual.ts
│   │   ├── index.scss
│   │   ├── index.ts
│   │   └── shims.d.ts                  # ambient 垫片(schemastery 双轨之一,P1-10)
│   ├── tsconfig.json
│   ├── package.json
│   ├── CHANGELOG.md
│   └── README.md
```

## 1. 总览

### 1.1 基线数据

前端合计约 **4.6 万行** 源码(23 个前端单元,client/ + src/ 的 ts/vue/scss,不含 svg / yml 词典 / lottie 数据):

| 包 | 行数 | 包 | 行数 |
| --- | ---: | --- | ---: |
| plugins/webui/market(含 vendor) | 9731 | plugins/webui/sandbox | 1866 |
| plugins/webui/config | 4483 | plugins/webui/console | 1776 |
| packages/web/components | 4335 | plugins/webui/analytics | 1756 |
| packages/web/app | 2688 | plugins/webui/dataview | 1594 |
| plugins/webui/explorer | 2359 | plugins/webui/status | 1425 |
| plugins/webui/auth | 2359 | plugins/webui/insight | 1217 |
| plugins/webui/commands | 2177 | plugins/webui/logger | 999 |
| packages/web/client | 1996 | packages/web/builder | 893 |
| plugins/webui/admin | 1984 | plugins/webui/locales | 778 |
| plugins/webui/notifier | 650 | plugins/webui/theme-vanilla | 299 |
| plugins/webui/welcome | 289 | plugins/webui/oobe | 62 |
| plugins/webui/actions | 56 | | |

### 1.2 五层架构图景

自底向上,分层基本清晰、单向依赖:

1. **构建层 `@koishi-ce/console-builder`**(893 行):无 vite 配置文件的纯编程式构建。`bin.ts` CLI 分流单插件 build 与宿主总装(assemble);`collectWorkspaceAliases` 从根 workspaces 声明收集跨包别名表;单插件产物 `client/index.ts → dist/{index.js,style.css}`,插件可自带 `build/client.ts` 覆盖配置(仓内唯一使用者是 analytics 的 fuck-echarts);devMode 走 `createServer` middlewareMode 挂 `/vite/`,宿主静态资产经 `publicDir: "../assets"` 接线。
2. **UI 库 `@koishi-ce/components`**(45 文件,八域):经 997d3ab0 授权豁免上游对齐后重组为 core(纯逻辑)/ common(基础件)/ form(表单)/ display(展示)/ layout(容器)/ virtual(虚拟列表)/ chat / icons 八域,文件去 k- 前缀,域间依赖全部自上而下;双图片查看器合流进 `display/image-viewer/`(use-transform + toolbar 两层共享)。element-plus 全量安装,主题经 `--el-* → --k-*` 变量映射定制;133 个集中 svg 图标经 `~icons/k/*` 虚拟模块消费。
3. **运行时内核 `@koishi-ce/client`**(13 文件):无界面浏览器内核。构造 cordis 根 Context,装 action/i18n/loader/router/setting/theme/messages 七服务;`data.ts` 承担 WebSocket 收发、patch 合并与 id 关联 RPC;`console-services.d.ts` 接线文件把 14 个插件的 console 服务类型增强经 lib 产物拉入浏览器类型程序(§2.5);对 components 做全量二次转出保住插件历史导入面。
4. **宿主壳 `@koishi-ce/console-app`**(31 文件):六个内置插件(home/layout/settings/status/theme)向具名插槽注册默认视图,order ±1000 抢占首末位;样式层以 `--bg*/--fg*/--k-*` CSS 变量为单一事实源,暗色由 client theme 服务写 `<html theme>` + `.dark`。
5. **插件矩阵 `plugins/webui/*`**:19 插件中 16 个有 client。统一模式:单入口 `export default (ctx) => {...}` + `ctx.page()/slot()` 注册视图 + `icons.register()` 补注图标 + 词典经 `import.meta.glob` + `extendLocales` 装载;RPC 全部走 DataService(store 订阅)抽象,无插件级裸 WebSocket。console 宿主插件(server 侧)负责静态资产服务与 entry 产物基准,工程质量为矩阵之最。

**market 的 vendor 分界**(本仓最大前端单元):`client/vendor/`(domain/search/sort/icons 四模块,自上游逻辑层收编)为纯逻辑层,视图四组件(filter/list/package/search)只从 vendor 导入、无反向依赖;domain/search/sort 三模块带测试(7eef1187 拆分后 market client 侧测试共 7 个),icons.ts 无测试。

## 2. 分区审计

### 2.1 构建体系(builder)

构建契约清晰(dist 命名、`build/client.ts` 接线、产物后处理改名),happy path 自洽;主要短板与上轮一致:**失败路径普遍「静默降级」而非显式失败**,同一套插件组装在三处复制粘贴(见问题清单 P1-1/P1-2)。审计后的提交仅做 schemastery runtime 路径迁移(997d3ab0)与 publicDir 对齐(0800eec2),上轮问题无一修复。正面样板:`app.ts` 的 locateApp 解析失败显式 throw 并注释「须显式失败而非静默回退」,`runtimeShimPath` 用条件展开在探测失败时省略别名键——同一意识应补到 `@koishijs/components` 别名(P2 脆弱点)。

### 2.2 client 内核与 app 宿主壳

服务初始化顺序明确(构造期 action→i18n→loader→router→setting→theme→messages,ready 后 await loader.initTask 再 mount),`messages.ts` 独立成模块断开了 i18n↔setting 的依赖环。app 与 client 的分界以 `ctx.page/slot/settings/schema/theme` mixin API 实现,基本干净;越界点仍是 app 直读 `ctx.internal.*` 与 `client/utils.ts` 的 scrollActiveTree 直查 element-plus 树节点 DOM。`data.ts` 的 RPC 缺陷组(P1-4)本轮经核实:79f9baba 只动了 Store 载荷推导(类型层),运行时四缺陷剩三点半(重连链已有第二参 handler,但应用**首次**连接的 Promise 在 `app/src/index.ts:38-41` 裸调无消费者,unhandled rejection 残留点转移)。

### 2.3 components 组件库

重组后域分层质量高:47 处文件落位与根入口 `index.ts:5-29` 的域说明逐域对应,导出面与重组前逐条比对**完全一致**("导出面 100% 不变"属实),域间依赖无反向(chat→display 经 state.ts 有向接入且双向注释闭环),图标链路完整。工程质量保持:零 `any`、markdown 消毒层(DOMPurify 标签白名单 + 协议白名单 + 刻意禁 img)回归测试钉死行为、schemastery-vue 双轨机制未变。双查看器合流干净:变换状态(use-transform.ts)、工具条(toolbar.vue/.scss)、shared 状态(state.ts)各只有一份,`viewer.vue` 与 `overlay.vue` 各自组合调用。短板:可访问性三项(按钮禁用/tab 可点击 span/查看器图标按钮)全部未动,存量死代码组有意未清(与上轮「随日常改动顺手清」的排期一致),toolbar.scss 头注释仍是重组前的旧文件名(唯一漏改)。

### 2.4 webui 插件矩阵

16 个有 client 的插件横向高度一致(单入口函数、slot 注册、DataService RPC);icons.register 经叶子 `client/icons.ts` 收口的 9 家 + 入口内联 4 家(admin/auth/commands/locales),无新恶化。三个维度的存量不一致依旧:词典位置与装载方式(dataview 手动 7 语 import、insight/welcome/analytics/market 走 glob、logger/sandbox/locales/status/notifier/theme-vanilla 无 UI 词典);**页名硬编码中文是系统性问题**(≥9 处 `ctx.page name`,非 logger 孤例——上轮口径偏窄);market install.vue / admin group.vue / auth login-form / commands 全文硬编码。**oobe 经复核仍为占位空壳**(P1-7),且审计后给空壳补了一个「空 apply 可加载可停止」的测试,属负价值覆盖;**actions 则承诺属实**——动作机制真在共享基座 `packages/web/client/src/plugins/action.ts`(290 行 ActionService),README 如实声明,与 oobe 本质不同。

console 宿主插件(server 侧)工程质量仍是矩阵之最:403/404 判定的 `@plugin-*` 分支以 entry 自身产物路径为基准严格前缀匹配(assets.ts:141-150)、devMode 源码形态直接 404、findDistRoot 修正 dist 定位漂移;79f9baba 给 `Console.get` 补了显式返回类型标注(node/index.ts:178-186),修在源头是正确落点(推断签名经 tsdown 生成 d.ts 会丢展开的索引签名部分),残余风险是该标注上游同步时仅靠注释防护(P2)。

### 2.5 横切层:类型 / 样式 / i18n / 测试 / tsconfig

**类型体系——本轮最大改善:console 类型源头共享**(79f9baba)。机制从「client 侧 12 处手写镜像 + 纯注释约定」重造为六步链路:

1. **声明**:各插件在 node 侧 src 写 `declare module "@koishi-ce/console"` 增强 Services/Events(唯一事实源,现 17 文件/14 插件);
2. **携带**:增强随 `lib/index.d.ts` 产物输出;
3. **解析**:基座 `tsconfig.client.json` paths 把包名映射到 lib 产物 d.ts;
4. **接线**:`packages/web/client/console-services.d.ts` 用 14 行副作用导入把全部插件产物拉进类型程序,经基座 `files` 下发进每个 client 子工程;
5. **对账**:`tooling/checks/console-wiring.ts` 双向对账(node 侧有增强的包集合 ↔ 接线文件导入包集合;基座 paths 键集 ⊆ tsconfig.web.json 键集——extends 的 paths 是整体替换语义),接入 `bun run check` 第 9 段;
6. **文档**:development.md 已知坑 + AGENTS.md 同步。

配套收敛:logger 三处手写 LogRecord 副本收敛为 `client/record.ts` 从 Store 结构化推导;explorer 事件镜像删除;`data.ts` Store 载荷改结构化推导(对继承深度/abstract 免疫);client 侧 `shims.d.ts` 全删。**残余**:schemastery-vue 双镜像仍在(components/src/shims.d.ts ambient 垫片 ↔ form/schemastery-client.ts 真实模块,有技术原因但无一致性闸门,P1-10);client 侧仍有 10 处 `declare module "@koishi-ce/client"` 真实增强(非镜像、唯一声明地),但无跨工程接线——插件单编时看不到其他插件的增强,仅大一统程序内生效(P2 脆弱点)。

**样式体系**:unocss 仍内联 builder 三处(无独立配置文件);真实引 `virtual:uno.css` 的入口 15 个(app 1 + 插件 14)。768px 断点从上轮 6 处扩散到 **22 处/13 文件**,无共享断点 token;无定义 CSS 变量从 3 个涨到 **6 个**(4 个带 fallback:`--k-tree-bg-active/--k-status-bg/--k-status-divider/--k-activity-divider`;新增 2 个**无 fallback**:`--k-c-divisor` status/client/load/load-bar.vue:78、`--k-side-color` welcome/client/welcome.vue:114,未定义即样式静默失效);dark 侧 apply-color 列表缺 `--k-color-info`(index.scss:101-105 比 light 侧 :54-59 少一项)。

**i18n 词典**:语种清单硬编码 **3+1 处**(client 的 i18n.ts/messages.ts/setting.ts 各一份 + tooling/checks/locales.ts 闸门一份),无对账,新增语种仍需四处齐改;TS 层与模板硬编码中文普遍且系统性(market install.vue 全文、admin group.vue、auth login-form、commands、≥9 处页名);market 包根词典 12/14 文件死资产(仅 zh-CN 两件被 node 侧导入);admin/auth 包根词典同模式(7 语仅 zh-CN 被导入);market version.vue 同文件双语文机制混用呈半翻译态。

**测试盘点**:前端 client 侧 10 个测试文件(components 2、explorer 1、market 7),server 侧 31 个。真正裸奔的高风险纯逻辑与上轮完全一致:builder 的 collectWorkspaceAliases 路径推算、client 的 data.ts RPC、messages 词典摘取、config 的 tree/utils,四块零测试。另 builder 目录全仓零测试文件。

**tsconfig 双编译器分界**:三层结构未变(基座 tsconfig.client.json → tsconfig.web.json 大一统 → 19 个 client 子工程),但 34100bd7 后插件级大幅瘦身(7/16 已零 paths,其余仅 1-2 条本工程特有映射);基座→web 的 paths 整体重写重复仍在,由 console-wiring 闸门对账兜底。两个失准:tsconfig.web.json 头注释「17 个 client tsconfig」实测 19 个(16→17→19 第三次漂移,无闸门);market/client/tsconfig.json 的 `schemastery-vue/client` 指向已不存在的 `src/schemastery-vue-client.ts`(997d3ab0 已移至 form/,当前未 import 故为哑弹,一旦使用即 TS2307;2026-09-25 已随 IDE 归属修复改指 form/schemastery-client.ts,见 development.md §7 条 21)。builder 属前端域仍走 node 基座。

**vue-tsc 影子闸门**:健康运转,基线 26→31 键(净增 5 键全部有 commit 级归因:locales.vue 的 EditableStore vs I18n.Store 消费端类型债,commit 自述待专项清偿);闸门脚本未变。

## 3. 问题清单

### P1(高:正确性 / 发布面 / 安全 / 结构性重复)

| # | 问题 | 证据 |
| --- | --- | --- |
| 1 | **builder 失败路径静默降级组**:裸包名/路径拼错 → `client/` 不存在 → 静默 return 零产物零报错,CLI exit 0 无法区分「没有前端」与「路径错了」;`findModulePath` indexOf 切片 -1 时静默产出畸形路径(pnpm store/非标布局下触发);`assertRepoLayout` 仅查 cwd 有 package.json;`build()` **先删 dist 再构建**,失败时旧产物已清零且无回滚;"imported multiple times" 告警按文本 includes 吞掉(未按 warning.id 圈定),真实循环依赖告警一并被吞;工作区 manifest 读失败空 catch 静默跳过全部别名 | bin.ts:53-57 / index.ts:149,163-167,101,189-201 / assemble.ts:45-55,68-74 |
| 2 | **builder 重复组**:`BuildResult` 接口两处同构定义(注释自认);icons+vue(comments:false)+yaml+unocss 插件组装在 index.ts 两处与 assemble.ts 一处复制粘贴,uno 配置三份各写一遍,iconsPlugin 三次重复初始化 | index.ts:30-37,215-239,331-351 / assemble.ts:29-37,131-145 |
| 3 | **console 主体资源 403 判定弱放行**:主体分支路径含 `"node_modules"` 子串即绕过 root 前缀约束,可借 `../` 构造穿越读取 root 外同串路径文件;对照同文件 `@plugin-*` 分支已是严格 `base + sep` 前缀判定,主体分支应对齐 | console/src/node/assets.ts:165-171(对照 :141-150) |
| 4 | **client data.ts RPC 缺陷组**:`receive` 每事件仅存一个监听多模块同注册互相覆盖(且核心模块自占 "data"/"patch"/"response",插件误用同名事件即静默顶掉 store 同步,无任何防护);RPC 超时 setTimeout 应答后不清理;应用首次连接的 Promise 裸调无消费者(unhandled rejection);socket 为 null 时 send 静默 return 与 Promisify 类型不符 | data.ts:87-96,76-83,73 / app/src/index.ts:38-41 |
| 5 | **i18n 结构债(恶化)**:语言清单硬编码 3+1 处(client i18n.ts/messages.ts/setting.ts + locales 闸门),无对账;页名硬编码中文 ≥9 处(logger/auth/locales/commands/admin/market/sandbox),公共可见面系统性无 i18n;market install.vue 全文、admin group.vue、auth login-form、commands 全文硬编码;market version.vue 同页双语文机制混用呈半翻译态;包根死词典组:admin/auth 7 语仅 zh-CN 被导入(其余 6 语死资产)、market 14 件仅 2 件被导入(12 件死资产) | messages.ts:14-31 / setting.ts:165-173 / i18n.ts:115-142 / logger/client/index.ts:20 等 / market/client/components/install.vue / market/src/node/index.ts:17-18 |
| 6 | **commands 别名重名检测失效**:aliases 是数组,以字符串索引恒 undefined,检测从未生效;代码已有在案注释(以 Reflect.get 忠实复刻错误语义),属待定夺项;正确修法 = 把别名摊平成 Set 按 InputName 查 | commands/client/command.vue:267-283 |
| 7 | **oobe 占位空壳**:18 行 `apply` 空实现,README 声称「引导流程实际逻辑位于 @koishi-ce/client」,但 client 包 grep oobe/引导/first-run 零命中——市场上可装可载,功能在本仓不存在;审计后还给空壳补了「空转测试」,为不存在功能维护测试资产 | oobe/src/index.ts:18 / oobe/src/index.test.ts |
| 8 | **前端测试盲区**:builder 路径推算(单点故障面)、client data.ts RPC、messages 词典摘取、config 配置树,四块高风险纯逻辑零测试;builder 目录全仓零测试 | 全仓 *.test.* 分布 |
| 9 | **克隆代码组(收窄后残余)**:getShortname 在 config client 与 node registry 两份实现(正则逐字符一致,已注释声明对齐,无一致性闸门);toValue 解包在 app 两处 menu-item 重复且行为漂移(theme 版每次调用新建 cordis scope,同次渲染 label/icon/action 拿到的不是同一实例,layout 版复用单 scope);dataview client 跨树 import `../src/shared/codec.ts`(exports 未声明该子路径,包面替代路径存在但未采用) | config/client/index.ts:49-54 ↔ packages/node/registry/src/local.ts:42-47 / app/src/theme/menu/menu-item.vue:16,59-67 ↔ layout/menu-item.vue:49-64 / dataview/client/utils.ts:19 |
| 10 | **schemastery-vue 双镜像无闸门**:ambient 垫片(shims.d.ts)与真实模块(schemastery-client.ts)是同一套实体的两份声明,两侧注释互指「必须同步修改」但无编译期或 CI 校验;有技术原因(compiler-sfc 只认 paths 指向的真实文件),闸门形式 = 两侧实体清单 diff | components/src/shims.d.ts:14-16 ↔ form/schemastery-client.ts:18-19 |

### P2(中:一致性 / 可访问性 / 死代码 / 脆弱点)

- **死代码组**(均经 grep 反查确认):components 导出 `ChatImage`、`messageBox` 零消费(`SlotItem` 非纯死——接口被 core/slot.ts 内部继承,死的只是 export 关键字);app/src/theme/blank.vue 404 兜底页全仓零引用;client `provideStorage/createStorage` 无调用(createStorage 已标 @deprecated);install.vue 两组死 CSS(`.version-badges`/`span.link`)与注释掉的 span;computed.vue 空 style 块;auth bind-dialog 空 style 块;element.scss `.left/.right-adjacent` 无使用;layout.vue 的 `is-right-aside-open` 类名钩子无任何 CSS 消费(随右抽屉断链一并裁决);oobe 空转测试(见 P1-7)。
- **app 右抽屉链路断裂(双重)**:header.vue 声明 `update:isRightAsideOpen` emit 但全文件唯一 `$emit` 是左栏的,layout.vue `v-model` 白绑状态恒 false;且移动端媒体查询只有左栏抽屉规则,右栏抽屉 CSS 根本不存在——移动端右栏开合完全不可用。
- **可访问性组**:button.vue 禁用仅 class 无 disabled/aria-disabled、`outline: 0` 抹掉键盘焦点环;tab.vue 与 hint.vue 可点击 span 无 role/键盘支持;image-viewer 图标按钮与 overlay 左右切换均无 aria-label/role;header toggle-menu-button `tabindex="1"` 与邻项 0 不一致;app/index.html `lang="zh"` 不随语言切换更新。
- **脆弱点**:theme.ts 模块顶层 useConfig() 与 i18n 的 TDZ 规避约定矛盾,靠 import 顺序存活;virtual/list.vue scrollToBottom 超时重试无上限;item.ts 以 `marginTop.slice(0, -2)` 假定 margin 恒为 px;analytics fuck-echarts 依赖 chunk 文件名含 "echarts" 的文本替换;768px 断点 22 处/13 文件无共享 token;无定义 CSS 变量 6 个(其中 2 个无 fallback,见 §2.5);`--k-color-info` dark 侧缺定义;`@koishijs/components` 别名在 npm 下游(workspace 表为空)时值为 undefined 仍写入 alias,同文件 runtimeShimPath 却有条件守卫——明显不一致;**market/client/tsconfig.json 的 `schemastery-vue/client` 指向已不存在的文件**(重组后的哑弹路径,paths 无存在性校验);client 侧 10 处 `declare module "@koishi-ce/client"` 增强无跨工程接线,插件单编程序看不到其他插件的增强(仅大一统程序生效,无文档无闸门);console `Console.get` 显式标注防上游同步删改仅靠注释。
- **一致性**:图标注册 9 家独立 icons.ts + 4 家入口内联;dataview 词典手动装载不走 glob;tsconfig.web.json 头注释「17 个 client tsconfig」实测 19 个(第三次漂移);builder 走 node 基座属同一前端域两套编译边界;theme-vanilla pale-night.scss 文件名与注册 id `pale-night-dark` 不一致(已注释自述);insight 遗留调试命名 `id="couple"`;image-viewer/toolbar.scss 头注释仍是重组前旧文件名;components 的 core/display/chat 三域无子 index.ts(common/form/layout/virtual 有),根入口深导入,域入口不对称;空导入换皮:`import {} from "@koishi-ce/plugin-config"` 等 4 处仅类型副作用(logger 旧空导入已修)。
- **market 一致性**:`hasUpdate` 双实现并存(client/utils.ts:11 的 store 查表单参版仍被 extensions/version.vue 消费——上轮「已被双参版取代」系误判;dependencies/ignore-policy.ts:44 的纯函数双参版),语义重叠仅失败值不同(undefined/false),无注释互指。
- **XSS 面盘点**(受控,列出备查):全前端唯一 `v-html` 在 logger(AnsiUp 默认 escape_html 先转义再上色,风险闭合但换库需回归);markdown `unsafe` prop 跳过消毒,唯一消费点是 config 页 usage 文档渲染,信任边界 = 插件作者;notifier 的 satori 渲染白名单含 img/audio/video 且 attrs 原样透传,信任边界弱于 k-markdown;market 包描述经 k-markdown(DOMPurify 全链消毒);**KOISHI_CONFIG 注入未做 `</script>` 防逃逸**(JSON.stringify 直插 script 标签,上游同病,低危,建议登记待办)。

## 4. 正面结论

- **console 类型源头共享是审计后质量最高的改动**:client 侧镜像 12→0,单一事实源 + lib 产物携带 + 接线文件 + 双向对账闸门(check 第 9 段)+ 文档齐备;noUncheckedSideEffectImports 兜底使断链响亮报错而非静默;配套的 Store 结构化推导、LogRecord 收敛、explorer 镜像删除一并落地。
- **图标资产精确对账零死账**:133 个集中 svg 与全仓 133 个 `~icons/k/*` 引用名(152 处消费点)**完全一致**——零死资产、零断链、零指向缺失。
- **components 域分层重组经逐条验证属实**:导出面 100% 不变、域间无反向依赖、双查看器合流干净(变换/工具条/状态各一份)、133 svg 无断链、schemastery 双轨机制完好、文件命名一致。
- **类型纪律贯彻到底**:client 侧显式 `any` 为 0、`@ts-ignore`/`@ts-nocheck` 为 0;全前端唯一豁免是 console/src/node/index.ts:153 一处带完整说明的 `@ts-expect-error`。
- **P1-5(client 发布面)修复彻底**:package.json files 现含 `locales` 与 `console-services.d.ts`,词典包根定位与 messages.ts/i18n.ts 引用路径三方一致。
- **ScopeStatus 手抄已缓释**:client/src/index.ts:49-57 编译期双向对账守卫,cordis 升级增删枚举值即类型报错。
- **XSS 主防线是组件库级而非插件级**:第三方插件描述 / usage 文档渲染统一走 k-markdown 的 DOMPurify 白名单,插件层无一处绕过;logger v-html 走 AnsiUp 先转义。
- **market vendor 边界清晰且带测试**:纯逻辑层四模块 + 3 套测试,视图层单向依赖,上游同步面收敛。
- **console 宿主 server 侧工程质量最高**:`@plugin-*` 分支穿越判定以产物为基准严格前缀匹配、dist 定位漂移自愈、`Console.get` 显式标注修在源头。
- **vue-tsc 影子闸门与 check 九段闸门链健康运转**:新增键全部有 commit 级归因,闸门零依赖 bun 直跑。

## 5. 建议方向(未拍板,仅列序)

1. **builder 失败路径显式化 + 组装去重**(P1-1/P1-2 一次修):静默 return / 空 catch / 吞告警改显式报错;`build()` 先构建到临时目录成功后再替换 dist;插件组与 uno 配置抽共享工厂。风险最集中的单点,且 builder 至今零测试,动手前先补 collectWorkspaceAliases 用例(P1-8 之前置)。
2. **403 主体分支前缀化**:对齐同文件 `@plugin-*` 分支的 `base + sep` 严格判定(P1-3,安全加固,改动面小)。
3. **data.ts 补测试再修**:RPC 报文 / responseHooks / patch 合并 / 首连失败,四块先补用例;修复时顺手加 receive 重名告警(P1-4)。
4. **i18n 收敛专项**:语种清单 3+1 处收敛为单一清单 + 对账闸门;页名与公共组件硬编码清偿;包根死词典裁决(删或接);market version.vue 半翻译补齐——体量最大,宜单独立项。
5. **两个待拍板**(上轮遗留):oobe 去留(补实或明示占位,顺手处理空转测试);commands 别名检测修正(类型与行为一并)。
6. **schemastery 双镜像实体清单对账闸门**(P1-10):两边实体 diff 即可,成本最低。
7. **tsconfig 卫生**:market client 哑弹路径改指 form/schemastery-client.ts;web.json 头注释数字删除(计数交给闸门)或改为不写具体数。
8. 死代码组、可访问性组、CSS 变量与 768px 收敛可随日常改动顺手清,不单独立项。
