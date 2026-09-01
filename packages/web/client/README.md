# @koishi-ce/client

**简体中文** | [English](#english)

Koishi 控制台的浏览器端运行时与组件基座，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `packages/client`。它承载控制台前端的全部基础设施——根 Context、服务与插件系统、路由与活动栏、状态管理、主题、动作与菜单——同时提供把各控制台插件的前端组装为可部署产物的编程式构建器。

与 [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console)（node 侧宿主）的分工：本包运行在浏览器，是前端基座；plugin-console 运行在 node，负责 WebSocket 通道与静态资源托管。宿主总装产物直接写入 plugin-console 的 `dist` 目录。

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

## 构建器

本包没有独立的运行时发布形态，而是作为源码被各前端工程消费：

- CLI：`koishi-console build [root]`（`src/bin.ts`）——带 root 时构建单个插件的前端，否则执行宿主控制台总装（产物硬编码到 `plugins/webui/console/dist`，含共享 chunk 与样式）；
- 编程式：`build(root, config)` 构建单个插件前端，`createServer(baseDir)` 创建 Vite 开发中间件；
- `collectWorkspaceAliases()`：读取根 package.json 的 workspaces，为每个工作区包名建立指向其 `client/index.ts` 的别名——未被依赖的 workspace 包不会出现在 node_modules 链接里，必须显式映射才能被 bundler 解析。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。本包是上游 koishijs/webui 的社区再分发，版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The browser-side runtime and component foundation of the Koishi console, ported from `packages/client` of the upstream [koishijs/webui](https://github.com/koishijs/webui). It hosts the entire frontend infrastructure — the root Context, services and plugin system, router and activity bar, state management, themes, actions and menus — and ships a programmatic builder that assembles console plugin frontends into deployable bundles.

Division of labor with [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console) (the node-side host): this package runs in the browser as the frontend foundation, while plugin-console runs on node serving the WebSocket channel and static assets. Host assembly output is written straight into plugin-console's `dist` directory.

## Key exports

`root` and `Context` (the single root context), `defineExtension` (entry for console plugin frontends), the frontend `Service` base, `RouterService` / `Activity` / `redirectTo`, the reactive `store` with `socket` / `send` / `receive` / `connect`, settings and theming (`createStorage`, `useConfig`, `SettingService`, `useColorMode`, `ThemeService`), actions and menus (`useMenu`, ActionService with global shortcut dispatch), I18nService, element-plus service wrappers (`loading` / `message` / `messageBox`), plus the `Satori` / `Universal` namespaces and `ScopeStatus`.

## Builder

The package is consumed as source code rather than shipped as a standalone runtime:

- CLI: `koishi-console build [root]` — builds a single plugin frontend when a root is given, otherwise performs the host console assembly (output hardcoded to `plugins/webui/console/dist`).
- Programmatic: `build(root, config)` and `createServer(baseDir)` (a Vite dev middleware).
- `collectWorkspaceAliases()` — maps every workspace package to its `client/index.ts`; workspace packages absent from node_modules links can only be resolved through this explicit alias map.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Community redistribution of upstream koishijs/webui; copyright Shigma and Koishijs contributors (upstream) and Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
