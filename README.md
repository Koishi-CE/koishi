# koishi（Koishi-CE）

[中文](#中文) · [English](#english)

## 中文

`koishi` 是 [Koishi](https://koishi.chat) 聊天机器人框架的 **Bun-first 社区再分发版**：将 [koishijs/koishi](https://github.com/koishijs/koishi)（MIT）与 [koishijs/webui](https://github.com/koishijs/webui)（部分 AGPL-3.0）两个上游仓库文件级合并重构为单一 monorepo，以 GitHub 组织 [Koishi-CE](https://github.com/Koishi-CE) 发布、npm 作用域 `@koishi-ce`。**本仓库与 Koishijs 组织无隶属关系**；来源与许可证归属见 [NOTICE](./NOTICE)，上游目录映射见 [docs/UPSTREAM.md](./docs/UPSTREAM.md)。

### 快速开始

```bash
bun create koishi-ce
```

脚手架生成一个以 Bun 为运行时的 CE 实例：内置纯 `@koishi-ce` 模板、以 npm alias 钉住上游包名（防误装官方包）、不预装 adapter / database（可后续从市场安装）。启动后访问 <http://127.0.0.1:5140> 进入控制台。

### 仓库状态

- 46 个 workspace 包全部 ESM-only（`index.mjs` + `index.d.ts`），运行时与包管理均为 [Bun](https://bun.sh)
- 类型检查走 TS7 原生编译器（`@typescript/native`），全仓 0 错误
- 97 个测试文件 / 约 800 用例（`bun test`），总体约 99.8% 行覆盖
- 独立工具链已一步到位：vite 8 / tsdown / biome 2 / bun test；cordis 生态冻结在 3.x（上游 cordis 4 被 `@satorijs/core` 阻塞，实证见 [docs/decisions/upgrade-plan.md](./docs/decisions/upgrade-plan.md)）

### 目录结构

| 目录 | 内容 |
|---|---|
| `packages/node/` | Node 侧核心库 ×8（core / loader / cli / console / registry / assets / utils / i18n-utils），根 tsdown 统一构建 |
| `packages/web/` | 浏览器侧库（client / components），源码直出，无独立构建 |
| `packages/shim/` | 上游包名占位 shim ×2（下游 npm alias 目标，版本冻结） |
| `plugins/common/` | 通用 bot 插件 ×8（MIT） |
| `plugins/infra/` | 基础设施插件 ×6（http / proxy-agent / server 为 vendored 预编译） |
| `plugins/webui/` | 控制台插件 ×18（`src/` 为 Node 侧、`client/` 为 Vue 侧） |
| `apps/` | `create-koishi-ce` 脚手架 CLI、`@koishi-ce/scripts` 插件开发 CLI |
| `tooling/` | 发布链脚本（`bun run release`） |
| `docs/` | 开发手册、架构、发布流程与历史决策记录（入口 [docs/README.md](./docs/README.md)） |

### 参与贡献

开发环境、门禁与提交约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)；仓库级开发约定（agent 亦可读）见 [AGENTS.md](./AGENTS.md)。

- 行为准则：[CODE_OF_CONDUCT.md](./.github/CODE_OF_CONDUCT.md)
- 安全漏洞报告：[SECURITY.md](./.github/SECURITY.md)

### 许可证

MIT 与 AGPL-3.0 分区授权，各目录归属见 [NOTICE](./NOTICE)。

---

## English

`koishi` is a **Bun-first community redistribution** of the [Koishi](https://koishi.chat) chatbot framework: the [koishijs/koishi](https://github.com/koishijs/koishi) (MIT) and [koishijs/webui](https://github.com/koishijs/webui) (partly AGPL-3.0) codebases merged and restructured into a single monorepo, published under the [Koishi-CE](https://github.com/Koishi-CE) GitHub organization and the `@koishi-ce` npm scope. **Not affiliated with the Koishijs organization.** See [NOTICE](./NOTICE) for attribution and licensing, and [docs/UPSTREAM.md](./docs/UPSTREAM.md) for the upstream mapping.

### Getting started

```bash
bun create koishi-ce
```

The scaffold generates a Bun-based CE instance with a pure `@koishi-ce` template: upstream package names are pinned via npm aliases to frozen shims (preventing accidental installs of the official packages), and no adapter / database is preinstalled (install them from the market later). The console is served at <http://127.0.0.1:5140>.

### Status

- 46 workspace packages, all ESM-only, on the [Bun](https://bun.sh) runtime and package manager
- Type-checked by the TS7 native compiler (`@typescript/native`) with zero errors
- 97 test files / ~800 cases (`bun test`), ~99.8% overall line coverage
- Modern toolchain in place: vite 8 / tsdown / biome 2 / bun test; the cordis ecosystem stays on 3.x (cordis 4 is blocked upstream, see [docs/decisions/upgrade-plan.md](./docs/decisions/upgrade-plan.md))

### Layout

`packages/node` (8 core libraries), `packages/web` (browser-side), `packages/shim` (2 frozen name-occupation shims), `plugins/{common,infra,webui}` (8 + 6 + 18 plugins), `apps` (create-koishi-ce scaffold CLI, plugin-dev CLI), `tooling` (release pipeline), `docs` (see [docs/README.md](./docs/README.md)).

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md); repo-wide conventions also live in [AGENTS.md](./AGENTS.md).

- Code of conduct: [CODE_OF_CONDUCT.md](./.github/CODE_OF_CONDUCT.md)
- Reporting vulnerabilities: [SECURITY.md](./.github/SECURITY.md)

### License

Dual-licensed by directory (MIT and AGPL-3.0); see [NOTICE](./NOTICE) for the provenance table.
