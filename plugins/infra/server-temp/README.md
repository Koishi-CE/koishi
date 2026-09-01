# @koishi-ce/plugin-server-temp

**简体中文** | [English](#english)

临时文件服务插件，移植自上游 [cordiverse/server](https://github.com/cordiverse/server) 的 `packages/temp`（即 `@cordisjs/plugin-server-temp`）。它在 HTTP 服务上暴露临时文件路由：把本地或远程文件落盘到一次性随机目录，以随机文件名对外提供访问 URL，到期自动清理。以服务名 `server.temp` 注册（经 `ctx["server.temp"]` 访问），依赖 server 与 http 服务（即 @koishi-ce/plugin-server 与 @koishi-ce/plugin-http）。

## 功能与页面

本插件不是控制台插件，没有页面。服务 API：

- `ctx["server.temp"].create(data)`：创建一个临时文件条目，返回 `{ path, url, dispose }`。
  - `data` 为字符串时：`file:` URL 直接取本地路径；http(s) URL 经 `ctx.http` 流式拉取后落盘。
  - 也接受 Buffer 或 Web ReadableStream。
- `GET <path>/:name`：按随机文件名查表，命中则返回文件流，未命中返回 404。
- 条目到期自动清理；主动调用 `entry.dispose()` 可提前删除并注销路由。
- `start()` 时在 `<baseDir>/temp/` 下创建一次性随机目录，`stop()` 时整体删除。
- 条目由上下文 effect 托管，上下文销毁时一并清理。

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `path` | string | `"/temp"` | 路由前缀 |
| `selfUrl` | string（role link） | — | 此服务暴露在公网的地址，缺省时使用全局配置 |
| `maxAge` | number | 5 分钟 | 临时文件的默认最大存活时间 |

## 用法

本插件依赖 `server` 与 `http` 服务，需先安装并启用 @koishi-ce/plugin-server 与 @koishi-ce/plugin-http。安装：

```bash
bun add @koishi-ce/plugin-server-temp
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  server-temp: {}
```

供其他插件消费的典型用法：

```ts
const entry = await ctx["server.temp"].create(url);
// entry.url 可直接下发给聊天平台；不再需要时调用 entry.dispose()
```

## 备注

- `selfUrl` 缺省时回退到 server 全局配置的 `selfUrl`，两者皆缺省时仅输出告警，生成的 URL 将不完整。
- 落盘目录为一次性随机目录，服务停止时连同全部临时文件删除。
- 无指令、无数据表。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[cordiverse/server](https://github.com/cordiverse/server) 的 `packages/temp`。

---

## English

Temp-file server plugin, ported from `packages/temp` of the upstream [cordiverse/server](https://github.com/cordiverse/server) repository (i.e. `@cordisjs/plugin-server-temp`). It exposes temp-file routes over the HTTP service: local or remote files are written to a one-off random directory and served under random names with auto-expiring URLs. Registered as the `server.temp` service (accessed via `ctx["server.temp"]`); depends on the server and http services (@koishi-ce/plugin-server and @koishi-ce/plugin-http).

## Features

Not a console plugin; no pages. Service API:

- `ctx["server.temp"].create(data)`: creates a temp entry returning `{ path, url, dispose }`. A string `data` is treated as a `file:` URL (local path) or an http(s) URL fetched as a stream via `ctx.http`; Buffer and Web ReadableStream are also accepted.
- `GET <path>/:name`: looks up the random file name and streams the file, or 404.
- Entries are cleaned up on expiry; call `entry.dispose()` to remove one early.
- `start()` creates a one-off random directory under `<baseDir>/temp/`; `stop()` removes it entirely. Entries are also tied to context disposal.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `path` | string | `"/temp"` | Route prefix |
| `selfUrl` | string (role link) | — | Public address of this service; falls back to the global config |
| `maxAge` | number | 5 min | Default maximum lifetime of temp files |

## Usage

This plugin depends on the `server` and `http` services; install and enable @koishi-ce/plugin-server and @koishi-ce/plugin-http first.

```bash
bun add @koishi-ce/plugin-server-temp
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  server-temp: {}
```

Typical consumer usage:

```ts
const entry = await ctx["server.temp"].create(url);
// entry.url can be sent to chat platforms; call entry.dispose() when done
```

## Notes

- When `selfUrl` is unset, the server's global `selfUrl` is used; if both are missing, a warning is logged and generated URLs are incomplete. No commands, no tables.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [cordiverse/server](https://github.com/cordiverse/server), `packages/temp`.
