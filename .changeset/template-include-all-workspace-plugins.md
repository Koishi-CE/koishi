---
"create-koishi-ce": minor
---

内置模板补齐本仓工作区全部插件：dependencies 新增 @koishi-ce/plugin-broadcast、@koishi-ce/plugin-callme、@koishi-ce/plugin-echo（koishi.yml 预写进 group:basic，依赖数据库的前两者默认禁用）与 @koishi-ce/plugin-database-sqlite（预装，koishi.yml 保持 ~ 禁用，配置页启用即可当数据库用，无需市场安装）；devDependencies 新增 @koishi-ce/plugin-mock（group:develop 禁用预写）。
