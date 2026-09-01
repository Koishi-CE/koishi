# @koishi-ce/plugin-commands

**简体中文** | [English](#english)

指令管理插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/commands`。它以「初始快照 + 用户覆盖」的双层结构在运行时改写指令树——别名、选项、配置与父子归属均可调整，覆盖部分持久化到插件配置，卸载时自动还原指令原状。

## 功能与页面

- 「指令管理」页面：路由 `/commands/:name*`（order 500，权限 4），以树形视图查看与编辑全部指令的别名、选项、配置和父子关系，页面顶部提供保存 / 移除 / 创建菜单。
- 插件详情页插槽：列出该插件提供的指令。
- 本地化页插槽：提供跳转入口，便于为指令补写翻译。
- RPC 接口（供管理页调用）：`command/create`、`command/remove`、`command/update`、`command/teleport`、`command/aliases`、`command/parse`，除 `command/parse` 外均要求权限 4。

## 指令

| 指令 | 权限 | 说明 |
| --- | --- | --- |
| `command <name>` | 4 | 管理指定指令，操作均写回插件配置 |

选项：

- `-c`：创建指令。
- `-a [name]`：添加指令别名。
- `-A [name]`：移除指令别名。
- `-n [name]`：修改显示名称。
- `-p [name]`：设置父指令。
- `-P, --no-parent`：移除父级。

## 配置项

本插件自身的配置在控制台中隐藏（指令覆盖记录由管理页自动维护）。内部结构为 `Schema.dict(Override)`，以指令名为键，每条 Override 的字段如下：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 形如 `parent/child`，声明指令在指令树中的归属 |
| `create` | boolean | 标记该指令由本插件创建（卸载时连同指令一起销毁） |
| `aliases` | dict | 别名覆盖，只保留与初始状态不同的部分 |
| `options` | dict | 选项声明覆盖 |
| `config` | any | 指令配置覆盖 |

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-commands
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  commands: {}
```

## 备注

- 与初始快照相同的别名不会写入配置，保证配置里只留差异；目标父指令尚未注册时先暂存，待其注册后自动补挂。
- 由本插件创建的指令在删除时会把子指令交还给原本的父指令。
- 无数据表。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/commands`。

---

## English

Command management plugin, ported from `plugins/commands` of the upstream [koishijs/webui](https://github.com/koishijs/webui) repository. It rewrites the command tree at runtime with an "initial snapshot + user override" two-layer structure — aliases, options, config, and parentage can all be changed. Overrides are persisted to the plugin config and reverted on unload.

## Features and Pages

- "Command Management" page: route `/commands/:name*` (order 500, authority 4), with a tree view for editing aliases, options, config, and parentage, plus save / remove / create menus.
- Plugin details slot: lists commands provided by each plugin.
- Localization page slot.
- RPC endpoints: `command/create`, `command/remove`, `command/update`, `command/teleport`, `command/aliases`, `command/parse` (all authority 4 except `command/parse`).

## Commands

| Command | Authority | Description |
| --- | --- | --- |
| `command <name>` | 4 | Manage the given command; all changes are persisted |

Options:

- `-c`: create the command.
- `-a [name]`: add an alias.
- `-A [name]`: remove an alias.
- `-n [name]`: rename (display name).
- `-p [name]`: set the parent command.
- `-P, --no-parent`: remove the parent.

## Configuration

The plugin's own config is hidden in the console (override records are maintained by the management page). Internally it is a `Schema.dict(Override)` keyed by command name; each Override has: `name` (e.g. `parent/child`, declaring tree placement), `create` (boolean), `aliases` (dict), `options` (dict), `config` (any).

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-commands
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  commands: {}
```

## Notes

- Only differences from the initial snapshot are persisted; pending parents are attached once registered. No tables.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/webui](https://github.com/koishijs/webui), `plugins/commands`.
