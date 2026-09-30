# 依赖与技术栈全量审计报告

> **状态：现势快照（2026-09-30 重写重拍）**。本版是对 2026-09-19 快照（含 09-21 / 09-22 / 09-30 的 ⑩⑪ 增量修订）的**整体重写**：结构事实、依赖清单、新鲜度与基线数字全部于本轮重新采集，不复用上版表格与结论；上版正文见 git 历史。升级计划见 [upgrade-plan.md](upgrade-plan.md)，日常口径以 [../guides/development.md](../guides/development.md) 与 [../reference/architecture.md](../reference/architecture.md) 为准。
>
> 审计日期：2026-09-30 · 采集方式：脚本化全量对拍（口径见 §7）
> 运行环境：Bun 1.4.2（`packageManager` 钉定）· Node v24.16.0（辅：TS7 编译器与 vue-tsc 影子闸门宿主）· 包管理：Bun workspaces（`bun.lock`，lockfileVersion 2）
> 范围：仓库内全部 **54 个 package.json**（**53 个 workspace 包** + 根，按 `workspaces` glob 逐个实测；`bun run check` 的 `check:packages` 闸门亦独立印出「53 个 workspace 包」）· **79 个外部依赖名**（不含 `workspace:*` 与 `@koishi-ce/*` 内部互引，后者单列于 §2.G）
> 数据源：各 package.json 的四个依赖字段 → `bun.lock` 的实装解析 → npm registry 的 `dist-tags.latest`（79/79 名于本轮实时拉取，未用镜像兜底）

状态图例：[新] 实装即当前最新 · [缓] 落后 minor/patch · [旧] 落后 major · [预] 最新版为预发布 · [废] 已弃用或未使用

---

## 0. 本版相对上版的订正（先读）

| # | 项 | 上版记载 | 本轮实测 | 处置 |
|---|---|---|---|---|
| 1 | workspace 包数 | 54（+根 = 55 个 package.json） | **53**（+根 = **54** 个 package.json） | 本文档按实况订正；`common ×8`（`cron` 于 2026-09 迁出至 [Koishi-CE/services](https://github.com/Koishi-CE/services)）、`packages/web ×4`（app / builder / client / components）——同一处计数在 [architecture.md](../reference/architecture.md)、[development.md](../guides/development.md) 与 [AGENTS.md](../../AGENTS.md) 亦已同步修正 |
| 2 | 外部依赖名数 | 77 | **79** | 上版清单未收 `turbo`（2026-09-28 门禁改由 turbo 执行）与 `unplugin-icons`（builder 的编译期图标虚拟模块）；本轮以实况 79 名为准 |
| 3 | [缓] minor/patch 落后 | 13 项 | **0 项** | 2026-09-30 的 `bun.lock` 全量重解析（#45）后，全部非冻结依赖的实装版本已追平 registry `latest` |
| 4 | [旧] major 落后 | 4 项 | **5 项** | 新增 `@cordisjs/plugin-server-proxy`（上游已发 1.2.1，本仓停在冻结线内的 0.2.0）；5 项**全部**属 cordis 3.x 内洽冻结线，非升级欠账 |
| 5 | 门禁段数 | 八段 | **十段** | 新增 `check:console-wiring`、`check:pr-templates`；CI 的 gate job 改由 turbo 执行（内容寻址缓存 + OIDC 远程缓存） |
| 6 | 测试计数 | 128 文件 / 1042 用例 | **133 文件 / 1082 用例 / 2957 断言**（`bun run test`，50.02s） | 已更新 |
| 7 | 覆盖率 | 约 97% 行（src 源码口径） | 见 §5 | **上版口径不可复现**：`bun test --coverage` 实测 All files **93.72% 行 / 96.1% 分支**；`bun run test:ci` 的 lcov 聚合为 93.05% 行（206 文件）／排除 `tooling/` 与 `vendor/` 后 94.15%。因上版未记录命令与过滤条件，本轮以两个实测口径入档 |
| 8 | vue-tsc 影子基线 | 26 键 | **31 条**（`tooling/checks/vue-types-baseline.json`，vue-tsc 3.3.11 + TS 5.9.3，2026-09-25 重生成） | 已更新；断言基线仍为 17 处（2026-09-21，pending 0） |
| 9 | builder 的 `typescript ^5.0.0` | 「存疑」死依赖 | **已确证的死声明** | 锁文件嵌套条目 + 全仓零导入双重实证，升为 P1 处置项（§4.1） |
| 10 | 依赖更新机制 | 未记载 | Dependabot 已启用（2026-09-27） | 周更 minor/patch + 安全更新；冻结线与 major 由 `ignore` 显式屏蔽，见 §5 与 [.github/dependabot.yml](../../.github/dependabot.yml) |

---

## 1. 项目定位与结构

本项目是 [koishijs/koishi](https://github.com/koishijs/koishi)（MIT）与 [koishijs/webui](https://github.com/koishijs/webui)（部分 AGPL-3.0）的文件级合并仓，npm 作用域 `@koishi-ce`，运行时目标 **Bun**（Node 不作兼容目标）。上游同步按映射表手动 diff 移植（[../process/upstream.md](../process/upstream.md)），发布走 `bun run release` 链（[../process/release.md](../process/release.md)）。

```
Koishi-CE/  （54 个 package.json = 53 个 workspace 包 + 根；workspaces glob 逐目录实测）
├── packages/node/      运行时核心 8 包：koishi(CLI 入口) core loader console utils i18n-utils assets registry
├── packages/web/       控制台前端 4 包：app(宿主 SPA 源码) client components(浏览器库源码直出) builder(node 侧构建器)
├── packages/shim/      下游 npm alias 占名 4 包：koishi-shim(4.18.11) console-shim / client-shim(5.30.11) components-shim(1.5.22) —— 版本冻结勿动
├── plugins/common/     通用插件 8：assets-local bind broadcast callme echo help inspect rate-limit（cron 已迁出）
├── plugins/infra/      基础设施 8：hmr memory mock sqlite + vendored 预编译 http proxy server + server-temp
├── plugins/webui/      控制台插件 19：actions admin analytics auth commands config console dataview explorer
│                       insight locales logger market notifier oobe sandbox status theme-vanilla welcome
├── apps/               koishi-create(包名 create-koishi-ce) koishi-scripts(@koishi-ce/scripts)
├── tooling/            checks / release / sandbox / upstream-audit
└── docs/               guides / reference / decisions / process
```

关键结构事实（均为本轮核对，非沿用上版）：

- **CI 三 job**（`.github/workflows/ci.yml`）：**gate**（`//#build` → 宿主前端 → `//#check` → `//#test:ci` + lcov 上传 Codecov）、**client**（全部 webui 插件前端 bundle）、**fallow**（死代码与依赖审计）。三者均经 turbo 执行，远程缓存凭据走 OIDC，换取失败显式降级且**不阻断门禁**；另有 `merge_group` 触发与 triage 自动分诊。
- **门禁十段**：`bun run check` = biome lint + eslint(.vue) + TS7 双 project 类型检查 + locales / docs-links / vue-types / assertions / packages / console-wiring / pr-templates 六个自研闸门（脚本居 `tooling/checks/`）。
- **上游名外部依赖维持 0**：console 宿主的类型引用走转发源 `@cordisjs/plugin-server-proxy`（dev，零运行时依赖；上游薄壳 `@koishijs/plugin-server-proxy` 自带 `peerDependencies: koishi ^4.17.6`，会诱使 Bun 自动装官方全家桶共 9 个包，已移除）。
- **peerDependencies 全面 CE 化**：内部互引一律 `@koishi-ce/* ^1.0.0`（§2.G），代码内导入同样全为 `@koishi-ce/*`。
- **vendored 三包不动**：`plugins/infra/{http,proxy,server}` 为预编译产物包（无 `src/`，根 tsdown 显式 exclude），内联再导出 `@cordisjs/plugin-*`。
- **shim 四包占名**：`packages/shim/*` 是下游 npm alias 的占名目标，纯 JS 预编译、版本冻结跟随上游线、changesets ignore。
- **版本自主演进**：workspace 包走 1.x 线（本轮实况：core 1.1.7 / plugin-console 1.4.1 / client 1.4.2 / plugin-market 1.4.1 等），不再镜像上游版本号。
- **前端构建无 vite 配置文件**：全部编程式 `vite.build()`（宿主入口 `packages/web/builder/src/bin.ts`；插件可自带 `build/client.ts` 覆盖配置，vite 不会自动发现该文件名）。

---

## 2. 外部依赖全量清单（79 名）

**口径**：逐个扫描 54 个 package.json 的 `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies`，剔除 `workspace:*` 与 `@koishi-ce/*` 内部互引后按**名字**计数；同一个包在不同包/不同字段声明多次只计一名（声明列列出全部 range 形态，实装列列出全部实装版本）。「实装」取自 `bun.lock` 的解析结果，「最新」取自 npm registry 的 `dist-tags.latest`（均于 2026-09-30 采集）。

### A. cordis / koishi 生态运行时（3.x 内洽冻结线）

| 包 | 声明 | 使用位置 | 业务范围 | 实装 | 最新 | 状态 |
|---|---|---|---|---|---|---|
| `cordis` | `^3.18.1` | core · web/client · infra/proxy · infra/server | 依赖注入容器 + 插件生命周期内核 | `3.18.1` | `4.0.0-rc.10` | [预] 冻结 3.x（`latest` tag 即 4.0.0-rc.10） |
| `minato` | `^3.7.0` | core · infra/memory · infra/sqlite | ORM / 数据库抽象层 | `3.7.0` | `4.0.1` | [旧] 冻结 3.x |
| `@minatojs/sql-utils` | `^5.6.0` | infra/sqlite | 数据库迁移工具 | `5.6.0` | `6.0.0` | [旧] 冻结 3.x |
| `@cordisjs/plugin-http` | `^0.6.3` | infra/http | HTTP 客户端上下文（`ctx.http`） | `0.6.3` | `1.5.2` | [旧] 冻结 3.x |
| `@cordisjs/plugin-server` | `^0.2.9` | infra/server | HTTP/WS 服务上下文（`ctx.server`） | `0.2.9` | `1.7.0` | [旧] 冻结 3.x |
| `@cordisjs/plugin-proxy-agent` | `^0.3.3` | infra/proxy | 网络代理支持 | `0.3.3` | `0.3.3` | [新] |
| `@cordisjs/plugin-server-proxy` | `^0.2.0` | webui/console（dev） | 代理类型增强（console 宿主空类型导入） | `0.2.0` | `1.2.1` | [旧] 冻结 3.x |
| `@satorijs/core` | `^4.6.0` | core | 聊天协议内核（会话 / 机器人抽象） | `4.6.0` | `4.6.0` | [新] |
| `@satorijs/element` | `^3.2.0` | web/components · webui/notifier · webui/sandbox | 消息元素树 / KQL 模型 | `3.2.0` | `3.2.0` | [新] |
| `@satorijs/protocol` | `^1.7.0` | web/client | 协议数据结构类型 | `1.7.0` | `1.7.0` | [新] |
| `@satorijs/components-vue` | `^0.7.8` | webui/sandbox（dev） | 消息元素 Vue 渲染（测试用） | `0.7.8` | `0.7.8` | [新] |
| `cosmokit` | `^1.8.1` | core · i18n-utils · registry · utils · web/client · 共 10 处 | 生态通用工具箱 | `1.8.1` | `1.8.1` | [新] |
| `reggol` | `^2.1.0` | webui/logger（dev） | 生态日志库（logger 前端渲染） | `2.1.0` | `2.1.0` | [新] |
| `inaba` | `^1.1.1` | utils | 随机数据生成 | `1.1.1` | `1.1.1` | [新] |
| `fastest-levenshtein` | `^1.0.16` | core | 编辑距离（命令纠错建议） | `1.0.16` | `1.0.16` | [新] |

**冻结纪律**：cordis / minato / @minatojs/* / @cordisjs/* / @satorijs/* / cosmokit 整体钉在 3.x 内洽线——Phase 5（cordis 4 跳代）已实证被 `@satorijs/core`（内部携带 cordis ^3，无 cordis 4 线）阻塞并整体回退，重启条件见 [upgrade-plan.md](upgrade-plan.md) Phase 5 节。本表的 [旧] / [预] 属**刻意落后**，不是升级欠账，**勿在线内单独升版**；Dependabot 侧已按同一清单 `ignore`（§5）。

### B. 前端 UI 栈与浏览器库

| 包 | 声明 | 使用位置 | 业务范围 | 实装 | 最新 | 状态 |
|---|---|---|---|---|---|---|
| `vue` | `^3.5.42` / `^3` / `^3.5.12` | web/app · web/builder · web/client · web/components · webui/auth · 共 9 处 | UI 框架 | `3.5.43` | `3.5.43` | [新] |
| `vue-router` | `^5.2.0` / `^5` | web/app · web/builder · web/client · web/components · webui/auth · 共 8 处 | 控制台路由 | `5.3.1` | `5.3.1` | [新] |
| `vue-i18n` | `^11.4.10` / `^11` | web/app · web/builder · web/client · web/components · webui/market | 界面国际化 | `11.4.12` | `11.4.12` | [新] |
| `@vueuse/core` | `^15.0.0` | web/app · web/builder · web/client · webui/admin · webui/explorer · 共 7 处 | Vue 组合式工具集 | `15.0.0` | `15.0.0` | [新] |
| `element-plus` | `^2.14.5` / `^2` | web/app · web/client · web/components · webui/config · webui/explorer · 共 6 处 | UI 组件库 | `2.14.7` | `2.14.7` | [新] |
| `schemastery-vue` | `^7.3.15` | web/components | 配置 Schema → 表单渲染 | `7.3.15` | `7.3.15` | [新] |
| `marked` | `^18.0.14` | web/components | Markdown 解析内核（`k-markdown`） | `18.0.14` | `18.0.14` | [新] |
| `dompurify` | `^3.4.15` | web/components | HTML 消毒（`k-markdown` 非 unsafe 模式） | `3.4.16` | `3.4.16` | [新] |
| `unocss` | `^66.8.1` | web/builder | 原子化 CSS 引擎（宿主总装） | `66.10.5` | `66.10.5` | [新] |
| `unplugin-icons` | `^24.0.0` | web/builder | 图标虚拟模块（编译期 `~icons/*`） | `24.0.0` | `24.0.0` | [新] |
| `codemirror` | `^6.0.2` | webui/explorer（dev） | 编辑器内核（explorer） | `6.0.2` | `6.0.2` | [新] |
| `@codemirror/commands` | `^6.11.1` | webui/explorer（dev） | CodeMirror 6 内核模块（explorer） | `6.11.1` | `6.11.1` | [新] |
| `@codemirror/language` | `^6.12.4` | webui/explorer（dev） | CodeMirror 6 内核模块（explorer） | `6.12.4` | `6.12.4` | [新] |
| `@codemirror/legacy-modes` | `^6.5.4` | webui/explorer（dev） | CodeMirror 6 内核模块（explorer） | `6.5.4` | `6.5.4` | [新] |
| `@codemirror/state` | `^6.7.5` | webui/explorer（dev） | CodeMirror 6 内核模块（explorer） | `6.7.6` | `6.7.6` | [新] |
| `@codemirror/theme-one-dark` | `^6.1.3` | webui/explorer（dev） | CodeMirror 6 内核模块（explorer） | `6.1.3` | `6.1.3` | [新] |
| `@codemirror/view` | `^6.43.12` | webui/explorer（dev） | CodeMirror 6 内核模块（explorer） | `6.43.13` | `6.43.13` | [新] |
| `@codemirror/lang-css` | `^6.3.1` | webui/explorer（dev） | 语言语法（explorer 按需 chunk） | `6.3.1` | `6.3.1` | [新] |
| `@codemirror/lang-html` | `^6.4.12` | webui/explorer（dev） | 语言语法（explorer 按需 chunk） | `6.4.12` | `6.4.12` | [新] |
| `@codemirror/lang-javascript` | `^6.2.5` | webui/explorer（dev） | 语言语法（explorer 按需 chunk） | `6.2.5` | `6.2.5` | [新] |
| `@codemirror/lang-json` | `^6.0.2` | webui/explorer（dev） | 语言语法（explorer 按需 chunk） | `6.0.2` | `6.0.2` | [新] |
| `@codemirror/lang-less` | `^6.0.2` | webui/explorer（dev） | 语言语法（explorer 按需 chunk） | `6.0.2` | `6.0.2` | [新] |
| `@codemirror/lang-markdown` | `^6.5.2` | webui/explorer（dev） | 语言语法（explorer 按需 chunk） | `6.5.2` | `6.5.2` | [新] |
| `@codemirror/lang-sass` | `^6.0.2` | webui/explorer（dev） | 语言语法（explorer 按需 chunk） | `6.0.2` | `6.0.2` | [新] |
| `@codemirror/lang-sql` | `^6.10.0` | webui/explorer（dev） | 语言语法（explorer 按需 chunk） | `6.10.0` | `6.10.0` | [新] |
| `@codemirror/lang-vue` | `^0.1.3` | webui/explorer（dev） | 语言语法（explorer 按需 chunk，仍在 0.x） | `0.1.3` | `0.1.3` | [新] |
| `@codemirror/lang-xml` | `^6.1.0` | webui/explorer（dev） | 语言语法（explorer 按需 chunk） | `6.1.0` | `6.1.0` | [新] |
| `@codemirror/lang-yaml` | `^6.1.3` | webui/explorer（dev） | 语言语法（explorer 按需 chunk） | `6.1.3` | `6.1.3` | [新] |
| `echarts` | `^6.1.0` | webui/analytics（dev） | 数据可视化图表 | `6.1.0` | `6.1.0` | [新] |
| `vue-echarts` | `^8.1.0` | webui/analytics（dev） | echarts 的 Vue 封装 | `8.3.1` | `8.3.1` | [新] |
| `ansi_up` | `^6.0.6` | webui/logger（dev） | ANSI 转义 → HTML | `6.0.6` | `6.0.6` | [新] |
| `d3-force` | `^3.0.0` | webui/insight（dev） | 关系图谱力学布局 | `3.0.0` | `3.0.0` | [新] |
| `lottie-web` | `^5.13.0` | webui/welcome（dev） | Lottie 动画（welcome 开屏描线） | `5.13.0` | `5.13.0` | [新] |
| `@noble/hashes` | `^2.4.0` | webui/market（dev） | MD5（gravatar 头像摘要） | `2.4.0` | `2.4.0` | [新] |

### C. 构建、打包与代码质量工具链

| 包 | 声明 | 使用位置 | 业务范围 | 实装 | 最新 | 状态 |
|---|---|---|---|---|---|---|
| `vite` | `^8.2.2` | web/builder · web/client · webui/analytics · webui/console · webui/welcome | 前端构建（编程式 `vite.build()`） | `8.3.1` | `8.3.1` | [新] |
| `@vitejs/plugin-vue` | `^6.0.8` | web/builder | Vue SFC 编译插件 | `6.0.9` | `6.0.9` | [新] |
| `sass-embedded` | `^1.102.0` | web/builder | SCSS 编译（替代 dart-sass） | `1.105.1` | `1.105.1` | [新] |
| `tsdown` | `^0.23.0` | 根（dev） | node 侧单遍构建 | `0.23.0` | `0.23.0` | [新] |
| `typescript` | `npm:@typescript/typescript6@6.0.2` / `^5.0.0` | 根 · web/builder | TS 双轨载体（见 §4.1） | `6.0.2` / `5.9.3` | `7.0.2` / `6.0.2` | [缓] 双轨，含一条待删死声明（§4.1） |
| `@typescript/native` | `npm:typescript@7.0.2` | 根（dev） | TS7 原生编译器（类型检查真身） | `7.0.2` | `7.0.2`（`typescript` 的 latest） | [新] npm: alias = `typescript@7.0.2` |
| `@biomejs/biome` | `^2.5.10` | 根（dev） | Lint + Format 唯一权威 | `2.5.14` | `2.5.14` | [新] |
| `eslint` | `^10.9.1` | 根（dev） | `.vue` 模板语义 lint | `10.11.0` | `10.11.0` | [新] |
| `eslint-plugin-vue` | `^10.10.0` | 根（dev） | Vue 规则集（eslint） | `10.11.1` | `10.11.1` | [新] |
| `@typescript-eslint/parser` | `^8.68.0` | 根（dev） | TS 语法解析（eslint） | `8.71.0` | `8.71.0` | [新] |
| `vue-eslint-parser` | `^10.4.1` | 根（dev） | `.vue` 解析（eslint） | `10.4.1` | `10.4.1` | [新] |
| `@babel/code-frame` | `^8.0.0` | infra/hmr | 构建错误源码帧（hmr） | `8.0.6` | `8.0.6` | [新] |
| `@parcel/watcher` | `^2.6.0` | infra/hmr | 文件监听原生绑定（hmr） | `2.6.0` | `2.6.0` | [新] |
| `@changesets/cli` | `^3.0.1` | 根（dev） | 版本与 changelog | `3.0.3` | `3.0.3` | [新] |
| `turbo` | `2.11.5` | 根（dev） | 门禁任务编排 + 远程缓存 | `2.11.5` | `2.11.5` | [新] |

### D. CLI 脚手架与系统交互

| 包 | 声明 | 使用位置 | 业务范围 | 实装 | 最新 | 状态 |
|---|---|---|---|---|---|---|
| `cac` | `^7.0.0` | cli | 轻量 CLI 框架 | `7.0.0` | `7.0.0` | [新] |
| `@clack/prompts` | `^1.7.0` | koishi-create | 交互式提示 | `1.8.1` | `1.8.1` | [新] |
| `picocolors` | `^1.1.1` | koishi-create · cli | 终端着色 | `1.1.1` | `1.1.1` | [新] |
| `open` | `^11.0.1` | webui/console | 打开浏览器 | `11.0.4` | `11.0.4` | [新] |
| `chardet` | `^2.2.0` | webui/explorer | 文本编码检测 | `2.2.0` | `2.2.0` | [新] |
| `file-type` | `^22.0.2` | assets · common/assets-local · webui/explorer | 文件类型嗅探 | `22.1.1` | `22.1.1` | [新] |
| `picomatch` | `^4.0.7` | webui/explorer | glob 匹配（文件树过滤） | `4.0.7` | `4.0.7` | [新] |
| `semver` | `^7.8.5` | registry · webui/market | 语义版本计算 | `7.8.5` | `7.8.5` | [新] |

### E. 测试设施（运行时类型与 DOM 垫片）

初版审计中的 mocha / chai / chai-as-promised / chai-shape / @sinonjs/fake-timers 等已于 2026-09-02 前整体退役，断言统一为 `bun:test` 原生 `expect`，时间模拟用其内建 mock timers；现役仅有运行时类型与一组**仅测试期**的 DOM 垫片：

| 包 | 声明 | 使用位置 | 业务范围 | 实装 | 最新 | 状态 |
|---|---|---|---|---|---|---|
| `@types/bun` | `^1.4.0` | 根（dev） | Bun 运行时类型 | `1.4.2` | `1.4.2` | [新] |
| `@types/node` | `^26.4.0` | 根（dev） | Node 类型（工具宿主） | `26.6.3` | `26.6.3` | [新] |
| `jsdom` | `^30.1.1` | web/client · web/components（dev） | DOMPurify 的服务端 DOM 垫片（仅测试期） | `30.1.1` | `30.1.1` | [新] |
| `@types/jsdom` | `^30.0.0` | web/client（dev） | jsdom 类型 | `30.0.0` | `30.0.0` | [新] |

### F. 类型包杂项

| 包 | 声明 | 使用位置 | 业务范围 | 实装 | 最新 | 状态 |
|---|---|---|---|---|---|---|
| `@types/d3-force` | `^3.0.9` | webui/insight（dev） | d3-force 类型 | `3.0.10` | `3.0.10` | [新] |
| `@types/semver` | `^7.5.8` | registry · webui/market（dev） | semver 类型 | `7.8.0` | `7.8.0` | [新] |
| `@types/picomatch` | `^4.0.3` | webui/explorer（dev） | picomatch 类型 | `4.0.3` | `4.0.3` | [新] |

### G. CE 内部 peer 面（非外部依赖，单列对账）

| 包 | 声明 | 声明处 | 对应 workspace 实体（本轮版本） |
|---|---|---|---|
| `@koishi-ce/koishi` | `^1.0.0` (peer) | 37 处（node / infra / webui 插件 + koishi-shim 占名） | packages/node/cli（1.0.19） |
| `@koishi-ce/plugin-console` | `^1.0.0` (peer) | 18 处（webui 插件 + console-shim 占名） | plugins/webui/console（1.4.1） |
| `@koishi-ce/console` | `^1.0.0` (peer) | 3 处（notifier / theme-vanilla / welcome） | packages/node/console（1.1.0） |
| `@koishi-ce/loader` | `^1.0.0` (peer) | 2 处（hmr / config） | packages/node/loader（1.1.1） |
| `@koishi-ce/core` | `^1.0.0` (peer) | 1 处（loader） | packages/node/core（1.1.7） |
| `@koishi-ce/client` | `^1.0.0` (peer) | 1 处（console） | packages/web/client（1.4.2） |
| `@koishi-ce/assets` | `^1.0.0` (peer) | 1 处（assets-local） | packages/node/assets（1.0.2） |
| `@koishi-ce/console-app` | `^1.0.0` (peer) | 1 处（console） | packages/web/app（1.0.3） |
| `@koishi-ce/console-builder` | `^1.0.0` (peer) | 1 处（console） | packages/web/builder（1.0.4） |

peer 声明用于下游 `bun add` 解析与防 Bun 自动装官方包，指向 CE 名是硬性约束（[AGENTS.md](../../AGENTS.md) 硬性约束 1-2），**不是升级对象**；Dependabot 侧同样整体 ignore（§5）。

---

## 3. 新鲜度总览（79 名，registry 实测）

| 类别 | 数量 | 明细 |
|---|---|---|
| [新] 实装即最新 | **71** | 含全部前端 UI 栈、构建工具链、CodeMirror 6 全线 18 名、测试设施与类型包 |
| [旧] 落后 major | **5** | `minato` / `@minatojs/sql-utils` / `@cordisjs/plugin-{http,server,server-proxy}`——**全部**属 cordis 3.x 内洽冻结线，刻意落后 |
| [预] 最新为预发布 | **1** | `cordis`（`latest` tag 即 4.0.0-rc.10，冻结线） |
| [缓] 落后 minor/patch | **0** | 2026-09-30 锁文件重解析后清零；唯一非冻结线的落后项是 builder 的 `typescript ^5.0.0`（死声明，非真实升版欠账，见 §4.1） |
| [废] 弃用/未使用 | **0** | 79 名逐个核对 registry 的 `deprecated` 字段：**无一被标记弃用**；历史退役项（`giget` / `monaco-editor` / `spark-md5` / `marked-vue` / `xss` / `anymatch` / 测试栈）均已出仓 |

**与上版对比**：外部依赖名 77 → 79（+`turbo` +`unplugin-icons`，见 §0）；[旧] 4 → 5（冻结线内多一项）；[缓] 13 → **0**；[废] 0 → 0。

**名数与体量是两个口径，勿互相替代**：名数上升未必是膨胀，名数下降也未必更轻。三个现役例证——① CodeMirror 6 把编辑器依赖从 1 名拆成 18 名（生态按「一个语言一个包」切分），但 explorer 产物实测由 13.55 MB / 97 文件降到 **0.72 MB / 23 文件**（本轮复核工作区现有产物：23 文件 / 0.72 MB，与上版一致）；② `marked` 与 `dompurify` 的替换各带来 minify 后 +10.0 KB / +10.3 KB 的字节成本，换来的是解析正确性与十余年攒下的消毒覆盖面；③ `jsdom` + `@types/jsdom` 是**仅测试期**的垫片，不进任何产物。故本节只作计数，判据与取舍见 §4。

---

## 4. 声明与实际使用一致性

### 4.1 builder 的 `typescript ^5.0.0`：唯一可动的「落后」项，已确证为死声明（P1）

- **声明面**：`packages/web/builder/package.json` 的 `dependencies.typescript: ^5.0.0`（随构建器从 `packages/web/client` 迁出时带入）。
- **使用面为零**：全仓匹配 `from "typescript"` 仅命中 `tooling/checks/console-wiring.ts`（该文件按包名解析到**根**的 `typescript` 别名，与 builder 的声明无关）；`packages/web/builder/src/**` 零引用。
- **物理代价（本轮新增实证）**：`bun.lock` 的 `packages` 段存在嵌套条目 `"@koishi-ce/console-builder/typescript": ["typescript@5.9.3", …]`——嵌套键形如 `父包/包名`，即该声明是 5.9.3 这份**独立物理副本**在锁文件里的唯一来源（全仓同名嵌套项共 40 条，其余 39 条均由第三方包内部引入，与本仓声明面无关）。
- **易混淆点**：vue-tsc 影子闸门用的 `typescript@5.9.3` 是自举安装到 `node_modules/.cache/vue-tsc-shadow` 的**钉版载体**（版本号相同是巧合），与 builder 的声明无关；删掉声明不会影响该闸门。
- **处置**：删除申报（并复核重装后的锁文件不再出现该嵌套条目）。删除前须**重建宿主前端**实证无回归——前端链的「假绿」判例见 [../guides/development.md](../guides/development.md) §7。

### 4.2 死代码审计（fallow）现状

- **红点清零**：`bun run fallow`（fallow 3.25.0，版本在根 package.json 脚本内**钉精确版**——浮动会让 dead-code 判定口径在无代码改动时漂移、审计数字不可复现）本轮退出码 0；上版点名的两处未用导出（market `dependencies/service.ts` 的默认导出、installer 的 `Dependency` re-export）已随 9925a74 清除。
- **无幽灵依赖**：见 §4.4；**豁免面**：见 §4.5。
- **循环依赖为 error 级规则**（2026-09 断环收官，含 core 的 command/context 旧债），CI 的 fallow job 直接咬死环回归。

### 4.3 range 漂移（无害、待统一）

| 包 | 形态 | 判定 |
|---|---|---|
| `vue` | `web/app` · `web/builder` · `web/client` 为 `^3.5.42`；`web/components` 的 peer 为 `^3`；5 个 webui 插件的 dev 为 `^3.5.12` | 实装已统一 `3.5.43`；建议把「同字段多形态」收敛为单一低界（peer 的宽 range 属刻意的下游宽容，可保留） |
| `vue-i18n` | `^11.4.10` / `^11`（components peer） | 同上 |
| `vue-router` | `^5.2.0` / `^5`（components peer） | 同上 |
| `element-plus` | `^2.14.5` / `^2`（components peer） | 同上 |
| `semver` | `^7.8.5`（registry 与 market 两处） | 2026-09-21 已统一，无双形态 |

### 4.4 无幽灵依赖

初版审计点名的 unlisted 问题（`apps/online` 靠 hoisting 存活）已随该目录删除消失；`bun run fallow`（dead-code）与 `bun run fallow:full`（dupes / health）本轮均无未列依赖告警，`check:packages` 另行强制包名纪律与顶层类型字段统一（`types`，不混用旧别名 `typings`）。全仓唯一「目录名 ≠ 包名」是 `apps/koishi-create` ↔ `create-koishi-ce`，引用一律以目录名为准。

### 4.5 「声明但无静态导入」的正当豁免（与 §4.1 死依赖的区别）

`.fallowrc.jsonc` 的 `ignoreDependencies` 逐条注明理由的豁免面：vendored 三包（插件加载链按包名运行时解析）、shim 四包与 `@koishi-ce/console-app`（下游 npm alias / 运行期 `Bun.resolveSync`）、webui 插件的一组 `@koishi-ce/*` dev 依赖（构建期 / 测试期按名加载）、`@cordisjs/plugin-server-proxy`（空类型导入，fallow 不视作引用）、`~icons`（unplugin-icons 的编译期虚拟模块）、前端 vue 系（由宿主与工作区根提供）、`sass-embedded` 与 `@typescript/native`（构建期编程式 / 按路径调用），以及沿自 knip 时代的上游遗留豁免（`@satorijs/element` / `pg-like` / `vue-i18n`）。**区别**：这些是**有消费方**（运行时按名解析、构建期编程式加载）的豁免，而 §4.1 的 builder `typescript` 无任何消费方。

### 4.6 peerDependencies 指向 CE 名属硬性约束

见 §2.G：`@koishi-ce/koishi` 37 处、`@koishi-ce/plugin-console` 18 处、`@koishi-ce/console` 3 处、`@koishi-ce/loader` 2 处，另有 `core` / `client` / `assets` / `console-app` / `console-builder` 各 1 处。peer 声明用于下游 `bun add` 解析与防 Bun 自动装官方包，指向 CE 名是硬性约束 1-2 的投影，**非缺陷、非升级对象**；Dependabot 亦对 `@koishi-ce/*` 整体 `ignore`（§5）。

### 4.7 `semver` 依赖不可去除（换不动）

`Bun.semver` 仅暴露 `satisfies` / `order` 两个函数，实测在四处关键语义上不覆盖：market 的 client 侧运行在浏览器（**无 `Bun` 全局**）且与 node 侧共用同一 package.json，依赖无论如何删不掉；`registry` 的 `intersects`（range 相交判定）无对应 API；`valid` 与 `Bun.semver.satisfies(x, "*")` **不等价**（`"=1.2.3"`：前者 null / 后者 true；`"1.2.3-beta.1"`：前者有效 / 后者 false），会使 `installer` 与 `snapshot` 的 `!valid(request) → invalid` 判定静默走偏；`satisfies` 的第三参 options 被 Bun 忽略（`{ includePrerelease: true }` 实测无效）。依赖为单包零传递依赖，保留成本可忽略。本轮复核：声明面已统一为 `^7.8.5`、实装即最新。

### 4.8 `bun-types` → `@types/bun`（已迁完，理由更正）

先纠正常见误传：`bun-types` **并未被废弃**（npm 上无 `deprecated` 标记，本轮 79 名全量核对亦未见弃用标记）；`@types/bun@1.4.2` 的 `index.d.ts` 全文只有一行 `/// <reference types="bun-types" />`，且其唯一依赖就是 `bun-types@1.4.2`——断言「两者并存会引发全局命名空间污染」不成立，因为**类型内容按构造完全相同**。迁移的真实理由是**跟随 Bun 官方约定**（`bun add -d @types/bun` + `"types": ["bun"]`，本机 `bun init` 亦然）。副作用是各 tsconfig 的 `types` 从 `"bun-types"` 改为 `"bun"`（`@types/*` 隐式前缀）；已确认全仓各 tsconfig 均显式声明 `types`（`tsconfig.client.json` 为 `types: []`），`node_modules/@types/` 下的自动包含不会波及 client 侧。

### 4.9 explorer 路径过滤：`anymatch` → 直连 `picomatch`

原依赖 `anymatch@3.1.3` 实现为 CJS 而 d.ts 为 ESM 形态，nodenext 类型视图对 `default` 多包一层，迫使源码保留一处 `as unknown as` 双重断言（断言基线台账内的 R2 条目）。改直连 `picomatch@4.0.7`（当时本仓早已由 vite / tsdown / tinyglobby 经传递依赖引入，显式声明等于零新增物理包）后：`anymatch` / `normalize-path` / 其嵌套的 `picomatch@2.3.2` 三包一并出仓，双重断言随之清零（基线 18 → 17）。行为经「多模式 × 13 输入」矩阵实测与 anymatch 逐条一致（含 win32 反斜杠路径与 `**/.*` 对 dotfile 的忽略）；唯一已知语义差异是 `!` 前缀模式（anymatch 视作纯排除、picomatch 视作取反），本仓不宣传该写法、存量亦无依赖。另记一处坑：**picomatch 4 只在显式传入 options 时才注入平台检测**，不传即按 posix 处理、win32 反斜杠路径全部漏配，故源码显式声明 `windows: process.platform === "win32"`。**为何不选 `micromatch`**：其匹配内核即 picomatch v2，本仓需要的能力（braces / capture / scan / makeRe）无一用得上，而依赖面 +5 物理包，惯用入口每次调用都重编正则，落到 `traverse()` 热路径上会退化为 N 次正则编译。本轮复核：声明 `^4.0.7`、实装即最新。

### 4.10 explorer 编辑器：`monaco-editor` → CodeMirror 6

判据是实测体积：monaco 打进 explorer 前端的产物为 **13.55 MB / 97 文件**（`ts.worker` 6.91 MB + `css.worker` 1.07 MB + `html.worker` 0.74 MB + `json.worker` 0.43 MB，四个语言服务 worker 合计 **9.15 MB**），而本插件自移植起就在运行期用 `setModeConfiguration` 把 css / json / typescript / html 的语言服务**全部关掉**、只留词法着色——即这 9.15 MB 属「付了钱不用」；且 `monaco-editor` 的 `.` 入口会连带引入全部语言定义与四个服务注册模块，**仅改单处导入无法摘除**（试过只改 `editor.ts` 时体积纹丝不动）。换 CM6 后同一构建为 **0.72 MB / 23 文件**（首屏静态可达约 431 KB，其余语言 chunk 全部按需 `import()` 下载），语言覆盖从 monaco 时代事实上的「四种服务包 + 全套语言定义」转为 **21 种语法**精选。
- **代价（名数口径变差的唯一来源，见 §3）**：声明的依赖名由 1 个涨到 18 个（CM6 生态按「一个语言一个包」切分：内核 `codemirror` / `@codemirror/{state,view,commands,language}` / `theme-one-dark` / `legacy-modes`，语法 `@codemirror/lang-{javascript,json,html,xml,css,sass,less,markdown,yaml,sql,vue}`）；但物理体量同时大幅下降（monaco 解包 97.9 MB 且携带 dompurify / marked 两个传递依赖，CM6 全线 18 包在 `node_modules` 里仅约 3 MB，无 worker、无二进制）。
- **语言取舍**：只收录 Koishi 生态真实会出现的类型（纯 TS / JS 世界，后端语言不可能出现在该目录里），`languages.ts` 的 LANGUAGES 表既是保守目标也是交付面；`languages.test.ts` 锁上 8 个后端扩展名（含 `.c` / `.h`）必须回退纯文本。已知行为差异（相对 monaco）：不再挂全局 `monaco` 命名空间（仓库内无消费者）、不再有语言服务（monaco 时代本就在运行期关着）。
- 本轮复核：产物 23 文件 / 0.72 MB；`@codemirror/lang-vue` 仍在 0.x（0.1.3），其余均 6.x 稳定线且全线实装即最新。

### 4.11 `@vueuse/core` 14 → 15

全仓唯一一处非冻结线 major 升版，声明面由 `^14.4.0` 统一到 `^15.0.0`。升版前逐条核对上游 v15.0.0 破例点与本仓实际用量的交集：本仓用到的 13 个符号在 15 的 `dist/index.d.ts` 全部仍在（零删除、零改名）；**`useThrottleFn` 的 `trailing` 默认值由 false 改为 true** 是唯一有交集的破例点，而本仓该调用显式传了 `trailing: true`（insight 的 `watchThrottled`），行为与 14 时代逐字等价；被移除的 deprecated timer options 只作用于八个本仓未使用的 composable；Drop `templateRef` 与 Drop Node 20 均无交集；入口形态仍为 `dist/index.js`，宿主共享块 `vueuse.js` 的重新打包路径无需改动。本轮复核：声明面已是单形态 `^15.0.0`、实装即最新；`element-plus` 2.14.7 已解除对 `@vueuse/core` 精确锁 `14.4.0` 的约束，**锁文件与本机均不再有嵌套 14.4.0 副本**（全仓只剩 15.0.0 单份）。

### 4.12 market 的 gravatar 摘要：`spark-md5` → `@noble/hashes`（同步 MD5）

动因是包体卫生：`spark-md5` 是 2018 年后不再发布的 UMD 包、**不带类型**（仓内长期靠手写的 `spark-md5.d.ts` 环境声明兜底），而 `@noble/hashes` 零依赖、原生 TS + ESM、无 worker 无二进制，且本仓早已因 `@paralleldrive/cuid2` 把它带在依赖树里（显式声明属「就地转正」）。
- **刻意不换 SHA-256（本条的实证核心）**：gravatar 官方推荐 SHA-256，实测 `s.gravatar.com` 对同一邮箱的 md5 / sha256 摘要**均返回 200 且为同一张头像**（官方双支持），但**镜像不保证**：`cravatar.cn`（正是模板 `env` 里 `GRAVATAR_MIRROR` 的默认值）对同一邮箱 `md5 → 200` / `sha256 → 404`，三次重跑稳定复现。换算法等于在默认镜像下静默丢头像（`d=mp` 兜底不报错）。另一个保留同步实现的原因：`crypto.subtle` 只在安全上下文存在，局域网 HTTP 下为 `undefined`，而 noble 的 md5 是纯 JS 同步实现。
- **实现与等价性**：`import { md5 } from "@noble/hashes/legacy.js"` + `bytesToHex(md5(utf8ToBytes(email.toLowerCase())))`（noble 2.x 子路径必须带 `.js`；`sha2.js` 才是 sha256，`legacy.js` 收纳 md5 / sha1 / ripemd160）。对 10 组输入（空串 / ASCII / 大写邮箱 / 非 ASCII 域名 / 代理对 emoji / 长串 / 首尾空格等）逐条比对，源码级与**打包后端到端**双重复核均与 `spark-md5` 完全一致。手写的 `spark-md5.d.ts` 随包删除，仓内再无任何声明依赖 `spark-md5`。
- 本轮复核：`@noble/hashes` 2.4.0 即最新（`@paralleldrive/cuid2` 保留其嵌套 1.8.0，二者共存于锁文件）。

### 4.13 `k-markdown` 改用就地 vendor 的本地实现（`marked-vue` 出仓，含 `marked` 9 → 18）

`k-markdown` 原先直接注册 npm 包 `marked-vue@1.3.0` 的默认导出。该包已停维护（上游最后一次提交是 2023 年的版本 bump，无 release），其全部价值只是把 `marked` 包成约 90 行的 Vue 组件加一段手写消毒，却把解析器**钉在 `^9.1.6` 永不前进**——而 `marked` 的更新几乎全是解析边界修复（依赖面的「声明名已是最新」与「包仍被维护」是两件事，本条是审计口径的一个补白）。
- **做法**：把上游 `src/index.ts` 整体 vendor 进 `packages/web/components/src/core/markdown.ts`（AGPL 目录，原档 MIT，已在 `NOTICE` 登记溯源），`marked` / `xss` 由 marked-vue 的传递依赖**转正为直接依赖**。相对上游仅两处非行为改动（`attrs: any` 改为 `Record<string, string>`；遮蔽外层 `html` 的局部变量改名）。props 语义、默认包裹标签与 `markdown` class、消毒白名单、`<a>` 属性规范化与栈式补闭合逐字等价，并以 25 用例 / 49 断言锁定基线。
- **顺带查明并锁定的两处上游怪癖**：白名单外标签的**开标签**被丢弃但**闭标签**因标签栈残留而原样留下（`<script>x</script>` → `x</script>`）；标签名大小写不归一（`<B>x</B>` → `<b>x</B>`）。二者无利用面，但正说明手写消毒的覆盖面有限，是 §4.14 的动因之一。另记一条使用面事实：白名单刻意不含 `img`，故**非 unsafe 模式下 Markdown 图片会被整体丢弃**（上游既有语义，下游写 usage 文档时需知道）。
- **方案 B1：`marked` 9.1.6 → 18.0.14**（同日落地）。跨 9 个 major 的输出会变、属行为变更，故先**双装对拍**：72 条语料 × 块级 / 行内两模式实测 16 处差异，逐条核对后全部属上游解析修复（裸 URL `href` 的 `&` 转义、不再产出非法链接套链接、CommonMark 数字字符引用解码、块级边界修复、数条 ReDoS 加固），无一处是本仓消毒层的前提变化。代码改动只在类型面（marked 18 把 `parse` / `parseInline` 都改成三条调用签名，最宽松一条返回 `ParserOutput | Promise<ParserOutput>`，故对三元表达式结果统一 cast 一次）。**代价是字节数**：`marked.esm.js` 源码由 89,397 B 降到 46,011 B，但 minify 后由 35,632 B 涨到 45,639 B（+10.0 KB / +28%），宿主 `client.js` 相应 +10.4 kB（+3.3%）。本条判据是**解析正确性与安全修复，不是字节数**。
- **为何不走「服务端用 `Bun.markdown` 预渲染」**（曾列候选，经核查证否）：四个使用点中三个的 source 是 `tt()` 的产物，而 `Manifest.description` 本身是多语言字典、当前语言存在客户端本地配置里——预渲染会把「切换界面语言」变成一次 RPC 重渲染；且 `Bun.markdown.html` 只产块级 HTML、无 inline 模式，与 `inline` prop 语义不对等，消毒责任也不会消失。
- 本轮复核：`marked` `^18.0.14` 实装即最新，`marked-vue` 已不在依赖树；工作区现有宿主产物 `client.js` 323.56 kB。

### 4.14 `k-markdown` 的手写消毒层换成 `dompurify`（`xss` 出仓）

§4.13 收回源码自持后，消毒层仍是上游 `marked-vue` 的手写实现——白名单过滤 + 自维护标签栈补闭合 + 手写 `<a>` 属性重建，自带 §4.13 查明的两处偏差。二者都无利用面，但暴露的正是「手写近似解析器」这一层本身的问题：嵌套、大小写、自闭合、属性引号形态都得自己覆盖，而这是 DOMPurify 这类库十余年攒下的攻击面知识。
- **候选对比（实测）**：`xss@1.0.15` 的 npm 最新版发布于 2024-03-03（属**发版停摆**而非「已弃用」），带 `commander` + `cssfilter` 两个依赖；DOMPurify 3.4.15 发布于 2026-09-06，维护 640K 下游、有专门的安全邮件列表、**零运行时依赖**。产物体积（minify）：`xss` 18,786 B → `dompurify` 29,354 B（**+10.3 KB / +56%**，本次替换的主要代价）。**更正一处早先误判**：上一版曾称「换掉 `xss` 可顺带去掉其拖入的 `commander`（浏览器产物里的死重）」，实测不成立——`commander` 只从 `bin/xss` CLI 进来，不进产物，它只是安装图包袱。
- **测试环境是本次真正的成本**：DOMPurify 是 DOM-only 库，`bun test` 下无 DOM 时 `isSupported === false` 且 `sanitize` 为 `undefined`。三种垫片实测：**linkedom** 的 `isSupported` 为 `undefined` 且**静默返回未消毒原文**（`onerror` 原样留着，最危险的失败模式）；**happy-dom** 谎报 `true`，同一配置下 30 条本仓输入里 **27 条**与 jsdom 分歧且方向是「把所有元素都剥光」（消毒器整体不工作）；**jsdom** 行为全部正确。本条是**验消毒器**，垫片自身即可信基的一部分，必须是保真度参照物——用会谎报的垫片只能产出「全绿但无意义」的假绿（这也不构成对「未来 Vue 组件测试预设 happy-dom」的推翻：那是验 DOM 形状与事件的场景，两种测试要求不同）。垫片只进 devDependencies、**不进任何产物**，生产侧跑的是浏览器真 DOM。
- **行为变更 7 处、均为「更正确」**：`<script>x</script>` 由 `x</script>` 变 `""`（修掉游离闭标签）、孤儿闭标签由转义显示变 `""`、标签名归一（`<B>x</B>` → `<b>x</b>`）、非法协议 href 由降级为 `#` 变**整体剔除该属性**（不再伪造假链接）、属性值内尖括号按 HTML 规范不再转义（经 round-trip 用例证否「会变成标签」）。测试文件增至 31 用例 / 60 断言，并新增一组「消毒输出的二次解析安全性」用例（只比对字符串不足以证明安全）。
- **一处必须显式关掉的默认（测试当场逮到）**：DOMPurify 的 `ALLOW_DATA_ATTR` / `ALLOW_ARIA_ATTR` 默认 `true`，会**绕过 `ALLOWED_ATTR` 的收敛**，使第三方插件描述能塞进任意 `data-*` / `aria-*`；本组件的白名单语义是「每个标签零属性、仅 `<a>` 的 href / title 例外」，故二者一并关掉。产品口径：**`img` 维持不放行**——三个非 unsafe 调用点中有两个渲染的是**市场里的第三方插件描述**，放行图片等于允许恶意插件以追踪像素泄露访客 IP，这是收紧而非沿用默认。实现上消毒实例**惰性创建**（顶层取 window 会在无 DOM 环境拿到降级实例），协议白名单写成 `ALLOWED_URI_REGEXP`（由 `allowedProtocols` 数组拼出，单一事实来源），各类混淆写法（实体、裸控制字符）会在 DOM 解析阶段先被解码归一、再落到该正则判定。
- 本轮复核：`dompurify` `^3.4.15` 实装 3.4.16 = 最新，`xss` 已出仓；`jsdom` + `@types/jsdom` 为各自 latest。

### 4.15 各条处置的判据统一，以及本节的编号契约

统一判据：**同一能力下换更少 / 更小 / 更可维护的依赖，换不动或换了更亏则保留**。§4.7 的 `semver` 属「换不动」；§4.9 的 `picomatch` 与 §4.12 的 `@noble/hashes` 属「换得动且净收益」；§4.10 的 CodeMirror 属「名数上升而体量下降」；§4.14 的 DOMPurify 属「体量上升而覆盖面与维护性上升」；§4.13 的 `marked-vue` 属「不是替换而是收回」——后三类都是**单一指标反向**，须把口径分开看（见 §3）。此外，`giget` → Bun 原生 `Bun.Archive`（koishi-create 的远程模板解包，registry 版本倒序比较局部改用 `Bun.semver.order`）与上游薄壳 `@koishijs/plugin-server-proxy` → 转发源 `@cordisjs/plugin-server-proxy`（去官方全家桶 9 包）亦属同类「净收益」处置，前者已整包出仓、后者使全仓上游名外部依赖归零。

**编号契约**：§4.9–§4.14 的编号自 2026-09 起被**源码注释**（`packages/web/components/src/{core,display}/markdown.ts`、`markdown.test.ts`）与**上游映射文档**（[../process/upstream.md](../process/upstream.md) 的 E 类「不移植项」）引用，**重写或重排本报告时须保持这些编号指向同一处置**；新增处置一律追加在 §4.15 之后（或另起 §4.x 尾号），不得插队挪用既有编号。

**冻结线指针**：本轮 [旧] 5 项与 [预] 1 项（`cordis` / `minato` / `@minatojs/sql-utils` / `@cordisjs/plugin-{http,server,server-proxy}`）全部挂在 Phase 5 重启条件上，纪律见 §2.A，实证与重启条件见 [upgrade-plan.md](upgrade-plan.md) Phase 5 节。

---

## 5. package.json 之外的技术栈（本轮实测）

- **TypeScript 三轨**：根 `typescript` 实为 `@typescript/typescript6@6.0.2` 别名（供 `@typescript-eslint/parser`，该别名包的 latest 即 6.0.2）；类型检查真身是 `@typescript/native`（= `typescript@7.0.2`，TS7 原生编译器，`bunx tsc` 双 project 串行：`tsconfig.json` node 侧 + `tsconfig.web.json` client 侧）；`.vue` 类型走 vue-tsc 3.3.11 影子基线闸门（自举钉版 TS 5.9.3 到隔离目录、必须 node 直跑、只拦新增）。
- **门禁与 CI**：`bun run check` 十段（§1）；CI 通过 turbo 执行 `//#build` → `//#build:console` → `//#check` → `//#test:ci`（任务图与 `globalPassThroughEnv` 见 [turbo.jsonc](../../turbo.jsonc)），远程缓存凭据走 OIDC，换取失败显式告警且不阻断门禁。
- **测试与覆盖率**：`bun run test`（= `bun test --isolate`，每文件独立 global 隔离跨文件 `mock.module`）本轮实测 **133 文件 / 1082 用例 / 2957 断言 / 0 失败 / 50.02s**（`--coverage` 形态 44.82–59.10s，视缓存）。覆盖率两个可复现口径：`bun test --coverage` 的文本报告 **All files 93.72% 行 / 96.1% 分支**；`bun run test:ci` 产出的 lcov 聚合为 **206 文件 / 16576 行命中 17815 行 = 93.05%**，排除 `tooling/` 与 `client/vendor/` 后 195 文件 / **94.15%**，仅 `packages/**/src` 与 `plugins/**/src` 为 169 文件 / **94.31%**。上版「约 97% 行（src 源码口径）」在本轮两条命令下**均无法复现**（上版未记录命令与过滤条件），故本版以可复现口径入档；`bunfig.toml` 已跳过测试文件本身并忽略 lib/dist/node_modules。
- **基线台账**：vue-tsc 影子基线 **31 条**（`tooling/checks/vue-types-baseline.json`，2026-09-25 重生成，vue-tsc 3.3.11 + TS 5.9.3）；`as unknown as` 断言基线 **17 处**（`tooling/checks/assertions-baseline.json`，2026-09-21，pending 0）。两处闸门均只拦新增。
- **锁文件规模**：`bun.lock`（lockfileVersion 2）的 `packages` 段共 **781 条解析项**，其中非 `@koishi-ce/*` 者 **729 条**；同名多版本以 `父包/包名` 嵌套键表达，共 **40 条**（唯一由本仓声明面引起的是 §4.1 的 builder→typescript 5.9.3）。
- **版本管理与发布**：changesets（`.changeset/`）+ `tooling/release` 链（preflight → version → build → test → publish → push），npm 侧已迁 OIDC 可信发布；**禁止手动 `npm publish`**。
- **依赖更新机制（本轮新增入档）**：Dependabot（[.github/dependabot.yml](../../.github/dependabot.yml)）每周一 09:00（Asia/Shanghai）提 minor/patch 与安全更新；`ignore` 显式屏蔽冻结线（cordis / minato / @minatojs/* / @cordisjs/* / @cordiverse/* / @satorijs/* / cosmokit）、上游名（@koishijs/*）、CE 内部互引（@koishi-ce/*）、npm: alias 双版本载体（typescript / @typescript/native）与全部 major（major 一律人工评估；ignore 不作用于 security updates）。已知上游缺陷：dependabot-core 的 updater 镜像内 Bun 版本不跟随仓库 `packageManager`，会把 v2 锁文件静默降级重写，故 CI 的 gate job 设有**仅对 Dependabot PR 生效**的锁文件格式守门。
- **上游巡检**：`bun run upstream:audit`（`tooling/upstream-audit/`）+ [../process/upstream.md](../process/upstream.md) 映射表手动 diff 移植，port 进来的相对导入须补 `.ts` 扩展名。

---

## 6. 结论与可执行项

1. **两世界格局未变，独立工具链已全面追平**：非冻结依赖的实装版本**全部等于 registry `latest`**（[缓] 归零），TS7 / vite 8 / unocss 66 / echarts 6 / vue 3.5.43 / vue-router 5 / vue-i18n 11 / element-plus 2.14.7 / CodeMirror 6 全线均在最前沿；cordis 生态仍确认长期冻结在 3.x 内洽线。
2. **依赖面已无「存量欠账」**：79 名中 71 [新]、5 [旧] 与 1 [预] **全部**挂 Phase 5 冻结线，0 [废]、0 [缓]；唯一非冻结线的落后项是 §4.1 的死声明（属清理项而非升版项）。
3. **剩余空间收窄到「声明卫生」**：死声明 1 处（P1）、`vue` 一组同字段多形态 range（P2）、覆盖率口径（P2）。结构性升版须待 Phase 5 解冻后与 cordis 4 迁移合并进行。
4. **本轮新增的三条机制性变化已入档**：CI 改由 turbo 执行（OIDC 远程缓存）、门禁扩到十段、Dependabot 上线并带冻结线 ignore。

**可执行项清单**

| 优先级 | 项 | 验收判据 |
|---|---|---|
| P1 | 删除 `packages/web/builder` 的 `typescript ^5.0.0` 死声明 | 重装后 `bun.lock` 不再出现 `@koishi-ce/console-builder/typescript` 嵌套项；`bun run build` + 宿主前端重建 + `bun run check` + `bun test` 全绿 |
| P2 | 收敛 `vue` / `vue-i18n` / `vue-router` / `element-plus` 的同字段多形态 range | 各包声明面单形态；实装版本不变；`bun run check` + `bun run build` 全绿 |
| P2 | 覆盖率口径固化（命令 + 过滤条件写进文档/CI 注释） | 文档记录的命令可复现实测数字（`bun test --coverage` 93.72% 行；lcov 全量 93.05% / 排除 tooling 与 vendor 94.15%） |
| P3 | 收敛「带日期的快照数字」到本审计文档单一事实源（AGENTS.md / architecture.md 内仍留有 2026-09-20 的测试计数与 97% 覆盖率等旧快照） | 各文档只保留方法与指针，具体数字统一指向本文档 §5 |
| P3 | 保持「名数与体量分口径」的读法（§3） | 后续依赖变更说明中同时给出名数与产物体积 |

---

## 7. 审计方法与复现口径

本版数字由脚本化全量对拍产出，四步均可用仓库内工具复现：

1. **声明面**：遍历仓库内全部 `package.json`（排除 `node_modules`），读四个依赖字段，剔除 `workspace:*` 与 `@koishi-ce/*` 内部互引后按名字去重 → 得 79 名与各名的全部 range 形态。
2. **实装面**：读 `bun.lock` 的 `packages` 段（**每个名字一条顶层解析项**；同名多版本以 `父包/包名` 嵌套键表达）→ 得实装版本与嵌套副本清单。
3. **上游面**：逐个拉取 `https://registry.npmjs.org/<name>`，取 `dist-tags.latest` 与该版本清单字段（本轮 79/79 命中，无镜像兜底）→ 得「最新」列与 `deprecated` 判定。
4. **对拍**：按 semver 比较实装与最新（major / minor / patch / 预发布）分类；再与冻结线白名单（§4.7）交叉，得到 §3 的新鲜度计数。基线数字（测试、覆盖率、闸门基线、锁文件规模）取自对应的 `bun run` 命令与仓库内基线文件。

**口径陷阱（本轮踩到并记录）**：

- `node_modules/.bun/` 目录**含历史安装残留**（例如已不在锁文件解析结果里的 `vue@3.5.42` / `element-plus@2.14.5` / `unocss@66.10.2` / `dompurify@3.4.15` 仍留在磁盘上），**不可**用作「当前依赖图」的依据；实况一律以 `bun.lock` 的 `packages` 段为准（同名前缀的 `file-type@16.5.4` 反而是**现役**项——它由 `@cordisjs/plugin-http` 嵌套引入，正说明「磁盘上有旧版本号」与「它是残留」不能划等号）。
- registry 的缩写元数据（`application/vnd.npm.install-v1+json`）**不含 `time` 字段**，故本版不列「最新版发布时间」；需要发布日期时应拉全量元数据。
- `npm:` alias 形态（`typescript` / `@typescript/native`）的 registry 名字是 alias 右侧的真包名，直接按 alias 左侧查询会 404——比对时须先展开 alias。
- 名数口径会因「一能力多包」的生态切分（CodeMirror 6）或「一包多功能」的拆分/合并而失真，**不得单独用来判断依赖健康度**（§3）。
