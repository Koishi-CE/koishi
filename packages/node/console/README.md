# @koishi-ce/console

**简体中文** | [English](#english)

Koishi 控制台（WebUI）体系的服务端抽象基座，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `packages/console`。它管理 WebSocket 客户端连接、前端入口声明与 RPC 监听器，是全部控制台插件共同依赖的协议层。

注意区分：本包是抽象服务定义；实际部署在应用里、提供浏览器可访问控制台的是 [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console)（其 `NodeConsole` 派生自本包的 `Console` 基类，实现 WebSocket 接入与静态资源托管）。

## 主要导出

- `Console`：抽象服务基类，维护 clients / entries / listeners 三张表，暴露 `services` 代理（按 `console.services.*` 惰性解析数据服务）与 `addEntry` / `addListener` / `broadcast` / `refresh` / `patch` 等 API；派生类实现 `accept` 与 `resolveEntry`。
- `Client`：单个浏览器 WebSocket 连接的封装，负责 RPC 请求-响应分发与连接建立时的首屏数据同步。
- `Entry`：前端扩展脚本入口声明（区分 dev / prod 形态）。
- `DataService<T>`：数据推送抽象，`refresh` 全量 / `patch` 增量；内置 `EntryProvider` / `SchemaProvider` / `PermissionProvider` 三个数据服务与 `ping` 监听器。
- 类型 `Events` / `Listener` / `EntryData`。

通过模块合并向 `ctx` 注入 `ctx.console` 属性与 `console/connection`、`console/intercept` 事件（每次数据推送先经过拦截器判断）。

## 面向谁

- 普通用户：安装 `@koishi-ce/plugin-console` 即可，无需直接依赖本包；
- 控制台插件作者：经 `ctx.console` 注册入口与监听器、用 `DataService` 推送数据，本类型定义来自本包（通常经 `@koishi-ce/plugin-console` 的依赖间接引入）。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 koishijs/webui 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The server-side abstract foundation of the Koishi console (WebUI) stack, ported from `packages/console` of the upstream [koishijs/webui](https://github.com/koishijs/webui). It manages WebSocket clients, frontend entry declarations and RPC listeners — the protocol layer every console plugin builds on.

Note the distinction: this package defines the abstract service; the deployable plugin that actually serves the browser UI is [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console), whose `NodeConsole` derives from the `Console` base class here.

## Key exports

- `Console` — the abstract service: clients / entries / listeners tables, a `services` proxy resolving `console.services.*`, and `addEntry` / `addListener` / `broadcast` / `refresh` / `patch` APIs; subclasses implement `accept` and `resolveEntry`.
- `Client` — a single browser WebSocket connection with RPC dispatch and initial data sync.
- `Entry` — frontend extension script entry declarations (dev / prod variants).
- `DataService<T>` — full `refresh` / incremental `patch` data push, with built-in `EntryProvider` / `SchemaProvider` / `PermissionProvider` and a `ping` listener.

Regular users install `@koishi-ce/plugin-console` instead; console plugin authors consume the types (usually transitively) when registering entries, listeners and data services via `ctx.console`. Data pushes pass through the `console/intercept` event first.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). Community redistribution of upstream koishijs/webui; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
