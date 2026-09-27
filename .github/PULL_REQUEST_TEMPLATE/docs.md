# SPDX-License-Identifier: MIT
# Copyright (c) 2026-present Koishi-CE contributors.

# PR 说明（文档）

- **本仓一切改动都走 PR，禁止直推 `main`**：PR 由维护者合并，AI / agent 产出的 PR 不自审自并。规矩见根 `AGENTS.md` 的 git 提交流程节与 `docs/guides/development.md` 的 PR 工作流节。
- 标题与正文一律简体中文，标题用提交信息风格（`docs: ……`）。
- 空章节写「无」，不要删标题——便于对账。

## 1. 改了什么

<!-- 文件清单 + 每处改动的要点；改章节号 / 标题时点名受影响的引用点。 -->

## 2. 为什么这样写

<!-- 依据是实际代码、命令实跑输出还是用户裁定；推断出来的结论标注为推断。文档滞后于代码时明确「以代码为准」的边界。 -->

## 3. 验证

- [ ] `bun tooling/checks/docs-links.ts` 通过（相对链接与锚点；改动章节号后必跑）
- [ ] 文中命令 / 路径 / 文件名逐条核对存在（引用的脚本、配置、包名）
- [ ] 改章节号或标题后，全仓检索并回改了 `§N` 形式的引用
- [ ] `bun run check` 全绿（若同时改了代码 / 配置）

## 4. changeset

无（文档改动不面向发布；若同时改了包行为，按对应领域模板说明）。

## 5. 影响面

<!-- 面向谁（贡献者 / 下游使用者 / 未来 agent）、会不会改变既有流程的强制力；docs 分层规则见 docs/README.md「文档组织约定」。 -->

## 6. 关联

<!-- 相关 issue / 代码改动 PR / 上游文档（见 docs/process/upstream.md）；无则写「无」。 -->
