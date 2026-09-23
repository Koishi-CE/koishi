---
"@koishi-ce/client": minor
"@koishi-ce/plugin-console": minor
"create-koishi-ce": minor
---

拆分 `packages/web/client`：node 侧构建器独立为 `@koishi-ce/console-builder`

`packages/web/client` 此前同时承载浏览器运行时库、宿主 SPA 源码、node 侧构建器与宿主总装脚本，四种职责共用一个版本号与一次发版。本次把其中 **node 侧**部分拆为独立包 `packages/web/builder`（`@koishi-ce/console-builder`），使浏览器运行时库不再连带拉入 vite / unocss / sass / typescript。

- `@koishi-ce/console-builder`（新增）：`build(root)` 单插件前端构建、`createServer(baseDir)` 开发服务器、`koishi-console` CLI（`bin` 名不变）。宿主总装脚本迁入 `src/assemble.ts` 并由 CLI 无参分支调用，**顺带修复了 npm 安装形态下总装分支不可用的问题**（原 `scripts/` 不在 `files` 白名单内）；总装现在会在非仓库形态下显式报错，而不是把产物写到无关路径。
- `@koishi-ce/client`：`exports` 的 `./lib`、`./bin` 与 `bin` 字段移除，`files` 收窄为 `app` / `client` / `global.d.ts`，构建工具依赖全部移出。**浏览器侧 API 与源码路径（`client/`、`app/`、`global.d.ts`）一律不变**，无运行时行为变更。`./lib` 与 `koishi-console` 属构建工具面而非运行时 API，消费者请改用 `@koishi-ce/console-builder`；两者均为 `^1.0.0` 线兼容变更故按 minor 发布。
- `@koishi-ce/plugin-console`：devMode 的 Vite 开发服务器改从 `@koishi-ce/console-builder` 动态导入，新增可选 peer（与既有 `@koishi-ce/client` 可选 peer 同形），未开启 devMode 的部署不受影响。
- `create-koishi-ce`：内置模板 devDependencies 预置新增 `@koishi-ce/console-builder`，保证新项目开箱即用的 `devMode` 仍可用。
