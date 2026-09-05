# 项目常驻指令

> 本文件是本仓库（`koishi`，GitHub 组织 [Koishi-CE](https://github.com/Koishi-CE) 下的 Koishi 社区再分发 monorepo，npm 作用域 `@koishi-ce`）的常驻开发约定，适用于本仓库内所有会话与任务（含各类 agent 工具；专职开发 agent 的提示词在 `.github/agents/koishi-ce-dev.agent.md`）。

## 基本约束

- **全程使用简体中文**：所有回复、代码注释、提交说明、生成的文档均使用简体中文（README / NOTICE / docs/process/upstream.md / CONTRIBUTING 等面向公开受众的既有英文文档除外）。
- **本仓库是上游 fork 合并仓**：[koishijs/koishi](https://github.com/koishijs/koishi)（MIT）与 [koishijs/webui](https://github.com/koishijs/webui)（部分 AGPL-3.0）的文件级合并重构，**未保留上游 git 历史**；目录映射与同步流程见 `docs/process/upstream.md`，各目录许可证归属见 `NOTICE`。
- **不要在 Biome 的 JSON 行尾不可见字符上浪费 Token**：已知、正常、无害，看到即跳过，不调查、不修复、不报告。
- 除以上约束外，不要过度解读本指令——其余行为遵循默认 Agent 规则。

## 关于 docs/ 文档

- **开发手册**：`docs/guides/development.md`（环境 / 门禁 / 编码约定 / 测试 / 已知坑细节）、`docs/reference/architecture.md`（目录与包清单 / 构建体系 / 依赖纪律）、`docs/process/release.md`（发布流程）、`docs/process/upstream.md`（上游映射）——均以实际代码为准，文档滞后时听代码的。
- **历史决策记录**：`docs/decisions/upgrade-plan.md`（依赖六阶段升级计划书，含 Phase 5 cordis 4 被阻塞的实证结论与重启条件）、`docs/decisions/dependency-audit.md`（99 个外部依赖的立项前审计快照）。

## 硬性约束（违反 = 错误）

1. **peerDependencies 一律指向 CE 包名**：`@koishi-ce/koishi ^1.0.0`、`@koishi-ce/plugin-console ^1.0.0`、`@koishi-ce/loader ^1.0.0` 等（peer 声明用于下游 `bun add` 解析与防 Bun 自动装官方包），**不要写回上游名**（`koishi` / `@koishijs/*`）。
2. **代码内导入一律 `@koishi-ce/*`**；仅有的外部上游导入例外是测试用的 `@koishijs/plugin-database-memory` 与 console 的类型引用 `@koishijs/plugin-server-proxy`。
3. **cordis 生态冻结在 3.x 内洽线**：cordis / minato / @cordisjs/* / @satorijs/* 不得跳 4.x / 1.x——Phase 5 已实证被 `@satorijs/core`（内部携带 cordis ^3，无 cordis 4 线）阻塞并整体回退，重启条件见 `docs/decisions/upgrade-plan.md` Phase 5 节。
4. **vendored 三包不动**：`plugins/infra/{http,proxy,server}` 是预编译产物包（无 `src/`、不走 tsdown、根 tsdown 配置显式 exclude），分别内联再导出 `@cordisjs/plugin-*`（`proxy` 目录系上游 `proxy-agent` 的本地改名，见 docs/process/upstream.md）。
5. **ESM-only 产物 + Bun 运行时**：全部 46 个 workspace 包均为 `"type": "module"`，根 tsdown 单遍构建只出 ESM（`index.mjs` + `index.d.ts`），各包 exports 以 `default` 条件兜底；Bun 的 `require()` 可直接加载 ESM，loader 的插件加载链据此工作，**不要恢复 CJS 双格式产物**。运行时以 Bun 为准（Node 不作兼容目标）；`.yml` locale 走 copy loader 原样拷入产物，Bun 原生支持 yml 导入。
6. **许可证分区**：`packages/web/*` 与 `plugins/webui/*` 全部（含 console 宿主插件）为 AGPL-3.0，其余目录 MIT——以 `NOTICE` 为准；在 AGPL 目录新增文件同样受 AGPL 约束。
7. **market 插件为上游原版再分发**：`plugins/webui/market/`（`@koishi-ce/plugin-market`）对齐自上游 webui `plugins/market`（原版 v2.11.11），社区版 `plugin-marketn` 已被其取代并移除。client 侧依赖 npm 包 `@koishijs/market`，其中的 npm 名 `@koishijs/components` 由单插件构建的 alias 重定向到本仓 workspace 版，避免双实例。
8. **packages/shim 两包不动**：`@koishi-ce/koishi-shim`（4.18.11）与 `@koishi-ce/console-shim`（5.30.11）是下游 npm alias 的占名目标——纯 JS 预编译、版本冻结跟随上游线、changesets ignore（**勿写 changeset、勿 bump、勿改回 1.x 基线**）。下游项目以四行 alias 钉名（`"koishi": "npm:@koishi-ce/koishi-shim@^4.18.11"` 等），机理与维护纪律详见 `packages/shim/README.md`。
9. **create-koishi-ce 的默认模板是内置的纯 `@koishi-ce` 模板**（`apps/koishi-create/src/template/` 目录），不下载上游官方 `@koishijs/boilerplate`；`--template <包名>` 保留为远程模板逃生舱。
10. **一切发布走 `bun run release` 发布链，禁止手动 `npm publish`**（2026-08-31 事故：绕链发布把 `workspace:*` 原样带上 npm，下游全炸）。补发用 `bun run release publish --only <包名>`；流程与约定见 `docs/process/release.md`。

## 门禁与工作流

```bash
bun install                     # 安装依赖（Bun workspaces，产出 bun.lock）
bun run check                   # 全量门禁 = lint + lint:client + typecheck
bun run lint                    # biome check .（格式 + lint 唯一权威）
bun run lint:client             # eslint 仅查 *.vue（biome 只解析 .vue 的 script，模板语义归 eslint）
bun run typecheck               # TS7 类型检查 = 两条 bunx tsc（node 侧 + client 侧大一统串行）
bun run build                   # 根 tsdown：全部 node 侧包 → lib/（ESM-only）
bun test                        # 全量自有用例（97 个测试文件 / 约 800 用例，覆盖全部 node 侧包）
bun test --coverage             # 覆盖率（src 源码口径，总体约 99.8% 行覆盖）
bun packages/web/client/src/bin.ts build            # 宿主控制台前端 → plugins/webui/console/dist
bun packages/web/client/src/bin.ts build <插件目录>  # 单个 webui 插件的前端
```

- `apps/koishi-create` 有自己的 tsdown.config.ts，进目录 `bun run build`；发布链见 `docs/process/release.md`。
- **类型检查现状**：全仓 TS7 下 0 错误。最低纪律：改哪个包，保证该包所在 project 不新增错误。
- 上游同步（port 上游改动）按 `docs/process/upstream.md` 的映射表手动 diff 移植；port 进来的相对导入须补 `.ts` 扩展名（nodenext 约束，上游是无后缀的 bundler 风格）；完成后跑 `bun run build` + `bun test`。

## 代码风格

- 缩进 tab、双引号、行尾分号——**biome 是格式的唯一权威**（`.editorconfig` 声明的 4 空格与代码现状不符，勿据此手改格式，跑 `bun run format` 即可）；`.vue` 文件 2 空格缩进。
- TS 严格全家桶（`tsconfig.base.json`）：`strict` + `noUncheckedIndexedAccess` + `noPropertyAccessFromIndexSignature` + `exactOptionalPropertyTypes` + `noUnusedLocals/Parameters` + `verbatimModuleSyntax` + `isolatedModules` + `erasableSyntaxOnly`；类型导入一律 `import type`；模块解析 nodenext（相对导入一律带 `.ts` 扩展名）。
- TS 双版本策略：根 `typescript` 实为 typescript6（供 @typescript-eslint/parser），类型检查走 `@typescript/native`（TS7 原生编译器）。
- 显式 `any` 全仓为 0，保持住：动态边界用 `unknown` + 收窄。

## 已知坑（一行一条，细节与机理见 docs/guides/development.md §7）

- **测试对 workspace 包加载 src 而非 lib**：改 src 跑测试无需先 build；各包 tsconfig 的 paths 块手工维护（`tooling/sync-test-paths.ts` 已删除）。
- **测试之外的解析走 lib 产物**：改 src 要先 `bun run build` 才在运行时生效。
- **TS7 buildinfo 错误回声**：改根 tsconfig / 依赖结构后旧错误复活，先删 `node_modules/.cache/tsc/{node,web}.tsbuildinfo`。
- **Bun 对失败的解析按「父目录快照」做进程内缓存**：市场装完插件报 `failed to resolve`（重启即消）即此因；防御已内建（resolvePackageJson / resolvePlugin / isResidentInCache 全程纯 fs）。**新增对「可能刚装上的包」的解析时，兜底一律不得走解析 API**。
- **Bun 会把 exports 的 `"bun"` 条件用在 require 上**：CJS 链 require 到 ESM namespace 的 interop 已在 loader `node/interop.ts` 处理，勿动。
- **TS7 的跨文件 `declare module` 增强对经 lib 产物 d.ts 的模块骨架不生效**：node 侧 Services / Events 声明变更时须同步镜像 `plugins/webui/market/client/console-services.ts`。
- **前端构建无 vite 配置文件**（全部编程式 `vite.build()`）；`collectWorkspaceAliases()` 是跨包解析的关键，动 client 构建须复核。
- **特殊构建 hack**：插件可自带 `build/client.ts` 导出 vite 配置覆盖（`@koishi-ce/client` 的 `build()` 显式加载合并，vite 不会自动发现该文件名），analytics 的 "fuck-echarts" 即经此接入；另有 client 构建的 vue-i18n esm-browser.prod 别名。
- **Bun 下 require 坏 TS 抛 `AggregateError`**（errors 为 BuildMessage：`message` + `position.{file,line,column}`，非 esbuild 的 `{ text, location }` 形态），hmr 的错误帧据此识别（`src/error.ts`）；TS 即时编译由 Bun 原生完成，esbuild 已从 hmr 移除。
- **hmr 文件监听用 @parcel/watcher 原生绑定**（Bun 1.4.0 win32 无任何原生监听 API）；`bun install` 提示 Blocked postinstall（@parcel/watcher）属预期——install 脚本仅 build-from-source 兜底，平台预编译包就位即可用，勿加 trustedDependencies、勿调查。explorer 的 chokidar 系上游继承的死依赖（watchers 集合从未填充），已连同字段与 stop override 整体移除——workspace 包的直接依赖已无 chokidar（devDep 树仍经 unocss/sass/vue-router 传递保留，属构建工具内部依赖）。
- **测试断言新标准是 `bun:test` 的 `expect`**：不要新增 chai 断言（存量逐步迁移）。
- **目录名 `apps/koishi-create` 与包名 `create-koishi-ce` 不一致**：引用一律以 `apps/koishi-create` 为准。

## git 提交流程

1. 先跑 `bun run check`（必要时先 `bun run format`），确保通过再提交；涉及构建改动加跑 `bun run build` 与 `bun test`。
2. `git add -A` 后提交，提交信息用简体中文，格式参考现有历史（`feat:` / `fix:` / `docs:` / `chore:` / `build:`，可带 scope 如 `fix(core):`）。
3. 提交到主分支 `main`；若当前不在主分支，先切回主分支再提交。
4. 提交完成后向用户简要说明改了什么与提交哈希。

