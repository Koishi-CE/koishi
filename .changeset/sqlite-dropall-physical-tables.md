---
"@koishi-ce/plugin-database-sqlite": patch
---

dropAll / stats 改以 sqlite_master 物理表为准（对齐上游 cordiverse/database#132 的意图）：多驱动并存时不再对其他驱动独占的表执行 SQL 而报错，stats 也会纳入未注册的物理孤儿表。
