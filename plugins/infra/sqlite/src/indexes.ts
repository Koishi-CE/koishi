// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/** 二级索引管理：创建、列举、删除与 `sqlite_master` 定义解析。 */
import { escapeId } from "@minatojs/sql-utils";
import type { Driver } from "minato";
import type { SQLiteDriver } from "./index.ts";

/** `sqlite_master` 的行结构。 */
interface SQLiteMasterInfo {
	type: string;
	name: string;
	tbl_name: string;
	sql: string;
}

export async function getIndexes(driver: SQLiteDriver, table: string) {
	const indexes = driver._all(
		`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`,
		[table],
	) as SQLiteMasterInfo[];
	const result: Driver.Index[] = [];
	for (const { name, sql } of indexes) {
		result.push({
			name,
			unique: !sql || sql.toUpperCase().startsWith("CREATE UNIQUE"),
			keys: parseIndexDef(sql),
		});
	}
	return result;
}

export async function createIndex(
	driver: SQLiteDriver,
	table: string,
	index: Driver.Index,
) {
	const name =
		index.name ??
		Object.entries(index.keys)
			.map(([key, direction]) => `${key}_${direction ?? "asc"}`)
			.join("+");
	const keyFields = Object.entries(index.keys)
		.map(([key, direction]) => `${escapeId(key)} ${direction ?? "asc"}`)
		.join(", ");
	await driver._run(
		`create ${index.unique ? "UNIQUE" : ""} index ${escapeId(name)} ON ${escapeId(table)} (${keyFields})`,
	);
}

export async function dropIndex(driver: SQLiteDriver, name: string) {
	await driver._run(`DROP INDEX ${escapeId(name)}`);
}

function parseIndexDef(def: string): Driver.Index["keys"] {
	if (!def) return {};
	try {
		const keys: Driver.Index["keys"] = {};
		const matches = def.match(/\((.*)\)/);
		matches?.[1]?.split(",").forEach((key) => {
			const [name = "", direction] = key.trim().split(" ");
			keys[name.startsWith("`") ? name.slice(1, -1) : name] =
				direction?.toLowerCase() === "desc" ? "desc" : "asc";
		});
		return keys;
	} catch {
		return {};
	}
}
