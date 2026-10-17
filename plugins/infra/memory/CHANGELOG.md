# @koishi-ce/plugin-database-memory

## 1.1.2

### Patch Changes

- e9258a1: 验证 npm OIDC 信任配置：本批 27 个包的 latest 仍是 OIDC 上线前由本机人工发布的，从未经 CI 走过可信发布，它们的信任配置也就从未被验证过。npm 规定新建的信任配置必须在 2 天内完成首次成功发布，否则失效且不可编辑——所以「提前配好」没有意义，只能配一批、马上发一批。
  
  本补丁的唯一目的，是让这批包各完成一次经 CI 的成功发布以验证配置（验证后长期有效），**无功能变更**。
  
  不在本批的两个例外（按仓库约束不动，其信任配置留待它们真正发版的批次再验证）：
  
  - shim 四包：`@koishi-ce/koishi-shim`、`@koishi-ce/console-shim`、`@koishi-ce/client-shim`、`@koishi-ce/components-shim`（changesets ignore，版本冻结跟随上游线）
  - vendored 三包：`@koishi-ce/plugin-http`、`@koishi-ce/plugin-proxy-agent`、`@koishi-ce/plugin-server`（预编译产物包，不走 tsdown）
- @koishi-ce/koishi@1.0.20

## 1.1.1

### Patch Changes

- 5bef313: 索引记账防原型污染加固：`_indexes` 索引表整体改用 `Map` 承载（上游为裸对象记录）——表名与索引名系库的公开入参、直接作记录键，恶意 `__proto__` 键此前可经 `createIndex` / `dropIndex` 触达 `Object.prototype`（CodeQL js/prototype-polluting-assignment #31/#32）。合法键的读写行为不变。

## 1.1.0

### Minor Changes

- 4c09f45: 新增内存数据库驱动插件 `@koishi-ce/plugin-database-memory`（两源合一，替代测试基建里的官方包 `@koishijs/plugin-database-memory`）：
  
  - 两源合并：`@minatojs/driver-memory` 3.7.0（驱动实现，225 行）+ `@koishijs/plugin-database-memory` 3.7.0（纯 re-export 包装层）并入单包 `plugins/infra/memory`，查询求值全量复用 minato 基类 `execute*` 基建；
  - 纯内存无持久化，定位测试替身与行为基准：与 plugin-mock 配对构成无 IO 测试基建，SQLite 驱动对拍测试以本驱动为参照；
  - 全仓 22 个测试文件切换导入并删除 CJS 互操作穿透样板（净删 53 行），14 个包 devDependencies 换为 workspace 版，官方包退出依赖树——外部上游导入例外自此仅剩 console 的类型引用 `@koishijs/plugin-server-proxy`；
  - 移植忠实性：专项测试 bun:test 11 例（自增主键/重复键/upsert/join 笛卡尔积与 optional 留空/group 聚合/eval/事务快照回滚/索引记账/drop/stats），join 过滤处曾笔误 `executeQuery`（上游为 `executeEval`）经与上游驱动同场对拍抓出修正；全量 847 用例 0 失败。

### Patch Changes

- Updated dependencies [e2b121a]
  - @koishi-ce/koishi@1.0.10
