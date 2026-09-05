"@koishi-ce/core": patch
---
指令的权限判定优先于解析错误的反馈：无权限用户输入带解析错误的指令时提示权限不足，不再向其暴露参数类型等解析细节（upstream: koishijs/koishi#1414）
