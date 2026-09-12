// SPDX-License-Identifier: MIT
// Copyright (c) 2024 Il Harper (ilharp).
// Modifications Copyright (c) 2026-present Koishi-CE contributors.

/**
 * welcome 插件（浏览器侧）入口。
 *
 * - 注入本插件的 UI 语言包（7 语种，键均收纳在 welcome.* 命名空间下）；
 * - 把欢迎卡片（welcome.vue，含 Lottie 开屏描线动画）挂到首页 home
 *   插槽，order 1000（原宿主内建卡同位；analytics 统计面板 order 0
 *   沉于其下）。
 */
import {
	type Context,
	extendLocales,
} from "@koishi-ce/client";

const locales = import.meta.glob("./locales/*.yml", {
	eager: true,
	import: "default",
});

import Welcome from "./welcome.vue";

export default (ctx: Context) => {
	extendLocales(ctx, locales);

	ctx.slot({
		type: "home",
		component: Welcome,
		order: 1000,
	});
};
