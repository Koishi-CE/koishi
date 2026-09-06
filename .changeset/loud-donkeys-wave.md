---
"@koishi-ce/plugin-console": patch
---

修复并行第二个 dev 实例的 Vite HMR WebSocket 端口冲突（报错形态为「WebSocket server error: Port undefined is already in use」，Bun 的 EADDRINUSE 错误缺 port 字段所致）：缺省 24678 被占用时自动顺延并提示，新增 `dev.wsPort` 显式指定。
