// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 各字段对应的输入组件与属性派生（原 data-table.vue 拆出）。
 *
 * 列头新行输入与单元格就地编辑共用同一套输入配置：按字段类型选择
 * el-input / el-date-picker / el-time-picker，并为数字 / JSON 字段
 * 附带输入校验器。字段定义经参数传入，不持有组件状态。
 */
import type { Dict } from "@koishi-ce/client";
import type { TableInfo } from "@koishi-ce/plugin-dataview";
import type { CellModel } from "./cell.ts";

/** 字段定义表（store.database.tables[name].fields） */
type Fields = TableInfo["fields"];

/** 每个字段对应的输入组件与属性（列头新行输入、单元格编辑共用） */
export interface ColumnInput {
	is: "el-input" | "el-date-picker" | "el-time-picker";
	attrs?: {
		type?: string;
		validate?: (val: CellModel) => boolean;
		step?: number;
		clearable?: boolean;
	};
}

/** 由字段定义表派生各字段的输入组件与属性 */
export function createColumnInputs(
	fields: Fields | undefined,
): Dict<ColumnInput> {
	return Object.keys(fields ?? {}).reduce<
		Dict<ColumnInput>
	>((o, fName) => {
		const fieldConfig = fields?.[fName];
		if (!fieldConfig) return o;
		const dateAttrs = { clearable: false };

		let type = "text";
		let step: number | undefined;
		switch (fieldConfig.deftype) {
			case "time":
				o[fName] = {
					is: "el-time-picker",
					attrs: dateAttrs,
				};
				return o;
			case "date":
				o[fName] = {
					is: "el-date-picker",
					attrs: { ...dateAttrs, type: "date" },
				};
				return o;
			case "timestamp":
				o[fName] = {
					is: "el-date-picker",
					attrs: { ...dateAttrs, type: "datetime" },
				};
				return o;

			case "integer":
			case "unsigned":
				step = 1;
				type = "number";
				break;

			case "float":
			case "double":
			case "decimal":
				type = "number";
				break;

			default:
				type = "text";
				break;
		}

		const validate = (val: CellModel) => {
			const text = String(val ?? "");
			if (fieldConfig.nullable === false && !text.length)
				return false;
			let value: number | string = text;
			// 上游此处误写为 type.value（恒假）；按其意图对数字输入先转数值再校验
			if (type === "number")
				value = Number.parseFloat(text);
			switch (fieldConfig.deftype) {
				// biome-ignore lint/suspicious/noFallthroughSwitchClause: 负数已提前返回,落入整数检查是上游既定语义
				case "unsigned":
					if (typeof value === "number" && value < 0)
						return false;
				case "integer":
					if (typeof value === "number" && value % 1 !== 0)
						return false;
					break;
				case "json":
					if (text === "") return true;
					if (!text.startsWith("{") || !text.endsWith("}"))
						return false;
					break;
			}
			return true;
		};

		o[fName] = {
			is: "el-input",
			attrs: { type, validate, ...stepSpread(step) },
		};
		return o;
	}, {});
}

/** step 仅在数字类字段存在，exactOptionalPropertyTypes 下条件展开 */
function stepSpread(step: number | undefined) {
	return step === undefined ? {} : { step };
}
