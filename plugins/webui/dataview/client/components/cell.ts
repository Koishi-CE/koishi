// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 单元格值的展示与输入模型转换（原 data-table.vue 拆出的纯函数）。
 *
 * 数据库原始值（unknown）与编辑输入模型（CellModel，el-input 的
 * 字符串/数字输入或日期选择器的 Date）之间的双向转换按字段类型
 * 分派；展示渲染同样按类型格式化。字段定义经参数传入，不持有
 * 组件状态。
 */
import type { TableInfo } from "@koishi-ce/plugin-dataview";
import { dateStr, timeStr } from "../utils.ts";

/** 字段定义表（store.database.tables[name].fields） */
type Fields = TableInfo["fields"];

/** 单元格输入模型（el-input 的字符串/数字输入，或日期选择器的 Date） */
export type CellModel = string | number | Date;

/** 按字段类型渲染单元格的展示值 */
export function renderCellValue(
	fields: Fields | undefined,
	field: string,
	data: unknown,
) {
	const fType = fields?.[field]?.deftype;
	switch (fType) {
		case "json":
			return JSON.stringify(data);
		case "date":
			if (data instanceof Date) return dateStr(data);
			break;
		case "time":
			if (data instanceof Date) return timeStr(data);
			break;
		case "timestamp":
			if (data instanceof Date)
				return `${dateStr(data)} ${timeStr(data)}`;
			break;
		case "binary":
			return `<Binary len=${data}>`;
	}
	return data;
}

/** 把单元格数据转换为输入模型 */
export function toModelValue(
	fields: Fields | undefined,
	field: string,
	data: unknown,
): CellModel {
	const fType = fields?.[field]?.deftype;
	if (fType === "list" || fType === "json")
		return JSON.stringify(data);
	if (fType === "time" && typeof data === "string") {
		const [h, m, s] = data.split(":");
		const time = new Date();
		time.setHours(
			Number.parseInt(h ?? "0", 10),
			Number.parseInt(m ?? "0", 10),
			Number.parseInt(s ?? "0", 10),
		);
		return time;
	}
	return data as CellModel;
}

/** 把输入模型转换回单元格数据 */
export function fromModelValue(
	fields: Fields | undefined,
	field: string,
	data: CellModel,
): unknown {
	const fType = fields?.[field]?.deftype;
	switch (fType) {
		case "unsigned":
		case "integer":
		case "float":
		case "double":
			return +data;
		case "boolean":
		case "list":
		case "json":
			return JSON.parse(String(data));
	}
	return data;
}
