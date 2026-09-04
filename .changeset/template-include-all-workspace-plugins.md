---
"create-koishi-ce": minor
---

内置模板补齐本仓工作区全部插件，并重排为配置页导出形态：插件键带 uid 实例后缀，分组带中文 `$label` / `$collapsed` 元数据。dependencies 新增 @koishi-ce/plugin-broadcast、@koishi-ce/plugin-callme、@koishi-ce/plugin-echo 与 @koishi-ce/plugin-database-sqlite，devDependencies 新增 @koishi-ce/plugin-mock；其中 sqlite 默认启用（数据落 data/koishi.db），开箱即得数据库；broadcast / callme 依赖数据库、mock 属开发用，均以 ~ 禁用预写。
