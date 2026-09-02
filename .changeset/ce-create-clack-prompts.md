---
"create-koishi-ce": patch
---

refactor(create): 交互层从 prompts 迁移到 @clack/prompts

- 移除 `prompts` 与 `@types/prompts`（clack 自带 TS 类型，无需 `@types/*` 包）
- 项目名输入与各类确认改用 `@clack/prompts` 的 `text` / `confirm`：Ctrl+C 优雅返回取消符号（不再抛 SIGINT 堆栈），项目名校验内联进 `validate`
- 测试 mock 同步切换至 `@clack/prompts`（按 prompt 类型分发的可编程答案队列不变）
