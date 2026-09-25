// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * insight 插件（浏览器侧入口）。
 *
 * 将依赖图页面注册到控制台路由（`/graph`），声明依赖 `insight` 数据频道，
 * 页面组件为 ./index.vue 的力导向图，同时挂载本目录的图标资源。
 */
import {
	type Context,
	extendLocales,
} from "@koishi-ce/client";
import Graph from "./index.vue";

const locales = import.meta.glob("./locales/*.yml", {
	eager: true,
	import: "default",
});

import "./icons.ts";

import "virtual:uno.css";
export default (ctx: Context) => {
	// 注入本扩展的 UI 语言包（各语种键均收纳在 insight.* 命名空间下）
	extendLocales(ctx, locales);

	ctx.page({
		path: "/graph",
		name: () => ctx.$i18n.t("insight.title"),
		icon: "activity:network",
		order: 550,
		fields: ["insight"],
		component: Graph,
	});
};
