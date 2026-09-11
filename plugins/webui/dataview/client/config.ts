// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * dataview 的客户端本地配置（原 index.ts 拆出）。
 *
 * 语言包与配置 schema 独立成叶子模块：data-table.vue 等组件需要引用
 * schema 解析配置（如类型染色规则），若从入口 index.ts 引用会与页面
 * 注册形成循环依赖（data-table → index.ts → index.vue → data-table）。
 */
import { pickFrom, Schema } from "@koishi-ce/client";
import deDE from "./locales/de-DE.yml";
import enUS from "./locales/en-US.yml";
import frFR from "./locales/fr-FR.yml";
import jaJP from "./locales/ja-JP.yml";
import ruRU from "./locales/ru-RU.yml";
import zhCN from "./locales/zh-CN.yml";
import zhTW from "./locales/zh-TW.yml";

/** 本扩展的语言包（extend 注入全局词典 / 摘取 schema 词典段） */
export const messages: Record<string, unknown> = {
	"de-DE": deDE,
	"en-US": enUS,
	"fr-FR": frFR,
	"ja-JP": jaJP,
	"ru-RU": ruRU,
	"zh-CN": zhCN,
	"zh-TW": zhTW,
};

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
	types: Schema.array(Schema.union(FieldType))
		.default([])
		.role("select"),
});

const defaultTypeColors: TypeColor[] = [
	{
		color: "rgba(249,100,94,0.6)",
		types: ["char", "string", "text"],
	},
	{
		color: "rgba(251,163,81,0.6)",
		types: ["list", "json"],
	},
	{ color: "rgba(31,200,155,0.6)", types: ["boolean"] },
	{
		color: "rgba(115,202,81,0.6)",
		types: ["unsigned", "integer"],
	},
	{
		color: "rgba(134,217,152,0.6)",
		types: ["float", "double", "decimal"],
	},
	{
		color: "rgba(207,139,225,0.6)",
		types: ["timestamp", "date", "time"],
	},
];

export const schema = Schema.object({
	dataview: Schema.object({
		autoStats: Schema.boolean()
			.default(true)
			// const/叶子项的显示名走 Dict 形态的 meta.description（extra 写入）
			.extra(
				"description",
				pickFrom(messages, "dataview", "autoSync"),
			),
		color: Schema.boolean()
			.default(false)
			.extra(
				"description",
				pickFrom(messages, "dataview", "typeHighlight"),
			),
		colors: Schema.array(TypeColor)
			.default(defaultTypeColors)
			.role("table"),
	}),
});
