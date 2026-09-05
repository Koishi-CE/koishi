"@koishi-ce/core": patch
---
修复消息元素位于指令插值内部或之后时被二次解析破坏的问题（元素内容失真或被拆成多个 token，upstream: koishijs/koishi#1541）
