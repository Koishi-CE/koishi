// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * sandbox 插件（浏览器侧入口）。
 *
 * 注册沙盒页面（`/sandbox`，需要 authority 4）与消息右键菜单
 * （删除消息 / 引用回复），页面主体为 ./layout.vue。
 */
import type { Context } from "@koishi-ce/client";
import Sandbox from "./layout.vue";
import "./icons";

import "virtual:uno.css";

export default (ctx: Context) => {
	ctx.page({
		name: "沙盒",
		path: "/sandbox",
		icon: "activity:flask",
		order: 300,
		authority: 4,
		component: Sandbox,
	});

	ctx.menu("sandbox.message", [
		{
			id: ".delete",
			label: "删除消息",
		},
		{
			id: ".quote",
			label: "引用回复",
		},
	]);
};
