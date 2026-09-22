---
"@koishi-ce/client": patch
---

`k-markdown` 的手写消毒层换成 `dompurify`（`xss` 出仓）。

原消毒层是 `marked-vue` 的手写实现（白名单过滤 + 自维护标签栈补闭合 + 手写 `<a>` 属性重建），自带两处偏差：白名单外标签的闭标签会残留（`<script>x</script>` → `x</script>`）、标签名大小写不归一（`<B>x</B>` → `<b>x</B>`）。二者都无可利用面，但暴露的正是「手写近似解析器」这一层的问题——嵌套、大小写、自闭合、属性引号形态都得自己覆盖。换入 DOMPurify 后由真实 DOM 解析器承担这些工作，偏差随之消失。

行为变更有 7 处，逐条核对后均为「更正确」：`<script>` / `<iframe>` 连内容整体移除；孤儿闭标签（`</b>`）直接丢弃而非转义显示；标签名统一归一为小写；非法协议的 href 由「降级为 `#`」改为整体剔除（且无 href 时不补 `rel` / `target`，不再伪造假链接）；属性值内的尖括号按 HTML 规范原样保留（已由 round-trip 用例证否「会变成标签」）。另需显式关掉 DOMPurify 默认开启的 `ALLOW_DATA_ATTR` / `ALLOW_ARIA_ATTR`，否则它们会绕过 `ALLOWED_ATTR` 的收敛。

产品口径不变：`ALLOWED_TAGS` 仍不含 `img`——非 unsafe 模式的渲染对象包含市场里的第三方插件描述，放行图片等于允许其借图片请求静默外发访客信息。

代价是产物 +10.3 KB（`xss` 18,786 B → `dompurify` 29,354 B，minify 实测）；换来的是十余年攒下的攻击面覆盖面与持续维护的安全修复（`xss` 的 npm 最新版已停在 2024-03，属发版停摆）。测试期新增 `jsdom` + `@types/jsdom`（DOMPurify 是 DOM-only 库）：linkedom 会**静默返回未消毒原文**、happy-dom 会谎报 `isSupported` 并把元素整体剥光（30 条输入里 27 条与 jsdom 分歧），两者均已实测证否。

回归测试由 29 用例 / 55 断言增至 31 用例 / 60 断言，新增一组「消毒输出的二次解析安全性（round-trip）」：把消毒结果重新解析为 DOM，确认不产生新的可执行节点或 `on*` 属性。
