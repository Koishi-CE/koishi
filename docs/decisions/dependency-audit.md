# 依赖与技术栈全量审计报告

> **快照日期**：2026-09-30（全量重拍，历史版本见 git 记录）
> **运行环境**：Bun 1.4.2（`bun.lock` v2）· Node v24.16.0（TS7 与 `vue-tsc` 宿主）
> **审计范围**：**54 个 `package.json`**（53 个 workspace 包 + 根）· **79 个外部依赖名**（全部实时对拍 npm `dist-tags.latest`）
> **关联文档**：[upgrade-plan.md](upgrade-plan.md) · [../guides/development.md](../guides/development.md) · [../reference/architecture.md](../reference/architecture.md)

---

## 1. 项目定位与目录速览

本项目为 `koishijs/koishi`（MIT）与 `koishijs/webui`（部分 AGPL-3.0）的文件级合并仓，作用域 `@koishi-ce`，仅目标 **Bun** 运行时。

- **目录分布（53 个子包）**：`packages/node` 核心（8）· `packages/web` 前端（4：app / builder / client / components）· `packages/shim` 占名（4，版本冻结）· `plugins/common`（8，`cron` 已迁出）· `plugins/infra`（8，含 http / proxy / server 三个预编译 vendored 包）· `plugins/webui`（19）· `apps`（2：`create-koishi-ce` / `@koishi-ce/scripts`）。
- **核心工程纪律**：
  - **上游名外部依赖为 0**：内部互引与 `peerDependencies` 一律使用 `@koishi-ce/* ^1.0.0`，防止 Bun 自动拉取官方全家桶。
  - **前端编程式构建**：无 Vite 配置文件，统一走 `vite.build()`（宿主入口 `packages/web/builder/src/bin.ts`）。
  - **CI 三任务（Turbo + OIDC 远程缓存）**：`gate`（build → 宿主前端 → 十段 check → test:ci + Codecov）、`client`（webui 插件打包）、`fallow`（死代码与依赖审计）。

---

## 2. 外部依赖清单（79 名）

### 2.1 重点关注项（7 名：6 项生态冻结 + 1 项双轨/死声明）

`cordis` 生态整体锁定在 **3.x 内洽冻结线**（受 `@satorijs/core` 内部依赖 `cordis ^3` 阻塞，Phase 5 重启条件见 `upgrade-plan.md`），属**刻意冻结**而非升级欠账，禁止单包升版：

| 包名 | 声明 | 使用位置 | 实装 | 最新 | 状态与说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `cordis` | `^3.18.1` | core · client · proxy · server | `3.18.1` | `4.0.0-rc.10` | **[预]** 冻结 3.x |
| `minato` | `^3.7.0` | core · memory · sqlite | `3.7.0` | `4.0.1` | **[旧]** 冻结 3.x |
| `@minatojs/sql-utils` | `^5.6.0` | sqlite | `5.6.0` | `6.0.0` | **[旧]** 冻结 3.x |
| `@cordisjs/plugin-http` | `^0.6.3` | infra/http | `0.6.3` | `1.5.2` | **[旧]** 冻结 3.x |
| `@cordisjs/plugin-server` | `^0.2.9` | infra/server | `0.2.9` | `1.7.0` | **[旧]** 冻结 3.x |
| `@cordisjs/plugin-server-proxy` | `^0.2.0` | webui/console (dev) | `0.2.0` | `1.2.1` | **[旧]** 冻结 3.x（替代上游薄壳防拉取官方包） |
| `typescript` | `npm:@typescript/typescript6@6.0.2` / `^5.0.0` | 根 · web/builder | `6.0.2` / `5.9.3` | `7.0.2` / `6.0.2` | **[缓]** 根包供 ESLint 解析；builder 的 `^5.0.0` 为待删死声明（§4.1） |

### 2.2 已追平 `latest` 的常规依赖（72 名，全部 `[新]`）

除上述 7 项外，其余 **72 个外部依赖实装版本均等于 npm `latest`**，无弃用包：

- **A. 生态运行时（9 名）**：`@cordisjs/plugin-proxy-agent` (`0.3.3`) · `@satorijs/core` (`4.6.0`) · `@satorijs/element` (`3.2.0`) · `@satorijs/protocol` (`1.7.0`) · `@satorijs/components-vue` (`0.7.8`) · `cosmokit` (`1.8.1`) · `reggol` (`2.1.0`) · `inaba` (`1.1.1`) · `fastest-levenshtein` (`1.0.16`)。
- **B. 前端与可视化（34 名）**：`vue` (`3.5.43`) · `vue-router` (`5.3.1`) · `vue-i18n` (`11.4.12`) · `@vueuse/core` (`15.0.0`) · `element-plus` (`2.14.7`) · `schemastery-vue` (`7.3.15`) · `marked` (`18.0.14`) · `dompurify` (`3.4.16`) · `unocss` (`66.10.5`) · `unplugin-icons` (`24.0.0`) · `echarts` (`6.1.0`) · `vue-echarts` (`8.3.1`) · `ansi_up` (`6.0.6`) · `d3-force` (`3.0.0`) · `lottie-web` (`5.13.0`) · `@noble/hashes` (`2.4.0`) · **CodeMirror 6 全家桶 18 包**（`codemirror` `6.0.2`、`@codemirror/{commands,language,legacy-modes,state,theme-one-dark,view}` 及 11 个 `lang-*` 语法包，全部最新）。
- **C. 构建与质量工具链（14 名）**：`vite` (`8.3.1`) · `@vitejs/plugin-vue` (`6.0.9`) · `sass-embedded` (`1.105.1`) · `tsdown` (`0.23.0`) · `@typescript/native` (`npm:typescript@7.0.2`) · `@biomejs/biome` (`2.5.14`) · `eslint` (`10.11.0`) · `eslint-plugin-vue` (`10.11.1`) · `@typescript-eslint/parser` (`8.71.0`) · `vue-eslint-parser` (`10.4.1`) · `@babel/code-frame` (`8.0.6`) · `@parcel/watcher` (`2.6.0`) · `@changesets/cli` (`3.0.3`) · `turbo` (`2.11.5`)。
- **D. CLI 与系统工具（8 名）**：`cac` (`7.0.0`) · `@clack/prompts` (`1.8.1`) · `picocolors` (`1.1.1`) · `open` (`11.0.4`) · `chardet` (`2.2.0`) · `file-type` (`22.1.1`) · `picomatch` (`4.0.7`) · `semver` (`7.8.5`)。
- **E & F. 测试与类型声明（7 名）**：`@types/bun` (`1.4.2`) · `@types/node` (`26.6.3`) · `jsdom` (`30.1.1`) · `@types/jsdom` (`30.0.0`) · `@types/d3-force` (`3.0.10`) · `@types/semver` (`7.8.0`) · `@types/picomatch` (`4.0.3`)。
- **G. 内部 Peer 声明（非外部依赖）**：`@koishi-ce/{koishi,plugin-console,console,loader,core,client,assets,console-app,console-builder}` 统一声明为 `^1.0.0`。

---

## 3. 新鲜度总览与体积口径

| 状态类别 | 数量 | 说明 |
| :--- | :--- | :--- |
| **[新] 实装即最新** | **72** | 除冻结线与 `typescript` 双轨外，所有外部依赖均已追平 `latest` |
| **[旧] 落后 major** | **5** | 全部属 `cordis` 3.x 冻结线（`minato` / `sql-utils` / `plugin-{http,server,server-proxy}`） |
| **[预] 最新为预发布** | **1** | `cordis`（`latest` tag 为 `4.0.0-rc.10`，属冻结线） |
| **[缓] 双轨/含死声明** | **1** | `typescript`（根包 alias 已是 `typescript6` 最新；builder 的 `^5.0.0` 为待删死声明） |
| **[废] 已弃用** | **0** | 79 名均无 npm `deprecated` 标记；旧测试栈与历史废弃包均已清退 |
| **合计** | **79** | **依赖名数 ≠ 产物体量**（如 CM6 拆为 18 包，但 explorer 产物从 13.55 MB 降至 0.72 MB） |

---

## 4. 依赖一致性与技术决策台账

> **编号契约**：`§4.9–§4.14` 被源码注释与 `../process/upstream.md` 引用，**严禁重排或挪用编号**；新增决策一律追加在 `§4.15` 之后。

- **4.1 builder 的 `typescript ^5.0.0` 死声明（P1 待删）**：`packages/web/builder` 源码零引用，却导致 `bun.lock` 产生唯一的仓内声明嵌套副本 `@koishi-ce/console-builder/typescript@5.9.3`（与 `vue-tsc` 隔离目录自举的 `5.9.3` 无关），可直接移除。
- **4.2 死代码与循环依赖清零**：`fallow@3.25.0`（固定精确版本防结果漂移）退出码为 0，循环依赖设为 error 级门禁。
- **4.3 Range 多形态漂移（P2 待收敛）**：`vue`、`vue-router`、`vue-i18n`、`element-plus` 在不同子包存在多形态低界（如 `vue` 同时有 `^3.5.42` 与 `^3.5.12`），实装已统一，待收敛声明面（`peerDependencies` 的宽泛声明保留）。
- **4.4 无幽灵依赖**：`fallow` 与 `check:packages` 双重把关；全仓唯一目录名与包名不一致处为 `apps/koishi-create` ↔ `create-koishi-ce`。
- **4.5 静态导入豁免（`.fallowrc.jsonc`）**：仅豁免运行期按名解析（vendored / shim 包）或编译期虚拟模块（`~icons` 等）；历史遗留的 `@satorijs/element` / `pg-like` / `vue-i18n` 豁免待清理。
- **4.6 Peer 指向 CE 名**：属硬性约束，防止下游安装时拉取官方包，Dependabot 已整体忽略。
- **4.7 保留 `semver`（不可替换）**：`Bun.semver` 无法在浏览器端（market 前端）运行，缺少 `intersects` API，忽略 `includePrerelease` 参数，且 `satisfies(x, "*")` 与 `valid(x)` 在 `=1.2.3` / 预发布号上语义不等价。
- **4.8 `bun-types` → `@types/bun`**：`bun-types` 并未废弃（两者类型内容完全一致），迁移旨在对齐 Bun 官方默认约定，各 `tsconfig` 已显式隔离 `types`。
- **4.9 Explorer 路径过滤（`anymatch` → `picomatch@4.0.7`）**：消除 CJS/ESM 类型错位导致的 `as unknown as` 断言并减除 3 个传递包；注意 `picomatch 4` 必须显式传入 `windows: process.platform === "win32"`。
- **4.10 Explorer 编辑器（`monaco-editor` → CodeMirror 6）**：剔除 Monaco 未启用的 9.15 MB 语言服务 Worker，构建产物由 **13.55 MB / 97 文件降至 0.72 MB / 23 文件**，支持 21 种语法按需加载。
- **4.11 `@vueuse/core` 14 → 15**：仓内使用的 13 个符号无破坏性变更；`element-plus` 2.14.7 已解除对 14.4.0 的锁死，全仓仅存 15.0.0 单一副本。
- **4.12 Market 头像摘要（`spark-md5` → `@noble/hashes`）**：移除无类型老旧 UMD 包；**刻意保留同步 MD5 而非 SHA-256**，因实测默认镜像 `cravatar.cn` 对 SHA-256 返回 404，且局域网 HTTP 无 `crypto.subtle`。
- **4.13 `k-markdown` 收回自持（移除 `marked-vue`，`marked` 9 → 18）**：将停更的 `marked-vue` 源码内联至 `components` 并登记 MIT 溯源，`marked` 升至 18 修复 16 处解析边界与 ReDoS（minify 体积 +10.0 KB）；因多语言切换在客户端且需行内模式，不采用服务端 `Bun.markdown` 预渲染。
- **4.14 `k-markdown` 消毒层（`xss` → `dompurify`）**：替换停更的手写消毒层（minify 体积 +10.3 KB），显式关闭 `ALLOW_DATA_ATTR` / `ALLOW_ARIA_ATTR` 并维持禁 `img` 防第三方插件追踪像素泄露 IP；测试期选用 `jsdom`（实测 `linkedom` 不工作、`happy-dom` 误删全部标签）。
- **4.15 统一取舍判据**：同能力下优先「更小、更少、更活跃」，单指标劣化（如 CM6 包名数增加、DOMPurify 字节数微增）服从于整体体积与安全性收益；`giget` → `Bun.Archive` 与 `@cordisjs/plugin-server-proxy` 替换亦遵循此原则。

---

## 5. 工具链与质量基线（实测快照）

| 维度 | 当前实况与基线数据 |
| :--- | :--- |
| **TypeScript 三轨** | ① 类型检查：`@typescript/native`（TS 7.0.2，node + web 双工程）· ② ESLint 解析：`@typescript/typescript6@6.0.2` · ③ `.vue` 影子闸门：`vue-tsc@3.3.11` + 自举 `TS 5.9.3` |
| **十段门禁 (`check`)** | Biome + ESLint (`.vue`) + TS7 + 6 个自研检查（`locales` / `docs-links` / `vue-types` / `assertions` / `packages` / `console-wiring` / `pr-templates`） |
| **测试规模** | `bun run test`（`--isolate`）：**133 文件 / 1082 用例 / 2957 断言 / 0 失败**（约 50s） |
| **覆盖率（双口径）** | ① `bun test --coverage`：**93.72% 行 / 96.1% 分支** · ② `test:ci` lcov：全量 **93.05%**（排除 `tooling/` 与 `vendor/` 为 **94.15%**；纯 `src/` 为 **94.31%**） |
| **技术债基线** | `vue-types-baseline.json`：**31 条** · `assertions-baseline.json`（`as unknown as`）：**17 处**（均只拦新增） |
| **锁文件规模** | `bun.lock` 共 **781 条**解析项（非 `@koishi-ce/*` 729 条，同名多版本嵌套 40 条） |
| **自动化更新与发布** | Dependabot 每周一更新 minor/patch（已屏蔽冻结线、内部包与 major，CI 设锁文件降级守门）；发布走 Changesets + npm OIDC 可信发布 |

---

## 6. 待办可执行项

| 优先级 | 事项 | 验收标准 |
| :--- | :--- | :--- |
| **P1** | 删除 `packages/web/builder` 的 `typescript ^5.0.0` 死声明 | `bun.lock` 中 `@koishi-ce/console-builder/typescript` 消失；全量构建、宿主前端重建、check 与测试全绿 |
| **P2** | 统一 `vue` / `vue-router` / `vue-i18n` / `element-plus` 的 Range 声明，对齐 `jsdom` 与 `@types/jsdom` 声明位置，清理 `.fallowrc.jsonc` 遗留豁免 | 同字段 Range 单一化；`check`、`fallow` 与 `build` 全绿 |
| **P2** | 固化覆盖率统计口径 | 文档与 CI 注释统一采用 §5 的两条可复现命令，废弃旧版不可复现的「97%」口径 |
| **P3** | 收敛跨文档快照数字 | `AGENTS.md` 与 `architecture.md` 移除旧测试/覆盖率数字，统一指向本文档 §5 |

---

## 7. 审计复现方法与避坑指南

1. **四步采集法**：① 扫描 54 个 `package.json` 剔除内部包得 79 名 → ② 解析 `bun.lock` 的 `packages` 段获取实装版本与嵌套副本 → ③ 请求 `https://registry.npmjs.org/<name>` 获取 `dist-tags.latest` 与 `deprecated` 状态 → ④ 对照冻结线白名单（**§2.A / §4.15**）归类统计。
2. **排查避坑**：
   - **勿信磁盘目录**：`node_modules/.bun/` 含历史残留（如旧版 `vue@3.5.42`），实装图谱一律以 `bun.lock` 为准。
   - **展开 `npm:` 别名**：查询 `typescript` 与 `@typescript/native` 时需按 alias 右侧真实包名请求 registry。
   - **元数据格式**：拉取包发布时间需使用完整 registry JSON，勿用 `install-v1+json` 缩写头。
