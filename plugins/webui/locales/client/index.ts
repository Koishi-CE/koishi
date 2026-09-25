// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * locales 插件（浏览器侧入口）。
 *
 * 注册本地化管理页面（`/locales/:path*`，authority 4），
 * 页面组件为 ./locales.vue；同时注册页面与语言选择器用到的两个图标。
 */
import { type Context, icons } from "@koishi-ce/client";
import type {} from "@koishi-ce/plugin-locales";
import Activity from "~icons/k/activity-locales";
import Globe from "~icons/k/globe";
import Locales from "./locales.vue";

import "virtual:uno.css";

/**
 * 编辑态词典：键为完整点分路径（node 侧推送的 ctx.i18n._data 即此扁平
 * 形态，见 core 的 Dict<Dict<string>> 声明），叶子翻译值允许 null
 * （用户清空翻译时置 null 表示删除该键，node 侧落盘为 YAML null）。
 * 故值域收窄为 string | null——嵌套 I18n.Store 分支在扁平键模型下不存在。
 */
export type EditableStore = {
	[key: string]: string | null;
};
icons.register("activity:locales", Activity);
icons.register("globe", Globe);

export default (ctx: Context) => {
	ctx.page({
		path: "/locales/:path*",
		name: "本地化",
		icon: "activity:locales",
		order: 450,
		authority: 4,
		fields: ["locales"],
		component: Locales,
	});
};
