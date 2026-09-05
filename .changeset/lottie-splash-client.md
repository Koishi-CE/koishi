---
"@koishi-ce/client": minor
---

欢迎页新增开屏描线动画（splash 组件，lottie-web SVG-only 构建）：动画数据移植自 koishi-plugin-telemetry（MIT，© ilharp，溯源见 NOTICE），欢迎卡改为全高、内容沉底；描线颜色经 CSS 类映射到宿主主题变量自动适配明暗，`prefers-reduced-motion` 下不挂动画、卡片回落紧凑形态。
