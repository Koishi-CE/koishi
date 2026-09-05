// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 索引记账：不真正加速查询，仅维护元数据供 getIndexes 等读取
 * （内存全表扫描本无索引可言）。
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
	const indexes = (driver._indexes[table] ??= {});
	indexes[name] = { name, unique: false, ...index };
}

export async function dropIndex(
	driver: MemoryDriver,
	table: string,
	name: string,
) {
	const indexes = (driver._indexes[table] ??= {});
	delete indexes[name];
}
