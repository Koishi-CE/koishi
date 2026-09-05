---
"@koishi-ce/plugin-database-memory": minor
---

新增内存数据库驱动插件 `@koishi-ce/plugin-database-memory`（两源合一，替代测试基建里的官方包 `@koishijs/plugin-database-memory`）：

- 两源合并：`@minatojs/driver-memory` 3.7.0（驱动实现，225 行）+ `@koishijs/plugin-database-memory` 3.7.0（纯 re-export 包装层）并入单包 `plugins/infra/memory`，查询求值全量复用 minato 基类 `execute*` 基建；
- 纯内存无持久化，定位测试替身与行为基准：与 plugin-mock 配对构成无 IO 测试基建，SQLite 驱动对拍测试以本驱动为参照；
- 全仓 22 个测试文件切换导入并删除 CJS 互操作穿透样板（净删 53 行），14 个包 devDependencies 换为 workspace 版，官方包退出依赖树——外部上游导入例外自此仅剩 console 的类型引用 `@koishijs/plugin-server-proxy`；
- 移植忠实性：专项测试 bun:test 11 例（自增主键/重复键/upsert/join 笛卡尔积与 optional 留空/group 聚合/eval/事务快照回滚/索引记账/drop/stats），join 过滤处曾笔误 `executeQuery`（上游为 `executeEval`）经与上游驱动同场对拍抓出修正；全量 847 用例 0 失败。
