# 发布流程（RELEASE）

> 本仓全部可发布包的版本与发布管理：changesets 管版本，`bun run release` 发布链（`tooling/release/`）管执行。**铁律：一切发布走发布链，禁止手动 `npm publish`。** 实现代码见 `tooling/release/index.ts`（该目录与 `apps/koishi-scripts` 的 release 链互不相干——后者面向宿主工作区的插件项目）。发布链第 7 环会把版本提交直接推送 `main`，**这是全仓唯一允许直推 `main` 的路径**（其余一切改动走 PR，见 [../guides/development.md](../guides/development.md) §2）。
> **先读**：开发与门禁见 [../guides/development.md](../guides/development.md)；版本基线与 shim 例外见 [../reference/architecture.md](../reference/architecture.md)。
> **本文结构**：1 命令 · 2 发布链环节 · 3 changesets 约定 · 4 发布顺序与补发 · 5 暂存区（staged publish）与 409 · 6 事故记录 · 7 CI 发布（OIDC 可信发布）。

## 1. 命令

```bash
bun run release status                    # 概览：pending changeset、本地版本 vs registry、发布序
bun run release version                   # 消费 .changeset/ 条目（changeset version）+ bun install 刷新 lockfile
bun run release build                     # 根 tsdown → 宿主控制台总装（console/dist）→ 各 webui 插件前端 dist
bun run release test                      # 范围化自有用例（bun test --isolate 的子集）
bun run release publish                   # registry 比对 → 所有权预检 → 拓扑序逐包 npm publish（workspace 协议改写）
bun run release pipeline                  # 一条龙：preflight → version → 提交 → build → test → publish → push
```

旗标：`--dry-run`（只打印计划不落盘）、`--only <包名,逗号分隔>`（仅 publish 环生效，只发布名单内的包）、`--commit`（version 环消费后提交版本变化，CI 用）与 `--push`（version / pipeline 推送 main；两者都强制在 main 上）、`--skip-build` / `--skip-test`（仅 pipeline 环生效）、`--allow-dirty`（跳过工作区洁净检查）；另有 `--help` 与环境变量 `RELEASE_REGISTRY`（切换 registry 查询源，默认 registry.npmjs.org）。

行为约定：任何一步失败立即中断并保留现场；重跑幂等（已发布版本经 registry 比对自动跳过）——例外是 npm 暂存区中的版本不计入比对，此时重跑不幂等（见 §5）。webui 插件 dist 不入 git，发布前必须现构建——build 环的前端 targets 为 `plugins/webui` 下 files 含 `dist` 且带 `client/` 的插件（宿主 console 除外，由总装覆盖），遗漏任一插件都会导致发布缺前端。

发布包的 `bin` 声明一律用对象形式：键名为命令名（不带作用域）、值不带 `./` 前缀（如 `"koishi": "lib/cli/index.mjs"`）。字符串形式 + scoped 包名会被 npm 自动改写并打出 `renamed` / `script name ... was invalid and removed` 的**误导性警告**（实际值仍正确，属 npm 归一化分支的误报）；带 `./` 前缀同样会触发后者。

## 2. 发布链环节（pipeline）

1. **preflight**：分支（须在 main）、工作区洁净与 npm 登录前置检查（无 changeset 时不阻断——version 环遇到空条目自行跳过）。
2. **version**：消费 `.changeset/` 条目 bump 版本，刷新 `bun.lock`，产生版本提交。
3. **提交**：版本变更落为一个 git 提交。
4. **build**：node 侧 lib 产物 + 宿主控制台总装 + 各 webui 插件前端。
5. **test**：`bun run release test` = `bun test --isolate packages plugins/common plugins/webui/admin plugins/webui/commands`——范围化子集（源码 `runTestStep`），不含 apps 与 tooling 用例；全量测试仍以本地 `bun test` 为准。`--isolate` 不可省（缺了跨文件 `mock.module` 互相串扰）。
6. **publish**：按拓扑序逐包发布。publish 环负责把 `workspace:*` 协议改写为真实版本号（`workspace:^` 等其他协议形式直接拒绝），并带**终局断言**（依赖字段不得残留 `workspace:` / `file:` / `link:`）。
7. **push**：推送 `main`（只推 main，不打 tag——tag 环已删除；对外 GitHub Release 的单整体 tag 手动补打，跟 core 版本走）。**这是全仓唯一允许直推 `main` 的路径**：本仓一切改动都走 PR（见 [../guides/development.md](../guides/development.md) §2 与根 `AGENTS.md` 的 git 提交流程节），发布链的版本提交是既定例外，不构成人工直推 `main` 的许可。

## 3. changesets 约定

- 面向发布的包改动，**随提交写 `.changeset/` 条目**（`bun run changeset`）；纯内部 / 文档 / 私有包改动不写。
- 版本基线：全部可发布包从 1.0.0 起步、由 changesets 递进（不镜像上游版本号，随发布自然漂移，以各包 package.json 与 `release status` 为准，怀疑不一致先 `npm view <pkg> dist-tags` 核实）。
- **shim 四包（`@koishi-ce/koishi-shim` / `@koishi-ce/console-shim` / `@koishi-ce/client-shim` / `@koishi-ce/components-shim`）与 workspace 私有包在 changesets ignore 列表**：勿写 changeset、勿 bump——shim 版本冻结跟随上游线（4.18.x / 5.30.x / 1.5.x），Bun 对 npm alias 的满足性判定看落盘包的 version，动它会让下游 alias 的匹配失效。新 shim 首版发布同样走发布链，且发布顺序须先于 `create-koishi-ce`（模板依赖它们）。
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

## 7. CI 发布（OIDC 可信发布）

本地发布链之外，仓库另有 `.github/workflows/release.yml`：**携带 changeset 的 PR 合并进 main 后，由 CI 自动消费 changeset 并把包发上 npm**，全程无需本地发包。npm 侧走**可信发布（Trusted Publisher / OIDC）**，不存在任何长期 token（本机也从此不持有发布能力）。

### 7.1 触发与两 job 分工

触发为 `push: main` 且 `paths: ['.changeset/**']`（只有携带 changeset 的合并才值得跑），外加 `workflow_dispatch` 作补发 / 重跑逃生舱；`concurrency: group: release` 且不取消进行中的运行，避免两个运行同时消费 changeset 撞版本号。

`workflow_dispatch` 另带一个 `skip-version` 布尔输入：changeset 一旦被消费，重跑就再也走不到 publish（version 环无条目可消费 → `changed=false` → publish 被跳过），此时置 `skip-version=true` 可跳过 version 环、直接构建当前 main 并交给 publish，由 registry 比对决定哪些版本真的需要发（已发布的自动跳过）。它不改变审批语义——publish 依旧卡在 `environment: release`。

| job | 职责 | 权限 |
| --- | --- | --- |
| `prepare` | `release version --commit` → `release build` → `release test` → 用 GitHub App token 推送版本提交 → 打包 artifact | `contents: write`，**无** `id-token` |
| `publish` | 解包 artifact → `release publish`（逐包 npm publish） | `id-token: write` + `environment: release` 审批，**无** `contents: write` |

设计约束：

- **消费 changeset 与构建必须同处一个 job**。早先拆成两个 job、由 version 输出提交 SHA 供 build 用 `actions/checkout` 的 `ref: ${{ needs.version.outputs.sha }}` 检出，被 CodeQL 的 `actions/cache-poisoning` 判定为「可被 `workflow_dispatch` 影响的 ref 被特权 job 检出并执行」，在该文件上稳定报 3 条 high（Cache Poisoning via execution of untrusted code）。合成一个 job 后用默认 checkout，既消掉这个污点，也免掉 SHA 传递这笔状态——构建与测试跑的就是本 job 里刚提交的那棵树。
- **推送排在构建与测试之后**：这样构建或测试失败时，main 上不会留下「版本已升、包却没发出去」的提交；推送用 `git push … HEAD:main`（runner 上未必存在名为 `main` 的本地分支）。
- **推送凭证是 GitHub App 的 installation token**：默认 `GITHUB_TOKEN` 推 `main` 会被 ruleset 以 `GH013` 拒绝，且它**无法被加入 ruleset 的 bypass 名单**（GitHub 的安全限制）；能进该名单的只有 GitHub App，模式还必须是 `Always` 或 `exempt`（`Pull requests only` 对直推无效）。仓库侧配置、最小暴露清单与三个必须知道的语义见 §7.5。
- **`publish` 不跑 `bun install`**：`release publish` 只用 `node:` 内建模块与 npm CLI，不需要 `node_modules`；而 install 与构建是构建期代码执行的主要入口，不该出现在持 OIDC token 的 job 里。构建期可执行的代码（`package.json` 脚本、`tsdown.config.ts`、各插件 `build/client.ts`）若与 token 同处一个 job，一处被改坏即可发布这 53 个包的任意版本。附带说明：Bun 本身不执行依赖的 postinstall（`bun install --help` 原文 "dependency scripts are never run"，根 `package.json` 亦无 `trustedDependencies`），该层默认即关闭，此处仍按最小权限切分。
- **版本先落 main、发布待审批**：`prepare` 不挂 environment，故版本提交与 CHANGELOG 会在构建测试通过后立即进 main，而包要等 `environment: release` 的批准才真正上线。若某次审批长期不点，main 的版本会暂时领先 npm——`release publish` 的 registry 比对（`filterDowngrades`）能安全处理这种中间态，但排查「版本号对不上」时要知道它的存在。
- **publish 升级 npm 必须走用户级 prefix**：runner 的 npm 是系统级安装（`/usr/local`，属 root），`npm install -g npm@11` 会因写 `/usr/local/share/man/man5` 而 EACCES——2026-09-27 首次跑通 `prepare` 后 publish 即死在这一步（run 36331787266，此前 `publish` 从未真正执行过）。现改为 `npm install -g npm@11 --prefix "$HOME/.npm-global"` 并把该 bin 写进 `GITHUB_PATH`（后者只对后续步骤生效，故安装与写 PATH 必须在同一步）。

### 7.2 OIDC 的信任边界（改本文件前必读）

npm 的信任配置把 `repository` / `workflow_ref.file` / `environment` 三个 claim 钉死，语义是**「谁能让 `.github/workflows/release.yml` 在 `Koishi-CE/koishi` 里跑起来，谁就能发这 53 个包」**——授的是工作流文件，不是人。因此：

- **job 上的 `environment: release` 不可删**。npm 侧声明了 environment claim，缺了它 OIDC 校验直接不通过；反过来说，若当初不声明 environment，删掉这一行就能绕过 GitHub 的审批——这正是声明它的意义。
- **`.github/workflows/**` 与 `tooling/release/**` 必须开 CODEOWNERS 复核**：本模型下改这两处等于拿到发布权。
- **`release` Environment 的 Deployment branches 必须限制为 `main`**：`workflow_dispatch` 是在**被 dispatch 的那个 ref** 上取 workflow 文件的，不限制的话，有写权限者可以在分支上改本文件后 dispatch，借这个 environment 拿到 OIDC。限制到 `main` 后，非 main ref 的运行访不到该 environment，`environment: release` 的 claim 也就无从满足。
- 三个 claim 任何一处与实际不符 OIDC 都不认（仓库名大小写、workflow 文件名、environment 名）。要改必须 revoke 后重建——registry 每包只允许一条信任配置，没有 update 语义。

### 7.3 与本地链的关系

- 本地 `bun run release pipeline` 仍可用（走本机 2FA 认证），适合演练与排查；**日常发布不再需要它**。
- 补发 / 重发坏版本：优先 `workflow_dispatch` 重跑 CI 链——**changeset 已被消费时必须置 `skip-version=true`**（见 §7.1），否则 `prepare` 会 `changed=false`、publish 直接跳过；确实要在本地补发时仍走 `bun run release publish --only <包名>`。
- OIDC 模式下 `npm whoami` / `npm owner ls` 必然失败（没有登录态——npm 换到的是**包级**短时 token，见 npm CLI 的 `lib/utils/oidc.js`），故 `release` 工具检测到 `ACTIONS_ID_TOKEN_REQUEST_URL` 时自动跳过登录与所有权预检；本地路径行为不变。
- **npm CLI 需 ≥ 11.15.0**：`permissions` 字段（由 `--allow-publish` 生成）自该版本起才随 trust 请求下发，更早版本会被 registry 以 `400 Bad Request` 拒绝（症状极具迷惑性：读取现状全部成功、逐包创建全部 E400）。CI 里由 workflow 显式 `npm install -g npm@11` 保证，本地开发口径为 11.20.0。
- 发布产物自动带 provenance（npm 侧 OIDC 成功即自动开启），下游可核验来源 commit 与 workflow。

### 7.4 仓库侧前置（非代码）

1. `release` Environment + Required reviewers（名字须与 claim 严格同名）。评审人可列多位，语义是「**其中任意一位**批准即可」（GitHub 文档原文：Only one of the required reviewers needs to approve the job for it to proceed）；
2. 同一 Environment 的 **Deployment branches 限制为 `main`**（动机见 §7.2）；
3. 主分支 ruleset 的 **bypass 名单里加入发布用的 GitHub App（模式 `Always` 或 `exempt`）**，否则 `prepare` job 推不上去——不能按「放行 GitHub Actions」来配，`GITHUB_TOKEN` 进不了该名单（见 §7.5）；
4. 开启 `require_code_owner_review`；
5. npm 侧 53 个包的信任配置与上表一致：`repository=Koishi-CE/koishi`、`workflow_ref.file=release.yml`、`environment=release`、权限仅 `publish`（不含 stage publish，避免引入人工批准环节的暂存流程）。

### 7.5 版本提交的推送凭证（GitHub App）

`prepare` 要把版本提交直推 `main`，而 `main` 受 ruleset「保护主分支」保护（`pull_request` / `merge_queue` / `required_signatures` / `code_coverage` / `code_scanning` / `non_fast_forward` / `deletion`）。**默认 `GITHUB_TOKEN` 无法被加入该 ruleset 的 bypass 名单**（GitHub 的安全限制，UI 里选不到它），实测 2026-09-27 的首次 `workflow_dispatch`（run 36328581773）9 步里 8 步成功，只有推送被拒：

```text
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - Commits must have verified signatures.
```

因此推送改用 **GitHub App 的 installation token**：仓库装一个只授 `Contents: Read and write` 权限的 App（Webhook 关闭、仅安装到本仓），把它加入 ruleset 的 bypass 名单，App ID 与私钥存成仓库 secret `APP_ID` / `APP_PRIVATE_KEY`，由 `actions/create-github-app-token@v3` 在推送前换取。

bypass 模式必须选让规则对该 actor **不生效**的那一档：`Always` 或 `exempt`（`Pull requests only` 对直推无效）。官方 API 对 `exempt` 的定义是「规则不会为该 actor 运行，也不产生 bypass 审计条目」（原文：When `bypass_mode` is `exempt`, rules will not be run for that actor and a bypass audit entry will not be created.）；自 GitHub 2025-09-10 的 ruleset exemptions 更新起，它是**给机器人用的推荐模式**——同样免于规则，但审计日志里不会留下 bypass 事件（`Always` 会）。本仓当前用的就是 `exempt`。

最小暴露的落实方式（改 workflow 时不要放宽）：

- App 只授 `Contents: Read and write`、只装在 `Koishi-CE/koishi`；取 token 时显式写 `repositories: koishi`，不依赖默认值（默认覆盖该 App 安装到的全部仓库）。
- token 只出现在「推送版本提交」这一步（`env` 传入、脚本里用 `${GH_TOKEN}` 引用而不是把 token 内联进 `run`，避免明文进日志），其余步骤仍用默认 `GITHUB_TOKEN`。
- `prepare` 的 `actions/checkout` 必须 `persist-credentials: false`：否则 checkout 会把 `GITHUB_TOKEN` 持久化到 `.git/config` 的 `http.<url>.extraheader`，与推送 URL 里的 App token 争同一个 `Authorization` 头。
- 推送用完整 URL 而非 `git remote`，并加 `-c core.hooksPath=/dev/null`：`prepare` 里有 `bun install` / `build` / `test` 这些构建期代码，被污染时可在 `.git/hooks/pre-push` 里读到该 token。这是「让持 `contents: write` 的 job 拿到 bypass 能力」的固有代价，剩余面靠 CODEOWNERS 对构建文件的强制复核兜底。

必须知道的三个语义：

1. **bypass 的语义是「免于该 ruleset 的全部规则」**，不是「只免签名」：这个 App 被滥用即可往 `main` 推任意内容（绕过 PR、merge queue、签名）。缓解即上面的最小暴露清单，以及 `publish` 仍卡在 `environment` 审批。
2. **App token 推送会触发新的 workflow 运行**（GitHub 只对 `GITHUB_TOKEN` 免触发）。版本提交会 `git add .changeset`——被消费的 changeset 以**删除**形式入库，命中本 workflow 的 `paths: ['.changeset/**']`，因此一次发布会多出一次运行：那次运行消费不到 changeset，`changed=false`，只跑 install 与 version 即空转退出，不会再推送，`concurrency: group: release` 亦保证两者串行。另外 `ci.yml` 的 `push: main` 没有 paths 过滤，同一次推送还会触发一轮完整 CI——每次发布固定多出的运行成本在此（`GITHUB_TOKEN` 推送时两者都不会发生）。
3. **App token 推送的提交不会被 GitHub 自动签名**（`git push` 不产生签名）。这里无关紧要——bypass 让签名规则不适用；但若哪天想撤掉 bypass、改用「签名过 `required_signatures`」，就得在 workflow 里另配 GPG / SSH 签名并再放一份私钥。

### 7.6 版本提交的署名（贡献归属）

提交的**署名**与推送的**认证**是两件事，别混为一谈：

- **署名**由 `prepare` 里 `git config user.name / user.email` 决定，只影响「这些提交计入谁的贡献主页」——workflow 里显式配成维护者 **PaperKoi**（`PaperKoi` / `331636065+PaperKoi@users.noreply.github.com`，即其 GitHub 账号与绑定邮箱）。此前用 `github-actions[bot]`，结果版本提交在仓库贡献墙上挂了一个 bot 账号（2026-09-27 那次 `chore(release): 消费 changeset…` 即此）。
- **认证**仍是 GitHub App 的 installation token（见 §7.5），即绕过 ruleset 的身份不受署名影响。

两者都改不产生额外权限：署名只是 `git config`，App token 仍只出现在推送那一步。
