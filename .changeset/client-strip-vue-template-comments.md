---
"@koishi-ce/client": patch
---

前端构建（宿主总装 / 单插件 build / dev server）钉死 Vue SFC 模板编译 `comments: false`：模板根元素前的 HTML 注释会把组件编译成多根 fragment，令 Vue 禁用 attribute 透传——侧栏 activity 图标因此丢失 `activity-button-icon` 尺寸类（24px 缩水为 1em/16px）。此前是否剥注释随构建进程的 NODE_ENV 漂移（Bun 无 NODE_ENV 时按 development 条件解析 @vue/compiler-core，dev 产物默认保留注释），现显式钉死为生产语义，与 NODE_ENV 解耦。
