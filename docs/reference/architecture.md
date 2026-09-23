# 仓库架构（ARCHITECTURE）

> `koishi`（Koishi-CE）的**仓库结构文档**：目录与包清单、依赖纪律、构建 / 类型检查 / 测试体系、许可证分区。以实际代码为准，文档滞后时听代码的。包版本不在此罗列（1.0.0 起步基线、changesets 递进、随发布漂移，以各包 package.json 为准）。
> **先读**：开发环境与命令见 [../guides/development.md](../guides/development.md)；上游目录映射见 [../process/upstream.md](../process/upstream.md)；发布见 [../process/release.md](../process/release.md)。
> **本文结构**：1 定位 · 2 目录与包清单 · 3 依赖纪律 · 4 构建体系 · 5 测试体系 · 6 许可证分区。

## 1. 定位

- **是什么**：[Koishi](https://koishi.chat) 聊天机器人框架的 **Bun-first 社区再分发**（community redistribution）。由 [koishijs/koishi](https://github.com/koishijs/koishi)（MIT）与 [koishijs/webui](https://github.com/koishijs/webui)（部分 AGPL-3.0）两个上游仓库**文件级合并**（无上游 git 历史）重构为单一 Bun workspace monorepo，另再分发若干独立上游插件。
- **发布身份**：GitHub 组织 [Koishi-CE](https://github.com/Koishi-CE)，npm 作用域 `@koishi-ce`（`koishi` → `@koishi-ce/koishi`，命令名不变；`@koishijs/X` → `@koishi-ce/X`）。与 Koishijs 组织无隶属关系（见 `NOTICE`）。
- **上游同步**：按 [../process/upstream.md](../process/upstream.md) 的映射表手动 diff 移植。

## 2. 目录结构与包清单

共 53 个 workspace 包（node ×8 · shim ×4 · web ×3 · common ×9 · infra ×8 · webui ×19 · apps ×2），全部 `"type": "module"`。

```
koishi/（Bun workspaces：packages/node/* · packages/shim/* · packages/web/* · plugins/{common,infra,webui}/* · apps/*）
├── packages/node/   Node 侧核心库（8 包，根 tsdown 统一构建 → lib/ ESM-only）
├── packages/shim/   上游包名占位 shim（4 包，纯 JS 预编译，不走 tsdown）
├── packages/web/    控制台前端（app 为宿主 SPA 源码，client / components 为浏览器库源码直出；builder 为 node 侧构建器）
├── plugins/common/  通用 bot 插件 ×9（MIT）
├── plugins/infra/   基础设施插件 ×8（http/proxy/server 为 vendored 预编译）
├── plugins/webui/   控制台插件 ×19（src/=Node 侧，client/=Vue 侧）
├── apps/            可部署应用（koishi-create / koishi-scripts）
└── tooling/         工程工具集（门禁检查 / 发布链 / 沙盒生成 / 上游巡检，见 tooling/README.md）
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

CE 包 peer 一律指 CE 名，但**下游项目的社区插件生态**仍消费上游名（本仓自身的上游名外部依赖现仅剩宿主 console 插件的类型引用 `@koishijs/plugin-server-proxy`——测试用的 memory 驱动已 CE 化为 `@koishi-ce/plugin-database-memory`（`plugins/infra/memory`），analytics 曾用的 `@koishijs/assets` 已随依赖清理消失）。shim 以 npm alias 的形式占用上游包名、把解析指回本仓对应包，阻止包管理器自动安装 npm 官方全家桶形成双实例。详见 `packages/shim/README.md`。

| 目录 | 包名 | 版本冻结 | 形态 |
|---|---|---|---|
| `koishi-shim` | `@koishi-ce/koishi-shim` | 4.18.11 | 可发布；下游 alias 目标，一名兼任 `koishi` / `@koishijs/core` / `@koishijs/loader` 三个上游名（`@koishi-ce/koishi` 是 core + loader 合并再导出，与上游 koishi 主包同构） |
| `console-shim` | `@koishi-ce/console-shim` | 5.30.11 | 可发布；`@koishijs/plugin-console` 名的下游 alias 目标 |
| `client-shim` | `@koishi-ce/client-shim` | 5.30.11 | 可发布；`@koishijs/client` 名的下游 alias 目标（第三方 webui 插件常将其写进 dependencies） |
| `components-shim` | `@koishi-ce/components-shim` | 1.5.22 | 可发布；`@koishijs/components` 名的下游 alias 目标 |

下游项目以六行 npm alias 钉名（四包）：`"koishi": "npm:@koishi-ce/koishi-shim@^4.18.11"`、`"@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11"`（精确锁，逐字相等）、`"@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11"`、`"@koishijs/plugin-console": "npm:@koishi-ce/console-shim@^5.30.11"`、`"@koishijs/client": "npm:@koishi-ce/client-shim@^5.30.11"`、`"@koishijs/components": "npm:@koishi-ce/components-shim@^1.5.22"`——`create-koishi-ce` 模板已预置。Bun 对 npm alias 的满足性判定看**落盘包的 version**（对 peer 与普通依赖边同理），故 shim 版本冻结跟随上游线、不随本仓 1.0.0 基线；market 安装器的 `isGuardedRequest()` 把 `npm:@koishi-ce` 前缀与 `workspace:` 同等保护。钉名之外，模板与 sandbox 生成器另预置 41 名 `overrides` 强制重写兜底（不看版本满足性，拦钉名清单外的上游声明，语义见 `packages/shim/README.md`「三层防线」）。

### packages/web/*（控制台前端）

| 目录 | 包名 | 说明 |
|---|---|---|
| `app` | `@koishi-ce/console-app` | 控制台**宿主 SPA 源码**（`src/` 即 vite root：`index.html` + `index.ts`，依次注册首页 / 布局 / 设置 / 状态栏 / 样式 / 主题）。**无独立构建产物**，由宿主总装（构建期）与 devMode（运行期）以它为 vite root 消费，故必须可发布 |
| `client` | `@koishi-ce/client` | 控制台**浏览器运行时库**：根 Context、六个核心服务、内置组件与词典。**无独立构建产物**，`src/` 源码由 console 打包器消费 |
| `components` | `@koishi-ce/components` | 前端共享组件库（`src/` 源码），**无独立构建**，仅作为客户端源码被 console 打包器消费 |
| `builder` | `@koishi-ce/console-builder` | **node 侧构建器**（走根 tsdown）：`src/index.ts` 暴露编程式 `build(root)`（vite.build + collectWorkspaceAliases）与 `createServer(baseDir)`；`src/bin.ts` 暴露 `koishi-console` CLI；`src/assemble.ts` 是宿主前端总装（CLI 无参分支） |

### plugins/common/*（通用插件 ×9，均 MIT）

`bind`（跨平台账户绑定，需 database）、`broadcast`（广播，需 database）、`callme`（昵称）、`echo`（回声，`koishi.browser: true`）、`help`（指令帮助，多语言 locale）、`inspect`（用户/频道/消息诊断）来自上游 koishi `plugins/common/*`；`assets-local`（本地资源落盘，来自 [koishijs/assets](https://github.com/koishijs/assets) `packages/local`）、`rate-limit`（指令限流，来自 [koishijs/common](https://github.com/koishijs/common) `packages/rate-limit`）与 `cron`（定时任务，以 `Bun.cron` 原生调度重写、非直接移植，来自 [koishijs/koishi-plugin-cron](https://github.com/koishijs/koishi-plugin-cron)）为后续再分发。均带 `koishi` 元数据，locale 放 `src/locales/*.yml`。

### plugins/infra/*（基础设施 ×8）

| 目录 | 包名 | 说明 |
|---|---|---|
| `hmr` | `@koishi-ce/plugin-hmr` | 热重载（TS 编译走 Bun 原生，文件监听 @parcel/watcher 原生绑定；错误帧 @babel/code-frame） |
| `memory` | `@koishi-ce/plugin-database-memory` | 内存数据库驱动（两源合并：minato `@minatojs/driver-memory` 3.7.0 + koishi 包装层；纯内存无持久化，测试替身与 SQLite 对拍基准） |
| `mock` | `@koishi-ce/plugin-mock` | 测试 mock（多数测试依赖它） |
| `sqlite` | `@koishi-ce/plugin-database-sqlite` | SQLite 数据库驱动（三源合并：cordis 3 线 `@minatojs/driver-sqlite` 4.7.0 骨架 + cordis 4 线 5.1.1 的 `node:sqlite` 引擎层；依赖官方 npm 的 `minato ^3.7` / `@minatojs/sql-utils ^5.6`） |
| `http` | `@koishi-ce/plugin-http` | **vendored 预编译产物**（无 src，内联再导出 `@cordisjs/plugin-http`） |
| `proxy` | `@koishi-ce/plugin-proxy-agent` | 同上（`@cordisjs/plugin-proxy-agent`；目录 `proxy` 系上游 `proxy-agent` 的本地改名） |
| `server` | `@koishi-ce/plugin-server` | 同上（`@cordisjs/plugin-server ^0.2.9`）；Phase 5 原计划从 1.x 重建，随 cordis 4 回退一并冻结 |
| `server-temp` | `@koishi-ce/plugin-server-temp` | 临时文件服务（来自 [cordiverse/server](https://github.com/cordiverse/server) `packages/temp`） |

### plugins/webui/*（控制台插件 ×19，均 AGPL-3.0）

node 侧在 `src/`、Vue 侧在 `client/`（上游约定），`koishi.public: ["dist"]` 声明前端产物目录：

`actions`（应用指令面板）、`admin`（权限管理）、`analytics`（统计图表，echarts）、`auth`（登录）、`commands`（指令配置）、`config`（插件配置管理，唯一带 `./shared` 与 node/browser 分入口，依赖 `@koishi-ce/registry`）、`console`（**宿主**，其 `dist/` 承载全部插件前端产物）、`explorer`（文件管理，CodeMirror 6）、`insight`（依赖图，d3-force）、`locales`（翻译覆盖）、`logger`（日志）、`notifier`（通知服务）、`oobe`（开箱体验）、`sandbox`（虚拟沙箱）、`status`（运行状态）——以上 15 个来自 webui `plugins/*`；**`market`**（插件市场，来自 webui `plugins/market` 原版 v2.11.11 的再分发，社区版 `plugin-marketn` 已被其取代并移除；client 逻辑层与图标自 `@koishijs/market` 4.2.10 vendor 进 `client/vendor/market/`，对 npm 包的依赖已解除；npm 名 `@koishijs/components` 由单插件构建 alias 重定向到本仓 workspace 版，作下游防御——本仓源码已不引用该 npm 名）；`dataview` 与 `theme-vanilla` 来自独立上游仓库（见 `NOTICE`）；**`welcome`**（欢迎页，本仓原创独立插件——上游 client 内建欢迎卡迁出，宿主首页仅保留 home 插槽，含 Lottie 开屏描线动画，移植自 Il Harper 的 MIT 插件 koishi-plugin-telemetry（数据与加载接线，文件保持 MIT），见 `NOTICE`）。

### apps/*

| 目录 | 包名 | 构建 | 说明 |
|---|---|---|---|
| `koishi-create` | `create-koishi-ce`（无 scope） | 根 tsdown（包级配置补 bin 入口） | 脚手架 CLI；默认内置纯 `@koishi-ce` 模板（`src/template/` 目录外置，Bun 运行时 + 上游名 alias 钉 shim），`--template <包名>` 保留远程模板逃生舱 |
| `koishi-scripts` | `@koishi-ce/scripts` | 根 tsdown（包级配置补 bin 入口） | 插件开发 CLI（面向宿主工作区 external/* 插件项目），内嵌 TS7 + tsdown + biome + Changesets 脚手架模板与 version/build/publish 发布链 |

### tooling/ 与预留位

- `tooling/`：本仓工程工具集（零第三方依赖 TS 脚本，bun 直跑，不进发布范围）：`checks/`（门禁检查脚本，并入 `bun run check`）、`release/`（发布链 `bun run release`，见 [../process/release.md](../process/release.md)，与 koishi-scripts 的 release 链互不相干）、`sandbox/`（外部沙盒实例生成器 `bun run sandbox`）、`upstream-audit/`（上游巡检 `bun run upstream:audit`）。索引与用法见 `tooling/README.md`。
- 预留位（.gitignore 提到，当前均不存在）：`apps/koishi-plugin-adapter/`（适配器独立仓库位）、`external/`、`archive/`（本地参考 / 归档区）。

## 3. 依赖纪律

### 两个依赖世界（背景见 [../decisions/dependency-audit.md](../decisions/dependency-audit.md)）

1. **cordis 生态运行时（冻结线）**：cordis ^3.18 / minato ^3.7 / @cordisjs/* / @satorijs/*——整体冻结在上游 koishi 4.18 配套线。Phase 5 跳代实证被 `@satorijs/core@4.6.0`（内部携带 cordis ^3，无 cordis 4 线）阻塞并整体回退，重启条件见 [../decisions/upgrade-plan.md](../decisions/upgrade-plan.md) Phase 5 节。
2. **独立工具链（现代线）**：构建 / 前端 / CLI / 测试已一步到位（vite 8、TS 7、tsdown、biome 2.5、bun test）。

### 硬性规则

- `peerDependencies` **一律指向 CE 包名**（`@koishi-ce/* ^1.0.0`），不要写回上游名；代码内导入同样一律 `@koishi-ce/*`（例外仅 `@koishijs/plugin-server-proxy` 一处外部包，宿主插件 console 的类型引用）。
- vendored 三包（http / proxy / server）不动。
- 依赖方向：`plugins/webui/* → @koishi-ce/console → @koishi-ce/core`；`plugins/common/* → @koishi-ce/core`；`packages/web/*` 中浏览器侧的 `app` / `client` / `components` 不依赖 node 侧运行时（`app` 消费 `client` 与 `components`；`builder` 是 node 侧构建器，依赖 `app` / `client` / `components` 与构建工具，方向为 `console 插件 → builder → app / client / components`）。
- 以上包名纪律、顶层类型字段统一（`types`，不混用旧别名 `typings`）与 ESM-only 形态由 `check:packages` 门禁强制（`tooling/checks/packages.ts`，已并入 `bun run check`）；循环依赖为 fallow 的 error 级规则（`.fallowrc.jsonc`，CI 的 fallow job 生效）。

## 4. 构建体系

### node 侧：根 tsdown 统一构建

根 `tsdown.config.ts` 用 workspace 模式一次构建所有 node 侧包：

- `workspace.include`：`packages/node/*`、`packages/web/*`、`apps/{koishi-create,koishi-scripts}`、`plugins/{common,infra,webui}/*`；`exclude`：vendored 三包、`packages/web/{app,client,components}`（纯前端源码，无 node 侧入口）、`packages/shim/*`（纯 JS 预编译）。
- **单遍 ESM-only 构建**：`index.mjs` + `index.d.ts`，各包 exports 以 `default` 条件兜底；`deps.neverBundle: [/^@koishi-ce\//]` 把 workspace 互引按包名外部化；`loader: { ".yml": "copy" }` 把 locale yml 原样拷入产物并改写引用路径。
- 包级差异配置：`apps/{koishi-create,koishi-scripts}` 各有 `tsdown.config.ts`（只补 bin 入口等差异，随根 workspace 模式自动合并；进目录单独 build 仅调试用）。

### 前端：vite 编程式构建（无配置文件）

- **宿主控制台总装**：`packages/web/builder/src/assemble.ts`——依次构建 app（宿主 SPA 包 `@koishi-ce/console-app` 的 `src/`，unocss preset-mini）、拷贝 vue runtime、构建 vue-router / @vueuse 外部块、client（`@koishi-ce/client` 的 `src/`，element-plus 单独 manualChunks），产物统一输出 `plugins/webui/console/dist`，并把 vue / vue-router / @vueuse / @koishi-ce/client 指向外部块文件（宿主只装一份）。
- **单插件前端**：`packages/web/builder/src/index.ts` 的 `build(root)`（CLI：`bun packages/web/builder/src/bin.ts build <插件目录>`）。内置 `collectWorkspaceAliases()` 扫描根 workspaces glob 做显式映射——未被依赖的插件不在 node_modules 链接里，bundler 无法自行解析。
- 插件自带构建脚本：`plugins/webui/analytics/build/client.ts`（fuck-echarts：echarts chunk 内 `Symbol` 重命名；`build()` 显式加载合并该文件名，vite 不会自动发现。explorer 的 monaco manualChunks 覆盖已删——rolldown 自动分包已实现其目标）。
- **按需分包实例（explorer 编辑器）**：CodeMirror 6 的语言包由 `plugins/webui/explorer/client/languages.ts` 动态 `import()` 注册，rolldown 为每个语言切出独立 chunk（构建后 `dist/` 只有 23 个文件，首屏内核约 431 KB）；`index.js` 里的 `import()` 被 minify 成模板字符串形态（`import(`./dist-xxx.js`)`），校验产物所属可用「静态可达 chunk 之和」口径。
- `packages/web/{app,client,components}` 无构建（源码直出，被 console 打包器消费）；三者均以 `src/` 为源码目录（本仓统一约定），不含任何 node 侧入口。

### 类型检查体系

- 实际检查 = 两条纯 `bunx tsc` 串行（TS7 native）：node 侧大一统 `tsconfig.json` + client 侧大一统 `tsconfig.web.json`（paths 为各工程 paths 的合并，exclude 挡住 `schemastery-vue-runtime.ts`——第三方源码不进类型程序）。`tsconfig.base.json` 的 paths 把全部 `@koishi-ce/*` 指向各自 src 的**具体 .ts 文件**（nodenext 下指目录会回退解析 lib 产物 d.ts，与 src 形成双模块视图）。
- 各 `client/tsconfig.json` 形如 `{"extends": "...tsconfig.client", "include": ["."]}`；新增 client 工程时须同步 `tsconfig.web.json` 的 include/paths。

## 5. 测试体系

- 运行器 `bun test`（裸跑即全量，覆盖全部 node 侧包与 tooling 回归；提交前与 CI 走 `bun run test`，带 `--isolate` 隔离跨文件 mock；文件与用例数以实跑输出为准，2026-09-20 实测 126 文件 / 1003 用例）；断言标准为 `bun:test` 的 `expect`（chai 及其插件已于 2026-09-02 全量迁出）；shape 断言用 `packages/node/core/src/__tests__/shape.ts` 注册的 `toHaveShape`。写法与坑见 [../guides/development.md](../guides/development.md) §6。

## 6. 许可证分区（权威：`NOTICE`）

| 区域 | 许可证 |
|---|---|
| `packages/node/{core,loader,utils,i18n-utils,cli,assets}`、`plugins/infra/*`、`plugins/common/*`、`packages/shim/*`、`apps/*` | MIT |
| `packages/web/{app,client,components}`、`plugins/webui/*` 全部（含 console 宿主插件） | **AGPL-3.0** |
| `packages/node/{console,registry}` | MIT（上游各包 package.json 声明） |

在 AGPL 目录新增文件同样受 AGPL 约束；分发组合作品或提供网络服务会触发 AGPL 义务（含源码披露）。原版权归属 Shigma 与 Koishijs 贡献者（2019-present）。
