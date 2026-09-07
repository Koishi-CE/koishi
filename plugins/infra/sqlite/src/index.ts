// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

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
 * 模块划分（src/ 下按职责分三个子目录）：sql/ 为 SQL 生成
 * （builder.ts 方言生成器、utils.ts 共享片段工具）；operations/
 * 为 Driver 方法实现（schema.ts 表结构同步、crud.ts 数据操作、
 * indexes.ts 二级索引、stats.ts 规模统计）；setup/ 为启动时注册
 * （functions.ts 自定义 SQL 函数、datatypes.ts 类型 transformer）。
 *
 * 已知限制：Bun 的 node:sqlite 实现中 `setReadBigInts` 为空操作，
 * 超过 Number.MAX_SAFE_INTEGER 的整数读回会抛 RangeError（写入不受
 * 影响）；自增主键、时间戳等常规业务值远低于该阈值。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
	DatabaseSync,
	StatementSync,
} from "node:sqlite";
import type { Dict } from "cosmokit";
import type {
	Eval,
	MigrationHooks,
	Selection,
} from "minato";
import { Driver, z } from "minato";
import enUS from "../locales/en-US.yml";
import zhCN from "../locales/zh-CN.yml";
import * as crud from "./operations/crud.ts";
import * as indexes from "./operations/indexes.ts";
import * as schema from "./operations/schema.ts";
import { collectStats } from "./operations/stats.ts";
import { defineTypes } from "./setup/datatypes.ts";
import { registerFunctions } from "./setup/functions.ts";
import { SQLiteBuilder } from "./sql/builder.ts";

/**
 * 驱动本体。本类只保留有状态的部分——连接生命周期、执行原语、
 * 事务串行化——Driver 抽象方法一律薄委托到 operations/ 下的实现
 * 函数（首参回传 this），对外 API 面与上游单文件形态保持一致。
 */
export class SQLiteDriver extends Driver<SQLiteDriver.Config> {
	static override name = "sqlite";

	static Config: z<SQLiteDriver.Config> = z
		.object({
			path: z.string().role("path").required(),
			extensions: z.array(z.string().role("path")),
		})
		.i18n({
			"en-US": enUS,
			"zh-CN": zhCN,
		});

	/** 解析后的库文件绝对路径；`:memory:` 表示内存库。 */
	path!: string;
	/** node:sqlite 同步连接句柄，start() 后可用。 */
	db!: DatabaseSync;
	/** 缺省 SQL 生成器（带多表上下文的查询由各操作自建实例）。 */
	sql = new SQLiteBuilder(this);
	/** 上游遗留钩子位：停机前回调（本驱动不消费，保留字段兼容外部赋值）。 */
	beforeUnload?: () => void;

	/** 事务串行化锚点：下一个事务须等上一个落地（无论成败）才开启。 */
	private _transactionTask?: Promise<void>;

	/**
	 * 事务域标记：withTransaction 的回调（及其派生的全部异步执行）
	 * 内为 true。runBatch 据此区分「事务域内的嵌套批量写」（直接并入
	 * 外层事务）与「域外的顶层批量写」（排队后自成事务）——不能用
	 * 连接级标志区分这两者：并行批量写与嵌套批量写都会撞上打开中的
	 * 事务，但前者必须排队、后者并入，否则 SAVEPOINT 会被外层
	 * COMMIT 摧毁、或经队列等待自己而死锁。
	 */
	private _txDomain = new AsyncLocalStorage<boolean>();

	/** 建立连接，并注册自定义 SQL 函数与类型 transformer（见 setup/）。 */
	async start() {
		this.path = this.config.path;
		if (this.path !== ":memory:") {
			this.path = resolve(this.ctx.baseDir, this.path);
			mkdirSync(dirname(this.path), { recursive: true });
		}

		const { DatabaseSync } = await import("node:sqlite");
		this.db = new DatabaseSync(this.path, {
			// 为下方 extensions 配置的 loadExtension 打开门；
			// 未配置扩展时该开关无副作用
			allowExtension: true,
		});
		registerFunctions(this.db);
		defineTypes(this);

		// 扩展在内置函数之后加载：同名 SQL 函数会被扩展实现覆盖
		// （例如以原生 PCRE 版 regexp 替换 JS 版）。路径相对
		// baseDir 解析，绝对路径原样使用。
		for (const extension of this.config.extensions ?? []) {
			const target = resolve(this.ctx.baseDir, extension);
			try {
				this.db.loadExtension(target);
			} catch (error) {
				throw new Error(`加载 SQLite 扩展失败：${target}`, {
					cause: error,
				});
			}
			this.logger.info("已加载 SQLite 扩展：%s", target);
		}
	}

	async stop() {
		// 让出一拍事件循环，等挂起的微任务收尾后再关库
		await new Promise((resolve) => setTimeout(resolve, 0));
		this.db?.close();
	}

	/**
	 * 执行语句的原语：成功走 debug、失败带语句与参数上下文重新抛出
	 * （其余 _all / _get / _run 都经由此处，日志只需看一处）。
	 */
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

	/** 多行读取；`useBigInt` 时 INTEGER 列以 bigint 读回防精度丢失。 */
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

	/** 单行读取，参数语义同 _all。 */
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

	/**
	 * 写入语句；callback 在语句执行后同步调用，用于同连接上紧接着
	 * 取 `changes()` / `last_insert_rowid()` 这类连接级状态。
	 */
	_run(
		sql: string,
		params: unknown[] = [],
		callback?: () => unknown,
	) {
		this._exec(sql, params, (stmt) => {
			const args = params as Parameters<typeof stmt.run>;
			return stmt.run(...args);
		});
		return callback?.();
	}

	/**
	 * 事务串行化：回调经 _enqueueTransaction 排队执行，整体运行在
	 * 事务域标记内（域内的批量写会并入本事务而不是另开）。
	 */
	async withTransaction(callback: () => Promise<void>) {
		return this._enqueueTransaction(callback);
	}

	/**
	 * 事务执行的排队原语：同步占据队列尾（gate 占位），等前序事务落地
	 * 后以 BEGIN/COMMIT 执行 body，业务错误先 ROLLBACK 再原样抛出。
	 * 占位必须同步完成——若先 await 再读队列，并行调用会在让出期间
	 * 双双读到旧任务、双双 BEGIN 而相撞（"cannot start a transaction
	 * within a transaction"）。
	 */
	private _enqueueTransaction<T>(
		body: () => Promise<T>,
	): Promise<T> {
		let release!: () => void;
		const gate = new Promise<void>(
			(resolve) => (release = resolve),
		);
		const prev = this._transactionTask;
		this._transactionTask = gate;
		return (async () => {
			if (prev) await prev.catch(() => {});
			try {
				this._run("BEGIN TRANSACTION");
				const result = await this._txDomain.run(true, body);
				this._run("COMMIT");
				return result;
			} catch (error) {
				try {
					this._run("ROLLBACK");
				} catch {}
				throw error;
			} finally {
				release();
			}
		})();
	}

	/**
	 * 事务性批量写。逐语句自动提交会让批量写的每一行各付一次磁盘同步
	 * （实测仅百行每秒量级），因此：顶层批量写经 _enqueueTransaction
	 * 整批新开一个事务、一次 COMMIT，批内任一行失败整体回滚；事务域
	 * 内的嵌套批量写（用户 transact 回调里发起）直接并入外层事务——
	 * 嵌套时排队会等待自己而死锁，并入时不设 SAVEPOINT（并行批量写
	 * 的交织会让 SAVEPOINT 的释放脱离 LIFO 序而被外层 COMMIT 摧毁）。
	 */
	async runBatch<T>(
		callback: () => Promise<T>,
	): Promise<T> {
		if (this._txDomain.getStore()) return callback();
		return this._enqueueTransaction(callback);
	}

	// ---- Driver 抽象方法的薄委托（实现体见 operations/ 与 stats.ts）----

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

	async upsert(
		sel: Selection.Mutable,
		data: Dict[],
		keys: string[],
	) {
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
		/** 启动时经 loadExtension 加载的扩展文件列表（相对 baseDir 解析）。 */
		extensions?: string[];
	}
}

export default SQLiteDriver;
