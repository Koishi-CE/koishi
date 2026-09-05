// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 查询求值核心：驱动 `table()` 方法的实现。
 *
 * 职责是把一个 Selection 解析成内存行集——字符串表名直接取
 * store 数组；join 形态（表名为表集字典）走笛卡尔积展开并按
 * having 谓词过滤（`catesian` 一名系上游既有拼写，保留以求
 * 移植对照时 diff 最小）；随后经 executeSort 排序、按 group
 * 键分桶聚合（聚合字段在桶内行集上求值）。
 */
import type { Dict } from "cosmokit";
import { deepEqual, mapValues, omit, pick } from "cosmokit";
import type { Modifier } from "minato";
import {
	executeEval,
	executeQuery,
	executeSort,
	Field,
	Selection,
} from "minato";
import type { MemoryDriver } from "./index.ts";

export function executeTable(
	driver: MemoryDriver,
	sel:
		| string
		| Selection.Immutable
		| Record<string, string | Selection.Immutable>,
	env: Dict = {},
): Dict[] {
	if (typeof sel === "string") {
		return (driver._store[sel] ??= []);
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
				[name, executeTable(driver, sel, env)] as const,
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
				if (Object.keys(table).length === tail.length + 1) {
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
		data = executeTable(driver, table, env).filter((row) =>
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
