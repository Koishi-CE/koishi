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
 *
 * regexp 系函数的编译产物走模块级 LRU 缓存（键 = flags + pattern）：
 * 扫描查询对同一 pattern 每行调用一次，免重复构造。
 */
import type {
	DatabaseSync,
	SQLOutputValue,
} from "node:sqlite";
import { isNullable } from "cosmokit";

/** 缓存容量：覆盖单次扫描查询涉及的 pattern 数绰绰有余。 */
const REGEXP_CACHE_SIZE = 256;

/** flags+pattern → 编译产物。Map 按插入序迭代，队首即最旧。 */
const regexpCache = new Map<string, RegExp>();

/** 编译（或命中缓存）正则；命中时挪到队尾维持 LRU 序。 */
function compileRegExp(
	pattern: string,
	flags: string,
): RegExp {
	const key = `${flags}:${pattern}`;
	const cached = regexpCache.get(key);
	if (cached) {
		regexpCache.delete(key);
		regexpCache.set(key, cached);
		return cached;
	}
	// 合法 flags 不含冒号，`${flags}:${pattern}` 作键无歧义；
	// 非法 flags 在 new RegExp 处抛错、不入缓存，行为与无缓存时一致
	const regex = new RegExp(pattern, flags);
	if (regexpCache.size >= REGEXP_CACHE_SIZE) {
		const oldest = regexpCache.keys().next();
		if (!oldest.done) regexpCache.delete(oldest.value);
	}
	regexpCache.set(key, regex);
	return regex;
}

export function registerFunctions(db: DatabaseSync) {
	db.function(
		"regexp",
		(pattern: SQLOutputValue, str: SQLOutputValue) => {
			if (isNullable(pattern) || isNullable(str))
				return null;
			return +compileRegExp(String(pattern), "").test(
				String(str),
			);
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
			const regex = compileRegExp(
				String(pattern),
				String(flags),
			);
			// 带 g/y 标志的正则有 lastIndex 状态，缓存复用前复位，
			// 保证行为等价于每次新编译
			regex.lastIndex = 0;
			return +regex.test(String(str));
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
