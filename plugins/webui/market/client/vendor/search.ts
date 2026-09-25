// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 搜索与查询词校验域：自由词相似度匹配、`op:value` 查询词判定、作者聚合。
// 源自上游 @koishijs/market 4.2.10 的 client/utils.ts，2026-09-25 经用户授权
// 现代化重组（操作符判定由 if-else 链改写为分派表，行为逐分支等价），
// 不再逐字对齐上游——上游改动按语义评估移植（见 docs/process/upstream.md）。

import type {
	SearchObject,
	User,
} from "@koishi-ce/registry";
import type { Dict } from "cosmokit";
import type { MarketConfig } from "./domain.ts";
import { resolveCategory } from "./domain.ts";

/**
 * npm 作者/维护者的宽容视图。registry 的 User 声明 email 必有，但运行时
 * 数据均可缺省（上游对回退对象显式产出 name: undefined），故以可选字段
 * 如实建模，消费方（package.vue 头像区）已自行兜底。
 */
export interface MarketUser {
	email?: string | undefined;
	name?: string | undefined;
}

export function getUsers(data: SearchObject): MarketUser[] {
	const result: Record<string, User> = {};
	for (const user of data.package.contributors ?? []) {
		if (!user.email) continue;
		result[user.email] ||= user;
	}
	if (
		!data.package.maintainers.some(
			(user) => result[user.email],
		)
	) {
		// 上游语义：贡献者与维护者无交集时回退维护者原样透出
		return data.package.maintainers.map(
			({ email, username }) => ({
				email,
				name: username,
			}),
		);
	}
	return Object.values(result);
}

export function getSimilarity(
	data: SearchObject,
	word: string,
) {
	word = word
		.replace("koishi-plugin-", "")
		.replace("@koishijs/plugin-", "");
	const shortname = data.package.name.replace(
		/(koishi-|^@koishijs\/)plugin-/,
		"",
	);
	if (shortname === word) return 1;
	const tokens = shortname.split(/[-/_]/);
	// if (tokens[0] === word) return 0.5
	if (tokens.includes(word)) return 0.5;
	// if (tokens[0].startsWith(word)) return 0.3
	if (tokens.some((t) => t.startsWith(word))) return 0.3;
	if (tokens.some((t) => t.includes(word))) return 0.2;
	return [
		...data.package.keywords,
		...Object.values(data.manifest?.description ?? {}),
	].some((keyword) => keyword.includes(word))
		? 0.05
		: 0;
}

const modifiers = ["show:", "sort:", "limit:"];

export function hasFilter(words: string[]) {
	return (
		words.filter(
			(w) =>
				w &&
				modifiers.every((prefix) => !w.startsWith(prefix)),
		).length > 0
	);
}

export function getFiltered(
	market: SearchObject[],
	words: string[],
	config?: MarketConfig,
) {
	return market.filter((data) => {
		const users = getUsers(data);
		return words.every((word) => {
			return validate(data, word, { ...config, users });
		});
	});
}

const operators = [
	"is",
	"not",
	"created",
	"updated",
	"impl",
	"locale",
	"using",
	"category",
	"email",
	"show",
	"sort",
	"limit",
];

export function validateWord(word: string) {
	if (!word.includes(":")) return true;
	const [key] = word.split(":", 1);
	return operators.includes(key ?? "");
}

interface ValidateConfig extends MarketConfig {
	users?: MarketUser[];
}

/**
 * 查询词谓词表。返回 undefined 表示当前数据形态不支持该操作符
 * （如无 manifest 时的清单域操作符）或未知方向/旗标，由 validate
 * 统一放行——与上游「带冒号的词不参与相似度匹配」语义一致。
 */
type WordPredicate = (
	data: SearchObject,
	value: string,
	config: ValidateConfig,
) => boolean | undefined;

function readFlag(data: SearchObject, flag: string) {
	switch (flag) {
		case "verified":
			return !!data.verified;
		case "insecure":
			return !!data.insecure;
		case "portable":
			return !!data.portable;
		case "preview":
			return !!data.manifest?.preview;
		default:
			return undefined;
	}
}

const predicates: Dict<WordPredicate> = {
	impl: (data, value) =>
		data.manifest
			? data.manifest.service.implements.includes(value)
			: undefined,
	locale: (data, value) =>
		data.manifest
			? data.manifest.locales.includes(value)
			: undefined,
	using: (data, value) => {
		const { manifest } = data;
		if (!manifest) return undefined;
		const { required, optional } = manifest.service;
		return (
			required.includes(value) || optional.includes(value)
		);
	},
	category: (data, value) =>
		data.manifest
			? resolveCategory(data.category) === value
			: undefined,
	email: (data, value, config) => {
		const users = config.users ?? getUsers(data);
		return users.some(({ email }) => email === value);
	},
	created: (data, value) => {
		if (value.startsWith("<"))
			return data.createdAt < value.slice(1);
		if (value.startsWith(">"))
			return data.createdAt >= value.slice(1);
		return undefined;
	},
	updated: (data, value) => {
		if (value.startsWith("<"))
			return data.updatedAt < value.slice(1);
		if (value.startsWith(">"))
			return data.updatedAt >= value.slice(1);
		return undefined;
	},
	is: (data, value, config) => {
		if (value === "installed")
			return !!config.installed?.(data);
		return readFlag(data, value) ?? false;
	},
	not: (data, value, config) => {
		if (value === "installed")
			return !config.installed?.(data);
		const flag = readFlag(data, value);
		return flag === undefined ? true : !flag;
	},
};

export function validate(
	data: SearchObject,
	word: string,
	config: ValidateConfig = {},
) {
	if (word.includes(":")) {
		const index = word.indexOf(":");
		const predicate = predicates[word.slice(0, index)];
		return (
			predicate?.(data, word.slice(index + 1), config) ??
			true
		);
	}
	return getSimilarity(data, word) > 0;
}
