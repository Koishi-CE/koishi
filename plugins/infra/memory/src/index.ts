// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import type { Dict } from "cosmokit";
/**
 * 内存数据库驱动（minato 3 / cordis 3 冻结线）。
 *
 * 纯内存实现，无任何持久化——进程退出数据即失。定位是测试替身
 * 与行为基准：单测里与 plugin-mock 配对构成无 IO 的测试基建；
 * SQLite 驱动的对拍测试以本驱动为行为参照。
 *
 * 上游脉络：`@koishijs/plugin-database-memory` 3.7.0（纯 re-export
 * 薄壳）与 `@minatojs/driver-memory` 3.7.0（225 行实现）的文件级
 * 合并——查询求值、排序、分组全部复用 minato 基类的 execute*
 * 系列基建，本包只维护数据存放与各 Driver 抽象方法的内存版
 * 实现；映射关系见 docs/process/upstream.md。
 *
 * 与上游的刻意差异仅三类：导入指向冻结生态（cosmokit / minato）；
 * 本仓代码风格（tab / 双引号 / 行类型 Dict / 无非空断言——上游的
 * `!` 断言改写为 `as` 转型，语义等价）；逻辑逐行对齐，含 `catesian`
 * 一名系上游既有拼写（笛卡尔积），保留以求移植对照时 diff 最小。
 */
import {
	clone,
	deepEqual,
	makeArray,
	mapValues,
	noop,
	omit,
	pick,
} from "cosmokit";
import type { Eval, Modifier } from "minato";
import {
	Driver,
	executeEval,
	executeQuery,
	executeSort,
	executeUpdate,
	Field,
	isAggrExpr,
	RuntimeError,
	Selection,
	z,
} from "minato";

/** 自增主键计数元数据（挂在 _store._fields，与表数据同住）。 */
interface AutoIncMeta {
	table: string;
	field: string;
	autoInc: number;
}

/** 内存库容器：每个表一份数组，_fields 键另存自增元数据。 */
type MemoryStore = Record<string, Dict[]> & {
	_fields: AutoIncMeta[];
};

export class MemoryDriver extends Driver<MemoryDriver.Config> {
	static override name = "memory";

	static Config: z<MemoryDriver.Config> = z.object({});

	_store: MemoryStore = { _fields: [] };

	_indexes: Record<string, Record<string, Driver.Index>> =
		{};

	async prepare(_name: string) {}

	async start() {}

	async $save(_name: string) {}

	async stop() {}

	table(
		sel:
			| string
			| Selection.Immutable
			| Record<string, string | Selection.Immutable>,
		env: Dict = {},
	): Dict[] {
		if (typeof sel === "string") {
			return (this._store[sel] ??= []);
		}

		if (!Selection.is(sel)) {
			throw new Error("Should not reach here");
		}

		const { ref, query, table, args, model } = sel;
		const {
			fields,
			group,
			having,
			optional = {},
		} = sel.args[0] as Modifier;

		let data: Dict[];

		if (typeof table === "object" && !Selection.is(table)) {
			const entries = Object.entries(table).map(
				([name, sel]) =>
					[name, this.table(sel, env)] as const,
			);
			const catesian = (
				entries: (readonly [string, Dict[]])[],
			): Dict[] => {
				if (!entries.length) return [];
				const [name, rows] = entries[0] as readonly [
					string,
					Dict[],
				];
				const tail = entries.slice(1);
				if (!tail.length)
					return rows.map((row) => ({ [name]: row }));
				return rows.flatMap((row) => {
					let res = catesian(tail).map((tail) => ({
						...tail,
						[name]: row,
					}));
					if (
						Object.keys(table).length ===
						tail.length + 1
					) {
						res = res
							.map((row) => ({ ...env, [ref]: row }))
							.filter((data) => executeEval(data, having))
							.map((x) => x[ref] as Dict);
					}
					return !optional[tail[0]?.[0] as string] ||
						res.length
						? res
						: [{ [name]: row }];
				});
			};
			data = catesian(entries);
		} else {
			data = this.table(table, env).filter((row) =>
				executeQuery(row, query, ref),
			);
		}

		env[ref] = data;

		const branches: { index: Dict; table: Dict[] }[] = [];
		const groupFields = group
			? pick(fields as Dict, group)
			: fields;
		for (let row of executeSort(
			data,
			args[0] as Modifier,
			ref,
		)) {
			row = model.format(row, false);
			for (const key in model.fields) {
				if (!Field.available(model.fields[key])) continue;
				row[key] ??= null;
			}
			let index: Dict = row;
			if (fields) {
				index = mapValues(groupFields as Dict, (expr) =>
					executeEval({ ...env, [ref]: row }, expr),
				);
			}
			let branch = branches.find((branch) => {
				if (!group || !groupFields) return false;
				for (const key in groupFields) {
					if (!deepEqual(branch.index[key], index[key]))
						return false;
				}
				return true;
			});
			if (!branch) {
				branch = { index, table: [] };
				branches.push(branch);
			}
			branch.table.push(row);
		}
		return branches
			.map(({ index, table }) => {
				if (group) {
					if (having) {
						const value = executeEval(
							table.map((row) => ({
								...env,
								[ref]: row,
								_: row,
							})),
							having,
						);
						if (!value) return;
					}
					const fieldSel = fields as Dict;
					for (const key in omit(fieldSel, group)) {
						index[key] = executeEval(
							table.map((row) => ({
								...env,
								[ref]: row,
								_: row,
							})),
							fieldSel[key],
						);
					}
				}
				return model.parse(index, false);
			})
			.filter(Boolean) as Dict[];
	}

	async drop(table: string) {
		delete this._store[table];
	}

	async dropAll() {
		this._store = { _fields: [] };
	}

	async stats() {
		return {
			tables: mapValues(this._store, (rows, name) => ({
				name,
				count: rows.length,
				size: 0,
			})),
			size: 0,
		};
	}

	async get(sel: Selection.Immutable) {
		return this.table(sel as Selection);
	}

	async eval(sel: Selection.Immutable, expr: Eval.Expr) {
		const { query, table } = sel;
		const ref = (
			typeof table === "string" ? sel.ref : table.ref
		) as string;
		const data = this.table(table).filter((row) =>
			executeQuery(row, query, ref),
		);
		return executeEval(
			data.map((row) => ({ [ref]: row, _: row })),
			expr,
		);
	}

	async set(sel: Selection.Mutable, data: object) {
		const { table, ref, query } = sel;
		const matched = this.table(table)
			.filter((row) => executeQuery(row, query, ref))
			.map((row) => executeUpdate(row, data, ref)).length;
		this.$save(table);
		return { matched };
	}

	async remove(sel: Selection.Mutable) {
		const { ref, query, table } = sel;
		const data = this.table(table);
		const remain = data.filter(
			(row) => !executeQuery(row, query, ref),
		);
		this._store[table] = remain;
		this.$save(table);
		const count = data.length - remain.length;
		return { removed: count, matched: count };
	}

	async create(sel: Selection.Mutable, data: Dict) {
		const { table, model } = sel;
		const { primary, autoInc } = model;
		const store = this.table(table);
		if (
			!Array.isArray(primary) &&
			autoInc &&
			!(primary in data)
		) {
			let meta = this._store._fields.find(
				(row) =>
					row.table === table && row.field === primary,
			);
			if (!meta) {
				meta = { table, field: primary, autoInc: 0 };
				this._store._fields.push(meta);
			}
			meta.autoInc += 1;
			data[primary] = meta.autoInc;
		} else {
			const duplicated = await this.database.get(
				table,
				pick(model.format(data), makeArray(primary)),
			);
			if (duplicated.length) {
				throw new RuntimeError("duplicate-entry");
			}
		}
		store.push(clone(data));
		this.$save(table);
		return clone(clone(data));
	}

	async upsert(
		sel: Selection.Mutable,
		data: Dict[],
		keys: string[],
	) {
		const { table, model, ref } = sel;
		const result = { inserted: 0, matched: 0 };
		for (const update of data) {
			const row = this.table(table).find((row) => {
				return keys.every(
					(key) => row[key] === update[key],
				);
			});
			if (row) {
				executeUpdate(row, update, ref);
				result.matched++;
			} else {
				const data = executeUpdate(
					model.create(),
					update,
					ref,
				);
				await this.create(sel, data).catch(noop);
				result.inserted++;
			}
		}
		this.$save(table);
		return result;
	}

	executeSelection(
		sel: Selection.Immutable,
		env: Dict | Dict[] = {},
	) {
		// args[0] 在此按求值表达式使用（isAggrExpr 仅分流求值形态），
		// 与上游一致地不做静态区分
		const expr = sel.args[0] as unknown as Eval.Expr;
		const table = sel.table as Selection;
		if (Array.isArray(env)) env = { [sel.ref]: env };
		const data = this.table(sel.table, env);
		const res = isAggrExpr(expr)
			? data.map((row) =>
					executeEval(
						{ ...env, [table.ref]: row, _: row },
						expr,
					),
				)
			: executeEval(
					Object.assign(
						data.map((row) => ({
							[table.ref]: row,
							_: row,
						})),
						env,
					),
					expr,
				);
		return res;
	}

	async withTransaction(callback: () => Promise<void>) {
		const data = clone(this._store);
		await callback().catch((e) => {
			this._store = data;
			throw e;
		});
	}

	async getIndexes(table: string) {
		return Object.values(this._indexes[table] ?? {});
	}

	async createIndex(table: string, index: Driver.Index) {
		const name =
			index.name ??
			"index:" +
				Object.entries(index.keys)
					.map(([key, direction]) => `${key}_${direction}`)
					.join("+");
		const indexes = (this._indexes[table] ??= {});
		indexes[name] = { name, unique: false, ...index };
	}

	async dropIndex(table: string, name: string) {
		const indexes = (this._indexes[table] ??= {});
		delete indexes[name];
	}
}

export namespace MemoryDriver {
	// biome-ignore lint/suspicious/noEmptyInterface: 与上游保持一致，声明可被下游扩展的空配置
	export interface Config {}
}

export default MemoryDriver;
