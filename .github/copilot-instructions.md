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
8. **`packages/node/koishi` 是 `koishi` 裸名的兼容 shim，不可删除或改名**：本仓框架包名是 `@koishi-ce/koishi`，而社区插件的 peerDependencies 指向上游名 `koishi`——该名字若无归属，市场运行时安装会把 npm 官方 koishi 写进根依赖，形成第二份框架副本（破坏 cordis 对象身份）。该 shim（纯 JS 预编译，不走 tsdown，根 tsdown 显式 exclude）把该名字指回 `@koishi-ce/koishi`；**根 package.json 的 dependencies 必须保留 `"koishi": "workspace:*"` 声明归属**（丢了它 shim 就形同虚设，peer 立即回归 npm 官方包），market 安装器的 `override()` 对 `workspace:` 声明亦有不可覆盖/删除的护栏。shim 版本号刻意为 `4.18.11`（上游 cordis 3.x 冻结线，用于满足 `koishi ^4.x` 形态的 peer 范围），**勿改为本仓 1.x 基线**。

## 门禁与工作流

```bash
bun install                     # 安装依赖（Bun workspaces，产出 bun.lock）
bun run check                   # 全量门禁 = lint + lint:client + typecheck
bun run lint                    # biome check .（格式 + lint 唯一权威）
bun run lint:client             # eslint 仅查 *.vue（biome 亦解析 .vue 但只做格式，模板语义仍归 eslint）
bun run typecheck               # TS7 大一统类型检查 = 两条 bunx tsc（node 侧 tsconfig.json + client 侧 tsconfig.web.json）
bun run build                   # 根 tsdown：全部 node 侧包 → lib/（ESM-only：index.mjs + index.d.ts）
bun test packages plugins/common plugins/webui/admin plugins/webui/commands
                                # 全量自有用例（24 文件 / 185 用例）；裸 `bun test` 已可正常跑通
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
- **Bun 对任何形态的失败解析都按 specifier 做进程内负缓存**：`pkg/package.json` 形态在包落盘前解析失败过一次后，即使包已安装，同进程内该 specifier 永久解析失败；裸名 `pkg` 形态**同样会被污染**（曾被「裸名不受影响」的结论误导过一轮）。市场装完插件「尚未安装 / failed to resolve」即此因（上游 koishijs/webui#273 的 FIXME）。解法是 `@koishi-ce/registry` 导出的 `resolvePackageJson()`——主路径失败后以**纯 fs 探测**（沿 node_modules 链 `existsSync`）兜底，绝不能再调解析 API；market 与 registry 的清单读取都走它。验证类实验务必用全新进程（`bun -e`）。

## git 提交流程

1. 先跑 `bun run check`（必要时先 `bun run format` / biome 自动修复），确保通过再提交；涉及构建改动加跑 `bun run build` 与 `bun test`。
2. `git add -A` 后提交，提交信息用简体中文，格式参考现有历史（`feat:` / `fix:` / `docs:` / `chore:` / `build:`，可带 scope 如 `fix(core):`）。
3. 提交到主分支 `main`；若当前不在主分支，先切回主分支再提交。
4. 提交完成后向用户简要说明改了什么与提交哈希。
