// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 宿主控制台 SPA（app 目录）的位置解析。
 *
 * 宿主 SPA 同时被两条链路消费：
 * - 宿主总装（assemble.ts）以它为 vite root 产出 `index.js`；
 * - 开发模式（createServer）以它为 vite root 挂载 `/vite` 中间件。
 *
 * 本模块是这两条链路唯一的 app 定位点：按包解析（而非按相对层数）取
 * 宿主应用目录，源码形态（src/）与产物形态（lib/）下结果一致，也避免
 * 依赖"本模块到仓库根恰好几级"这类位置巧合。
 */

import { resolve } from "node:path";

/**
 * 追踪 app 目录所属的包名。
 *
 * 当前 app 源码仍在 `@koishi-ce/client` 包内（`packages/web/client/app`），
 * 故先经该包定位；app 拆分为独立包后仅需改这一处常量与其解析分支不受影响。
 */
const APP_OWNER = "@koishi-ce/client";

/**
 * 定位宿主控制台 SPA 目录（即 `app/`，含 `index.html` 与 `index.ts`）。
 *
 * @returns 宿主应用目录的绝对路径（正斜杠）
 * @throws 宿主包不可解析时抛出（说明安装不完整，须显式失败而非静默回退）
 */
export function locateApp(): string {
	const manifest = Bun.resolveSync(
		`${APP_OWNER}/package.json`,
		import.meta.dir,
	);
	return resolve(manifest, "../app").replace(/\\/g, "/");
}
