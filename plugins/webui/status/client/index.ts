// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * status 插件（浏览器侧）入口。
 *
 * 将各展示组件挂载到控制台对应的插槽位：
 * - status-right：机器人状态灯（bots）与 CPU / 内存负载（load）；
 * - status-left：环境信息版本号（envinfo.vue）；
 * - analytic-number：当前 / 近期 QPS 数值卡（analytics.vue，供 analytics 插件的数值区复用）；
 * - plugin-details：插件配置页中的机器人预览（config.vue）。
 *
 * 并注册本插件的前端设置项 mergeThreshold（状态灯合并显示阈值）。
 */
import { type Context, Schema } from "@koishi-ce/client";
import type {} from "@koishi-ce/plugin-status";
import Analytics from "./analytics.vue";
import Bots from "./bots";
import Config from "./config.vue";
import EnvInfo from "./envinfo.vue";
import Load from "./load";
import "./icons";

import "virtual:uno.css";

declare module "@koishi-ce/client" {
	interface Config {
		mergeThreshold: number;
	}
}

export default (ctx: Context) => {
	ctx.plugin(Bots);
	ctx.plugin(Load);

	ctx.slot({
		type: "status-left",
		component: EnvInfo,
	});

	ctx.slot({
		type: "analytic-number",
		component: Analytics,
	});

	ctx.slot({
		type: "plugin-details",
		component: Config,
		order: -500,
	});

	ctx.settings({
		id: "status",
		schema: Schema.object({
			mergeThreshold: Schema.number()
				.default(10)
				.description(
					"当机器人的数量超过这个值时将合并显示状态指示灯。",
				),
		}).description("机器人设置"),
	});
};
