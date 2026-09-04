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
import type { SQLiteDriver } from "../index.ts";
import { joinKeys } from "../sql/utils.ts";

/** minato 字段类型 → SQLite 存储类型的静态映射表。 */
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

/**
 * 表结构同步：对比 `PRAGMA table_info` 与 model 定义，按差异走三路之一——
 * 1. 库中无表 → 直接 CREATE TABLE；
 * 2. 列名/类型漂移（含 legacy 归并、dropKeys 剔除）→ 建临时表搬数据重建；
 * 3. 仅新增列 → 逐条 ALTER TABLE ADD。
 * 尾段再走基类 migrate（字段级数据迁移钩子），迁移产物由 finalize
 * 递归调 prepare 收编进表结构。
 */
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

	// field definitions：legacy 声明允许新列名归并旧列（改名迁移的依据）
	for (const key in model.fields) {
		const field = model.fields[key];
		if (!field || !Field.available(field)) {
			if (dropKeys?.includes(key)) shouldMigrate = true;
			continue;
		}

		const legacy = [key, ...(field.legacy || [])];
		const column = columns.find(({ name }) =>
			legacy.includes(name),
		);
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
					driver.sql.escape(
						driver.sql.dump({ [key]: initial }, model)[key],
					);
			}
		}
		columnDefs.push(def);
		if (!column) {
			alter.push(`ADD ${def}`);
		} else {
			mapping[column.name] = key;
			shouldMigrate ||=
				column.name !== key || column.type !== typedef;
		}
	}

	// index definitions：表级约束随建表 DDL 一起声明（SQLite 无独立语法）
	if (model.primary && !model.autoInc) {
		indexDefs.push(
			`PRIMARY KEY (${joinKeys(makeArray(model.primary))})`,
		);
	}
	if (model.unique) {
		indexDefs.push(
			...model.unique.map(
				(keys) => `UNIQUE (${joinKeys(makeArray(keys))})`,
			),
		);
	}
	if (model.foreign) {
		indexDefs.push(
			...Object.entries(model.foreign).map(
				([key, value]) => {
					const [table = "", key2 = ""] = value ?? [];
					return `FOREIGN KEY (\`${key}\`) REFERENCES ${escapeId(table)} (\`${key2}\`)`;
				},
			),
		);
	}

	if (!columns.length) {
		driver.logger.info("auto creating table %c", table);
		driver._run(
			`CREATE TABLE ${escapeId(table)} (${[...columnDefs, ...indexDefs].join(", ")})`,
		);
	} else if (shouldMigrate) {
		// 重建式迁移：旧列原样保留（model 未声明的列也不丢数据），
		// 搬运失败时删掉临时表保住原表
		for (const {
			name,
			type,
			notnull,
			pk,
			dflt_value: value,
		} of columns) {
			if (mapping[name] || dropKeys?.includes(name))
				continue;
			let def = `${escapeId(name)} ${type}`;
			def += `${notnull ? " NOT " : " "}NULL`;
			if (pk) def += " PRIMARY KEY";
			if (value !== null)
				def += ` DEFAULT ${driver.sql.escape(value)}`;
			columnDefs.push(def);
			mapping[name] = name;
		}

		const temp = `${table}_temp`;
		const fields = Object.keys(mapping)
			.map(escapeId)
			.join(", ");
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
		driver._run(
			`ALTER TABLE ${escapeId(temp)} RENAME TO ${escapeId(table)}`,
		);
	} else if (alter.length) {
		driver.logger.info("auto updating table %c", table);
		for (const def of alter) {
			driver._run(`ALTER TABLE ${escapeId(table)} ${def}`);
		}
	}

	// 尾段：dropKeys 为 undefined 说明是首轮调用，执行基类 migrate
	//（字段级数据迁移）；finalize 里递归重跑 prepare，把迁移产物收编进结构
	if (dropKeys) return;
	dropKeys = [];
	await driver.runMigration(table, {
		error: driver.logger.warn,
		before: (keys) =>
			keys.every((key) =>
				columns.some(({ name }) => name === key),
			),
		after: (keys) => dropKeys?.push(...keys),
		finalize: () => {
			if (!dropKeys?.length) return;
			driver.prepare(table, dropKeys);
		},
	});
}

/** 删表；dropAll 以 driver.database.tables 注册面为准清空全部表。 */
export async function drop(
	driver: SQLiteDriver,
	table: string,
) {
	driver._run(`DROP TABLE ${escapeId(table)}`);
}

export async function dropAll(driver: SQLiteDriver) {
	const tables = Object.keys(driver.database.tables);
	for (const table of tables) {
		driver._run(`DROP TABLE ${escapeId(table)}`);
	}
}
