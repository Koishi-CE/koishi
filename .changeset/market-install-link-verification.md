---
"@koishi-ce/plugin-market": patch
---

安装完成后校验新装包的依赖链接完整性,缺失时自动补装一次。Bun isolated 布局下增量安装存在缺陷:升级插件时包目录 hash 变化而其依赖解析结果不变,bun 会跳过新包目录内的依赖链接建立,表现为插件入口可加载、内部依赖 require 报 MODULE_NOT_FOUND 且普通 bun install 报 no changes 不修复。校验全程纯 fs(existsSync / readFileSync / realpathSync),不触碰解析 API;补装利用 bun 按磁盘实际状态重建链接的行为,秒级自愈。
