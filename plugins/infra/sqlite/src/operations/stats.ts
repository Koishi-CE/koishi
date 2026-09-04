// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/** 库 / 表规模统计（webui 数据库面板的数据源）。 */
import { escapeId } from "@minatojs/sql-utils";
import type { Driver } from "minato";
import type { SQLiteDriver } from "../index.ts";

/**
 * 库大小 = page_count × page_size；逐表占用查 dbstat 虚表（官方构建
 * 默认开启的编译特性），行数逐表 COUNT。表在 dbstat 无记录时占位为 0。
 */
export async function collectStats(
	driver: SQLiteDriver,
): Promise<Driver.Stats> {
	const tables = Object.keys(driver.database.tables);
	const pageCount = driver._get(`PRAGMA page_count`) as {
		page_count?: number | bigint;
	};
	const pageSize = driver._get(`PRAGMA page_size`) as {
		page_size?: number | bigint;
	};
	const stats: Driver.Stats = {
		size:
			Number(pageCount?.page_count ?? 0) *
			Number(pageSize?.page_size ?? 0),
		tables: {},
	};
	const dbstats = driver._all(
		'SELECT name, pgsize as size FROM "dbstat" WHERE aggregate=TRUE;',
	) as { name: string; size: number }[];
	for (const name of tables) {
		const { count } = driver._get(
			`SELECT COUNT(*) as count FROM ${escapeId(name)};`,
		) as { count: number };
		stats.tables[name] = {
			count,
			size: dbstats.find((o) => o.name === name)?.size ?? 0,
		};
	}
	return stats;
}
