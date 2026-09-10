// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/** 库 / 表规模统计（webui 数据库面板的数据源）。 */
import { escapeId } from "@minatojs/sql-utils";
import type { Driver } from "minato";
import type { SQLiteDriver } from "../index.ts";
import { listTables } from "./schema.ts";

/**
 * 库大小 = page_count × page_size；逐表占用查 dbstat 虚表（官方构建
 * 默认开启的编译特性），行数逐表 COUNT。表以 `sqlite_master` 物理面
 * 枚举（见 schema.ts 的 listTables），注册面中无物理表的条目不统计。
 */
export async function collectStats(
	driver: SQLiteDriver,
): Promise<Driver.Stats> {
	const tables = listTables(driver);
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
