// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * theme-vanilla 的浏览器侧入口：注册 Vanilla 系列的八个主题。
 *
 * 样式经 index.scss 汇总引入，各主题的选择器与注册 id 一一对应
 * （pale-night.scss 的选择器与注册 id 均为 pale-night-dark）。
 */

import type { Context } from "@koishi-ce/client";

import "./index.scss";

export default (ctx: Context) => {
	ctx.theme({
		id: "coffee-dark",
		name: "Coffee Dark",
	});

	ctx.theme({
		id: "coffee-light",
		name: "Coffee Light",
	});

	ctx.theme({
		id: "pale-night-dark",
		name: "Pale Night",
	});

	ctx.theme({
		id: "ocean-dark",
		name: "Ocean Dark",
	});

	ctx.theme({
		id: "ocean-light",
		name: "Ocean Light",
	});

	ctx.theme({
		id: "solarized-dark",
		name: "Solarized Dark",
	});

	ctx.theme({
		id: "solarized-light",
		name: "Solarized Light",
	});

	ctx.theme({
		id: "winter-dark",
		name: "Winter Dark",
	});
};
