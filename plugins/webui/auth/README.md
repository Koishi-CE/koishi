# @koishi-ce/plugin-auth

**简体中文** | [English](#english)

控制台的用户登录鉴权插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/auth`，提供 `ctx.auth` 服务。控制台要部署到公网时建议安装本插件，否则任何能访问端口的人都能操作你的机器人。需要先启用 [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console)，并依赖数据库。

## 登录方式

- **用户名密码**：`login/password`，使用内置管理员或数据库中的用户；
- **平台验证码**：`login/platform`，网页生成 6 位验证码，用户把验证码发给任意机器人完成登录（同时可绑定平台账号，支持私聊一步、群聊两步）；
- **令牌续期**：`login/token`，已保存的登录令牌静默续期，页面刷新自动执行。

密码哈希采用 PBKDF2-HMAC-SHA256（600k 轮，OWASP 2023 建议）；历史无盐 SHA-256 哈希在命中后透明升级。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `admin.enabled` | boolean | true | 启动时确保内置管理员账户存在（id 0，权限 5） |
| `admin.username` | string | admin | 内置管理员用户名 |
| `admin.password` | string | （必填） | 内置管理员密码 |
| `authTokenExpire` | number | 1 周 | 登录令牌有效期（最小 1 小时） |
| `loginTokenExpire` | number | 10 分钟 | 平台验证码有效期（最小 1 分钟） |

## 数据表

- 扩展内置 `user` 表：`password`（哈希）、`config`（客户端控制台配置快照，支持多客户端同步）；
- 新建 `token` 表：登录令牌记录（类型、过期时间、最近使用时间、User-Agent、来源地址）。

## 页面与行为

- `/login`「登录」页与 `/profile`「用户资料」页；未登录访问自动跳转，权限不足的页面与活动自动隐藏；
- 绑定平台账户、多客户端配置同步冲突两个全局对话框；
- 服务端 `console/intercept` 拦截器按权限拒绝未登录、令牌过期与权限不足的事件调用。

## 用法

```bash
bun add @koishi-ce/plugin-auth
```

```yaml
plugins:
  console: {}
  auth:
    admin:
      username: admin
      password: "你的密码"
```

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。本包是上游 koishijs/webui 的社区再分发，版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

Console user authentication for Koishi, ported from `plugins/auth` of the upstream [koishijs/webui](https://github.com/koishijs/webui), providing the `ctx.auth` service. Recommended whenever the console is exposed to a public network — without it, anyone who can reach the port can operate your bot. Requires [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console) and a database.

## Login methods

- **Username + password** (`login/password`) — the built-in admin or database users.
- **Platform verification code** (`login/platform`) — the web page shows a 6-digit code; the user sends it to any bot to log in (optionally binding the platform account; one step in private chat, two steps in groups).
- **Token renewal** (`login/token`) — saved tokens renew silently; page refreshes do this automatically.

Password hashing uses PBKDF2-HMAC-SHA256 (600k iterations, OWASP 2023); legacy unsalted SHA-256 hashes are transparently upgraded on first match.

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `admin.enabled` | boolean | true | Ensure the built-in admin account exists on startup (id 0, authority 5) |
| `admin.username` | string | admin | Built-in admin username |
| `admin.password` | string | (required) | Built-in admin password |
| `authTokenExpire` | number | 1 week | Login token lifetime (min 1 hour) |
| `loginTokenExpire` | number | 10 min | Platform code lifetime (min 1 minute) |

## Tables

Extends the built-in `user` table (`password` hash, `config` snapshot for cross-client settings sync) and creates a `token` table (type, expiry, last-used time, User-Agent, address).

## Pages and behavior

- `/login` and `/profile` pages; unauthenticated visits redirect to login; pages and activities beyond the user's authority are hidden.
- Global dialogs for platform-account binding and settings-sync conflicts.
- A server-side `console/intercept` interceptor rejects unauthenticated, expired and insufficient-authority event calls.

## Usage

```bash
bun add @koishi-ce/plugin-auth
```

```yaml
plugins:
  console: {}
  auth:
    admin:
      username: admin
      password: "your-password"
```

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Community redistribution of upstream koishijs/webui; copyright Shigma and Koishijs contributors (upstream) and Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
