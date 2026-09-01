# @koishi-ce/plugin-console

**简体中文** | [English](#english)

Koishi 的网页控制台宿主插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/console`。它提供 `console` 服务：在 HTTP 服务器上建立 WebSocket 通道、托管控制台前端静态资源、加载各插件注册的前端入口——全部控制台类插件都以本插件为前提。

协议层抽象基座是 [`@koishi-ce/console`](https://github.com/Koishi-CE/koishi/tree/main/packages/node/console)（`Console` / `Client` / `DataService` 等），浏览器端前端基座是 [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client)。本插件的 `NodeConsole` 派生自前者并装配后者。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `uiPath` | string | `""` | 控制台页面挂载路径 |
| `apiPath` | string | `"/status"` | WebSocket 通道路径 |
| `selfUrl` | string | `""` | 公网地址，用于拼接外网 endpoint |
| `open` | boolean | - | 就绪后自动打开浏览器 |
| `head` | object[] | - | 向 index.html 注入的自定义标签（tag / attrs / content） |
| `heartbeat.interval` | number | 30 秒 | 心跳间隔 |
| `heartbeat.timeout` | number | 1 分钟 | 心跳超时 |

另有隐藏的开发用配置（devMode、cacheDir、dev.fs 等），一般无需关心。

## 功能

- **WebSocket 通道**：经 `ctx.server.ws()` 在 `apiPath` 建立，连接数变化写入 loader 的环境数据；
- **内置数据服务**：`entry`（前端入口脚本列表与初始数据）、`schema`、`permissions`，以及 `ping` 监听器；
- **入口加载**：从各插件的产物目录解析前端入口（dev 模式走 Vite 开发服务器桥接 `/vite`）；
- **自动打开**：`open: true` 且当前无已有连接时，就绪后自动打开浏览器（host 为 0.0.0.0 / :: 时换 127.0.0.1）。

## 用法

```bash
bun add @koishi-ce/plugin-console
```

```yaml
plugins:
  console:
    open: true
```

启动后访问 `http://host:port/`（uiPath 为空时）即可打开控制台。

## CE 相对上游的调整

- 共享导入映射：把 `vue` / `vue-router` / `@vueuse/core` / `@koishijs/client` / `@koishi-ce/client` 的裸导入改写到宿主共享 chunk，上游官方 webui 插件的前端产物可直接复用；
- 静态资源防路径穿越以「各 entry 自身声明的产物路径」为白名单基准（适配本仓的 workspace 目录布局），并对早期插件的 `style.css` / `index.css` 双名做兼容探测。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。本包是上游 koishijs/webui 的社区再分发，版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The web console host plugin for Koishi, ported from `plugins/console` of the upstream [koishijs/webui](https://github.com/koishijs/webui). It provides the `console` service: a WebSocket channel over the HTTP server, static hosting of the console frontend, and loading of frontend entries registered by other plugins — every console plugin depends on this one.

The protocol layer is the abstract base [`@koishi-ce/console`](https://github.com/Koishi-CE/koishi/tree/main/packages/node/console) (`Console` / `Client` / `DataService`); the browser-side foundation is [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client). This plugin's `NodeConsole` derives from the former and assembles the latter.

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `uiPath` | string | `""` | Mount path of the console UI |
| `apiPath` | string | `"/status"` | WebSocket channel path |
| `selfUrl` | string | `""` | Public URL used to build the external endpoint |
| `open` | boolean | - | Open the browser automatically once ready |
| `head` | object[] | - | Custom tags injected into index.html (tag / attrs / content) |
| `heartbeat.interval` | number | 30s | Heartbeat interval |
| `heartbeat.timeout` | number | 1min | Heartbeat timeout |

Hidden development options (devMode, cacheDir, dev.fs) also exist.

## Features

- **WebSocket channel** — established via `ctx.server.ws()` at `apiPath`; connection counts are reported into the loader's environment data.
- **Built-in data services** — `entry` (frontend entry scripts and initial data), `schema`, `permissions`, plus the `ping` listener.
- **Entry loading** — resolves frontend entries from each plugin's dist directory (dev mode bridges through a Vite dev server at `/vite`).
- **Auto-open** — with `open: true` and no existing connection, opens the browser once ready (0.0.0.0 / :: hosts are replaced with 127.0.0.1).

## Usage

```bash
bun add @koishi-ce/plugin-console
```

```yaml
plugins:
  console:
    open: true
```

Then open `http://host:port/` (with an empty uiPath) to use the console.

## CE adjustments

- A shared import map rewrites bare imports of `vue` / `vue-router` / `@vueuse/core` / `@koishijs/client` / `@koishi-ce/client` to host shared chunks, so upstream official webui plugin bundles can be reused as-is.
- Path-traversal protection whitelists against the artifact paths declared by each entry (matching this repo's workspace layout), with compatibility probing for the legacy `style.css` / `index.css` naming.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Community redistribution of upstream koishijs/webui; copyright Shigma and Koishijs contributors (upstream) and Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
