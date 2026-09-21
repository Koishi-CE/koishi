# 依赖与技术栈全量审计报告

> **状态：现势快照（2026-09-19）**。初版审计（2026-08-27，99 个外部依赖，升级计划立项前基线）已随 git 历史归档；其行动方案（[upgrade-plan.md](upgrade-plan.md)）的 Phase 0-4 已全部执行完毕，本文档即执行后的对账基线。Phase 5（cordis 4 跳代）冻结中，重启条件见 upgrade-plan Phase 5 节。日常现状以 [../guides/development.md](../guides/development.md) 与 [../reference/architecture.md](../reference/architecture.md) 为准。
>
> 审计日期：2026-09-19 · 「最新」列均于当日经 npm registry 实时验证（npmjs 主查、npmmirror 兜底）
> 运行环境：Bun 1.4.2（`packageManager` 钉定）· Node v24（辅：TS7 编译器与 vue-tsc 影子闸门宿主）· 包管理：Bun workspaces（`bun.lock`）
> 范围：仓库内全部 **53 个 package.json**（**52 个 workspace 包** + 根）· **58 个外部依赖名**（不含 `workspace:*` 与 `@koishi-ce/*` 内部 peer 互引，后者单列于 §2.G）
>
> 修订：2026-09-21 —— ① admin 前端防抖改用既有 `@vueuse/core`（`useDebounceFn`），移除 `throttle-debounce`，外部依赖名 58 → 57；② explorer 路径过滤由 `anymatch` 换为直连 `picomatch` 4（版本本仓已有，显式声明后消除 CJS/ESM interop 双重断言，见 §4.9），并随主包新增类型包 `@types/picomatch`，外部依赖名 57 → 58。其余内容仍为 2026-09-19 快照。

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
| @vueuse/core | ^14.4.0 | client + 4 插件(dev) | Vue 组合式工具集 | 15.0.0 | [旧] major（全仓唯一非冻结升版空间） |
| element-plus | ^2.14.5 | client + config / explorer / locales | UI 组件库 | 2.14.6 | [缓] patch（2.7.7 精确锁已解锁） |
| schemastery-vue | ^7.3.15 | components | 配置 Schema → 表单渲染 | 7.3.15 | [新] |
| marked-vue | ^1.3.0 | client | Markdown 渲染 | 1.3.0 | [新] |
| unocss | ^66.8.1 | client(构建脚本) | 原子化 CSS 引擎 | 66.10.5 | [缓] patch（0.65→66 已升） |
| echarts | ^6.1.0 (dev) | analytics | 数据可视化图表 | 6.1.0 | [新]（5→6 已升） |
| vue-echarts | ^8.1.0 (dev) | analytics | echarts 的 Vue 封装 | 8.3.0 | [新]（6→8 已升，range 内最新） |
| ansi_up | ^6.0.6 (dev) | logger(client) | ANSI 转义 → HTML | 6.0.6 | [新]（5→6 已升） |
| d3-force | ^3.0.0 (dev) | insight | 关系图谱力学布局 | 3.0.0 | [新] |
| monaco-editor | ~0.56.0 (dev) | explorer | 代码/文本编辑器 | 0.56.0 | [新]（0.44→0.56） |
| lottie-web | ^5.13.0 (dev) | welcome | Lottie 动画（开屏描线） | 5.13.0 | [新]（welcome 插件新增） |
| spark-md5 | ^3.0.2 (dev) | market | MD5（gravatar 头像） | 3.0.2 | [新] |

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
| giget | ^3.3.1 | koishi-create | 远程模板拉取（替代 axios+tar 自研解包） | 3.3.1 | [新] |
| open | ^11.0.1 | console | 打开浏览器 | 11.0.4 | [缓] patch（8→11 已升，装 11.0.3） |
| chardet | ^2.2.0 | explorer | 文本编码检测 | 2.2.0 | [新] |
| file-type | ^22.0.2 | assets / assets-local / explorer | 文件类型嗅探 | 22.1.1 | [缓] patch（16→22 已升，装 22.1.0） |
| picomatch | ^4.0.7 | explorer（此前已由 vite / tsdown 等经传递依赖引入） | glob 匹配（文件树过滤） | 4.0.7 | [新]（2026-09-21 由 anymatch 换入，见 §4.9） |
| semver | ^7.8.5 | registry / market | 语义版本计算 | 7.8.5 | [新]（两形态已统一） |

### E. 测试设施

初版审计中的 mocha / @types/mocha / chai / chai-as-promised / chai-shape / @sinonjs/fake-timers 已于 2026-09-02 前整体退役，断言统一 `bun:test` 原生 `expect`，时间模拟用其内建 mock timers。现仅剩两个类型包：

| 包 | 声明 | 使用位置 | 业务范围 | 最新 | 状态 |
|---|---|---|---|---|---|
| @types/bun | ^1.4.0 | root(dev) | Bun 运行时类型（薄封装，转发 bun-types） | 1.4.2 | [新] |
| @types/node | ^26.4.0 | root(dev) | Node 类型（TS 编译器与工具宿主） | 26.6.2 | [缓] minor（装 26.5.1） |

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

## 3. 新鲜度总览（58 名，registry 实测）

| 类别 | 数量 | 代表 |
|---|---|---|
| [新] 已是最新 | **39** | vite 8.3 / TS 7.0.2 / unocss 66 / echarts 6 / vue-router 5 / vue-i18n 11 / monaco 0.56 |
| [缓] 落后 minor/patch | 13 | eslint、@types/node、element-plus 及 10 个 patch 漂移 |
| [旧] 落后 major | **5** | minato、@cordisjs/plugin-{http,server}、@minatojs/sql-utils（4 个属冻结线）+ @vueuse 14→15（唯一真空间） |
| [预] 最新为预发布 | 1 | cordis（4.0.0-rc.10，冻结线） |
| [废] 弃用/死依赖 | **0** | 初版 4 项（ws / uuid / @types/uuid / @types/tar）已全部清理 |

对比初版（2026-08-27）：外部依赖 **99 → 58（-41%）**；[旧] **38 → 5**；[废] 4 → 0。减量主要来自死依赖清理、Node 生态 API 的 Bun 原生化替换与测试栈退役。

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
8. **`bun-types` → `@types/bun` 已迁移**（2026-09-21，root / 脚手架模板 / koishi-scripts 白名单一并改）：先纠正常见误传——`bun-types` **并未被废弃**（npm 上无 `deprecated` 标记），`@types/bun@1.4.2` 的 `index.d.ts` 全文只有一行 `/// <reference types="bun-types" />`，且其唯一依赖就是 `bun-types@1.4.2`；断言「两者并存会引发全局命名空间污染」不成立，因为**类型内容按构造完全相同**。迁移的真实理由是**跟随 Bun 官方约定**：Bun docs 写 `bun add -d @types/bun` + `"types": ["bun"]`，本机 `bun init` 实测生成的也是 `@types/bun`（且 `node_modules` 里 `bun-types` 依旧在场，只是降为传递依赖）。迁移后类型检查与全部门禁实测无差异；副作用是 tsconfig 的 `types` 从 `"bun-types"` 改为 `"bun"`（`@types/*` 的隐式前缀），**已确认全仓各 tsconfig 均显式声明 `types`，`node_modules/@types/` 下的自动包含不会波及 client 侧**（`tsconfig.client.json` 为 `types: []`）。9. **explorer 路径过滤：`anymatch` → `picomatch` 直连**（2026-09-21）：原依赖 `anymatch@3.1.3` 实现是 CJS 而 d.ts 为 ESM 形态，nodenext 类型视图对 `default` 多包一层，迫使源码保留一处 `as unknown as` 双重断言（断言基线台账内的 R2 条目）。改为直连 `picomatch@4.0.7`（该版本本仓早已由 vite / tsdown / tinyglobby 等经传递依赖引入，显式声明等于零新增物理包）后：`anymatch` / `normalize-path` / 其嵌套的 `picomatch@2.3.2` 三包一并出仓，双重断言随之清零（基线 18 → 17）——这是比对 `micromatch` 后的选择，理由见下方。行为经「多模式 × 13 输入」矩阵实测与 anymatch 逐条一致（含 win32 反斜杠路径与 `**/.*` 对 dotfile 的忽略）；唯一已知语义差异是 `!` 前缀模式——anymatch 视作「纯排除」（`["!**/foo"]` 全 false），picomatch 视作取反（除 foo 外全 true），explorer 的 `ignored` 不宣传该写法、存量亦无依赖。另记一处坑：**picomatch 4 只在显式传入 options 时才注入平台检测**（`index.js` 的 `options &&` 守卫），不传 options 即按 posix 处理、win32 反斜杠路径全部漏配，故源码显式声明 `windows: process.platform === "win32"`，不依赖该注入行为。**为何不选 `micromatch`**：其匹配内核即 picomatch v2，对 explorer 的全部能力需求（braces 展开 / `capture` / `scan` / `makeRe`）无一用得上；依赖面却是 +5 物理包（braces / fill-range / to-regex-range + 自带 picomatch v2），且惯用入口 `isMatch` / `any` 每次调用都重新编译模式——落到 `traverse()` 的逐目录项热路径上会退化为 N 次正则编译，要保住「编译一次」只能用类型仅接受单个 `string` 的 `matcher()`，适配成本反高于现状。
---

## 5. package.json 之外的技术栈

- **TypeScript 三轨**：根 `typescript` 实为 `@typescript/typescript6@6.0.2` 别名（供 @typescript-eslint/parser）；类型检查真身是 `@typescript/native@7.0.2`（TS7 原生编译器，`bunx tsc` 双 project 串行：`tsconfig.json` node 侧 + `tsconfig.web.json` client 侧）；.vue 类型走 vue-tsc 3.3.11 影子基线闸门（自举钉版 TS 5.9.3 至隔离目录、必须 node 直跑、只拦新增，基线 26 键，以 `tooling/checks/vue-types-baseline.json` 实况为准）。
- **严格模式**：`tsconfig.base.json` 严格全家桶（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes 等）+ nodenext 模块解析（相对导入一律带 `.ts` 扩展名）；显式 `any` 全仓 0；`as unknown as` 断言基线闸门只拦新增（17 处存留台账，2026-09-21 由 18 减去 explorer 的 anymatch interop 条目）。
- **构建**：根 tsdown 单遍 → 各包 `lib/`（`index.mjs` + `index.d.ts`，ESM-only，exports 以 `default` 条件兜底）；`apps/koishi-create` 独立 tsdown；vendored 三包 exclude。
- **Lint**：biome（tab 缩进、双引号、行尾分号）是格式唯一权威；eslint 仅补 `.vue` 模板语义。
- **测试**：`bun test --isolate`（每文件独立 global，隔离跨文件 mock.module），126 个测试文件 / 1003 用例（2026-09-20 实测，50.3s），覆盖率 src 源码口径约 97% 行；CI 产 lcov 上传 Codecov。
- **版本管理**：changesets（`.changeset/`）+ `tooling/release` 链（preflight → version → build → test → publish → push，只推 main；单整体 tag 跟 core 版本手动补）。
- **上游巡检**：`bun run upstream:audit`（`tooling/upstream-audit/`）+ [../process/upstream.md](../process/upstream.md) 映射表手动 diff 移植，port 进来的相对导入须补 `.ts` 扩展名。

---

## 6. 结论摘要

1. 初版审计确立的两世界格局未变，但力量对比已逆转：**独立工具链从落后主流 2~3 年追平**（TS7 / vite 8 / unocss 66 / echarts 6 / vue-i18n 11 / vue-router 5 / element-plus 2.14 / monaco 0.56），cordis 生态运行时则确认长期冻结在 3.x 内洽线。
2. 外部依赖 99 → 58、[旧] 38 → 5、[废] 4 → 0：升级计划 Phase 0-4 的清理、原生化、替换目标全部达成。
3. 剩余可动空间小而集中：@vueuse 14→15（唯一非冻结 major）、13 个 minor/patch 随手更、§4 的声明卫生项（死依赖存疑、`vue` 一组 range 漂移；`semver` 两形态已于 2026-09-21 统一）。
4. 冻结线不是欠账：4 个 [旧] + 1 个 [预] 全部挂 Phase 5 重启条件，勿在线内单独升版。
5. 本文档角色已从「立项前基线」转为「现势对账基线」；下一轮治理从 §4 起步，结构性升版须待 Phase 5 解冻后与 cordis 4 迁移合并进行。
6. 2026-09-21 追加一次依赖收敛：explorer 的 `anymatch` 换为直连 `picomatch`（物理包净减 2、断言基线 18 → 17、行为实测等价），类型包 `@types/picomatch` 随主包计入，外部依赖名 57 → 58——本次为「同一能力换更少依赖 + 消断言」的净收益型替换，与 §4.7 的 `semver` 保留判据（换不动或换了更亏）互为对照。
