// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync, SQLOutputValue, StatementSync } from "node:sqlite";
import { escapeId } from "@minatojs/sql-utils";
import type { Dict } from "cosmokit";
/**
 * SQLite 数据库驱动（minato 3 / cordis 3 冻结线）。
 *
 * 引擎采用 Node 22.5+ 的 `node:sqlite`（`DatabaseSync` 同步 API），
 * Bun 1.4 原生实现该模块（含 `db.function()` 自定义函数注册），
 * 文件直写天然持久化，无 wasm 加载与导出落盘包袱。
 *
 * 上游脉络：cordis 3 线 `@minatojs/driver-sqlite` 4.7.0（sql.js 引擎，
 * 已冻结）与 cordis 4 线 `@cordisjs/plugin-database-sqlite` 5.1.1
 * （node:sqlite 引擎）的文件级合并改写——以 4 线的引擎层为骨架，
 * API 面回退到 minato 3；映射关系见 docs/process/upstream.md。
 *
 * 已知限制：Bun 的 node:sqlite 实现中 `setReadBigInts` 为空操作，
 * 超过 Number.MAX_SAFE_INTEGER 的整数读回会抛 RangeError（写入不受
 * 影响）；自增主键、时间戳等常规业务值远低于该阈值。
 */
import {
	Binary,
	deepEqual,
	difference,
	isNullable,
	makeArray,
	mapValues,
} from "cosmokit";
import type { Selection } from "minato";
import {
	Driver,
	Eval,
	executeUpdate,
	Field,
	getCell,
	hasSubquery,
	isEvalExpr,
	z,
} from "minato";
import enUS from "../locales/en-US.yml";
import zhCN from "../locales/zh-CN.yml";
import { SQLiteBuilder } from "./builder.ts";

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

interface SQLiteFieldInfo {
	cid: number;
	name: string;
	type: string;
	notnull: number;
	dflt_value: string;
	pk: boolean;
}

interface SQLiteMasterInfo {
	type: string;
	name: string;
	tbl_name: string;
	sql: string;
}

export class SQLiteDriver extends Driver<SQLiteDriver.Config> {
	static override name = "sqlite";

	static Config: z<SQLiteDriver.Config> = z
		.object({
			path: z.string().role("path").required(),
		})
		.i18n({
			"en-US": enUS,
			"zh-CN": zhCN,
		});

	path!: string;
	db!: DatabaseSync;
	sql = new SQLiteBuilder(this);
	beforeUnload?: () => void;

	private _transactionTask?: Promise<void>;

	/** synchronize table schema */
	async prepare(table: string, dropKeys?: string[]) {
		const columns = this._all(
			`PRAGMA table_info(${escapeId(table)})`,
		) as SQLiteFieldInfo[];
		const model = this.model(table);
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
						this.sql.escape(this.sql.dump({ [key]: initial }, model)[key]);
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
			indexDefs.push(
				`PRIMARY KEY (${this._joinKeys(makeArray(model.primary))})`,
			);
		}
		if (model.unique) {
			indexDefs.push(
				...model.unique.map(
					(keys) => `UNIQUE (${this._joinKeys(makeArray(keys))})`,
				),
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
			this.logger.info("auto creating table %c", table);
			this._run(
				`CREATE TABLE ${escapeId(table)} (${[...columnDefs, ...indexDefs].join(", ")})`,
			);
		} else if (shouldMigrate) {
			// preserve old columns
			for (const { name, type, notnull, pk, dflt_value: value } of columns) {
				if (mapping[name] || dropKeys?.includes(name)) continue;
				let def = `${escapeId(name)} ${type}`;
				def += `${notnull ? " NOT " : " "}NULL`;
				if (pk) def += " PRIMARY KEY";
				if (value !== null) def += ` DEFAULT ${this.sql.escape(value)}`;
				columnDefs.push(def);
				mapping[name] = name;
			}

			const temp = `${table}_temp`;
			const fields = Object.keys(mapping).map(escapeId).join(", ");
			this.logger.info("auto migrating table %c", table);
			this._run(
				`CREATE TABLE ${escapeId(temp)} (${[...columnDefs, ...indexDefs].join(", ")})`,
			);
			try {
				this._run(
					`INSERT INTO ${escapeId(temp)} SELECT ${fields} FROM ${escapeId(table)}`,
				);
				this._run(`DROP TABLE ${escapeId(table)}`);
			} catch (error) {
				this._run(`DROP TABLE ${escapeId(temp)}`);
				throw error;
			}
			this._run(`ALTER TABLE ${escapeId(temp)} RENAME TO ${escapeId(table)}`);
		} else if (alter.length) {
			this.logger.info("auto updating table %c", table);
			for (const def of alter) {
				this._run(`ALTER TABLE ${escapeId(table)} ${def}`);
			}
		}

		if (dropKeys) return;
		dropKeys = [];
		await this.migrate(table, {
			error: this.logger.warn,
			before: (keys) =>
				keys.every((key) => columns.some(({ name }) => name === key)),
			after: (keys) => dropKeys?.push(...keys),
			finalize: () => {
				if (!dropKeys?.length) return;
				this.prepare(table, dropKeys);
			},
		});
	}

	async start() {
		this.path = this.config.path;
		if (this.path !== ":memory:") {
			this.path = resolve(this.ctx.baseDir, this.path);
			mkdirSync(dirname(this.path), { recursive: true });
		}

		const { DatabaseSync } = await import("node:sqlite");
		this.db = new DatabaseSync(this.path);

		this.db.function(
			"regexp",
			(pattern: SQLOutputValue, str: SQLOutputValue) => {
				if (isNullable(pattern) || isNullable(str)) return null;
				return +new RegExp(String(pattern)).test(String(str));
			},
		);
		this.db.function(
			"regexp2",
			(pattern: SQLOutputValue, str: SQLOutputValue, flags: SQLOutputValue) => {
				if (isNullable(pattern) || isNullable(str) || isNullable(flags)) {
					return null;
				}
				return +new RegExp(String(pattern), String(flags)).test(String(str));
			},
		);
		this.db.function(
			"json_array_contains",
			(array: SQLOutputValue, value: SQLOutputValue) => {
				if (isNullable(array) || isNullable(value)) return null;
				return +(JSON.parse(String(array)) as unknown[]).includes(
					JSON.parse(String(value)),
				);
			},
		);
		this.db.function(
			"modulo",
			(left: SQLOutputValue, right: SQLOutputValue) => {
				if (isNullable(left) || isNullable(right)) return null;
				return Number(left) % Number(right);
			},
		);
		this.db.function("rand", () => Math.random());

		this.define<boolean, number>({
			types: ["boolean"],
			dump: (value) => (isNullable(value) ? value : +value),
			load: (value) => (isNullable(value) ? value : !!value),
		});

		this.define<object, string>({
			types: ["json"],
			dump: (value) => JSON.stringify(value),
			load: (value) => (typeof value === "string" ? JSON.parse(value) : value),
		});

		this.define<string[], string>({
			types: ["list"],
			dump: (value) => (Array.isArray(value) ? value.join(",") : value),
			load: (value) => (value ? value.split(",") : []),
		});

		this.define<Date, number | bigint>({
			types: ["date", "time", "timestamp"],
			dump: (value) => (isNullable(value) ? null : +new Date(value)),
			load: (value) => (isNullable(value) ? value : new Date(Number(value))),
		});

		this.define<ArrayBufferLike, ArrayBufferView>({
			types: ["binary"],
			dump: (value) => (isNullable(value) ? value : new Uint8Array(value)),
			load: (value) => (isNullable(value) ? value : Binary.fromSource(value)),
		});

		this.define<number, number | bigint>({
			// primary 主键与数字族共用 Number 归一（Field.Type<number> 不含 primary，
			// 故整表断言一次）
			types: ["primary", ...Field.number] as Field.Type<number>[],
			dump: (value) => value,
			load: (value) => (isNullable(value) ? value : Number(value)),
		});
	}

	_joinKeys(keys?: string[]) {
		return keys?.length ? keys.map((key) => `\`${key}\``).join(", ") : "*";
	}

	async stop() {
		await new Promise((resolve) => setTimeout(resolve, 0));
		this.db?.close();
	}

	_exec<T>(
		sql: string,
		params: unknown[],
		callback: (stmt: StatementSync) => T,
	) {
		try {
			const stmt = this.db.prepare(sql);
			const result = callback(stmt);
			this.logger.debug("> %s", sql, params);
			return result;
		} catch (e) {
			this.logger.warn("> %s", sql, params);
			throw e;
		}
	}

	_all(
		sql: string,
		params: unknown[] = [],
		config?: { useBigInt: boolean },
	): unknown[] {
		return this._exec(sql, params, (stmt) => {
			stmt.setReadBigInts(config?.useBigInt || false);
			const args = params as Parameters<typeof stmt.all>;
			return stmt.all(...args) as unknown[];
		});
	}

	_get(
		sql: string,
		params: unknown[] = [],
		config?: { useBigInt: boolean },
	): unknown {
		return this._exec(sql, params, (stmt) => {
			stmt.setReadBigInts(config?.useBigInt || false);
			const args = params as Parameters<typeof stmt.get>;
			return stmt.get(...args);
		});
	}

	_run(sql: string, params: unknown[] = [], callback?: () => unknown) {
		this._exec(sql, params, (stmt) => {
			const args = params as Parameters<typeof stmt.run>;
			return stmt.run(...args);
		});
		return callback?.();
	}

	async drop(table: string) {
		this._run(`DROP TABLE ${escapeId(table)}`);
	}

	async dropAll() {
		const tables = Object.keys(this.database.tables);
		for (const table of tables) {
			this._run(`DROP TABLE ${escapeId(table)}`);
		}
	}

	async stats() {
		const tables = Object.keys(this.database.tables);
		const pageCount = this._get(`PRAGMA page_count`) as {
			page_count?: number | bigint;
		};
		const pageSize = this._get(`PRAGMA page_size`) as {
			page_size?: number | bigint;
		};
		const stats: Driver.Stats = {
			size:
				Number(pageCount?.page_count ?? 0) * Number(pageSize?.page_size ?? 0),
			tables: {},
		};
		const dbstats = this._all(
			'SELECT name, pgsize as size FROM "dbstat" WHERE aggregate=TRUE;',
		) as { name: string; size: number }[];
		for (const name of tables) {
			const { count } = this._get(
				`SELECT COUNT(*) as count FROM ${escapeId(name)};`,
			) as { count: number };
			stats.tables[name] = {
				count,
				size: dbstats.find((o) => o.name === name)?.size ?? 0,
			};
		}
		return stats;
	}

	async remove(sel: Selection.Mutable) {
		const { query, table, tables } = sel;
		const builder = new SQLiteBuilder(this, tables);
		const filter = builder.parseQuery(query);
		if (filter === "0") return {};
		const result = this._run(
			`DELETE FROM ${escapeId(table)} WHERE ${filter}`,
			[],
			() => this._get(`SELECT changes() AS count`) as { count: number },
		) as { count: number };
		return { matched: result.count, removed: result.count };
	}

	async get(sel: Selection.Immutable) {
		const { model, tables } = sel;
		const builder = new SQLiteBuilder(this, tables);
		const sql = builder.get(sel);
		if (!sql) return [];
		const rows = this._all(sql, [], { useBigInt: true }) as Dict[];
		return rows.map((row) => builder.load(row, model));
	}

	async eval(sel: Selection.Immutable, expr: Eval.Expr) {
		const builder = new SQLiteBuilder(this, sel.tables);
		const inner = builder.get(sel.table as Selection, true, true);
		const output = builder.parseEval(expr, false);
		const { value } = this._get(`SELECT ${output} AS value FROM ${inner}`, [], {
			useBigInt: true,
		}) as { value: unknown };
		return builder.load(value, expr);
	}

	_update(
		sel: Selection.Mutable,
		indexFields: string[],
		updateFields: string[],
		update: object,
		data: object,
	) {
		const { ref, table, tables, model } = sel;
		const builder = new SQLiteBuilder(this, tables);
		executeUpdate(data, update, ref);
		const row = builder.dump(data, model);
		const assignment = updateFields
			.map((key) => `${escapeId(key)} = ?`)
			.join(",");
		const query = Object.fromEntries(indexFields.map((key) => [key, row[key]]));
		const filter = builder.parseQuery(query);
		const args = updateFields.map((key) => row[key] ?? null) as Parameters<
			StatementSync["run"]
		>;
		this._run(
			`UPDATE ${escapeId(table)} SET ${assignment} WHERE ${filter}`,
			args,
		);
	}

	async set(sel: Selection.Mutable, update: object) {
		const { model, table, query } = sel;
		const { primary } = model,
			fields = model.availableFields();
		const updateFields = [
			...new Set(
				Object.keys(update).flatMap((key) => {
					const field = Object.keys(fields).find(
						(field) => field === key || key.startsWith(`${field}.`),
					);
					return field ? [field] : [];
				}),
			),
		];
		const primaryFields = makeArray(primary);
		if (
			query.$expr ||
			hasSubquery(sel.query) ||
			Object.values(update).some((x) => hasSubquery(x))
		) {
			const sel2 = this.database.select(table as never, query);
			delete sel2.tables[sel.ref];
			sel2.ref = sel.ref;
			const project = mapValues(
				update as Dict,
				(value, key) => () =>
					isEvalExpr(value) ? value : Eval.literal(value, model.getType(key)),
			);
			const rawUpsert = await sel2
				.project({
					...project,
					// do not touch sel2.row since it is not patched
					...Object.fromEntries(
						primaryFields.map((x) => [
							x,
							() =>
								Eval(
									"",
									[sel.ref, x],
									sel2.model.getType(x) as Parameters<typeof Eval>[2],
								),
						]),
					),
				})
				.execute();
			const upsert = rawUpsert.map((row) => ({
				...mapValues(update, (_, key) => getCell(row, key)),
				...Object.fromEntries(primaryFields.map((x) => [x, getCell(row, x)])),
			}));
			return this.database.upsert(table as never, upsert);
		} else {
			const data = await this.database.get(table as never, query);
			for (const row of data) {
				this._update(sel, primaryFields, updateFields, update, row);
			}
			return { matched: data.length };
		}
	}

	_create(table: string, data: object) {
		const model = this.model(table);
		data = this.sql.dump(data, model);
		const keys = Object.keys(data);
		const sql = `INSERT INTO ${escapeId(table)} (${this._joinKeys(keys)}) VALUES (${Array(keys.length).fill("?").join(", ")})`;
		const args = keys.map((key) => (data as Dict)[key] ?? null) as Parameters<
			StatementSync["run"]
		>;
		return this._run(
			sql,
			args,
			() =>
				this._get(`SELECT last_insert_rowid() AS id`) as {
					id: number | bigint;
				},
		) as { id: number | bigint };
	}

	async create(sel: Selection.Mutable, data: object) {
		const { model, table } = sel;
		const { id } = this._create(table, data);
		const { autoInc, primary } = model;
		if (!autoInc || Array.isArray(primary)) return data;
		return { ...data, [primary]: id };
	}

	async upsert(sel: Selection.Mutable, data: Dict[], keys: string[]) {
		if (!data.length) return {};
		const { model, table, ref } = sel;
		const fields = model.availableFields();
		const result = { inserted: 0, matched: 0, modified: 0 };
		const dataFields = [
			...new Set(
				Object.keys(Object.assign({}, ...data)).flatMap((key) => {
					const field = Object.keys(fields).find(
						(field) => field === key || key.startsWith(`${field}.`),
					);
					return field ? [field] : [];
				}),
			),
		];
		let updateFields = difference(dataFields, keys);
		if (!updateFields.length) updateFields = [dataFields[0] ?? ""];
		// Error: Expression tree is too large (maximum depth 1000)
		const step = Math.floor(960 / keys.length);
		for (let i = 0; i < data.length; i += step) {
			const chunk = data.slice(i, i + step);
			const results = (await this.database.get(table as never, {
				$or: chunk.map((item) =>
					Object.fromEntries(keys.map((key) => [key, item[key]])),
				),
			})) as Dict[];
			for (const item of chunk) {
				const row = results.find((row) => {
					// flatten key to respect model
					const formatted = model.format(row);
					return keys.every((key) =>
						deepEqual(formatted[key], item[key], true),
					);
				});
				if (row) {
					this._update(sel, keys, updateFields, item, row);
					result.matched++;
				} else {
					this._create(table, executeUpdate(model.create(), item, ref));
					result.inserted++;
				}
			}
		}
		return result;
	}

	async withTransaction(callback: () => Promise<void>) {
		if (this._transactionTask) await this._transactionTask.catch(() => {});
		return (this._transactionTask = (async () => {
			this._run("BEGIN TRANSACTION");
			try {
				await callback();
				this._run("COMMIT");
			} catch (error) {
				try {
					this._run("ROLLBACK");
				} catch {}
				throw error;
			}
		})());
	}

	async getIndexes(table: string) {
		const indexes = this._all(
			`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`,
			[table],
		) as SQLiteMasterInfo[];
		const result: Driver.Index[] = [];
		for (const { name, sql } of indexes) {
			result.push({
				name,
				unique: !sql || sql.toUpperCase().startsWith("CREATE UNIQUE"),
				keys: this._parseIndexDef(sql),
			});
		}
		return result;
	}

	async createIndex(table: string, index: Driver.Index) {
		const name =
			index.name ??
			Object.entries(index.keys)
				.map(([key, direction]) => `${key}_${direction ?? "asc"}`)
				.join("+");
		const keyFields = Object.entries(index.keys)
			.map(([key, direction]) => `${escapeId(key)} ${direction ?? "asc"}`)
			.join(", ");
		await this._run(
			`create ${index.unique ? "UNIQUE" : ""} index ${escapeId(name)} ON ${escapeId(table)} (${keyFields})`,
		);
	}

	async dropIndex(_table: string, name: string) {
		await this._run(`DROP INDEX ${escapeId(name)}`);
	}

	_parseIndexDef(def: string): Driver.Index["keys"] {
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
}

// erasableSyntaxOnly：纯类型 namespace（运行时值 Config 由类静态属性承载）
namespace SQLiteDriver {
	export interface Config {
		path: string;
	}
}

export default SQLiteDriver;
