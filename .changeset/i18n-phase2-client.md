---
"@koishi-ce/client": minor
---

i18n: 前端国际化机制落地（宿主）

- `$i18n` 服务新增 `extend()` 与 `t()`：扩展语言包经 `ctx.$i18n.extend(locale, messages)` 深合并注入全局 vue-i18n 实例，兑现「loader 注入」的注释承诺
- 新增宿主全局词典 `client/locales/`（7 语种），设置页/主题/欢迎页/加载态/404/图片查看器等硬编码文案全部改走词典
- 设置页语言选择器从 zh-CN/en-US 扩至 7 语种，显示名采用各语言本地名称
- `SettingOptions.title` 放宽为 `MaybeRefOrGetter<string>`，设置分区标题随界面语言实时切换；activity 页名（`name` 本就支持 getter）同步接入
- 欢迎页从组件局部词典迁移至全局词典（原 en-US 半中半英文案顺带补全，en 之外新增 5 语种）
