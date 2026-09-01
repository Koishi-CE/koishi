# @koishi-ce/components

**简体中文** | [English](#english)

Koishi 控制台的通用前端组件库，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `packages/components`。提供一组 `k-*` 全局组件与 schemastery-vue 表单扩展，被 [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client) 作为依赖引入，各控制台插件的前端经由此复用同一套组件而不重复打包。

## 组件清单

| 组件 | 用途 |
| --- | --- |
| `k-comment` | 通知条，带左侧色条与状态图标，type 取 primary / secondary / warning / success / error |
| `k-image-viewer` | 图片查看器，支持缩小、放大、复原、旋转 |
| `k-filter` | 条件过滤器编辑器，内部由单条件行 k-filter-expr 与 k-filter-button 组成 |
| `virtual-list` | 虚拟列表（长列表按需渲染） |

同时启用 schemastery-vue 表单并注册 schema 扩展：union + computed 角色的「计算属性」编辑器。包内还承载虚拟子路径 `schemastery-vue/client` 的运行时与类型载体，并再导出 cosmokit 与 schemastery-vue/client。

## 用法

本包以源码形态被消费（exports 仅 source 条件），通常由 `@koishi-ce/client` 依赖引入，插件前端直接使用全局组件即可：

```vue
<template>
  <k-comment type="success">已连接到控制台</k-comment>
</template>
```

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。本包是上游 koishijs/webui 的社区再分发，版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

Shared frontend components for the Koishi console, ported from `packages/components` of the upstream [koishijs/webui](https://github.com/koishijs/webui). It provides a set of `k-*` global components plus schemastery-vue form extensions, consumed by [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client) so that console plugin frontends reuse one copy instead of bundling their own.

## Components

| Component | Purpose |
| --- | --- |
| `k-comment` | Notification strip with a colored left bar and status icon; type is one of primary / secondary / warning / success / error |
| `k-image-viewer` | Image viewer with zoom, restore and rotate |
| `k-filter` | Condition-filter editor, composed of k-filter-expr rows and k-filter-button |
| `virtual-list` | Virtualized list for long datasets |

It also enables schemastery-vue forms, registers a "computed value" editor for union + computed schema roles, hosts the virtual `schemastery-vue/client` subpath, and re-exports cosmokit and schemastery-vue/client.

## Usage

Consumed as source (exports expose only a `source` condition); usually pulled in through `@koishi-ce/client`. Use the global components directly in plugin frontends:

```vue
<template>
  <k-comment type="success">Connected to the console</k-comment>
</template>
```

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Community redistribution of upstream koishijs/webui; copyright Shigma and Koishijs contributors (upstream) and Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
