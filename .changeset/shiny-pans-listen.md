---
"@koishi-ce/core": patch
---

Session 接口新增 sessionShadow 可选符号成员（shadow 会话携带的原始会话还原键）：下游以 `Symbol.for("session.shadow")` 构造 shadow 会话时获得类型支持，框架内 permission 校验据此还原原始会话（类型层收敛，运行时零变化）
