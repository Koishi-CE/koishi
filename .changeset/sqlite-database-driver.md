---
"@koishi-ce/plugin-database-sqlite": minor
---

新增 SQLite 数据库驱动插件 `@koishi-ce/plugin-database-sqlite`（源码级并入，替代下游直接安装官方 `@koishijs/plugin-database-sqlite` 靠 shim 凑 peer 的做法）：

- 三源合并：以 cordis 3 线 `@minatojs/driver-sqlite` 4.7.0 为 API 骨架（minato 3 冻结线），引擎层采用 cordis 4 线 `@cordisjs/plugin-database-sqlite` 5.1.1 的 `node:sqlite`（`DatabaseSync`）方案，官方 koishi 包装层（纯 re-export）并入单包；
- 引擎选型依据：Bun 1.4 的 `bun:sqlite` 无自定义函数注册 API（regexp 等 5 个 SQL 函数无法注册，直接不可用），`node:sqlite` 为 Bun 原生完整实现；弃 sql.js wasm（免落盘导出与浏览器包袱）；
- 保留 cordis 4 线改进：库目录自动创建、`PRAGMA page_count/page_size` 统计、事务 ROLLBACK 防御、`$log` 用 `ln()`（与 memory 驱动一致）；未回移 uuid 字段与 `$startsWith` 算子（minato 3 算子面无对应概念）；
- 已知限制：Bun 的 `node:sqlite` 中 `setReadBigInts` 为空操作，超过 `Number.MAX_SAFE_INTEGER` 的整数读取抛 RangeError（写入正常）；
- 测试 bun:test 覆盖建表/迁移/CRUD/类型往返/regexp 算子/索引/事务/stats/文件持久化，并与 memory 驱动行为对拍。
