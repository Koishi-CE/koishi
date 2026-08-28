# 文档索引

> 本目录是 `koishi`（Koishi-CE monorepo）的文档集。仓库级常驻约定在根目录 [AGENTS.md](../AGENTS.md)（与 `.github/copilot-instructions.md` 保持同步；专职开发 agent 提示词在 `.github/agents/koishi-ce-dev.agent.md`）。

## 有效文档链（按阅读顺序）

| 文档 | 用途 |
|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | **开发依据**：环境要求、门禁命令、构建产物布局、编码约定、测试写法、已知坑 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **仓库结构**：包清单（全部 workspace 包）、构建体系（tsdown / vite 编程式）、依赖纪律、许可证分区 |
| [upgrade-plan.md](upgrade-plan.md) | **历史决策记录**：依赖六阶段升级计划书（Phase 0-4 已完成；Phase 5 cordis 4 被上游阻塞，含实证结论与重启条件） |
| [dependency-audit.md](dependency-audit.md) | **历史决策记录**：99 个外部依赖全量审计（两个依赖世界的划分依据） |

> **关于 docs/ 的纪律**：除上表外，`docs/` 下不应出现其他文档。新文档仅在确有长期维护价值时创建；阶段性设计 / 交接记录直接写进提交信息，不单独立档（历史保留在 git 提交记录中）。

## 快照事实（2026-08-28）

- **已完成**：两仓合并与 `@koishi-ce` 改名、Bun workspaces（yakumo 移除）、依赖现代化 Phase 0-4（工具链一步到位：vite 8 / TS 7 / tsdown / biome 2.5 / bun test）、`packages/node/*` 六包严格模式类型错误清零、`packages/web/market` 删除。
- **进行中**：严格模式类型错误清理（webui 插件 client 侧、`packages/web/*`、`apps/online` 等仍有存量）；marketn（`plugins/webui/market`）迁入对齐（gitignored）。
- **被阻塞**：cordis 生态 4.x 跳代（Phase 5）——等 `@satorijs/core` 的 cordis 4 版本，详见 [upgrade-plan.md](upgrade-plan.md)。
- **未建制**：npm 发布 / CI / changesets。
