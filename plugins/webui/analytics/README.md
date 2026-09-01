# @koishi-ce/plugin-analytics

**简体中文** | [English](#english)

消息与指令统计分析插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/analytics`。它在控制台首页展示数值指标与统计图表，帮助你了解机器人的活跃程度与指令的使用频率。依赖 database 与 console 服务。

## 功能与页面

本插件没有独立路由，全部内容经插槽挂载在控制台首页：

- 数值卡：用户总数与昨日增量、群组总数与昨日增量，挂在 `home` 插槽。
- 图表网格：挂在 `analytic-chart` 插槽，共四个图表：
  - 历史消息量（按日折线，支持收 / 发切换）；
  - 每小时消息量（按时段柱状，支持收 / 发切换）；
  - 各机器人消息占比（平台到机器人的两层旭日图，支持收 / 发切换）；
  - 指令调用频率（日均调用量饼图）。

另提供 DAU（日活跃用户）历史等数据供前端使用。

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `statsInternal` | natural（role ms） | 10 分钟 | 统计数据落库的时间间隔 |
| `recentDayCount` | natural | 7 | 统计最近几天的数据 |

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-analytics
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  analytics: {}
```

## 备注

- 工作机制：监听消息收发与指令执行事件，在内存缓冲中按（日期、小时、维度）增量计数；跨整点或超过 `statsInternal` 才把缓冲 upsert 到数据库，进程退出或插件卸载时强制落库。
- 数据表（由本插件建表）：
  - `analytics.message`：联合主键 `date` / `hour` / `type` / `selfId` / `platform`，`count` 列存收发消息量，`type` 为 `send` / `receive`；
  - `analytics.command`：联合主键 `date` / `hour` / `name` / `selfId` / `userId` / `channelId` / `platform`，`count` 列存指令调用量。
- 前端拉取时聚合成用户 / 群组总数、昨日增量、DAU 历史、指令频率、按时段 / 按日 / 按机器人的消息量；聚合结果按自然日缓存，同一天内重复拉取复用同一结果。
- 无指令。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/analytics`。

---

## English

Message and command analytics plugin, ported from `plugins/analytics` of the upstream [koishijs/webui](https://github.com/koishijs/webui) repository. It renders numeric metrics and charts on the console home page. Depends on the database and console services.

## Features and Pages

No standalone route; everything is mounted via slots on the console home page:

- Number cards: total and yesterday's increment of users and guilds (`home` slot).
- Chart grid (`analytic-chart` slot), four charts: daily message history (line), hourly messages (bar), per-bot message share (sunburst) — each with a send/receive toggle — and command frequency (pie).

Also provides DAU history and other aggregated data.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `statsInternal` | natural (role ms) | 10 min | Interval for persisting stats to the database |
| `recentDayCount` | natural | 7 | Number of recent days to aggregate |

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-analytics
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  analytics: {}
```

## Notes

- Counts events in an in-memory buffer and upserts to the database on hour boundaries, after `statsInternal`, or on exit.
- Tables created by this plugin: `analytics.message` (primary: date / hour / type / selfId / platform, `type` is `send` / `receive`) and `analytics.command` (primary: date / hour / name / selfId / userId / channelId / platform).
- Aggregated results are cached per calendar day. No commands.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/webui](https://github.com/koishijs/webui), `plugins/analytics`.
