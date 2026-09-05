"@koishi-ce/core": patch
---
session.prompt 回调重载的返回类型补上 undefined（超时 resolve(undefined) 而非抛异常，与无参重载一致；upstream: koishijs/koishi#1516）
