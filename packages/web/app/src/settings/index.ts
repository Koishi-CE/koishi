// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 设置插件：
 * - 注册用户设置页（/settings/:name*，活动栏底部）；
 * - 注册 role 为 "theme" 的字符串 schema 渲染组件（主题选择器）；
 * - 声明 "status"（状态栏设置）设置分组，供其它扩展挂载配置项。
 */

import type { Context } from "@koishi-ce/client";
import Settings from "./settings.vue";
import Theme from "./theme.vue";

export default function (ctx: Context) {
	ctx.page({
		path: "/settings/:name*",
		// name / title 传 getter：渲染层解析，随界面语言切换
		name: () => ctx.$i18n.t("pages.settings"),
		icon: "activity:settings",
		position: "bottom",
		order: -100,
		component: Settings,
	});

	ctx.schema({
		type: "string",
		role: "theme",
		component: Theme,
	});

	ctx.settings({
		id: "status",
		title: () => ctx.$i18n.t("settings.status"),
		order: 800,
	});

	// ctx.settings({
	//   id: 'activity',
	//   title: '活动栏设置',
	//   order: 800,
	// })
}
