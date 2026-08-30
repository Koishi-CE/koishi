---
"@koishi-ce/registry": patch
---

修正 Bun 解析负缓存兜底的实现缺陷：此前在主路径（`pkg/package.json` 形态）失败后以裸名 `pkg` 解析兜底，但 Bun 对**任何形态**的失败解析都按 specifier 记进程内负缓存——安装流程落盘前的探测会把两种形态双双污染，装完后兜底同样失效（表现为市场装 database-postgres 后仍报 failed to resolve）。兜底改为纯 fs 探测：沿 node_modules 链逐级 `existsSync` 定位 package.json，不经过解析缓存、永不污染。
