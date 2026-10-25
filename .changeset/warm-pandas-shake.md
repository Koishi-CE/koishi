---
"@koishi-ce/plugin-market": patch
---

修复依赖元数据刷新对 unpublish 骨架包（registry 返回 200 但无 versions 字段）抛 `TypeError: Object.values requires that input parameter not be null or undefined` 并周期性刷屏的问题：此类包现归一化为空版本表，按 not-found 负缓存（会话内不再重试），依赖页徽标与 404 口径一致；拉取失败日志补包名便于定位。
