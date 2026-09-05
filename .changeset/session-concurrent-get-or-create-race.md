---
"@koishi-ce/core": patch
---

会话数据并发 get-or-create 撞唯一键改为重查回退

同一事件循环内批量 dispatch 多条同频道消息时，多个会话并发执行 getChannel / getUser 的 check-then-act（先 SELECT 未命中才 INSERT），后到者的 INSERT 撞 channel 表 (id, platform) 或 binding 表 (pid, platform) 唯一键，报 UNIQUE constraint failed 并刷 [W] session 日志（上游 issue koishijs/koishi#1545）。现在创建路径撞错时重查返回既有记录，重查仍未命中才向上抛；不识别错误形态，各驱动的冲突错误一致生效。
