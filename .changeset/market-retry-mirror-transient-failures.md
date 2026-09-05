---
"@koishi-ce/plugin-market": patch
---

market 索引请求的退避重试覆盖超时与镜像瞬态 404

registry.koishi.chat 等镜像索引以「302 指向版本化文件」方式发布，部署切换窗口内请求会得到瞬态 404 或超时，此前两者均不在重试范围（仅 429 / 408 / 5xx），导致市场页直接报「无法连接」并刷 [W] 告警。现在：

- 请求超时（ETIMEDOUT，abort 后无 response）纳入可重试错误；
- 配置了 search.endpoint 的首页索引请求允许对 404 退避重试（逐包 manifest 请求的 404 语义不变，仍计入 failed）。
