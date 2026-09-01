# @koishi-ce/plugin-market

**简体中文** | [English](#english)

控制台的插件市场与依赖安装器，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/market`（原版 v2.11.11 线）。在网页上搜索、浏览、安装、卸载、升级插件与依赖；安装操作由 `installer` 服务执行——直接调用当前项目的包管理器。建议配合 [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console) 使用。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `registry.endpoint` | string | 本地 npmrc 回落官方源 | npm registry 地址 |
| `registry.timeout` | number | 5 秒 | registry 请求超时 |
| `search.endpoint` | string | 无（需手填） | 市场搜索端点，可用官方 `https://registry.koishi.chat/index.json` 或社区镜像 |
| `search.timeout` | number | 30 秒 | 搜索请求超时 |
| `search.proxyAgent` | string | - | 搜索请求的代理地址 |

`search.endpoint` 不配置时会退化为 npm 原始搜索（逐页爬取全量包，极慢），建议配置镜像端点。

## 功能与页面

- **插件市场页**（`/market`，权限 4）：搜索、分类浏览、兼容性过滤（按 peer 的 koishi 版本范围 semver 相交判定）；
- **依赖管理页**（`/dependencies`，权限 4）：查看本地依赖的 request / resolved / workspace / latest 状态，手动安装与覆盖；
- **安装进度**：状态栏右侧实时显示；市场页支持 ctrl+r 刷新；
- **数据服务**：`dependencies`（本地依赖收集）、`registry`（各包版本元数据缓存）、`market`（搜索结果）。

## 指令

| 指令 | 权限 | 说明 |
| --- | --- | --- |
| `plugin.install <name>`（别名 `.i`） | 4 | 安装插件 |
| `plugin.uninstall <name>`（别名 `.r`） | 4 | 卸载插件 |
| `plugin.upgrade [name...]`（别名 `.update` / `.up`） | 4 | 升级插件，`-s, --koishi` 升级框架自身 |

## CE 相对上游的调整

- **守护请求**：安装清单永不覆盖或删除 `workspace:` 前缀与 `npm:@koishi-ce` alias 的依赖声明——前者是本仓 monorepo 归属，后者是下游脚手架的 shim 归属，防止重新拉下 npm 官方包形成第二份框架副本；
- **Bun 适配**：npmrc 读取改为原生文件解析（Bun 无 config 子命令）；manifest 探测纯 fs 化；安装后按 `isResidentInCache` 判定是否需要整进程重载；
- **网络韧性**：市场请求对 429 / 408 / 5xx 指数退避重试并遵循 Retry-After。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。本包是上游 koishijs/webui 的社区再分发，版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The plugin market and dependency installer for the console, ported from `plugins/market` of the upstream [koishijs/webui](https://github.com/koishijs/webui) (v2.11.11 line). Search, browse, install, uninstall and upgrade plugins and dependencies on the web; installs are performed by the `installer` service, which drives the project's own package manager. Best used with [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console).

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `registry.endpoint` | string | local npmrc, falling back to the official registry | npm registry endpoint |
| `registry.timeout` | number | 5s | Registry request timeout |
| `search.endpoint` | string | none (must be set) | Market search endpoint, e.g. the official `https://registry.koishi.chat/index.json` or a community mirror |
| `search.timeout` | number | 30s | Search request timeout |
| `search.proxyAgent` | string | - | Proxy for search requests |

Without `search.endpoint` the plugin falls back to raw npm search, which crawls the whole registry page by page and is extremely slow — configuring a mirror endpoint is strongly recommended.

## Features and pages

- **Market page** (`/market`, authority 4) — search, category browsing and compatibility filtering (semver intersection against the koishi peer range).
- **Dependencies page** (`/dependencies`, authority 4) — local dependency state (request / resolved / workspace / latest) with manual install and override.
- **Install progress** in the status bar; ctrl+r refreshes the market page.
- **Data services** — `dependencies`, `registry`, `market`.

## Commands

| Command | Authority | Description |
| --- | --- | --- |
| `plugin.install <name>` (alias `.i`) | 4 | Install a plugin |
| `plugin.uninstall <name>` (alias `.r`) | 4 | Uninstall a plugin |
| `plugin.upgrade [name...]` (aliases `.update` / `.up`) | 4 | Upgrade plugins; `-s, --koishi` upgrades the framework itself |

## CE adjustments

- **Guarded requests** — the install manifest never overwrites or deletes dependencies declared with the `workspace:` prefix or `npm:@koishi-ce` aliases (monorepo ownership and downstream shim ownership respectively), preventing the official npm packages from being pulled back in as a second framework copy.
- **Bun adaptations** — native npmrc file parsing (Bun has no config subcommand), pure-fs manifest probing, and post-install process-reload decisions via `isResidentInCache`.
- **Network resilience** — exponential backoff with Retry-After support for 429 / 408 / 5xx market responses.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Community redistribution of upstream koishijs/webui; copyright Shigma and Koishijs contributors (upstream) and Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
