// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 宿主控制台 SPA（@koishi-ce/console-app）的位置解析。
 *
 * 宿主 SPA 同时被两条链路消费：
 * - 宿主总装（assemble.ts）以它为 vite root 产出 `index.js`；
 * - 开发模式（createServer）以它为 vite root 挂载 `/vite` 中间件。
 *
 * 本模块是这两条链路唯一的 app 定位点：按包解析（而非按相对层数）取
 * 宿主应用目录，源码形态（src/）与产物形态（lib/）下结果一致，也避免
 * 依赖"本模块到仓库根恰好几级"这类位置巧合。
 *
 * app 原先寄居在 `@koishi-ce/client` 包内（`packages/web/client/app`），
 * 现已拆为独立包 `@koishi-ce/console-app`（`packages/web/app`），应用源码
 * 位于其 `src/` 下。同一拆分也让宿主 SPA 的发布节奏与浏览器运行时库解耦
 * （改首页布局不再牵动库的版本号）。
 */

import { resolve } from "node:path";

/**
 * 宿主控制台 SPA 所属的包名。
 *
 * 该包同时是下游 `devMode` 的运行期依赖（console 宿主按同一包名解析应用
 * 目录），故它必须可发布，不能声明为 private。
 */
const APP_OWNER = "@koishi-ce/console-app";

/**
 * 定位宿主控制台 SPA 目录（含 `index.html` 与 `index.ts`）。
 *
 * @returns 宿主应用目录的绝对路径（正斜杠）
 * @throws 宿主包不可解析时抛出（说明安装不完整，须显式失败而非静默回退）
 */
export function locateApp(): string {
	const manifest = Bun.resolveSync(
		`${APP_OWNER}/package.json`,
		import.meta.dir,
	);
	// 应用源码在包的 src/ 下（`<包根>/src/index.html` 是 vite 的默认入口）
	return resolve(manifest, "../src").replace(/\\/g, "/");
}
