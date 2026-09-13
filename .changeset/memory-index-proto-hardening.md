---
"@koishi-ce/plugin-database-memory": patch
---

索引记账防原型污染加固：`_indexes` 索引表整体改用 `Map` 承载（上游为裸对象记录）——表名与索引名系库的公开入参、直接作记录键，恶意 `__proto__` 键此前可经 `createIndex` / `dropIndex` 触达 `Object.prototype`（CodeQL js/prototype-polluting-assignment #31/#32）。合法键的读写行为不变。
