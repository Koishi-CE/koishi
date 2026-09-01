# @koishi-ce/plugin-locales

**简体中文** | [English](#english)

控制台本地化文件管理插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/locales`。它加载磁盘上的 yml 翻译文件，让你在网页上查看和编辑全部翻译，保存后更新运行时 i18n 并回写磁盘。

## 功能与页面

- 「本地化」页面：路由 `/locales/:path*`（order 450，权限 4），以树形视图浏览各语言的翻译，支持搜索与编辑。
- 启动时扫描各根目录，把每个 `<locale>.yml` 以 `$<locale>` 命名空间注册进 `ctx.i18n`；用户翻译注册在 `$` 前缀命名空间，与插件自带文案区分开。
- 编辑保存经 `l10n` RPC（权限 4）回传后，逐语言更新 i18n 并写回第一个根目录的 `<locale>.yml`。
- 提供 `locales` 数据服务（全量翻译），i18n 数据变化时防抖刷新。

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `root` | string[] | `["data/locales", "locales"]` | 存放本地化文件的根目录，靠后的优先级更高 |

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-locales
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  locales: {}
```

## 备注

- 根目录不存在时自动创建；只加载 `.yml` 文件。
- 编辑回写目标固定为第一个根目录，其余根目录仅作加载来源。
- 无指令、无数据表。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/locales`。

---

## English

Console localization management plugin, ported from `plugins/locales` of the upstream [koishijs/webui](https://github.com/koishijs/webui) repository. It loads yml translation files from disk and lets you view and edit all translations in the web console; saving updates the runtime i18n and writes back to disk.

## Features and Pages

- "Localization" page: route `/locales/:path*` (order 450, authority 4), a tree view of translations per locale with search and editing.
- On startup, each root directory is scanned and every `<locale>.yml` is registered into `ctx.i18n under the `$<locale>` namespace; user translations live in `$`-prefixed namespaces, separate from plugin-bundled texts.
- Saving an edit goes through the `l10n` RPC (authority 4), which updates i18n and writes back to `<locale>.yml` in the first root directory.
- Provides the `locales` data service (all translations), refreshed (debounced) whenever i18n data changes.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `root` | string[] | `["data/locales", "locales"]` | Root directories holding locale files; later entries take priority |

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-locales
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  locales: {}
```

## Notes

- Missing root directories are created automatically; only `.yml` files are loaded. No commands, no tables.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/webui](https://github.com/koishijs/webui), `plugins/locales`.
