// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 注册 SQLite 自定义 SQL 函数（`db.function()`，Bun 1.4 原生支持）。
 *
 * - `regexp` / `regexp2`：正则匹配算子（后者支持 flags）；
 * - `json_array_contains`：JSON 数组包含判断（$in / $nin 的 json 通道）；
 * - `modulo`：取模（SQLite 内建 `%` 对 NULL 语义与 minato 期望不一致）；
 * - `rand`：随机数（$order 随机排序用）。
 */
import type {
	DatabaseSync,
	SQLOutputValue,
} from "node:sqlite";
import { isNullable } from "cosmokit";

export function registerFunctions(db: DatabaseSync) {
	db.function(
		"regexp",
		(pattern: SQLOutputValue, str: SQLOutputValue) => {
			if (isNullable(pattern) || isNullable(str))
				return null;
			return +new RegExp(String(pattern)).test(String(str));
		},
	);
	db.function(
		"regexp2",
		(
			pattern: SQLOutputValue,
			str: SQLOutputValue,
			flags: SQLOutputValue,
		) => {
			if (
				isNullable(pattern) ||
				isNullable(str) ||
				isNullable(flags)
			) {
				return null;
			}
			return +new RegExp(
				String(pattern),
				String(flags),
			).test(String(str));
		},
	);
	db.function(
		"json_array_contains",
		(array: SQLOutputValue, value: SQLOutputValue) => {
			if (isNullable(array) || isNullable(value))
				return null;
			return +(
				JSON.parse(String(array)) as unknown[]
			).includes(JSON.parse(String(value)));
		},
	);
	db.function(
		"modulo",
		(left: SQLOutputValue, right: SQLOutputValue) => {
			if (isNullable(left) || isNullable(right))
				return null;
			return Number(left) % Number(right);
		},
	);
	db.function("rand", () => Math.random());
}
