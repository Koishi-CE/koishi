---
"@koishi-ce/plugin-market": patch
---

修复 npm 源限流导致市场数据刷新整体失败：registry 搜索接口（/-/v1/search）对无认证请求有速率限制，超频返回 429 时 collect 首页搜索直接抛错，被 prepare 捕获置 _error，市场页面整体清空。现对 429 / 408 / 5xx 这类可重试错误做退避重试（优先遵循 Retry-After 响应头，缺省按 1s 起指数退避，最多重试 2 次），市场与安装器共用的请求包装一并生效。
