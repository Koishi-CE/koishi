---
"@koishi-ce/plugin-explorer": patch
---

移除从未生效的 chokidar 死依赖：`watchers` 集合自上游移植以来从未被填充（上游 webui 同样如此），`stop()` 关闭的是恒空集合；随字段与 override 一并删除，chokidar 从 workspace 包的直接依赖中移除。文件树的刷新仍由读写等 RPC 触发，行为无任何变化。
