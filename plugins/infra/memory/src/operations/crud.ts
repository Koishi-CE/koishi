// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/** 数据操作（DML）：查询、求值、写入、创建与批量 upsert。 */
import type { Dict } from "cosmokit";
import { clone, makeArray, noop, pick } from "cosmokit";
import type { Eval, Selection } from "minato";
import {
	executeEval,
	executeQuery,
	executeUpdate,
	isAggrExpr,
	RuntimeError,
} from "minato";
import type { MemoryDriver } from "../index.ts";

export async function get(
	driver: MemoryDriver,
	sel: Selection.Immutable,
) {
	return driver.table(sel as Selection);
}

export async function evaluate(
	driver: MemoryDriver,
	sel: Selection.Immutable,
	expr: Eval.Expr,
) {
	const { query, table } = sel;
	const ref = (
		typeof table === "string" ? sel.ref : table.ref
	) as string;
	const data = driver
		.table(table)
		.filter((row) => executeQuery(row, query, ref));
	return executeEval(
		data.map((row) => ({ [ref]: row, _: row })),
		expr,
	);
}

export async function set(
	driver: MemoryDriver,
	sel: Selection.Mutable,
	data: object,
) {
	const { table, ref, query } = sel;
	const matched = driver
		.table(table)
		.filter((row) => executeQuery(row, query, ref))
		.map((row) => executeUpdate(row, data, ref)).length;
	driver.$save(table);
	return { matched };
}

export async function remove(
	driver: MemoryDriver,
	sel: Selection.Mutable,
) {
	const { ref, query, table } = sel;
	const data = driver.table(table);
	const remain = data.filter(
		(row) => !executeQuery(row, query, ref),
	);
	driver._store[table] = remain;
	driver.$save(table);
	const count = data.length - remain.length;
	return { removed: count, matched: count };
}

export async function create(
	driver: MemoryDriver,
	sel: Selection.Mutable,
	data: Dict,
) {
	const { table, model } = sel;
	const { primary, autoInc } = model;
	const store = driver.table(table);
	if (
		!Array.isArray(primary) &&
		autoInc &&
		!(primary in data)
	) {
		let meta = driver._store._fields.find(
			(row) => row.table === table && row.field === primary,
		);
		if (!meta) {
			meta = { table, field: primary, autoInc: 0 };
			driver._store._fields.push(meta);
		}
		meta.autoInc += 1;
		data[primary] = meta.autoInc;
	} else {
		const duplicated = await driver.database.get(
			table,
			pick(model.format(data), makeArray(primary)),
		);
		if (duplicated.length) {
			throw new RuntimeError("duplicate-entry");
		}
	}
	store.push(clone(data));
	driver.$save(table);
	return clone(clone(data));
}

export async function upsert(
	driver: MemoryDriver,
	sel: Selection.Mutable,
	data: Dict[],
	keys: string[],
) {
	const { table, model, ref } = sel;
	const result = { inserted: 0, matched: 0 };
	for (const update of data) {
		const row = driver.table(table).find((row) => {
			return keys.every((key) => row[key] === update[key]);
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
			// 未命中插入经驱动的 create 走（重复键检查），失败静默——上游语义
			await create(driver, sel, data).catch(noop);
			result.inserted++;
		}
	}
	driver.$save(table);
	return result;
}

export function executeSelection(
	driver: MemoryDriver,
	sel: Selection.Immutable,
	env: Dict | Dict[] = {},
) {
	// args[0] 在此按求值表达式使用（isAggrExpr 仅分流求值形态），
	// 与上游一致地不做静态区分
	const expr = sel.args[0] as unknown as Eval.Expr;
	const table = sel.table as Selection;
	if (Array.isArray(env)) env = { [sel.ref]: env };
	const data = driver.table(sel.table, env);
	const res = isAggrExpr(expr)
		? data.map((row) =>
				executeEval(
					{ ...env, [table.ref]: row, _: row },
					expr,
				),
			)
		: executeEval(
				Object.assign(
					data.map((row) => ({ [table.ref]: row, _: row })),
					env,
				),
				expr,
			);
	return res;
}
