# @koishi-ce/plugin-http

**简体中文** | [English](#english)

Koishi 的 HTTP 与 WebSocket 客户端基础服务，提供 `ctx.http`。本包是 [@cordisjs/plugin-http](https://github.com/cordiverse/http)（fetch 实现的 axios 风格客户端）在 `@koishi-ce` 名下的再分发存根：内联再导出上游包的全部导出，peer 指向 `@koishi-ce/koishi`，使 CE 生态获得统一的 HTTP 服务而不引入官方包双实例。它是预编译产物包——无 `src/` 目录、不走根 tsdown 构建（根配置显式 exclude），发布内容即 `index.mjs` 与 `index.d.ts`。

## 服务

`ctx.http` 提供整套请求方法（`get` / `post` / `put` / `patch` / `delete` / `head` 与 `ws` 等）、请求拦截器、`http/file` 文件缓存等事件，请求与响应的形态为 axios 风格（`Response` 携带 `data` / `status` / `headers`）。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `baseURL` | string | - | 请求的基础地址（旧名 `endpoint` 已废弃） |
| `headers` | object | - | 默认请求头 |
| `timeout` | number | - | 默认超时（毫秒） |

单次请求可额外指定 `method` / `params` / `data` / `keepAlive` / `redirect` / `responseType` / `validateStatus` 等。

## 用法

```bash
bun add @koishi-ce/plugin-http
```

```yaml
plugins:
  http:
    timeout: 10000
```

```ts
export async function apply(ctx) {
  const data = await ctx.http.get("https://example.com/api", { params: { q: 1 } });
}
```

上游文档见 [cordiverse/http](https://github.com/cordiverse/http)。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包内联再导出 MIT 许可的上游 @cordisjs/plugin-http，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The HTTP and WebSocket client service for Koishi, providing `ctx.http`. This package is a redistribution stub of [@cordisjs/plugin-http](https://github.com/cordiverse/http) (a fetch-based, axios-style client) under the `@koishi-ce` scope: it re-exports the upstream package in full, with a peer on `@koishi-ce/koishi`, giving the CE ecosystem a unified HTTP service without a duplicate official instance. It is a prebuilt artifact package — no `src/` directory, excluded from the root tsdown build — whose published content is just `index.mjs` and `index.d.ts`.

## Service

`ctx.http` offers the full request API (`get` / `post` / `put` / `patch` / `delete` / `head`, `ws`, ...), request interceptors, `http/file` caching events and more, in an axios-style shape (`Response` carries `data` / `status` / `headers`).

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `baseURL` | string | - | Base URL for requests (the old name `endpoint` is deprecated) |
| `headers` | object | - | Default request headers |
| `timeout` | number | - | Default timeout in milliseconds |

Per-request options include `method` / `params` / `data` / `keepAlive` / `redirect` / `responseType` / `validateStatus`.

## Usage

```bash
bun add @koishi-ce/plugin-http
```

```yaml
plugins:
  http:
    timeout: 10000
```

```ts
export async function apply(ctx) {
  const data = await ctx.http.get("https://example.com/api", { params: { q: 1 } });
}
```

See [cordiverse/http](https://github.com/cordiverse/http) for upstream documentation.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This stub re-exports the MIT-licensed upstream @cordisjs/plugin-http; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
