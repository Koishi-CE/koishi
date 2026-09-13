// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 索引记账：不真正加速查询，仅维护元数据供 getIndexes 等读取
 * （内存全表扫描本无索引可言）。
 *
 * 与上游的刻意差异：索引记账用 Map 承载（上游为裸对象记录）
 * ——表名与索引名系库的公开入参、直接作记录键，裸对象挡不住
 * __proto__ 等键的污染路径（CodeQL js/prototype-polluting-
 * assignment），Map 系该规则的官方首选建议。
 */
import type { Driver } from "minato";
import type { MemoryDriver } from "../index.ts";

export async function getIndexes(
	driver: MemoryDriver,
	table: string,
) {
	return [...(driver._indexes.get(table)?.values() ?? [])];
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
	const indexes = driver._indexes.get(table) ?? new Map();
	driver._indexes.set(table, indexes);
	indexes.set(name, { name, unique: false, ...index });
}

export async function dropIndex(
	driver: MemoryDriver,
	table: string,
	name: string,
) {
	driver._indexes.get(table)?.delete(name);
}
