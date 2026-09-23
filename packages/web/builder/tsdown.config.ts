// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

import type { UserConfig } from "tsdown";
import { defineConfig } from "tsdown";

/**
 * @koishi-ce/console-builder 的构建配置（workspace 模式下与根配置合并，
 * 其余选项沿用根配置的 ESM-only 约定）。
 *
 * 相对根配置的差异仅是多入口：除主入口（编程式 build / createServer）外，
 * 还要产出 `koishi-console` CLI（src/bin.ts，产物首行 shebang 由 rolldown
 * 原样保留，package.json 的 bin 字段指向它）。宿主总装（src/assemble.ts）
 * 经 CLI 的动态导入被 rolldown 拆为独立 chunk，一并落在 lib/ 下。
 */
const config: UserConfig = {
	entry: {
		index: "src/index.ts",
		bin: "src/bin.ts",
	},
};

export default defineConfig([config]);
