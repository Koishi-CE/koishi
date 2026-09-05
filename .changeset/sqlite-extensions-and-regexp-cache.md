---
"@koishi-ce/plugin-database-sqlite": minor
---

SQLite 驱动新增 `extensions` 配置项：启动时经 `loadExtension` 加载用户自备的 SQLite 扩展（相对 baseDir 解析，同名 SQL 函数可被扩展实现覆盖，如原生 PCRE 版 regexp）；同时 `regexp` / `regexp2` 自定义函数增加编译 LRU 缓存，扫描查询对同一 pattern 免去每行重编译（g/y 标志正则复用前复位 lastIndex 保持行为不变）。
