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
5. **ESM-only 产物 + Bun 运行时**：本仓库全面拥抱 Bun——根 tsdown 单遍构建只出 ESM（`index.mjs` + `index.d.ts`），各包 exports 以 `default` 条件兜底；Bun 的 `require()` 可直接加载 ESM，loader 的插件加载链（`require → 插件 lib/index.mjs → @koishi-ce/*`）据此工作，**不要恢复 CJS 双格式产物**。运行时以 Bun 为准（Node 仅支持 ≥22.12 的 require(esm)，不作兼容目标）；`.yml` locale 走 copy loader 原样拷入产物，Bun 原生支持 yml 导入。已收敛 `"type": "module"` 的包：core、cli；其余包后续逐个迁移。
6. **许可证分区**：`packages/web/*`、`plugins/webui/*`（console 插件为 MIT，其余 AGPL）、`apps/online` 为 AGPL-3.0，其余目录 MIT——以 `NOTICE` 表格为准；在 AGPL 目录新增文件同样受 AGPL 约束。
7. **`plugins/webui/market/`（`@koishi-ce/plugin-marketn`）当前被 .gitignore 临时忽略**（迁入对齐期间）；注意 `scripts/typecheck.mjs` 与 `bun test` **不读 .gitignore**，仍会把它卷进检查范围，定位错误时先分辨是否来自该目录。

## 门禁与工作流

```bash
bun install                     # 安装依赖（Bun workspaces，产出 bun.lock）
bun run check                   # 全量门禁 = lint + lint:client + typecheck
bun run lint                    # biome check .（格式 + lint 唯一权威）
bun run lint:client             # eslint 仅查 *.vue（biome 不解析 .vue）
bun run typecheck               # TS7 逐 tsconfig 并行类型检查（bun scripts/typecheck.mjs）
bun run build                   # 根 tsdown：全部 node 侧包 → lib/（ESM-only：index.mjs + index.d.ts）
bun test packages plugins/common plugins/webui/admin plugins/webui/commands
                                # 全量自有用例（20 文件 / 145 用例）；
                                # 裸 `bun test` 会卷入 gitignored 的 market（*.test.ts）并挂起，见已知坑
bun packages/web/client/src/bin.ts build            # 宿主控制台前端 → plugins/webui/console/dist
bun packages/web/client/src/bin.ts build <插件目录>  # 单个 webui 插件的前端
```

- `apps/koishi-create`、`apps/koishi-scripts` 各有自己的 tsdown.config.ts，进目录 `bun run build`；`apps/online` 用 `src/build.ts`（vite 编程式，PPA 在线化）。
- **类型检查现状（进行中）**：严格模式错误清理已完成 `packages/node/*` 六包（0 错误）；webui 插件 `client/` 侧、`packages/web/*`、`apps/online` 及部分插件 `src/` 仍有存量错误。最低要求：**改哪个包，保证该包所在 project 不新增错误**；`packages/node/*` 保持 0。
- 上游同步（port 上游改动）按 `UPSTREAM.md` 的映射表手动 diff 移植，完成后跑 `bun run build` + `bun test`。

## 代码风格

- 缩进 **tab**、双引号、行尾分号——**biome 是格式的唯一权威**（`.editorconfig` 声明的 4 空格与代码现状不符，勿据此手改格式，跑 `bun run format` 即可）；`.vue` 文件 2 空格缩进。
- TS 严格全家桶（`tsconfig.base.json`）：`strict` + `noUncheckedIndexedAccess` + `noPropertyAccessFromIndexSignature` + `exactOptionalPropertyTypes` + `noUnusedLocals/Parameters` + `verbatimModuleSyntax` + `isolatedModules` + `erasableSyntaxOnly` 等；类型导入一律 `import type`。
- TS 双版本策略：根 `typescript` 实为 typescript6（供 @typescript-eslint/parser，其对 TS7 的支持尚未落地），真正的类型检查走 `@typescript/native`（TS7 原生编译器，约 10× 速度）。
- biome：recommended 基线 + `useNamingConvention` + `noFloatingPromises`(error) + organizeImports；eslint 仅补 .vue 的模板语义检查（`vue/no-undef-components` 忽略 `^K` / `^el-` / `^router-` 全局组件）。

## 已知坑（历史经验，别再踩）

- `.yml` 导入链路：类型来自 `typings/yml.d.ts`，测试 / Bun 运行时靠 Bun 原生 yml 支持；构建期由 tsdown copy loader 原样拷入产物并改写引用路径。
- **裸 `bun test`（仓库根）当前会挂起**：bun test 的发现规则包含 `*.test.ts`，会把 gitignored 的 `plugins/webui/market/`（vitest 用例，`i18n.test.ts` 处挂死）卷进来。跑测试用上面带过滤参数的全量命令或按包定向（`bun test packages/node/core`）；market 对齐完成、用例迁为 `*.spec.ts` 后此坑消除。
- 测试断言**新标准是 `bun:test` 的 `expect`**（Jest/Vitest 风格 API）；core 与 echo 已完成迁移（shape 断言用 `packages/node/core/tests/shape.ts` 注册的 `toHaveShape` 自定义 matcher，import 该文件一次即注册）。存量 chai 用例（loader / utils / i18n-utils / broadcast / help / admin / commands）逐步迁移，**不要新增 chai 断言**；`chai-as-promised` 的 `.eventually` / `.be.rejected` 写法对应 `await expect(p).resolves / .rejects`。
- 前端构建**没有 vite 配置文件**，全部是编程式 `vite.build()`：宿主控制台总装在 `packages/web/client/scripts/client.ts`（产物路径硬编码到 `plugins/webui/console/dist`）；单插件用 `packages/web/client/src/index.ts` 的 `build(root)`（内置 `collectWorkspaceAliases()`——未被依赖的 workspace 包不会出现在 node_modules 链接里，必须显式映射才能被 bundler 解析）。
- `scripts/typecheck.mjs` 递归扫描 packages / plugins / apps 下**所有** `tsconfig.json`（不读 .gitignore），仅排除 `apps/koishi-scripts/template/`（模板面向终端用户，依赖不在本仓）。
- 目录名 `apps/koishi-create` 与包名 `create-koishi-ce` 不一致；biome override、该包 repository.directory、根 tsdown 注释等处仍写着旧名 `apps/create-koishi-ce`（失效路径，勿效仿引用，以 `apps/koishi-create` 为准）。
- 特殊构建 hack，动对应构建链必须复核：analytics 的 "fuck-echarts"（echarts chunk 内 `Symbol` 重命名）、explorer 的 monaco manualChunks、online 的内置模块改写为 `registry.koishi.chat` 在线加载、client 构建的 vue-i18n esm-browser.prod 别名。
- hmr 插件的 esbuild 是**运行时依赖**（TS 即时编译），不是 devDep。

## git 提交流程

1. 先跑 `bun run check`（必要时先 `bun run format` / biome 自动修复），确保通过再提交；涉及构建改动加跑 `bun run build` 与 `bun test`。
2. `git add -A` 后提交，提交信息用简体中文，格式参考现有历史（`feat:` / `fix:` / `docs:` / `chore:` / `build:`，可带 scope 如 `fix(core):`）。
3. 提交到主分支 `main`；若当前不在主分支，先切回主分支再提交。
4. 提交完成后向用户简要说明改了什么与提交哈希。
