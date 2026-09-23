---
"@koishi-ce/client": minor
"@koishi-ce/plugin-console": minor
"create-koishi-ce": minor
---

拆分 `packages/web/client`：宿主 SPA 独立为 `@koishi-ce/console-app`，浏览器侧源码目录统一为 `src/`

继 node 侧构建器（`@koishi-ce/console-builder`）之后，本次把 `packages/web/client` 的最后一块异质职责——**宿主 SPA 源码**（原 `app/` 子目录）——拆为独立包 `packages/web/app`（`@koishi-ce/console-app`）。`@koishi-ce/client` 由此收窄为纯粹的浏览器运行时库。同批将三处浏览器侧源码目录统一为 `src/`（全仓约定：包的源码一律 `src/`）。

- `@koishi-ce/console-app`（新增，AGPL-3.0）：应用源码在 `src/`（`src/index.html` + `src/index.ts`），只发布源码、不走 tsdown。由宿主总装（构建期）与 devMode（运行期）以 `src/` 为 vite root 消费，**故必须可发布**——devMode 是面向下游用户的 console 配置项，运行期要在 npm 安装形态下找到这份源码。
- `@koishi-ce/client`：`files` 改为 `src` + `global.d.ts`，描述改为「浏览器运行时库」。**包名、导出名与 `global.d.ts` 位置一律不变**，浏览器侧 API 零变更；源码目录 `client/` → `src/`（`main` / `exports` / 内部跳包相对导入同步），宿主 SPA 的发布节奏自此与库解耦（改首页布局不再牵动库版本号）。
- `@koishi-ce/components`：源码目录 `client/` → `src/`（`main` / `exports` 同步）；顺带清掉 `files` 里从未存在的 `tsconfig.client.json` 死项（审计报告 §4.2 B5 已登记）。
- `@koishi-ce/console-builder`：`locateApp()` 改为解析 `@koishi-ce/console-app` 的 `src/`（原为 `@koishi-ce/client` 下的 `app/` 子目录），并新增对该包的依赖；`collectWorkspaceAliases()` 对无入口的包跳过裸名映射（原实现会生成指向不存在目录的假路径），裸名对插件包仍优先落到 `client/index.ts`。总装与开发服务器两条链路照旧共用该定位点。
- `@koishi-ce/plugin-console`：`devMode` 分支改为按包名解析 `@koishi-ce/console-app` 的 `src/`，新增其可选 peer 与 devDep（与既有 `@koishi-ce/client` 可选 peer 同形）；`files` 去掉从不存在的 `app` 死项。未开启 devMode 的部署不受影响。
- `create-koishi-ce`：内置模板 devDependencies 预置 `@koishi-ce/console-app`，保证新项目开箱即用的 `devMode` 仍可用。
- 顺带补齐 eslint 对宿主 SPA `.vue` 的覆盖（此前 glob 为 `packages/web/*/client/**`，`app/` 目录从未被 `lint:client` 检查），并修掉由此暴露的 4 处 `v-for` 缺 `key`——其中 `layout.vue` 的 `:key="menu"` 让同一列表的所有项共用同一个 key（非 `v-for` 变量），属真实反模式。

**唯一不改名的例外**：`plugins/webui/*/client/`。该子路径（`@koishi-ce/plugin-config/client`）是插件生态跳包引用彼此的公开面，上游与 npm 产物均以它为准；`packages/web/{app,client,components}` 改名后与上游的文件名集合不再两两对应，`tooling/upstream-audit` 对这三个目录退化为单边清单（映射注记已同步），port 时按 `src/` → 上游 `client/`（或 `app/`）手工对位。
