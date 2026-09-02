# 规划路线（roadmap）

> **状态：讨论稿（草案，2026-09-02 起草）**——条目尚未经维护者逐条确认，不构成对外承诺；确认后逐项转入执行并滚动更新状态。
> 素材全部来自仓库实证（决策档案、git 历史、代码标记与目录实况），每条标注**目标 / 状态 / 依据**，可溯源。
> **本文结构**：1 阻塞项 · 2 进行中 · 3 计划与候选 · 4 近期收尾池。

## 1. 阻塞项（等待外部条件）

### 1.1 cordis 生态 4.x 跳代（Phase 5 重启）

- **目标**：cordis / minato / @cordisjs/* 整体升入 4.x / 1.x 内洽线，并以 tsdown 从 `@cordisjs/plugin-server` 1.x 重建 vendored `plugins/infra/server`。
- **状态**：阻塞。2026-08-27 实证：`@satorijs/core@4.6.0` 内部携带 cordis ^3（无 cordis 4 线），同进程双 DI 容器并存、服务注入互相不可见，14/20 测试文件失败，已整体回退至 3.x 内洽线。
- **重启条件（满足其一）**：`@satorijs/core` 发布依赖 cordis 4 的版本（哪怕 next / beta tag）；或上游 koishi 官方启动 cordis 4 迁移；或本仓决定自建 `@satorijs/core` fork（工作量大，需单独立项）。
- **依据**：[decisions/upgrade-plan.md](decisions/upgrade-plan.md) Phase 5 节；AGENTS.md 硬性约束 3。

### 1.2 `@koishijs/*` 上游冻结包跟随

- **目标**：`@koishijs/plugin-database-memory`（测试）、`@koishijs/assets`（analytics dev）、`@koishijs/plugin-server-proxy`（console 类型引用）、npm 包 `@koishijs/market`（market client）随上游发布节奏跟进。
- **状态**：跟随上游——无法自主升级（上游冻结），其余依赖不受影响。
- **依据**：[decisions/dependency-audit.md](decisions/dependency-audit.md) §2A；AGENTS.md 硬性约束 2（导入例外清单）。

## 2. 进行中

### 2.1 依赖面原生化精简

- **目标**：能用 Bun / node 原生能力替代的外部依赖持续删除，压缩依赖面与安全审计面。
- **状态**：进行中。近期已移除：execa / p-map（d236e27）、envinfo / which-pm-runs（4b07454）、create-koishi-ce 的 yargs-parser / tar / prompts / kleur（5b65d63 等，改 Bun 内置 + @clack/prompts + giget）。
- **后续候选**（升级计划书立项时明确「顺带评估 / 后续可选」的遗留项）：`fs-extra` → `node:fs/promises`（koishi-scripts）；`dotenv` → Bun 原生 .env 加载（loader）。
- **依据**：git 历史代表提交如上；[decisions/upgrade-plan.md](decisions/upgrade-plan.md) Phase 1。

## 3. 计划与候选

### 3.1 CI 门禁流水线

- **目标**：`bun run check` / `bun test` / `bun run build` 进 CI，PR 与 main 的门禁自动化。
- **状态**：候选。仓库当前无 `.github/workflows`，门禁全靠本地自觉；「无 CI」在立项审计时即被记录，至今未补。
- **依据**：`.github/` 目录实况；[decisions/dependency-audit.md](decisions/dependency-audit.md) §1。

### 3.2 上游同步常态化

- **目标**：对上游 koishi / webui 的 release 线做周期性跟踪与差异审计，port 从「被动响应」转为「主动巡检」。
- **状态**：候选。现行流程为按映射表手动 diff 移植，无固定节奏。
- **依据**：[process/upstream.md](process/upstream.md)；AGENTS.md「上游同步」条目。

### 3.3 tsc6 legacy 类型检查通道退役评估

- **目标**：评估根脚本 `typecheck:legacy`（tsc6 通道）是否仍有保留价值，可退役则删。
- **状态**：候选（仅评估，不预设结论）。现行类型检查走 TS7（`bun run typecheck`）；根 `typescript` 双版本仅因 @typescript-eslint/parser 尚不支持 TS7 而保留。
- **依据**：根 package.json scripts；AGENTS.md「TS 双版本策略」；[guides/development.md](guides/development.md) §3。

## 4. 近期收尾池（backlog）

体量小、暂不成线的待办，随手机会清掉：

- `packages/node/core/src/command/command/command.ts:110`：FIXME——空 action 列表会无限循环，现以提前返回规避。
- `plugins/webui/market/src/node/installer.ts:403`：TODO——`Installer.Config` 的 `.hidden()`。
- 根 README 的规模数字（46 包 / 97 测试文件 / 约 99.8% 覆盖）为写死数据，随仓库演进需复核——组织约定要求不写死漂移数据，存量例外待消化。
- 工作区进行中的修复线（截至 2026-09-02 的 git 实况）：registry 的 `resolvePackageJson` 补 `baseDir` 锚点、loader 停机期日志防御、各包 tsconfig 手工 paths 块回填——待提交收尾。
