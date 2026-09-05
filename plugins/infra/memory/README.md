# @koishi-ce/plugin-database-memory

**简体中文** | [English](#english)

内存数据库驱动插件，合并自上游 `@koishijs/plugin-database-memory` 3.7.0
（纯 re-export 薄壳）与 `@minatojs/driver-memory` 3.7.0（驱动实现）。
纯内存实现、无任何持久化——进程退出数据即失。定位是测试替身与行为
基准：单测中与 plugin-mock 配对构成无 IO 的测试基建；SQLite 驱动的
对拍测试以本驱动为行为参照。

## 特性

- 查询求值、排序、分组全量复用 minato 基类的 `execute*` 系列基建，
  与其他 minato 驱动共享同一套查询语义。
- 驱动内建空操作的事务（`withTransaction` 失败时整体回滚到快照）与
  索引记账（不真正加速查询，仅维护元数据供 `getIndexes` 等读取）。
- 无配置项。

## 用法

```bash
bun add @koishi-ce/plugin-database-memory
```

```ts
import memory from "@koishi-ce/plugin-database-memory";

const app = new Context();
app.plugin(memory);
```

插件默认不在市场展示（`koishi.hidden: true`，与上游一致），主要供
自动化测试使用。

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This
package is a community redistribution merge of upstream koishijs/koishi
and cordiverse/minato; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)
for copyright attribution.

---

# English

# @koishi-ce/plugin-database-memory

**English** | [简体中文](#简体中文)

In-memory database driver plugin, merged from upstream
`@koishijs/plugin-database-memory` 3.7.0 (a pure re-export shim) and
`@minatojs/driver-memory` 3.7.0 (the driver implementation). Purely
in-memory with no persistence whatsoever — data is lost when the
process exits. It serves as a test double and behavioral baseline:
paired with plugin-mock it forms the IO-free testing infrastructure in
unit tests, and the SQLite driver uses it as the reference in
cross-verification tests.

## Features

- Query evaluation, sorting and grouping fully reuse the `execute*`
  primitives from the minato base class, sharing one query semantics
  with other minato drivers.
- Ships a no-op transaction (`withTransaction` rolls back to a
  snapshot on failure) and index bookkeeping (no actual query
  acceleration; metadata is maintained only for `getIndexes` etc.).
- No configuration options.

## Usage

```bash
bun add @koishi-ce/plugin-database-memory
```

```ts
import memory from "@koishi-ce/plugin-database-memory";

const app = new Context();
app.plugin(memory);
```

The plugin is hidden from the market by default (`koishi.hidden: true`,
same as upstream) and is intended mainly for automated testing.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). This
package is a community redistribution merge of upstream koishijs/koishi
and cordiverse/minato; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)
for copyright attribution.
