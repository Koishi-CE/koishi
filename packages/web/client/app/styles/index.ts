// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 全局样式插件：引入 app 级 SCSS，并注册四套内置主题
 * （默认 / 高对比 × 明亮 / 暗色），供主题选择器列出与切换。
 */

import type { Context } from "@koishi-ce/client";

import "./index.scss";

export default function (ctx: Context) {
	ctx.theme({
		id: "default-light",
		name: "Default Light",
	});

	ctx.theme({
		id: "default-dark",
		name: "Default Dark",
	});

	ctx.theme({
		id: "hc-light",
		name: "High Contrast Light",
	});

	ctx.theme({
		id: "hc-dark",
		name: "High Contrast Dark",
	});
}
