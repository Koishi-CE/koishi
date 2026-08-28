# 开发指南（DEVELOPMENT）

> 本文档是 `koishi`（Koishi-CE monorepo）的开发依据：环境、门禁命令、构建布局、编码约定、测试写法与已知坑。以实际代码为准，文档滞后时听代码的。仓库级常驻约定见根目录 [AGENTS.md](../AGENTS.md)，结构与构建体系详见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 1. 环境要求

| 工具 | 版本 | 用途 |
|---|---|---|
| Bun | ≥ 1.4 | 包管理（workspaces + `bun.lock`）、测试运行器（`bun test`）、主要运行时（yml 导入等原生能力） |
| Node | ≥ 24（辅助） | 跑 `scripts/typecheck.mjs`（内部再 spawn tsc）与个别脚本 |
| 包管理器 | 仅 Bun | 不要引入 pnpm / yarn / npm 的锁文件 |

- TypeScript **双版本**：根 `devDependencies.typescript` 实为 `npm:@typescript/typescript6@6.0.2`（供 @typescript-eslint/parser，其对 TS7 的支持尚未落地，见 eslint.config.ts 头部注释）；真正的类型检查用 `@typescript/native`（TS 7.0.2 原生编译器，`bun run ts7` 可直接调用其 tsc）。
- 无全局安装要求，所有工具都在 workspace devDependencies 里。

## 2. 常用命令

```bash
bun install                        # 安装依赖（Bun workspaces）
bun run check                      # 全量门禁 = lint + lint:client + typecheck
bun run lint                       # biome check .（格式 + lint）
bun run lint:client                # eslint 仅查 *.vue
bun run format                     # biome format --write .
bun run typecheck                  # TS7 逐 tsconfig 并行类型检查
bun run typecheck:legacy           # tsc6 --noEmit -p tsconfig.json（paths-only 根壳，基本只查根级）
bun run build                      # 根 tsdown：全部 node 侧包 → 各包 lib/
bun test packages plugins/common plugins/webui/admin plugins/webui/commands
                                   # 全量自有用例（20 文件 / 145 用例，勿裸跑 `bun test`，见已知坑 3）
bun test packages/node/core        # 定向跑某包测试
```

前端产物（vite，编程式构建，无配置文件）：

```bash
bun packages/web/client/bin.js build                    # 宿主控制台前端 → plugins/webui/console/dist
bun packages/web/client/bin.js build plugins/webui/status   # 单个 webui 插件的前端
```

独立构建的 apps（各有自己的 tsdown.config.ts）：

```bash
cd apps/koishi-create   && bun run build   # create-koishi-ce 脚手架 CLI
cd apps/koishi-scripts  && bun run build   # @koishi-ce/scripts 插件开发 CLI
cd apps/online          && bun run build   # koishi.online 网站（src/build.ts）
```

## 3. 门禁与现状

`bun run check` 是提交前门禁，由三段组成：

1. **`lint`（biome）**：全仓格式 + lint。biome 尊重 `.gitignore`（`vcs.useIgnoreFile`），跳过 lib/dist/market 等。格式以 biome 为唯一权威——`.editorconfig` 声明的 4 空格缩进与代码现状（tab）不符，勿据此手改格式，统一 `bun run format`。
2. **`lint:client`（eslint）**：只查 `.vue` 文件（biome 不解析 .vue），与 biome 零重叠；核心规则 `vue/no-undef-components`（忽略 `^K`、`^el-`、`^router-` 全局组件）。不做类型感知。
3. **`typecheck`（TS7 逐项目）**：`scripts/typecheck.mjs` 递归扫描 packages / plugins / apps 下**所有** `tsconfig.json`，用 worker 池并行跑 `@typescript/native/bin/tsc --noEmit`。⚠️ **不读 .gitignore**——gitignored 的 `plugins/webui/market/` 也会被检查；仅排除 `apps/koishi-scripts/template/`。

**类型检查现状（进行中，2026-08-28）**：严格模式错误清理已完成 `packages/node/*` 六包（0 错误）。存量错误集中在：webui 插件各 `client/tsconfig.json`、`packages/web/{client,components}`、`apps/online`、部分插件 `src/`、以及 gitignored 的 market。**最低纪律：改哪个包，保证该包所在 project 不新增错误；`packages/node/*` 保持 0。**

**测试现状**：自有用例 = 20 个 `*.spec.ts` / 145 个用例，全通过（约 1 秒；mocha 已移除，Phase 4 迁移完成，见 [upgrade-plan.md](./upgrade-plan.md)）。⚠️ **裸 `bun test`（仓库根）当前会挂起**——bun test 的发现规则包含 `*.test.ts`，会把 gitignored 的 market 的 vitest 用例卷进来并在 `i18n.test.ts` 处挂死；全量跑用带过滤参数的命令（见 §2），或按包定向。market 对齐完成、用例迁为 `*.spec.ts` 后此坑消除。

## 4. 构建产物布局

| 产物 | 位置 | 产生方式 |
|---|---|---|
| node 侧库产物 | 各包 `lib/`（`index.js` CJS + `index.mjs` ESM + `index.d.ts`） | 根 `tsdown.config.ts` 一次构建所有 workspace 内的 node 包 |
| `.yml` locale | 随 `lib/` 拷贝 | tsdown `loader: { ".yml": "copy" }` |
| 宿主控制台前端 | `plugins/webui/console/dist/` | `packages/web/client/scripts/client.ts`（总装：app + vue runtime 外部块 + client） |
| 各 webui 插件前端 | 各插件 `dist/`（`koishi.public` 声明） | `packages/web/client/src/index.ts` 的 `build(root)` API |
| apps 产物 | 各 app `lib/` | 各自 tsdown / build 脚本 |

- **CJS 产物是硬需求**：Koishi loader 用 `require()` 加载插件（`packages/node/loader/src/index.ts` 的 `import(name)` 内部即 `require`），因此源码虽为 ESM，`lib/index.js` 必须存在；ESM `index.mjs` 供 `node.import` 条件导出。
- `**/lib/`、`**/dist/` 均被 .gitignore 忽略，不入库。
- vendored 三包（`plugins/infra/{http,proxy-agent,server}`）的 `index.cjs/index.mjs/index.d.ts` 是**提交进仓库的**预编译产物（再导出 `@cordisjs/plugin-*`），不走 tsdown。

## 5. 编码约定

### TypeScript（tsconfig.base.json，全 workspace 继承）

- 严格全家桶：`strict`、`strictBindCallApply`、`alwaysStrict`、`noUncheckedIndexedAccess`、`noPropertyAccessFromIndexSignature`、`exactOptionalPropertyTypes`、`noUnusedLocals`、`noUnusedParameters`、`noImplicitReturns`、`noFallthroughCasesInSwitch`、`noImplicitOverride`、`allowUnreachableCode: false`、`allowUnusedLabels: false`。
- 模块：target ES2025、`module: esnext`、`moduleResolution: bundler`、`verbatimModuleSyntax`、`isolatedModules`、`erasableSyntaxOnly`、`allowImportingTsExtensions`（配合 noEmit）。
- **类型导入一律 `import type`**（verbatimModuleSyntax 强制）；重导出用 `export type {`。
- JSX：`react-jsx`，`jsxImportSource: @satorijs/element`（core/插件中的消息元素渲染）。
- `.yml` 导入的类型由 `typings/yml.d.ts` 提供。
- Vue 客户端代码 extends `tsconfig.client.json`（`jsx: preserve`、DOM lib、`types: []`）。

### 命名空间纪律

- workspace 内部引用一律 `@koishi-ce/*`（tsconfig paths 已把 35 个包指向各自 `src/`）。
- `peerDependencies` 保留上游名（`koishi`、`@koishijs/*`）是**刻意的生态兼容设计**，不要改成 `@koishi-ce`（详见 [UPSTREAM.md](../UPSTREAM.md) 与 [dependency-audit.md](./dependency-audit.md) §1）。
- 外部上游包仅两处例外：测试用 `@koishijs/plugin-database-memory`、console 的类型引用 `@koishijs/plugin-server-proxy`。

### Biome / ESLint

- biome：recommended 基线；关停了若干与上游代码风格冲突的规则（`noRedeclare`、`noThenProperty` 等）；`style.useNamingConvention`（typeMember 允许 camelCase/snake_case/PascalCase，objectLiteralMember 允许 CONSTANT_CASE）；`nursery.noFloatingPromises: error`（异步调用必须 `await` 或显式 `.catch`）；assist 开 organizeImports。
- tests / spec / 脚手架模板目录关 namingConvention。
- eslint（仅 .vue）：模板指令合法性、编译宏正确性、`no-mutating-props` 等常见坑规则；组件引用检查忽略 `^K` / `^el-` / `^router-`。

### 格式

- TS/JS/JSON：**tab 缩进、双引号、行尾分号**（biome 默认风格，实测代码现状）。
- `.vue`：2 空格缩进（上游 webui 惯例）。

## 6. 测试写法

框架：`bun:test`（`describe` / `it` / `before` / `after` 从 `bun:test` 导入）+ **chai 断言**（`expect` 从 `chai` 导入，不是 `bun:expect`）。

```ts
import { describe, it } from "bun:test";
import { expect, use } from "chai";
import shape from "../../../../scripts/testing/chai-shape";

use(shape);
```

- **shape 断言**（`.to.have.shape()`）来自 `scripts/testing/chai-shape.ts` 的内联实现（上游 chai-shape 包未跟进 chai 6，故内联），按测试文件目录深度写相对路径。
- 数据库用例用 `@koishijs/plugin-database-memory`（上游包）；时间模拟用 `@sinonjs/fake-timers`（`install()` / `tick()`）。
- spec 文件分布：`packages/node/core/tests/`（8 个）、loader / utils / i18n-utils、`plugins/common/{bind,broadcast,echo,help,inspect}/tests/`、`plugins/webui/{admin,commands}/tests/`。
- `.yml` locale 在测试中可直接 import（Bun 原生支持）。

## 7. 已知坑（历史经验，别再踩）

1. **loader `require()` 加载插件** → CJS 产物必须存在，双格式构建不可拆（见 §4）。
2. **`.yml` 运行时链路**：Bun 原生支持 yml 导入（测试、开发 OK）；Node 下 `require()` CJS 产物中的 `.yml` 没有对应 hook——tsdown 已把 .yml copy 进产物，运行时由 Koishi 侧约定加载。根 tsdown 注释里"koishi 内置 yml-register"的说法与实际不符（全仓无该依赖）。
3. **typecheck / bun test 不读 .gitignore**：gitignored 的 `plugins/webui/market/` 会被卷入——typecheck 侧其 tsconfig 有数百个存量错误；test 侧其 vitest 用例（`*.test.ts`）在 bun 下挂死（见 §3）。定位报错先看路径前缀。
4. **`apps/koishi-create`（目录）≠ `create-koishi-ce`（包名）**；biome override、其 package.json `repository.directory`、根 tsdown 注释仍写旧名 `apps/create-koishi-ce`，是失效路径。引用一律以 `apps/koishi-create` 为准。
5. **前端构建无 vite 配置文件**：全部编程式 `vite.build()`。宿主总装 `packages/web/client/scripts/client.ts` 把产物硬编码到 `plugins/webui/console/dist`（`cwd` 上跳 4 级）；单插件 `build(root)` 内置 `collectWorkspaceAliases()`——未被依赖的 workspace 包不在 node_modules 链接里，必须显式映射。
6. **特殊构建 hack**（动到对应构建链必须复核）：
   - analytics `build/client.ts` 的 "fuck-echarts"：echarts chunk 内 `Symbol` 重命名为 `FuckSymbol`，避免与宿主全局冲突；
   - explorer 的 monaco manualChunks；
   - online `src/build.ts` 把内置模块改写为 `https://registry.koishi.chat/modules/...` 在线加载；
   - client 构建的 vue-i18n `esm-browser.prod` 别名。
7. **hmr 的 esbuild 是运行时依赖**（TS 即时编译），不是 devDep，不能挪。
8. **Biome 的 JSON 行尾不可见字符**：已知、正常、无害，看到即跳过，不调查、不修复、不报告。
9. **上游同步**：本仓无上游 git 历史，port 上游改动按 `UPSTREAM.md` 映射表手动 diff 移植，完成后 `bun run build` + `bun test`。

## 8. 版本与发布现状

- 版本号手动维护（各包 package.json 固定版本），尚未引入 changesets / release 工具链；`tooling/upstream-yakumo-config.json` 存档了删除 yakumo 前各包的构建配置，供未来参考。
- npm 发布未建制（无 CI / 无 release 脚本）；发布策略变化时更新本节与 [ARCHITECTURE.md](./ARCHITECTURE.md)。
