// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	type Context,
	extendLocales,
} from "@koishi-ce/client";
/**
 * analytics 插件（浏览器侧）入口。
 *
 * - Charts：注册四个统计图表组件（历史消息 / 每小时消息 / 平台占比 / 指令频率）；
 * - Home：控制台首页的统计面板（数值卡网格 + 图表网格），挂到 home 插槽位。
 */
import Charts from "./charts";
import Home from "./home.vue";

const locales = import.meta.glob("./locales/*.yml", {
	eager: true,
	import: "default",
});

import "./icons.ts";

import "virtual:uno.css";

export default (ctx: Context) => {
	// 注入本扩展的 UI 语言包（各语种键均收纳在 analytics.* 命名空间下）
	extendLocales(ctx, locales);

	// ctx.app.provide('ecTheme', 'koishi-dark')
	ctx.plugin(Charts);

	ctx.slot({
		type: "home",
		component: Home,
		order: 0,
	});
};
