---
"@koishi-ce/plugin-config": patch
"@koishi-ce/plugin-market": patch
---

config 与 market 插件把 `ctx.loader` 声明为非必需注入（生产环境 loader 由宿主以 builtin 服务提供、恒存在）：此前未声明 inject，裸 App 环境（如测试）装配时会刷 cordis 的 `property loader is not registered` 警告。
