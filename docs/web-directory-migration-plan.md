# packages/web 目录规范化迁移方案

> 状态：**方案稿，未实施**（按 `packages/web` 现代化改造任务书阶段 5 的约定，本文档只出方案不动手）。
> 前置条件：`plugins/webui/market/` 迁入对齐完成（解除 .gitignore、用例迁移为 `*.spec.ts`）后，单独立项执行。
> 撰写日期：2026-08-29。事实基线：commit `a54007f`（阶段 1–4 已落地区域，见 §5）。

## 1. 问题清单

| # | 问题 | 现状位置 | 痛点 |
|---|------|----------|------|
| 1 | `client/client/` 双层嵌套 | `packages/web/client/client/` | `@koishi-ce/client` 包内的运行时库真身目录与包名撞车，路径表述（"client 包的 client 目录"）与心智负担；与 `app/`、`src/` 并列时语义不清 |
| 2 | scss / yml 混布在 `app/` 根 | `app/index.scss`、`app/home/welcome.{zh-CN,en-US}.yml` | yml 文案散在页面目录而非集中 locales；根级样式与 `styles/` 目录并存 |
| 3 | components 的空壳 `src/` | `packages/web/components/src/index.ts`（0 行） | 仅为 `tsconfig.base` 的 paths 落点而存在，误导后来者以为有 node 侧源码 |
| 4 | （衍生）宿主总装脚本游离于 `src/` 之外 | `packages/web/client/scripts/client.ts` | 已被 bin.ts 动态引入纳入类型检查（阶段 1），但目录位置仍是历史遗留 |

## 2. 现状布局

```
packages/web/client/                 @koishi-ce/client（AGPL）
├── app/                             宿主控制台应用（vue + scss + yml）
│   ├── home/welcome.{zh-CN,en-US}.yml   ← 问题 2：文案混在页面目录
│   ├── index.scss                       ← 问题 2：根级样式
│   ├── styles/{index,layout,element,hc}.scss + index.ts
│   └── ...（home/layout/settings/status/theme + shims.d.ts + tsconfig.json）
├── client/                          运行时库真身        ← 问题 1：双层嵌套
│   ├── index.ts / context.ts / data.ts / utils.ts
│   ├── components/ plugins/ shims.d.ts tsconfig.json
├── src/{index,bin,yakumo}.ts        node 侧（构建器 + CLI + 兼容入口）
├── scripts/client.ts                宿主总装脚本        ← 问题 4
├── global.d.ts  tsconfig.json  tsdown.config.ts
packages/web/components/             @koishi-ce/components（AGPL）
├── client/                          真身（components/form/virtual/... + 三载体）
├── src/index.ts                     0 行空壳            ← 问题 3
└── tsconfig.json  tsconfig.client.json
```

## 3. 目标布局（推荐方案）

> 原则：**只调包内目录，不改包名、不动 `<插件>/client/` → `dist/` 的全生态约定**。
> 全部 148 个 webui 插件 client 文件对 `@koishi-ce/client` 的导入都是包名级（其中 gitignored 的 market 占 83 个），包名不变则插件生态零改动——这是整个迁移的最重要的边界。

```
packages/web/client/
├── app/
│   ├── locales/welcome.{zh-CN,en-US}.yml   ← yml 集中（对齐全仓 locale 约定）
│   ├── styles/...                          ← 根级 index.scss 并入
│   └── ...
├── runtime/                         ← client/client 改名，消除双层
├── src/、scripts/、global.d.ts、...   （维持现状；scripts 归位可并入同一提交）
packages/web/components/
├── client/                          （维持现状）
└── （src/ 空壳删除，tsconfig.base paths 改指 client）
```

不推荐将 `client/client` 上提为独立包（如 `@koishi-ce/runtime`）：消费方靠 vite 别名按**源码**消费（exports `.` 的 `default` 直指 `client/index.ts`，`collectWorkspaceAliases` 亦按 `client/index.ts` 探测），拆包引入新的 workspace 包与 peer 关系，收益不抵扰动。目录改名即够。

## 4. 耦合面盘点（迁移必改清单）

### 4.1 `client/client` → `client/runtime`（步骤 A）

| 耦合点 | 位置 | 必改内容 |
|--------|------|----------|
| 总装入口硬编码 | `scripts/client.ts`（input ×2 处） | `cwd + "/packages/web/client/client/index.ts"` → `runtime/` |
| 别名探测逻辑 | `src/index.ts` `collectWorkspaceAliases()` | `clientEntry = dir/client/index.ts` 的探测约定：本包自身改为 `runtime/`，**各插件仍探测 `client/`**（两条规则并存或包名特判，注释写明） |
| vite 别名 | `src/index.ts`（build / createServer）、`scripts/client.ts` | `@koishi-ce/client` 相关别名的目标路径随迁移调整 |
| 项目内 tsconfig | `client/client/tsconfig.json` | 随目录移动（extends 相对层级从 4 级变 4 级不变，include `.`） |
| shims 引用链 | `client/client/shims.d.ts` ← `app/shims.d.ts` | 相对引用 `../client/shims.d.ts` → `../runtime/shims.d.ts` |
| 三载体（§5） | `tsconfig.client.json` paths、`components/client/{schemastery-vue-client,schemastery-vue-runtime}.ts`、form/index.ts 注释 | 载体文件在 components 包，不受本步影响；但运行时载体推导（`src/index.ts` 的 `runtimeShimPath` 从 workspaceAliases 替换而来）需复测 |
| eslint glob | `eslint.config.ts` `"packages/web/*/client/**/*.vue"` | 双层嵌套消除后此 glob 同时覆盖 `client/runtime` 与各插件，**反而简化**；迁移期先确认 `client/client` 原本就靠它匹配 |
| biome | `biome.json` | 无 packages/web 专属 override（已复核），仅需跑 `bun run format` |
| 文档 | `AGENTS.md`、`docs/{ARCHITECTURE,DEVELOPMENT,dependency-audit,upgrade-plan}.md` | 全部 `client/client`、`packages/web/client/client` 表述 |

### 4.2 `app/` 资产归位（步骤 B）

| 耦合点 | 位置 | 必改内容 |
|--------|------|----------|
| yml 导入 + HMR | `app/home/welcome.vue`（`import ... from "./welcome.*.yml"` + `import.meta.hot.accept("./welcome.*.yml", ...)` ×2） | 改为 `../locales/welcome.*.yml`（accept 的相对路径同步） |
| 根级样式 | `app/index.scss` 的引用方（`app/index.ts` 或 index.html） | 并入 `styles/` 聚合入口 `styles/index.ts` |
| yaml 插件 | 仍由 `@maikolib/vite-plugin-yaml` 处理 | 无改动（浏览器管线必需，阶段 2 结论） |

### 4.3 components 空壳 `src/` 删除（步骤 C）

| 耦合点 | 位置 | 必改内容 |
|--------|------|----------|
| node 侧 paths 落点 | `tsconfig.base.json` `"@koishi-ce/components": ["./packages/web/components/src"]` | 改指 `./packages/web/components/client`（浏览器源码入口；node 侧本无消费者，仅 paths 兜底） |
| exports source 条件 | `packages/web/components/package.json` `"source": "./src/index.ts"` | 改 `"./client/index.ts"`（与 `.` 的 `default` 一致） |
| 空项目 tsconfig | `packages/web/components/tsconfig.json`（include `["src"]`） | 删除（`client/tsconfig.json` 已独立覆盖真身；typecheck.mjs 扫描面 -1） |
| workspace 探测 | `collectWorkspaceAliases` 的 `existsSync(dir/src)` 分支 | components 不再有 `src/`，裸包名落到 `client/index.ts`——与现状行为一致（现状 clientEntry 存在即优先），确认即可 |

### 4.4 不受影响但必须复验的面

- **148 个插件侧 `@koishi-ce/client` 导入**：包名级，零改动（含 market 的 83 个）。
- **plugin-console node 侧**：`require.resolve("@koishi-ce/client/package.json") → "../app"`、`require("@koishi-ce/client/lib")`（dev 模式）——按包解析，目录内改名不影响，但步骤 A 后要实测 dev 模式 createServer。
- **根 tsdown**：workspace `packages/web/*` 模式与子包 `tsdown.config.ts` 不受包内目录影响。
- **`plugins/webui/*/client/` → `dist/` 产物约定**与 plugin-console 的 `transformImport` 改写（`../client.js` 等相对引用）：完全不动。

## 5. 阶段 1–4 已落地区域（本次改造引入的新事实）

迁移方案必须把阶段 1–4 引入的下列结构视为基线：

1. **`schemastery-vue/client` 虚拟子路径三载体**（阶段 1 建立）：
   - ambient 类型垫片 `components/client/shims.d.ts`（tsc 程序，经 form/index.ts 的 `/// reference` 传播；ambient 会遮蔽 paths 解析，且 `declare module` 内相对导出不可用，故必须全量内联）；
   - 真实类型载体 `components/client/schemastery-vue-client.ts`（**仅供 compiler-sfc**，经 `tsconfig.client.json` 的 paths 解析；与 ambient 互为镜像、必须同步修改）；
   - 运行时载体 `components/client/schemastery-vue-runtime.ts`（补齐真实包缺失的 `SchemaBase` 具名导出；被 components/client/tsconfig.json 显式排除于类型程序外；三个构建器的 vite 别名指向它，`src/index.ts` 的 `runtimeShimPath` 由 workspaceAliases 推导其绝对路径）。
2. **`koishi-console` CLI 无参语义**（阶段 1/2）：无 root 且 cwd 无 `client/` → 动态 import `scripts/client.ts` 执行宿主总装（tsdown 会将其打包为 lib 下的独立 chunk）。
3. **产物后处理**（阶段 3）：rolldown `minify(compress:false, mangle:false)` 替代已废弃的 `transformWithEsbuild`；`import.meta.dir` 定位（源码与产物到仓库根同为四级）。
4. **严格项基线**（阶段 4）：web 三项目已对齐 `tsconfig.base` 全部严格项并清零；全量推进到 tsconfig.client 的成本实测约 91 个新增错误（84 在 market），等 market 对齐后另行推进。

## 6. 迁移步骤（每步独立提交、独立可回退）

1. **步骤 A：`client/client` → `client/runtime`**（纯 `git mv` + §4.1 清单）
   验证门禁：`bun run check`（对照基线不新增）→ `bun run build` → `bun packages/web/client/src/bin.ts build`（宿主总装 10 文件）→ `... build plugins/webui/status`（单插件）→ `bun test packages plugins/common plugins/webui/admin plugins/webui/commands`；另实测 dev 模式 createServer 可起。
2. **步骤 B：app 资产归位**（§4.2 清单，改动面最小）
   验证门禁同上，重点看 welcome 页 yml 文案在产物中完整。
3. **步骤 C：components 空壳 src 删除**（§4.3 清单）
   验证门禁同上 + 全量 typecheck 项目数 -1。
4. **步骤 D（可选，独立立项）**：评估 `@koishi-ce/client` 拆分为 `client-builder`（vite 构建器 + CLI）与 `client-runtime`（浏览器运行时）两包，让插件 devDeps 不再拖入 vite/unocss 全家——本文档不展开。

回滚策略：三步均为独立提交的纯移动/路径修正，`git revert` 单提交即回退；最大风险是 `collectWorkspaceAliases` 与 eslint glob 的遗漏，症状分别是「插件构建解析失败（报 exports 条件错误）」与「lint 静默跳过」，都在门禁的显性覆盖内。

## 7. 时机

- **硬前置**：market 迁入对齐完成（AGENTS.md 硬性约束 7 解除）。原因：market 的 83 个文件是 `@koishi-ce/client` 最大消费方，迁移验证期需要它可被全量检查与构建。
- 建议顺序：market 对齐 → 全量严格项推进（§5.4 的 91 个错误清理）→ 本方案步骤 A–C。三者串行可避免基线反复横跳。
