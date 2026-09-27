# SPDX-License-Identifier: MIT
# Copyright (c) 2026-present Koishi-CE contributors.

# PR 模板

> 本目录是开 PR 时的模板集合：**按改动领域各一份**，另有「通用」兜底。开 PR 时从下拉里选一个（GitHub 读同目录 `config.yml` 的清单），CLI 用 `gh pr create --template "<模板名>"`。
> 本项目一切改动走 PR、禁止直推 `main`，规矩见根 [AGENTS.md](AGENTS.md) 的 git 提交流程节与 [docs/guides/development.md](docs/guides/development.md) §2。

> 路径说明：`.github/` 下的 markdown 按**仓库根**为基准解析相对链接（GitHub 与 `check:docs-links` 同口径），故下方模板文件都写成 `.github/PULL_REQUEST_TEMPLATE/<文件>`。

## 模板清单

| 模板 | 文件 | 什么时候用 |
|---|---|---|
| 修复 (bug fix) | [.github/PULL_REQUEST_TEMPLATE/bug_fix.md](.github/PULL_REQUEST_TEMPLATE/bug_fix.md) | 缺陷修复：现象与复现 → 根因 → 修法 → 回归用例 |
| 特性 (feature) | [.github/PULL_REQUEST_TEMPLATE/feature.md](.github/PULL_REQUEST_TEMPLATE/feature.md) | 新能力或功能增强：接口变化 → 用例与词典 → changeset |
| 文档 (docs) | [.github/PULL_REQUEST_TEMPLATE/docs.md](.github/PULL_REQUEST_TEMPLATE/docs.md) | 文档与手册改动：改动清单 → 依据 → 链接与锚点检查 |
| 依赖与上游 (deps / upstream) | [.github/PULL_REQUEST_TEMPLATE/dependencies_upstream.md](.github/PULL_REQUEST_TEMPLATE/dependencies_upstream.md) | 依赖升版 / 替换 / 上游 port：冻结线复核 → 等价性证据 |
| 重构与性能 (refactor / perf) | [.github/PULL_REQUEST_TEMPLATE/refactor_perf.md](.github/PULL_REQUEST_TEMPLATE/refactor_perf.md) | 行为零变化的结构调整，或行为等价的性能优化：不变论证 → 指标对照 |
| 发布 (release) | [.github/PULL_REQUEST_TEMPLATE/release.md](.github/PULL_REQUEST_TEMPLATE/release.md) | 发布链、changesets 配置与包发布面字段：发布面影响 → 打包预演 |
| 通用 (general) | [.github/PULL_REQUEST_TEMPLATE/general.md](.github/PULL_REQUEST_TEMPLATE/general.md) | 跨领域或一次性改动；域内改动请优先选上面的模板 |

## 规矩

- **模板只负责「问全该领域必须交代的信息」**，正文口径与硬性约束一律以根 [AGENTS.md](AGENTS.md) 为准。
- **空章节写「无」，不要删标题**——便于对账与批量审阅。
- 标题与正文一律简体中文；标题用提交信息风格（`fix(core): ……`）。
- **校验**：`bun run check:pr-templates`（已并入 `bun run check`）对账 `config.yml` 与本目录——清单指向的文件必须存在、目录内的 `.md` 不得是清单外的孤儿、`name` 不得重复。

## 改模板时

1. 新增或改名模板：同步 `config.yml`（`name` / `description` / `body` 三字段）、对应 `.md`，并跑一次 `bun run check:pr-templates` 与 `bun run check:docs-links`。
2. 域内共同要求（验证证据、changeset 等）尽量在各模板里独立写全——模板被单独复制出去时不该缺上下文。
3. 领域划分与仓库结构对得上即可（参考 [.github/labeler.yml](.github/labeler.yml) 的范围标签）；模板数量宁少勿多，没内容的模板没人会选。
