---
"@koishi-ce/plugin-welcome": patch
---

新插件 @koishi-ce/plugin-welcome：控制台首页欢迎卡（文档 / 论坛入口 + 7 语种词典）由 client 宿主内建卡迁出为独立插件，背景为 Lottie 开屏描线动画（移植自 Il Harper 的 MIT 插件 koishi-plugin-telemetry，数据与加载接线，描线经 CSS 类映射主题变量适配明暗，prefers-reduced-motion 下不挂动画回落紧凑形态）。
