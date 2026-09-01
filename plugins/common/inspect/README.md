# @koishi-ce/plugin-inspect

**简体中文** | [English](#english)

消息检查插件，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `plugins/common/inspect`。查看当前会话或所引用消息的元信息，包括平台名、消息 ID、频道 ID、群组 ID、用户 ID 与自身 ID。

## 指令

| 指令 | 权限 | 说明 |
| --- | --- | --- |
| `inspect` | 1 | 查看用户、频道或消息的详细信息 |

- `inspect @user`：输出所 @ 的用户 ID。
- `inspect #channel`：输出所 # 的频道 ID。
- `inspect`：输出当前会话的元信息；若消息带有引用，则优先展示被引用消息的信息。

## 配置项

本插件无需配置。

## 用法

```bash
bun add @koishi-ce/plugin-inspect
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  inspect: {}
```

## 备注

- 指令设置了 `captureQuote: false`，引用消息不被消费而是保留在会话对象上，因此能检查被引用消息的元信息。
- 无法解析的元素会提示「参数无法解析。」。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A message inspection plugin, ported from `plugins/common/inspect` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi) repository. It shows the metadata of the current session or a quoted message: platform, message ID, channel ID, guild ID, user ID and self ID.

## Commands

| Command | Authority | Description |
| --- | --- | --- |
| `inspect` | 1 | Inspect detailed information about a user, channel or message |

- `inspect @user`: print the ID of the mentioned user.
- `inspect #channel`: print the ID of the referenced channel.
- `inspect`: print the metadata of the current session; a quoted message takes precedence.

## Configuration

None.

## Usage

```bash
bun add @koishi-ce/plugin-inspect
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  inspect: {}
```

## Notes

- The command sets `captureQuote: false`, so the quote stays on the session object and can be inspected.
- Unparsable elements report an error.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This package is a community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
