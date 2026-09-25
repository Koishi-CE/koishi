---
"@koishi-ce/components": minor
---

组件库收敛为全仓唯一 UI 库：自 @koishi-ce/client 迁入全部 UI 组件（common / layout / chat / icons / dynamic / perms / slot / link / markdown），client 收敛为无界面运行时内核并对本包公共 API 全量二次转出（历史导入面不变）。

- 新增导出：k-button / k-hint / k-tab / k-card 等 layout / k-slot / k-activity-link / k-icon（icons 注册中心）/ k-markdown / ChatImage / Overlay 及 useContext / useStore / provideStore 注入工具；element-plus 装配（app.use(Element) 与全局样式）随组件收敛移入本包 install。
- 两个依赖宿主数据仓库的 schema 控件扩展（any+dynamic、array+perms）随组件迁入，store 经 provideStore() 由宿主注入，本包对 client 保持零运行时依赖（仅 import type）。
- 依赖声明整理：peerDependencies 增补 element-plus ^2、vue-i18n ^11、vue-router ^5；dependencies 增补 dompurify、marked（k-markdown 运行时依赖）；devDependencies 增补 jsdom（测试）。
- 修复 perms 权限选择器遗留的 console.log 调试输出与 chat/overlay 样式对 viewer-toolbar.scss 的跨包相对引用。
