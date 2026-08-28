# 依赖升级计划书

> 前置文档:[dependency-audit.md](./dependency-audit.md) · 日期:2026-08-27
> 原则:**最现代、高性能、Bun 原生优先;允许破坏性更新;git 分阶段提交可回滚。**
> 硬约束:所有面向上游运行时的 `peerDependencies`(`koishi`、`@koishijs/*`)**保持不动**(fork 兼容性设计,见审计 §1)。

**已批准决策(2026-08-27 审阅):**
1. ✅ **Phase 5(cordis 生态 4.x)立项执行**,在 RC 上先行,stable 后跟进收尾。
2. ✅ **TypeScript 7 采用**(保留 typescript@^5.9 双版本兜底声明产出,若 TS7 实测可产出则移除)。
3. ✅ **测试迁移到 `bun test`**。**明确不引入 vitest**:现有用例均为纯逻辑测试(core/parser/database/session 等),`bun test` 零依赖、原生速度、与 fork 的 Bun-first 目标一致;vitest 经 Bun 的 Node 兼容层跑反而更慢、依赖链重。若未来出现 Vue 组件/DOM 测试需求,再单独引入 vitest(+happy-dom)按包共存。
4. ✅ **引入 tsdown ^0.22**(Rolldown Rust 内核的库打包器):替代两个 apps 的 `tsc -b`;Phase 5 重做 vendored `plugins/infra/server` 时用它从 `@cordisjs/plugin-server` 1.x 源码重建产物(含 d.ts);为仍声明 `main: lib/` 且不走 zero-build 的核心包提供统一 lib 构建出口。前端 console/website 的构建继续走 vite(tsdown 定位是 library bundler,不替代应用构建)。

---

## 总览

| 阶段 | 内容 | 风险 | 预估工作量 |
|---|---|---|---|
| Phase 0 | 清理死依赖/幽灵依赖/历史残留 | 低 | 0.5 天 |
| Phase 1 | 独立工具库 major 跳版(19 项) | 低-中 | 1 天 |
| Phase 2 | 前端 UI 栈整体跳版(9 项) | 中 | 1.5 天 |
| Phase 3 | 构建链跳代:vite 8 / TS 7 / biome 2.5 + **tsdown 引入** | 中-高 | 1.5 天 |
| Phase 4 | 测试迁移 mocha → `bun test` + chai 6 | 中 | 1 天 |
| Phase 5 | **cordis 生态 4.x 跳代(已批准)** + vendored server 重建 | 高 | 2-3 天 |

每阶段完成后统一执行验证门禁(见文末),通过后独立 commit,失败可单独回滚。

---

## Phase 0 — 清理(不升任何版本)

**删除(声明与代码核对均为零引用/弃用):**

| 项 | 位置 | 理由 |
|---|---|---|
| `ws`、`uuid`、`@types/uuid` | plugins/webui/console | 全仓库零导入;@types/uuid 官方弃用 |
| `throttle-debounce` | plugins/webui/explorer | 该包内未使用(admin 侧保留) |
| `ns-require` | packages/web/client、plugins/webui/market | 两处均未使用(loader 侧保留) |
| `@types/tar` | create-koishi-ce | 官方弃用(tar 7 自带类型,随 Phase 1) |
| `yakumo` devDep | koishi-scripts | 仅为一个 `PackageJson` 类型;内联为本地类型定义 |

**补声明(apps/online 幽灵依赖):** `koa`、`@koa/router`、`vite`、`@maikolib/vite-plugin-yaml`、`js-yaml`、`tsconfig-utils` 写入其 package.json(修 hoisting 隐患;`serve.ts` 迁移 `Bun.serve` 留作后续独立任务)。

**残留物清理:** 移除各插件 `eslint` lint 脚本与 `packages/web/client/.eslintrc.yml`;删除 `packages/node/core/lib/`(上游旧产物)与 `packages/utils/node_modules/`;`.gitignore` 增补 `**/lib/`、`*.tsbuildinfo`;补建 `LICENSES/` 或修正 `NOTICE`/`UPSTREAM.md` 链接。

---

## Phase 1 — 独立工具库 major 跳版

均不触及 cordis 生态,与 koishi 运行时解耦。项目已 `type: module`,ESM-only 化成本主要在个别 CJS `require` 改 import(将逐一核对使用点)。

| 包 | 现状 → 目标 | 破坏性要点与适配 |
|---|---|---|
| execa | ^5.1.1 → **^10.0.1** | ESM-only;result 对象字段变化;market installer 用法简单,低适配 |
| open | ^8.4.2 → **^11.0.1** | ESM-only;API 同形 |
| dotenv | ^16.4.5 → **^17.4.2** | 行为兼容;后续可选评估 Bun 原生 .env 移除(不在本期) |
| p-map | ^4.0.0 → **^7.0.6** | ESM-only;新增 AbortSignal,签名兼容 |
| chokidar | ^3.6.0 → **^5.0.0** | 4 起移除内建 glob、5 为 ESM;hmr/explorer 仅用 `watch()` 基础 API |
| file-type | ^16.5.4 → **^22.0.2** | ESM-only(17 起);explorer 用法为流式嗅探,核对 API |
| throttle-debounce | ^3.0.1 → **^5.0.2** | 纯 ESM;@types 已支持 v5 |
| js-yaml | ^4.1.0 → **^5.4.1** | major,核对 loader/locales/scripts 三处 `load/dump` 调用 |
| ansi_up | ^5.2.1 → **^6.0.6** | logger 前端,低风险 |
| @babel/code-frame | ^7.27.1 → **^8.0.0** | hmr error.ts,API 同形 |
| cac | ^6.7.14 → **^7.0.0** | 三处 CLI(cli/scripts/client bin),先跑 `--help` 冒烟 |
| fs-extra | ^10.1.0 → **^11.4.0** | koishi-scripts;顺带评估换 `node:fs/promises`(可选) |
| globby | ^11.1.0 → **^16.2.4** | ESM-only;API 兼容 |
| tar | ^6.2.1 → **^7.5.22** | ESM + 自带类型;create-koishi-ce 解包路径核对 |
| yargs-parser | ^21.1.1 → **^22.0.0** | create-koishi-ce argv |
| which-pm-runs | ^1.1.0 → **^2.0.0** | 四处使用,API 同形 |
| axios | ^1.6.8 → **移除,改原生 `fetch`** | Bun/Node 24 均原生;create-koishi-ce 单一下载场景,零损失 |
| reggol | ^1.7.1 → **^2.1.0** | core devDep;与 cordis 内置版本解耦验证 |
| semver / chardet / envinfo / esbuild | → ^7.8.5 / ^2.2.0 / ^7.21.0 / ^0.28.2 | minor 顺带 |

---

## Phase 2 — 前端 UI 栈跳版

一次到位到 2026 主线版本;element-plus 从精确锁 `2.7.7` 改为 `^2.14.5`(允许 minor 漂移)。

| 包 | 现状 → 目标 | 破坏性要点与适配 |
|---|---|---|
| vue | ^3.5.12 → **^3.5.42**(范围内刷新) | 无破坏 |
| vue-router | ^4.4.5 → **^5.2.0** | 核对 `createRouter/createWebHashHistory` 与类型导出;client 单处集中使用 |
| vue-i18n | ^9.10.2 → **^11.4.10** | v10+ 移除 Legacy API 模式;client 若用 Composition API 则低适配,需核 locale 加载链 |
| @vueuse/core | ^11.1.0 → **^14.4.0** | ESM-only,与 vite 8 配套;逐 API 核对(用量分散在 6+ 包) |
| element-plus | 2.7.7 → **^2.14.5** | minor;核对主题 SCSS 变量与虚拟列表用法 |
| unocss | ^0.65.1 → **^66.8.1** | 版本线跨越;`preset-mini` → `presetWind3/4` 命名迁移,重跑 client 构建比对产物体积 |
| echarts + vue-echarts | ^5.5.0/^6.6.9 → **^6.1.0 / ^8.1.0** | 成对升级;analytics 构建脚本中 echarts chunk 的 `Symbol` 改名 hack 需复核 |
| monaco-editor | ~0.44.0 → **~0.56.0** | explorer 编辑器;worker 打包方式复核(manualChunks 已有) |
| d3-force / schemastery-vue / marked-vue / spark-md5 | 保持 | 已是最新/生态冻结 |

---

## Phase 3 — 构建链跳代

| 包 | 现状 → 目标 | 破坏性要点与适配 |
|---|---|---|
| vite + @vitejs/plugin-vue | ^5.4.10 / ^5.1.4 → **^8.2.2 / ^6.0.8** | 5→8 跨三代(6: Environment API;7: baseline 现代化;8: Rolldown 内核)。本项目为编程式 `vite.build()`,无配置文件迁移负担;重点回归:SCSS `modern-compiler`、yaml 插件兼容、`manualChunks`、产物 chunk 结构 |
| @maikolib/vite-plugin-yaml | ^1.0.1(保持) | 最新 dist-tag 为预发布 1.1.1-0,不追 |
| sass | ^1.82.0 → **^1.103.1** | minor |
| typescript | ^5.6.2 → **^7.0.2**(已批准) | TS7 原生编译器(约 10× 类型检查);先实测 `tsc -p` 类型检查与 d.ts 产出。若声明产出能力缺失,则根保留 `typescript@^5.9` 仅作 emit、类型检查走 TS7(双版本并存),Phase 5 末统一复评移除 |
| @types/node | ^25.0.9 → **^26.4.0** | 与 Bun 1.4 的 Node 26 兼容层对齐 |
| @biomejs/biome | ^2.0.0 → **^2.5.10** | minor,schema 已匹配 |
| **tsdown(新增)** | — → **^0.22.14** | Rolldown Rust 内核库打包器。职责:① 替代 `apps/create-koishi-ce`、`apps/koishi-scripts` 的 `tsc -b`(bin + d.ts 一次产出);② Phase 5 用它重建 vendored `plugins/infra/server`(从 `@cordisjs/plugin-server` 1.x 重新打包,产出 `index.mjs/index.cjs/index.d.ts`);③ 为保留 `main: lib/` 的核心包提供统一 lib 构建。不改前端 vite 构建链 |

**顺带工程项(构建链一致性好时机):** 根 package.json 增加 `typecheck`(`tsc --noEmit -p tsconfig.json`)与 `test` 脚本占位;评估 `tsconfig.base.json` target es2022 → es2023;删掉各包残留的 `tsc -b` build 脚本统一收敛到 tsdown 配置。

---

## Phase 4 — 测试迁移:`mocha` → `bun test`

与 fork「测试套件在 Bun 上可运行」的既定目标对齐,消除 mocha 引导成本:

1. 运行器换为 **Bun 原生 `bun test`**(`describe/it/before/after` 全局兼容现有用例);删除 `mocha`、`@types/mocha`。
2. **chai ^6.2.2 + chai-as-promised ^8.0.2 保留**(纯 ESM,Bun 下可用);若 v6/v8 自带类型则删 `@types/chai`、`@types/chai-as-promised`。
3. **chai-shape 1.1.0 兼容性验证**:如不兼容 chai 6,内联 ~20 行 shape 断言(生态冻结包,不等待上游)。
4. `@sinonjs/fake-timers ^6 → ^15.4.0`:API(`install/tick` 同形),runtime.spec 单点回归。
5. **`.yml` 导入支撑**:测试若经 loader 触达 locale yml,需 `bunfig.toml` + `Bun.plugin` 预加载注册 yml 加载器(替代 yml-register 的 require hook;yml-register 在 TS/类型层保留)。
6. 根 `test` 脚本落地为 `bun test`;**决策点:若 5 的插件方案受阻,fallback 为 mocha@11(保底升级)**,执行时二选一并汇报。

---

## Phase 5 — cordis 生态 4.x 跳代(已批准执行)

| 包 | 现状 → 目标 | 说明 |
|---|---|---|
| cordis | ^3.18.1 → **^4.0.0-rc**(钉 rc.x,stable 后放开) | DI 容器 API 大版本;逐包跑测试回归 core/console/utils/loader |
| minato + @minatojs/driver-memory | ^3.7.0 → **^4.0.x** | ORM major,与 cordis 4 配套;core 数据库用例重点回归 |
| @cordisjs/plugin-http | ^0.6.3 → **^1.5.2** | `ctx.http` 新版;core 插件装配核对 |
| @cordisjs/plugin-server | ^0.2.9 → **^1.7.0** | 用 **tsdown 从 1.x 源码重建 vendored `plugins/infra/server`**(index.mjs/cjs/d.ts),替换旧产物并核对导出面 |
| reggol 生态配套 | 随 Phase 1 已升 ^2.1.0 | 确认与 cordis 4 日志体系兼容 |

**peer 语义决策(随本阶段落地):** 跳代后运行时为 cordis 4,上游 koishi 4.18 插件(依赖 cordis 3)与之不兼容的部分需明确边界——peerDeps 保持指向上游名不变,但在 README/UPSTREAM.md 记录「@koishi-ce 运行时基于 cordis 4,兼容面较上游收窄」的事实说明。

### 执行结果(2026-08-27):**被上游阻塞,已实证并回退**

按上表完成全部升版(cordis ^4.0.0-rc.8 / minato ^4.0.1 / @minatojs/driver-memory ^4.0.0 / @cordisjs/plugin-http ^1.5.2 / @cordisjs/plugin-server ^1.7.0)后,类型检查零错误,但运行时测试 14/20 文件失败。根因(实证):

1. **运行时双 cordis 并存**:`@koishi-ce/core` 自身解析到 cordis 4.0.0-rc.8,但其继承链上的 `@satorijs/core@4.6.0`(npm 最新,连 next tag 都没有 cordis 4 线)内部携带 cordis ^3.18.1 —— 同一进程加载两套 DI 容器,服务注入体系互相不可见(`ctx.model.extend` 在 cordis 3 的 Context 上为 undefined),App 启动即崩。
2. **4.x 线是不可分割集群**:`@cordisjs/plugin-http@1.5.2` 与 `@cordisjs/plugin-server@1.7.0` 均硬依赖 cordis ^4.0.0-rc;没有"部分跳代"的可行组合。
3. 类型检查通过具有迷惑性:`skipLibCheck` + 两代 cordis 类型结构相似,掩盖了运行时不兼容。

**处置:** 全部回退至 cordis 3 内洽线,测试恢复 20/20。vendored `plugins/infra/server` 维持 @cordisjs/plugin-server ^0.2.9 原状(其重建以 1.x 为前提,随本阶段一并冻结)。

**重启条件(满足其一时重新执行本阶段):**
- `@satorijs/core` 发布依赖 cordis 4 的版本(哪怕 next/beta tag);
- 或上游 koishi 官方启动 cordis 4 迁移(fork 随上游同步);
- 或 fork 决定自建 @satorijs/core fork(工作量大,需单独立项)。

重跑方式:按本节首表恢复版本号 → `bun install` → `bun run test` 观察 `ctx.model` 注入是否恢复 → 处理 vendored server 重建。

---

## 测试栈最终形态(决策记录)

`bun test`(原生,零新增依赖)+ chai ^6 + chai-as-promised ^8(+ 需要时内联 shape 断言)。**vitest 不引入**——当前 0 个 DOM/组件用例,vitest 的价值点(Node 兼容层成熟度、jsdom 深度集成、组件测试)在本仓全部不成立;待未来出现 Vue 组件测试需求时按包独立引入,与本形态共存。

---

## 明确不动项

- `cosmokit`、`@satorijs/*` 全系、`@cordiverse/*`、`@koishijs/*` 外部依赖与全部上游 peer 声明(生态冻结/刻意保留)。
- `schemastery-vue`、`marked-vue`、`spark-md5`、`d3-force`、`anymatch`、`fastest-levenshtein`、`inaba`、`kleur`、`prompts`、`get-registry`、`ns-require`(loader)、`chai-shape`(兼容前提下)— 均已是最新。
- `plugins/infra/server` vendored 产物(Phase 5 一并处理)。

## 验证门禁(每阶段必过)

```bash
bun install                        # 依赖解析与 workspace 健康
bun run lint                       # biome
bunx tsc --noEmit -p tsconfig.json # 全仓类型检查(paths 别名全覆盖)
bun packages/web/client/src/bin.ts build   # 控制台前端产物构建(Phase 2/3 重点)
bun test                           # Phase 4 起
# 定向冒烟:koishi --help(cli/cac)、create-koishi-ce --yes 临时目录脚手架(Phase 1)
```

## 风险与回滚

- 每阶段独立分支 + commit(含 `bun.lock`),单阶段失败 `git revert` 即回滚,不产生跨阶段耦合。
- 高不确定点集中在:**vite 8 与 unocss 66 的插件协议**、**TS7 声明产出**、**bun test 的 yml 加载**——均已在对应阶段内置 fallback 或决策点,执行中逐项实测汇报。
