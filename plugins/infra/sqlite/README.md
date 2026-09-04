# @koishi-ce/plugin-database-sqlite

**简体中文** | [English](#english)

SQLite 数据库驱动插件，合并自上游两线源码：cordis 3 线的
`@minatojs/driver-sqlite` 4.7.0 / `@koishijs/plugin-database-sqlite` 4.7.0
（已冻结）与 cordis 4 线的 `@cordisjs/plugin-database-sqlite` 5.1.1
（引擎层）。API 面落在 cordis 3 冻结线（minato 3），引擎采用
`node:sqlite` 的 `DatabaseSync` 同步 API，文件直写天然持久化。

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 必填 | 数据库文件路径，相对路径基于运行目录解析；`:memory:` 为内存库 |

- 父目录不存在时会自动创建。
- 以 Node 22.5+ 或 Bun 为运行时（引擎为 Node 原生模块 `node:sqlite`，Bun 原生实现该模块，无第三方驱动依赖）。

## 用法

```bash
bun add @koishi-ce/plugin-database-sqlite
```

随后在配置文件中启用：

```yaml
plugins:
  database-sqlite:
    path: data/koishi.db
```

## 与上游的差异

- 引擎由 cordis 3 线的 sql.js（wasm 内存库 + 手动导出落盘）改为
  `node:sqlite` 直连（沿用 cordis 4 线方案），无 wasm 与浏览器包袱。
- `$log` 求值算子采用自然对数 `ln()`（与 memory 驱动一致；cordis 3 线
  上游用的 `log()` 在 SQLite 中实为 log10）。
- cordis 4 线的 `uuid` 字段类型与 `$startsWith` 查询算子未回移——
  minato 3 的字段类型与查询算子面无对应概念。
- 已知限制：Bun 的 `node:sqlite` 实现中 `setReadBigInts` 为空操作，
  超过 `Number.MAX_SAFE_INTEGER` 的整数在读取时会抛 RangeError
  （写入不受影响；自增主键、时间戳等常规业务值远低于该阈值）。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游
koishijs/koishi 与 cordiverse/database 的社区再分发合并，版权归属见
[NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

SQLite database driver plugin, merged from two upstream lines: the
cordis 3 line `@minatojs/driver-sqlite` 4.7.0 /
`@koishijs/plugin-database-sqlite` 4.7.0 (frozen) and the cordis 4 line
`@cordisjs/plugin-database-sqlite` 5.1.1 (engine layer). The API surface
targets the cordis 3 freeze line (minato 3), powered by the synchronous
`DatabaseSync` API of `node:sqlite` with direct file persistence.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `path` | string | required | Database file path, resolved against the working directory; `:memory:` for an in-memory database |

- Missing parent directories are created automatically.
- Runs on Node 22.5+ or Bun (the engine is Node's native `node:sqlite` module, which Bun implements natively; no third-party driver dependency).

## Usage

```bash
bun add @koishi-ce/plugin-database-sqlite
```

Then enable it in the configuration file:

```yaml
plugins:
  database-sqlite:
    path: data/koishi.db
```

## Differences from upstream

- The engine switched from the cordis 3 line sql.js (wasm in-memory
  database with manual export-on-save) to direct `node:sqlite`
  (following the cordis 4 line), dropping the wasm and browser baggage.
- The `$log` eval operator uses the natural logarithm `ln()` (consistent
  with the memory driver; the cordis 3 upstream `log()` is log10 in
  SQLite).
- The cordis 4 `uuid` field type and `$startsWith` query operator are
  not backported — minato 3 has no corresponding concepts.
- Known limitation: `setReadBigInts` is a no-op in Bun's `node:sqlite`
  implementation, so integers beyond `Number.MAX_SAFE_INTEGER` throw a
  RangeError when read (writes are unaffected; typical business values
  such as auto-increment ids and timestamps are far below the limit).

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This
package is a community redistribution merge of upstream koishijs/koishi
and cordiverse/database; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)
for copyright attribution.
