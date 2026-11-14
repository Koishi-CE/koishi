# SPDX-License-Identifier: MIT
# Copyright (c) 2026-present Koishi-CE contributors.

# PR 模板

> 本目录是开 PR 时的模板集合：**按改动领域各一份**，另有「通用」兜底。注意 GitHub 网页端**没有** PR 模板选择器（那是 issue 模板的功能）：网页建 PR 用 compare URL 加 `?template=<文件名>` 参数，CLI 用 `gh pr create --template <文件名>`（传文件名而非模板显示名）。
> 本项目一切改动走 PR、禁止直推 `main`，规矩见根 [AGENTS.md](AGENTS.md) 的 git 提交流程节与 [docs/guides/development.md](docs/guides/development.md) §2。

> 路径说明：`.github/` 下的 markdown 按**仓库根**为基准解析相对链接（GitHub 对社区健康文件的规则），故下方模板文件都写成 `.github/PULL_REQUEST_TEMPLATE/<文件>`。

## 模板清单

| 模板 | 文件 | 什么时候用 |
|---|---|---|
| 修复 (bug fix) | [.github/PULL_REQUEST_TEMPLATE/bug_fix.md](.github/PULL_REQUEST_TEMPLATE/bug_fix.md) | 缺陷修复：现象与复现 → 根因 → 修法 → 回归用例 |
| 特性 (feature) | [.github/PULL_REQUEST_TEMPLATE/feature.md](.github/PULL_REQUEST_TEMPLATE/feature.md) | 新能力或功能增强：接口变化 → 用例与词典 → changeset |
| 文档 (docs) | [.github/PULL_REQUEST_TEMPLATE/docs.md](.github/PULL_REQUEST_TEMPLATE/docs.md) | 文档与手册改动：改动清单 → 依据 → 引用核对 |
| 依赖与上游 (deps / upstream) | [.github/PULL_REQUEST_TEMPLATE/dependencies_upstream.md](.github/PULL_REQUEST_TEMPLATE/dependencies_upstream.md) | 依赖升版 / 替换 / 上游 port：冻结线复核 → 等价性证据 |
| 重构与性能 (refactor / perf) | [.github/PULL_REQUEST_TEMPLATE/refactor_perf.md](.github/PULL_REQUEST_TEMPLATE/refactor_perf.md) | 行为零变化的结构调整，或行为等价的性能优化：不变论证 → 指标对照 |
| 发布 (release) | [.github/PULL_REQUEST_TEMPLATE/release.md](.github/PULL_REQUEST_TEMPLATE/release.md) | 发布链、changesets 配置与包发布面字段：发布面影响 → 打包预演 |
| 通用 (general) | [.github/PULL_REQUEST_TEMPLATE/general.md](.github/PULL_REQUEST_TEMPLATE/general.md) | 跨领域或一次性改动；域内改动请优先选上面的模板 |

## 规矩

- **模板只负责「问全该领域必须交代的信息」**，正文口径与硬性约束一律以根 [AGENTS.md](AGENTS.md) 为准。
- **空章节写「无」，不要删标题**——便于对账与批量审阅。
- 标题与正文一律简体中文；标题用提交信息风格（`fix(core): ……`）。

## 改模板时

1. 新增或改名模板：同步对应 `.md` 与上方清单表格，保持两处一致。
2. 域内共同要求（验证证据、changeset 等）尽量在各模板里独立写全——模板被单独复制出去时不该缺上下文。
3. 领域划分与仓库结构对得上即可（参考 [.github/labeler.yml](.github/labeler.yml) 的范围标签）；模板数量宁少勿多，没内容的模板没人会选。
