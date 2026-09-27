# SPDX-License-Identifier: MIT
# Copyright (c) 2026-present Koishi-CE contributors.

# PR 说明（依赖更新与上游同步）

- **本仓一切改动都走 PR，禁止直推 `main`**：PR 由维护者合并，AI / agent 产出的 PR 不自审自并。规矩见根 `AGENTS.md` 的 git 提交流程节与 `docs/guides/development.md` 的 PR 工作流节。
- 标题与正文一律简体中文，标题用提交信息风格（`chore(deps): ……` / `chore(upstream): ……`）。
- 空章节写「无」，不要删标题——便于对账。
- Dependabot 自动开的 PR 也走本口径：手工复核后按下方逐条勾选补全说明。

## 1. 类型与范围

- [ ] 依赖升版（minor / patch）
- [ ] 依赖升版（major，已按 `docs/decisions/dependency-audit.md` 评估）
- [ ] 依赖替换 / 新增 / 移除
- [ ] 上游 port（按 `docs/process/upstream.md` 映射表手动 diff 移植）

涉及依赖（名 → 旧版本 → 新版本）：

## 2. 改动内容

<!-- 依赖类：声明位置（哪些 package.json）+ bun.lock 是否随之变化。上游类：上游 repo#ref 与 port 了哪些文件，逐字对齐还是语义评估后移植。 -->

## 3. 冻结线与纪律复核

- [ ] 未触碰 cordis 生态 3.x 内洽冻结线（cordis / minato / @cordisjs/* / @satorijs/*），或已确认不在其列
- [ ] 未写回上游包名（`koishi` / `@koishijs/*`），peer 仍指向 `@koishi-ce/*`
- [ ] 未触碰 `packages/shim` 四包与 vendored 三包（`plugins/infra/{http,proxy,server}`）
- [ ] 上游 port 的相对导入已补 `.ts` 扩展名，并留 `// upstream: <repo>#<ref>` 溯源注释
- [ ] 上游 port 的 `.changeset/` 条目按行为面写入（发布行为不变则为空）

## 4. 验证

- [ ] `bun install` 后 `bun.lock` diff 已人工复核（Dependabot PR 注意 lockfileVersion 不得被降级重写）
- [ ] `bun run check` 全绿
- [ ] `bun run test` 全绿
- [ ] `bun run build` 通过
- [ ] `bun run fallow` 无问题（依赖增删必跑）
- [ ] 行为等价性证据：上游 changelog 要点 / 双装对拍 / 相关用例

## 5. changeset

<!-- 升版带来下游可见行为变化 → 写条目；纯 devDependencies / 内部工具链 → 「无」。 -->

## 6. 影响面与风险

<!-- 运行时兼容性、产物体积变化、是否需要下游重新安装、被阻塞项（如 cordis 4 冻结）；回滚方式。 -->

## 7. 关联

<!-- 上游 release / commit / PR 链接、相关 issue、Dependabot 来源；无则写「无」。 -->
