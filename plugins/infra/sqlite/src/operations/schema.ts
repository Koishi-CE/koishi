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
import { Field, type Model } from "minato";
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

/** prepare 的列差异分析结果（见 {@link buildColumnDefs}） */
interface ColumnPlan {
	/** 全部声明列的建表列定义 */
	columnDefs: string[];
	/** 仅新增列的 ALTER TABLE ADD 片段 */
	alter: string[];
	/** 旧列名 → 新列名（legacy 归并后的搬运映射） */
	mapping: Dict<string>;
	/** 列名/类型出现漂移，需要重建式迁移 */
	shouldMigrate: boolean;
}

/**
 * 由 model 声明与库中现列（`PRAGMA table_info`）做列级差异分析：
 * legacy 声明允许新列名归并旧列（改名迁移的依据），initial 缺省值
 * 经 sql.dump 序列化进列定义。
 */
function buildColumnDefs(
	driver: SQLiteDriver,
	model: Model,
	columns: SQLiteFieldInfo[],
	dropKeys?: string[],
): ColumnPlan {
	const plan: ColumnPlan = {
		columnDefs: [],
		alter: [],
		mapping: {},
		shouldMigrate: false,
	};
	for (const key in model.fields) {
		const field = model.fields[key];
		if (!field || !Field.available(field)) {
			if (dropKeys?.includes(key))
				plan.shouldMigrate = true;
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
		plan.columnDefs.push(def);
		if (!column) {
			plan.alter.push(`ADD ${def}`);
		} else {
			plan.mapping[column.name] = key;
			plan.shouldMigrate ||=
				column.name !== key || column.type !== typedef;
		}
	}
	return plan;
}

/**
 * 表级约束（主键 / 唯一 / 外键）随建表 DDL 一起声明
 * （SQLite 无独立的表级约束语法）。
 */
function buildIndexDefs(
	model: Model,
): string[] {
	const indexDefs: string[] = [];
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
	return indexDefs;
}

/**
 * 重建式迁移：把 model 未声明的旧列原样保留进临时表（不丢数据），
 * 搬运失败时删掉临时表保住原表，成功则以 RENAME 原子换名。
 * 会向 plan.columnDefs / plan.mapping 追加保留列的定义与恒等映射。
 */
function rebuildTable(
	driver: SQLiteDriver,
	table: string,
	columns: SQLiteFieldInfo[],
	plan: ColumnPlan,
	indexDefs: string[],
	dropKeys?: string[],
) {
	for (const {
		name,
		type,
		notnull,
		pk,
		dflt_value: value,
	} of columns) {
		if (plan.mapping[name] || dropKeys?.includes(name))
			continue;
		let def = `${escapeId(name)} ${type}`;
		def += `${notnull ? " NOT " : " "}NULL`;
		if (pk) def += " PRIMARY KEY";
		if (value !== null)
			def += ` DEFAULT ${driver.sql.escape(value)}`;
		plan.columnDefs.push(def);
		plan.mapping[name] = name;
	}

	const temp = `${table}_temp`;
	const fields = Object.keys(plan.mapping)
		.map(escapeId)
		.join(", ");
	driver.logger.info("auto migrating table %c", table);
	driver._run(
		`CREATE TABLE ${escapeId(temp)} (${[...plan.columnDefs, ...indexDefs].join(", ")})`,
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
	const plan = buildColumnDefs(
		driver,
		model,
		columns,
		dropKeys,
	);
	const indexDefs = buildIndexDefs(model);

	if (!columns.length) {
		driver.logger.info("auto creating table %c", table);
		driver._run(
			`CREATE TABLE ${escapeId(table)} (${[...plan.columnDefs, ...indexDefs].join(", ")})`,
		);
	} else if (plan.shouldMigrate) {
		rebuildTable(
			driver,
			table,
			columns,
			plan,
			indexDefs,
			dropKeys,
		);
	} else if (plan.alter.length) {
		driver.logger.info("auto updating table %c", table);
		for (const def of plan.alter) {
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

/**
 * 枚举本库文件中真实存在的用户表（`sqlite_master` 物理面，排除
 * `sqlite_` 前缀的内部表）。dropAll 与 stats 以物理面为准而不随
 * 全局模型注册面走：多驱动并存时注册面会含其他驱动独占的表，
 * 按注册面清库/统计会对不存在的表执行 SQL 而报错
 * （upstream: cordiverse/database#132，4 线以 core 维护的驱动
 * 表集合实现，本仓 3 线以物理枚举等效）。
 */
export function listTables(driver: SQLiteDriver): string[] {
	const rows = driver._all(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
	) as { name: string }[];
	return rows.map(({ name }) => name);
}

/** 删表。 */
export async function drop(
	driver: SQLiteDriver,
	table: string,
) {
	driver._run(`DROP TABLE ${escapeId(table)}`);
}

/** 清空全部物理表（以 `sqlite_master` 枚举为准，见 {@link listTables}）。 */
export async function dropAll(driver: SQLiteDriver) {
	for (const table of listTables(driver)) {
		driver._run(`DROP TABLE ${escapeId(table)}`);
	}
}
