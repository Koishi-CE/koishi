"@koishi-ce/plugin-analytics": patch
---
统计索引的 selfId 为空（沙盒等会话）时落空串行，避免整批 upsert 因非空主键约束失败丢失统计（upstream: koishijs/koishi#1501）
