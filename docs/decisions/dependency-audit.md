# 依赖与技术栈全量审计报告

> **状态：现势快照（2026-09-19）**。初版审计（2026-08-27，99 个外部依赖，升级计划立项前基线）已随 git 历史归档；其行动方案（[upgrade-plan.md](upgrade-plan.md)）的 Phase 0-4 已全部执行完毕，本文档即执行后的对账基线。Phase 5（cordis 4 跳代）冻结中，重启条件见 upgrade-plan Phase 5 节。日常现状以 [../guides/development.md](../guides/development.md) 与 [../reference/architecture.md](../reference/architecture.md) 为准。
>
> 审计日期：2026-09-22 · 「最新」列均于 2026-09-19 经 npm registry 实时验证（npmjs 主查、npmmirror 兜底）
> 运行环境：Bun 1.4.2（`packageManager` 钉定）· Node v24（辅：TS7 编译器与 vue-tsc 影子闸门宿主）· 包管理：Bun workspaces（`bun.lock`）
> 范围：仓库内全部 **53 个 package.json**（**52 个 workspace 包** + 根）· **75 个外部依赖名**（不含 `workspace:*` 与 `@koishi-ce/*` 内部 peer 互引，后者单列于 §2.G）
>
> 修订：2026-09-22 —— ①-⑤ 延续 2026-09-21 的依赖收敛记录；⑥ `create-koishi-ce` 的远程模板解包由 `giget` 换为 Bun 1.4.2 原生 `Bun.Archive`，registry 版本倒序比较局部改用 `Bun.semver.order`；⑦ `k-markdown` 组件由 npm 包 `marked-vue` 就地 vendor 为本地实现（见 §4.13），声明面换成 `marked` + `xss` 两个直接依赖（名数 74 → 75）；⑧ 同日落地方案 B 之 B1，`marked` 9.1.6 → 18.0.14（见 §4.13），**非冻结 major 就此清零**（[旧] 5 → 4）；⑨ 同日续落地方案 B 之 B2，手写消毒层换成 `dompurify` 3.4.15（`xss` 出仓，见 §4.14），另引入测试期 `jsdom` + `@types/jsdom`（名数 75 → 77）。已按 §2 / §3 对账；其余内容仍为 2026-09-19 快照。

状态图例：[新] 当前最新 · [缓] 落后(minor/patch) · [旧] 落后(major) · [预] 最新版本为预发布 · [废] 已弃用或未使用

---

## 1. 项目定位与结构

本项目是 [koishijs/koishi](https://github.com/koishijs/koishi)（MIT）与 [koishijs/webui](https://github.com/koishijs/webui)（部分 AGPL-3.0）的文件级合并仓，npm 作用域 `@koishi-ce`，运行时目标 **Bun**（Node 不作兼容目标）。初版审计时「yarn + yakumo → Bun 原生」的迁移工作已全部完成：yakumo 移除、构建统一为根 tsdown 单遍 ESM-only、测试迁移 bun:test、版本管理走 changesets + 自研发布链。

```
Koishi-CE/
├── packages/node/      运行时核心 8 包:koishi(CLI入口) core loader console utils i18n-utils assets registry
├── packages/web/       前端基础 2 包:client(构建API+宿主前端) components
├── packages/shim/      下游 npm alias 占名 4 包:koishi-shim(4.18.11) console-shim / client-shim(5.30.11) components-shim(1.5.22)——版本冻结勿动
├── plugins/common/     通用插件 9:assets-local bind broadcast callme cron echo help inspect rate-limit
├── plugins/infra/      基础设施 8:http proxy server(vendored 预编译) hmr memory mock server-temp sqlite
├── plugins/webui/      控制台插件 19:actions admin analytics auth commands config console dataview
│                       explorer insight locales logger market notifier oobe sandbox status
│                       theme-vanilla welcome
├── apps/               koishi-create(脚手架,包名 create-koishi-ce) koishi-scripts(@koishi-ce/scripts)
├── tooling/            checks(门禁脚本) release(发布链) sandbox(沙盒实例生成) upstream-audit(上游巡检)
└── docs/               guides / reference / decisions / process
```

关键结构事实（相对初版的变化不再逐一标注，初版原文见 git 历史）：

- **CI 已建立**：`.github/workflows/ci.yml` 三 job——gate（build → 宿主前端 → check → test + lcov 上传 Codecov）、client（全部 webui 插件前端 bundle）、fallow（死代码与依赖审计）；另有 triage.yml 自动分诊（issue 指派 / PR 路径打标）。
- **门禁八段齐备**：`bun run check` = biome lint + eslint(.vue) + TS7 双 project 类型检查 + locales / docs-links / vue-types / assertions / packages 五个自研闸门（脚本居 `tooling/checks/`）。
- **peerDependencies 已全面 CE 化**：内部互引一律 `@koishi-ce/* ^1.0.0`（初版保留的上游名 `koishi ^4.18.11` peer 已清零）；唯一上游名残留是 console 的类型引用 `@koishijs/plugin-server-proxy`（dev，测试用）。
- **vendored 三包不动**：`plugins/infra/{http,proxy,server}` 为预编译产物包（无 `src/`，根 tsdown 显式 exclude），内联再导出 `@cordisjs/plugin-*`。
- **shim 四包占名**：`packages/shim/{koishi-shim,console-shim,client-shim,components-shim}` 是下游 npm alias 的占名目标，纯 JS 预编译、版本冻结跟随上游线、changesets ignore。
- **版本自主演进**：workspace 包走 1.x 线（core 1.1.6 / plugin-console 1.3.5 / client 1.3.1 等），不再镜像上游版本号；发布一律走 `bun run release` 链，禁止手动 `npm publish`。
- 客户端构建仍无 vite 配置文件，全部编程式 `vite.build()`（宿主入口 `packages/web/client/src/bin.ts`，插件可自带 `build/client.ts` 覆盖配置）。

---

## 2. 外部依赖全量清单（按业务范围分类）

### A. cordis / koishi 生态运行时（冻结 3.x 内洽线）

| 包 | 声明 | 使用位置 | 业务范围 | 最新 | 状态 |
|---|---|---|---|---|---|
| cordis | ^3.18.1 | core / web-client / proxy / server | 依赖注入容器 + 插件生命周期内核 | 4.0.0-rc.10 | [预] 冻结 3.x |
| minato | ^3.7.0 | core / memory / sqlite | ORM / 数据库抽象层 | 4.0.1 | [旧] 冻结 3.x |
| @minatojs/sql-utils | ^5.6.0 | sqlite | 数据库迁移工具 | 6.0.0 | [旧] 冻结（minato 4 线） |
| @cordisjs/plugin-http | ^0.6.3 | http(vendored) | HTTP 客户端上下文(`ctx.http`) | 1.5.2 | [旧] 冻结（内联再导出） |
| @cordisjs/plugin-server | ^0.2.9 | server(vendored) | HTTP/WS 服务上下文(`ctx.server`) | 1.7.0 | [旧] 冻结（内联再导出） |
| @cordisjs/plugin-proxy-agent | ^0.3.3 | proxy(vendored) | 网络代理支持 | 0.3.3 | [新] |
| @satorijs/core | ^4.6.0 | core | 聊天协议内核（会话/机器人抽象） | 4.6.0 | [新] |
| @satorijs/element | ^3.2.0 | components / notifier / sandbox | 消息元素树 / KQL 模型 | 3.2.0 | [新] |
| @satorijs/protocol | ^1.7.0 | web-client | 协议数据结构类型 | 1.7.0 | [新] |
| @satorijs/components-vue | ^0.7.8 (dev) | sandbox | 消息元素 Vue 渲染（测试用） | 0.7.8 | [新] |
| cosmokit | ^1.8.1 | 10 处（core/utils 系 + web 系 + memory/sqlite/market） | 生态通用工具箱 | 1.8.1 | [新] |
| reggol | ^2.1.0 (dev) | logger | 生态日志库（logger 前端渲染） | 2.1.0 | [新]（初版 1.7.1 → 已升 2.x） |
| inaba | ^1.1.1 | utils | 随机数据生成 | 1.1.1 | [新] |
| fastest-levenshtein | ^1.0.16 | core | 编辑距离（命令纠错建议） | 1.0.16 | [新] |
| @koishijs/plugin-server-proxy | ^1.2.0 (dev) | webui console 宿主 | 代理支持（仅类型引用） | 1.2.0 | [新]（全仓唯一上游名导入例外） |

**冻结纪律**：cordis / minato / @cordisjs 生态整体钉在 3.x 内洽线（Phase 5 已实证被 `@satorijs/core` 阻塞并整体回退）。本表 [旧] 状态属刻意落后、**不是升级欠账**，勿在线内单独升版；重启条件见 [upgrade-plan.md](upgrade-plan.md) Phase 5 节。

### B. 前端 UI 栈（已整体追平主流）

| 包 | 声明 | 使用位置 | 业务范围 | 最新 | 状态 |
|---|---|---|---|---|---|
| vue | ^3.5.42 / peer ^3 / dev ^3.5.12 | client + components + 5 插件(dev) | UI 框架 | 3.5.43 | [缓] patch（range 三形态待统一） |
| vue-router | ^5.2.0 | client + 4 插件(dev) | 控制台路由 | 5.3.1 | [新]（4→5 已升） |
| vue-i18n | ^11.4.10 | client + market(dev) | 界面国际化 | 11.4.12 | [缓] patch（9→11 已升） |
| @vueuse/core | ^15.0.0 | client + 4 插件(dev) | Vue 组合式工具集 | 15.0.0 | [新]（14→15 已升，见 §4.11） |
| element-plus | ^2.14.5 | client + config / explorer / locales | UI 组件库 | 2.14.6 | [缓] patch（2.7.7 精确锁已解锁） |
| schemastery-vue | ^7.3.15 | components | 配置 Schema → 表单渲染 | 7.3.15 | [新] |
| marked | ^18.0.14 | client | Markdown 解析内核（k-markdown 组件，见 §4.13） | 18.0.14 | [新]（2026-09-22 随 §4.13 的 vendor 收回解钉并升版） |
| dompurify | ^3.4.15 | client | HTML 消毒（k-markdown 非 unsafe 模式，见 §4.14） | 3.4.15 | [新]（2026-09-22 由 `xss` 换入，见 §4.14） |
| unocss | ^66.8.1 | client(构建脚本) | 原子化 CSS 引擎 | 66.10.5 | [缓] patch（0.65→66 已升） |
| echarts | ^6.1.0 (dev) | analytics | 数据可视化图表 | 6.1.0 | [新]（5→6 已升） |
| vue-echarts | ^8.1.0 (dev) | analytics | echarts 的 Vue 封装 | 8.3.0 | [新]（6→8 已升，range 内最新） |
| ansi_up | ^6.0.6 (dev) | logger(client) | ANSI 转义 → HTML | 6.0.6 | [新]（5→6 已升） |
| d3-force | ^3.0.0 (dev) | insight | 关系图谱力学布局 | 3.0.0 | [新] |
| monaco-editor（已移除） | — | explorer | 代码/文本编辑器 | — | [废] 2026-09-21 被 CodeMirror 6 取代（见 §4.10） |
| codemirror + `@codemirror/*`（18 名） | ^6.x 线 (dev) | explorer | 编辑器内核 + 语言语法，清单见 §4.10 | 6.x | [新]（2026-09-21 整体取代 monaco-editor） |
| lottie-web | ^5.13.0 (dev) | welcome | Lottie 动画（开屏描线） | 5.13.0 | [新]（welcome 插件新增） |
| @noble/hashes | ^2.4.0 (dev) | market | MD5（gravatar 头像摘要，`legacy.js` 的同步实现） | 2.4.0 | [新]（2026-09-21 由 spark-md5 换入，见 §4.12） |

### C. 构建与打包工具链

| 包 | 声明 | 使用位置 | 业务范围 | 最新 | 状态 |
|---|---|---|---|---|---|
| vite | ^8.2.2 | client + 3 插件(dev) | 前端构建（编程式 `vite.build()`） | 8.3.0 | [新]（5→8 已升，range 内最新） |
| @vitejs/plugin-vue | ^6.0.8 | client | Vue SFC 编译插件 | 6.0.9 | [缓] patch |
| sass-embedded | ^1.102.0 | client | SCSS 编译（替代 dart-sass） | 1.104.1 | [新] |
| tsdown | ^0.23.0 | root | node 侧单遍构建（替代 yakumo） | 0.23.0 | [新] |
| typescript | npm:@typescript/typescript6@6.0.2 | root(dev) | TS 6 载体（供 @typescript-eslint/parser） | 6.0.2 | [新] |
| @typescript/native | npm:typescript@7.0.2 | root(dev) | TS7 原生编译器（类型检查真身） | 7.0.2 | [新] |
| typescript | ^5.0.0 | web-client | **源码零导入**，疑上游残留（见 §4.1） | — | [废] 存疑 |
| @biomejs/biome | ^2.5.10 | root | Lint + Format 唯一权威 | 2.5.14 | [缓] patch（装 2.5.13） |
| eslint + eslint-plugin-vue + @typescript-eslint/parser + vue-eslint-parser | ^10.9 / ^10.10 / ^8.68 / ^10.4 (dev) | root | 仅 .vue 模板语义 lint（biome 只解析 script） | 10.11.0 等 | [缓] minor（eslint 本体） |
| @babel/code-frame | ^8.0.0 | hmr | 构建错误源码帧（Bun BuildMessage position） | 8.0.6 | [缓] patch（7→8 已升） |
| @parcel/watcher | ^2.6.0 | hmr | 文件监听原生绑定（替代 chokidar） | 2.6.0 | [新] |
| @changesets/cli | ^3.0.1 | root | 版本与 changelog（配 tooling/release 链） | 3.0.3 | [缓] patch（装 3.0.2） |

### D. CLI 脚手架与系统交互

| 包 | 声明 | 使用位置 | 业务范围 | 最新 | 状态 |
|---|---|---|---|---|---|
| cac | ^7.0.0 | cli | 轻量 CLI 框架 | 7.0.0 | [新]（6→7 已升） |
| @clack/prompts | ^1.7.0 | koishi-create | 交互式提示（替代 prompts） | 1.8.1 | [缓] patch（装 1.8.0） |
| picocolors | ^1.1.1 | koishi-create + cli | 终端着色（替代 kleur） | 1.1.1 | [新] |
| open | ^11.0.1 | console | 打开浏览器 | 11.0.4 | [缓] patch（8→11 已升，装 11.0.3） |
| chardet | ^2.2.0 | explorer | 文本编码检测 | 2.2.0 | [新] |
| file-type | ^22.0.2 | assets / assets-local / explorer | 文件类型嗅探 | 22.1.1 | [缓] patch（16→22 已升，装 22.1.0） |
| picomatch | ^4.0.7 | explorer（此前已由 vite / tsdown 等经传递依赖引入） | glob 匹配（文件树过滤） | 4.0.7 | [新]（2026-09-21 由 anymatch 换入，见 §4.9） |
| semver | ^7.8.5 | registry / market | 语义版本计算 | 7.8.5 | [新]（两形态已统一） |

### E. 测试设施

初版审计中的 mocha / @types/mocha / chai / chai-as-promised / chai-shape / @sinonjs/fake-timers 已于 2026-09-02 前整体退役，断言统一 `bun:test` 原生 `expect`，时间模拟用其内建 mock timers。现为两个运行时类型包 + 一组 DOM 垫片（随 §4.14 引入）：

| 包 | 声明 | 使用位置 | 业务范围 | 最新 | 状态 |
|---|---|---|---|---|---|
| @types/bun | ^1.4.0 | root(dev) | Bun 运行时类型（薄封装，转发 bun-types） | 1.4.2 | [新] |
| @types/node | ^26.4.0 | root(dev) | Node 类型（TS 编译器与工具宿主） | 26.6.2 | [缓] minor（装 26.5.1） |
| jsdom | ^30.1.1 (dev) | web-client | DOMPurify 的服务端 DOM 垫片，**仅测试期**（§4.14） | 30.1.1 | [新]（2026-09-22 随 §4.14 新增） |
| @types/jsdom | ^30.0.0 (dev) | web-client | jsdom 的类型（jsdom 自身不带类型） | 30.0.0 | [新]（同上） |

### F. 类型包杂项

`@types/d3-force`（insight）、`@types/semver`（registry / market）、`@types/picomatch`（explorer，§4.9）——随主包同步即可。初版点名的 `@types/uuid` / `@types/tar` 弃用问题已随死依赖清理消失。

### G. CE 内部 peer 面（非外部依赖，单列对账）

| 包 | 声明 | 声明处 | 对应 workspace 实体 |
|---|---|---|---|
| @koishi-ce/koishi | ^1.0.0 (peer) | 39 处（全部 node / infra / webui 插件 + koishi-shim 占名） | packages/node/cli（1.0.18） |
| @koishi-ce/plugin-console | ^1.0.0 (peer) | 19 处（webui 插件 + console-shim 占名） | plugins/webui/console（1.3.5） |
| @koishi-ce/console | ^1.0.0 (peer) | notifier / theme-vanilla / welcome | packages/node/console（1.1.0） |
| @koishi-ce/loader | ^1.0.0 (peer) | hmr / config | packages/node/loader（1.1.1） |
| @koishi-ce/core | ^1.0.0 (peer) | loader | packages/node/core（1.1.6） |
| @koishi-ce/client | ^1.0.0 (peer) | console | packages/web/client（1.3.1） |
| @koishi-ce/assets | ^1.0.0 (peer) | assets-local | packages/node/assets（1.0.2） |

peer 声明用于下游 `bun add` 解析与防 Bun 自动装官方包，指向 CE 名是硬性约束（AGENTS.md 硬性约束 1-2），**不是升级对象**。

---

## 3. 新鲜度总览（77 名，registry 实测）

| 类别 | 数量 | 代表 |
|---|---|---|
| [新] 已是最新 | **58** | vite 8.3 / TS 7.0.2 / unocss 66 / echarts 6 / vue-router 5 / vue-i18n 11 / @vueuse 15 / dompurify 3.4.15 / CodeMirror 6 全线 18 名 |
| [缓] 落后 minor/patch | 13 | eslint、@types/node、element-plus 及 10 个 patch 漂移 |
| [旧] 落后 major | **4** | minato、@cordisjs/plugin-{http,server}、@minatojs/sql-utils——四项全属 cordis 3.x 内洽冻结线（@vueuse 14→15 见 §4.11、marked 9→18 见 §4.13，均已升版转 [新]） |
| [预] 最新为预发布 | 1 | cordis（4.0.0-rc.10，冻结线） |
| [废] 弃用/死依赖 | **0** | `giget` 已随 2026-09-22 的 Bun.Archive 原生化移除，monaco-editor 亦已随 §4.10 的编辑器替换移除；当前无废弃依赖存留 |

对比初版（2026-08-27）：外部依赖 **99 → 77（-22%）**；[旧] **38 → 4**；[废] 4 → 0。减量主要来自死依赖清理、Node 生态 API 的 Bun 原生化替换与测试栈退役；本轮 `xss` → `dompurify` 是 1 换 1，名数回升全部来自测试期的 DOM 垫片。

**名数回升的来源有三处**：§4.10 的编辑器替换（-1 +18）、§4.13 的 vendor 转正（-1 +2）与 §4.14 的 DOM 垫片（+2，仅测试期）。CodeMirror 6 生态按「一个语言一个包」切分，18 个包里 11 个是单一语言语法；同期 explorer 前端产物由 13.55 MB 降到 0.72 MB、物理包数由 97 降到 23。**前者需要把「依赖名数」与「实际代码量」两个口径分开看**，§4.14 的垫片同理（不进任何产物），其余升降仍按名数口径解读。

注：`typescript` 在 web/client 的 ^5.0.0 声明源码零导入（§4.1），上表口径中其 root 侧别名形态已计入 [新]，此存疑项不重复计数。

---

## 4. 声明与实际使用一致性

1. **死依赖存疑**：`typescript ^5.0.0` 声明于 `packages/web/client`（dependencies），全仓源码零导入；vue-tsc 影子闸门用的 TS 5.9.3 是自举安装到 `node_modules/.cache/vue-tsc-shadow` 的钉版载体，与此声明无关。删除前须重建宿主前端实证（前端链假绿判例见 development.md §7）。
2. **fallow 红点已清零**：本快照初稿点名的两处未用导出（market dependencies/service.ts 的 `default` 导出、installer 的 `Dependency` re-export 类型）已随 9925a74 清除，dead-code 退出码 0。
3. **range 漂移**（无害、待统一）：`vue` 三形态（client ^3.5.42 / components peer ^3 / 五插件 dev ^3.5.12）。`semver` 两形态（registry ^7.8.5 / market ^7.6.3）已于 2026-09-21 统一为 ^7.8.5（该依赖不能改用 `Bun.semver` 平替，理由见第 7 条）。
4. **无幽灵依赖**：初版的 unlisted 问题（apps/online 靠 hoisting 存活）已随该目录删除消失，fallow unlisted 检查通过。
5. **声明但无静态导入的正当豁免**（`.fallowrc.jsonc` ignoreDependencies，非死依赖）：vendored 三包（插件加载链按包名运行时解析）、shim 四包（下游 alias 占名）、webui 插件 dev 依赖（测试/构建期按名加载）、前端 vue 系（由宿主与工作区根提供）、sass-embedded 与 @typescript/native（构建期编程式加载/路径调用）。
6. **peerDeps 指向 CE 名属硬性约束**（见 §2.G），非缺陷。
7. **`semver` 依赖不可去除**（2026-09-21 评估）：`Bun.semver` 仅暴露 `satisfies` / `order` 两个函数（[官方文档](https://bun.com/docs/runtime/semver) 明言「需要其他 semver 函数请提 issue」），实测在四处关键语义上不覆盖——
   - market 的 client 侧（`client/components/install.vue` 用 `parse`、`client/components/utils.ts` 用 `compare` / `satisfies`、`client/dependencies/ignore-policy.ts` 用 `gt` / `prerelease`、`client/utils.ts` 用 `gt`）运行在浏览器，**无 `Bun` 全局**，且与 node 侧共用同一 package.json——依赖无论如何删不掉。
   - `registry` 的 `intersects`（两个 range 的相交判定，`Scanner.isCompatible` 的兼容性核心）无对应 API，自研 range 相交算法风险远大于收益。
   - `valid` 与 `Bun.semver.satisfies(x, "*")` **不等价**：`"=1.2.3"` 前者 null / 后者 true，`"1.2.3-beta.1"` 前者有效 / 后者 false——`installer` 与 `snapshot` 的 `!valid(request) → invalid` 判定会静默走偏（假绿）。
   - `satisfies` 的第三参 options 被 Bun 忽略：`installer/index.ts` 的 `{ includePrerelease: true }` 实测无效（node-semver true / Bun false）。
   `compare` / `gt` 可由 `order` 平替，其余函数（`intersects` / `valid` / `prerelease` / `parse`）全无平替；依赖为单包零传递依赖，保留成本可忽略。
8. **`bun-types` → `@types/bun` 已迁移**（2026-09-21，root / 脚手架模板 / koishi-scripts 白名单一并改）：先纠正常见误传——`bun-types` **并未被废弃**（npm 上无 `deprecated` 标记），`@types/bun@1.4.2` 的 `index.d.ts` 全文只有一行 `/// <reference types="bun-types" />`，且其唯一依赖就是 `bun-types@1.4.2`；断言「两者并存会引发全局命名空间污染」不成立，因为**类型内容按构造完全相同**。迁移的真实理由是**跟随 Bun 官方约定**：Bun docs 写 `bun add -d @types/bun` + `"types": ["bun"]`，本机 `bun init` 实测生成的也是 `@types/bun`（且 `node_modules` 里 `bun-types` 依旧在场，只是降为传递依赖）。迁移后类型检查与全部门禁实测无差异；副作用是 tsconfig 的 `types` 从 `"bun-types"` 改为 `"bun"`（`@types/*` 的隐式前缀），**已确认全仓各 tsconfig 均显式声明 `types`，`node_modules/@types/` 下的自动包含不会波及 client 侧**（`tsconfig.client.json` 为 `types: []`）。
9. **explorer 路径过滤：`anymatch` → `picomatch` 直连**（2026-09-21）：原依赖 `anymatch@3.1.3` 实现是 CJS 而 d.ts 为 ESM 形态，nodenext 类型视图对 `default` 多包一层，迫使源码保留一处 `as unknown as` 双重断言（断言基线台账内的 R2 条目）。改为直连 `picomatch@4.0.7`（该版本本仓早已由 vite / tsdown / tinyglobby 等经传递依赖引入，显式声明等于零新增物理包）后：`anymatch` / `normalize-path` / 其嵌套的 `picomatch@2.3.2` 三包一并出仓，双重断言随之清零（基线 18 → 17）——这是比对 `micromatch` 后的选择，理由见下方。行为经「多模式 × 13 输入」矩阵实测与 anymatch 逐条一致（含 win32 反斜杠路径与 `**/.*` 对 dotfile 的忽略）；唯一已知语义差异是 `!` 前缀模式——anymatch 视作「纯排除」（`["!**/foo"]` 全 false），picomatch 视作取反（除 foo 外全 true），explorer 的 `ignored` 不宣传该写法、存量亦无依赖。另记一处坑：**picomatch 4 只在显式传入 options 时才注入平台检测**（`index.js` 的 `options &&` 守卫），不传 options 即按 posix 处理、win32 反斜杠路径全部漏配，故源码显式声明 `windows: process.platform === "win32"`，不依赖该注入行为。**为何不选 `micromatch`**：其匹配内核即 picomatch v2，对 explorer 的全部能力需求（braces 展开 / `capture` / `scan` / `makeRe`）无一用得上；依赖面却是 +5 物理包（braces / fill-range / to-regex-range + 自带 picomatch v2），且惯用入口 `isMatch` / `any` 每次调用都重新编译模式——落到 `traverse()` 的逐目录项热路径上会退化为 N 次正则编译，要保住「编译一次」只能用类型仅接受单个 `string` 的 `matcher()`，适配成本反高于现状。
10. **explorer 编辑器：`monaco-editor` → CodeMirror 6**（2026-09-21）：动因是实测体积——monaco 打进 explorer 前端的产物为 **13.55 MB / 97 文件**，其中 `ts.worker` 6.91 MB、`css.worker` 1.07 MB、`html.worker` 0.74 MB、`json.worker` 0.43 MB（四个语言服务 worker 合计 **9.15 MB**）；而本插件自移植起就在运行期用 `setModeConfiguration` 把 css / json / typescript / html 的语言服务**全部关掉**、只留词法着色——即这 9.15 MB 属「付了钱不用」。且 `monaco-editor` 的 `.` 入口（`esm/vs/index.js`）会连带引入全部语言定义与四个服务注册模块，**仅改单处导入无法摘除**（试过只改 editor.ts 时体积纹丝不动；连 `client/index.vue` 的第二处导入一并换掉才降下来）。换 CM6 后同一构建为 **0.72 MB / 23 文件**（首屏静态可达 index.js 89 KB + 内核 chunk 315 KB + 35 KB + style.css 1.8 KB ≈ **431 KB**，其余 21 个语言 chunk 全部按需 `import()` 下载），语言覆盖从 monaco 时代事实上的「四种服务包 + 全套语言定义」转为 **21 种语法**（含 shell / TOML / Dockerfile / INI / Diff 等经 `@codemirror/legacy-modes` 包装的流式解析器）。
    - **代价与权衡（名数口径变差的唯一来源，见 §3）**：声明的依赖名由 1 个（monaco-editor）涨到 18 个——CM6 生态按「一个语言一个包」切分；但**物理体量同时大幅下降**：monaco-editor 解包 97.9 MB 且携带 dompurify / marked 两个传递依赖，CM6 全线 18 包落在 `node_modules` 里另仅约 **3 MB**（含 `@codemirror/view` 1.23 MB、`legacy-modes` 1.91 MB、`state` 0.43 MB），无 worker、无二进制。同能力下两个指标发生分离，本表保留名数口径并在此说明，避免后续读者误读为依赖膨胀。此外不再需要控制台侧为 monaco worker 做的根绝对路径兜底（兜底逻辑本身保留，见 `plugins/webui/console/src/node/assets.ts`）。
    - **清单**（均为 `plugins/webui/explorer` 的 devDependencies，前端产物由宿主构建期打包）：内核 `codemirror` / `@codemirror/{state,view,commands,language}` / `@codemirror/theme-one-dark`（暗色 token 配色）/ `@codemirror/legacy-modes`（CM5 流式解析器）；语法 `@codemirror/lang-{javascript,json,html,xml,css,sass,less,markdown,yaml,sql,vue}`。
    - **语言取舍：只收录 Koishi 生态真实会出现的类型**。Koishi 是纯 TS / JS 世界，后端语言（Python / Java / C-C++ / Rust / Go / PHP）**不可能出现在这个目录里**，初版一并列上的 6 种已子以剔除（连带 6 个依赖包）——保守目标（`languages.ts` 的 LANGUAGES 表）同时就是交付面，不存在的类型不会因为「反正按需加载」而免于付出声明与磁盘成本。删除只是删表项 + 删依赖，将来真需要时加回同理；`languages.test.ts` 已锁上这 8 个扩展名（含 `.c` / `.h`）必须回退纯文本。
    - **注意点**：`@codemirror/lang-vue` 仍在 0.x（0.1.3），其余均为 6.x 稳定线；语言的扩展名匹配与惰性加载集中在 `plugins/webui/explorer/client/languages.ts`，新增语言只需装包 + 在表内加一项（`load` 用动态 import，rolldown 自动切 chunk）；外观收敛为一组 `--cm-*` 变量（定义在 `client/editor.scss`，`theme-vanilla` 主题可覆写）。
    - **语言选取原则：只列 Koishi 目录里真会出现的类型**（Koishi 生态为纯 TS / JS 世界，后端语言不在考虑范围内）；**行为差异（相对 monaco，已知且有意）**：① 不再向 `window` 挂全局 `monaco` 命名空间（仓库内无消费者）；② 不再有语言服务（补全 / 悬停 / 诊断 / 格式化）——monaco 时代本就在运行期关着，CM6 侧保留 `basicSetup` 自带的括号匹配、自动补全（词法级）、搜索、折叠、多光标等基础能力；③ 支持的语言由 monaco 的 80+ 种转为 21 种精选（清单见上）。
11. **`@vueuse/core` 14 → 15**（2026-09-21）：全仓唯一一处非冻结线 major 升版，声明面 5 处（`packages/web/client` 为 dependencies，admin / explorer / insight / market 四插件为 devDependencies）由 `^14.4.0` 统一到 `^15.0.0`。升版前逐条核对上游 v15.0.0 破例点与本仓实际用量的交集：
    - **本仓用到的符号共 13 个**：`useWindowSize` / `useEventListener` / `usePreferredDark` / `useResizeObserver` / `useLocalStorage` / `RemovableRef`（仅类型）/ `useDebounceFn` / `watchDebounced` / `watchThrottled` / `useTimeoutFn` / `onKeyStroke` / `useElementSize` / `useThrottleFn`——15 的 `dist/index.d.ts` 全部仍在（其中 `useDebounceFn` / `watchDebounced` / `watchThrottled` / `useTimeoutFn` / `useThrottleFn` 经 `export * from "@vueuse/shared"` 暴露，与 14 同机制），零删除、零改名。
    - **`useThrottleFn` 的 `trailing` 默认值由 false 改为 true**——这是唯一与本仓有交集的破例点（`insight` 的 `watchThrottled` 构建在其上），但该调用**显式传了 `trailing: true`**（`plugins/webui/insight/client/index.vue`），行为与 14 时代逐字等价。
    - **移除的 deprecated timer options**（`interval` / `immediate` / `updateInterval` / `immediateCallback`）只作用于 `useCountdown` / `useElementByPoint` / `useMemory` / `useNow` / `useTimeAgo(Intl)` / `useTimestamp` / `useVibrate` / `useWebSocket` 八个本仓未使用的 composable；`useTimeoutFn` 的 `immediate`（market 慢加载提示在用）不在移除清单内。
    - **Drop `templateRef`** 与 **Drop Node 20** 两项无交集（前者本仓未用，后者运行时为 Bun / Node 24）。
    - **入口形态不变**仍为 `dist/index.js`（v14 起如此），宿主共享块 `vueuse.js` 的重新打包路径（`packages/web/client/scripts/client.ts`）无需改动；peer 仍为 `vue ^3.5.0`，与仓内 `vue ^3.5.42` 兼容。
    - **`element-plus` 的嵌套副本**：element-plus 2.14.5 对 `@vueuse/core` 是**精确锁 `14.4.0`**（非 range，且其上游尚未适配 15），故 `bun.lock` 新增 `element-plus/@vueuse/core@14.4.0` 嵌套项、`node_modules` 多出一份 14.4.0 副本（`@satorijs/components-vue` / `schemastery-vue` 的 peer 槽同理，peer range 宽故无约束冲突）。**运行时不受影响**：宿主构建对 `@vueuse/core` 既有硬别名（`packages/web/client/src/index.ts` 的 `alias` → `${root}/vueuse.js`）又有 `dedupe`，element-plus 内部对 vueuse 的调用（`useEventListener` / `useResizeObserver` / `useTimeoutFn` / `useThrottleFn` / `useElementBounding` / `clamp` / `refDebounced` 等）在浏览器里一律走宿主共享块的 15 版实现。**受影响面已逐条核对**：其中唯一躺在破例点上的 `useThrottleFn`，element-plus 的两处调用（`use-backtop` 的滚动监听、`image` 的懒加载）都**显式传了第三参 `true`**（trailing），故默认值翻转对它们无影响；其余符号在 15 全部保留。
    - **验证**：`bun run check` 八段全绿（TS7 双 project、vue-tsc 影子基线、断言基线均无新增）、`bun run build` 无错、`bun test` 1009 通过 / 2 失败——两个失败均为 `apps/koishi-scripts` 的 clone 非交互用例，其断言前提是「bun test 的 stdin 恒非 TTY」（`clone.ts` 的 `ask()` 直判 `process.stdin.isTTY`），本机终端为伪终端故实际落进 readline 等待；以 `< NUL` 重定向 stdin 复跑该文件 19/19 通过，与本次改动无交集。宿主前端重新构建后 `vueuse.js`（131.31 kB）与 insight 插件前端均正常产出。
12. **market 的 gravatar 摘要：`spark-md5` → `@noble/hashes`（同步 MD5）**（2026-09-21）：动因是包体卫生——`spark-md5` 是 2018 年后不再发布的 UMD 包、**不带类型**（仓内长期靠手写的 `plugins/webui/market/client/spark-md5.d.ts` 环境声明兜底），而 `@noble/hashes` 零依赖、原生 TS + ESM、无 worker 无二进制，且本仓早已因 `@paralleldrive/cuid2` 把它带在依赖树里（显式声明属「就地转正」）。
    - **刻意不换 SHA-256（本条的实证核心）**：gravatar 官方推荐 SHA-256，实测 `https://s.gravatar.com/avatar/<hash>.png?d=404` 对同一邮箱（`shigma10826@gmail.com`）的 md5 / sha256 摘要**均返回 200 且同为 4912 B 的同一张头像**——官方侧确实双支持。但**镜像侧不一定**：`https://cravatar.cn`（正是 `apps/koishi-create/src/template/env` 里 `GRAVATAR_MIRROR` 的默认值）对同一邮箱 `md5 → 200` / `sha256 → 404`，三次重跑稳定复现。换成 SHA-256 会让默认镜像下的头像**全部静默回落默认图**（`d=mp` 兜底不会报错），故维持 MD5。另一个保留同步实现的原因：`crypto.subtle` 只在安全上下文存在，局域网 HTTP 下为 `undefined`，而 noble 的 md5 是纯 JS 同步实现，正合该约束（这也是不选「异步 WebCrypto 换算法」的原因）。
    - **实现**：`import { md5 } from "@noble/hashes/legacy.js"` + `bytesToHex(md5(utf8ToBytes(email.toLowerCase())))`（**noble 2.x 的子路径必须带 `.js`**；`sha2.js` 才是 sha256，`legacy.js` 收纳 md5 / sha1 / ripemd160）。语义与 `spark-md5` 的 `hash()` 相同：UTF-8 编码后取小写 hex。
    - **等价性验证**：对「空串 / ASCII / 大写邮箱 / 非 ASCII 域名 / 代理对 emoji / 1000 字符长串 / 首尾空格」等 10 组输入逐条比对，`spark-md5` 与 noble 的 md5 输出**完全一致**；再把新实现以 `bun build --target=browser --format=esm` 打成**交付形态**（而非仅源码级 import）后复跑同一矩阵，仍逐条一致——后者是刻意补的环节，避免「源码看着对、打包后不对」的假绿。
    - **产物**：market 前端 `dist/index.js` **172,662 → 168,650 B（-4,012 B，-2.3%）**，产物中已无 `SparkMD5` 字样（`style.css` 24,811 B 不变）；noble 的 md5 路径单独打成 browser/ESM/minify 为 **4.84 KB**（未压缩 8.94 KB，含 `legacy.js` / `_md.js` / `utils.js` 共 5 个模块）。
    - **依赖面**：声明名数 1 换 1（不变）；物理包方面 `@noble/hashes@2.4.0` 顶替原先 hoist 的 `1.8.0`，`@paralleldrive/cuid2` 保留其嵌套 `1.8.0`。手写的 `spark-md5.d.ts` 环境声明随包删除（类型由包自带），仓内**再无任何声明依赖 `spark-md5`**。声明位置仍在 `plugins/webui/market` 的 devDependencies（前端产物由宿主构建期打包，与 `vue` / `@vueuse/core` 同口径）。
    - **验证**：`bun run check` 八段全绿（断言基线 17 处无变化）、`bun run build` 无错、`bun run fallow` 无问题、`bun test` 1009 通过 / 2 失败（仍是 koishi-scripts clone 非交互用例的本机 TTY 问题，`< NUL` 复跑 19/19 通过）。market 前端重新构建产出正常。
13. **`k-markdown` 改用就地 vendor 的本地实现（`marked-vue` 出仓）**（2026-09-22）：`k-markdown` 原先直接注册 npm 包 `marked-vue@1.3.0` 的默认导出。该包已停维护（`shigma/marked-vue` 最后一次提交是 2023 年的版本 bump，无 release、0 star），其全部价值只是把 `marked` 包成约 90 行的 Vue 组件加一段手写消毒，却把解析器**钉在 `^9.1.6` 永不前进**（caret 永远够不到 18.x）——而 `marked` 的更新几乎全是解析边界修复，长期停在 9 意味着持续吃旧 bug（依赖面的「声明名已是最新」与「包仍被维护」是两件事，本条也是审计口径的一个补白）。
    - **做法**：把上游 `src/index.ts` 整体 vendor 进 `packages/web/client/client/components/markdown.ts`（AGPL 目录，原档 MIT，已在 NOTICE 登记溯源），`marked` / `xss` 由 marked-vue 的传递依赖**转正为 `packages/web/client` 的直接依赖**（`^9.1.6` / `^1.0.15`）。相对上游仅两处非行为改动：`attrs: any` 改为 `Record<string, string>`（本仓显式 any 为 0），以及遮蔽外层 `html` 的局部变量改名 `anchor`。
    - **行为零变化**：props 语义（`source` / `inline` / `tag` / `unsafe`）、默认包裹标签与 `markdown` class、非 unsafe 模式下的消毒白名单、`<a>` 属性规范化（协议白名单、`rel` / `target` 加固、title 转义）与栈式补闭合全部逐字等价。新增 `client/components/markdown.test.ts`，以 **25 用例 / 49 断言**锁定该基线——它同时是后续换解析器与消毒器的对拍依据。
    - **顺带查明的两处上游怪癖（按现状锁定，均为惰性残留）**：① 白名单外标签的**开标签**被丢弃，但其**闭标签**因栈里已压入标签名而原样留下（`<script>x</script>` → `x</script>`、`<iframe>` → `</iframe>`）；② 标签名大小写不归一（`<B>x</B>` → `<b>x</B>`）。二者都无可利用面，但正说明这段手写消毒的覆盖面有限，是方案 B 的动因之一。
    - **另记一条使用面事实**：白名单刻意不含 `img`，故**非 unsafe 模式下 Markdown 图片会被整体丢弃**（`![alt](url)` 渲染成空段落），只有 `unsafe`（当前仅插件 usage 文档在用）才放行。这是上游既有语义，本次不改，但下游插件作者写 usage 文档时需知道。
    - **为何不走「服务端用 `Bun.markdown` 预渲染」**（曾被列入候选，经核查证否）：四个使用点中三个的 source 是 `tt()`（`useI18nText`）的产物，而 `Manifest.description` 本身是 `string | Dict<string>` 多语言字典、当前语言存在**客户端本地配置**里——预渲染会把「切换界面语言」变成一次 RPC 重渲染；且 `Bun.markdown.html` 只产块级 HTML、无 inline 模式，与 `inline` prop 语义不对等，消毒责任也只是从浏览器移到服务端而不会消失。故本条只做「收回源码」，不动渲染时机。
    - **依赖面与验证**：声明名数 2 换 1（`marked-vue` → `marked` + `xss`，净 +1）。`bun run check` 八段全绿（含 vue-tsc 影子基线与断言基线 17 处无新增）、`bun run build` 无错、`bun test` 新增 25 用例全过、`bun run fallow` 无问题；`packages/web/client/package.json` 的 `files` 已含 `client/`，产物分发不受影响（`marked` / `xss` 本就在宿主构建的 `dedupe` 与 `optimizeDeps.include` 清单内，构建链路无需改动）。
    - **方案 B 之 B1 已落地（2026-09-22，同日）**：解析器 `marked` **9.1.6 → 18.0.14**（声明 `^18.0.14`）。跨 9 个 major 的 changelog 确实全是解析边界修复，但输出 HTML 会变、属行为变更，故先做双装对拍：**72 条语料 × 块级/行内两模式**（涵盖 v9→v18 各条 fix 的触发场景）实测 **16 处差异，逐条核对后全部属上游解析修复**，无一处是本仓消毒层的前提变化。差异可归为四类：HTML 正确性（裸 URL 自动链接的 `href` 里裸 `&` 现转义为 `&amp;`）、安全（不再产出非法的链接套链接 `<a>` 嵌套）、CommonMark 合规（数字字符引用 `&#65;` 现解码为 `A`、`&#0;` 按规范给 U+FFFD）、块级修复（空列表项 / 空代码块多余换行 / ATX 标题闭合序列前的制表符 / 引用后接空列表 / 硬换行后的前导空白）；另含数条 O(n²) 回溯的 ReDoS 加固（regex 层，不影响输出）。
    - **B1 的代码改动只在类型面**：marked 9 把 `parse` 声明为 `typeof marked`（重载函数声明，最宽松的一条返回 `string`），只有 `parseInline` 是 `string | Promise<string>`——这正是上游只在后者加 cast 的原因；marked 18 把两者都改成三条调用签名（最宽松一条返回 `ParserOutput | Promise<ParserOutput>`），于是 `parse` 也回到联合类型，`sanitize(html)` 处出现 TS2345。修法是对三元表达式的结果**统一 cast 一次**（而非继续分支各写一个），同步更新注释说明「同步 | 异步」重载的由来。
    - **B1 验证与体积代价**：上述差异中可观测的部分已钉成 `markdown.test.ts` 的 4 组新用例，测试文件由 25 用例 / 49 断言增到 **29 用例 / 55 断言**；`bun run check` 八段全绿、`bun run build` 无错、`bun test` 128 文件 / **1040 用例全过**、`bun run fallow` 无问题、宿主控制台前端重新构建正常。**代价是字节数**：`marked.esm.js` 源码由 89,397 B 降到 46,011 B，但 minify 后反而由 **35,632 B 涨到 45,639 B（+10.0 KB / +28%）**（上游包体压缩率变差），宿主前端 `client.js` 相应由 310.68 kB 涨到 **321.05 kB（+10.4 kB / +3.3%，gzip 104.37 kB）**。这与 §4.10 的 CodeMirror 属同一类口径分离：**本条的判据是解析正确性与安全修复，不是字节数**；若后续要省这 10 KB，方向是 §4.13 开头那个被证否的候选（服务端预渲染）或换更小的解析器，而非退回 9.x。
    - **方案 B 之 B2 已落地（2026-09-22，同日）**：手写消毒层换成 `dompurify` 3.4.15、`xss` 出仓，详见下节。
14. **`k-markdown` 的手写消毒层换成 `dompurify`（`xss` 出仓）**（2026-09-22）：§4.13 收回源码自持后，消毒层仍是上游 `marked-vue` 的手写实现——白名单过滤 + 自维护的标签栈补闭合 + 手写 `<a>` 属性重建。**这段手写实现自带两处偏差**（§4.13 已查明：白名单外标签的闭标签残留、标签名大小写不归一）。二者都无可利用面，但暴露的正是「手写近似解析器」这一层本身的问题：嵌套、大小写、自闭合、属性引号形态都得自己覆盖，而这是 DOMPurify 这类库十余年攒下的攻击面知识。
    - **候选对比（实测）**：`xss@1.0.15` vs `dompurify@3.4.15`——
      - **维护状态**：`xss` 的 npm 最新版 1.0.15 发布于 **2024-03-03（约 2.5 年前）**，仓库在 2026 年仍有零星提交（PR #300 加了 `filterXSSWithResult`），属**发版停摆**而非「已弃用」；DOMPurify 3.4.15 发布于 **2026-09-06（2 周前）**，维护 640K 下游、有专门的安全邮件列表。
      - **依赖面**：`xss` 带 `commander@^2.20.3` + `cssfilter@0.0.10`；DOMPurify **零运行时依赖**。
      - **产物体积（minify 实测）**：`xss` **18,786 B** → `dompurify` **29,354 B**（**+10.3 KB / +56%**）。这是本次替换的主要代价。
      - **更正一处早先的误判**：本文档上一版曾称「换掉 `xss` 可顺带去掉其拖入的 `commander`（浏览器产物里的死重）」，**实测不成立**——从 `xss` 的入口 `lib/index.js` 打包后，产物里没有任何 `commander` 痕迹（它只从 `bin/xss` CLI 进来）。`commander` 只是 `node_modules` 的安装图包袱，不进产物。
    - **测试环境是本次真正的成本**：DOMPurify 是 DOM-only 库，`bun test` 下无 DOM 时 `isSupported === false` 且 `sanitize` 为 `undefined`。三种垫片实测：
      | 垫片 | `isSupported` | 结果 |
      |---|---|---|
      | 无 DOM（`bun test` 现状） | `false` | `sanitize` 未定义，调用即 TypeError |
      | linkedom | `undefined` | **静默返回未消毒原文**（`onerror` 原样留着）——最危险的失败模式 |
      | happy-dom | `true`（**谎报**） | 同一配置下 **27/30** 条本仓输入与 jsdom 分歧，且方向是「把所有元素都剥光」（`<p>plain</p>` → `plain`、`<h1>T</h1>` → `T`）——消毒器整体不工作 |
      | jsdom | `true` | 全部行为正确 |
    - **为何不用 happy-dom**（尽管 [upgrade-plan.md](upgrade-plan.md) 为「未来的 Vue 组件测试」预设了 happy-dom + vitest）：那是给**验 DOM 形状与事件**的场景，垫片只是脚手架；本条是**验消毒器**，垫片自身就是可信基的一部分，必须是保真度参照物——用会谎报 `isSupported`、并把元素整体剥光的垫片，只能产出「全绿但无意义」的假绿。两种测试的要求不同，选不同工具不构成对 ADR 的推翻。另注：垫片只进 devDependencies，**不进任何产物**，生产侧跑的是浏览器真 DOM，故不存在「happy-dom 不安全 → 控制台不安全」的推论（早先把这两件事混为一谈，此处更正）。
    - **行为变更（逐条核对，均为「更正确」）**：29 条旧断言中 7 条需重定：
      | 旧行为（手写层） | 新行为（DOMPurify） | 判定 |
      |---|---|---|
      | `<script>x</script>` → `x</script>` | → `""`（连内容整体移除） | 修掉游离闭标签 |
      | `</b>` → `&lt;/b&gt;`（转义显示） | → `""`（真解析器忽略孤儿闭标签） | 修掉伪文本输出 |
      | `<B>x</B>` → `<b>x</B>` | → `<b>x</b>` | 标签名归一 |
      | 非法协议 href → 降级为 `#` | → **整体剔除**该属性（且无 href 时不补 rel/target） | 不再伪造假链接 |
      | `<a title="<script>">` → `title="&lt;script&gt;"` | → `title="<script>"`（属性值内的尖括号按 HTML 规范无需转义） | 等价，已由 round-trip 用例证否「会变成标签」 |
    - **一处必须显式关掉的默认（测试当场逮到）**：DOMPurify 的 `ALLOW_DATA_ATTR` / `ALLOW_ARIA_ATTR` 默认 `true`，会**绕过 `ALLOWED_ATTR` 的收敛**，使第三方插件描述能塞进任意 `data-*` / `aria-*`。本组件的白名单语义是「每个标签零属性、仅 `<a>` 的 href / title 例外」，故二者一并关掉。
    - **产品口径：`img` 维持不放行**。四个调用点中三个走非 unsafe（`packages/web/components/client/form/computed.vue` 的 schema 描述、`plugins/webui/config/client/components/select.vue` 与 `plugins/webui/market/client/market/package.vue` 的插件描述），后两者渲染的是**市场里的第三方插件描述**。放行 `img` 等于允许恶意插件以 `![](https://tracker/x?u=…)` 让访客控制台静默发起请求（追踪像素 / IP 泄露）。故 `ALLOWED_TAGS` 仍不含 `img`——这是**收紧而非沿用默认**，并把「是否放开图片」这个独立产品决策解耦出去。
    - **实现要点**：消毒实例**惰性创建**（`getPurifier()`：首次调用时 `DOMPurify(window)` 并挂 `afterSanitizeAttributes` 钩子），而非模块顶层创建——顶层求值发生在导入阶段，宿主打包器与测试环境就绪 window 的时机不同，顶层取 window 会在无 DOM 环境拿到降级实例。DOMPurify 的默认导出首行即 `(root) => createDOMPurify(root)`，因此即使模块是在无 window 时求值的，运行期传入 window 仍能得到完整实例。协议白名单写成 `ALLOWED_URI_REGEXP`（由 `allowedProtocols` 数组拼出，保持单一事实来源），与旧实现（解析成 URL 再比对 protocol）等价；各类混淆写法（实体 `jAva&#115;cript:`、裸控制字符 `java&#13;script:`）会在 DOM 解析阶段先被解码归一、再落到该正则判定，故同样被拒。
    - **依赖面与验证**：名数 **1 换 1**（`xss` → `dompurify`），另加测试期 `jsdom` + `@types/jsdom` 两项，总数 75 → **77**（§2.E）。测试文件由 29 用例 / 55 断言增到 **31 用例 / 60 断言**，新增「消毒输出的二次解析安全性（round-trip）」一组：把消毒结果重新解析为 DOM，确认不产生新的可执行节点或 `on*` 属性（只比对字符串不足以证明安全）。`bun run check` 八段全绿、`bun run build` 无错、`bun test` 全仓通过、`bun run fallow` 无问题、宿主控制台前端重新构建正常。过程中断言基线闸门逮到一处 `globalThis as unknown as {...}` 双断言，已按闸门要求改用 `globalThis.window`（client 工程带 DOM lib，类型上即为 `Window | undefined`）**根除**，而非登记基线。
    - **判据归属**：本条属 §4.9 / §4.12 那一类「换得动且净收益」，但**收益不在字节数**（产物反而 +10.3 KB），而是「用十余年攒下的解析覆盖面与持续维护的安全修复，换掉发版停摆的手写近似实现」。与 §4.10 同属单一指标反向、需把口径分开看的一类（见 §3）。
15. **本条与 §4.7 / §4.9 / §4.10 / §4.12 / §4.13 / §4.14 的关系**：六条处置的判据一致——**同一能力下换更少/更小/更可维护的依赖，换不动或换了更亏则保留**。§4.7 的 `semver` 属「换不动」（Bun.semver 语义不覆盖）；§4.9 的 `picomatch` 与 §4.12 的 `@noble/hashes` 属「换得动且净收益」（前者减物理包 + 消断言，后者去 UMD 包 + 去手写声明 + 减产物）；§4.10 的 CodeMirror 属「名数上升而体量下降」，§4.14 的 DOMPurify 属「体量上升而覆盖面与维护性上升」——两者都是**单一指标反向**，须把口径分开看（见 §3）；§4.13 的 `marked-vue` 属「不是替换而是收回」——上游包已无维护价值，换任何等价物都不如自持源码，名数净 +1 是解除版本钉死的代价。
---

## 5. package.json 之外的技术栈

- **TypeScript 三轨**：根 `typescript` 实为 `@typescript/typescript6@6.0.2` 别名（供 @typescript-eslint/parser）；类型检查真身是 `@typescript/native@7.0.2`（TS7 原生编译器，`bunx tsc` 双 project 串行：`tsconfig.json` node 侧 + `tsconfig.web.json` client 侧）；.vue 类型走 vue-tsc 3.3.11 影子基线闸门（自举钉版 TS 5.9.3 至隔离目录、必须 node 直跑、只拦新增，基线 26 键，以 `tooling/checks/vue-types-baseline.json` 实况为准）。
- **严格模式**：`tsconfig.base.json` 严格全家桶（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes 等）+ nodenext 模块解析（相对导入一律带 `.ts` 扩展名）；显式 `any` 全仓 0；`as unknown as` 断言基线闸门只拦新增（17 处存留台账，2026-09-21 由 18 减去 explorer 的 anymatch interop 条目）。
- **构建**：根 tsdown 单遍 → 各包 `lib/`（`index.mjs` + `index.d.ts`，ESM-only，exports 以 `default` 条件兜底）；`apps/koishi-create` 独立 tsdown；vendored 三包 exclude。
- **Lint**：biome（tab 缩进、双引号、行尾分号）是格式唯一权威；eslint 仅补 `.vue` 模板语义。
- **测试**：`bun test --isolate`（每文件独立 global，隔离跨文件 mock.module），128 个测试文件 / 1042 用例（2026-09-22 实测，58.5s），覆盖率 src 源码口径约 97% 行；CI 产 lcov 上传 Codecov。含 DOM 依赖的组件测试（§4.14）以 jsdom 作垫片。
- **版本管理**：changesets（`.changeset/`）+ `tooling/release` 链（preflight → version → build → test → publish → push，只推 main；单整体 tag 跟 core 版本手动补）。
- **上游巡检**：`bun run upstream:audit`（`tooling/upstream-audit/`）+ [../process/upstream.md](../process/upstream.md) 映射表手动 diff 移植，port 进来的相对导入须补 `.ts` 扩展名。

---

## 6. 结论摘要

1. 初版审计确立的两世界格局未变，但力量对比已逆转：**独立工具链从落后主流 2~3 年追平**（TS7 / vite 8 / unocss 66 / echarts 6 / vue-i18n 11 / vue-router 5 / element-plus 2.14 / monaco 0.56），cordis 生态运行时则确认长期冻结在 3.x 内洽线。
2. 外部依赖 99 → 77、[旧] 38 → 4、[废] 4 → 0：升级计划 Phase 0-4 的清理、原生化、替换目标全部达成；本轮继续以 Bun.Archive 移除 `giget`，并以 vendor 收回 `marked-vue`（§4.13，名数 +1），另加测试期 DOM 垫片（§4.14，名数 +2）。
3. 剩余可动空间已收窄到「非结构性」层：**非冻结 major 已清零**（@vueuse 14→15 见 §4.11、marked 9→18 见 §4.13、xss→dompurify 见 §4.14），剩下 13 个 minor/patch 随手更与 §4 的声明卫生项（死依赖存疑、`vue` 一组 range 漂移；`semver` 两形态已于 2026-09-21 统一）。
4. 冻结线不是欠账：剩余的 4 个 [旧] + 1 个 [预] **全部**挂 Phase 5 重启条件，勿在线内单独升版。
5. 本文档角色已从「立项前基线」转为「现势对账基线」；下一轮治理从 §4 起步，结构性升版须待 Phase 5 解冻后与 cordis 4 迁移合并进行。
6. 2026-09-21 追加一次依赖收敛：explorer 的 `anymatch` 换为直连 `picomatch`（物理包净减 2、断言基线 18 → 17、行为实测等价），类型包 `@types/picomatch` 随主包计入，外部依赖名 57 → 58——本次为「同一能力换更少依赖 + 消断言」的净收益型替换，与 §4.7 的 `semver` 保留判据（换不动或换了更亏）互为对照。
7. 2026-09-21 explorer 编辑器由 monaco 换为 CodeMirror 6（§4.10）：**产物 13.55 MB → 0.72 MB、首屏约 431 KB、文件数 97 → 23**，代价是外部依赖名 58 → 75（-1 +18，CM6 一语言一包的生态切分）与「少数语言」的覆盖收窄（80+ → 21 种，且只收 Koishi 生态真会出现的类型）。这是本次快照里唯一一处「名数上升而体量下降」的改动，判据是前端产物体积与首屏负载（用户实际付出的字节），并已在 §3 / §4.10 标明口径分离；若后续仍要压名数，方向是把语言表按需裁剪（`languages.ts` 表内删项即可，无需改语义）——本轮已按此裁掉 6 种后端语言。
8. 2026-09-21 `@vueuse/core` 14 → 15（§4.11）：**非冻结 major 就此清零**（[旧] 5 → 4，余下 4 项全属 cordis 3.x 内洽冻结线），外部依赖名数不变（75）。全部破例点中只有 `useThrottleFn` 的 `trailing` 默认值翻转与本仓有交集，而本仓该调用显式传参故行为等价；被移除的 deprecated timer options 全落在未使用的 composable 上。这是本轮唯一一次「不做替换、只跟进版本」的纯升版动作，与 §4.7 / §4.9 的替换型收敛（换不动则保留、换得动则换更少）共同构成依赖面的三种处置口径。
9. 2026-09-21 market 的 gravatar 摘要由 `spark-md5` 换为 `@noble/hashes` 的同步 MD5（§4.12）：名数 1 换 1（75 不变）、market 前端产物 **-4,012 B**、手写的 `spark-md5.d.ts` 环境声明出仓。**关键结论是「不换 SHA-256」这个否定判断**——gravatar 官方双支持但镜像不保证，实测默认镜像 cravatar.cn 的 sha256 摘要 404，换算法等于在默认配置下静默丢头像；等价性以 10 组输入的源码级 + 打包后端到端双重复核，避免假绿。
10. 2026-09-22 `giget` 换为 Bun.Archive：脚手架仍使用原有 `fetch` 拉取 npm tarball，Bun.Archive 负责 gzip/tar 解包与路径安全校验，临时目录搬运 `package/` 内容以保留 npm 模板的 `strip: 1` 语义；registry 的版本倒序比较则局部使用 `Bun.semver.order`，完整 range 语义仍由 `semver` 保留。
11. 2026-09-22 `k-markdown` 由 npm 包 `marked-vue` 改为就地 vendor 的本地实现（§4.13）：`marked` / `xss` 转为直接依赖，`marked-vue` 出仓，名数净 +1（74 → 75）。**本次只解除版本钉死、不改行为**——props 语义、包裹标签、消毒白名单、`<a>` 属性加固与栈式补闭合逐字等价，并以 25 用例锁定基线；同时证否了「服务端用 `Bun.markdown` 预渲染」的候选（多语言字典 + 客户端 locale + inline 语义三重不匹配）。
12. 2026-09-22 marked 9.1.6 → 18.0.14（§4.13 的方案 B 之 B1）：**先双装对拍再落地**——72 条语料 × 块级/行内两模式，16 处差异逐条核对后全部为上游解析修复（含 HTML 属性转义、禁止链接套链接、CommonMark 字符引用解码、块级边界修复与数条 ReDoS 加固），类型面只需把 `parse` 分支一并 cast。**非冻结 major 就此清零**，[旧] 5 → 4（余下 4 项全属 cordis 3.x 内洽冻结线），依赖名数不变；差异中可观测的部分已钉入基线测试（25 → 29 用例）。**代价是字节数**：minify 后 +10.0 KB（前端 `client.js` +3.3%），判据取解析正确性与安全修复而非体积。
13. 2026-09-22 `k-markdown` 的手写消毒层换成 `dompurify` 3.4.15（§4.14）：名数 1 换 1（`xss` 出仓），另加测试期 `jsdom` + `@types/jsdom`（75 → 77）。**先证否了两种轻量垫片**——linkedom 在 DOMPurify 下会**静默返回未消毒原文**，happy-dom 则谎报 `isSupported: true` 且把元素整体剥光（本仓 30 条输入里 27 条与 jsdom 分歧），故只能用 jsdom。**唯一真正的成本是产物 +10.3 KB**（18,786 → 29,354 B，minify 实测），收益是手写近似解析器换成十余年攒下的攻击面覆盖面与持续维护的安全修复。行为变更 7 处、均为「更正确」（游离闭标签、孤儿闭标签转义、标签名归一、非法协议不再伪造 `#`），并新增一组 round-trip 用例把「消毒结果二次解析后仍无可执行节点」钉死。同时**更正两处早先的记述**：`commander` 不进产物（此前误称可顺带省掉）、happy-dom 的不安全仅影响测试保真度而不影响生产（此前把两件事混为一谈）。

