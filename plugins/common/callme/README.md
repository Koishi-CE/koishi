# @koishi-ce/plugin-callme

**简体中文** | [English](#english)

用户昵称插件，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `plugins/common/callme`。用户可以查询或设置自己在机器人处的称呼，称呼会显示在部分插件的回复中。

## 指令

| 指令 | 权限 | 说明 |
| --- | --- | --- |
| `callme [name:text]` | 1 | 查询或设置当前用户的称呼，别名 `nn`，并注册快捷调用「叫我 XX」 |

- 不带参数时查询当前称呼。
- 新称呼与其他用户重名时会拒绝修改。

## 配置项

本插件无需配置。

## 用法

```bash
bun add @koishi-ce/plugin-callme
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  callme: {}
```

## 备注

- 依赖数据库服务（读写内置 `user` 表的 `name` 字段）。
- 昵称仅保留纯文本，其余消息元素会被自动剥离。
- 其他插件可以通过 `common/callme` 事件（`ctx.bail`）返回字符串来拦截昵称修改。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 koishijs/koishi 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A nickname plugin, ported from `plugins/common/callme` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi) repository. Users can query or set the nickname the bot uses for them.

## Commands

| Command | Authority | Description |
| --- | --- | --- |
| `callme [name:text]` | 1 | Query or set the current user's nickname; alias `nn`, with the shortcut "叫我 XX" (Chinese only) |

Calling it without arguments queries the current nickname; duplicate nicknames are rejected.

## Configuration

None.

## Usage

```bash
bun add @koishi-ce/plugin-callme
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  callme: {}
```

## Notes

- Requires the database service (reads and writes the `name` field of the built-in `user` table).
- Nicknames are reduced to plain text; other message elements are stripped.
- Other plugins may intercept nickname changes by returning a string from the `common/callme` event (`ctx.bail`).

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This package is a community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
