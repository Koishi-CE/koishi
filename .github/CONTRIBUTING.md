# 贡献指南（CONTRIBUTING）

感谢关注 `koishi`（Koishi-CE，Koishi 的 Bun-first 社区再分发 monorepo）。本项目与 Koishijs 组织无隶属关系（见 [NOTICE](./NOTICE)）。

## 快速上手

1. 安装 [Bun](https://bun.sh) ≥ 1.4（唯一包管理器与运行时）。
2. `bun install` 安装依赖。
3. 参照 [docs/guides/development.md](./docs/guides/development.md) 了解门禁命令、编码约定与测试写法；仓库结构见 [docs/reference/architecture.md](./docs/reference/architecture.md)。

## 提交前检查

```bash
bun run check    # lint + lint:client + typecheck，全绿再提交
bun test         # 全量测试
```

涉及构建改动时加跑 `bun run build`。

## 提交约定

- 提交到 `main` 分支，提交信息用简体中文，格式参考历史：`feat:` / `fix:` / `docs:` / `chore:` / `build:`，可带 scope（如 `fix(core):`）。
- 面向发布的包改动随提交写 changeset（`bun run changeset`），详见 [docs/process/release.md](./docs/process/release.md)。
- 从上游 koishi / webui 移植改动按 [docs/process/upstream.md](./docs/process/upstream.md) 的映射表手动 diff 移植。

## 行为准则与安全

- 参与本项目即同意遵守[行为准则](./.github/CODE_OF_CONDUCT.md)。
- 漏洞请勿开公开 issue，按[安全政策](./.github/SECURITY.md)私下报告。
