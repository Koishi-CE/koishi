// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 首页插件：将首页注册为根路由 "/"，内容为 home 插槽
 * （欢迎卡由 @koishi-ce/plugin-welcome 提供）。
 * order 取极大值（活动栏 top 组渲染时按 order 逆序输出，故首页位于最顶部）。
 */

import type { Context } from "@koishi-ce/client";
import Home from "./home.vue";

export default function (ctx: Context) {
	ctx.page({
		id: "home",
		path: "/",
		// name 传 getter：渲染层解析（MaybeRefOrGetter），随界面语言切换
		name: () => ctx.$i18n.t("pages.home"),
		icon: "activity:home",
		order: 1000,
		component: Home,
	});
}
