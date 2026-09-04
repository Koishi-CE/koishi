---
"@koishi-ce/plugin-database-sqlite": patch
---

重构：将 673 行的单文件驱动拆分为职责单一的模块（行为零变化，全部 10 个用例与全仓 816 个用例通过）：

- `index.ts`：驱动骨架——配置、连接生命周期、执行原语（`_exec` / `_all` / `_get` / `_run`）、事务，方法改为对各模块的薄委托，对外 API 面不变；
- `schema.ts`：表结构同步与迁移（建表 / ALTER / 重建式迁移 / drop）；
- `crud.ts`：数据操作（get / eval / set / create / upsert / remove）；
- `indexes.ts`：二级索引管理与 `sqlite_master` 定义解析；
- `stats.ts`：库表规模统计；
- `functions.ts` / `datatypes.ts`：自定义 SQL 函数与 minato 类型 transformer 的注册；
- `utils.ts`：共享 SQL 片段工具（列清单拼接）。

基类 `Driver.migrate` 为 protected，在驱动类上开公开桥 `runMigration` 供 schema 模块调用；执行原语因跨模块访问去掉 `private` 修饰（下划线内部约定不变）。
