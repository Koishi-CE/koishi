---
"@koishi-ce/plugin-market": patch
---

market 前端解除对 npm 包 @koishijs/market 的依赖：逻辑层（过滤/排序/搜索语法校验）与图标自上游 4.2.10 vendor 进 client/vendor/market/，行为零变化；package 卡片的 useI18nText 改从 @koishi-ce/components 导入（构建期仍经宿主 client 包单实例提供）。插件卡片视图的视觉与交互无任何变化。
