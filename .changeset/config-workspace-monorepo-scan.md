---
"@koishi-ce/plugin-config": patch
"create-koishi-ce": patch
---

添加插件列表兼容嵌套 monorepo 工作区，扫描改为 workspaces 声明驱动：

- 未启用插件的收录不再硬编码「external/ 一级」，以宿主 package.json 的 workspaces 通配为唯一真相源展开（正/负模式、清单文件锚点、win32 路径归一）——声明写多深，列表就能看多深，克隆到 external/ 的 monorepo 形态插件（packages/ 子包在二级及更深）无需平铺即可见可启用；声明缺失 / 非法时回退约定目录。
- 顺带修复 plugins/ 一级目录下未启用自建包的可见性盲区（同受声明覆盖）。
- 内置模板 workspaces 升级为 globstar + 负向排除写法：`["plugins/*", "external/**", "!external/**/node_modules/**"]`——Bun 原生支持完整 glob 语法，三行替代上游生态的多层枚举，node_modules 残留（跨包管理器搬迁）被排除在 workspace 成员之外。
