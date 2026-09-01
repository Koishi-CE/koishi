// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * dataview 客户端入口：注册「数据库」页面与「数据库设置」面板。
 *
 * 页面路由 /database/:name*（name 为表名，可省略），权限 4，
 * 订阅 database 数据服务（类型镜像见 console-services.ts）。
 */

import { type Context, Schema } from "@koishi-ce/client";
import Database from "./index.vue";
import "./icons";

import "virtual:uno.css";

declare module "@koishi-ce/client" {
	interface Config {
		dataview?: DataviewConfig;
	}
}

/** dataview 的客户端本地配置（经 ctx.settings 面板持久化） */
interface DataviewConfig {
	/** 刷新数据时是否自动同步统计信息 */
	autoStats?: boolean;
	/** 是否默认启用类型染色 */
	color?: boolean;
	/** 各类型分组的染色规则 */
	colors?: TypeColor[];
}

/** 可参与染色的全部字段类型（与 minato 的字段类型集保持一致） */
const FieldType = [
	"primary",
	"integer",
	"unsigned",
	"float",
	"double",
	"decimal",
	"char",
	"string",
	"text",
	"boolean",
	"timestamp",
	"date",
	"time",
	"binary",
	"bigint",
	"list",
	"json",
	"expr",
] as const;

type FieldType = (typeof FieldType)[number];

/** 单条染色规则：命中的类型集合显示为该颜色 */
interface TypeColor {
	color?: string;
	types?: FieldType[];
}

const TypeColor: Schema<TypeColor> = Schema.object({
	color: Schema.string().role("color"),
	types: Schema.array(Schema.union(FieldType)).default([]).role("select"),
});

const defaultTypeColors: TypeColor[] = [
	{ color: "rgba(249,100,94,0.6)", types: ["char", "string", "text"] },
	{ color: "rgba(251,163,81,0.6)", types: ["list", "json"] },
	{ color: "rgba(31,200,155,0.6)", types: ["boolean"] },
	{ color: "rgba(115,202,81,0.6)", types: ["unsigned", "integer"] },
	{ color: "rgba(134,217,152,0.6)", types: ["float", "double", "decimal"] },
	{ color: "rgba(207,139,225,0.6)", types: ["timestamp", "date", "time"] },
];

export const schema = Schema.object({
	dataview: Schema.object({
		autoStats: Schema.boolean().default(true).description("刷新时自动同步"),
		color: Schema.boolean().default(false).description("默认启用类型染色"),
		colors: Schema.array(TypeColor).default(defaultTypeColors).role("table"),
	}),
});

export default (ctx: Context) => {
	ctx.settings({
		id: "dataview",
		title: "数据库设置",
		schema,
	});

	ctx.page({
		path: "/database/:name*",
		name: "数据库",
		icon: "database",
		order: 410,
		authority: 4,
		fields: ["database"],
		component: Database,
	});
};
