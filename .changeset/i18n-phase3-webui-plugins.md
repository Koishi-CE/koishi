---
"@koishi-ce/plugin-explorer": minor
"@koishi-ce/plugin-config": minor
"@koishi-ce/plugin-dataview": minor
"@koishi-ce/plugin-insight": minor
"@koishi-ce/plugin-analytics": minor
---

i18n: 五个 webui 插件前端文案接入全局词典

- explorer / config / dataview / insight / analytics 的 client 侧新增 7 语种词典，经 `ctx.$i18n.extend()` 注入宿主全局实例，页名、菜单、按钮、确认框、toast 等文案随设置页语言切换实时生效
- explorer 的 node 侧 schema 词典补齐 7 语种；analytics 的两处 schema 描述由中文直写改为 `.i18n()`
- 宿主侧配套：`$i18n.t` 支持插值参数、`createChart` 的标题支持 getter（详见 @koishi-ce/client 的 changeset）
