# SPDX-License-Identifier: MIT
# Copyright (c) 2026-present Koishi-CE contributors.

# PR 说明（新特性 / 功能增强）

- **本仓一切改动都走 PR，禁止直推 `main`**：PR 由维护者合并，AI / agent 产出的 PR 不自审自并。规矩见根 `AGENTS.md` 的 git 提交流程节与 `docs/guides/development.md` 的 PR 工作流节。
- 标题与正文一律简体中文，标题用提交信息风格（`feat(scope): ……`）。
- 空章节写「无」，不要删标题——便于对账。

## 1. 做什么 / 为什么

<!-- 目标场景与动机：解决谁的什么问题。若是对既有 API 的扩展，说明与既有能力的关系。 -->

## 2. 对外接口

<!-- 新增 / 变更的 API、Service、事件、配置项或控制台界面；破坏性变更单独点名并给迁移方式。 -->

- 新增：
- 变更：
- 破坏性变更：无

## 3. 实现要点

<!-- 关键设计决策与被否掉的替代方案；跨包改动列出涉及包名。 -->

## 4. 验证

- [ ] 新增用例：文件与用例名（覆盖主路径 + 边界）
- [ ] `bun run check` 全绿
- [ ] `bun run test` 全绿
- [ ] `bun run build` 通过
- [ ] 改了 webui 插件 / `.vue` 时重建对应前端产物
- [ ] 改了用户可见文案时同步 7 语种词典并通过 `check:locales`（豁免范围见 `docs/guides/development.md`）

## 5. changeset

<!-- 新能力 → minor；兼容性扩展 → patch；破坏性变更 → major（本仓 1.x 基线，破坏性须在 PR 说明理由）。不面向发布的私有包 → 「无」。 -->

- minor

## 6. 影响面与风险

<!-- 依赖方向是否仍单向、是否引入新的外部依赖、性能与体积影响、回滚方式。 -->

## 7. 关联

<!-- 相关 issue / 讨论 / 上游对应实现（见 docs/process/upstream.md）；无则写「无」。 -->
