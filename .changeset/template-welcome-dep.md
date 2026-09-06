---
"create-koishi-ce": patch
---

内置模板依赖清单补上 @koishi-ce/plugin-welcome：欢迎页独立插件化时只在模板 koishi.yml 预写了条目，package.json 依赖漏装，新生成的项目开箱即报插件解析失败。另新增模板 koishi.yml 预写条目与依赖清单的对账测试，防止同类漏装再犯。
