---
"@koishi-ce/plugin-database-memory": patch
---

索引记账防原型污染加固：`_indexes` 容器与各表索引记录改用 `Object.create(null)` 原型无对象承载（上游为裸对象字面量）——表名与索引名系库的公开入参、直接作记录键，恶意 `__proto__` 键此前可经 `createIndex` / `dropIndex` 触达 `Object.prototype`（CodeQL js/prototype-polluting-assignment #31/#32）。合法键的读写行为不变。
