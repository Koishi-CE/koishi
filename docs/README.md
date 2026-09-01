# 文档索引

> 本目录是 `koishi`（Koishi-CE monorepo）的文档集。仓库级常驻约定在根目录 [AGENTS.md](../AGENTS.md)；专职开发 agent 提示词在 `.github/agents/koishi-ce-dev.agent.md`；人类贡献者入口见根目录 `CONTRIBUTING.md`。

## 阅读路径（按用途）

| 文档 | 用途 |
|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | **开发手册**：环境要求、门禁命令、构建产物布局、编码约定、测试写法、已知坑 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **仓库结构**：目录与包清单、依赖纪律、构建 / 类型检查 / 测试体系、许可证分区 |
| [UPSTREAM.md](UPSTREAM.md) | **上游同步**：上游基线版本、目录映射表、port 流程（英文） |
| [RELEASE.md](RELEASE.md) | **发布流程**：changesets 约定、`bun run release` 发布链、事故记录与铁律 |
| [decisions/](./decisions) | **历史决策记录**：升级计划书与依赖审计快照（只读参考，记录当时的决策依据） |

- [decisions/upgrade-plan.md](decisions/upgrade-plan.md)：依赖六阶段升级计划书。Phase 0-4 已完成；Phase 5（cordis 生态 4.x）已执行、被上游阻塞并回退——其重启条件仍是活约束。
- [decisions/dependency-audit.md](decisions/dependency-audit.md)：99 个外部依赖的立项前全量审计快照（2026-08-27）。

## 文档纪律

- 除上表所列，`docs/` 下不应出现其他文档。新文档仅在确有长期维护价值时创建；阶段性设计 / 交接记录直接写进提交信息，不单独立档（历史保留在 git 提交记录中）。
- 文档不写死会漂移的事实（包版本号、文件数等快照数据），此类信息以 package.json 与命令输出为准。
- 一律简体中文、不用 emoji；`UPSTREAM.md` 为面向公开受众的英文例外。
