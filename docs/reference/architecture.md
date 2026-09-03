# 仓库架构（ARCHITECTURE）

> `koishi`（Koishi-CE）的**仓库结构文档**：目录与包清单、依赖纪律、构建 / 类型检查 / 测试体系、许可证分区。以实际代码为准，文档滞后时听代码的。包版本不在此罗列（统一 1.0.0 基线、随发布漂移，以各包 package.json 为准）。
> **先读**：开发环境与命令见 [../guides/development.md](../guides/development.md)；上游目录映射见 [../process/upstream.md](../process/upstream.md)；发布见 [../process/release.md](../process/release.md)。
> **本文结构**：1 定位 · 2 目录与包清单 · 3 依赖纪律 · 4 构建体系 · 5 测试体系 · 6 许可证分区。

## 1. 定位

- **是什么**：[Koishi](https://koishi.chat) 聊天机器人框架的 **Bun-first 社区再分发**（community redistribution）。由 [koishijs/koishi](https://github.com/koishijs/koishi)（MIT）与 [koishijs/webui](https://github.com/koishijs/webui)（部分 AGPL-3.0）两个上游仓库**文件级合并**（无上游 git 历史）重构为单一 Bun workspace monorepo，另再分发若干独立上游插件。
- **发布身份**：GitHub 组织 [Koishi-CE](https://github.com/Koishi-CE)，npm 作用域 `@koishi-ce`（`koishi` → `@koishi-ce/koishi`，命令名不变；`@koishijs/X` → `@koishi-ce/X`）。与 Koishijs 组织无隶属关系（见 `NOTICE`）。
- **上游同步**：按 [../process/upstream.md](../process/upstream.md) 的映射表手动 diff 移植。

## 2. 目录结构与包清单

共 46 个 workspace 包，全部 `"type": "module"`。

```
koishi/（Bun workspaces：packages/node/* · packages/shim/* · packages/web/* · plugins/{common,infra,webui}/* · apps/* · tooling/*）
├── packages/node/   Node 侧核心库（8 包，根 tsdown 统一构建 → lib/ ESM-only）
├── packages/shim/   上游包名占位 shim（2 包，纯 JS 预编译，不走 tsdown）
├── packages/web/    浏览器侧库（client / components，源码直出，无独立构建产物）
├── plugins/common/  通用 bot 插件 ×8（MIT）
├── plugins/infra/   基础设施插件 ×6（http/proxy/server 为 vendored 预编译）
├── plugins/webui/   控制台插件 ×18（src/=Node 侧，client/=Vue 侧）
├── apps/            可部署应用（koishi-create / koishi-scripts）
└── tooling/         发布链脚本（release/）
```

### packages/node/*（运行时核心，全部走根 tsdown）

| 目录 | 包名 | 来源 | 说明 |
|---|---|---|---|
| `core` | `@koishi-ce/core` | koishi `packages/core` | 框架核心：Context / Command / Session / 数据库 / I18n；依赖 cordis ^3.18、minato ^3.7、@satorijs/core ^4.6 |
| `loader` | `@koishi-ce/loader` | koishi `packages/loader` | 配置加载器（koishi.yml、插件名解析、热重载）；**用 `require()` 加载插件**（Bun require(esm)） |
| `cli` | `@koishi-ce/koishi` | koishi `packages/koishi` | CLI 入口（bin：`koishi`），src 分 `cli/` 与 `worker/`；Bun ESM 运行时（`Bun.spawn` + shebang `bun`） |
| `console` | `@koishi-ce/console` | webui `packages/console`（MIT） | Console 服务 node 侧（协议 / 频道抽象）；src 分 `node/` 与 `browser/` |
| `utils` | `@koishi-ce/utils` | koishi `packages/utils` | 通用工具（cosmokit、inaba） |
| `i18n-utils` | `@koishi-ce/i18n-utils` | koishi `packages/i18n-utils` | i18n 回退与工具 |
| `registry` | `@koishi-ce/registry` | webui `packages/registry`（MIT） | npm 插件市场扫描库：SearchResult / SearchObject 等类型 + Scanner / LocalScanner；被 config 与 market 消费 |
| `assets` | `@koishi-ce/assets` | [koishijs/assets](https://github.com/koishijs/assets) `packages/core` | 资源解析器服务（配合 assets-local 插件） |

### packages/shim/*（占位 shim，纯 JS 预编译、不走 tsdown、版本冻结、changesets ignore）

CE 包 peer 一律指 CE 名，但外部真包依赖（测试用的 `@koishijs/plugin-database-memory`、analytics 的 `@koishijs/assets`、console 类型引用的 `@koishijs/plugin-server-proxy`）与**下游项目的社区插件生态**仍消费上游名。shim 以 npm alias 的形式占用上游包名、把解析指回本仓对应包，阻止包管理器自动安装 npm 官方全家桶形成双实例。详见 `packages/shim/README.md`。

| 目录 | 包名 | 版本冻结 | 形态 |
|---|---|---|---|
| `koishi-shim` | `@koishi-ce/koishi-shim` | 4.18.11 | 可发布；下游 alias 目标，一名兼任 `koishi` / `@koishijs/core` / `@koishijs/loader` 三个上游名（`@koishi-ce/koishi` 是 core + loader 合并再导出，与上游 koishi 主包同构） |
| `console-shim` | `@koishi-ce/console-shim` | 5.30.11 | 可发布；`@koishijs/plugin-console` 名的下游 alias 目标 |

下游项目以四行 npm alias 钉名（两包）：`"koishi": "npm:@koishi-ce/koishi-shim@^4.18.11"`、`"@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11"`（精确锁，逐字相等）、`"@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11"`、`"@koishijs/plugin-console": "npm:@koishi-ce/console-shim@^5.30.11"`——`create-koishi-ce` 模板已预置。Bun 对 npm alias 的 peer 判定看**落盘包的 version**，故 shim 版本冻结跟随上游线、不随本仓 1.0.0 基线；market 安装器的 `isGuardedRequest()` 把 `npm:@koishi-ce` 前缀与 `workspace:` 同等保护。

### packages/web/*（浏览器侧）

| 目录 | 包名 | 说明 |
|---|---|---|
| `client` | `@koishi-ce/client` | 控制台前端运行时 + **构建器**：`src/index.ts` 暴露编程式 `build(root)`（vite.build + collectWorkspaceAliases）；`src/bin.ts` 暴露 `koishi-console` CLI；`scripts/client.ts` 是宿主前端总装脚本 |
| `components` | `@koishi-ce/components` | 前端共享组件库（`client/` 源码），**无独立构建**，仅作为客户端源码被 console 打包器消费 |

### plugins/common/*（通用插件 ×8，均 MIT）

`bind`（跨平台账户绑定，需 database）、`broadcast`（广播，需 database）、`callme`（昵称）、`echo`（回声，`koishi.browser: true`）、`help`（指令帮助，多语言 locale）、`inspect`（用户/频道/消息诊断）来自上游 koishi `plugins/common/*`；`assets-local`（本地资源落盘，来自 [koishijs/assets](https://github.com/koishijs/assets) `packages/local`）与 `rate-limit`（指令限流，来自 [koishijs/common](https://github.com/koishijs/common) `packages/rate-limit`）为后续再分发。均带 `koishi` 元数据，locale 放 `src/locales/*.yml`。

### plugins/infra/*（基础设施 ×6）

| 目录 | 包名 | 说明 |
|---|---|---|
| `hmr` | `@koishi-ce/plugin-hmr` | 热重载；**esbuild 为运行时依赖** |
| `mock` | `@koishi-ce/plugin-mock` | 测试 mock（多数测试依赖它） |
| `http` | `@koishi-ce/plugin-http` | **vendored 预编译产物**（无 src，内联再导出 `@cordisjs/plugin-http`） |
| `proxy` | `@koishi-ce/plugin-proxy-agent` | 同上（`@cordisjs/plugin-proxy-agent`；目录 `proxy` 系上游 `proxy-agent` 的本地改名） |
| `server` | `@koishi-ce/plugin-server` | 同上（`@cordisjs/plugin-server ^0.2.9`）；Phase 5 原计划从 1.x 重建，随 cordis 4 回退一并冻结 |
| `server-temp` | `@koishi-ce/plugin-server-temp` | 临时文件服务（来自 [cordiverse/server](https://github.com/cordiverse/server) `packages/temp`） |

### plugins/webui/*（控制台插件 ×18，均 AGPL-3.0）

node 侧在 `src/`、Vue 侧在 `client/`（上游约定），`koishi.public: ["dist"]` 声明前端产物目录：

`actions`（应用指令面板）、`admin`（权限管理）、`analytics`（统计图表，echarts）、`auth`（登录）、`commands`（指令配置）、`config`（插件配置管理，唯一带 `./shared` 与 node/browser 分入口，依赖 `@koishi-ce/registry`）、`console`（**宿主**，其 `dist/` 承载全部插件前端产物）、`explorer`（文件管理，monaco）、`insight`（依赖图，d3-force）、`locales`（翻译覆盖）、`logger`（日志）、`notifier`（通知服务）、`oobe`（开箱体验）、`sandbox`（虚拟沙箱）、`status`（运行状态）——以上 15 个来自 webui `plugins/*`；**`market`**（插件市场，来自 webui `plugins/market` 原版 v2.11.11 的再分发，社区版 `plugin-marketn` 已被其取代并移除；client 侧依赖 npm 包 `@koishijs/market`，其内部 npm 名 `@koishijs/components` 由单插件构建 alias 重定向到本仓 workspace 版避免双实例）；`dataview` 与 `theme-vanilla` 来自独立上游仓库（见 `NOTICE`）。

### apps/*

| 目录 | 包名 | 构建 | 说明 |
|---|---|---|---|
| `koishi-create` | `create-koishi-ce`（无 scope） | 自己的 tsdown.config.ts | 脚手架 CLI；默认内置纯 `@koishi-ce` 模板（`src/template/` 目录外置，Bun 运行时 + 上游名 alias 钉 shim），`--template <包名>` 保留远程模板逃生舱 |
| `koishi-scripts` | `@koishi-ce/scripts` | 根 tsdown（包级配置补 bin 入口） | 插件开发 CLI（面向宿主工作区 external/* 插件项目），内嵌 TS7 + tsdown + biome + Changesets 脚手架模板与 version/build/publish 发布链 |

### tooling/ 与预留位

- `tooling/release/`：本仓发布链（`bun run release`，见 [../process/release.md](../process/release.md)）。与 koishi-scripts 的 release 链（面向宿主工作区插件项目）互不相干。
- 预留位（.gitignore 提到，当前均不存在）：`apps/koishi-plugin-adapter/`（适配器独立仓库位）、`external/`、`archive/`（本地参考 / 归档区）。

## 3. 依赖纪律

### 两个依赖世界（背景见 [../decisions/dependency-audit.md](../decisions/dependency-audit.md)）

1. **cordis 生态运行时（冻结线）**：cordis ^3.18 / minato ^3.7 / @cordisjs/* / @satorijs/*——整体冻结在上游 koishi 4.18 配套线。Phase 5 跳代实证被 `@satorijs/core@4.6.0`（内部携带 cordis ^3，无 cordis 4 线）阻塞并整体回退，重启条件见 [../decisions/upgrade-plan.md](../decisions/upgrade-plan.md) Phase 5 节。
2. **独立工具链（现代线）**：构建 / 前端 / CLI / 测试已一步到位（vite 8、TS 7、tsdown、biome 2.5、bun test）。

### 硬性规则

- `peerDependencies` **一律指向 CE 包名**（`@koishi-ce/* ^1.0.0`），不要写回上游名；代码内导入同样一律 `@koishi-ce/*`（例外仅 `@koishijs/plugin-database-memory` 与 `@koishijs/plugin-server-proxy` 两处外部包）。
- vendored 三包（http / proxy / server）不动。
- 依赖方向：`plugins/webui/* → @koishi-ce/console → @koishi-ce/core`；`plugins/common/* → @koishi-ce/core`；`packages/web/*`（浏览器侧）不依赖 node 侧运行时。

## 4. 构建体系

### node 侧：根 tsdown 统一构建

根 `tsdown.config.ts` 用 workspace 模式一次构建所有 node 侧包：

- `workspace.include`：`packages/node/*`、`packages/web/*`、`apps/{koishi-create,koishi-scripts}`、`plugins/{common,infra,webui}/*`；`exclude`：vendored 三包、`packages/web/components`（仅作客户端源码）、`packages/shim/*`（纯 JS 预编译）。
- **单遍 ESM-only 构建**：`index.mjs` + `index.d.ts`，各包 exports 以 `default` 条件兜底；`deps.neverBundle: [/^@koishi-ce\//]` 把 workspace 互引按包名外部化；`loader: { ".yml": "copy" }` 把 locale yml 原样拷入产物并改写引用路径。
- 独立 tsdown 配置：`apps/koishi-create`。

### 前端：vite 编程式构建（无配置文件）

- **宿主控制台总装**：`packages/web/client/scripts/client.ts`——依次构建 app（unocss preset-mini）、拷贝 vue runtime、构建 vue-router / @vueuse 外部块、client（element-plus 单独 manualChunks），产物统一输出 `plugins/webui/console/dist`，并把 vue / vue-router / @vueuse / @koishi-ce/client 指向外部块文件（宿主只装一份）。
- **单插件前端**：`packages/web/client/src/index.ts` 的 `build(root)`（CLI：`bun packages/web/client/src/bin.ts build <插件目录>`）。内置 `collectWorkspaceAliases()` 扫描根 workspaces glob 做显式映射——未被依赖的插件不在 node_modules 链接里，bundler 无法自行解析。
- 插件自带构建脚本：`plugins/webui/analytics/build/client.ts`（fuck-echarts）、`plugins/webui/explorer/build/client.ts`（monaco manualChunks）。
- `packages/web/components` 无构建（源码直出，被 console 打包器消费）。

### 类型检查体系

- 实际检查 = 两条纯 `bunx tsc` 串行（TS7 native）：node 侧大一统 `tsconfig.json` + client 侧大一统 `tsconfig.web.json`（paths 为各工程 paths 的合并，exclude 挡住 `schemastery-vue-runtime.ts`——第三方源码不进类型程序）。`tsconfig.base.json` 的 paths 把全部 `@koishi-ce/*` 指向各自 src 的**具体 .ts 文件**（nodenext 下指目录会回退解析 lib 产物 d.ts，与 src 形成双模块视图）。
- 各 `client/tsconfig.json` 形如 `{"extends": "...tsconfig.client", "include": ["."]}`；新增 client 工程时须同步 `tsconfig.web.json` 的 include/paths。

## 5. 测试体系

- 运行器 `bun test`（裸跑即全量：97 个测试文件 / 约 800 用例，覆盖全部 node 侧包）；断言标准为 `bun:test` 的 `expect`，存量 chai 用例逐步迁移；shape 断言用 `packages/node/core/tests/shape.ts` 注册的 `toHaveShape`。写法与坑见 [../guides/development.md](../guides/development.md) §6。

## 6. 许可证分区（权威：`NOTICE`）

| 区域 | 许可证 |
|---|---|
| `packages/node/{core,loader,utils,i18n-utils,cli,assets}`、`plugins/infra/*`、`plugins/common/*`、`packages/shim/*`、`apps/*` | MIT |
| `packages/web/{client,components}`、`plugins/webui/*` 全部（含 console 宿主插件） | **AGPL-3.0** |
| `packages/node/{console,registry}` | MIT（上游各包 package.json 声明） |

在 AGPL 目录新增文件同样受 AGPL 约束；分发组合作品或提供网络服务会触发 AGPL 义务（含源码披露）。原版权归属 Shigma 与 Koishijs 贡献者（2019-present）。
