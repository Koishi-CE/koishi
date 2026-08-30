---
"@koishi-ce/registry": patch
"@koishi-ce/plugin-market": patch
---

修复 Bun 运行时下市场装完插件无法加载的问题：Bun 对失败解析按 specifier 做进程内负缓存，安装流程在包落盘前的 `pkg/package.json` 形态探测（必然失败）会让此后同进程内的清单读取永久失败，表现为插件装完仍显示「尚未安装」并报 failed to resolve。registry 新增 `resolvePackageJson()` 以裸名解析兜底绕开负缓存，market 与 registry 的清单读取统一接入；market 安装器的 `override()` 改为现读现写根 package.json（不再基于启动快照整体重写抹掉外部变更），并对 `workspace:` 依赖声明加不可覆盖/删除护栏（保护 `koishi` 裸名 shim 的归属，防止 npm 官方 koishi 被写回根依赖），写出格式对齐 biome（tab 缩进）。
