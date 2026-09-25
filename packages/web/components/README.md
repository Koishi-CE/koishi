# @koishi-ce/components

**简体中文** | [English](#english)

Koishi 控制台的共享前端组件库——**全仓唯一的 UI 组件库**。移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `packages/components`，并承载了自上游 `packages/client` 迁入的全部 UI 组件（控制台 `@koishi-ce/client` 由此收敛为无界面的运行时内核，对本包公共 API 做全量二次转出以保持历史导入面）。各控制台插件的前端经由此复用同一套组件而不重复打包。

## 组件清单

| 组件 | 用途 |
| --- | --- |
| `k-button` / `k-hint` / `k-tab` | 基础组件：按钮、提示、选项卡 |
| `k-card` / `k-content` / `k-empty` / `k-tab-group` / `k-tab-item` | 布局组件 |
| `k-slot`（及快捷形态 `k-layout` / `k-status`） | 具名插槽渲染，合并模板内 k-slot-item 与 `ctx.slot()` 注册的外部视图 |
| `k-activity-link` | activity 页面链接 |
| `k-icon` | 图标中心：字符串名渲染全部内置图标，`register()` 可运行时补充 |
| `k-markdown` | Markdown 渲染（含白名单消毒层） |
| `k-comment` | 通知条，type 取 primary / secondary / warning / success / error |
| `k-image-viewer` | 图片查看器，支持缩小、放大、复原、旋转 |
| `k-filter` | 条件过滤器编辑器，内部由单条件行 k-filter-expr 与 k-filter-button 组成 |
| `virtual-list` | 虚拟列表（长列表按需渲染） |

同时装配 element-plus、启用 schemastery-vue 表单并注册 schema 扩展：union + computed 角色的「计算属性」编辑器、any + dynamic 角色的动态表单、array + perms 角色的权限选择器。包内还承载虚拟子路径 `schemastery-vue/client` 的运行时与类型载体，并再导出 cosmokit 与 schemastery-vue/client。

包不依赖 `@koishi-ce/client` 的运行时：需要宿主数据的两处（dynamic / perms 控件与 `ctx.slot()` 视图）经 `injection.ts` 读取——store 由宿主启动时 `provideStore()` 注入，Context 由宿主 Vue 应用 provide 的 `"cordis"` 提供，均以 `import type` 反向引用类型，运行时零依赖。

## 用法

本包以源码形态被消费（exports 的 source 与 default 条件均指向 src 源码），通常由 `@koishi-ce/client` 依赖引入（或经其二次转出导入），插件前端直接使用全局组件即可：

```vue
<template>
  <k-comment type="success">已连接到控制台</k-comment>
</template>
```

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。本包是上游 koishijs/webui 的社区再分发，版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

Shared frontend components for the Koishi console — **the single UI component library of this repository**. Ported from `packages/components` of the upstream [koishijs/webui](https://github.com/koishijs/webui), and also hosts every UI component migrated from upstream `packages/client` (the console `@koishi-ce/client` is thereby a headless runtime core that re-exports this package's public API to preserve the historical import surface). Console plugin frontends reuse one copy through it instead of bundling their own.

## Components

| Component | Purpose |
| --- | --- |
| `k-button` / `k-hint` / `k-tab` | Primitives: button, hint, tabs |
| `k-card` / `k-content` / `k-empty` / `k-tab-group` / `k-tab-item` | Layout components |
| `k-slot` (plus shortcuts `k-layout` / `k-status`) | Named-slot renderer merging inline k-slot-item nodes with views registered via `ctx.slot()` |
| `k-activity-link` | Activity page link |
| `k-icon` | Icon hub: renders any built-in icon by string name, extensible at runtime via `register()` |
| `k-markdown` | Markdown rendering (with whitelist sanitizer) |
| `k-comment` | Notification strip; type is one of primary / secondary / warning / success / error |
| `k-image-viewer` | Image viewer with zoom, restore and rotate |
| `k-filter` | Condition-filter editor, composed of k-filter-expr rows and k-filter-button |
| `virtual-list` | Virtualized list for long datasets |

It also wires up element-plus, enables schemastery-vue forms and registers schema extensions: a "computed value" editor (union + computed), a dynamic server-driven form (any + dynamic) and a permission picker (array + perms). It hosts the virtual `schemastery-vue/client` subpath and re-exports cosmokit and schemastery-vue/client.

The package has no runtime dependency on `@koishi-ce/client`: the two places needing host data (dynamic / perms controls and `ctx.slot()` views) read through `injection.ts` — the store is injected by the host at startup via `provideStore()`, and the Context comes from the `"cordis"` provide on the host Vue app; both are referenced back with `import type` only, so there is zero runtime dependency.

## Usage

Consumed as source (exports expose the `src` source code for both the `source` and `default` conditions); usually pulled in through `@koishi-ce/client` (or imported via its re-exports). Use the global components directly in plugin frontends:

```vue
<template>
  <k-comment type="success">Connected to the console</k-comment>
</template>
```

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Community redistribution of upstream koishijs/webui; copyright Shigma and Koishijs contributors (upstream) and Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
