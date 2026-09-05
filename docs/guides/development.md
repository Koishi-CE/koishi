# 开发指南（DEVELOPMENT）

> `koishi`（Koishi-CE monorepo）的**开发手册**：环境、命令、门禁、构建产物布局、编码约定、测试写法与已知坑。以实际代码为准，文档滞后时听代码的。
> **先读**：根 [AGENTS.md](../../AGENTS.md)（铁律精简版）→ 本文（方法与细节）；结构见 [../reference/architecture.md](../reference/architecture.md)，发布见 [../process/release.md](../process/release.md)。
> **本文结构**：1 环境 · 2 命令 · 3 门禁 · 4 构建产物 · 5 编码约定 · 6 测试 · 7 已知坑 · 8 版本与发布。

## 1. 环境要求

| 工具 | 版本 | 用途 |
|---|---|---|
| [Bun](https://bun.sh) | ≥ 1.4（`packageManager` 钉 `bun@1.4.0`） | 唯一包管理器（workspaces + `bun.lock`）、测试运行器、主要运行时（`require(esm)`、原生 yml 导入） |
| Node | ≥ 22.12（不作兼容目标） | 辅助场景；类型检查走 `bunx tsc`（`@typescript/native` 的 node 启动器） |

- 不要引入 pnpm / yarn / npm 的锁文件；无全局安装要求，所有工具都在 workspace devDependencies。
- TypeScript 双版本：根 `devDependencies.typescript` 实为 `npm:@typescript/typescript6`（供 @typescript-eslint/parser，其对 TS7 的支持尚未落地，见 eslint.config.ts 头部注释）；真正的类型检查用 `@typescript/native`（TS7 原生编译器，`bun run ts7` 可直接调用）。

## 2. 常用命令

```bash
bun install                     # 安装依赖（Bun workspaces，产出 bun.lock）
bun run check                   # 全量门禁 = lint + lint:client + typecheck（提交前必跑）
bun run lint                    # biome check .（格式 + lint 唯一权威）
bun run lint:client             # eslint 仅查 *.vue 模板语义
bun run format                  # biome format --write .
bun run typecheck               # TS7 类型检查（node 侧 + client 侧两条 bunx tsc 串行）
bun run build                   # 根 tsdown：全部 node 侧包 → 各包 lib/（ESM-only）
bun test                        # 全量自有用例（覆盖全部 node 侧包与 tooling 回归，秒级；文件与用例数以实跑输出为准）
bun test packages/node/core     # 定向跑某包测试
bun test --coverage             # 覆盖率（src 源码口径）
```

前端产物（vite，编程式构建，无配置文件）：

```bash
bun packages/web/client/src/bin.ts build               # 宿主控制台前端 → plugins/webui/console/dist
bun packages/web/client/src/bin.ts build plugins/webui/status   # 单个 webui 插件的前端
```

独立构建与发布：

```bash
cd apps/koishi-create && bun run build   # create-koishi-ce 脚手架 CLI（包级 tsdown 配置补 bin 入口）
bun run release status                   # 发布链概览（详见 ../process/release.md）
bun tooling/check-docs-links.ts          # 文档相对链接与锚点存活检查（docs 全树 + 根部 / .github 文档）
```

`apps/koishi-create` 与 `apps/koishi-scripts` 均在根 tsdown workspace 内：包级 `tsdown.config.ts` 只补 bin 入口等差异，平时随根 `bun run build` 一次产出，进目录单独 build 仅在调试该包时需要。

## 3. 门禁构成与现状

`bun run check` 由三段组成：

1. **lint（biome）**：全仓格式 + lint（`biome check .`）。biome 尊重 `.gitignore`（`vcs.useIgnoreFile`），跳过 lib/dist 等。格式以 biome 为唯一权威——`.editorconfig` 声明的 4 空格缩进与代码现状（tab）不符，勿据此手改，统一 `bun run format`。
2. **lint:client（eslint）**：只查 `.vue` 文件，与 biome 零重叠；核心规则 `vue/no-undef-components`（忽略 `^K`、`^el-`、`^router-` 全局组件）。不做类型感知。
3. **typecheck**：两条纯 `bunx tsc` 串行——node 侧大一统 `tsconfig.json`（include 为全部 node 工程 src 的并集）+ client 侧大一统 `tsconfig.web.json`（include 为全部 client 工程并集）。**不要恢复逐 tsconfig 并行 spawn**（旧方案 50 进程并发在 win32 下有 Bun.spawn 竞态且无必要）。两条链已开 `incremental`，buildinfo 分文件存 `node_modules/.cache/tsc/`（node / web 各一份，入口文件集合不同不能共用；删掉即全量重建）。另有调试用的 legacy 通道 `bun run typecheck:legacy`（tsc6，写 `node-legacy.tsbuildinfo`）。新增 client 工程时须同步 `tsconfig.web.json` 的 include/paths。

**类型检查现状**：全仓在 TS7 下 0 错误（含 `packages/web/*` 与全部 webui 插件）。最低纪律：改哪个包，保证该包所在 project 不新增错误。

**`.vue` 的类型检查**：tsc 侧经 `packages/web/client/global.d.ts` 把 `*.vue` 声明为不透明 `Component`，SFC 的 script / template 不进入 tsc 程序——错误实际由构建期 vite（compiler-sfc，含 defineProps 类型解析）暴露，前端构建是 `.vue` 的实际类型门禁。vue-tsc 需要经典 TS 运行时、与本仓 TS7-native 策略冲突，不引入；待 Volar 工具链支持 TS7 后再评估。

## 4. 构建产物布局

| 产物 | 位置 | 产生方式 |
|---|---|---|
| node 侧库产物 | 各包 `lib/`（`index.mjs` ESM + `index.d.ts`） | 根 `tsdown.config.ts` 单遍构建所有 node 侧 workspace 包 |
| `.yml` locale | 随 `lib/` 拷贝 | tsdown `loader: { ".yml": "copy" }` |
| 宿主控制台前端 | `plugins/webui/console/dist/` | `packages/web/client/scripts/client.ts`（总装：app + vue runtime 外部块 + client） |
| 各 webui 插件前端 | 各插件 `dist/`（`koishi.public` 声明） | `packages/web/client/src/index.ts` 的 `build(root)` API |
| `apps/koishi-create` | `lib/` | 根 tsdown（包级 tsdown.config.ts 补 bin 入口） |

- **ESM-only + Bun 运行时**：全部 47 个 workspace 包均为 `"type": "module"`，根 tsdown 只出 ESM（exports 以 `default` 条件兜底）。loader 用 `require()` 加载插件，Bun 的 `require()` 可直接加载 ESM，插件加载链据此工作；不要恢复 CJS 双格式产物。
- `**/lib/`、`**/dist/` 均被 .gitignore 忽略，不入库。例外：vendored 三包（`plugins/infra/{http,proxy,server}`）的 `index.cjs/index.mjs/index.d.ts` 是提交进仓库的预编译产物（再导出 `@cordisjs/plugin-*`），不走 tsdown。
- 前端构建发布前现构建（dist 不入 git），由 `bun run release build` 编排。

## 5. 编码约定

### TypeScript（tsconfig.base.json，全 workspace 继承）

- 严格全家桶：`strict` + `noUncheckedIndexedAccess` + `noPropertyAccessFromIndexSignature` + `exactOptionalPropertyTypes` + `noUnusedLocals/Parameters` + `noImplicitReturns` + `noFallthroughCasesInSwitch` + `noImplicitOverride` 等。
- 模块：target ES2025、`module/moduleResolution: NodeNext`（**相对导入一律带 `.ts` 扩展名**）、`verbatimModuleSyntax` + `isolatedModules` + `erasableSyntaxOnly`、`allowImportingTsExtensions`（配合 noEmit）。
- **类型导入一律 `import type`**（verbatimModuleSyntax 强制）；重导出用 `export type {`。
- JSX：`react-jsx`，`jsxImportSource: @satorijs/element`（消息元素渲染）。
- `.yml` 导入的类型由 `packages/node/core/src/i18n/yml.d.ts` 提供（tsconfig.base 的 files 全局注入；web 侧对应声明在 `packages/web/client/global.d.ts`）。
- Vue 客户端代码 extends `tsconfig.client.json`（`jsx: preserve`、DOM lib、`types: []`）。

### 命名空间与依赖纪律

- 代码内导入一律 `@koishi-ce/*`。外部上游导入仅有的例外：测试用 `@koishijs/plugin-database-memory`，console 的类型引用 `@koishijs/plugin-server-proxy`。
- `peerDependencies` 一律指向 CE 包名（`@koishi-ce/koishi ^1.0.0` 等），不要写回上游名；详见 [../reference/architecture.md](../reference/architecture.md) 依赖纪律节。
- 依赖方向：`plugins/webui/* → @koishi-ce/console → @koishi-ce/core`；`plugins/common/* → @koishi-ce/core`；`packages/web/*`（浏览器侧）不依赖 node 侧运行时。
- cordis 生态冻结在 3.x 内洽线（cordis / minato / @cordisjs/* / @satorijs/* 不得跳 4.x / 1.x），依据与重启条件见 [../decisions/upgrade-plan.md](../decisions/upgrade-plan.md) Phase 5 节。

### Biome / ESLint

- biome：recommended 基线 + organizeImports；`useNamingConvention`、`noFloatingPromises` 等规则为全局关闭（启用清单以 `biome.json` 为准）；tests / spec 文件关 `noTemplateCurlyInString` 与 `noNonNullAssertion`；脚手架模板目录（`apps/*/src/template/**`）整体禁用格式与 lint，package.json 不做格式化。
- eslint（仅 .vue）：模板指令合法性、编译宏正确性、`no-mutating-props` 等；组件引用检查忽略 `^K` / `^el-` / `^router-`。

### 格式

- TS/JS/JSON：tab 缩进、双引号、行尾分号（biome 是唯一权威）。
- `.vue`：2 空格缩进（上游 webui 惯例）。

### 国际化（i18n）

全仓三套 i18n 机制，各管一段，新增文案时按所在层选择：

1. **bot 侧指令文案**（node 插件）：`locales/*.yml`（7 语种）+ `ctx.i18n`，键以 `commands.<name>.` 开头对齐上游惯例。
2. **node 侧配置 schema 描述**：Schemastery 的 `.i18n({ "zh-CN": zhCN, ... })`——词典 import 自包内 `locales/`，挂在 `static Config` 或 Schema 链尾。注意其词典递归会滤掉 `$` 前缀键，**union 内 const 选项的显示名走不到 `.i18n()`**，需以 `Dict<string>` 形态经 `extra("description", dict)` 写入（description() 方法只收 string）；宿主侧可用 `pickMessages()` / 扩展侧用 `pickFrom()` 从词典摘取该形态。
3. **前端 UI 文案**（client）：宿主 `$i18n` 服务持有唯一 vue-i18n 实例（fallback zh-CN），宿主词典在 `packages/web/client/client/locales/`；各扩展在自己的 `client/locales/` 放词典（键收纳在 `<扩展名>.*` 命名空间下），并在 client 入口 `ctx.$i18n.extend(locale, dict)` 注入——构建别名保证 vue-i18n 单实例，词典在构建期由 yaml 插件内联。组件内用 `useI18n()`（全局 composer）；纯 ts 模块（echarts 配置等）经 `@koishi-ce/client` 的 `root.$i18n.t(key, args?)` 访问。activity 页名 / 菜单 label / 设置分区 title 均支持 getter（`MaybeRefOrGetter` / `MaybeGetter`），传 `() => ctx.$i18n.t(...)` 即可随语言实时切换。

词典纪律：

- **语种集合**：7 语种（zh-CN / zh-TW / en-US / ja-JP / fr-FR / de-DE / ru-RU），以 zh-CN 为基准；例外见下。
- **检查工具**：`bun tooling/check-locales.ts` 检查键对齐、语种齐全与假翻译（拉丁/西里尔语种值含汉字即报；ja-JP 因汉字与中文同源无法自动检测，改动后需人工核对），改词典后必须跑。market（上游原版再分发）与 `plugins/webui/locales`（词条来自用户数据的独立插件包）完全跳过；sandbox / commands / rate-limit / sqlite 维持上游语种集合，豁免齐全检查。
- **YAML 陷阱**：值内含半角「冒号+空格」（法语高频）必须加引号；值以 `{` 开头（插值在句首）也必须加引号；块标量（`|-`）内无此限制。
- **中文拼接拆字**（如「文件{{夹}}」）应拆为独立的参数化键，禁止在模板里做语序相关的字符串拼接。

## 6. 测试写法

框架：`bun:test`（`describe` / `it` / `before` / `after` 从 `bun:test` 导入）+ **`bun:test` 的 `expect` 断言**（唯一标准；chai 及其插件已于 2026-09-02 全量迁出仓库，勿再引入）。

```ts
import { describe, expect, it } from "bun:test";
import { App } from "@koishi-ce/koishi";

expect(app.database.getUser("mock", "A")).resolves.toHaveShape({ authority: 1 });
```

- **shape 断言**（`toHaveShape`）由 `packages/node/core/tests/shape.ts` 注册（`expect.extend` 自定义 matcher，import 该文件一次即注册；语义：期望为实际的递归子集）。
- 上游 port 进来的用例若带 chai 风格，迁移对照：`await expect(p).eventually.to.eql(x)` → `await expect(p).resolves.toEqual(x)`；`.to.be.rejected` → `.rejects.toThrow()`。
- 数据库用例用 `@koishijs/plugin-database-memory`（上游包，声明于 `packages/node/core` 的 devDependencies）；时间模拟用 `bun:test` 的 mock timers（`jest.useFakeTimers()` 等；默认不冻结微任务链路，但会冻结 `Date.now()`）。
- 测试文件分布在各包 `src/**/__tests__/`、`packages/node/core/tests/`、多数插件的 `src/` 直下（`*.test.ts`，全仓无 `.spec.ts`）以及 apps 两包；总数以 `bun test` 实跑输出为准。
- `.yml` locale 在测试中可直接 import（Bun 原生支持）。

## 7. 已知坑（历史经验，别再踩）

1. **测试进程对 workspace 包加载 src 而非 lib**：Bun 运行时按「离文件最近的 tsconfig.json」取 paths 且不跟随 extends——各包 tsconfig.json 里的 paths 块把 `@koishi-ce/*` 指到 src，覆盖率才能统计源码。该 paths 块**手工维护**（`tooling/sync-test-paths.ts` 已删除）：改 `tsconfig.base.json` 的 paths 后须同步各包 tsconfig。因此改 src 后跑测试无需先 build，测试验证的始终是源码。
2. **workspace 包在测试之外的解析走 lib 产物**（Bun 对 workspace 包的解析不读 exports 的 `source` 条件，直接落 lib 产物）：改 src 后要先 `bun run build` 才在运行时生效。
3. **TS7 buildinfo 错误回声**：改根 tsconfig 或依赖结构后，旧错误会在增量运行中复活——先删 `node_modules/.cache/tsc/{node,web}.tsbuildinfo` 再跑。
4. **Bun 对失败的解析按「父目录快照」做进程内缓存**：解析 `pkg/package.json` 失败时，只要包的直接父目录（node_modules 或 node_modules/@scope）已存在，该目录内容列表即被缓存——此后即使包已落盘，同进程内该包的任何形态经任何解析 API（createRequire.resolve、Bun.resolveSync）都永久失败；父目录不存在时无快照可缓存，落盘后即可正常解析。市场装完插件报 `failed to resolve` / `cannot resolve plugin`（重启即消）即此因。现行防御：`resolvePackageJson()`（@koishi-ce/registry）全程纯 fs；loader 的 `resolvePlugin()` 在 `Bun.resolveSync` 失败后纯 fs 沿 node_modules 链定位包目录、按 manifest 条件序计算入口绝对路径；`isResidentInCache()`（registry）同样纯 fs。**新增任何对「可能刚装上的包」的解析时，兜底一律不得走解析 API**。验证类实验务必用全新进程（`bun -e`）。
5. **Bun 会把 exports 的 `"bun"` 条件用在 require 上**（Node 的 require 条件集不含它）：postgres@3.x 这类包（bun 条件指向 ESM 源码、default 指向 CJS 产物）在 Bun 下被 CJS 依赖链 require 到 ESM namespace，esbuild 产物的 node 兼容 interop 会把整个 namespace 当 default。修复在 loader 的 `node/interop.ts`：`NodeLoader.import` require 插件前遍历依赖树，把「Node require 语义入口的加载结果」预置进 `require.cache`。ESM import 侧不读 require.cache，无副作用。
6. **biome 对 `.vue` 只解析 script 块、不追踪模板引用**：biome.json 已对 `**/*.vue` 关闭 noUnusedVariables / noUnusedImports / noUnusedFunctionParameters / useVueMultiWordComponentNames / useImportType（模板使用会假阳性，useImportType 会把模板组件的值导入改回 `import type` 使运行时失注册）；模板语义检查归 eslint。
7. **显式 `any` 全仓为 0，保持住**：动态边界（JSON.parse / socket 消息 / 第三方回调）用 `unknown` + 收窄；`{}` 类型用 `Record<never, never>`。
8. **TS7 的跨文件 `declare module` 增强对「经 lib 产物 d.ts 的模块骨架」不生效**：浏览器端工程对 console 类型的消费走 `packages/web/client/client/shims.d.ts` 手写的 `"@koishi-ce/plugin-console"` 骨架，各插件 client 工程须向同一模块名镜像自己的 Services / Events 注入，载荷要用骨架自带的 `DataService<T>` 包装。market 的镜像是 `plugins/webui/market/client/console-services.ts`（类型实体经 `market/client/tsconfig.json` 指向各包 lib 产物 d.ts 解析）——**node 侧声明变更时须同步该文件**。
9. **前端构建没有 vite 配置文件**，全部编程式 `vite.build()`：宿主总装 `packages/web/client/scripts/client.ts`（产物硬编码到 `plugins/webui/console/dist`）；单插件 `build(root)` 内置 `collectWorkspaceAliases()`——未被依赖的 workspace 包不会出现在 node_modules 链接里，必须显式映射才能被 bundler 解析。
10. **特殊构建 hack**（动对应构建链必须复核）：analytics 的 "fuck-echarts"（`build/client.ts`，echarts chunk 内 `Symbol` 重命名）、explorer 的 monaco manualChunks（位于 `client/editor.ts`）、client 构建的 vue-i18n `esm-browser.prod` 别名。
11. **hmr 的 TS 即时编译由 Bun 原生完成**：require 坏 TS 抛 `AggregateError`（errors 为 Bun 的 BuildMessage，带 `message` 与 `position.{file,line,column}`，无 esbuild 式 `.text`/`.location` 字段——上游按 esbuild BuildFailure 写的错误识别分支在 Bun 下永不命中，现已在 `hmr/src/error.ts` 按真实形态重写）；`@babel/code-frame`@8 自带类型（`@types/babel__code-frame` 为 v7 线存根、从未生效，已删），esbuild devDep 已移除。
12. **上游 port 须补 `.ts` 扩展名**：上游源码是无后缀的 bundler 风格相对导入，本仓 nodenext 类型检查要求相对导入带扩展名；port 流程见 [../process/upstream.md](../process/upstream.md)。
13. **Biome 的 JSON 行尾不可见字符**：已知、正常、无害，看到即跳过，不调查、不修复、不报告。
14. **`apps/koishi-create`（目录）≠ `create-koishi-ce`（包名）**：历史遗留的命名不一致，引用一律以 `apps/koishi-create` 为准。
15. **hmr 文件监听 = @parcel/watcher 原生绑定**：Bun 1.4.0（win32 实证）未暴露任何文件监听 API（无全局 `watch` / `Bun.FileSystemWatcher` / `Bun.file().watch`），chokidar 5 在 win32 又有 glob ignored 失效问题（曾经的段剪枝补丁已随换库删除）。@parcel/watcher 的 `ignore` 在原生层剪枝（node_modules 内写入不产生事件）；事件为批量回调（create/update/delete，hmr 只取 update，与 chokidar 时代只听 change 对齐）；`subscribe` 只接受单个目录，文件型 root 经「订阅所在目录 + 路径过滤」实现。其 install 脚本仅 `npm_config_build_from_source=true` 时源码编译兜底，Bun 拦截该 postinstall 属预期、平台预编译包（`@parcel/watcher-<platform>-<arch>`）就位即可用。explorer 的 chokidar 为上游逐字继承的死依赖（`watchers` 集合声明后从未填充，上游 webui 同样如此），已连同字段与 `stop()` override 整体移除——workspace 包的直接依赖至此无 chokidar（devDep 树仍经 unocss / sass / vue-router 传递保留，属构建工具内部依赖；sass 的 optional 依赖恰为 @parcel/watcher）。

## 8. 版本与发布

- 版本由 changesets 递进管理（1.0.0 起步基线、不镜像上游版本号，随发布自然漂移，当前版本以各包 package.json 与 `bun run release status` 为准），shim 两包例外（版本冻结跟随上游线，见 [../reference/architecture.md](../reference/architecture.md)）。
- 版本与发布由 changesets + `bun run release` 发布链管理，禁止手动 `npm publish`——流程、命令与事故教训见 [../process/release.md](../process/release.md)。
- 面向发布的包改动随提交写 `.changeset/` 条目（见 [../process/release.md](../process/release.md) 第 3 节）。
