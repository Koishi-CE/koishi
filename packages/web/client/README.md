# @koishi-ce/client

**简体中文** | [English](#english)

Koishi 控制台的浏览器端运行时与组件基座，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `packages/client`。它承载控制台前端的全部基础设施——根 Context、服务与插件系统、路由与活动栏、状态管理、主题、动作与菜单。

与 [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console)（node 侧宿主）的分工：本包运行在浏览器，是前端基座；plugin-console 运行在 node，负责 WebSocket 通道与静态资源托管。**驱动 vite 的构建器已拆至 [`@koishi-ce/console-builder`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/builder)**，本包只保留浏览器运行时与宿主 SPA 源码（`app/`：由宿主总装与开发服务器共用，故随包发布）。

## 主要导出

- `root` 与 `Context`：唯一根上下文实例与其类型；
- `defineExtension`：控制台插件前端扩展的定义入口；
- `Service`：前端侧服务基类；
- 路由与活动：`RouterService`、`Activity`、`redirectTo`；
- 状态：`store`（reactive 全局状态）及 `socket` / `send` / `receive` / `connect`；
- 设置与主题：`createStorage`、`useConfig`、`SettingService`、`useColorMode`、`ThemeService`；
- 动作与菜单：`useMenu` 与 ActionService（动作面板、菜单注册、全局快捷键分发）；
- 国际化：I18nService；
- element-plus 的 `loading` / `message` / `messageBox` 服务封装；
- `Satori` / `Universal` 命名空间与 `ScopeStatus` 常量。

## 消费形态

本包没有独立的运行时发布形态，而是作为源码被各前端工程消费（`client/` 为库本体，`app/` 为宿主 SPA）：

- 宿主 SPA（`app/`）：由 `@koishi-ce/console-builder` 的总装构建为 console 宿主的 `index.js`，开发模式下由同一构建器的 `createServer()` 直接挂载；
- 库本体（`client/`）：由 console 打包器并成插件运行时共享块 `client.js`，各插件以 external 依赖共享同一份实例，避免多份 Vue 实例。

构建器能力（`build(root, config)` / `createServer(baseDir)` / `koishi-console` CLI / `collectWorkspaceAliases()`）均在 [`@koishi-ce/console-builder`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/builder)。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。本包是上游 koishijs/webui 的社区再分发，版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The browser-side runtime and component foundation of the Koishi console, ported from `packages/client` of the upstream [koishijs/webui](https://github.com/koishijs/webui). It hosts the entire frontend infrastructure — the root Context, services and plugin system, router and activity bar, state management, themes, actions and menus.

Division of labor with [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console) (the node-side host): this package runs in the browser as the frontend foundation, while plugin-console runs on node serving the WebSocket channel and static assets. **The vite-driven builder has been split out into [`@koishi-ce/console-builder`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/builder)**, leaving this package with the browser runtime plus the host SPA source (`app/`, shared by the host assembly and the dev server, hence published).

## Key exports

`root` and `Context` (the single root context), `defineExtension` (entry for console plugin frontends), the frontend `Service` base, `RouterService` / `Activity` / `redirectTo`, the reactive `store` with `socket` / `send` / `receive` / `connect`, settings and theming (`createStorage`, `useConfig`, `SettingService`, `useColorMode`, `ThemeService`), actions and menus (`useMenu`, ActionService with global shortcut dispatch), I18nService, element-plus service wrappers (`loading` / `message` / `messageBox`), plus the `Satori` / `Universal` namespaces and `ScopeStatus`.

## Consumption

The package is consumed as source code rather than shipped as a standalone runtime (`client/` is the library proper, `app/` is the host SPA):

- Host SPA (`app/`) — assembled by `@koishi-ce/console-builder` into the console host's `index.js`; in dev mode it is mounted directly by that builder's `createServer()`.
- Library proper (`client/`) — bundled by the console builder into the shared `client.js` chunk, so that plugins share a single instance via externals and never end up with duplicate Vue copies.

Builder capabilities (`build(root, config)`, `createServer(baseDir)`, the `koishi-console` CLI, `collectWorkspaceAliases()`) now live in [`@koishi-ce/console-builder`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/builder).

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Community redistribution of upstream koishijs/webui; copyright Shigma and Koishijs contributors (upstream) and Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
