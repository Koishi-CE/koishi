# 前端组织规范性审查（FRONTEND STRUCTURE AUDIT）

> 对 `packages/web/*` 与 `plugins/webui/*` 前端代码组织的一次**现势审查快照**：实然职责说明、约定锚点、问题清单与整改建议。本文只做盘点与论证，不含任何代码改动。
> **状态**：现势快照（2026-09-22 实测，全部数字为该日在本仓实跑统计）；§5 的整改建议为讨论稿，落地前需维护者确认。相关：[../reference/architecture.md](../reference/architecture.md) §4 构建体系 · [../process/upstream.md](../process/upstream.md) Restructure map · [../guides/development.md](../guides/development.md) §3。
> **落地进度**：§5.1 P1（拆分 `packages/web/client`）已分两步落地完成——**第一步**：node 侧构建器与宿主总装拆为 `packages/web/builder`（`@koishi-ce/console-builder`）；**第二步**：宿主 SPA 拆为 `packages/web/app`（`@koishi-ce/console-app`）。`@koishi-ce/client` 由此收窄为纯浏览器运行时库。**原文 §5.1 的「`private: true`」设想不成立**（已实测）：console 宿主的 `devMode` 在运行期按包名解析宿主 SPA 目录，故 `app` 必须可发布——第二步顺带把它从 client 的发布节奏里解耦出来。本文 §2 / §4 描述的是**拆分前**结构，读数前先对照 [../reference/architecture.md](../reference/architecture.md) 的现势包清单。
> **本文结构**：1 范围与方法 · 2 职责说明（实然结构）· 3 约定锚点 · 4 问题清单 · 5 整改建议 · 6 附录：职责速查表。

## 1. 范围与方法

### 1.1 范围

审查对象为仓库内全部浏览器侧代码与承载它们的包结构：

- `packages/web/client`（宿主应用 + 前端运行时 + 构建器）
- `packages/web/components`（共享组件库）
- `plugins/webui/*`（19 个控制台插件的 `client/` 前端侧）

**不在范围**：`packages/node/*`、`plugins/{common,infra}/*`、`apps/*`、`tooling/*`；`plugins/webui/*/src/`（Node 侧）只在需要说明与 `client/` 的关系时提及。

### 1.2 方法

- 全量文件树扫描，排除 `node_modules/` / `lib/` / `dist/` 三类产物与依赖噪声。
- 对构建接线、类型接线、包元数据做源码级核对（不使用推测）。
- 结论口径：**实测到的差异才记为问题**；每条问题附证据路径，未与上游对账的事项显式标注。

### 1.3 基线数据（2026-09-22 实测）

| 指标 | 数值 |
|---|---|
| 源文件总数（不含 node_modules / lib / dist） | 716 |
| `.vue` / `.ts` / `.yml` / `.json` / `.md` / `.scss` / 其他 | 249 / 222 / 117 / 61 / 42 / 23 / 2 |
| `packages/web` 包数 | 2 |
| `plugins/webui` 包数 | 19 |
| `icons/` 目录数 / 其中的 `.vue` 图标文件 | 15 / 155 |
| `locales/` 目录数 | 17 |
| 前端侧测试文件（`client/` 下 `*.test.ts`） | 8（其中 6 个在 `market`） |

### 1.4 结论摘要

**架构方向没有问题**：`插件 client/ 源码 + 插件 dist/ 产物 + console 宿主统一总装 + 运行时共享块（vue / vue-router / vueuse / @koishi-ce/client 各一份）` 是本仓库前端的基本盘，它让每个控制台插件可独立发布、可独立构建，同时避免运行时出现多份 Vue 实例。这套约定源自上游 webui，有明确的工程理由，**不应推翻**。

**规范性问题集中在三处**，按严重度递减：

1. `packages/web/client` 一个包承担四种互不相干的职责，其中「给下游用的库」与「本仓自用的宿主源码」共用同一个版本号与发布单元；
2. 图标资产没有单一来源，同义图标在 `packages/web/client` 与 `market` vendor 树之间重复定义（27 组重名）；
3. `locales/` 与 `client/locales/` 双份同构、`src/browser/` 与 `client/` 与 `dist/` 三个"前端"概念无统一命名，新人无法从路径判断消费方。

其余为一致性与命名层面的欠账（§4.2、§4.3），不影响功能，但持续产生认知成本与漏改风险。

---

## 2. 职责说明（实然结构）

本节回答"每个目录到底是干什么的"——这是后续一切规范讨论的基础。以下职责均以源码与包元数据为准。

### 2.1 三个地理分区

前端代码分布在三个顶层位置，三者职责边界清晰：

| 位置 | 运行位置 | 职责 |
|---|---|---|
| `packages/web/client` | 构建期 + 浏览器 + Node | 宿主 SPA 源码、对外发布的浏览器运行时库、编程式构建器与 CLI |
| `packages/web/components` | 浏览器 | 共享组件库源码（无独立构建，被 console 打包器消费） |
| `plugins/webui/*/client/` | 浏览器 | 各控制台插件的前端实现（Vue 组件 + 控制台注册），构建为同包 `dist/` |

### 2.2 `packages/web/client`：一个包、四种职责

这是全仓前端最复杂的一个包。包内四个目录分属四个不同的生命周期：

| 目录 | 职责 | 消费方 | 是否随 npm 发布 |
|---|---|---|---|
| `app/` | 宿主控制台 SPA 源码：注册 home / layout / settings / status / styles / theme 六个内置插件，启动根 Context，非静态模式下建 WebSocket | 本仓总装脚本（构建期）与 `createServer()` 开发服务器（运行期） | 发布（`files` 含 `app`） |
| `client/` | 对外发布的浏览器运行时库 `@koishi-ce/client` 的源码：根 Context 创建、六个核心服务（action / i18n / loader / router / setting / theme）、内置组件（chat / common / icons / layout）、数据层（`data.ts`）、工具 | 宿主 app、各 webui 插件的浏览器端 | 发布（作为包默认入口） |
| `src/` | Node 侧：编程式构建器 `build(root)`、开发服务器 `createServer(baseDir)`、yaml 插件、`koishi-console` CLI 入口 | 本仓构建命令、各插件自带构建脚本、下游 | 发布（`lib/` 产物） |
| `scripts/client.ts` | 宿主控制台前端的**总装脚本**：依次构建 app、拷贝 vue runtime、构建 vue-router / @vueuse 外部块、构建 client 库（element-plus 单独 chunk），全部输出到 `plugins/webui/console/dist` | 仅本仓（经 CLI 的默认分支调用） | 不发布（`files` 不含 `scripts`） |

**关键接线**：`exports["."]` 同时存在两个语义相反的入口——`"source": "./src/index.ts"`（Node 侧构建器）与 `"default": "./client/index.ts"`（浏览器侧组件库）。`createServer()` 以 `resolve(import.meta.dir, "../app")` 定位宿主入口，即 `app/` 在**开发模式运行期**被消费，不只是构建期资源。

`client/` 内部的分工：

| 路径 | 职责 |
|---|---|
| `client/index.ts` | 库主入口：创建根 Context、安装组件库、`export *` 汇总公共 API、声明可被插件 `declare module` 合并增强的 `ActionContext` / `ClientConfig` |
| `client/context.ts` | 根 Context 与 `Internal` 接口 |
| `client/data.ts` | 控制台数据层（与服务端同步的响应式状态） |
| `client/utils.ts` | 工具与 `Service` 基类 |
| `client/plugins/` | 六个核心服务插件（action / i18n / loader / messages / router / setting / theme） |
| `client/components/` | 组件与图标（详见 §4.1 A2、§4.2 B3） |
| `client/locales/` | 库自带词典（7 语言） |

### 2.3 `packages/web/components`

| 路径 | 职责 |
|---|---|
| `client/index.ts` | 库入口：`export *` 表单与虚拟列表，`export default` 安装函数（注册 `k-comment` / `k-image-viewer` 全局组件） |
| `client/form/` | 表单：`schemastery-vue` 集成、`k-filter` 条件过滤器族 |
| `client/virtual/` | 虚拟列表（`list.vue` + `virtual.ts` + `item.ts`） |
| `client/image-viewer.vue`、`client/k-comment.vue` | 两个通用展示组件，平铺在 `client/` 根 |
| `client/schemastery-vue-{client,runtime}.ts` | 虚拟子路径 `schemastery-vue/client` 的类型载体与运行时载体（运行时载体供构建别名，类型载体供 tsconfig paths） |

无独立构建产物：源码直出，由 console 打包器并入宿主 `client.js`。

### 2.4 `plugins/webui/*`：双面包

每个控制台插件是一个双面包，`src/` 与 `client/` 是同一插件的两个运行环境实现：

| 路径 | 运行位置 | 职责 |
|---|---|---|
| `src/` | Node（Koishi 应用内） | 插件主体：注册服务、指令、数据库访问；通过 `ctx.console.addEntry()` 声明前端入口 |
| `client/` | 浏览器（控制台内） | 插件前端：Vue 组件 + 页面注册（`ctx.page` / `ctx.slot` / `ctx.menu` 等）、图标、词典 |
| `dist/` | 浏览器（由宿主下发） | `client/` 的构建产物，固定落在插件目录下 |
| `locales/` | Node | 插件主体的词条（被 `src/` 消费） |
| `client/locales/` | 浏览器 | 插件前端的词条 |
| `build/client.ts` | 构建期 | 可选的 vite 配置覆盖入口（`build()` 显式加载，vite 不会自动发现该文件名） |

各插件的 `client/` 形态并不统一（这是问题清单的素材，此处只做记录）：

| 形态 | 包 |
|---|---|
| 有 `client/` 且 `client/index.ts` 齐备（16 个） | admin · analytics · auth · commands · config · dataview · explorer · insight · locales · logger · market · notifier · sandbox · status · theme-vanilla · welcome |
| 有 `client/` 但无 `client/locales/` | admin · commands · config · dataview · insight · locales · logger · notifier · status · theme-vanilla |
| 无 `client/`（纯 Node 侧插件） | actions · console · oobe |
| `src/` 已做 node/browser/shared 三分 | config · console · market |
| `src/` 为扁平单入口 | 其余 16 个 |

三个无 `client/` 的插件各有原因，均属合理特例：

- `console`：**宿主**，其 `dist/` 承载全部插件的产物，自身没有需要打包的前端源码（但含 `src/browser/` 浏览器变体）；
- `actions`：只提供应用级指令与后端 API，无独立页面；
- `oobe`：只提供开箱体验的服务端逻辑。

### 2.5 三种"前端"概念辨析

这是本仓前端**最容易混淆**的地方，必须在文档里钉死：

| 名称 | 含义 | 举例 |
|---|---|---|
| `client/` | 控制台**前端插件**实现（Vue，注册到 UI） | `plugins/webui/logger/client/index.vue` |
| `src/browser/` | Node 侧插件的**浏览器环境变体**（Koishi browser 模式下的替代实现），与 UI 无关 | `plugins/webui/config/src/browser/index.ts`、`plugins/webui/market/src/browser/index.ts` |
| `dist/` | 上述 `client/` 的**构建产物** | `plugins/webui/*/dist/index.js` |

`src/browser/` 与 `client/` 同处一包却毫无关系：前者是"插件本体换个运行环境"，后者是"插件的界面"。二者在任何单一目录树里都无法自查，只能靠约定记忆。

另需注意：`config` 与 `market` 的 `src/browser/index.ts` 在各自 `package.json` 的 `exports` 中**没有对应的 `browser` 条件**（对比 `@koishi-ce/plugin-console` 明确声明了 `"browser": "./lib/browser/index.mjs"`），全仓亦无静态引用。其加载路径靠上游的运行期约定，**本次未做对账，列为待确认项**（见 §4.1 A4）。

---

## 3. 约定锚点

构建与类型系统如何"发现"前端代码——理解这几点，才能判断哪些移动是安全的。

### 3.1 入口发现

| 机制 | 规则 | 判据 |
|---|---|---|
| 插件前端入口 | 固定为 `<插件>/client/index.ts` | `build()` 中 `lib.entry` 硬编码 |
| 无 `client/` 即跳过 | `if (!existsSync(`${root}/client`)) return` | 同一函数首行 |
| 宿主入口 | `app/index.html`（总装）与 `app/` 目录（开发服务器） | `scripts/client.ts` 与 `createServer()` |
| 构建覆盖 | `<插件>/build/client.ts`，`build()` 显式 `mergeConfig` | vite 不自动发现该文件名 |

### 3.2 产物落点

| 场景 | 落点 | 是否可配置 |
|---|---|---|
| 单插件前端 | `<插件>/dist/`，先 `rm` 再 `mkdir` | 硬编码，不可配 |
| 宿主总装 | `plugins/webui/console/dist`（相对**仓库根**定位，源码形态与产物形态深度一致） | 硬编码，不可配 |
| 运行时共享块 | 同上，`vue.js` / `vue-router.js` / `vueuse.js` / `client.js`，各插件以 external 引用 | 固定 |

### 3.3 别名

- `collectWorkspaceAliases()`：扫描根 `package.json` 的 workspaces glob，为**每个**工作区包生成三条映射——裸名 → `<dir>/client/index.ts`（存在时）或 `<dir>/src`、`<name>/src` → 源码目录、`<name>/client` → 浏览器入口。存在理由是**未被任何工作区包依赖的插件不在 `node_modules` 链接里**，bundler 无法按包名解析。
- 子路径键必须先插入（别名按插入序取首个命中）。
- `schemastery-vue/client` 别名与 tsconfig paths 成对：运行时载体走构建别名，类型载体走 tsconfig（第三方源码不进类型程序）。
- 下游 npm 安装形态下别名表为空是**正确语义**（读不到仓库根清单即没有源码可映射）。

### 3.4 类型接线

- 检查入口两条：Node 侧 `tsconfig.json` + 浏览器侧 `tsconfig.web.json`（paths 为各工程 paths 的合并）。
- 各 `client/tsconfig.json` 形如 `{"extends": "...tsconfig.client", "include": ["."]}`；**新增 client 工程须同步 `tsconfig.web.json` 的 include/paths**。
- `tsconfig.client.json` 的 `types: []` 保证浏览器纯净，代价是 web 侧 `*.test.ts` 不进类型程序（由 `bun test` 运行时覆盖）。
- 实测配对完整：16 个有 `client/` 的包全部带 `client/tsconfig.json`（**仅此一项全仓一致**）。

### 3.5 包元数据

| 字段 | 语义 | 消费方 |
|---|---|---|
| `koishi.public` | 声明需要对市场展示的目录 | `@koishi-ce/registry` 的 `Ensure.array(koishi?.public)` |
| `koishi.browser` | 声明插件可在浏览器环境运行 | 插件加载链 |
| `files` | npm 打包白名单 | npm / Bun |
| `koishi.description` / `service` | 市场展示与服务依赖声明 | registry / loader |

---

## 4. 问题清单

每条给出：现象 → 证据 → 影响 → 建议。分三级：A 结构性问题、B 一致性问题、C 命名与细节。

### 4.1 A 级：结构性问题

#### A1 `packages/web/client` 四职责同包

**现象**：`app/`（宿主 SPA 源码）、`client/`（对外库）、`src/`（Node 构建器）、`scripts/`（总装脚本）共用一个 `package.json`、一个版本号、一次 changeset。

**证据**：`files: ["app","client","lib","src","global.d.ts"]`；`exports["."]` 的 `source` 与 `default` 指向语义相反的两个入口；`import.meta.dir/../app` 的运行时定位。

**影响**：

1. 下游 `bun add @koishi-ce/client` 会一并拉到 `app/`（宿主 SPA 源码，对下游无用途，仅开发服务器形态下需要）；
2. 改宿主首页布局与改对外库 API 走同一个版本号与同一条发布记录，语义无法区分；
3. AGPL 包内"被消费的库"与"本仓自用的应用"混居，读者需读源码才知道 `app/` 不是库的一部分。

**约束（决定整改路径）**：`createServer()` 靠 `../app` 相对定位，拆包必须同步改为显式解析 app 目录位置；`scripts/client.ts` 的 `cwd` 依赖"源码 `scripts/` 与产物 `lib/` 到仓库根同为四级"这一巧合。

**建议**：见 §5.1 方案 P1（中期）；短期至少在包 README 中钉死四目录的职责边界。

#### A2 图标资产无单一来源，同义图标重复定义

**现象**：15 个 `icons/` 目录、155 个 `.vue` 图标文件；跨目录**重名 27 组**。

**证据（关键重名）**：

| 图标 | 份数 | 位置 |
|---|---|---|
| `star-empty` / `star-full` / `tag` / `file-archive` / `search` | 2 | `packages/web/client/src/components/icons/svg/` 与 `plugins/webui/market/client/vendor/market/icons/misc/` |
| `activity.vue` | 4 | admin · commands · explorer · locales |
| `check.vue` / `trash-can.vue` / `refresh.vue` / `manage.vue` | 3 | 分散于 auth / commands / config / admin / dataview / explorer / market |
| `download.vue` / `save.vue` / `user.vue` | 2 | explorer / market、config / explorer、`client` 主图标库 / analytics |

**影响**：同一语义的图标在两处实现，视觉与描线细节可能不一致；改一处不会同步另一处。`market/client/vendor/market/icons/` 是从上游 npm 包 vendor 进来的（同许可，对 npm 依赖已解除），其 52 个图标与主图标库的重叠属**本仓可控范围**；各插件自带 `icons/` 则属上游约定（插件前端自洽，不互相 import），移动它会让上游 diff 变噪声。

**建议**：见 §5.1 方案 P2。不要试图把所有插件图标集中——那是上游约定；只处理主图标库与 market vendor 树的重叠。

#### A3 `locales/` 双份同构，语义靠位置区分

**现象**：17 个 `locales/` 目录，其中两组包同时存在 `locales/`（Node 侧）与 `client/locales/`（浏览器侧），文件名与语言集完全相同。

**证据**：

| 包 | `locales/` | `client/locales/` | 差异 |
|---|---|---|---|
| `explorer` | 7 yml | 7 yml | 无（同构） |
| `analytics` | 7 yml | 7 yml | 无（同构） |
| `market` | 14 yml（`message.*` + `schema.*` 双命名） | 2 yml（en-US / zh-CN） | 命名体系不同 |
| 其余有前端的包 | 多数只有其一 | | |

**影响**：翻译改动易漏一侧；新人无法从路径判断某词条被 Node 还是浏览器消费；`market` 的双命名（`message.*` / `schema.*`）与其余包的 `<locale>.yml` 体系并存，同一仓三套词典命名。

**建议**：见 §5.1 方案 P3。重命名会与上游同步冲突（`locales/` 是上游约定路径），故首选"文档钉死 + 门禁校验两侧键集一致"，而非改路径。

#### A4 三个"前端"概念无统一命名，且 `src/browser/` 存在待确认项

**现象**：`client/`（UI 插件）、`src/browser/`（Node 插件的浏览器变体）、`dist/`（产物）、`app/`（宿主源码）、`packages/web/*`（浏览器侧库）五个词都指"前端"的部分面。

**待确认**：`config` 与 `market` 的 `src/browser/index.ts` 在包的 `exports` 中无 `browser` 条件（`@koishi-ce/plugin-console` 有），全仓无静态引用；本次未与上游对账，**不能判定为死代码，也不能判定为活跃路径**。

**影响**：这是"感觉不规范"的最大来源——同一目录树里，`client/` 与 `src/browser/` 并列却不是同一维度；新人极易在 `src/browser/` 里找页面组件。

**建议**：见 §5.1 方案 P4（文档与注释层解决，零代码风险）。

### 4.2 B 级：一致性问题

#### B1 `koishi.public` 声明与实际目录不符

**证据（2026-09-22 实测全表）**：

| 包 | 有 `client/` | 有 `dist/` | `koishi.public` | 判定 |
|---|---|---|---|---|
| actions | 无 | 无 | `["dist"]` | **死声明**（声明了不存在的目录） |
| oobe | 无 | 无 | `["dist"]` | **死声明** |
| analytics | 有 | 有 | 无 | **漏声明** |
| status | 有 | 有 | 无 | **漏声明** |
| console | 无 | 有（宿主产物） | 无 | 待定（宿主是否应展示 `dist` 需产品判断） |
| 其余 14 个 | 有 | 有 | `["dist"]` | 一致 |

**影响**：`koishi.public` 被 `@koishi-ce/registry` 读取（市场元数据）。`actions` / `oobe` 声明了不存在的目录；`analytics` / `status` 有产物却未声明。npm 打包侧会静默忽略不存在的 `files` 项，故无构建故障，但属声明与实然脱节。

**建议**：清掉 `actions` / `oobe` 的 `public`，为 `analytics` / `status` 补上，`console` 单独判断。

#### B2 测试文件放置三套并存，前端侧覆盖近乎空白

**证据**：Node 侧同时存在 `src/__tests__/*.test.ts`（auth / admin / config / console / logger / locales / actions）与 `src/*.test.ts`（commands / explorer / insight / notifier / sandbox / analytics / status / oobe）两种约定；前端侧 8 个测试文件全部平铺在源码目录（`market/client/` 6 个、`explorer/client/languages.test.ts`、`packages/web/{client,components}` 各 1 个）。

**影响**：三套约定并存，新增测试时无判据；前端侧 249 个 `.vue` 组件对应 8 个测试文件，覆盖率极低（且集中在 market 的纯逻辑模块）。

**建议**：统一为 `__tests__/` 目录（与最大既有群体一致），存量逐步迁移；前端侧的测试策略另行立项（改路径本身不会提升覆盖）。

#### B3 `client/` 内部组件与逻辑混排

**证据**：

- `packages/web/client/src/components/` 同层混放：组件（`perms.vue` / `dynamic.vue`）、纯逻辑模块（`link.ts` / `markdown.ts` / `slot.ts`）、测试（`markdown.test.ts`）、目录（`chat/` / `common/` / `icons/` / `layout/`）。
- `packages/web/components/src/` 同层混放：平铺组件（`image-viewer.vue` / `k-comment.vue`）与目录（`form/` / `virtual/`）与构建载体（`schemastery-vue-*.ts`）。

**影响**：`components/` 目录同时承担"组件集合"与"若干纯函数工具"两种职责；`packages/web` 两个包的 `client/` 根目录组织风格不同（一个目录化程度高、一个平铺为主）。

**建议**：`packages/web/client/src/` 内增设 `logic/`（或 `utils/`）收纳 `link.ts` / `markdown.ts` / `slot.ts`；`packages/web/components/src/` 把两个平铺组件归入 `common/`。两项均为**纯本仓可控范围**，不影响上游同步。

#### B4 `build/` 目录语义不一

**证据**：`plugins/webui/analytics/build/client.ts` 是有内容的 vite 配置覆盖入口（有真实消费者）；`plugins/webui/welcome/build/` 是**空目录**（git 不跟踪，属本地残留）。

**影响**：同名目录两义（活跃构建钩子 vs 空壳）；空目录会让读者误以为有构建定制。

**建议**：删除 `welcome/build/`；在 `docs/guides/development.md` §7 或上游同步文档中说明 `build/client.ts` 是唯一合法内容。

#### B5 包 `files` 声明含不存在的路径

**证据**：

| 包 | `files` 中的路径 | 实际 |
|---|---|---|
| `packages/web/components` | `tsconfig.client.json` | 包根无此文件（根下仅 CHANGELOG / package.json / README） |
| `plugins/webui/console` | `app` | 包根无 `app` 目录（宿主 `app/` 在 `packages/web/client`） |

**影响**：npm 打包静默忽略不存在的路径，无构建故障；但声明失真，且 `console` 的 `app` 项会误导读者以为宿主前端在 console 包内。

**建议**：一并清理。**注意**：这两项若为上游原样继承，清理会在下一次上游对账时复现——需在对账噪声过滤清单中登记。

#### B6 `src/` 入口形态两套

**证据**：`config` / `console` / `market` 采用 `src/{node,browser,shared}/` + `src/index.ts` 占位桥接（文件内注明 `placeholder file, do not modify`）；其余 16 个为扁平 `src/index.ts`。`config` 的 `exports` 额外暴露 `./shared`（唯一子路径导出）。

**影响**：同一架构两种写法，读者需要判断"这个包的 `src/index.ts` 是真入口还是转发"。占位桥接本身是必要设计（保证 `exports` 的 `.` 条件稳定），但缺少文档说明。

**建议**：文档说明占位桥接的用途与适用条件（何时该拆 node/browser/shared），不强行统一。

### 4.3 C 级：命名与细节

| 编号 | 现象 | 证据 | 建议 |
|---|---|---|---|
| C1 | `app/` 与 `client/` 同包同层，命名近乎撞车，实际一个是"宿主应用（消费者）"、一个是"被消费的库" | `packages/web/client/{app,client}/` | 随 A1 拆包解决；不拆则改名 `app/` → `host/` 或 `spa/` |
| C2 | 组件 `k-` 前缀不统一：`k-button` / `k-hint` / `k-tab` / `k-comment` / `k-filter` / `k-image-viewer` 带前缀，`card` / `content` / `empty` / `tab-group` / `tab-item` / `perms` / `dynamic` 不带 | `packages/web/{client,components}/client/**` | 约定：`packages/web/*` 对外导出的组件一律 `k-` 前缀，插件内部组件不带前缀；存量不强制迁移 |
| C3 | `plugins/webui/locales` 包内的 `client/` 与仓库中大量 `locales/` 目录同名，全文搜索噪声大 | `plugins/webui/locales/client/locales.vue` | 不改（包名是上游映射的一部分），在速查表中标注 |
| C4 | 产物目录与源码目录同层（`client/` `dist/` `lib/` `src/` 并列于包根） | 全部 `plugins/webui/*` | 属上游约定与发布形态所需，不动 |
| C5 | 宿主产物落点硬编码在另一个包内 | `scripts/client.ts` 的 `plugins/webui/console/dist`；`build()` 的 `<root>/dist` | 文档钉死（§3.2）；随 A1 拆包时评估参数化 |

---

## 5. 整改建议

### 5.1 方案

#### P1（中期，收益最高，代价最高）：拆分 `packages/web/client`

目标形态（**已落地**；实际拆分次序为 builder 先行，下文接线项一并记录）：

```
packages/web/
├── app/            宿主控制台 SPA（自 packages/web/client/app 拆出）
│   └── src/        应用源码（vite root，含 index.html）
├── client/         对外浏览器运行时库（原 client/ 目录改名 src/）
│   └── src/
├── components/     共享组件库（client/ 目录改名 src/）
│   └── src/
└── builder/        node 侧构建器与 koishi-console CLI（builder 的先行拆分）
```

落地后的接线方式：三处浏览器侧源码目录统一叫 `src/`（本仓统一约定：包的源码一律 `src/`，与 node 侧一致）；app 定位统一走 `builder` 的 `locateApp()`（按包名解析包下 `src/`，源码与产物形态同解），`collectWorkspaceAliases()` 对无入口的包跳过裸名映射；`files` / `exports` / `tsconfig.web.json` 的 include / eslint 的 glob / `.fallowrc.jsonc` 均已同步；CLI 文档引用改为 `packages/web/builder/src/bin.ts`；console 的 devMode 同样按包名解析 `src/`。

**唯一例外**：`plugins/webui/*/client/` 保持 `client/` 不改名——该子路径（`@koishi-ce/plugin-config/client`）是插件生态跳包引用彼此的**公开面**，上游与 npm 产物均以它为准。

**代价（已权衡接受）**：这三个目录与上游 `webui` 的文件名集合不再两两对应，`tooling/upstream-audit` 的 file-set diff 与 churn 排名对其退化为「单边存在」清单（映射与注记已同步，diff 仅作线索）；port 时需按 `src/` → 上游 `client/`（或 `app/`）手工对位。换来的是全仓一致的目录语义。

**先决条件（已证伪）**： `app/` **必须**随 npm 发布——console 宿主的 `devMode` 在运行期解析它（该配置项面向下游用户），故不能声明为 `private`。

**风险**：改动集中在构建链，回归面覆盖前端总装、单插件构建、开发服务器三类场景，必须逐项验证。

#### P2（短期）：消除 icons 重叠

只处理 `packages/web/client/src/components/icons/` 与 `plugins/webui/market/client/vendor/market/icons/` 的 5 组重名（`star-*` / `tag` / `file-archive` / `search`）。market 的 vendor 树是同许可本地化的产物，可改为引用主图标库；插件自带 `icons/` 不动（上游约定）。

#### P3（短期，零代码风险）：locales 纪律化

不改路径（避免上游 diff 噪声），改为：

1. 在 `docs/reference/architecture.md` 或本文中钉死：`locales/` 供 Node 侧、`client/locales/` 供浏览器侧；
2. 增加门禁校验：若某包两侧 `locales` 同时存在，校验两侧语言集一致（防漏翻）；
3. `market` 的 `message.*` / `schema.*` 双命名单独登记为已知特例。

#### P4（短期，零代码风险）：概念词典

在开发手册中新增一张"前端目录语义表"（即本文 §2.5 的表格），明确 `client/` / `src/browser/` / `dist/` / `app/` 四个词；并在 `config` / `market` 的 `src/browser/index.ts` 头部注释中写明加载路径与用途。

#### P5（短期）：清理声明与残留

- 清 `actions` / `oobe` 的 `koishi.public`，补 `analytics` / `status`，判断 `console`（§4.2 B1）；
- 删 `welcome/build/` 空目录（§4.2 B4）；
- 清 `packages/web/components` 的 `files` 死项与 `console` 的 `app` 死项（§4.2 B5），并登记到上游对账噪声过滤清单。

#### P6（可选）：`components/` 收拢逻辑模块

`packages/web/client/src/components/` 增设 `logic/` 收纳 `link.ts` / `markdown.ts` / `slot.ts`；`packages/web/components/src/` 增设 `common/` 收纳两个平铺组件。纯本仓范围，风险低。

### 5.2 优先级

| 顺序 | 方案 | 收益 | 代价 | 风险 | 前置依赖 |
|---|---|---|---|---|---|
| 1 | P5 声明与残留清理 | 中 | 低 | 极低 | 无 |
| 2 | P3 locales 纪律化 | 中 | 低 | 低 | 无 |
| 3 | P4 概念词典 | 高（认知） | 极低 | 无 | 无 |
| 4 | P2 icons 去重 | 中 | 中 | 低 | 需确认 market vendor 的引用方式 |
| 5 | P6 components 收拢 | 低 | 低 | 低 | 无 |
| 6 | P1 拆包 | 高 | 高 | 中高 | 需先确认 app 的发布必要性 |

### 5.3 不建议做的事

| 想法 | 否掉的理由 |
|---|---|
| 把各插件 `client/icons/` 集中到统一图标包 | 违背上游约定，插件前端将失去自洽性；每次上游同步都会产生无意义的 diff |
| 统一 `locales/` 与 `client/locales/` 的物理路径或改名 | 同上，且会打断 `loader` 的 `copy` 规则与既有词典体系 |
| 给前端引入 vite 配置文件 | 现有编程式构建是三处显式接线的结果（总装、单插件、开发服务器），改配置文件会引入"哪份配置生效"的新歧义 |
| 重命名 `dist/` / `lib/` / `src/` | 与上游映射、发布 `files`、类型 paths 强耦合，收益不抵成本 |
| 把 `plugins/webui/*/src/` 统一改造成 node/browser/shared 三分 | 16 个扁平包的 `src/index.ts` 是真实入口，改造为零收益的结构变动 |

---

## 6. 附录：职责速查表

一张表回答"这个目录是干什么的"（前向引用本文 §2）。

| 路径 | 一句话职责 | 修改前须知 |
|---|---|---|
| `packages/web/app/src/` | 宿主控制台 SPA 源码（`@koishi-ce/console-app`，`src/` 即 vite root） | 改动影响总装产物与开发服务器；`src/index.ts` 是唯一入口 |
| `packages/web/client/src/` | 对外浏览器运行时库源码（`@koishi-ce/client` 默认入口） | 是下游 API 面，命名与导出变更需谨慎 |
| `packages/web/builder/src/index.ts` | 编程式构建器与 `koishi-console` CLI（`@koishi-ce/console-builder`） | 改动影响全部插件的前端构建 |
| `packages/web/builder/src/assemble.ts` | 宿主总装（CLI 无参分支） | 改产物落点会同时影响 console 包与本仓命令 |
| `packages/web/client/global.d.ts` | 全仓浏览器侧全局类型声明 | 被 `tsconfig.client.json` 的 `files` 引用 |
| `packages/web/components/src/` | 共享组件库（表单 / 虚拟列表 / 展示件） | 无构建，改源码即改宿主产物 |
| `plugins/webui/*/client/` | 插件前端实现（Vue + UI 注册） | 入口固定 `client/index.ts`，多一个文件也会被构建发现 |
| `plugins/webui/*/client/locales/` | 插件前端词条 | 与包根 `locales/`（Node 侧）分离 |
| `plugins/webui/*/build/client.ts` | 可选 vite 配置覆盖 | 文件名固定，vite 不自动发现，靠 `build()` 显式加载 |
| `plugins/webui/*/dist/` | 插件前端产物 | 由构建生成，勿手改 |
| `plugins/webui/*/locales/` | 插件 Node 侧词条 | 同上 |
| `plugins/webui/*/src/browser/` | Node 侧插件的浏览器环境变体（与 UI 无关） | 加载路径待确认（§4.1 A4），改动前先与上游对账 |
| `plugins/webui/console/dist/` | **全部**控制台前端产物（宿主 + 各插件） | 宿主总装与单插件构建共用该目录；调试时注意清空时机 |
