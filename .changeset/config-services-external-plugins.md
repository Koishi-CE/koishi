---
"@koishi-ce/plugin-config": patch
---

修复两个 dev 模式问题：配置页对 `ctx.provide()` 注册的服务（loader、hmr 的 watcher）恒显示「必需服务未加载」——cordis 3.18 起此类服务没有自有 `ctx` 属性（只有 tracker 符号，经 traceable 代理的属性访问可达），descriptor 查询落空时补属性访问兜底（上游 plugin-config 同样命中此缺陷）；`external/` 约定目录下未启用的 workspace 插件不再缺席「添加插件」列表——Bun 只按需链接被依赖的 workspace 包（yarn 全量链接生态下的自动发现语义失效），collect 时显式扫描目录收录，前端启用时以 `./external/<name>` 相对路径键写入配置（短名不经 node_modules 会解析失败）。
