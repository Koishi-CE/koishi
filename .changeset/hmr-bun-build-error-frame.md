---
"@koishi-ce/plugin-hmr": patch
---

热重载编译失败的错误帧适配 Bun 真实错误形态：上游遗留的 esbuild `BuildFailure` 识别（按 `.text` 字段判定）在 Bun 运行时下永不命中，坏 TS 源码的编译错误此前只输出无位置的聚合消息；现按 Bun 抛出的 `AggregateError`（errors 为 BuildMessage，位置在 `position.{file,line,column}`）识别并渲染 `@babel/code-frame` 代码帧，日志直接定位出错行列。同时移除死依赖：esbuild（仅剩的 `import type { BuildFailure }` 引用一并清除）与 `@types/babel__code-frame`（v7 线存根，`@babel/code-frame@8` 自带类型从未生效）。
