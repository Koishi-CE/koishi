# @koishi-ce/plugin-logger

**简体中文** | [English](#english)

日志插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/logger`。它把应用日志按「日期-序号」滚动写入文件，同时在控制台中提供实时日志查看器，并可按来源插件过滤。

## 功能与页面

- 「日志」页面：路由 `/logs`（order 0，权限 4），实时查看与过滤日志。
- 插件详情页插槽：展示该插件的运行日志（按来源路径过滤）。
- 机制：
  - 日志写入 `yyyy-MM-dd-n.log` 文件，每行一条 JSON 记录；
  - 跨日期或单文件超过 `maxSize` 时自动轮转到下一个序号，超过 `maxAge` 天的文件在轮转时清理；
  - 新日志先攒入缓冲，每 100ms 节流批量推送给前端；
  - 每条记录附带来源插件的路径（loader paths），供前端按插件过滤。
- 提供 `logs` 数据服务（当前日志文件的全量记录）。

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `root` | path | `"data/logs"` | 存放输出日志的本地目录 |
| `maxAge` | natural | 30 | 日志文件保存的最大天数 |
| `maxSize` | natural | 102400 | 单个日志文件的最大大小（KB），超过后触发轮转 |

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-logger
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  logger: {}
```

## 备注

- 启动时扫描既有日志文件以确定起始序号，并补写 loader 在本插件之前暂存的前置日志。
- 卸载时关闭文件、摘除全局日志 target。
- 无指令、无数据表。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/logger`。

---

## English

Logger plugin, ported from `plugins/logger` of the upstream [koishijs/webui](https://github.com/koishijs/webui) repository. It writes application logs to rotating files named by date and index, and provides a real-time log viewer in the console with per-plugin filtering.

## Features and Pages

- "Logs" page: route `/logs` (order 0, authority 4) for live viewing and filtering.
- Plugin details slot: shows the runtime logs of that plugin (filtered by source path).
- Mechanics: logs are written to `yyyy-MM-dd-n.log` as JSON lines; files rotate across dates or when exceeding `maxSize`, and files older than `maxAge` days are cleaned up; new records are buffered and pushed to the frontend in throttled 100ms batches; each record carries the source plugin paths.
- Provides the `logs` data service (full records of the current log file).

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `root` | path | `"data/logs"` | Local directory for log files |
| `maxAge` | natural | 30 | Maximum age of log files in days |
| `maxSize` | natural | 102400 | Maximum size of a single log file (KB) before rotation |

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-logger
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  logger: {}
```

## Notes

- Existing files are scanned on startup to determine the starting index, and logs buffered by the loader before this plugin are written back. No commands, no tables.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/webui](https://github.com/koishijs/webui), `plugins/logger`.
