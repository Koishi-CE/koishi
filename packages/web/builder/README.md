# @koishi-ce/console-builder

**简体中文** | [English](#english)

Koishi 控制台前端的构建工具链（node 侧），从 [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client) 拆出：把浏览器运行时库与驱动 vite 的工程化逻辑分开，让下游安装前端库时不再连带拉入 vite / unocss / sass / typescript。

## 主要导出

- `build(root, config)`：构建单个 webui 插件的前端（`<插件目录>/client/index.ts` → 同包 `dist/`）。插件可在 `<插件目录>/build/client.ts` 导出一份 vite 配置覆盖默认值（vite 不会自动发现该文件名，由本函数显式加载并合并）；
- `createServer(baseDir, config)`：创建开发模式下的 vite 中间件服务器（`middlewareMode`，由宿主挂载到 `/vite` 前缀）。
- `locateApp()`：定位宿主控制台 SPA 目录（即 `@koishi-ce/console-app` 的包根，供总装与开发服务器共用）。

## CLI

`koishi-console build [root]`（`src/bin.ts`）：

- 带 `root`（或 cwd 本身是含 `client/` 的插件目录）时构建该插件的前端；
- 不带参数时执行宿主控制台前端总装（`src/assemble.ts`），产物写入 `plugins/webui/console/dist`——该落点在仓库外不存在，故总装只能在仓库内执行，其他场景会显式报错。

## 许可

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。本包是上游 koishijs/webui 的社区再分发，版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The build toolchain for the Koishi console frontend (node side), split out of [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client) so that installing the browser runtime library no longer drags in vite / unocss / sass / typescript.

## Key exports

- `build(root, config)` — bundles a single webui plugin frontend (`<plugin>/client/index.ts` into that plugin's `dist/`). A plugin may export a vite config from `<plugin>/build/client.ts` to override the defaults (vite never auto-discovers that filename; this function loads and merges it explicitly).
- `createServer(baseDir, config)` — creates the vite dev middleware server mounted by the host under `/vite`.
- `locateApp()` — resolves the host console SPA directory (the package root of `@koishi-ce/console-app`, shared by the assembly and the dev server).

## CLI

`koishi-console build [root]` (`src/bin.ts`): with a `root` it builds that plugin's frontend; without arguments it performs the host console assembly (`src/assemble.ts`) into `plugins/webui/console/dist`. That output location only exists inside this repository, so the assembly explicitly fails elsewhere.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Community redistribution of upstream koishijs/webui; copyright Shigma and Koishijs contributors (upstream) and Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
