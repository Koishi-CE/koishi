// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import type { Context } from "@koishi-ce/client";
import Logs from "./index.vue";
import Settings from "./settings.vue";
import "./index.scss";
import "./icons.ts";

import "virtual:uno.css";

/**
 * 日志查看器的浏览器侧入口：
 * 注册「日志」页面（订阅 logs 数据服务）与插件详情页的运行日志插槽。
 */
export default (ctx: Context) => {
	ctx.page({
		path: "/logs",
		name: "日志",
		icon: "activity:logs",
		order: 0,
		authority: 4,
		fields: ["logs"],
		component: Logs,
	});

	ctx.slot({
		type: "plugin-details",
		component: Settings,
		order: -800,
	});
};
