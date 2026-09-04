# @koishi-ce/plugin-proxy-agent

**简体中文** | [English](#english)

Koishi 的请求代理支持，为全部 `ctx.http` 请求提供统一的代理默认值。本包是 [@cordisjs/plugin-proxy-agent](https://github.com/cordiverse/http) 在 `@koishi-ce` 名下的再分发存根：内联再导出上游包的全部导出，peer 指向 `@koishi-ce/koishi`。它是预编译产物包——无 `src/` 目录、不走根 tsdown 构建（根配置显式 exclude），发布内容即 `index.mjs` 与 `index.d.ts`；上游目录名为 `proxy-agent`，本仓按装载语义改名 `proxy`。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `proxyAgent` | string | - | 默认代理服务器地址（http / https / socks），所有未单独指定代理的请求经此转发 |

## 用法

```bash
bun add @koishi-ce/plugin-proxy-agent
```

```yaml
plugins:
  proxy-agent:
    proxyAgent: "http://127.0.0.1:7890"
```

启用后 `ctx.http` 的请求默认走配置的代理；单次请求仍可通过 `proxyAgent` 选项覆盖（包括传空串禁用）。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包内联再导出 MIT 许可的上游 @cordisjs/plugin-proxy-agent，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

Proxy agent support for Koishi, providing a unified proxy default for all `ctx.http` requests. This package is a redistribution stub of [@cordisjs/plugin-proxy-agent](https://github.com/cordiverse/http) under the `@koishi-ce` scope: it re-exports the upstream package in full, with a peer on `@koishi-ce/koishi`. It is a prebuilt artifact package — no `src/` directory, excluded from the root tsdown build — whose published content is just `index.mjs` and `index.d.ts`; the upstream directory is named `proxy-agent`, renamed to `proxy` in this repository to match its loading semantics.

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `proxyAgent` | string | - | Default proxy server (http / https / socks) for requests that do not specify their own |

## Usage

```bash
bun add @koishi-ce/plugin-proxy-agent
```

```yaml
plugins:
  proxy-agent:
    proxyAgent: "http://127.0.0.1:7890"
```

Once enabled, `ctx.http` requests go through the configured proxy by default; individual requests may still override it via the `proxyAgent` option (an empty string disables the proxy).

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This stub re-exports the MIT-licensed upstream @cordisjs/plugin-proxy-agent; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
