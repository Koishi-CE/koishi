// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { defineConfig } from "tsdown";

/**
 * @koishi-ce/plugin-console 的包级构建配置（只补差异，其余沿用根 tsdown 配置）：
 * console 是三入口包——src/index.ts 为 node/browser 共享的基类，
 * exports 的 node / browser 条件分别指向 lib/node/index.mjs 与
 * lib/browser/index.mjs（上游 5.30 生态约定布局），缺一则包解析失败。
 */
export default defineConfig({
	entry: [
		"src/index.ts",
		"src/node/index.ts",
		"src/browser/index.ts",
	],
});
