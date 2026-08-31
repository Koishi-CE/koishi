# 项目常驻指令

> 本文件是本仓库（`koishi`，GitHub 组织 [Koishi-CE](https://github.com/Koishi-CE) 下的 Koishi 社区再分发 monorepo，npm 作用域 `@koishi-ce`）的常驻开发约定，适用于本仓库内所有会话与任务。
>
> 说明：本文件与 `.github/copilot-instructions.md` 内容一致（AGENTS.md 供通用 agent 工具读取，另一份供 GitHub Copilot 读取），改动时请保持两份同步。

## 基本约束

- **全程使用简体中文**：所有回复、代码注释、提交说明、生成的文档均使用简体中文（README / NOTICE / UPSTREAM.md 等面向公开受众的既有英文文档除外）。
- **本仓库是上游 fork 合并仓**：[koishijs/koishi](https://github.com/koishijs/koishi)（MIT）与 [koishijs/webui](https://github.com/koishijs/webui)（部分 AGPL-3.0）的文件级合并重构，**未保留上游 git 历史**；目录映射与同步流程见 `UPSTREAM.md`，各目录许可证归属见 `NOTICE`。
- **不要在 Biome 的 JSON 行尾不可见字符上浪费 Token**：这是已知的、正常的、无害的现象。看到即跳过，不要调查成因、不要试图修复、不要反复报告。
- 除以上约束外，不要过度解读本指令——其余行为遵循默认 Agent 规则。

## 关于 docs/ 文档

- **开发依据**：`docs/DEVELOPMENT.md`（环境 / 门禁 / 编码约定 / 已知坑）、`docs/ARCHITECTURE.md`（仓库结构 / 构建体系 / 依赖纪律）——均以实际代码为准，文档滞后时听代码的。
- **历史决策记录**：`docs/upgrade-plan.md`（依赖六阶段升级计划书，含 Phase 5 cordis 4 被阻塞的实证结论与重启条件）、`docs/dependency-audit.md`（99 个外部依赖的全量审计）。

## 硬性约束（违反 = 错误）

1. **peerDependencies 指向上游包名是刻意设计**：`koishi ^4.18.11`（约 28 个包）、`@koishijs/plugin-console ^5.30.11`、`@koishijs/loader`、`@koishijs/client`、`@koishijs/core`（loader 精确锁 `4.18.11`）等一律保留上游名，用于维持与上游插件生态的兼容（约定见 `UPSTREAM.md`）。**不要"顺手修复"成 `@koishi-ce` 名**。
2. **代码内导入一律 `@koishi-ce/*`**（workspace 内部引用）；仅有的外部上游导入例外是测试用的 `@koishijs/plugin-database-memory` 与 console 的类型引用 `@koishijs/plugin-server-proxy`。
3. **cordis 生态冻结在 3.x 内洽线**：cordis / minato / @cordisjs/* / @satorijs/* 不得跳 4.x / 1.x——Phase 5 已实证被 `@satorijs/core`（内部携带 cordis ^3，无 cordis 4 线）阻塞并整体回退，重启条件见 `docs/upgrade-plan.md` Phase 5 节。
4. **vendored 三包不动**：`plugins/infra/{http,proxy-agent,server}` 是预编译产物包（无 `src/`、不走 tsdown、根 tsdown 配置显式 exclude），分别内联再导出 `@cordisjs/plugin-*`。
5. **ESM-only 产物 + Bun 运行时**：本仓库全面拥抱 Bun——根 tsdown 单遍构建只出 ESM（`index.mjs` + `index.d.ts`），各包 exports 以 `default` 条件兜底；Bun 的 `require()` 可直接加载 ESM，loader 的插件加载链（`require → 插件 lib/index.mjs → @koishi-ce/*`）据此工作，**不要恢复 CJS 双格式产物**。运行时以 Bun 为准（Node 仅支持 ≥22.12 的 require(esm)，不作兼容目标）；`.yml` locale 走 copy loader 原样拷入产物，Bun 原生支持 yml 导入。全部 38 个 runtime 包均已收敛 `"type": "module"`，类型检查走 nodenext（相对导入一律带 `.ts` 扩展名）——ESM-only 收敛完成。
6. **许可证分区**：`packages/web/*`、`plugins/webui/*`（console 插件为 MIT，其余 AGPL）、`apps/online` 为 AGPL-3.0，其余目录 MIT——以 `NOTICE` 表格为准；在 AGPL 目录新增文件同样受 AGPL 约束。
7. **market 插件为上游原版再分发**：`plugins/webui/market/`（`@koishi-ce/plugin-market`）对齐自上游 webui `plugins/market`（原版 v2.11.11），社区版 `plugin-marketn` 已被其取代并移除。client 侧依赖 npm 包 `@koishijs/market`（上游以源码发布的组件库，直接打入插件 dist），其中的 npm 名 `@koishijs/components` 由单插件构建的 alias 重定向到本仓库 workspace 版，避免双实例。
8. **`packages/shim/` 集中管理全部上游包名占位 shim（`packages/node` 只放功能包，勿把 shim 混回去）**：上游生态与本仓部分包的 peerDependencies 声明上游名（`koishi` 裸名 / `@koishijs/plugin-console` / `@koishijs/core` / `@koishijs/loader`），这些名字若无归属，Bun 的 peer 自动安装会把 npm 官方全家桶拉进 node_modules，与 `@koishi-ce/*` 形成双实例、破坏 cordis 对象身份。六包全部纯 JS 预编译（无 `src/`、不走 tsdown、根 tsdown 以 `packages/shim/*` 通配 exclude）、版本冻结、changesets ignore（**勿写 changeset、勿 bump**）：四个 workspace 占位（`koishi` 裸名 @4.18.11、`upstream-core` @4.18.11、`upstream-loader` @4.6.11、`upstream-plugin-console` @5.30.11，均 private）——**根 package.json 的 dependencies 必须保留对应四行 `workspace:*` 声明归属**（丢了 peer 立即回归官方包），`upstream-*` 的 package.json 带 `"koishi-ce": { "upstreamShim": true }` 标记、`LocalScanner` 据此跳过；两个发布 shim（`@koishi-ce/koishi-shim` @4.18.11、`@koishi-ce/console-shim` @5.30.11）是下游 npm alias 的目标。已废弃的 `@koishi-ce/core-shim` / `@koishi-ce/loader-shim` 已从仓库删除（npm 历史版本保留），**勿再引用**。
9. **下游项目以 npm alias 占名：四行 alias、两个包**：`"koishi": "npm:@koishi-ce/koishi-shim@^4.18.11"`、`"@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11"`（**精确锁不带 `^`**——@koishi-ce/loader 的 peer 是精确版本 `4.18.11`，须逐字相等）、`"@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11"`、`"@koishijs/plugin-console": "npm:@koishi-ce/console-shim@^5.30.11"`。koishi-shim 一名兼任三个上游名：`@koishi-ce/koishi` 是 core + loader 的合并再导出（与上游 koishi 主包入口同构），对三个名字的消费者 named 导出全覆盖且对象身份唯一。Bun 对 `npm:` alias 的 peer 判定看**落盘包的 version**，故 shim 版本冻结 4.18.x / 5.30.x 线；market 安装器的 `isGuardedRequest()` 把 `npm:@koishi-ce` 前缀与 `workspace:` 同等保护（不可覆盖/删除）。
10. **create-koishi-ce 的默认模板是内置的纯 `@koishi-ce` 模板**（`apps/koishi-create/src/template.ts`），不再下载上游官方 `@koishijs/boilerplate`——那会生成全官方生态的项目（正是被修掉的 bug）。`--template <包名>` 保留为远程模板逃生舱。模板要点：Bun 运行时、上游名 alias 钉 shim（四行两包，见第 9 条）、依赖统一 `^1.0.0` 区间、不预装 adapter / database（本仓无再分发，官方版可后续从市场装，peer 已被 alias 钉住）。
11. **一切发布走 `bun run release` 发布链，禁止手动 `npm publish`**（2026-08-31 事故：绕链手动发布把 `workspace:*` 原样带上 npm——config@1.0.5 / market@1.0.6 / hmr@1.0.3，下游 `bun install` 全炸）。发布链 publish 环负责 workspace 协议改写并带终局断言（依赖字段不得残留 `workspace:` / `file:` / `link:`）；补发漏发或重发坏版本用 `bun run release publish --only <包名,逗号分隔>`（须先 bump 版本），同样走改写与断言。`@koishijs/client` 是 optional peer，Bun 不自动安装 optional peer，无需为它占名。

## 门禁与工作流

```bash
bun install                     # 安装依赖（Bun workspaces，产出 bun.lock）
bun run check                   # 全量门禁 = lint + lint:client + typecheck
bun run lint                    # biome check .（格式 + lint 唯一权威）
bun run lint:client             # eslint 仅查 *.vue（biome 亦解析 .vue 但只做格式，模板语义仍归 eslint）
bun run typecheck               # TS7 大一统类型检查 = 两条 bunx tsc（node 侧 tsconfig.json + client 侧 tsconfig.web.json）
bun run build                   # 根 tsdown：全部 node 侧包 → lib/（ESM-only：index.mjs + index.d.ts）
bun test                        # 全量自有用例（约 100 文件 / 755+ 用例，覆盖全部 node 侧包）
bun test --coverage             # 覆盖率（src 源码口径，当前总体约 99.8% 行覆盖；统计依赖下述 paths 注入）
bun packages/web/client/src/bin.ts build            # 宿主控制台前端 → plugins/webui/console/dist
bun packages/web/client/src/bin.ts build <插件目录>  # 单个 webui 插件的前端
```

- `apps/koishi-create` 有自己的 tsdown.config.ts，进目录 `bun run build`（koishi-scripts 已并入根构建）；`apps/online` 用 `src/build.ts`（vite 编程式，PPA 在线化）。
- **类型检查现状**：全仓 50 个 project 在 TS7 下 0 错误（含 `packages/web/*`、`apps/online` 与 market 两个 project）。最低要求：**改哪个包，保证该包所在 project 不新增错误**。
- 上游同步（port 上游改动）按 `UPSTREAM.md` 的映射表手动 diff 移植，port 进来的源码相对导入须补 `.ts` 扩展名（nodenext 约束，上游是无后缀的 bundler 风格），完成后跑 `bun run build` + `bun test`。

## 代码风格

- 缩进 **tab**、双引号、行尾分号——**biome 是格式的唯一权威**（`.editorconfig` 声明的 4 空格与代码现状不符，勿据此手改格式，跑 `bun run format` 即可）；`.vue` 文件 2 空格缩进。
- TS 严格全家桶（`tsconfig.base.json`）：`strict` + `noUncheckedIndexedAccess` + `noPropertyAccessFromIndexSignature` + `exactOptionalPropertyTypes` + `noUnusedLocals/Parameters` + `verbatimModuleSyntax` + `isolatedModules` + `erasableSyntaxOnly` 等；类型导入一律 `import type`。
- TS 双版本策略：根 `typescript` 实为 typescript6（供 @typescript-eslint/parser，其对 TS7 的支持尚未落地），真正的类型检查走 `@typescript/native`（TS7 原生编译器，约 10× 速度）。
- biome：recommended 基线 + `useNamingConvention` + `noFloatingPromises`(error) + organizeImports；eslint 仅补 .vue 的模板语义检查（`vue/no-undef-components` 忽略 `^K` / `^el-` / `^router-` 全局组件）。

## 已知坑（历史经验，别再踩）

- **测试进程对 workspace 包加载 src 而非 lib**：Bun 运行时按「离文件最近的 tsconfig.json」取 paths 且不跟随 extends——各包 tsconfig.json 里由 `tooling/sync-test-paths.ts` 注入的 paths 块（带生成标记）把 `@koishi-ce/*` 指到 src，覆盖率才能统计源码。**改 tsconfig.base.json 的 paths 后须重跑 `bun tooling/sync-test-paths.ts`**（幂等，自动 biome 格式化）；因此改 src 后跑测试**无需先 build**，测试验证的始终是源码。跨包借用的测试依赖统一走根 devDependencies（如 `@koishijs/plugin-database-memory`），不要写穿其他包 node_modules 的相对导入（会把上游 src 拉进类型程序）。
- `.yml` 导入链路：类型来自 `packages/node/core/src/i18n/yml.d.ts`（由 tsconfig.base 的 files 全局注入），测试 / Bun 运行时靠 Bun 原生 yml 支持；构建期由 tsdown copy loader 原样拷入产物并改写引用路径。
- **TS7 native 的跨文件 `declare module` 增强对"经 lib 产物 d.ts 的模块骨架"不生效**：浏览器端工程对 console 类型的消费走 `packages/web/client/client/shims.d.ts` 手写的 `"@koishi-ce/plugin-console"` 骨架（无 node_modules 链接与 paths 指向真实插件），各插件 client 工程须向**同一模块名**镜像自己的 Services / Events 注入，且载荷要用骨架自带的 `DataService<T>` 包装（client 侧 Store 映射按 `Services[K] extends DataService<infer T>` 推导）。market 的镜像是 `plugins/webui/market/client/console-services.ts`（Dict / Dependency 为内联镜像，类型实体经 `market/client/tsconfig.json` 指向各包 lib 产物 d.ts 解析）——**node 侧声明变更时须同步该文件**。
- market 迁入的类型链细节：client 基座 `tsconfig.client.json` 的 paths 把 `@koishi-ce/plugin-market` / `@koishi-ce/plugin-config` 指到 **lib 产物 d.ts**（等效 npm 生态 exports types 解析；指向 src 会把 node 侧源码混进 client 检查）；`market/client/tsconfig.json` 在此基础上补了 `@koishi-ce/{koishi,console,registry}` 的产物 d.ts paths（镜像文件类型引用的解析通道，勿指 src——会引入源码连锁）；`collectWorkspaceAliases()` 新增 `<包名>/client` 子路径映射（跨插件引用彼此 client API 的解析通道，如 market 引 config 的 EnvInfo）。
- biome 对 `.vue` 只解析 script 块、**不追踪模板引用**：biome.json 已对 `**/*.vue` 关闭 noUnusedVariables / noUnusedImports / noUnusedFunctionParameters / useVueMultiWordComponentNames / useImportType（模板使用会假阳性，useImportType 会把模板组件的值导入改回 `import type` 使运行时失注册）；模板语义检查归 eslint（`bun run lint:client`）。
- 显式 `any` 全仓为 0，保持住：动态边界（JSON.parse / socket 消息 / 第三方回调）用 `unknown` + 收窄，不要回退 `any`；`{}` 类型用 `Record<never, never>`。
- 测试断言**新标准是 `bun:test` 的 `expect`**（Jest/Vitest 风格 API）；core 与 echo 已完成迁移（shape 断言用 `packages/node/core/tests/shape.ts` 注册的 `toHaveShape` 自定义 matcher，import 该文件一次即注册）。存量 chai 用例（loader / utils / i18n-utils / broadcast / help / admin / commands）逐步迁移，**不要新增 chai 断言**；`chai-as-promised` 的 `.eventually` / `.be.rejected` 写法对应 `await expect(p).resolves / .rejects`。
- 前端构建**没有 vite 配置文件**，全部是编程式 `vite.build()`：宿主控制台总装在 `packages/web/client/scripts/client.ts`（产物路径硬编码到 `plugins/webui/console/dist`）；单插件用 `packages/web/client/src/index.ts` 的 `build(root)`（内置 `collectWorkspaceAliases()`——未被依赖的 workspace 包不会出现在 node_modules 链接里，必须显式映射才能被 bundler 解析）。
- 类型检查是**两条纯 `bunx tsc` 串行**：node 侧大一统 `tsconfig.json`（include = 原 31 个 node 工程并集）+ client 侧大一统 `tsconfig.web.json`（include = 16 个 client 工程并集，paths 为各工程覆盖的合并、exclude 含 schemastery-vue-runtime.ts——第三方源码不进类型程序）。**不要恢复逐 tsconfig 并行 spawn**：50 进程并发在 win32 下有 Bun.spawn 竞态且无必要；新增 client 工程时须同步 tsconfig.web.json 的 include/paths。两条链已开 `incremental`，buildinfo 按入口分文件存 `node_modules/.cache/tsc/`（node / web / legacy 各一份——入口文件集合不同，共用会互相判失效；删掉即全量重建）。
- 目录名 `apps/koishi-create` 与包名 `create-koishi-ce` 不一致；biome override、该包 repository.directory、根 tsdown 注释等处仍写着旧名 `apps/create-koishi-ce`（失效路径，勿效仿引用，以 `apps/koishi-create` 为准）。
- 特殊构建 hack，动对应构建链必须复核：analytics 的 "fuck-echarts"（echarts chunk 内 `Symbol` 重命名）、explorer 的 monaco manualChunks、online 的内置模块改写为 `registry.koishi.chat` 在线加载、client 构建的 vue-i18n esm-browser.prod 别名。
- hmr 插件的 esbuild 是**运行时依赖**（TS 即时编译），不是 devDep。
- **Bun 对失败的解析按「父目录快照」做进程内缓存（2026-08 实证修正，原以为按 specifier 记负缓存）**：解析 `pkg/package.json` 失败时，只要包的直接父目录（node_modules 或 node_modules/@scope）**已存在**，该目录的内容列表即被缓存——此后即使包已落盘，同进程内该包的**任何形态**（`pkg/package.json` / 裸名）经**任何解析 API**（createRequire.resolve、Bun.resolveSync）都永久失败；父目录不存在时无快照可缓存，落盘后即可正常解析（同一现象「时而复现时而正常」的根源）。市场装完插件报 `failed to resolve` / `cannot resolve plugin`（重启即消）即此因：装包前的探测失败一次 → 装完同进程内解析全炸（上游 koishijs/webui#273 的 FIXME）。现行防御分三层：`resolvePackageJson()`（@koishi-ce/registry）**全程纯 fs**（装前探测零解析 API 调用）；loader 的 `resolvePlugin()` 对裸名候选在 `Bun.resolveSync` 失败后纯 fs 沿 node_modules 链定位包目录、按 manifest（bun→require→node→default 条件序）计算入口**绝对路径**（`require(绝对路径)` 不经目录查找、不受快照影响，装完无需重启即可加载）；config 的驻留判断与 market 的 `isResidentInCache()`（已下沉到 registry）同样全程纯 fs。**新增任何对「可能刚装上的包」的解析时，兜底一律不得走解析 API**。验证类实验务必用全新进程（`bun -e`），复现快照污染须先预建父目录（node_modules 或 node_modules/@scope）。
- **Bun 会把 exports 的 `"bun"` 条件用在 require 上**（Node 的 require 条件集不含它）：postgres@3.4.x 这类包（bun→ESM 源码、default→CJS 产物）在 Bun 下被 CJS 依赖链 require 到 ESM namespace，esbuild 产物 `__toESM(mod, 1)` 的 node 兼容 interop 无条件把整个 namespace 当 default，`@minatojs/driver-postgres` 的 start() 据此抛 "is not a function ... is an instance of Module"（原版 koishi 走 Node 无此问题）。修复在 loader 的 `node/interop.ts`：`NodeLoader.import` require 插件前遍历其依赖树，对「`require.resolve(spec, { paths: [消费方目录] })`（树内消费方的真实解析键、字面路径）≠ Node require 语义入口（`[require, node, default]` 条件序 + main 兜底）」的包，把 Node 语义入口的加载结果预置进 `require.cache`；ESM import 侧不读 require.cache（实证互不干扰），无分歧零副作用。另：market 装完插件报 `ResolveMessage: Cannot find module` 是负缓存族问题——安装器判断旧版本是否驻留内存原走 `require.resolve(name)`（上游 koishijs/webui#273 FIXME），装包前的探测已把裸名污染、装完必炸；现改走 `isResidentInCache()`（resolvePackageJson 取包目录 + require.cache 前缀扫描，异常保守视为驻留）。

## git 提交流程

1. 先跑 `bun run check`（必要时先 `bun run format` / biome 自动修复），确保通过再提交；涉及构建改动加跑 `bun run build` 与 `bun test`。
2. `git add -A` 后提交，提交信息用简体中文，格式参考现有历史（`feat:` / `fix:` / `docs:` / `chore:` / `build:`，可带 scope 如 `fix(core):`）。
3. 提交到主分支 `main`；若当前不在主分支，先切回主分支再提交。
4. 提交完成后向用户简要说明改了什么与提交哈希。
