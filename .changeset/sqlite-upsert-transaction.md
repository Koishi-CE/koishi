---
"@koishi-ce/plugin-database-sqlite": patch
---

upsert 整批事务化，批量写入提速约两个数量级（实测 500 行 890ms 到 23ms）。原实现逐行 INSERT/UPDATE 各走一次自动提交事务，每行各付一次磁盘同步，万行级初始化要数分钟；现顶层批量写经新增的 driver.runBatch 整批一次 COMMIT，批内任一行失败整体回滚。嵌套安全：用户 transact 回调内的批量写以 AsyncLocalStorage 事务域识别后直接并入外层事务（排队会死锁）；并行批量写经同步占位（gate）的队列严格串行，顺带修掉 withTransaction 先 await 再读队列的既有竞态。行为差异：批量 upsert 由「部分落库」变为「整批原子」，与 memory 驱动对拍用例不受影响。
