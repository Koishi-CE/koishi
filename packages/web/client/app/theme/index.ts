// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 主题插件（控制台外壳）：
 * - 向 "root" 插槽注册应用根组件（活动栏 + 路由视图 + 状态栏 + 全局菜单层）；
 * - 注册活动栏右键菜单 "theme.activity" 及其动作（重置活动栏自定义配置）。
 */

import { type Context, router, useConfig } from "@koishi-ce/client";
import App from "./index.vue";

export default function (ctx: Context) {
	ctx.slot({
		type: "root",
		component: App,
		order: -1000,
	});

	const config = useConfig();

	ctx.action("theme.activity.settings", {
		action: () => router.push("/settings/activity"),
	});

	ctx.action("theme.activity.reset", {
		// 清空 activities 覆盖配置，活动栏恢复默认排序与分组
		action: () => (config.value.activities = {}),
	});

	ctx.menu("theme.activity", [
		{
			//   id: '.settings',
			//   label: '活动栏设置',
			// }, {
			id: ".reset",
			label: "重置活动栏",
		},
	]);
}
