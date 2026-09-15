---
"@koishi-ce/plugin-market": patch
"@koishi-ce/plugin-status": patch
---

类型债清偿中判空守卫显形的三处运行时缺陷修复：market 配置缺省 override 字段时批量安装模式暂存崩溃（缺省初始化为空对象）、market 手动安装响应缺 dist-tags 时空引用（判空保持对话框开启）、status 分析页首渲染无守卫解引用 store.status（缺失时按 0 降级，对齐同插件其他页面）。
