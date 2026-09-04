// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
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
 * 模块划分：builder.ts 为 SQL 生成器；schema.ts 为表结构同步（DDL）；
 * crud.ts 为数据操作（DML）；indexes.ts 为二级索引；stats.ts 为规模
 * 统计；functions.ts / datatypes.ts 分别承载自定义 SQL 函数与类型
 * transformer 的注册；utils.ts 存放共享 SQL 片段工具。
 *
 * 已知限制：Bun 的 node:sqlite 实现中 `setReadBigInts` 为空操作，
 * 超过 Number.MAX_SAFE_INTEGER 的整数读回会抛 RangeError（写入不受
 * 影响）；自增主键、时间戳等常规业务值远低于该阈值。
 */
import type { Eval, MigrationHooks, Selection } from "minato";
import { Driver, z } from "minato";
import enUS from "../locales/en-US.yml";
import zhCN from "../locales/zh-CN.yml";
import { SQLiteBuilder } from "./builder.ts";
import * as crud from "./crud.ts";
import { defineTypes } from "./datatypes.ts";
import { registerFunctions } from "./functions.ts";
import * as indexes from "./indexes.ts";
import * as schema from "./schema.ts";
import { collectStats } from "./stats.ts";

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

	async start() {
		this.path = this.config.path;
		if (this.path !== ":memory:") {
			this.path = resolve(this.ctx.baseDir, this.path);
			mkdirSync(dirname(this.path), { recursive: true });
		}

		const { DatabaseSync } = await import("node:sqlite");
		this.db = new DatabaseSync(this.path);
		registerFunctions(this.db);
		defineTypes(this);
	}

	async stop() {
		await new Promise((resolve) => setTimeout(resolve, 0));
		this.db?.close();
	}

	/** 执行语句的原语：成功走 debug、失败带语句上下文重新抛出。 */
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

	async prepare(table: string, dropKeys?: string[]) {
		return schema.prepare(this, table, dropKeys);
	}

	/** 基类 migrate 为 protected，开公开桥供 schema 模块的 prepare 尾段调用。 */
	runMigration(table: string, hooks: MigrationHooks) {
		return this.migrate(table, hooks);
	}

	async drop(table: string) {
		return schema.drop(this, table);
	}

	async dropAll() {
		return schema.dropAll(this);
	}

	async remove(sel: Selection.Mutable) {
		return crud.remove(this, sel);
	}

	async get(sel: Selection.Immutable) {
		return crud.get(this, sel);
	}

	async eval(sel: Selection.Immutable, expr: Eval.Expr) {
		return crud.evaluate(this, sel, expr);
	}

	async set(sel: Selection.Mutable, update: object) {
		return crud.set(this, sel, update);
	}

	async create(sel: Selection.Mutable, data: object) {
		return crud.create(this, sel, data);
	}

	async upsert(sel: Selection.Mutable, data: Dict[], keys: string[]) {
		return crud.upsert(this, sel, data, keys);
	}

	async stats() {
		return collectStats(this);
	}

	async getIndexes(table: string) {
		return indexes.getIndexes(this, table);
	}

	async createIndex(table: string, index: Driver.Index) {
		return indexes.createIndex(this, table, index);
	}

	async dropIndex(_table: string, name: string) {
		return indexes.dropIndex(this, name);
	}
}

// erasableSyntaxOnly：纯类型 namespace（运行时值 Config 由类静态属性承载）
namespace SQLiteDriver {
	export interface Config {
		path: string;
	}
}

export default SQLiteDriver;
