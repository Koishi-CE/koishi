---
"@koishi-ce/client": patch
---

内置 Markdown 渲染组件（`k-markdown`）不再依赖 npm 包 `marked-vue`，改为就地 vendor 的本地实现（`client/components/markdown.ts`，源自 `marked-vue@1.3.0`，MIT）。该包自 2023 年起停更、无 release，且把 `marked` 钉在 `^9.1.6` 永不前进；收回源码后本包直接声明 `marked` / `xss`，可自主升级解析器与消毒器。

运行时行为零变化：props 语义（`source` / `inline` / `tag` / `unsafe`）、包裹标签与 `markdown` class，以及非 unsafe 模式下的消毒白名单、`<a>` 属性规范化（协议白名单、`rel` / `target` 加固）与栈式补闭合均与上游逐字等价；另新增 25 条回归测试锁定该行为基线。
