# @koishi-ce/plugin-assets-local

**简体中文** | [English](#english)

本地资源服务插件，移植自上游 [koishijs/assets](https://github.com/koishijs/assets) 的 `packages/local`。它是 assets 资源服务的第一方本地实现：把消息中的媒体文件持久化到本地目录，并经服务器暴露为静态文件路由，使资源以 URL 形式被外部引用。

## 指令

本插件不提供指令。它实现并对外提供 `assets` 服务（继承 `@koishi-ce/assets` 基类），供消息收发链路与其他插件消费。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `root` | path | `data/assets` | 本地存储资源文件的相对路径 |
| `path` | string | `/files` | 静态文件暴露在服务器的路径 |
| `selfUrl` | string | — | Koishi 服务暴露在公网的地址，缺省时使用全局配置 |
| `secret` | string | — | 用于验证上传者的密钥，配合 assets-remote 使用 |
| `whitelist` | string[] | — | 不处理的白名单 URL 列表（基类配置） |

## 用法

```bash
bun add @koishi-ce/plugin-assets-local
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  assets-local: {}
```

## 备注

- 注入 `server` 服务（@koishi-ce/plugin-server），注册以下路由：
  - `GET <path>`：返回存量统计（文件数与总大小）。
  - `GET <path>/:name`：按文件头魔数（而非扩展名）判定 MIME 后流式返回文件。
  - `POST <path>`：配置了 `secret` 时经 HMAC-SHA1 校验后接收上传。
- 插件与全局均未配置 `selfUrl` 时，资源 URL 回退为 file: 协议地址（无服务器场景）。
- 启动时自动把旧版 `public/` 目录迁移到数据目录。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 [koishijs/assets](https://github.com/koishijs/assets) 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A local assets plugin, ported from `packages/local` of the upstream [koishijs/assets](https://github.com/koishijs/assets) repository. It is the first-party local implementation of the assets service: media files in messages are persisted to a local directory and exposed as static file routes through the server.

## Commands

This plugin provides no commands. It implements and exports the `assets` service (extending the `@koishi-ce/assets` base class) for the message pipeline and other plugins.

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `root` | path | `data/assets` | Relative path of the local storage directory |
| `path` | string | `/files` | Path where static files are exposed on the server |
| `selfUrl` | string | — | Public URL of the Koishi server; falls back to the global config |
| `secret` | string | — | Secret for verifying uploads, used with assets-remote |
| `whitelist` | string[] | — | List of whitelisted URLs to leave untouched (base class config) |

## Usage

```bash
bun add @koishi-ce/plugin-assets-local
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  assets-local: {}
```

## Notes

- Injects the `server` service (@koishi-ce/plugin-server) and registers these routes: `GET <path>` returns asset stats; `GET <path>/:name` streams a file with MIME detected from magic bytes (not the extension); `POST <path>` accepts uploads verified by HMAC-SHA1 when `secret` is set.
- If `selfUrl` is missing from both the plugin and the global config, asset URLs fall back to the file: scheme (no-server scenario).
- Legacy `public/` directories are migrated to the data directory on startup.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This package is a community redistribution of upstream koishijs/assets; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
