# @koishi-ce/plugin-help

**简体中文** | [English](#english)

帮助指令插件，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `plugins/common/help`。列出当前可用的指令清单，或输出某条指令的详细帮助（描述、别名、用法、选项、示例与子指令），并按权限与隐藏标记过滤展示内容。

## 指令

| 指令 | 权限 | 说明 |
| --- | --- | --- |
| `help [command:string]` | 0 | 显示帮助信息，选项 `-H, --showHidden` 查看隐藏的选项和指令 |

- 不带参数时列出当前可用的全部指令（按显示名排序），带参数时输出目标指令的详细帮助。
- 注册全局快捷调用「帮助」（fuzzy 匹配）。
- 指令参数除指令名外，也可以直接输入某条指令的快捷调用文本来定位指令。
- 未找到指令时，按相似度给出「您要找的是不是…」建议。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `shortcut` | boolean | `true` | 是否启用快捷调用 |
| `options` | boolean | `true` | 是否为每个指令添加 `-h, --help` 选项 |

### 指令与选项配置扩展

本插件经 `ctx.schema.extend` 为每条指令及指令选项追加以下配置（出现在各指令的配置中，而非本插件的配置）：

| 位置 | 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| 指令 | `hidden` | 计算属性 boolean | `false` | 在帮助菜单中隐藏指令 |
| 指令 | `hideOptions` | boolean | `false` | 是否隐藏所有选项 |
| 指令 | `params` | any | — | 帮助信息的本地化参数 |
| 选项 | `hidden` | 计算属性 boolean | `false` | 在帮助菜单中隐藏选项 |
| 选项 | `params` | any | — | 帮助信息的本地化参数 |

## 用法

```bash
bun add @koishi-ce/plugin-help
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  help: {}
```

## 备注

- 为所有指令注入隐藏的 `-h, --help` 选项；带 `-h` 调用、或调用本身没有 action 的指令时，自动转而输出该指令的帮助。
- 详细帮助依次输出：指令标题、描述、别名、用法、可用选项、使用示例与子指令列表。
- 选项的权限要求高于当前用户、或被 `hidden` 标记隐藏时不展示，`-H` 可查看。
- 指令列表与详情均按 `command:<name>` 权限过滤，无权限的指令不展示。
- 提供 `help/command` 与 `help/option` 事件，供其他插件改写帮助输出。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A help command plugin, ported from `plugins/common/help` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi) repository. It lists the available commands, or shows detailed help for a specific command (description, aliases, usage, options, examples and subcommands), filtered by authority and hidden flags.

## Commands

| Command | Authority | Description |
| --- | --- | --- |
| `help [command:string]` | 0 | Show help; the `-H, --showHidden` option reveals hidden options and commands |

- Without arguments it lists all available commands; with an argument it shows detailed help for the target command.
- Registers the global shortcut "帮助" (Chinese, fuzzy matching).
- When a command is not found, it suggests similar ones.

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `shortcut` | boolean | `true` | Whether to enable the shortcut |
| `options` | boolean | `true` | Whether to add a `-h, --help` option to every command |

### Command and Option Config Extensions

Via `ctx.schema.extend`, the following fields are appended to every command and option config (on each command, not on this plugin):

| Scope | Field | Type | Default | Description |
| --- | --- | --- | --- | --- |
| Command | `hidden` | computed boolean | `false` | Hide the command from help menus |
| Command | `hideOptions` | boolean | `false` | Hide all options |
| Command | `params` | any | — | Localization params for help output |
| Option | `hidden` | computed boolean | `false` | Hide the option from help menus |
| Option | `params` | any | — | Localization params for help output |

## Usage

```bash
bun add @koishi-ce/plugin-help
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  help: {}
```

## Notes

- Injects a hidden `-h, --help` option into every command; calling with `-h`, or calling a command without an action, shows its help instead.
- Options whose authority exceeds the user or marked as `hidden` are not shown unless `-H` is used.
- Command lists and details are filtered by the `command:<name>` permission.
- Provides `help/command` and `help/option` events for other plugins to customize the output.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This package is a community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
