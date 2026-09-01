# @koishi-ce/plugin-echo

**简体中文** | [English](#english)

消息复述插件，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `plugins/common/echo`。原样返回输入的文本，常用于测试机器人的消息收发链路。

## 指令

| 指令 | 权限 | 说明 |
| --- | --- | --- |
| `echo <message:text>` | 1 | 原样复述输入的文本 |

- 以下选项均要求权限 3：`-e, --escape` 发送转义消息、`-E, --unescape` 发送反转义消息、`-u, --user [user:user]` 发送到用户、`-c, --channel [channel:channel]` 发送到频道、`-g, --guild [guild:string]` 指定群组编号。
- `-u` / `-c` 的目标按 `platform:id` 形式解析，并改由目标平台的 bot 发送；找不到对应平台时提示「找不到指定的平台。」。

## 配置项

本插件无需配置。

## 用法

```bash
bun add @koishi-ce/plugin-echo
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  echo: {}
```

## 备注

- 无配置、无服务依赖，开箱即用。
- 导出工具函数 `parsePlatform`，用于解析 `platform:id` 形式的目标标识。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A message echo plugin, ported from `plugins/common/echo` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi) repository. It repeats the input text verbatim, which is handy for testing the bot's message pipeline.

## Commands

| Command | Authority | Description |
| --- | --- | --- |
| `echo <message:text>` | 1 | Repeat the input text verbatim |

- The following options all require authority 3: `-e, --escape` send the message escaped, `-E, --unescape` send the message unescaped, `-u, --user [user:user]` send to a user, `-c, --channel [channel:channel]` send to a channel, `-g, --guild [guild:string]` specify the guild ID.
- Targets of `-u` / `-c` are resolved as `platform:id` and the message is sent by the bot of that platform; a missing platform reports an error.

## Configuration

None.

## Usage

```bash
bun add @koishi-ce/plugin-echo
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  echo: {}
```

## Notes

- No configuration and no service dependencies.
- Exports the utility function `parsePlatform` for parsing `platform:id` targets.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This package is a community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
