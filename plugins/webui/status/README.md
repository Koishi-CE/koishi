# @koishi-ce/plugin-status

**简体中文** | [English](#english)

仪表盘插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/status`。它采集运行环境信息与性能数据，在控制台各处展示机器人的运行状态。依赖 console 服务。

## 功能与页面

本插件没有独立路由，全部展示经插槽挂载：

- 状态栏右侧：机器人状态指示灯与 CPU / 内存负载。
- 状态栏左侧：版本号等运行环境信息。
- `analytic-number` 数值卡插槽：当前 / 近期的消息量数值卡（供 analytics 插件的首页数值区复用）。
- 插件详情页：该插件所辖机器人的预览。

数据服务：

- `envinfo`：一次性采集 OS、CPU、运行时版本、包管理器与 Koishi 生态版本信息，结果在进程生命周期内永久缓存。
- `status`：按 `tickInterval` 周期采集并推送——CPU 负载率与内存负载率（各为「进程, 整机」二元组）、各机器人最近一分钟收发消息量的滑窗计数（每秒一槽、共 60 槽的滑动窗口）。

## 指令

| 指令 | 说明 |
| --- | --- |
| `status` | 查看运行状态：逐个输出各机器人状态，末尾附 CPU / 内存使用率摘要 |

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `tickInterval` | natural（role ms） | 5 秒 | 性能数据推送的时间间隔 |

客户端本地设置（控制台「机器人设置」面板）：

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `mergeThreshold` | number | 10 | 机器人数量超过该值时合并显示状态指示灯 |

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-status
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  status: {}
```

## 备注

- `status` 指令的输出含各机器人的在线状态（运行中 / 离线 / 正在连接等）与整体 CPU / 内存使用率（进程与整机两个口径）。
- 机器人登录、登出与更新事件会触发防抖刷新。
- 不建表。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/status`。

---

## English

Dashboard plugin, ported from `plugins/status` of the upstream [koishijs/webui](https://github.com/koishijs/webui) repository. It collects environment info and performance data, displaying bot status across the console. Depends on the console service.

## Features and Pages

No standalone route; everything is mounted via slots:

- Status bar (right): bot status indicators and CPU / memory load.
- Status bar (left): runtime environment and version info.
- `analytic-number` slot: message-rate number cards reused by the analytics plugin's home page.
- Plugin details slot: bot preview for the plugin.

Data services:

- `envinfo`: one-shot collection of OS, CPU, runtime versions, package manager, and Koishi ecosystem versions, cached for the process lifetime.
- `status`: periodic collection at `tickInterval` — CPU and memory load rates (each a `[app, total]` pair) and per-bot send/receive message counts over the last minute (60-slot sliding window, one slot per second).

## Commands

| Command | Description |
| --- | --- |
| `status` | Show runtime status: each bot's state, followed by a CPU / memory usage summary |

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `tickInterval` | natural (role ms) | 5 s | Interval for pushing performance data |

Client-side local setting ("Bot Settings" panel):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mergeThreshold` | number | 10 | Merge status indicators when the bot count exceeds this value |

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-status
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  status: {}
```

## Notes

- Login events trigger debounced refreshes. No tables.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/webui](https://github.com/koishijs/webui), `plugins/status`.
