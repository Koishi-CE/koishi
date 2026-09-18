# tooling/

本目录是本仓的**工程工具集**：服务于开发、门禁、发布与上游同步流程的 TypeScript 脚本，全部零第三方依赖、Bun 直跑。工具不进 npm 发布范围，也不被任何运行时代码消费——改动这里只影响开发 / 门禁 / 发布体验，不影响框架与插件本体。

## 通用约定

- **零第三方依赖**：只用 `node:*` 内置模块与 Bun 全局 API（`Bun.Glob` / `Bun.write` 等），不占 devDependencies；需要 CLI 语义（旗标 / 子命令）就自己解析 argv。
- **bun 直跑**：入口均为单文件脚本，优先经根 package.json 的 script 调用（`bun run sandbox` 等），也可直接 `bun tooling/<子目录>/<入口>.ts` 执行。
- **不进门禁 typecheck**：`tooling/` 不在任何 tsconfig include 内，目录下的 [tsconfig.json](./tsconfig.json) 仅供编辑器语言服务命中（打开文件即以正确配置出诊断）。
- **带回归测试**：有可测逻辑的模块在同级写 `*.test.ts`（现为 `sandbox/index.test.ts`、`release/core/workspace.test.ts`），随全仓 `bun test` 运行。
- **头部注释即文档**：每个入口脚本用 JSDoc 块写清用途与用法，本 README 只做索引——细节冲突时以脚本注释为准。

## 目录总览

| 子目录 | 调用方式 | 用途 |
| --- | --- | --- |
| [checks/](./checks/) | `bun run check:*`（已并入 `bun run check`） | 门禁检查脚本：词典 / 文档链接 / vue 类型基线 / 包纪律 |
| [release/](./release/) | `bun run release <命令>` | 发布一条龙：version / build / publish / pipeline |
| [sandbox/](./sandbox/) | `bun run sandbox` | 在工作区之外生成真实可运行的 koishi-ce 沙盒实例 |
| [upstream-audit/](./upstream-audit/) | `bun run upstream:audit` | 刷新上游仓库缓存，产出与本仓映射目录的对比底稿 |

## checks/ — 门禁检查脚本

四个零依赖脚本，均已并入 `bun run check`（门禁七段的构成见 [开发手册](../docs/guides/development.md)）：

| 脚本 | script 名 | 检查内容 |
| --- | --- | --- |
| locales.ts | `check:locales` | 词典键对齐（以 zh-CN 为基准）/ 语种齐全 / 假翻译（非中文语种的叶值仍为中文） |
| docs-links.ts | `check:docs-links` | docs 与根部门面 markdown 的相对链接与锚点存活 |
| vue-types.ts | `check:vue-types` | vue-tsc 影子基线闸门：.vue 全量类型错误只拦新增（`--update` 重拍同目录基线 JSON） |
| packages.ts | `check:packages` | 包名纪律（一律 `@koishi-ce/*`）/ 元数据统一 / ESM-only / 依赖方向 |

发现任何问题退出码置 1；具体规则与豁免清单见各脚本头部注释。

## release/ — 发布一条龙

版本由 changesets 管理，本工具编排发布链：

```bash
bun run release status             # 概览：pending changeset、本地版本 vs registry、发布序
bun run release version            # 消费 .changeset/ 条目（changeset version + 刷新 lockfile）
bun run release build              # 根 tsdown + 宿主控制台总装 + 各 webui 插件前端 dist
bun run release publish            # registry 比对 → 所有权预检 → 拓扑序逐包 npm publish
bun run release pipeline           # 一条龙：preflight → version → 提交 → build → test → publish（--push 再推 main）
```

常用旗标：`--dry-run` 只打印计划；`--only <包名>` 补发漏发 / 重发坏版本；`--allow-dirty`、`--skip-build`、`--skip-test` 跳过对应检查。任何一步失败立即中断并保留现场，重跑幂等。

铁律：**一切发布走本发布链，禁止手动 `npm publish`**（历史上绕链发布把 `workspace:*` 原样带上 npm，下游全炸）。流程与约定详见 [发布流程](../docs/process/release.md)。

## sandbox/ — 外部沙盒实例生成器

在工作区之外生成由本仓 workspace 包组成的可运行实例，用于「先测试再发包」：数据写回、市场装插件等运行时副作用全部落在沙盒目录，工作区零污染。

```bash
bun run sandbox [目录]             # 链接模式（默认）：为 workspace 包建 junction，改 src → build 后实例即刻生效
bun run sandbox [目录] --pack      # 打包模式：逐包 bun pm pack → 真实 bun install（发布物终验，预演发布面）
bun run sandbox -- --force         # 清空重建（仅限本工具生成的目录）
bun run sandbox -- --start         # 生成完成后立即在本进程前台拉起实例
```

默认落点为工作区同级 `koishi-ce-sandbox`。两种模式的机理、已知坑与启动方式详见 [开发手册 §9](../docs/guides/development.md)。与本仓 `plugins/webui/sandbox` 插件（控制台内嵌调试沙盒）无任何关系。

## upstream-audit/ — 上游巡检

对比上游仓库与本仓的映射目录，产出 markdown「底稿」：单侧存在的文件、共同文件的 diff 改动量排行。是否 port、是否本仓刻意分叉的语义判断由人工完成：

```bash
bun run upstream:audit               # 刷新上游缓存（浅克隆 / pull）并输出底稿
bun run upstream:audit --no-refresh  # 只对比不联网
bun run upstream:audit --only webui  # 只处理名称含该子串的上游
bun run upstream:audit --out <file>  # 底稿写入文件而不打印 stdout
```

上游源码一律克隆到仓库之外的缓存目录（默认 `../cache/upstream`，环境变量 `KOISHI_CE_UPSTREAM_CACHE` 可改写）。映射表、巡检流程与判定标准见 [上游同步](../docs/process/upstream.md)。

## 新增工具时

- 放进对应主题子目录（或新建子目录），单文件入口 + 头部 JSDoc 写清用法（现有脚本即模板：SPDX 头 + 用法块）。
- 遵守通用约定：零第三方依赖、bun 直跑、可测逻辑配 `*.test.ts`。
- 高频入口挂到根 package.json 的 scripts：门禁类命名 `check:*`，流程类用动词（如 `sandbox`、`upstream:audit`、`release`）。
- 相关流程落在 docs/ 时，回本 README 补一条索引。
