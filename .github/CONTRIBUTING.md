# 贡献指南（CONTRIBUTING）

感谢关注 `koishi`（Koishi-CE，Koishi 的 Bun-first 社区再分发 monorepo）。本项目与 Koishijs 组织无隶属关系（见 [NOTICE](./NOTICE)）。

## 快速上手

1. 安装 [Bun](https://bun.sh) ≥ 1.4（唯一包管理器与运行时）。
2. `bun install` 安装依赖。
3. 参照 [docs/guides/development.md](./docs/guides/development.md) 了解门禁命令、编码约定与测试写法；仓库结构见 [docs/reference/architecture.md](./docs/reference/architecture.md)。

## 提交前检查

```bash
bun run check    # lint + lint:client + typecheck + 词典 + 文档链接，全绿再提交
bun test         # 全量测试
```

涉及构建改动时加跑 `bun run build`。

以上检查由 CI 自动执行（[workflows/ci.yml](.github/workflows/ci.yml)）：PR 与 main push 触发三个并行 job——`gate`（build / check / test）、`client`（前端构建）、`fallow`（死代码与依赖审计，配置见根目录 `.fallowrc.jsonc`）；日常改动只在 PR 上跑（main push 触发的是发布链的版本提交）。本地全绿而 CI 红，优先排查顺序依赖（CI 里 build 前置于 check，因 web 侧类型检查读取 lib 产物）。

## 提交约定（PR only）

**本仓一切改动都走 Pull Request，禁止直接推送 `main`**——包括人类维护者与各类 AI / agent 工具产出的改动，改动再小也不例外（`main` 即使没有分支保护也照此办）。

1. 从最新 `main` 切出改动分支：`git switch -c <type>/<范围>`（`type` 取 `feat` / `fix` / `docs` / `chore` / `build` / `refactor`）。
2. 提交到该分支，提交信息用简体中文，格式参考历史：`feat:` / `fix:` / `docs:` / `chore:` / `build:`，可带 scope（如 `fix(core):`）。
3. 推送分支并开 PR（`git push -u origin <分支>` → `gh pr create`），正文按 [PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md)：改动说明、验证证据、changeset 情况、影响面。**禁止 `git push origin main` 与对 `main` 的强推。**
4. 等 CI 三个 job 全绿、评审通过后 squash merge；合并后同步 `main` 并删除改动分支。AI / agent 产出的 PR 由维护者合并，工具不自行合并。

唯一的例外是发布链的版本提交：`bun run release pipeline` 会把版本提交（含 `bun.lock`）直接推送到 `main`（见 [docs/process/release.md](./docs/process/release.md)），该行为是发布链既定设计，不构成直推 `main` 的许可。

- 面向发布的包改动随提交写 changeset（`bun run changeset`），详见 [docs/process/release.md](./docs/process/release.md)。
- 从上游 koishi / webui 移植改动按 [docs/process/upstream.md](./docs/process/upstream.md) 的映射表手动 diff 移植。

## 行为准则与安全

- 参与本项目即同意遵守[行为准则](./.github/CODE_OF_CONDUCT.md)。
- 漏洞请勿开公开 issue，按[安全政策](./.github/SECURITY.md)私下报告。
