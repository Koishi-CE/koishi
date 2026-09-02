# Changesets

本仓库用 [Changesets](https://github.com/changesets/changesets) 管理全部 workspace 包的版本号与 CHANGELOG。发布链编排见 `tooling/release/`（`bun run release --help`）。

## 日常流程

1. **改动代码后**：跑 `bun run changeset`，按提示选择受影响的包与 bump 类型（patch / minor / major），写一段变更说明——会在本目录生成一个 md 条目，随代码一起提交。
2. **发布**：跑 `bun run release pipeline`（一条龙：preflight → 消费条目升版本 → 提交 → 构建 → 测试 → 发布；加 `--push` 末尾推送 main，加 `--dry-run` 只看计划）。
   也可分环执行：`bun run release status` / `version` / `build` / `publish`。

## 版本号约定

- 各包版本**镜像上游**（[koishijs/koishi](https://github.com/koishijs/koishi) 与 [koishijs/webui](https://github.com/koishijs/webui)）：移植上游发版时 bump 到与上游一致的版本号；叠加社区补丁时在其上 patch 递增。
- **连带规则**（changesets 标准行为）：被 bump 包的 `workspace:*` 依赖方会自动 patch +1 并写 "Updated dependencies" 条目——这样发布后依赖方的 caret 范围才能覆盖新依赖版本。若个别包需要与上游版本严格对齐，可在 `changeset version` 之后、发布之前手工改回（版本变化尚未 push，重跑发布链幂等）。
- 内部依赖一律 `workspace:*`；`changeset version` 不改写它，发布时由发布工具临时改写为 caret 真实版本（发布后还原，不落盘）。
- `peerDependencies` 一律指向 CE 包名（`@koishi-ce/koishi`、`@koishi-ce/plugin-console` 等，勿写回上游名，见 AGENTS.md 硬性约束）。根包名 `koishi` 与上游包名撞名，故 `bumpVersionsWithWorkspaceProtocolOnly: true`（内部关联只认 workspace: 协议）且 `ignore` 掉根包，防止误连带与误报警告。
