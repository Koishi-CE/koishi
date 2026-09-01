# 仓库架构（ARCHITECTURE）

> `koishi`（Koishi-CE）的仓库结构、包清单、构建体系与依赖纪律。以实际代码为准，文档滞后时听代码的。开发环境与命令见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 1. 定位

- **是什么**：[Koishi](https://koishi.chat) 聊天机器人框架的 **Bun-first 社区再分发**（community redistribution）。由 [koishijs/koishi](https://github.com/koishijs/koishi)（MIT）与 [koishijs/webui](https://github.com/koishijs/webui)（部分 AGPL-3.0）两个上游仓库**文件级合并**（无上游 git 历史）重构为单一 Bun workspace monorepo。
- **发布身份**：GitHub 组织 [Koishi-CE](https://github.com/Koishi-CE)，npm 作用域 `@koishi-ce`（`koishi` → `@koishi-ce/koishi`，命令名不变；`@koishijs/X` → `@koishi-ce/X`）。与 Koishijs 组织无隶属关系（见 `NOTICE`）。
- **上游同步**：按 [UPSTREAM.md](./UPSTREAM.md) 的映射表手动 diff 移植；`peerDependencies` 刻意指向上游已发布运行时（`koishi` / `@koishijs/*`），使本仓插件与上游生态保持兼容。

## 2. 目录结构与包清单

```
koishi/（Bun workspaces：packages/node/* · packages/shim/* · packages/web/* · plugins/{common,infra,webui}/* · apps/* · tooling/*）
├── packages/node/   Node 侧核心库（根 tsdown 统一构建 → lib/ ESM-only）
├── packages/shim/   上游包名占位 shim（纯 JS 预编译，不走 tsdown）
├── packages/web/    浏览器侧库（源码直出，无独立构建产物）
├── plugins/common/  通用 bot 插件（MIT）
├── plugins/infra/   基础设施插件（http/proxy-agent/server 为 vendored 预编译）
├── plugins/webui/   控制台插件 ×16（src/=Node 侧，client/=Vue 侧）
├── apps/            可部署应用（online / koishi-create / koishi-scripts）
└── tooling/         维护脚本 + 上游 yakumo 配置存档
```

### packages/node/*（运行时核心，全部走根 tsdown）

| 目录 | 包名 | 版本 | 说明 |
|---|---|---|---|
| `core` | `@koishi-ce/core` | 4.18.11 | 框架核心：Context / Command / Session / 数据库 / I18n；依赖 cordis ^3.18、minato ^3.7、@satorijs/core ^4.6 |
| `loader` | `@koishi-ce/loader` | 4.6.11 | 配置加载器（koishi.yml、插件名解析、热重载）；**用 `require()` 加载插件**；peerDeps 精确锁 `@koishijs/core 4.18.11` |
| `cli` | `@koishi-ce/koishi` | 4.18.11 | CLI 入口（bin：`koishi`），src 分 `cli/` 与 `worker/`；已迁移 Bun ESM 运行时（`Bun.spawn` + shebang `bun`），走根 tsdown 构建（cli/worker 多入口产物待恢复） |
| `console` | `@koishi-ce/console` | 5.30.11 | Console 服务 node 侧（协议 / 频道抽象），来自 webui；src 分 `node/` 与 `browser/` |
| `utils` | `@koishi-ce/utils` | 7.2.1 | 通用工具（cosmokit、inaba） |
| `i18n-utils` | `@koishi-ce/i18n-utils` | 1.0.1 | i18n 回退与工具 |
| `registry` | `@koishi-ce/registry` | 7.0.3 | npm 插件市场扫描库（来自 webui）：SearchResult / SearchObject 等类型 + Scanner / LocalScanner；被 config（LocalScanner）与 market（类型 + Scanner）消费 |

### packages/shim/*（上游包名占位 shim，全部纯 JS 预编译、不走 tsdown）

上游生态（官方 adapter / database、koishi-plugin-*）与本仓部分包的 peerDependencies 声明上游名（`koishi` / `@koishijs/plugin-console` / `@koishijs/core` / `@koishijs/loader`）。这些名字若无归属，Bun 的 peer 自动安装会拉下 npm 官方全家桶，与 `@koishi-ce/*` 形成双实例、破坏 cordis 对象身份。占位机制分两层：

| 目录 | 包名 | 版本冻结 | 形态 |
|---|---|---|---|
| `koishi` | `koishi`（裸名） | 4.18.11 | workspace 占位（private，根依赖 `workspace:*` 声明归属） |
| `upstream-core` | `@koishijs/core` | 4.18.11 | 同上（loader 的 peer 精确锁 4.18.11） |
| `upstream-loader` | `@koishijs/loader` | 4.6.11 | 同上 |
| `upstream-plugin-console` | `@koishijs/plugin-console` | 5.30.11 | 同上 |
| `koishi-shim` | `@koishi-ce/koishi-shim` | 4.18.11 | 可发布，下游 npm alias 目标；**一名兼任 koishi / @koishijs/core / @koishijs/loader 三个上游名**（`@koishi-ce/koishi` 是 core + loader 合并再导出，与上游 koishi 主包同构） |
| `console-shim` | `@koishi-ce/console-shim` | 5.30.11 | 可发布，`@koishijs/plugin-console` 名的 alias 目标 |

六包均在 changesets ignore（版本冻结、勿写 changeset）与根 tsdown exclude（通配 `packages/shim/*`）；三个 `upstream-*` 带 `"koishi-ce": { "upstreamShim": true }` 标记，registry 的 `LocalScanner` 据此跳过。下游项目的 alias 形态见 `apps/koishi-create/src/template.ts`（四行 alias、两个包）。

### packages/web/*（浏览器侧）

| 目录 | 包名 | 说明 |
|---|---|---|
| `client` | `@koishi-ce/client` | 控制台前端运行时 + **构建器**：`src/index.ts` 暴露编程式 `build(root)`（vite.build + collectWorkspaceAliases）；`src/bin.ts`（产物 `lib/bin.mjs`）暴露 `koishi-console` CLI；`scripts/client.ts` 是宿主前端总装脚本 |
| `components` | `@koishi-ce/components` | 前端共享组件库（`client/` 源码，`src/` 仅类型出口），**无独立构建**，仅作为客户端源码被 console 打包器消费 |
| ~~`market`~~ | — | **已删除**（commit 668401a） |

### plugins/common/*（通用插件，均 MIT，peerDeps `koishi ^4.18.11`）

`bind`（跨平台账户绑定，需 database）、`broadcast`（广播，需 database）、`callme`（昵称）、`echo`（回声，`koishi.browser: true`）、`help`（指令帮助，多语言 locale）、`inspect`（用户/频道/消息诊断）。均带 `koishi` 元数据（category / service.required / locales），locale 放 `src/locales/*.yml`。

### plugins/infra/*（基础设施）

| 目录 | 包名 | 说明 |
|---|---|---|
| `hmr` | `@koishi-ce/plugin-hmr` | 热重载；**esbuild 为运行时依赖**；peerDeps 上游 `@koishijs/loader` + `koishi` |
| `mock` | `@koishi-ce/plugin-mock` | 测试 mock（根 devDeps 引用，多数测试依赖它） |
| `http` | `@koishi-ce/plugin-http` | **vendored 预编译产物**（无 src，内联再导出 `@cordisjs/plugin-http`） |
| `proxy-agent` | `@koishi-ce/plugin-proxy-agent` | 同上（`@cordisjs/plugin-proxy-agent`） |
| `server` | `@koishi-ce/plugin-server` | 同上（`@cordisjs/plugin-server ^0.2.9`）；Phase 5 原计划从 1.x 重建，随 cordis 4 回退一并冻结 |

### plugins/webui/*（16 个控制台插件，除 console 外均 AGPL-3.0）

node 侧在 `src/`、Vue 侧在 `client/`（上游约定），`koishi.public: ["dist"]` 声明前端产物目录，几乎都 peerDeps 上游 `@koishijs/plugin-console ^5.30.11` + `koishi ^4.18.11`，依赖 workspace 的 `@koishi-ce/console`：

`actions`（应用指令面板）、`admin`（权限管理）、`analytics`（统计图表，echarts）、`auth`（登录）、`commands`（指令配置）、`config`（插件配置管理，唯一带 `./shared` 与 node/browser 分入口，依赖 `@koishi-ce/registry`）、`console`（**宿主**，MIT，src 分 `node/` + `browser/`）、`explorer`（文件管理，monaco）、`insight`（依赖图，d3-force）、`locales`（翻译覆盖）、`logger`（日志）、`notifier`（通知服务）、`oobe`（开箱体验）、`sandbox`（虚拟沙箱）、`status`（运行状态）。

**特殊：`market`**（`@koishi-ce/plugin-marketn` v3.0.0）——磁盘存在但被 `.gitignore` 临时忽略（从 `koishi-plugin-marketn` 迁入对齐期间；完成后移除忽略行纳入版本控制）。它自带 vitest 测试（`*.test.ts`）与 4 空格缩进风格，与主仓约定不同；`typecheck` 会卷入其 tsconfig（数百存量错误），bun test 的发现规则也包含 `*.test.ts`——裸 `bun test` 会因其挂起（见 [DEVELOPMENT.md](./DEVELOPMENT.md) §3）。

### apps/*

| 目录 | 包名 | 构建 | 说明 |
|---|---|---|---|
| `online` | `@koishi-ce/online` | `src/build.ts`（vite 编程式） | koishi.online 网站 + Online Loader（AGPL；`vercel.json` 部署；内置模块改写为 registry.koishi.chat 在线加载） |
| `koishi-create` | `create-koishi-ce`（无 scope） | 自己的 tsdown.config.ts | 脚手架 CLI（prompts + tar 7）。⚠️ 目录名与旧引用 `apps/create-koishi-ce` 不一致，以 `apps/koishi-create` 为准 |
| `koishi-scripts` | `@koishi-ce/scripts` | 根 tsdown（包级配置补 bin 入口） | 插件开发 CLI（`koishi-scripts`，Bun-only ESM，v5 起内嵌 TS7+tsdown+biome+Changesets 脚手架模板与 version/build/publish 发布链） |

### tooling/

- `upstream-yakumo-config.json`：删除 yakumo 前从各包抽取的构建配置存档（记录了 client 构建脚本位置：`@koishi-ce/client → ./scripts/client.ts`、analytics / explorer `→ ./build/client.ts`、online `→ ./src/build.ts`）。
- `scripts/`：仓库维护脚本；`release/`：changesets 发布流程（changeset / release 入口在根 package.json）。

### 预留位

- `apps/koishi-plugin-adapter/`（.gitignore 提到，当前不存在）：适配器 submodule 独立仓库位，主仓 biome / tsc 均跳过。
- `external/`、`archive/`：gitignored 的本地参考 / 归档区。

## 3. 依赖纪律

### 两个依赖世界（详见 [dependency-audit.md](./dependency-audit.md)）

1. **cordis 生态运行时（冻结线）**：cordis ^3.18 / minato ^3.7 / @cordisjs/* / @satorijs/* / @koishijs 上游 peer——整体冻结在上游 koishi 4.18 配套线。
   - **Phase 5 实证结论（2026-08-27）**：cordis 4 跳代被 `@satorijs/core@4.6.0`（内部携带 cordis ^3.18.1，无 cordis 4 线）阻塞——同进程双 DI 容器并存，服务注入互相不可见，14/20 测试失败，已整体回退。重启条件（满足其一）：`@satorijs/core` 发 cordis 4 版本 / 上游官方迁移 / 自建 fork，详见 [upgrade-plan.md](./upgrade-plan.md) Phase 5 节。
2. **独立工具链（现代线）**：构建 / 前端 / CLI / 测试已一步到位（vite 8、TS 7、tsdown、biome 2.5、bun test、chai 6），Phase 0-4 已完成。

### 硬性规则

- `peerDependencies` 保留上游名（生态兼容，刻意的）；代码内导入一律 `@koishi-ce/*`，外部上游导入仅 `@koishijs/plugin-database-memory`（测试）与 `@koishijs/plugin-server-proxy`（类型）两处例外。
- vendored 三包（http / proxy-agent / server）不动。
- 依赖方向：`plugins/webui/* → @koishi-ce/console → @koishi-ce/core`；`plugins/common/* → @koishi-ce/core`；`packages/web/*`（浏览器侧）不依赖 node 侧运行时。

## 4. 构建体系

### node 侧：根 tsdown 统一构建

根 `tsdown.config.ts` 用 workspace 模式一次构建所有 node 侧包：

- `workspace.include`：`packages/node/*`、`apps/koishi-scripts`、`plugins/common/*`、`plugins/infra/*`、`plugins/webui/*`；`exclude`：vendored 三包、`packages/web/components`、`packages/shim/*`（占位 shim 全部纯 JS 预编译）。
- **单遍 ESM-only 构建**：`index.mjs` + `index.d.ts`。本仓库运行时目标是 Bun，其 `require()` 可直接加载 ESM，各包 exports 以 `default` 条件兜底，CJS 双格式产物已退役（各包 package.json 逐个收敛 ESM-only，core / cli / `@koishi-ce/scripts` 已完成）。
- `deps.neverBundle: [/^@koishi-ce\//]`：workspace 内互相引用按包名外部化（运行时由 node_modules workspace 链接提供）；dts 不内联外部类型。
- `loader: { ".yml": "copy" }`：locale yml 原样拷入产物，引用路径自动改写。
- 独立 tsdown 配置：`apps/koishi-create`（npx 直执行 CLI，暂为 CJS 单格式）；`apps/koishi-scripts` 走根构建、包级配置仅补 bin 入口（ESM-only）；`packages/node/cli` 已删除包级配置、走根构建（其 cli/worker 多入口产物待恢复）。

### 前端：vite 编程式构建（无配置文件）

- **宿主控制台总装**：`packages/web/client/scripts/client.ts` —— 依次构建 app（unocss preset-mini）、拷贝 vue runtime、构建 vue-router / @vueuse 外部块、client（element-plus 单独 manualChunks），产物统一输出 `plugins/webui/console/dist`，并把 vue / vue-router / @vueuse / @koishi-ce/client 指向外部块文件（宿主只装一份）。
- **单插件前端**：`packages/web/client/src/index.ts` 的 `build(root)`（CLI：`bun packages/web/client/src/bin.ts build <插件目录>`）。内置 `collectWorkspaceAliases()` 扫描根 workspaces glob，把每个 workspace 包名映射到其 `client/index.ts` 或 `src/`——**未被依赖的插件不会出现在 node_modules 链接里**，必须显式映射才能被 bundler 解析。
- 插件自带构建脚本：`plugins/webui/analytics/build/client.ts`（fuck-echarts：echarts chunk 内 `Symbol` 重命名）、`plugins/webui/explorer/build/client.ts`（monaco manualChunks）；网站：`apps/online/src/build.ts`。
- `packages/web/components` 无构建（源码直出，被 console 打包器消费）。

### 类型检查体系

- `tsconfig.base.json` 的 paths 把 35 个 `@koishi-ce/*` 指向各自 `src/`（无 project references）；`tsconfig.client.json` 为 Vue 客户端基座（DOM lib、types 空）。
- 实际检查 = 两条纯 `bunx tsc` 串行（TS7 native）：node 侧大一统 `tsconfig.json`（include 为原 31 个 node 工程的并集）+ client 侧大一统 `tsconfig.web.json`（include 为 16 个 client 工程并集，paths 为各工程 paths 覆盖的合并，exclude 挡住 `schemastery-vue-runtime.ts`——其引入的第三方源码不满足超严格配置）。旧「逐 tsconfig 并行 50 进程」方案因 win32 下 Bun.spawn 竞态且无必要而废弃。
- 各 `client/tsconfig.json` 形如 `{"extends": "../../../../tsconfig.client", "include": ["."]}`；新增 client 工程时须同步 `tsconfig.web.json` 的 include/paths。

## 5. 测试体系

- 运行器 `bun test`（Phase 4 从 mocha 迁移完成）；断言**新标准为 `bun:test` 的 `expect`**（core 与 echo 已迁移）；存量 chai ^6 用例（loader / utils / i18n-utils / broadcast / help / admin / commands）逐步迁移，不新增。shape 断言用 `packages/node/core/tests/shape.ts` 注册的 `toHaveShape` matcher（原 `scripts/testing/chai-shape.ts` 已随 scripts 目录删除）。
- 20 个 `*.test.ts`：core（8：command / database / filter / middleware / parser / runtime / session / suggest）、loader（1）、utils（3）、i18n-utils（1）、common 插件（5）、webui admin / commands（2）。
- 数据库用例用 `@koishijs/plugin-database-memory`；时间模拟用 `bun:test` 的 mock timers（`jest.useFakeTimers()` 等）。

## 6. 许可证分区（权威：`NOTICE`）

| 区域 | 许可证 |
|---|---|
| `packages/node/{core,loader,utils,i18n-utils,cli}`、`plugins/infra/{http,server,proxy-agent}`、`plugins/common/*`、`packages/shim/*`（占位 shim 均为本仓原创代码） | MIT |
| `packages/web/{client,components}`、`plugins/webui/*`（除 console）、`apps/online` | **AGPL-3.0** |
| `packages/node/console`、`packages/node/registry` | MIT（上游各包 package.json 声明） |

在 AGPL 目录新增文件同样受 AGPL 约束；分发组合作品或提供网络服务会触发 AGPL 义务（含源码披露）。原版权归属 Shigma 与 Koishijs 贡献者（2019-present）。
