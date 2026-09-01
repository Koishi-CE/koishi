# @koishi-ce/plugin-server

**简体中文** | [English](#english)

Koishi 的服务器与路由服务，提供 `ctx.server`。本包是 [@cordisjs/plugin-server](https://github.com/cordiverse/server)（基于 Node 原生 http 的轻量路由服务）在 `@koishi-ce` 名下的再分发存根：内联再导出上游包的全部导出，peer 指向 `@koishi-ce/koishi`。控制台（plugin-console）、资源服务、server-temp 等都建立在它之上。

## 服务

`ctx.server` 提供声明式路由（`ctx.server.get/post/...`）、WebSocket 升级（`ctx.server.ws()`）与中间件挂载，监听独立的 HTTP 端口，不与任何 Web 框架耦合。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `host` | string | - | 监听地址 |
| `port` | number | - | 监听端口 |
| `maxPort` | number | - | 端口被占时向后尝试的上限 |
| `selfUrl` | string | - | 公网地址，用于拼接对外的完整 URL |

## 用法

```bash
bun add @koishi-ce/plugin-server
```

```yaml
plugins:
  server:
    port: 5140
    maxPort: 5149
```

```ts
export function apply(ctx) {
  ctx.server.get("/hello", () => "world");
}
```

上游文档见 [cordiverse/server](https://github.com/cordiverse/server)。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包内联再导出 MIT 许可的上游 @cordisjs/plugin-server，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The server and router service for Koishi, providing `ctx.server`. This package is a redistribution stub of [@cordisjs/plugin-server](https://github.com/cordiverse/server) (a lightweight router over Node's native http) under the `@koishi-ce` scope: it re-exports the upstream package in full, with a peer on `@koishi-ce/koishi`. The console (plugin-console), assets services and server-temp all build on it.

## Service

`ctx.server` provides declarative routing (`ctx.server.get/post/...`), WebSocket upgrades (`ctx.server.ws()`) and middleware mounting, listening on its own HTTP port without coupling to any web framework.

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `host` | string | - | Listen address |
| `port` | number | - | Listen port |
| `maxPort` | number | - | Upper bound when trying subsequent ports |
| `selfUrl` | string | - | Public URL used to build external links |

## Usage

```bash
bun add @koishi-ce/plugin-server
```

```yaml
plugins:
  server:
    port: 5140
    maxPort: 5149
```

```ts
export function apply(ctx) {
  ctx.server.get("/hello", () => "world");
}
```

See [cordiverse/server](https://github.com/cordiverse/server) for upstream documentation.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This stub re-exports the MIT-licensed upstream @cordisjs/plugin-server; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
