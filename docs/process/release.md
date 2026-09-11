# 发布流程（RELEASE）

> 本仓全部可发布包的版本与发布管理：changesets 管版本，`bun run release` 发布链（`tooling/release/`）管执行。**铁律：一切发布走发布链，禁止手动 `npm publish`。** 实现代码见 `tooling/release/index.ts`（该目录与 `apps/koishi-scripts` 的 release 链互不相干——后者面向宿主工作区的插件项目）。
> **先读**：开发与门禁见 [../guides/development.md](../guides/development.md)；版本基线与 shim 例外见 [../reference/architecture.md](../reference/architecture.md)。
> **本文结构**：1 命令 · 2 发布链环节 · 3 changesets 约定 · 4 发布顺序与补发 · 5 暂存区（staged publish）与 409 · 6 事故记录。

## 1. 命令

```bash
bun run release status                    # 概览：pending changeset、本地版本 vs registry、发布序
bun run release version                   # 消费 .changeset/ 条目（changeset version）+ bun install 刷新 lockfile
bun run release build                     # 根 tsdown → 宿主控制台总装（console/dist）→ 各 webui 插件前端 dist
bun run release publish                   # registry 比对 → 所有权预检 → 拓扑序逐包 npm publish（workspace 协议改写）
bun run release pipeline                  # 一条龙：preflight → version → 提交 → build → test → publish → push
```

旗标：`--dry-run`（只打印计划不落盘）、`--only <包名,逗号分隔>`（仅 publish 环生效，只发布名单内的包）、`--skip-build` / `--skip-test` / `--push`（仅 pipeline 环生效）、`--allow-dirty`（跳过工作区洁净检查）；另有 `--help` 与环境变量 `RELEASE_REGISTRY`（切换 registry 查询源，默认 registry.npmjs.org）。

行为约定：任何一步失败立即中断并保留现场；重跑幂等（已发布版本经 registry 比对自动跳过）——例外是 npm 暂存区中的版本不计入比对，此时重跑不幂等（见 §5）。webui 插件 dist 不入 git，发布前必须现构建——build 环的前端 targets 为 `plugins/webui` 下 files 含 `dist` 且带 `client/` 的插件（宿主 console 除外，由总装覆盖），遗漏任一插件都会导致发布缺前端。

发布包的 `bin` 声明一律用对象形式：键名为命令名（不带作用域）、值不带 `./` 前缀（如 `"koishi": "lib/cli/index.mjs"`）。字符串形式 + scoped 包名会被 npm 自动改写并打出 `renamed` / `script name ... was invalid and removed` 的**误导性警告**（实际值仍正确，属 npm 归一化分支的误报）；带 `./` 前缀同样会触发后者。

## 2. 发布链环节（pipeline）

1. **preflight**：分支（须在 main）、工作区洁净与 npm 登录前置检查（无 changeset 时不阻断——version 环遇到空条目自行跳过）。
2. **version**：消费 `.changeset/` 条目 bump 版本，刷新 `bun.lock`，产生版本提交。
3. **提交**：版本变更落为一个 git 提交。
4. **build**：node 侧 lib 产物 + 宿主控制台总装 + 各 webui 插件前端。
5. **test**：`bun test packages plugins/common plugins/webui/admin plugins/webui/commands`——范围化子集（源码 `runTestStep`），不含 apps 与 tooling 用例；全量测试仍以本地 `bun test` 为准。
6. **publish**：按拓扑序逐包发布。publish 环负责把 `workspace:*` 协议改写为真实版本号（`workspace:^` 等其他协议形式直接拒绝），并带**终局断言**（依赖字段不得残留 `workspace:` / `file:` / `link:`）。
7. **push**：推送 `main`（只推 main，不打 tag——tag 环已删除）。

## 3. changesets 约定

- 面向发布的包改动，**随提交写 `.changeset/` 条目**（`bun run changeset`）；纯内部 / 文档 / 私有包改动不写。
- 版本基线：全部可发布包从 1.0.0 起步、由 changesets 递进（不镜像上游版本号，随发布自然漂移，以各包 package.json 与 `release status` 为准，怀疑不一致先 `npm view <pkg> dist-tags` 核实）。
- **shim 两包（`@koishi-ce/koishi-shim` / `@koishi-ce/console-shim`）与 workspace 私有包在 changesets ignore 列表**：勿写 changeset、勿 bump——shim 版本冻结跟随上游线（4.18.x / 5.30.x），Bun 对 npm alias 的 peer 判定看落盘包的 version，动它会让下游 alias 的 peer 匹配失效。
- `bumpVersionsWithWorkspaceProtocolOnly: true`：只有以 `workspace:*` 被内部消费的包才随依赖连动 bump。

## 4. 发布顺序与补发

- **顺序约束**：`console-shim` 须先于 `create-koishi-ce` 发布——但该依赖只以 npm alias 形式写死在脚手架模板文本里（`apps/koishi-create/src/template.ts`），不在 create-koishi-ce 的 manifest 依赖字段中，**拓扑序不覆盖此约束**；当前靠 console-shim 版本冻结（changesets ignore）兜底，若手动 bump console-shim，须人工确认其先于 create-koishi-ce 发布。
- **补发 / 重发坏版本**：先手动 bump 该包版本，再 `bun run release publish --only <包名,逗号分隔>`——同样走协议改写与终局断言。
- `@koishijs/client` 之类的 optional peer 无需处理：Bun 不自动安装 optional peer。

## 5. 暂存区（staged publish）与 409

npm 的暂存发布（staged publishing）会在版本公开前插入人工批准环节：提交先进入 registry 的**暂存区**，须由有权限者带 2FA 批准后才正式上线；浏览器认证（web auth）的发布也会被 registry 转入暂存区。

- **症状**：`npm error code E409` + `Cannot publish over previously staged version "<version>"`，发布链在该包中断（后续包均未发布）。
- **为何重跑也是错**：暂存版本**不出现在 registry 的 versions 列表**里，`release publish` / `release status` 的比对（`fetchPublishedVersions`）看不到它，于是每次重跑都重新尝试同一版本，每次都 409——这种情形下重跑**不幂等**。
- **处置（三选一）**：
  1. npmjs.com → **Staged Packages** 标签页 → 对目标版本 **Approve**（转为正式发布）或 **Reject**（丢弃后重发）；
  2. npm CLI ≥ 11.15：`npm stage list` / `npm stage view <stage-id>` / `npm stage approve <stage-id>` / `npm stage reject <stage-id>`（npm 11.13 及更早无此子命令）；
  3. 不处理暂存版本，直接 bump 一个补丁版本重发（旧的暂存版本勿再尝试同版本发布）。
- **同批其余包**：发布链逐包串行，中断点之后的包尚未发布——先在网页 / CLI 处理掉阻断版本（或让它变为已发布），再用 `bun run release publish --only <包名,逗号分隔>` 补发。发布链在失败时会打印这套指引。
- **排查提示**：`bun run release status` 的比对同样看不见暂存版本，不要据它判断「该版本已发布」；版本是否真的上线以 `npm view <包名> versions --json` 与 npmjs.com 页面为准。

## 6. 事故记录（为什么禁止手动 publish）

2026-08-31：绕链手动 `npm publish` 把 `workspace:*` 原样带上 npm（config@1.0.5 / market@1.0.6 / hmr@1.0.3 污染，koishi@1.0.3 漏发），下游 `bun install` 全部解析失败。处置：发布链补齐 workspace 协议改写的终局断言，坏版本用补发流程覆盖。**workspace 协议的消费从不靠 changesets，只靠发布链**——这也是禁止手动 publish 的根本原因。
