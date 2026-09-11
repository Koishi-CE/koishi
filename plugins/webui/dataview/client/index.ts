// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * dataview 客户端入口：注册「数据库」页面与「数据库设置」面板。
 *
 * 页面路由 /database/:name*（name 为表名，可省略），权限 4，
 * 订阅 database 数据服务（类型镜像见 console-services.ts）。
 * 语言包与配置 schema 位于 config.ts（叶子模块，供组件引用不断环）。
 */

import type { Context, Dict } from "@koishi-ce/client";
import { messages, schema } from "./config.ts";
import Database from "./index.vue";
import "./icons";

import "virtual:uno.css";

export default (ctx: Context) => {
	// 注入本扩展的 UI 语言包（各语种键均收纳在 dataview.* 命名空间下）
	for (const [locale, dict] of Object.entries(messages)) {
		ctx.$i18n.extend(locale, dict as Dict);
	}

	ctx.settings({
		id: "dataview",
		title: () => ctx.$i18n.t("dataview.settingsTitle"),
		schema,
	});

	ctx.page({
		path: "/database/:name*",
		name: () => ctx.$i18n.t("dataview.title"),
		icon: "database",
		order: 410,
		authority: 4,
		fields: ["database"],
		component: Database,
	});
};
