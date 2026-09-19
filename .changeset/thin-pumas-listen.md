---
"@koishi-ce/plugin-market": patch
---

清理依赖管理重构遗留的两个无消费者导出：`dependencies/service` 的 default 导出与 `installer` 入口的 `Dependency` 类型 re-export（权威定义在 `dependencies/types`，公开面经 `node/index` 转发不受影响）。
