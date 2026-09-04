// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import type { StatementSync } from "node:sqlite";
/** 数据操作（DML）：查询、求值、写入、创建与批量 upsert。 */
import { escapeId } from "@minatojs/sql-utils";
import type { Dict } from "cosmokit";
import { deepEqual, difference, makeArray, mapValues } from "cosmokit";
import type { Selection } from "minato";
import { Eval, executeUpdate, getCell, hasSubquery, isEvalExpr } from "minato";
import type { SQLiteDriver } from "../index.ts";
import { SQLiteBuilder } from "../sql/builder.ts";
import { joinKeys } from "../sql/utils.ts";

export async function remove(driver: SQLiteDriver, sel: Selection.Mutable) {
	const { query, table, tables } = sel;
	const builder = new SQLiteBuilder(driver, tables);
	const filter = builder.parseQuery(query);
	if (filter === "0") return {};
	const result = driver._run(
		`DELETE FROM ${escapeId(table)} WHERE ${filter}`,
		[],
		() => driver._get(`SELECT changes() AS count`) as { count: number },
	) as { count: number };
	return { matched: result.count, removed: result.count };
}

export async function get(driver: SQLiteDriver, sel: Selection.Immutable) {
	const { model, tables } = sel;
	const builder = new SQLiteBuilder(driver, tables);
	const sql = builder.get(sel);
	if (!sql) return [];
	const rows = driver._all(sql, [], { useBigInt: true }) as Dict[];
	return rows.map((row) => builder.load(row, model));
}

export async function evaluate(
	driver: SQLiteDriver,
	sel: Selection.Immutable,
	expr: Eval.Expr,
) {
	const builder = new SQLiteBuilder(driver, sel.tables);
	const inner = builder.get(sel.table as Selection, true, true);
	const output = builder.parseEval(expr, false);
	const { value } = driver._get(`SELECT ${output} AS value FROM ${inner}`, [], {
		useBigInt: true,
	}) as { value: unknown };
	return builder.load(value, expr);
}

function updateRow(
	driver: SQLiteDriver,
	sel: Selection.Mutable,
	indexFields: string[],
	updateFields: string[],
	update: object,
	data: object,
) {
	const { ref, table, tables, model } = sel;
	const builder = new SQLiteBuilder(driver, tables);
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
	driver._run(
		`UPDATE ${escapeId(table)} SET ${assignment} WHERE ${filter}`,
		args,
	);
}

export async function set(
	driver: SQLiteDriver,
	sel: Selection.Mutable,
	update: object,
) {
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
		const sel2 = driver.database.select(table as never, query);
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
		return driver.database.upsert(table as never, upsert);
	} else {
		const data = await driver.database.get(table as never, query);
		for (const row of data) {
			updateRow(driver, sel, primaryFields, updateFields, update, row);
		}
		return { matched: data.length };
	}
}

function insert(driver: SQLiteDriver, table: string, data: object) {
	const model = driver.model(table);
	data = driver.sql.dump(data, model);
	const keys = Object.keys(data);
	const sql = `INSERT INTO ${escapeId(table)} (${joinKeys(keys)}) VALUES (${Array(keys.length).fill("?").join(", ")})`;
	const args = keys.map((key) => (data as Dict)[key] ?? null) as Parameters<
		StatementSync["run"]
	>;
	return driver._run(
		sql,
		args,
		() =>
			driver._get(`SELECT last_insert_rowid() AS id`) as {
				id: number | bigint;
			},
	) as { id: number | bigint };
}

export async function create(
	driver: SQLiteDriver,
	sel: Selection.Mutable,
	data: object,
) {
	const { model, table } = sel;
	const { id } = insert(driver, table, data);
	const { autoInc, primary } = model;
	if (!autoInc || Array.isArray(primary)) return data;
	return { ...data, [primary]: id };
}

export async function upsert(
	driver: SQLiteDriver,
	sel: Selection.Mutable,
	data: Dict[],
	keys: string[],
) {
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
		const results = (await driver.database.get(table as never, {
			$or: chunk.map((item) =>
				Object.fromEntries(keys.map((key) => [key, item[key]])),
			),
		})) as Dict[];
		for (const item of chunk) {
			const row = results.find((row) => {
				// flatten key to respect model
				const formatted = model.format(row);
				return keys.every((key) => deepEqual(formatted[key], item[key], true));
			});
			if (row) {
				updateRow(driver, sel, keys, updateFields, item, row);
				result.matched++;
			} else {
				insert(driver, table, executeUpdate(model.create(), item, ref));
				result.inserted++;
			}
		}
	}
	return result;
}
