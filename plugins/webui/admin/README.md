# @koishi-ce/plugin-admin

**简体中文** | [English](#english)

用户、频道与权限管理插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/admin`，提供 `ctx.admin` 权限管理服务。既提供聊天内指令，也在控制台提供权限管理页面。依赖数据库；控制台功能需先启用 [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console)。

## 指令

| 指令 | 权限 | 说明 |
| --- | --- | --- |
| `user` | 3 | 用户管理父指令 |
| `user/authorize <value:natural>`（别名 `auth`） | 4 | 设置用户权限等级 |
| `user/locale <lang>` | 1 | 设置、查询（`-r` 清除）用户语言 |
| `channel` | 3 | 频道管理父指令 |
| `channel/assign [bot:user]` | 4 | 指定接管频道的机器人，`-r` 取消接管 |
| `channel/locale <lang>` | 3 | 设置频道语言 |

声明了 `config.admin` 的指令还会被注入 `-u [user:user]` 与 `-c [channel:channel]` 选项，用于代其他用户 / 频道执行（目标权限不低于操作者时拒绝）。

## 用户组体系

- `group` 表：用户组（name 与权限列表），用户经 `group:<id>` 权限加入；
- `perm_track` 表：用户组路线（按列表顺序形成权限继承链）；
- 两组均注入 `ctx.permissions.define()` 继承体系，删除用户组时自动清理全部成员与引用。

## 控制台页面

`/admin/:path*`「权限管理」（权限 4）：用户组与用户组路线两组列表的创建、重命名、删除与成员管理；对应用户 / 频道数据的批量操作经 RPC 事件（均权限 4）。

## 配置项

本插件自身无需配置。

## 用法

```bash
bun add @koishi-ce/plugin-admin
```

```yaml
plugins:
  admin: {}
```

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。本包是上游 koishijs/webui 的社区再分发，版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

User, channel and permission management for Koishi, ported from `plugins/admin` of the upstream [koishijs/webui](https://github.com/koishijs/webui), providing the `ctx.admin` service. It offers both chat commands and a console page. Requires a database; console features need [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console).

## Commands

| Command | Authority | Description |
| --- | --- | --- |
| `user` | 3 | Parent command for user management |
| `user/authorize <value:natural>` (alias `auth`) | 4 | Set a user's authority level |
| `user/locale <lang>` | 1 | Set, query (`-r` to clear) a user's locale |
| `channel` | 3 | Parent command for channel management |
| `channel/assign [bot:user]` | 4 | Assign the bot taking over a channel; `-r` unassigns |
| `channel/locale <lang>` | 3 | Set a channel's locale |

Commands declaring `config.admin` additionally get `-u [user:user]` and `-c [channel:channel]` options to act on behalf of another user / channel (rejected when the target's authority is not lower than the operator's).

## Group system

- The `group` table — user groups (name plus permission lists); users join via the `group:<id>` permission.
- The `perm_track` table — group tracks forming permission inheritance chains in list order.
- Both are fed into `ctx.permissions.define()`; deleting a group automatically removes all members and references.

## Console page

`/admin/:path*` (authority 4) — list management for groups and group tracks (create, rename, delete, membership), with batch operations over RPC events (all authority 4).

## Configuration

None.

## Usage

```bash
bun add @koishi-ce/plugin-admin
```

```yaml
plugins:
  admin: {}
```

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Community redistribution of upstream koishijs/webui; copyright Shigma and Koishijs contributors (upstream) and Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
