// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 表结构同步与迁移（DDL）。
 *
 * 上游脉络同 src/index.ts：建表 / ALTER / 重建式迁移的三段逻辑
 * 以 cordis 4 线 5.1.1 的 prepare 为骨架，index 定义面回退到
 * minato 3 的 model 元数据。
 */
import { escapeId } from "@minatojs/sql-utils";
import type { Dict } from "cosmokit";
import { isNullable, makeArray } from "cosmokit";
import { Field } from "minato";
import type { SQLiteDriver } from "./index.ts";
import { joinKeys } from "./utils.ts";

function getTypeDef({ deftype: type }: Field) {
	switch (type) {
		case "primary":
		case "boolean":
		case "integer":
		case "unsigned":
		case "bigint":
		case "date":
		case "time":
		case "timestamp":
			return `INTEGER`;
		case "float":
		case "double":
		case "decimal":
			return `REAL`;
		case "char":
		case "string":
		case "text":
		case "list":
		case "json":
			return `TEXT`;
		case "binary":
			return `BLOB`;
		default:
			throw new Error(`unsupported type: ${type}`);
	}
}

/** `PRAGMA table_info` 的行结构。 */
interface SQLiteFieldInfo {
	cid: number;
	name: string;
	type: string;
	notnull: number;
	dflt_value: string;
	pk: boolean;
}

/** synchronize table schema */
export async function prepare(
	driver: SQLiteDriver,
	table: string,
	dropKeys?: string[],
) {
	const columns = driver._all(
		`PRAGMA table_info(${escapeId(table)})`,
	) as SQLiteFieldInfo[];
	const model = driver.model(table);
	const columnDefs: string[] = [];
	const indexDefs: string[] = [];
	const alter: string[] = [];
	const mapping: Dict<string> = {};
	let shouldMigrate = false;

	// field definitions
	for (const key in model.fields) {
		const field = model.fields[key];
		if (!field || !Field.available(field)) {
			if (dropKeys?.includes(key)) shouldMigrate = true;
			continue;
		}

		const legacy = [key, ...(field.legacy || [])];
		const column = columns.find(({ name }) => legacy.includes(name));
		const { initial, nullable = true } = field;
		const typedef = getTypeDef(field);
		let def = `${escapeId(key)} ${typedef}`;
		if (key === model.primary && model.autoInc) {
			def += " NOT NULL PRIMARY KEY AUTOINCREMENT";
		} else {
			def += `${nullable ? " " : " NOT "}NULL`;
			if (!isNullable(initial)) {
				def +=
					" DEFAULT " +
					driver.sql.escape(driver.sql.dump({ [key]: initial }, model)[key]);
			}
		}
		columnDefs.push(def);
		if (!column) {
			alter.push(`ADD ${def}`);
		} else {
			mapping[column.name] = key;
			shouldMigrate ||= column.name !== key || column.type !== typedef;
		}
	}

	// index definitions
	if (model.primary && !model.autoInc) {
		indexDefs.push(`PRIMARY KEY (${joinKeys(makeArray(model.primary))})`);
	}
	if (model.unique) {
		indexDefs.push(
			...model.unique.map((keys) => `UNIQUE (${joinKeys(makeArray(keys))})`),
		);
	}
	if (model.foreign) {
		indexDefs.push(
			...Object.entries(model.foreign).map(([key, value]) => {
				const [table = "", key2 = ""] = value ?? [];
				return `FOREIGN KEY (\`${key}\`) REFERENCES ${escapeId(table)} (\`${key2}\`)`;
			}),
		);
	}

	if (!columns.length) {
		driver.logger.info("auto creating table %c", table);
		driver._run(
			`CREATE TABLE ${escapeId(table)} (${[...columnDefs, ...indexDefs].join(", ")})`,
		);
	} else if (shouldMigrate) {
		// preserve old columns
		for (const { name, type, notnull, pk, dflt_value: value } of columns) {
			if (mapping[name] || dropKeys?.includes(name)) continue;
			let def = `${escapeId(name)} ${type}`;
			def += `${notnull ? " NOT " : " "}NULL`;
			if (pk) def += " PRIMARY KEY";
			if (value !== null) def += ` DEFAULT ${driver.sql.escape(value)}`;
			columnDefs.push(def);
			mapping[name] = name;
		}

		const temp = `${table}_temp`;
		const fields = Object.keys(mapping).map(escapeId).join(", ");
		driver.logger.info("auto migrating table %c", table);
		driver._run(
			`CREATE TABLE ${escapeId(temp)} (${[...columnDefs, ...indexDefs].join(", ")})`,
		);
		try {
			driver._run(
				`INSERT INTO ${escapeId(temp)} SELECT ${fields} FROM ${escapeId(table)}`,
			);
			driver._run(`DROP TABLE ${escapeId(table)}`);
		} catch (error) {
			driver._run(`DROP TABLE ${escapeId(temp)}`);
			throw error;
		}
		driver._run(`ALTER TABLE ${escapeId(temp)} RENAME TO ${escapeId(table)}`);
	} else if (alter.length) {
		driver.logger.info("auto updating table %c", table);
		for (const def of alter) {
			driver._run(`ALTER TABLE ${escapeId(table)} ${def}`);
		}
	}

	if (dropKeys) return;
	dropKeys = [];
	await driver.runMigration(table, {
		error: driver.logger.warn,
		before: (keys) =>
			keys.every((key) => columns.some(({ name }) => name === key)),
		after: (keys) => dropKeys?.push(...keys),
		finalize: () => {
			if (!dropKeys?.length) return;
			driver.prepare(table, dropKeys);
		},
	});
}

export async function drop(driver: SQLiteDriver, table: string) {
	driver._run(`DROP TABLE ${escapeId(table)}`);
}

export async function dropAll(driver: SQLiteDriver) {
	const tables = Object.keys(driver.database.tables);
	for (const table of tables) {
		driver._run(`DROP TABLE ${escapeId(table)}`);
	}
}
