# @koishi-ce/plugin-broadcast

**简体中文** | [English](#english)

全体广播插件，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `plugins/common/broadcast`。向机器人所在的全部频道一次性推送广播消息。

## 指令

| 指令 | 权限 | 说明 |
| --- | --- | --- |
| `broadcast <message:text>` | 4 | 全服广播 |

- `-f, --forced`：无视 silent 标签进行广播。
- `-o, --only`：仅向当前账号负责的群进行广播。

## 配置项

本插件无需配置。

## 用法

```bash
bun add @koishi-ce/plugin-broadcast
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  broadcast: {}
```

## 备注

- 依赖数据库服务，读取内置 `channel` 表的 assignee 与 flag 字段，不新建表。
- 默认跳过标记为静默（silent）的频道，`-f` 可强制发送到这些频道。
- `-o` 只向当前平台、当前 bot 被指派（assignee）的频道发送。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A global broadcast plugin, ported from `plugins/common/broadcast` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi) repository. It pushes a message to all channels the bots have joined.

## Commands

| Command | Authority | Description |
| --- | --- | --- |
| `broadcast <message:text>` | 4 | Broadcast to all channels |

- `-f, --forced`: broadcast even to channels marked as silent.
- `-o, --only`: broadcast only to the channels assigned to the current account.

## Configuration

None.

## Usage

```bash
bun add @koishi-ce/plugin-broadcast
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  broadcast: {}
```

## Notes

- Requires the database service (reads the assignee and flag fields of the built-in `channel` table; no new tables).
- Silent channels are skipped by default; `-f` forces delivery to them.
- `-o` sends only to the channels assigned to the current platform and bot.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This package is a community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
