---
"@koishi-ce/client": patch
---

WebSocket 重连分支的 `location.reload` 改为连接成功时才取值。原写法把成员访问直接写在 then 实参位置（`.then(location.reload, …)`），重连发起时即求值——非浏览器运行时（无 location 全局）在此直接 ReferenceError，重连流程中断。
