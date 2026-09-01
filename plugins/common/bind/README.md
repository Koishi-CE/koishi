# @koishi-ce/plugin-bind

**简体中文** | [English](#english)

跨平台账号绑定插件，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `plugins/common/bind`。通过一次性令牌把不同平台的账号归入同一个用户，实现用户数据的跨平台互通。

## 指令

| 指令 | 权限 | 说明 |
| --- | --- | --- |
| `bind` | 0 | 绑定到账号，`-r, --remove` 解除当前平台账号的绑定 |

绑定流程：

- 在目标平台（用户数据将被覆盖的一侧）执行 `bind`，获取一枚一次性令牌，默认形如 `koishi/123456`（前缀 `koishi/` 加 6 位数字），5 分钟内有效。
- 切换到原始平台（保留用户数据的一侧）向机器人发送令牌：私聊场景一步完成绑定；群聊场景会获得第二枚令牌，需回到目标平台再次发送令牌完成绑定。
- `bind -r` 解除当前平台账号的绑定。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `tokenPrefix` | string | `koishi/` | 令牌前缀 |
| `generateToken` | function | 内置随机生成 | 自定义令牌生成函数（控制台中隐藏） |

## 用法

```bash
bun add @koishi-ce/plugin-bind
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  bind: {}
```

## 备注

- 依赖数据库服务，使用内置 `binding` 表与 `user` 表。
- 通过前置中间件拦截令牌文本驱动绑定流程；令牌一次性使用，在同一账号重复输入会提示前往对侧平台。
- 消费第一步令牌的账号（原始平台一侧）必须是已注册账号（authority 大于 0），未注册账号不能完成绑定。
- 解绑时，从其他用户迁移而来的账号会恢复其原初绑定；最后一个原初绑定不允许解绑，避免用户失去账号入口。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A cross-platform account binding plugin, ported from `plugins/common/bind` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi) repository. It merges accounts from different platforms into a single user via one-time tokens.

## Commands

| Command | Authority | Description |
| --- | --- | --- |
| `bind` | 0 | Bind to an account; `-r, --remove` unbinds the current platform account |

Binding flow: run `bind` on the target platform (the side whose user data will be overwritten) to get a one-time token (by default `koishi/` plus 6 digits, valid for 5 minutes), then send the token to the bot on the original platform (the side whose data is kept). In direct chat the binding completes in one step; in groups a second token is issued and must be sent back on the target platform.

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `tokenPrefix` | string | `koishi/` | Token prefix |
| `generateToken` | function | built-in generator | Custom token generator (hidden in the console) |

## Usage

```bash
bun add @koishi-ce/plugin-bind
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  bind: {}
```

## Notes

- Requires the database service (built-in `binding` and `user` tables).
- A leading middleware intercepts token texts; tokens are single-use, and re-entering one on the same account prompts to use the other platform.
- The account consuming the first token must be registered (authority greater than 0).
- Unbinding restores migrated accounts to their original binding; the last original binding cannot be removed.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This package is a community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
