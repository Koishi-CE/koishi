# @koishi-ce/plugin-rate-limit

**简体中文** | [English](#english)

指令调用频率限制插件，移植自上游 [koishijs/common](https://github.com/koishijs/common) 的 `packages/rate-limit`。为每条指令提供两类限制策略：每日调用次数上限（maxUsage）与连续调用的最小间隔（minInterval），计数与计时存于用户数据中，跨日自动清零。

## 指令

| 指令 | 权限 | 说明 |
| --- | --- | --- |
| `usage [key] [value:posint]` | 1 | 调用次数信息，`-s, --set` 设置调用次数、`-c, --clear` 清空调用次数（两个选项均需权限 4） |
| `timer [key] [value:date]` | 1 | 定时器信息，`-s, --set` 设置定时器、`-c, --clear` 清空定时器（两个选项均需权限 4） |

- 两个指令不带参数时列出当前用户的全部计数 / 生效中的定时器，带 `key` 时查询对应条目。

## 配置项

本插件自身无需配置。启用后，以下配置会出现在每条指令的配置中（而非本插件的配置）。

### 指令配置

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `usageName` | string | 取指令名（`.` 换 `:`） | 调用次数的标识符 |
| `maxUsage` | 计算属性 number | `0` | 每天的调用次数上限，`0` 表示不限制 |
| `minInterval` | 计算属性 number | `0` | 连续调用的最小间隔（毫秒），`0` 表示不限制 |
| `bypassAuthority` | 计算属性 number | — | 已废弃，建议改用过滤器放行高权限用户 |

### 选项配置

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `notUsage` | boolean | `false` | 不计入调用次数 |

## 用法

```bash
bun add @koishi-ce/plugin-rate-limit
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  rate-limit: {}
```

启用后即可在任意指令上配置 `maxUsage` 或 `minInterval`，例如给 `echo` 指令设置每日 10 次上限。

## 备注

- 依赖数据库服务，扩展内置 `user` 表的两个 json 字段：`usage`（当日调用计数，跨日自动清零）与 `timers`（下次可调用时间戳，到期自动清理）。
- 间隔检查先于次数检查。
- `--help` 与标记 `notUsage` 的选项不计入调用次数。
- 装有 help 插件时，帮助输出会追加「已调用次数：{0}/{1}」与「距离下次调用还需：{0}/{1} 秒」，`notUsage` 选项会标注「 (不计入调用)」。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 [koishijs/common](https://github.com/koishijs/common) 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A command rate-limit plugin, ported from `packages/rate-limit` of the upstream [koishijs/common](https://github.com/koishijs/common) repository. It applies two kinds of limits to every command: a daily usage cap (maxUsage) and a minimum interval between calls (minInterval), with counters and timers stored per user and reset automatically across days.

## Commands

| Command | Authority | Description |
| --- | --- | --- |
| `usage [key] [value:posint]` | 1 | Usage info; `-s, --set` sets and `-c, --clear` clears usage counters (both options require authority 4) |
| `timer [key] [value:date]` | 1 | Timer info; `-s, --set` sets and `-c, --clear` clears timers (both options require authority 4) |

- Without arguments both commands list all counters / active timers of the current user; with a `key` they query the matching entry.

## Configuration

The plugin itself has no configuration. Once enabled, the following fields appear on every command's config instead.

### Command Config

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `usageName` | string | command name (`.` replaced by `:`) | Identifier for usage counting |
| `maxUsage` | computed number | `0` | Daily usage cap; `0` means unlimited |
| `minInterval` | computed number | `0` | Minimum interval between calls in ms; `0` means unlimited |
| `bypassAuthority` | computed number | — | Deprecated; use a filter to exempt high-authority users instead |

### Option Config

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `notUsage` | boolean | `false` | Do not count as usage |

## Usage

```bash
bun add @koishi-ce/plugin-rate-limit
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  rate-limit: {}
```

After that, configure `maxUsage` or `minInterval` on any command, e.g. a daily cap of 10 for `echo`.

## Notes

- Requires the database service; extends the built-in `user` table with two json fields: `usage` (daily counters, reset across days) and `timers` (next-available timestamps, cleaned on expiry).
- The interval check runs before the usage check.
- `--help` and options marked `notUsage` do not count as usage.
- With the help plugin installed, help output appends usage and interval lines, and `notUsage` options are annotated accordingly.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This package is a community redistribution of upstream koishijs/common; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
