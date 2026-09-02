# 依赖与技术栈全量审计报告

> **状态：历史快照（2026-08-27）**。本审计记录依赖升级计划立项前的基线；其行动方案（[upgrade-plan.md](upgrade-plan.md)）的 Phase 0-4 已执行完毕，文中「现状」「状态」列均为审计当日数据，与当前仓库实况的出入以 [../guides/development.md](../guides/development.md) 与 [../reference/architecture.md](../reference/architecture.md) 为准。
>
> 审计日期:2026-08-27 · 注册表数据均于当日经 npm registry 实时验证
> 运行环境:Bun 1.4.0 · Node v24.16.0(辅) · 包管理: Bun workspaces(`bun.lock`)
> 范围:仓库内全部 **42 个 package.json**(含未跟踪的 `apps/create-koishi-ce`、`apps/koishi-scripts`)· **99 个外部依赖**(不含 `workspace:*` 内部引用)

状态图例:[新] 当前最新 · [缓] 落后(minor/patch) · [旧] 落后(major) · [预] 最新版本为预发布 · [废] 已弃用或未使用

---

## 1. 项目定位与结构

本项目是 [koishijs/koishi](https://github.com/koishijs/koishi)(MIT)与 [koishijs/webui](https://github.com/koishijs/webui)(AGPL-3.0)的文件级合并 fork,包作用域统一重命名为 `@koishi-ce`,运行时目标为 **Bun**。构建管线正在从上游的 yarn + yakumo 向「Bun 原生 / zero-build」迁移(README 状态:**yakumo 移除、Bun workspaces 已完成;zero-build exports、Bun 测试可运行 仍未完成**)。

```
koishi-bun/
├── packages/node/      运行时核心:koishi(CLI入口) core loader console utils i18n-utils
├── packages/web/       前端基础:client(构建API+控制台前端) components market(市场组件)
├── plugins/common/     通用插件:bind broadcast callme echo help inspect
├── plugins/infra/      基础设施插件:hmr http mock proxy-agent server(vendored 预编译)
├── plugins/webui/      控制台插件 ·16:actions admin analytics auth commands config
│                       console explorer insight locales logger market notifier oobe sandbox status
├── apps/               create-koishi-ce(脚手架) koishi-scripts(插件开发CLI)
│                       online(koishi.online 网站) registry(市场扫描库)
└── tooling/            上游迁移工具(目前仅留 yakumo 配置参考,scripts 为空)
```

关键结构事实:

- **无 CI**(`.github/` 不存在)、无 `bunfig.toml`、根目录无 `test`/`build` 脚本。
- **`koishi` / `@koishijs/*` 的 peerDependencies 是刻意保留的**:`UPSTREAM.md` 明确「依赖本 monorepo 之外的包保留上游名,peerDependencies 仍指向上游已发布的运行时」,用于维持与上游插件生态的兼容。代码内实际导入全部走 `@koishi-ce/*`(237 处),仅 2 处例外均为外部上游包(`@koishijs/plugin-database-memory`、`@koishijs/plugin-server-proxy` 类型引用)。
- `plugins/infra/server` 是 **vendored 预编译产物**(无 src,内联封装 `@cordisjs/plugin-server ^0.2.9`)。
- 客户端构建不走 vite 配置文件,而是 **TypeScript 脚本编程式调用 `vite.build()`**(`packages/web/client/scripts/client.ts`、各插件 `build/client.ts`、`apps/online/src/build.ts`)。
- `apps/create-koishi-ce`、`apps/koishi-scripts` 为未跟踪的新目录;`biome.json`、`bun.lock` 有未提交修改。

---

## 2. 外部依赖全量清单(按业务范围分类)

### A. Cordis / Koishi 生态运行时(fork 的内核世界)

| 包 | 声明 | 使用位置 | 业务范围 | 最新 | 状态 |
|---|---|---|---|---|---|
| cordis | ^3.18.1 | core / console / utils / loader | 依赖注入容器 + 插件生命周期框架,koishi 的底层内核 | 4.0.0-rc.8 | [预] 4.x 仍为 RC |
| cosmokit | ^1.8.1 | 7 个包 | 生态通用工具箱(时间格式化、锁、观察者等) | 1.8.1 | [新] |
| minato | ^3.7.0 | core 等 4 包 | ORM / 数据库抽象层(表定义、查询、驱动协议) | 4.0.1 | [旧] major |
| @satorijs/core | ^4.6.0 | core / cli | 聊天协议内核(会话、机器人抽象) | 4.6.0 | [新] |
| @satorijs/element | ^3.2.0 | cli | 消息元素树 / KQL 模型 | 3.2.0 | [新] |
| @satorijs/protocol | ^1.7.0 | cli | 协议数据结构类型定义 | 1.7.0 | [新] |
| @satorijs/components-vue | ^0.7.8 (dev) | web/client | 消息元素的 Vue 渲染组件(测试/开发用) | 0.7.8 | [新] |
| @cordisjs/plugin-http | ^0.6.3 | core | HTTP 客户端上下文插件(`ctx.http`) | 1.5.2 | [旧] major |
| @cordisjs/plugin-server | ^0.2.9 | plugins/infra/server(vendored) | HTTP/WebSocket 服务上下文插件(`ctx.server`) | 1.7.0 | [旧] major |
| @cordisjs/plugin-proxy-agent | ^0.3.3 | plugins/infra/proxy-agent | 网络代理支持 | 0.3.3 | [新] |
| @cordiverse/{dns,fs,os,path,url} | ^1.x (dev) | apps/online | 跨运行时系统 API polyfill 套件 | 1.x | [新] |
| reggol | ^1.7.1 (dev) | core(dev) | 生态日志库(cordis 内部同款) | 2.1.0 | [旧] major |
| yml-register | ^1.2.5 (dev root) | 根 | require/TS 钩子,支持 `import x from '*.yml'` 语言包 | 1.2.5 | [新] |
| ns-require | ^1.1.4 | loader(另 2 处声明未使用) | 插件命名空间化加载 | 1.1.4 | [新] |
| inaba | ^1.1.1 | utils | 随机数据生成 | 1.1.1 | [新] |
| @minatojs/driver-memory | ^3.7.0 (dev) | 根 + core/bind/broadcast/help | 内存数据库驱动(测试) | 4.0.0 | [旧] 随 minato 4 配套 |
| @koishijs/plugin-database-memory | ^3.7.0 (dev) | 根(admin 测试) | 上游内存数据库驱动插件 | 3.7.0 | [新]（上游冻结） |
| @koishijs/assets | ^1.1.2 (dev) | analytics(dev) | 资源解析器(测试) | 1.1.2 | [新]（上游冻结） |
| @koishijs/plugin-server-proxy | ^1.2.0 (dev) | console(dev) | 代理支持(仅类型引用) | 1.2.0 | [新]（上游冻结） |

**上游运行时 peer 声明(刻意保留,不计入升级对象)**:`koishi ^4.18.11`(仅限外部真包依赖的 peer 消费，如 @koishijs/plugin-database-memory / @koishijs/assets / @koishijs/plugin-server-proxy)；本仓 CE 包 peer 一律指向 CE 名（`@koishi-ce/* ^1.0.0`）。

### B. 前端 UI 栈(控制台 Web 界面)

| 包 | 声明 | 使用位置 | 业务范围 | 最新 | 状态 |
|---|---|---|---|---|---|
| vue | ^3.5.12 | client / components / market | UI 框架 | 3.5.42 | [新] 范围内 |
| vue-router | ^4.4.5 | client | 控制台路由 | 5.2.0 | [旧] major |
| vue-i18n | ^9.10.2 | client | 界面国际化 | 11.4.10 | [旧] major |
| element-plus | 2.7.7(精确锁) | client / components / config 插件 | UI 组件库(表单、树、虚拟列表等) | 2.14.5 | [缓] minor |
| @vueuse/core | ^11.1.0 | client / components / market / 多插件 | Vue 组合式工具集 | 14.4.0 | [旧] major |
| unocss | ^0.65.1 | client(构建脚本) | 原子化 CSS 引擎(preset-mini) | 66.8.1 | [旧] 版本线跨越 |
| schemastery-vue | ^7.3.15 | components / client | 配置 Schema → 表单渲染 | 7.3.15 | [新] |
| marked-vue | ^1.3.0 | client | Markdown → Vue 组件 | 1.3.0 | [新] |
| spark-md5 | ^3.0.2 | market | MD5(gravatar 头像) | 3.0.2 | [新] |
| ansi_up | ^5.2.1 (dev) | logger 插件(client) | ANSI 转义 → HTML(日志着色) | 6.0.6 | [旧] major |
| echarts | ^5.5.0 (dev) | analytics 插件 | 数据可视化图表 | 6.1.0 | [旧] major |
| vue-echarts | ^6.6.9 (dev) | analytics 插件 | echarts 的 Vue 封装 | 8.1.0 | [旧] major |
| d3-force | ^3.0.0 (dev) | insight 插件 | 关系图谱力学布局 | 3.0.0 | [新] |
| monaco-editor | ~0.44.0 (dev) | explorer 插件 | 代码/文本编辑器 | 0.56.0 | [缓] 跨 12 个 minor |
| throttle-debounce | ^3.0.1 | admin(另 explorer 声明未使用) | 前端 debounce(群组表单) | 5.0.2 | [旧] major |

### C. 构建与打包工具链

| 包 | 声明 | 使用位置 | 业务范围 | 最新 | 状态 |
|---|---|---|---|---|---|
| vite | ^5.4.10 | client / console / online | 前端构建(编程式 `vite.build()`) | 8.2.2 | [旧] 跨 3 个 major |
| @vitejs/plugin-vue | ^5.1.4 | client / console | Vue SFC 编译插件 | 6.0.8 | [旧] major |
| @maikolib/vite-plugin-yaml | ^1.0.1 | client / console | YAML 资源加载(前端 locale) | 1.1.1-0 | [预] 最新为预发布 |
| sass | ^1.82.0 | client(构建脚本) | SCSS 编译(modern-compiler API) | 1.103.1 | [缓] minor |
| esbuild | ^0.27.2 | plugins/infra/hmr(**运行时依赖**) | TS 即时编译(HMR 热重载) | 0.28.2 | [缓] minor |
| @babel/code-frame | ^7.27.1 | hmr(error.ts) | 构建错误源码帧美化 | 8.0.0 | [旧] major |
| typescript | ^5.6.2(已装 5.9.3) | 根(apps 用 `tsc -b`) | 类型系统 + 声明产出 | 7.0.2 | [旧] major |
| @biomejs/biome | ^2.0.0 | 根 | Lint + Format(schema 已是 2.5.10) | 2.5.10 | [缓] minor |
| yakumo | ^1.0.0-beta.16 (dev) | koishi-scripts(**仅类型引用**) | 上游构建器(历史残留) | 3.2.1 | [旧] 建议直接移除 |

### D. CLI 脚手架与系统交互

| 包 | 声明 | 使用位置 | 业务范围 | 最新 | 状态 |
|---|---|---|---|---|---|
| cac | ^6.7.14 | cli / koishi-scripts / client bin | 轻量 CLI 框架 | 7.0.0 | [旧] major |
| prompts | ^2.4.2 | koishi-scripts / create-koishi-ce | 交互式命令行提示 | 2.4.2 | [新] |
| kleur | ^4.1.5 | cli / scripts / create | 终端着色 | 4.1.5 | [新] |
| yargs-parser | ^21.1.1 | create-koishi-ce | argv 解析 | 22.0.0 | [旧] major |
| axios | ^1.6.8 | create-koishi-ce | 下载模板 tarball | 1.20.0 | [缓] minor(建议移除换原生 fetch) |
| tar | ^6.2.1 | create-koishi-ce | 模板 tarball 解包 | 7.5.22 | [旧] major |
| get-registry | ^1.2.0 | create-koishi-ce / market | npm registry 地址解析 | 1.2.0 | [新] |
| which-pm-runs | ^1.1.0 | create / scripts / status / market | 检测当前包管理器 | 2.0.0 | [旧] major |
| envinfo | ^7.11.1 | status 插件 | 运行环境信息采集 | 7.21.0 | [缓] minor |
| open | ^8.4.2 | console(节点端) | 打开浏览器 | 11.0.1 | [旧] major |
| execa | ^5.1.1 | market(安装器) | 子进程执行(包安装) | 10.0.1 | [旧] major |
| dotenv | ^16.4.5 | loader | `.env` 配置加载 | 17.4.2 | [旧] major |
| fs-extra | ^10.1.0 | koishi-scripts | 文件系统增强 | 11.4.0 | [旧] major |
| globby | ^11.1.0 | koishi-scripts | glob 文件匹配 | 16.2.4 | [旧] major |
| js-yaml | ^4.1.0 | loader / locales 插件 / scripts | YAML 解析(配置与语言包) | 5.4.1 | [旧] major |
| semver | ^7.6.3 | registry / market | 语义版本计算 | 7.8.5 | [缓] minor |
| p-map | ^4.0.0 | registry / market | 并发映射控制 | 7.0.6 | [旧] major |
| chardet | ^2.0.0 | explorer 插件 | 文本编码检测 | 2.2.0 | [缓] minor |
| file-type | ^16.5.4 | explorer 插件 | 文件类型嗅探 | 22.0.2 | [旧] major |
| anymatch | ^3.1.3 | explorer 插件 | 路径匹配(文件树过滤) | 3.1.3 | [新] |
| chokidar | ^3.6.0 | hmr / explorer | 文件变更监听 | 5.0.0 | [旧] major |
| fastest-levenshtein | ^1.0.16 | core(i18n) | 编辑距离(命令纠错建议) | 1.0.16 | [新] |
| ws | ^8.16.0 | console 声明 | ~~WebSocket~~ **全仓库无任何导入** | 8.21.3 | [废] 死依赖 |
| uuid | ^8.3.2 | console 声明 | ~~UUID~~ **全仓库无任何导入** | 14.0.2 | [废] 死依赖 |

### E. 测试设施

| 包 | 声明 | 使用位置 | 业务范围 | 最新 | 状态 |
|---|---|---|---|---|---|
| mocha | ^9.2.2 | 根(无 .mocharc、无 test 脚本) | 测试运行器 | 11.8.0 | [旧] 跨 2 major |
| @types/mocha | ^9.1.1 | 根 | mocha 类型 | 10.0.10 | [旧] |
| chai | ^5.1.1 | 根 + admin | 断言库 | 6.2.2 | [旧] major |
| chai-as-promised | ^7.1.1 | 根 + admin | Promise 断言扩展 | 8.0.2 | [旧] major |
| chai-shape | ^1.1.0 | core / echo | `.to.have.shape()` 部分匹配断言 | 1.1.0 | [新](需验证 chai 6 兼容) |
| @sinonjs/fake-timers | ^6.0.1 | 根 + utils | 时间模拟(runtime.spec) | — | [新] 已移除（bun:test mock timers 替代） |
| @types/node | ^25.0.9(已装 25.9.5) | 根 | Node 类型 | 26.4.0 | [旧] major |

### F. 类型包杂项

`@types/babel__code-frame`(7.27.0)、`@types/chai`(5.2.3)、`@types/chai-as-promised`(8.0.2)、`@types/d3-force`、`@types/envinfo`、`@types/fs-extra`、`@types/js-yaml`、`@types/prompts`、`@types/semver`、`@types/spark-md5`、`@types/throttle-debounce`(5.0.2,已支持 v5)、`@types/which-pm-runs`、`@types/yargs-parser` — 均随对应包同步升版即可。**`@types/uuid` 与 `@types/tar` 已被官方弃用**(uuid/tar 7 自带类型),应删除。

---

## 3. 新鲜度总览(99 包,registry 实测)

| 类别 | 数量 | 代表 |
|---|---|---|
| [旧] 落后 ≥1 个 major | **38** | vite 5→8、vue-i18n 9→11、typescript 5→7、mocha 9→11、execa 5→10、chokidar 3→5、unocss 0.65→66 |
| [缓] 落后 minor/patch | 12 | element-plus、sass、biome、esbuild、semver、ws(死依赖)、axios、envinfo、chardet、monaco(跨12个minor) |
| [新] 已是最新 | 45 | cosmokit、@satorijs/* 全系、schemastery-vue、d3-force、vue(3.5.42 在范围内) |
| [预] 最新版为预发布 | 2 | cordis(4.0.0-rc.8)、@maikolib/vite-plugin-yaml(1.1.1-0) |
| [废] 弃用/死依赖 | 4 | @types/uuid(官方弃用)、@types/tar(官方弃用)、ws(未使用)、uuid(未使用) |

---

## 4. 声明与实际使用不一致问题清单

1. **死依赖**:`ws`、`uuid`(+`@types/uuid`)声明于 `plugins/webui/console`,源码零导入(WebSocket 服务由 `@koishi-ce/plugin-server` 提供);`throttle-debounce` 声明于 explorer 但未使用;`ns-require` 声明于 web/client 与 market 但未使用。
2. **幽灵依赖(使用了却未声明)**:`apps/online` 导入 `koa`、`@koa/router`、`vite`、`@maikolib/vite-plugin-yaml`、`js-yaml`、`tsconfig-utils`、`yakumo`(类型)但均未写入其 package.json,依赖 hoisting 存活——Bun workspaces 下有静默失效风险。
3. **仅类型残留**:`yakumo ^1.0.0-beta.16` 只为 `PackageJson` 一个类型而存在(koishi-scripts/src/index.ts)。
4. **历史残留物**:多数插件 package.json 仍带 `"lint": "eslint src --ext .ts"` 脚本但 ESLint 已移除;`packages/web/client/.eslintrc.yml` 残留;`packages/node/core/lib/` 为上游旧构建产物(内部仍引用 `@koishijs/*` 旧名);`packages/utils/node_modules` 空目录;`NOTICE`/`UPSTREAM.md` 引用的 `LICENSES/` 目录不存在。
5. **peerDeps 指向上游属刻意设计**(见 ·1),非缺陷。

---

## 5. package.json 之外的技术栈

- **TypeScript**:`tsconfig.base.json` — target es2022 / module esnext / `moduleResolution: bundler` / `emitDeclarationOnly + composite` / 仅 `strictBindCallApply`(未开全 strict)/ jsx react-jsx(`jsxImportSource: @satorijs/element`)/ `types: ["yml-register/types"]`。根 `tsconfig.json` 用 **paths 别名**把全部 35 个 `@koishi-ce/*` 包指向各自 `src/`(无 project references);`tsconfig.client.json` 供 Vue 客户端代码(`jsx: preserve`、`moduleResolution: node`)。
- **构建**:无 vite/unocss 配置文件,构建逻辑全在 TS 脚本(`packages/web/client/scripts/client.ts` 及 `src/index.ts` 暴露 `build(root)` API、`src/bin.ts` 暴露 `koishi-console` CLI);node 侧走向 zero-build(部分包 exports 直指 `src/`,部分仍指 `lib/`)。`apps/create-koishi-ce` 与 `apps/koishi-scripts` 用 `tsc -b` 构建。
- **Lint**:Biome 2.x,根脚本 `lint`/`format`;未提交的 biome.json 修改新增了排除 `**/lib/**` 与 `*.tsbuildinfo`。
- **测试**:mocha 风格 `tests/*.spec.ts`(core/loader/utils/i18n-utils/common 插件/admin/commands),chai + chai-shape + chai-as-promised,内存库驱动跑数据库用例;**无 .mocharc、无任何 test 脚本**,README 承认测试尚未在 Bun 上完整跑通。
- **部署**:`apps/online` 经 `vercel.json` 部署(网站 + Online Loader)。
- **版本管理**:固定版本号手动维护(上游 yakumo version 的替代物尚未建)。

---

## 6. 结论摘要

1. 依赖分为两个世界:**cordis 生态运行时**(cordis/minato/@cordisjs/@satorijs/@koishijs 上游 peer)整体冻结在上游 koishi 4.18 配套线上,受上游节奏约束;**独立工具链**(构建、前端、CLI、测试)落后主流 2~3 年,存在 38 个 major 级跳版空间。
2. 前沿断点:vite 已到 8、TypeScript 已到 7(原生编译器)、vue-router 5 / vue-i18n 11 / @vueuse 14 / echarts 6 / unocss 66 均已稳定——「最现代」目标可一步到位。
3. cordis 4 / minato 4 / @cordisjs 1.x 生态跳版是最大的破坏性变更,且 cordis 4 尚处 RC,需单独决策。
4. 存在 4 项弃用/死依赖与一批幽灵依赖、历史残留,应先行清理。

后续行动见 **[upgrade-plan.md](upgrade-plan.md)**。
