// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import type { Context } from "@koishi-ce/client";
import type Analytics from "@koishi-ce/plugin-analytics";

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// Console.Services 来自 packages/web/client/client/shims.d.ts 的手写环境声明;
// 这里按同名环境声明合并为其补充 analytics 键,使 fields/store 通过检查
// (Store 由 Services 的 DataService<T> 映射而来,一并生效)
declare module "@koishi-ce/plugin-console" {
	namespace Console {
		export interface Services {
			analytics: DataService<Analytics.Payload>;
		}
	}
}

/**
 * analytics 插件（浏览器侧）入口。
 *
 * - Charts：注册四个统计图表组件（历史消息 / 每小时消息 / 平台占比 / 指令频率）；
 * - Home：控制台首页的统计面板（数值卡网格 + 图表网格），挂到 home 插槽位。
 */
import Charts from "./charts";
import Home from "./home.vue";
import deDE from "./locales/de-DE.yml";
import enUS from "./locales/en-US.yml";
import frFR from "./locales/fr-FR.yml";
import jaJP from "./locales/ja-JP.yml";
import ruRU from "./locales/ru-RU.yml";
import zhCN from "./locales/zh-CN.yml";
import zhTW from "./locales/zh-TW.yml";
import "./icons";

import "virtual:uno.css";

export default (ctx: Context) => {
	// 注入本扩展的 UI 语言包（各语种键均收纳在 analytics.* 命名空间下）
	ctx.$i18n.extend("de-DE", deDE);
	ctx.$i18n.extend("en-US", enUS);
	ctx.$i18n.extend("fr-FR", frFR);
	ctx.$i18n.extend("ja-JP", jaJP);
	ctx.$i18n.extend("ru-RU", ruRU);
	ctx.$i18n.extend("zh-CN", zhCN);
	ctx.$i18n.extend("zh-TW", zhTW);

	// ctx.app.provide('ecTheme', 'koishi-dark')
	ctx.plugin(Charts);

	ctx.slot({
		type: "home",
		component: Home,
		order: 0,
	});
};
