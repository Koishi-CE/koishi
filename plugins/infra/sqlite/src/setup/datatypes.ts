// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/** minato 类型 transformer 注册：JS 值 ↔ SQLite 存储值的双向转换。 */
import { Binary, isNullable } from "cosmokit";
import { Field } from "minato";
import type { SQLiteDriver } from "../index.ts";

export function defineTypes(driver: SQLiteDriver) {
	driver.define<boolean, number>({
		types: ["boolean"],
		dump: (value) => (isNullable(value) ? value : +value),
		load: (value) => (isNullable(value) ? value : !!value),
	});

	driver.define<object, string>({
		types: ["json"],
		dump: (value) => JSON.stringify(value),
		load: (value) => (typeof value === "string" ? JSON.parse(value) : value),
	});

	driver.define<string[], string>({
		types: ["list"],
		dump: (value) => (Array.isArray(value) ? value.join(",") : value),
		load: (value) => (value ? value.split(",") : []),
	});

	driver.define<Date, number | bigint>({
		types: ["date", "time", "timestamp"],
		dump: (value) => (isNullable(value) ? null : +new Date(value)),
		load: (value) => (isNullable(value) ? value : new Date(Number(value))),
	});

	driver.define<ArrayBufferLike, ArrayBufferView>({
		types: ["binary"],
		dump: (value) => (isNullable(value) ? value : new Uint8Array(value)),
		load: (value) => (isNullable(value) ? value : Binary.fromSource(value)),
	});

	driver.define<number, number | bigint>({
		// primary 主键与数字族共用 Number 归一（Field.Type<number> 不含 primary，
		// 故整表断言一次）
		types: ["primary", ...Field.number] as Field.Type<number>[],
		dump: (value) => value,
		load: (value) => (isNullable(value) ? value : Number(value)),
	});
}
