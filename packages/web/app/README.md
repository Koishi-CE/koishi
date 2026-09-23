# @koishi-ce/console-app

**简体中文** | [English](#english)

Koishi 控制台的宿主 SPA，从 [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client) 拆出。它是控制台前端的**消费者**（应用），而不是被消费的库：`index.ts` 是唯一入口，依次注册内置功能插件（首页 / 布局 / 设置 / 状态栏 / 全局样式 / 主题），启动根上下文后与 Koishi 服务端建立 WebSocket 连接。

与 [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client)（浏览器运行时**库**）的区别：client 提供根 Context、服务、路由、组件与词典，被 app 与 19 个 webui 插件的浏览器端共用；app 只消费这些能力并组装成完整界面。

## 消费形态

本包只发布源码（无构建产物、不走 tsdown），由 [`@koishi-ce/console-builder`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/builder) 的两条链路消费：

- **宿主总装**（`builder` 的 `assemble.ts`，即 `koishi-console build` 的无参分支）：以本包目录为 vite root，产物 `index.js` 落在 `plugins/webui/console/dist/`；
- **开发模式**（`builder` 的 `createServer()`）：同样以本包目录为 vite root，由 console 宿主的 `devMode` 配置挂载到 `/vite/` 前缀下。

两条链路共用 `builder` 的 `locateApp()` 定位本包（返回 `<包根>/src`），**故本包必须可发布**——`devMode` 是面向下游用户的配置项，运行期要在 npm 安装形态下找到这份源码。

## 目录形态

```
packages/web/app/
├── src/
│   ├── index.html   vite root 入口
│   ├── index.ts     应用入口：注册内置功能插件
│   ├── home/ layout/ settings/ status/ styles/ theme/ assets/
│   └── shims.d.ts   引用 client 包的浏览器侧类型垫片
├── package.json / tsconfig.json / README.md
```

**`src/` 就是 vite root**（vite 按 `<root>/index.html` 探入口），`locateApp()` 返回 `<包根>/src`。本仓的源码目录约定是**一律 `src/`**：`packages/web/client` 与 `packages/web/components` 的浏览器库源码同样在各自 `src/` 下（`packages/web/builder` 的 node 侧构建器亦然）。

唯一例外是 `plugins/webui/*/client/`：那个子路径（`@koishi-ce/plugin-config/client`）是插件生态跳包引用彼此的**公开面**，上游与 npm 产物都以它为准，不能改。

与仓库内其余 `src/` 的区别在入口形态：其余包是 `src/index.ts`（包入口，node 侧或浏览器库），本包是 `src/index.html`（**应用**入口，只作为构建工具的 vite root）。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。本包是上游 koishijs/webui 的社区再分发，版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The host SPA of the Koishi console, split out of [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client). It is the **consumer** (application) of the console frontend rather than a consumed library: `index.ts` is the single entry, registering the built-in functional plugins (home / layout / settings / status bar / global styles / theme) and, after starting the root context, opening a WebSocket connection to the Koishi server.

Unlike [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client) (the browser runtime **library**), which provides the root Context, services, router, components and dictionaries shared by the app and the browser side of all 19 webui plugins, this package merely consumes those capabilities and assembles the actual interface.

## Consumption

This package ships source only (no build output, never built by tsdown). It is consumed by two chains in [`@koishi-ce/console-builder`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/builder):

- **Host assembly** (`assemble.ts`, i.e. the argument-less branch of `koishi-console build`): uses `src/` as the vite root and emits `index.js` into `plugins/webui/console/dist/`;
- **Dev mode** (`createServer()`): also uses `src/` as the vite root, mounted by the console host's `devMode` config under the `/vite/` prefix.

Both chains locate this package through the builder's `locateApp()` (which returns `<package-root>/src`), so **this package must be publishable** — `devMode` is a user-facing config, and at runtime it has to find this source in an npm installation.

## Layout

```
packages/web/app/
├── src/
│   ├── index.html   vite root entry
│   ├── index.ts     app entry: registers the built-in functional plugins
│   ├── home/ layout/ settings/ status/ styles/ theme/ assets/
│   └── shims.d.ts   browser-side type shims referencing the client package
├── package.json / tsconfig.json / README.md
```

**`src/` *is* the vite root** (vite looks for `<root>/index.html`), and `locateApp()` returns `<package-root>/src`. The repository's convention is that source always lives in `src/`: the browser library sources of `packages/web/client` and `packages/web/components` sit in their own `src/` directories too (as does the node-side builder in `packages/web/builder`).

The only exception is `plugins/webui/*/client/`: that sub-path (`@koishi-ce/plugin-config/client`) is the **public surface** through which plugins reference each other, fixed by upstream and by published npm packages, so it must not change.

What differs from the other `src/` directories is the entry shape: elsewhere it is `src/index.ts` (a package entry — node side or browser library), here it is `src/index.html` (an *application* entry, whose only consumer role is being the build tool's vite root).

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Community redistribution of upstream koishijs/webui; copyright Shigma and Koishijs contributors (upstream) and Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
