// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 索引记账：不真正加速查询，仅维护元数据供 getIndexes 等读取
 * （内存全表扫描本无索引可言）。
 *
 * 与上游的刻意差异：索引记录用 Object.create(null) 原型无对象
 * 承载（上游为裸对象字面量）——表名与索引名系库的公开入参，
 * 直接作记录键，须防 __proto__ 等键污染 Object.prototype
 * （CodeQL js/prototype-polluting-assignment）。
 */
import type { Driver } from "minato";
import type { MemoryDriver } from "../index.ts";

export async function getIndexes(
	driver: MemoryDriver,
	table: string,
) {
	return Object.values(driver._indexes[table] ?? {});
}

export async function createIndex(
	driver: MemoryDriver,
	table: string,
	index: Driver.Index,
) {
	const name =
		index.name ??
		"index:" +
			Object.entries(index.keys)
				.map(([key, direction]) => `${key}_${direction}`)
				.join("+");
	const indexes = (driver._indexes[table] ??=
		Object.create(null));
	indexes[name] = { name, unique: false, ...index };
}

export async function dropIndex(
	driver: MemoryDriver,
	table: string,
	name: string,
) {
	const indexes = (driver._indexes[table] ??=
		Object.create(null));
	delete indexes[name];
}
