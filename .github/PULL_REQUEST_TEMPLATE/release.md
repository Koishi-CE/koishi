# SPDX-License-Identifier: MIT
# Copyright (c) 2026-present Koishi-CE contributors.

# PR 说明（发布）

- **本仓一切改动都走 PR，禁止直推 `main`**：PR 由维护者合并，AI / agent 产出的 PR 不自审自并。规矩见根 `AGENTS.md` 的 git 提交流程节与 `docs/guides/development.md` 的 PR 工作流节。
- 本模板用于**发版侧的改动**（发布链代码、changesets 配置、包元数据 / files / exports / bin）。**真正的发版动作不走 PR**：`bun run release pipeline --push` 的版本提交与推送 `main` 是全仓唯一允许直推的路径，见 `docs/process/release.md`。
- 标题与正文一律简体中文，标题用提交信息风格（`build(release): ……`）。
- 空章节写「无」，不要删标题——便于对账。

## 1. 改了什么

<!-- 改的是发布链哪一环（preflight / version / build / publish / push）、changesets 配置、还是某包的发布面字段。 -->

## 2. 发布面影响

- 涉及包（包名 → 是否可发布 → 是否在 changesets ignore 名单）：
- 影响的字段：files / exports / main / types / bin / peerDependencies
- shim 四包与 vendored 三包是否被波及（应为「否」，是则说明依据）：
- 是否需要先于其它包发布（顺序约束，如 console-shim 先于 create-koishi-ce）：

## 3. 验证

- [ ] `bun run check` 全绿
- [ ] `bun run test` 全绿（发布链代码有既有回归用例：`tooling/release/core/workspace.test.ts`）
- [ ] `bun run build` 通过
- [ ] `bun run release status` 输出符合预期
- [ ] `bun run release build` 通过（前端产物发布前现构建）
- [ ] 打包面预演：`bun pm pack` 或 `bun run sandbox --pack`（改动 files / exports / bin 时必做）
- [ ] 发布链改动做过 `--dry-run`

## 4. changeset

<!-- 发布链 / 配置类改动通常「无」；若顺带改了包行为，按对应领域模板说明。 -->

- 无

## 5. 影响面与风险

<!-- 发布面回归的后果（下游解析失败 / 缺前端 / 协议残留）、发布链幂等性是否仍成立、回滚方式与是否需要补发。 -->

## 6. 关联

<!-- 相关事故记录（`docs/process/release.md` 第 6 节）、上游发布方式变化、相关 issue；无则写「无」。 -->
