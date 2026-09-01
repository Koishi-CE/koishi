# @koishi-ce/plugin-dataview

**简体中文** | [English](#english)

数据库查看器插件，移植自上游 [koishijs/koishi-plugin-dataview](https://github.com/koishijs/koishi-plugin-dataview)。它让你在控制台中直接查看和管理数据库内容：浏览全部数据表、编辑行数据、执行查询与统计。依赖 console 与 database 服务。

## 功能与页面

- 「数据库」页面：路由 `/database/:name*`（order 410，权限 4）。左侧为数据表列表，右侧用数据表组件查看与编辑所选表的内容，头部菜单提供类型染色、筛选与刷新操作。
- 展示 `ctx.model.tables` 中的全部表（本插件不建表）。
- RPC 接口（把前端的调用代理到本地数据库，均要求权限 4）：

| RPC | 说明 |
| --- | --- |
| `database/get` | 查询表数据 |
| `database/set` | 按主键更新行 |
| `database/create` | 插入行 |
| `database/remove` | 删除行 |
| `database/upsert` | 插入或更新行 |
| `database/eval` | 执行聚合表达式 |
| `database/stats` | 采集全库统计信息 |

- 模型结构变化（建表 / 扩展字段等）时节流刷新全库概览。
- 以 `database` 数据服务向浏览器下发全库概览：总体统计与各表的结构定义（字段、主键、索引等）。

## 配置项

Node 侧无配置。客户端本地设置（控制台「用户设置」中的「数据库设置」面板）：

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `autoStats` | boolean | `true` | 刷新数据时是否自动同步统计信息 |
| `color` | boolean | `false` | 是否默认启用类型染色 |
| `colors` | table | 6 条默认规则 | 各类型分组的染色规则，默认按 minato 字段类型分六组着色 |

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-dataview
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  dataview: {}
```

## 备注

- 数据表内容经序列化在浏览器与 Node 侧之间传输；MongoDB 等主键为包装类型（如 ObjectId）的驱动，主键值会在查询前自动包装。
- 类型染色按字段类型分组着色，便于区分数值、字符串、时间等列。
- 无指令、无数据表。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/koishi-plugin-dataview](https://github.com/koishijs/koishi-plugin-dataview)。

---

## English

Database viewer plugin, ported from the upstream [koishijs/koishi-plugin-dataview](https://github.com/koishijs/koishi-plugin-dataview) repository. It lets you inspect and manage database contents in the console: browse all tables, edit rows, and run queries and stats. Depends on the console and database services.

## Features and Pages

- "Database" page: route `/database/:name*` (order 410, authority 4). Table list on the left, a data-table component for viewing and editing on the right, with type coloring, filtering, and refresh in the header menu.
- Shows every table in `ctx.model.tables` (this plugin creates no tables).
- RPC endpoints (proxied to the local database, all authority 4):

| RPC | Description |
| --- | --- |
| `database/get` | Query rows |
| `database/set` | Update rows by key |
| `database/create` | Insert rows |
| `database/remove` | Remove rows |
| `database/upsert` | Insert or update rows |
| `database/eval` | Evaluate aggregate expressions |
| `database/stats` | Collect database statistics |

- Refreshes the overview (throttled) when model structures change.
- Pushes the full database overview (overall stats plus per-table structure definitions) via the `database` data service.

## Configuration

No Node-side config. Client-side local settings (the "Database Settings" panel in the console):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `autoStats` | boolean | `true` | Sync statistics automatically when refreshing |
| `color` | boolean | `false` | Enable type coloring by default |
| `colors` | table | 6 default rules | Color rules per field-type group (default: six minato type groups) |

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-dataview
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  dataview: {}
```

## Notes

- Rows are serialized between the browser and Node; wrapped primary keys (e.g. MongoDB ObjectId) are wrapped automatically before queries.
- No commands, no tables.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/koishi-plugin-dataview](https://github.com/koishijs/koishi-plugin-dataview).
