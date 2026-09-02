---
"@koishi-ce/registry": patch
---

`LocalScanner` 的清单解析锚点由进程 cwd 改为与扫描起点一致的 `baseDir`：宿主以非 cwd 启动时，此前会出现「扫到了却解析不到」的分裂。
