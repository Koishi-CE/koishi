---
"@koishi-ce/core": patch
---

适配依赖类型漂移的存量类型错误：session 的 stripped 计算中，剥离 @ 后空白文本节点改经 `.at()` 读取，绕开 while 条件对 `elements[0]` 的判别收窄（新类型下 shift 不会重置收窄，原 `@ts-expect-error` 失效），运行时行为不变。
