// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/** minato 类型 transformer 注册：JS 值 ↔ SQLite 存储值的双向转换。 */
import { Binary, isNullable } from "cosmokit";
import { Field } from "minato";
import type { SQLiteDriver } from "../index.ts";

export function defineTypes(driver: SQLiteDriver) {
	/** 存储形态：INTEGER 0/1。 */
	driver.define<boolean, number>({
		types: ["boolean"],
		dump: (value) => (isNullable(value) ? value : +value),
		load: (value) => (isNullable(value) ? value : !!value),
	});

	/** 存储形态：TEXT（JSON 序列化串）。 */
	driver.define<object, string>({
		types: ["json"],
		dump: (value) => JSON.stringify(value),
		load: (value) =>
			typeof value === "string" ? JSON.parse(value) : value,
	});

	/** 存储形态：TEXT（逗号分隔；元素含逗号会被拆散——上游语义如此）。 */
	driver.define<string[], string>({
		types: ["list"],
		dump: (value) =>
			Array.isArray(value) ? value.join(",") : value,
		load: (value) => (value ? value.split(",") : []),
	});

	/** 存储形态：INTEGER 毫秒时间戳（bigint 读回时 Number 归一）。 */
	driver.define<Date, number | bigint>({
		types: ["date", "time", "timestamp"],
		dump: (value) =>
			isNullable(value) ? null : +new Date(value),
		load: (value) =>
			isNullable(value) ? value : new Date(Number(value)),
	});

	/** 存储形态：BLOB（统一转 Uint8Array 绑定，读回包成 Binary）。 */
	driver.define<ArrayBufferLike, ArrayBufferView>({
		types: ["binary"],
		dump: (value) =>
			isNullable(value) ? value : new Uint8Array(value),
		load: (value) =>
			isNullable(value) ? value : Binary.fromSource(value),
	});

	/**
	 * 存储形态：INTEGER/REAL 原生数值，读回 Number 归一。
	 * primary 主键与数字族共用 Number 归一（Field.Type<number> 不含
	 * primary，故整表断言一次）。
	 */
	driver.define<number, number | bigint>({
		types: [
			"primary",
			...Field.number,
		] as Field.Type<number>[],
		dump: (value) => value,
		load: (value) =>
			isNullable(value) ? value : Number(value),
	});
}
