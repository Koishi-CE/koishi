# @koishi-ce/plugin-sandbox

**简体中文** | [English](#english)

机器人调试沙盒插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/sandbox`。它把控制台里的沙盒页面伪装成一个聊天平台适配器：你在网页上发送的消息会走完整的会话链路，机器人的回复直接渲染回页面，无需连接任何真实聊天平台即可调试。依赖 console、server 服务与数据库（使用内置 `binding` / `user` 表）。

## 功能与页面

- 「沙盒」页面：路由 `/sandbox`（order 300，权限 4）：
  - 支持创建多个虚拟用户（昵称候选从 Alice、Bob、Carol 一直到 Zoe），可增删用户资料；
  - 消息可删除、可引用回复（右键菜单）。
- 机制：
  - 每个平台全局唯一一个 SandboxBot（`selfId` 固定为 `koishi`，标记为 hidden，不出现在普通机器人列表中），浏览器端发送的消息经它转成标准会话派发；
  - 主动调用类 API（如 `getChannelList`、`getGuildMemberList`）经反向 RPC 由浏览器执行，以随机 nonce 关联请求与应答，5 秒超时；
  - 控制台连接断开时自动清理对应的沙盒机器人。
- RPC 接口（均要求权限 4）：`sandbox/send-message`、`sandbox/delete-message`、`sandbox/get-user`、`sandbox/set-user`、`sandbox/response`。
- 提供 `sandbox` 数据服务：按平台统计绑定用户数，供沙盒页面展示平台列表。

## 指令

| 指令 | 说明 |
| --- | --- |
| `clear` | 清空聊天记录（仅对 `sandbox:` 平台的会话生效） |

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `fileServer.enabled` | boolean | `false` | 是否提供本地静态文件服务；开启后把沙盒消息中 `file:` 本地资源经 `/sandbox/:url` 路由暴露为 HTTP。请勿在暴露在公网的设备上开启此选项。 |

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-sandbox
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  sandbox: {}
```

## 备注

- 沙盒用户首次使用时按 authority 1 自动创建，与真实平台的用户数据共用同一套表。
- 沙盒平台名以 `sandbox:` 为前缀，聊天会话与真实平台走完全相同的指令链路。
- `sandbox/set-user` 以空数据进入频道、以 null 退出频道，分别对应 `guild-member-added` / `guild-member-removed` 事件。
- 无数据表（复用内置 `binding` / `user` 表）。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/sandbox`。

---

## English

Bot debugging sandbox plugin, ported from `plugins/sandbox` of the upstream [koishijs/webui](https://github.com/koishijs/webui) repository. It disguises the console sandbox page as a chat platform adapter: messages sent from the page go through the full session pipeline and bot replies render right back — no real chat platform needed. Depends on the console and server services and a database (built-in `binding` / `user` tables).

## Features and Pages

- "Sandbox" page: route `/sandbox` (order 300, authority 4):
  - Multiple virtual users (nickname candidates from Alice, Bob, Carol … to Zoe) with manageable profiles;
  - Messages can be deleted and quoted (context menu).
- Mechanics:
  - One globally unique SandboxBot per platform (`selfId` fixed to `koishi`, marked hidden);
  - Active APIs (e.g. `getChannelList`, `getGuildMemberList`) are executed in the browser via reverse RPC, correlated by a random nonce with a 5-second timeout;
  - Sandbox bots are cleaned up when the console connection drops.
- RPC endpoints (all authority 4): `sandbox/send-message`, `sandbox/delete-message`, `sandbox/get-user`, `sandbox/set-user`, `sandbox/response`.
- Provides the `sandbox` data service: per-platform binding counts for the platform list.

## Commands

| Command | Description |
| --- | --- |
| `clear` | Clear chat history (only effective on `sandbox:` platform sessions) |

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `fileServer.enabled` | boolean | `false` | Serve local files referenced by `file:` URLs via the `/sandbox/:url` route. Do not enable on public-facing devices. |

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-sandbox
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  sandbox: {}
```

## Notes

- Sandbox users are created automatically with authority 1, sharing tables with real platforms.
- Sandbox platform names are prefixed with `sandbox:`; sessions go through the exact same command pipeline as real platforms.
- No tables of its own.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/webui](https://github.com/koishijs/webui), `plugins/sandbox`.
