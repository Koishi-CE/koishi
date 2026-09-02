# 发布流程（RELEASE）

> 本仓全部可发布包的版本与发布管理：changesets 管版本，`bun run release` 发布链（`tooling/release/`）管执行。**铁律：一切发布走发布链，禁止手动 `npm publish`。** 实现代码见 `tooling/release/index.ts`（该目录与 `apps/koishi-scripts` 的 release 链互不相干——后者面向宿主工作区的插件项目）。
> **先读**：开发与门禁见 [../guides/development.md](../guides/development.md)；版本基线与 shim 例外见 [../reference/architecture.md](../reference/architecture.md)。
> **本文结构**：1 命令 · 2 发布链环节 · 3 changesets 约定 · 4 发布顺序与补发 · 5 事故记录。

## 1. 命令

```bash
bun run release status                    # 概览：pending changeset、本地版本 vs registry、发布序
bun run release version                   # 消费 .changeset/ 条目（changeset version）+ bun install 刷新 lockfile
bun run release build                     # 根 tsdown → 宿主控制台总装（console/dist）→ 各 webui 插件前端 dist
bun run release publish                   # registry 比对 → 所有权预检 → 拓扑序逐包 npm publish（workspace 协议改写）
bun run release pipeline                  # 一条龙：preflight → version → 提交 → build → test → publish → push
```

通用旗标：`--dry-run`（只打印计划不落盘）、`--only <包名,逗号分隔>`（仅发布名单内的包）、`--skip-build` / `--skip-test` / `--push` / `--allow-dirty`。

行为约定：任何一步失败立即中断并保留现场；重跑幂等（已发布版本经 registry 比对自动跳过）。webui 插件 dist 不入 git，发布前必须现构建——build 环的 targets 由各包 files 字段自动推导，遗漏任一插件都会导致发布缺前端。

## 2. 发布链环节（pipeline）

1. **preflight**：工作区状态与 changeset 前置检查。
2. **version**：消费 `.changeset/` 条目 bump 版本，刷新 `bun.lock`，产生版本提交。
3. **提交**：版本变更落为一个 git 提交。
4. **build**：node 侧 lib 产物 + 宿主控制台总装 + 各 webui 插件前端。
5. **test**：`bun test` 全量。
6. **publish**：按拓扑序逐包发布。publish 环负责把 `workspace:*` 等协议改写为真实版本号，并带**终局断言**（依赖字段不得残留 `workspace:` / `file:` / `link:`）。
7. **push**：推送 `main`（只推 main，不打 tag——tag 环已删除）。

## 3. changesets 约定

- 面向发布的包改动，**随提交写 `.changeset/` 条目**（`bun run changeset`）；纯内部 / 文档 / 私有包改动不写。
- 版本基线：全部可发布包统一 1.0.0 线（不镜像上游版本号，版本漂移以各包 package.json 与 `release status` 为准，怀疑不一致先 `npm view <pkg> dist-tags` 核实）。
- **shim 两包（`@koishi-ce/koishi-shim` / `@koishi-ce/console-shim`）与 workspace 私有包在 changesets ignore 列表**：勿写 changeset、勿 bump——shim 版本冻结跟随上游线（4.18.x / 5.30.x），Bun 对 npm alias 的 peer 判定看落盘包的 version，动它会让下游 alias 的 peer 匹配失效。
- `bumpVersionsWithWorkspaceProtocolOnly: true`：只有以 `workspace:*` 被内部消费的包才随依赖连动 bump。

## 4. 发布顺序与补发

- **顺序约束**：`console-shim` 须先于 `create-koishi-ce` 发布（模板依赖它）。发布链按拓扑序自动处理。
- **补发 / 重发坏版本**：先手动 bump 该包版本，再 `bun run release publish --only <包名,逗号分隔>`——同样走协议改写与终局断言。
- `@koishijs/client` 之类的 optional peer 无需处理：Bun 不自动安装 optional peer。

## 5. 事故记录（为什么禁止手动 publish）

2026-08-31：绕链手动 `npm publish` 把 `workspace:*` 原样带上 npm（config@1.0.5 / market@1.0.6 / hmr@1.0.3 污染，koishi@1.0.3 漏发），下游 `bun install` 全部解析失败。处置：发布链补齐 workspace 协议改写的终局断言，坏版本用补发流程覆盖。**workspace 协议的消费从不靠 changesets，只靠发布链**——这也是禁止手动 publish 的根本原因。
