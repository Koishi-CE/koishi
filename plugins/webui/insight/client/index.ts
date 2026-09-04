// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * insight 插件（浏览器侧入口）。
 *
 * 将依赖图页面注册到控制台路由（`/graph`），声明依赖 `insight` 数据频道，
 * 页面组件为 ./index.vue 的力导向图，同时挂载本目录的图标资源。
 */
import type { Context } from "@koishi-ce/client";
import type Insight from "@koishi-ce/plugin-insight";
import Graph from "./index.vue";
import deDE from "./locales/de-DE.yml";
import enUS from "./locales/en-US.yml";
import frFR from "./locales/fr-FR.yml";
import jaJP from "./locales/ja-JP.yml";
import ruRU from "./locales/ru-RU.yml";
import zhCN from "./locales/zh-CN.yml";
import zhTW from "./locales/zh-TW.yml";
import "./icons";

import "virtual:uno.css";

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// Console.Services 来自 packages/web/client/client/shims.d.ts 的手写环境声明;
// 这里按同名环境声明合并为其补充 insight 键,使 ctx.page 的 fields 通过检查
declare module "@koishi-ce/plugin-console" {
	namespace Console {
		export interface Services {
			insight: DataService<Insight.Payload>;
		}
	}
}

export default (ctx: Context) => {
	// 注入本扩展的 UI 语言包（各语种键均收纳在 insight.* 命名空间下）
	ctx.$i18n.extend("de-DE", deDE);
	ctx.$i18n.extend("en-US", enUS);
	ctx.$i18n.extend("fr-FR", frFR);
	ctx.$i18n.extend("ja-JP", jaJP);
	ctx.$i18n.extend("ru-RU", ruRU);
	ctx.$i18n.extend("zh-CN", zhCN);
	ctx.$i18n.extend("zh-TW", zhTW);

	ctx.page({
		path: "/graph",
		name: () => ctx.$i18n.t("insight.title"),
		icon: "activity:network",
		order: 550,
		fields: ["insight"],
		component: Graph,
	});
};
